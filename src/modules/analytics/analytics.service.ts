import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DashboardAnalyticsDto,
  DashboardDedicadoDto,
  ConsumoQuimicosAnalyticsDto,
  RankingLavadoresDto,
  RangoPeriodo,
} from './dto/analytics.dto.js';
import { ServiceStatus } from '@prisma/client';
import { SIN_RESULTADOS, resolverAlcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';

/** % máximo de descuento permitido sin autorización: por encima se considera "fuera de rango". */
const UMBRAL_DESCUENTO_PCT = 15;

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private filtroAgencia(user: any, dto: { agenciaId?: string; regionId?: string }): Record<string, unknown> {
    const a = resolverAlcance(user);
    switch (a.tipo) {
      case 'GLOBAL':
        if (dto.agenciaId) return { id: dto.agenciaId };
        return dto.regionId ? { regionId: dto.regionId } : {};
      case 'REGION':
        return { regionId: a.regionId, ...(dto.agenciaId ? { id: dto.agenciaId } : {}) };
      case 'AGENCIA':
        return { id: a.agenciaId };
      default:
        return SIN_RESULTADOS;
    }
  }

  /**
   * Resuelve el periodo del filtro de fecha GLOBAL (compartido por todos los dashboards) a un rango [desde, hasta].
   * `RANGO` usa fechaDesde/fechaHasta; los demás son relativos a hoy. `fecha` (legacy) equivale a un día exacto.
   */
  private resolverPeriodo(dto: { rango?: RangoPeriodo; fecha?: string; fechaDesde?: string; fechaHasta?: string }): { desde: Date; hasta: Date; rango: RangoPeriodo; etiqueta: string } {
    const ahora = new Date();
    const finDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 23, 59, 59, 999);
    const inicioDeHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 0, 0, 0, 0);
    const rango: RangoPeriodo = dto.rango ?? (dto.fecha || dto.fechaDesde ? 'RANGO' : 'HOY');

    switch (rango) {
      case 'SEMANA': {
        const d = new Date(ahora);
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lunes
        return { desde: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hasta: finDeHoy, rango, etiqueta: 'Esta semana' };
      }
      case 'MES':
        return { desde: new Date(ahora.getFullYear(), ahora.getMonth(), 1), hasta: finDeHoy, rango, etiqueta: 'Este mes' };
      case 'TRIMESTRE': {
        const q = Math.floor(ahora.getMonth() / 3);
        return { desde: new Date(ahora.getFullYear(), q * 3, 1), hasta: finDeHoy, rango, etiqueta: 'Este trimestre' };
      }
      case 'SEMESTRE': {
        const s = ahora.getMonth() < 6 ? 0 : 6;
        return { desde: new Date(ahora.getFullYear(), s, 1), hasta: finDeHoy, rango, etiqueta: 'Este semestre' };
      }
      case 'ANIO':
        return { desde: new Date(ahora.getFullYear(), 0, 1), hasta: finDeHoy, rango, etiqueta: 'Este año' };
      case 'RANGO': {
        const desde = dto.fechaDesde ? new Date(dto.fechaDesde) : (dto.fecha ? new Date(dto.fecha) : new Date(ahora.getFullYear(), ahora.getMonth(), 1));
        const hasta = dto.fechaHasta ? new Date(dto.fechaHasta) : (dto.fecha ? new Date(dto.fecha) : ahora);
        if ((dto.fechaDesde?.length ?? 10) <= 10) desde.setHours(0, 0, 0, 0);
        if (dto.fechaHasta || dto.fecha) hasta.setHours(23, 59, 59, 999);
        const etiqueta = `${desde.toISOString().split('T')[0]} → ${hasta.toISOString().split('T')[0]}`;
        return { desde, hasta, rango, etiqueta };
      }
      default:
        return { desde: inicioDeHoy, hasta: finDeHoy, rango: 'HOY', etiqueta: 'Hoy' };
    }
  }

  /**
   * Región efectiva del filtro, si aplica: la del usuario con alcance REGION, o la que pidió un usuario GLOBAL.
   * Permite acotar tablas sin relación directa a agencia (movimientos de inventario, stock de bodega).
   */
  private regionDeAlcance(user: any, dto: { regionId?: string }): string | null {
    const a = resolverAlcance(user);
    if (a.tipo === 'REGION') return a.regionId;
    if (a.tipo === 'GLOBAL' && dto?.regionId) return dto.regionId;
    return null;
  }

  async getDashboardMetrics(dto: DashboardAnalyticsDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    const periodo = this.resolverPeriodo(dto);
    const startOfDay = periodo.desde;
    const endOfDay = periodo.hasta;
    // Las ventanas "de tendencia" siguen el periodo elegido (no un fijo de 30 días).
    const hace30Dias = periodo.desde;

    const roleName = rolDeUsuario(user);

    if (roleName === 'ADMIN') {
      return { success: true, isAdminView: true, ...(await this.getAdminMetrics(startOfDay, endOfDay, hace30Dias)) };
    }
    if (roleName === 'APROBADOR') {
      return { success: true, isAprobadorView: true, ...(await this.getAprobadorMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias)) };
    }
    if (roleName === 'COORD_COMERCIAL' || roleName === 'JEFE_COMERCIAL') {
      return { success: true, isComercialView: true, ...(await this.getComercialMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias)) };
    }

    const isSupervisorView = roleName === 'SUPERVISOR';
    const baseMetrics = await this.getEjecutivoMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, isSupervisorView, dto);
    
    if (roleName === 'SUPER_ADMIN') {
      const globalMetrics = await this.getAdminEstrategicos(startOfDay, endOfDay, hace30Dias);
      return { 
        isSuperAdminView: true, 
        ...baseMetrics, 
        ...globalMetrics, 
        kpis: { ...baseMetrics.kpis, ...globalMetrics.kpis } 
      };
    }
    
    return baseMetrics;
  }

  // ═══ ADMIN ═══════════════════════════════════════════════════════════
  private async getAdminMetrics(startOfDay: Date, endOfDay: Date, hace30Dias: Date) {
    const [
      totalUsuarios, usuariosInactivos, rolesCount, usuariosRecientes,
      decisionesHoy, decisionesAgrupadas, totalAgencias, totalServicios, totalInsumos, serviciosPorCategoria,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { estado: 0 } }),
      this.prisma.user.groupBy({ by: ['roleId'], _count: { id: true } }),
      this.prisma.user.findMany({ where: { createdAt: { gte: hace30Dias } }, select: { createdAt: true } }),
      this.prisma.auditoriaDecision.count({ where: { createdAt: { gte: startOfDay, lte: endOfDay } } }),
      this.prisma.auditoriaDecision.groupBy({ by: ['accion'], _count: { id: true } }),
      this.prisma.agencia.count(),
      this.prisma.catalogoServicio.count(),
      this.prisma.insumo.count(),
      this.prisma.catalogoServicio.groupBy({ by: ['categoria'], _count: { id: true } }),
    ]);

    const rolesData = await this.prisma.role.findMany({ select: { id: true, namerol: true } });
    const roleMap = new Map(rolesData.map(r => [r.id, r.namerol]));
    const distribucionRoles = rolesCount
      .map(r => ({ nombre: roleMap.get(r.roleId) || 'Desconocido', cantidad: r._count.id }))
      .filter(r => r.cantidad > 0)
      .sort((a, b) => b.cantidad - a.cantidad);

    const flujoUsuarios: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      flujoUsuarios[d.toISOString().split('T')[0]] = 0;
    }
    for (const u of usuariosRecientes) {
      const k = u.createdAt.toISOString().split('T')[0];
      if (flujoUsuarios[k] !== undefined) flujoUsuarios[k]++;
    }

    const estrategicos = await this.getAdminEstrategicos(startOfDay, endOfDay, hace30Dias);

    return {
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      kpis: {
        totalUsuarios,
        usuariosActivos: totalUsuarios - usuariosInactivos,
        rolesEnSistema: distribucionRoles.length,
        agenciasOperativas: totalAgencias,
        decisionesHoy,
        totalServiciosCatalogo: totalServicios,
        totalInsumos,
        ...estrategicos.kpis,
      },
      flujoHorario: Object.keys(flujoUsuarios).sort().map(hora => ({ hora, cantidad: flujoUsuarios[hora] })),
      distribucionRoles,
      distribucionDecisiones: decisionesAgrupadas.map(d => ({ nombre: d.accion, total: d._count.id })).sort((a, b) => b.total - a.total),
      distribucionCategorias: serviciosPorCategoria.map(s => ({ nombre: s.categoria, total: s._count.id })).sort((a, b) => b.total - a.total),
      topAgenciasProductivas: estrategicos.topAgenciasProductivas,
      mixGenerales: estrategicos.mixGenerales,
      mixEspeciales: estrategicos.mixEspeciales,
      topColores: estrategicos.topColores,
      topMarcasModelos: estrategicos.topMarcasModelos,
      distribucionBahias: estrategicos.distribucionBahias,
      topAgenciasGanancia: estrategicos.topAgenciasGanancia,
      topAgenciasReparaciones: estrategicos.topAgenciasReparaciones,
    };
  }

  /**
   * KPIs estratégicos de la red (visión 360° del Admin): ingresos, ticket, crecimiento, productividad
   * nacional, costo de reparaciones y valor del inventario. Todo el país, sin filtro de alcance.
   */
  private async getAdminEstrategicos(startOfDay: Date, endOfDay: Date, hace30Dias: Date) {
    const inicioMes = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
    const inicioMesAnterior = new Date(startOfDay.getFullYear(), startOfDay.getMonth() - 1, 1);
    const finalizados: ServiceStatus[] = [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO];

    const [
      ingresoPeriodoAgg, ingresoMesAgg, ingresoMesAnteriorAgg,
      completadosPeriodo, completadosMes, serviciosPeriodo,
      incidentesPeriodo, stocks, movEnTransito,
    ] = await Promise.all([
      this.prisma.servicioLavado.aggregate({ _sum: { precio: true }, where: { horaIngreso: { gte: startOfDay, lte: endOfDay }, estado: { in: finalizados } } }),
      this.prisma.servicioLavado.aggregate({ _sum: { precio: true }, where: { horaIngreso: { gte: inicioMes, lte: endOfDay }, estado: { in: finalizados } } }),
      this.prisma.servicioLavado.aggregate({ _sum: { precio: true }, where: { horaIngreso: { gte: inicioMesAnterior, lt: inicioMes }, estado: { in: finalizados } } }),
      this.prisma.servicioLavado.count({ where: { horaIngreso: { gte: startOfDay, lte: endOfDay }, estado: { in: finalizados } } }),
      this.prisma.servicioLavado.count({ where: { horaIngreso: { gte: inicioMes, lte: endOfDay }, estado: { in: finalizados } } }),
      // Servicios del periodo con los atributos de vehículo, categoría, costos y bahía→agencia para los desgloses.
      this.prisma.servicioLavado.findMany({
        where: { horaIngreso: { gte: startOfDay, lte: endOfDay }, estado: { in: finalizados } },
        select: {
          precio: true, marca: true, modelo: true, color: true, horaInicio: true, horaSalida: true,
          catalogo: { select: { nombre: true, categoria: true } },
          bahia: { select: { nombre: true, agencia: { select: { nombre: true, region: true } } } },
          consumos: { select: { cantidadUsada: true, insumo: { select: { costoUnitarioUSD: true } } } },
        },
      }),
      this.prisma.incidenteTecnico.findMany({
        where: { createdAt: { gte: hace30Dias } },
        select: { costoTotal: true, maquinaria: { select: { agencia: { select: { nombre: true } } } } },
      }),
      this.prisma.stockUbicacion.findMany({ select: { cantidadActual: true, insumo: { select: { costoUnitarioUSD: true } } } }),
      this.prisma.movimientoInventario.findMany({ where: { estadoDespacho: 'EN_TRANSITO' }, select: { detalles: { select: { cantidadEnviada: true, costoUnitarioUSD: true } } } }),
    ]);

    const ingresoHoy = Number(ingresoPeriodoAgg._sum.precio || 0);
    const ingresoMes = Number(ingresoMesAgg._sum.precio || 0);
    const ingresoMesAnterior = Number(ingresoMesAnteriorAgg._sum.precio || 0);
    const variacionMesPct = ingresoMesAnterior > 0
      ? Number((((ingresoMes - ingresoMesAnterior) / ingresoMesAnterior) * 100).toFixed(1))
      : null;

    let tiempoTotalMin = 0, serviciosConTiempo = 0;
    const mixGenerales: Record<string, number> = {};
    const mixEspeciales: Record<string, number> = {};
    const colores: Record<string, number> = {};
    const marcasModelos: Record<string, number> = {};
    const bahias: Record<string, { nombre: string; total: number; tiempoTotalMin: number; finalizados: number }> = {};
    const agenciaStats: Record<string, { ingresos: number; costoInsumos: number; cantidad: number }> = {};

    for (const s of serviciosPeriodo) {
      const categoria = s.catalogo?.categoria === 'ESPECIAL' ? 'especial' : 'general';
      const nombreServicio = s.catalogo?.nombre || 'Servicio';
      if (categoria === 'especial') mixEspeciales[nombreServicio] = (mixEspeciales[nombreServicio] || 0) + 1;
      else mixGenerales[nombreServicio] = (mixGenerales[nombreServicio] || 0) + 1;

      if (s.color) colores[s.color] = (colores[s.color] || 0) + 1;
      const marcaModelo = [s.marca, s.modelo].filter(Boolean).join(' ').trim();
      if (marcaModelo) marcasModelos[marcaModelo] = (marcasModelos[marcaModelo] || 0) + 1;

      let duracionMin = 0;
      if (s.horaSalida) {
        const inicio = s.horaInicio || null;
        if (inicio) { duracionMin = Math.max(0, (new Date(s.horaSalida).getTime() - new Date(inicio).getTime()) / 60000); tiempoTotalMin += duracionMin; serviciosConTiempo++; }
      }

      let costoInsumos = 0;
      for (const c of s.consumos || []) costoInsumos += Number(c.cantidadUsada || 0) * Number(c.insumo?.costoUnitarioUSD || 0);

      const agencia = s.bahia?.agencia?.nombre || 'Sin agencia';
      const reg = (agenciaStats[agencia] ??= { ingresos: 0, costoInsumos: 0, cantidad: 0 });
      reg.ingresos += Number(s.precio || 0); reg.costoInsumos += costoInsumos; reg.cantidad += 1;

      if (s.bahia?.nombre) {
        const b = (bahias[s.bahia.nombre] ??= { nombre: `${s.bahia.nombre} · ${agencia}`, total: 0, tiempoTotalMin: 0, finalizados: 0 });
        b.total += 1;
        if (s.horaSalida && duracionMin > 0) { b.finalizados += 1; b.tiempoTotalMin += duracionMin; }
      }
    }

    const tiempoPromedioServicioMin = serviciosConTiempo > 0 ? Math.round(tiempoTotalMin / serviciosConTiempo) : 0;
    const topAgenciasProductivas = Object.keys(agenciaStats)
      .map((n) => ({ nombre: n, cantidad: agenciaStats[n].cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);
    // Ganancia neta = ingresos por servicios − costo de insumos consumidos (por agencia).
    const topAgenciasGanancia = Object.keys(agenciaStats)
      .map((n) => ({ nombre: n, ganancia: Number((agenciaStats[n].ingresos - agenciaStats[n].costoInsumos).toFixed(2)) }))
      .sort((a, b) => b.ganancia - a.ganancia).slice(0, 5);
    // Bahías: cantidad + tiempo promedio en una sola serie, con su agencia de origen.
    const distribucionBahias = Object.values(bahias)
      .map((b) => ({ nombre: b.nombre, cantidad: b.total, tiempoPromedioMin: b.finalizados > 0 ? Math.round(b.tiempoTotalMin / b.finalizados) : 0 }))
      .sort((a, b) => b.cantidad - a.cantidad).slice(0, 8);

    const reparacionesPorAgencia: Record<string, number> = {};
    for (const inc of incidentesPeriodo) {
      const agencia = inc.maquinaria?.agencia?.nombre || 'Sin agencia';
      reparacionesPorAgencia[agencia] = (reparacionesPorAgencia[agencia] || 0) + Number(inc.costoTotal || 0);
    }
    const costoReparacionesTotal = Object.values(reparacionesPorAgencia).reduce((a, b) => a + b, 0);
    const topAgenciasReparaciones = Object.keys(reparacionesPorAgencia)
      .map((n) => ({ nombre: n, costo: Number(reparacionesPorAgencia[n].toFixed(2)) }))
      .sort((a, b) => b.costo - a.costo).slice(0, 5);

    let valorInventarioUSD = 0;
    for (const s of stocks) valorInventarioUSD += Number(s.cantidadActual || 0) * Number(s.insumo?.costoUnitarioUSD || 0);
    let valorEnTransitoUSD = 0;
    for (const m of movEnTransito) for (const d of m.detalles) valorEnTransitoUSD += Number(d.cantidadEnviada || 0) * Number(d.costoUnitarioUSD || 0);

    const topN = (rec: Record<string, number>, n: number) =>
      Object.keys(rec).map((nombre) => ({ nombre, cantidad: rec[nombre] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, n);

    return {
      kpis: {
        ingresoHoy: Number(ingresoHoy.toFixed(2)),
        ingresoMes: Number(ingresoMes.toFixed(2)),
        ingresoMesAnterior: Number(ingresoMesAnterior.toFixed(2)),
        variacionMesPct,
        ticketPromedioHoy: completadosPeriodo > 0 ? Number((ingresoHoy / completadosPeriodo).toFixed(2)) : 0,
        serviciosCompletadosHoy: completadosPeriodo,
        serviciosCompletadosMes: completadosMes,
        tiempoPromedioServicioMin,
        costoReparaciones30d: Number(costoReparacionesTotal.toFixed(2)),
        valorInventarioUSD: Number(valorInventarioUSD.toFixed(2)),
        valorEnTransitoUSD: Number(valorEnTransitoUSD.toFixed(2)),
      },
      topAgenciasProductivas,
      mixGenerales: topN(mixGenerales, 5),
      mixEspeciales: topN(mixEspeciales, 5),
      topColores: topN(colores, 5),
      topMarcasModelos: topN(marcasModelos, 5),
      distribucionBahias,
      topAgenciasGanancia,
      topAgenciasReparaciones,
    };
  }

  // ═══ APROBADOR ═══════════════════════════════════════════════════════
  private async getAprobadorMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date) {
    const whereBase = hayFiltro ? { agencia: filtro } : {};

    const [todasSolicitudes, solicitudesHoy, anuladasHoy] = await Promise.all([
      this.prisma.solicitudAprobacion.findMany({ where: { createdAt: { gte: hace30Dias }, ...whereBase }, select: { tipo: true, estado: true, createdAt: true, montoUSD: true, entidadRefId: true } }),
      this.prisma.solicitudAprobacion.findMany({ where: { createdAt: { gte: startOfDay, lte: endOfDay }, ...whereBase }, select: { tipo: true, estado: true, montoUSD: true } }),
      // Anulaciones (control antifraude) de servicios de su alcance registradas hoy.
      this.prisma.servicioLavado.count({ where: { anuladoEn: { gte: startOfDay, lte: endOfDay }, ...(hayFiltro ? { bahia: { agencia: filtro } } : {}) } }),
    ]);

    const pendientesHoy = solicitudesHoy.filter(s => s.estado === 'PENDIENTE').length;
    const aprobadasHoy = solicitudesHoy.filter(s => s.estado === 'APROBADO').length;
    const rechazadasHoy = solicitudesHoy.filter(s => s.estado === 'RECHAZADO').length;
    const montoAprobadoHoy = solicitudesHoy.filter(s => s.estado === 'APROBADO').reduce((sum, s) => sum + Number(s.montoUSD || 0), 0);

    const flujoSolicitudes: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      flujoSolicitudes[d.toISOString().split('T')[0]] = 0;
    }
    for (const s of todasSolicitudes) {
      const k = s.createdAt.toISOString().split('T')[0];
      if (flujoSolicitudes[k] !== undefined) flujoSolicitudes[k]++;
    }

    const tiposCount: Record<string, number> = {};
    const estadosCount: Record<string, number> = { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 };
    for (const s of todasSolicitudes) {
      tiposCount[s.tipo] = (tiposCount[s.tipo] || 0) + 1;
      if (estadosCount[s.estado] !== undefined) estadosCount[s.estado]++;
    }

    // Descuentos "fuera de rango": solicitudes de descuento cuyo monto supera el % máximo permitido
    // respecto al precio del servicio enlazado (`entidadRefId`), dentro de los últimos 30 días.
    const solicitudesDescuento = todasSolicitudes.filter((s) => s.tipo === 'DESCUENTO' && s.entidadRefId && s.montoUSD !== null);
    let descuentosFueraDeRango = 0;
    if (solicitudesDescuento.length > 0) {
      const ids = [...new Set(solicitudesDescuento.map((s) => s.entidadRefId as string))];
      const [servicios, especiales] = await Promise.all([
        this.prisma.servicioLavado.findMany({ where: { id: { in: ids } }, select: { id: true, precio: true } }),
        this.prisma.servicioEspecial.findMany({ where: { id: { in: ids } }, select: { id: true, precio: true } }),
      ]);
      const precioBase = new Map<string, number>();
      for (const s of servicios) if (s.precio !== null) precioBase.set(s.id, Number(s.precio));
      for (const e of especiales) if (e.precio !== null) precioBase.set(e.id, Number(e.precio));
      for (const s of solicitudesDescuento) {
        const base = precioBase.get(s.entidadRefId as string) || 0;
        if (base > 0 && (Number(s.montoUSD) / base) * 100 > UMBRAL_DESCUENTO_PCT) descuentosFueraDeRango++;
      }
    }

    return {
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      kpis: { pendientesHoy, aprobadasHoy, rechazadasHoy, anuladasHoy, descuentosFueraDeRango, montoAprobadoHoy: Number(montoAprobadoHoy.toFixed(2)), totalHoy: solicitudesHoy.length },
      flujoHorario: Object.keys(flujoSolicitudes).sort().map(hora => ({ hora, cantidad: flujoSolicitudes[hora] })),
      distribucionTipos: Object.keys(tiposCount).map(k => ({ nombre: k, cantidad: tiposCount[k] })).sort((a, b) => b.cantidad - a.cantidad),
      distribucionEstados: Object.keys(estadosCount).map(k => ({ nombre: k, cantidad: estadosCount[k] })),
    };
  }

  // ═══ COMERCIAL ═══════════════════════════════════════════════════════
  private async getComercialMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date) {
    const base30 = hayFiltro ? { bahia: { agencia: filtro } } : {};
    const [servicios30Dias, serviciosHoy, solicitudesComerciales] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: { horaIngreso: { gte: hace30Dias }, ...base30 },
        select: {
          horaIngreso: true, horaInicio: true, horaSalida: true, estado: true, marca: true,
          catalogo: { select: { nombre: true, categoria: true, tiempoEstimadoMin: true } },
          consumos: { select: { cantidadUsada: true, insumo: { select: { costoUnitarioUSD: true } } } },
        },
      }),
      this.prisma.servicioLavado.count({ where: { horaIngreso: { gte: startOfDay, lte: endOfDay }, ...base30 } }),
      this.prisma.solicitudAprobacion.findMany({
        where: { tipo: { in: ['SERVICIO_ESPECIAL_PRECIO', 'DESCUENTO'] }, createdAt: { gte: hace30Dias }, ...(hayFiltro ? { agencia: filtro } : {}) },
        select: { tipo: true, estado: true, createdAt: true },
      }),
    ]);

    const mix: Record<string, number> = {};
    const mixCategoria: Record<string, number> = {};
    const marcas: Record<string, number> = {};
    let costoQuimicos30d = 0;
    // Cumplimiento de tiempos (SLA) y desviación real vs. estimado en los últimos 30 días.
    let slaTotal = 0, slaCumplen = 0, desviacionTotalMin = 0;
    const flujoServicios: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      flujoServicios[d.toISOString().split('T')[0]] = 0;
    }

    for (const s of servicios30Dias) {
      if (s.catalogo?.nombre) mix[s.catalogo.nombre] = (mix[s.catalogo.nombre] || 0) + 1;
      if (s.catalogo?.categoria) mixCategoria[s.catalogo.categoria] = (mixCategoria[s.catalogo.categoria] || 0) + 1;
      if (s.marca) marcas[s.marca] = (marcas[s.marca] || 0) + 1;
      for (const c of s.consumos || []) costoQuimicos30d += Number(c.cantidadUsada || 0) * Number(c.insumo?.costoUnitarioUSD || 0);
      const k = s.horaIngreso.toISOString().split('T')[0];
      if (flujoServicios[k] !== undefined) flujoServicios[k]++;
      if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) {
        const inicio = s.horaInicio || s.horaIngreso;
        const real = Math.max(0, Math.round((new Date(s.horaSalida).getTime() - new Date(inicio).getTime()) / 60000));
        const estimado = Number(s.catalogo?.tiempoEstimadoMin || 0);
        if (estimado > 0) {
          slaTotal++; desviacionTotalMin += real - estimado;
          if (real <= estimado) slaCumplen++;
        }
      }
    }

    const estComercial: Record<string, number> = { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 };
    for (const s of solicitudesComerciales) {
      if (estComercial[s.estado] !== undefined) estComercial[s.estado]++;
    }

    return {
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      kpis: {
        serviciosHoy,
        servicios30Dias: servicios30Dias.length,
        costoQuimicos30d: Number(costoQuimicos30d.toFixed(2)),
        descuentosPendientes: estComercial.PENDIENTE,
        descuentosAprobados: estComercial.APROBADO,
        cumplimientoSlaPct: slaTotal > 0 ? Math.round((slaCumplen / slaTotal) * 100) : null,
        desviacionPromedioMin: slaTotal > 0 ? Math.round(desviacionTotalMin / slaTotal) : null,
        // Mix Básico (GENERAL) vs Premium/Especial (ESPECIAL) del catálogo.
        premiumPct: servicios30Dias.length > 0 ? Math.round(((mixCategoria['ESPECIAL'] || 0) / servicios30Dias.length) * 100) : null,
      },
      flujoHorario: Object.keys(flujoServicios).sort().map(hora => ({ hora, cantidad: flujoServicios[hora] })),
      mixServicios: Object.keys(mix).map(k => ({ nombre: k, cantidad: mix[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 7),
      mixCategoria: Object.keys(mixCategoria).map(k => ({ nombre: k, cantidad: mixCategoria[k] })).sort((a, b) => b.cantidad - a.cantidad),
      topMarcas: Object.keys(marcas).map(k => ({ nombre: k, cantidad: marcas[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 7),
      solicitudesComerciales: Object.keys(estComercial).map(k => ({ nombre: k, cantidad: estComercial[k] })),
    };
  }

  // ═══ EJECUTIVO GENERAL (Supervisor, Líder Operador, Super Admin) ═════
  private async getEjecutivoMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date, isSupervisorView: boolean, dto: DashboardAnalyticsDto = {}) {
    const servicioWhere: any = { horaIngreso: { gte: startOfDay, lte: endOfDay } };
    if (hayFiltro) servicioWhere.bahia = { agencia: filtro };
    const alcanceMaq = hayFiltro ? { agencia: filtro } : {};

    const [serviciosHoy, totalLavadosHoy, incidentesAbiertos, alertasPendientes, maquinariasStats, todosIncidentes30Dias, incidentesActivosList, mantenimientosVencidos] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: servicioWhere,
        select: {
          id: true, estado: true, horaIngreso: true, horaInicio: true, horaSalida: true, marca: true,
          catalogo: { select: { nombre: true, categoria: true, tiempoEstimadoMin: true } },
          bahia: { select: { id: true, nombre: true, agencia: { select: { nombre: true } } } },
          consumos: { select: { cantidadUsada: true, insumo: { select: { costoUnitarioUSD: true } } } },
        },
      }),
      this.prisma.servicioLavado.count({ where: servicioWhere }),
      this.prisma.incidenteTecnico.count({ where: { estado: { notIn: ['RESUELTO', 'CANCELADO'] }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) } }),
      this.prisma.alertaStock.findMany({
        where: {
          estado: { notIn: ['RESUELTO', 'DESPACHADO'] },
          ...(hayFiltro ? { agencia: filtro } : {}),
          ...(dto.pulidorId ? { pulidorId: dto.pulidorId } : {}),
        },
        orderBy: { createdAt: 'desc' }, take: 10,
        include: { agencia: { select: { nombre: true, region: true } }, pulidor: { select: { name: true, lastname: true } }, insumo: { select: { nombre: true } } },
      }),
      this.prisma.maquinaria.groupBy({ by: ['estadoOperativo'], _count: { id: true }, where: alcanceMaq }),
      this.prisma.incidenteTecnico.findMany({ where: { createdAt: { gte: hace30Dias }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) }, include: { maquinaria: { select: { codigo: true, nombre: true, tipo: true, agencia: { select: { nombre: true } } } } } }),
      // Alertas operativas de mantenimiento: incidentes abiertos.
      this.prisma.incidenteTecnico.findMany({
        where: { estado: { in: ['ABIERTO', 'EN_PROCESO'] }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
        orderBy: { createdAt: 'desc' }, take: 15,
        select: { id: true, titulo: true, gravedad: true, createdAt: true, maquinaria: { select: { codigo: true, nombre: true, agencia: { select: { nombre: true, region: true } } } } },
      }),
      // Alertas operativas de mantenimiento: preventivos vencidos (programados y aún pendientes).
      this.prisma.mantenimientoMaquinaria.findMany({
        where: { estado: 'PENDIENTE', fechaProgramada: { lt: new Date() }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
        orderBy: { fechaProgramada: 'asc' }, take: 15,
        select: { id: true, tipo: true, fechaProgramada: true, maquinaria: { select: { codigo: true, nombre: true, agencia: { select: { nombre: true, region: true } } } } },
      }),
    ]);

    const estadosCount: Record<string, number> = { EN_ESPERA: 0, EN_PROCESO: 0, FINALIZADO: 0, CANCELADO: 0 };
    let tiempoTotalMinutos = 0, serviciosFinalizadosConTiempo = 0, costoTotalQuimicosUSD = 0;
    // Cumplimiento de tiempos (SLA): se compara el tiempo real contra el estimado del catálogo.
    let slaTotal = 0, slaCumplen = 0, desviacionTotalMin = 0;
    const bahiasStats: Record<string, { id: string; nombre: string; total: number; tiempoTotalMin: number; finalizados: number }> = {};
    const mixServicios: Record<string, number> = {};
    const topMarcas: Record<string, number> = {};
    const flujoHorario: Record<string, number> = {};
    for (let i = 7; i <= 21; i++) flujoHorario[`${i.toString().padStart(2, '0')}:00`] = 0;

    for (const s of serviciosHoy) {
      estadosCount[s.estado] = (estadosCount[s.estado] || 0) + 1;
      const time = s.horaInicio || s.horaIngreso;
      if (time) { const key = `${new Date(time).getHours().toString().padStart(2, '0')}:00`; flujoHorario[key] = (flujoHorario[key] || 0) + 1; }
      if (s.catalogo?.nombre) mixServicios[s.catalogo.nombre] = (mixServicios[s.catalogo.nombre] || 0) + 1;
      if (s.marca) topMarcas[s.marca] = (topMarcas[s.marca] || 0) + 1;

      let duracionMin = 0;
      if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) {
        const inicio = s.horaInicio || s.horaIngreso;
        duracionMin = Math.max(0, Math.round((new Date(s.horaSalida).getTime() - new Date(inicio).getTime()) / 60000));
        tiempoTotalMinutos += duracionMin; serviciosFinalizadosConTiempo++;
        const estimado = Number(s.catalogo?.tiempoEstimadoMin || 0);
        if (estimado > 0) {
          slaTotal++; desviacionTotalMin += duracionMin - estimado;
          if (duracionMin <= estimado) slaCumplen++;
        }
      }
      for (const c of s.consumos || []) costoTotalQuimicosUSD += Number(c.cantidadUsada || 0) * Number(c.insumo?.costoUnitarioUSD || 0);
      if (s.bahia) {
        if (!bahiasStats[s.bahia.id]) {
          // El nombre incluye la agencia de origen para saber de dónde proviene cada bahía.
          const origen = s.bahia.agencia?.nombre ? ` · ${s.bahia.agencia.nombre}` : '';
          bahiasStats[s.bahia.id] = { id: s.bahia.id, nombre: `${s.bahia.nombre}${origen}`, total: 0, tiempoTotalMin: 0, finalizados: 0 };
        }
        bahiasStats[s.bahia.id].total++;
        if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) { bahiasStats[s.bahia.id].finalizados++; bahiasStats[s.bahia.id].tiempoTotalMin += duracionMin; }
      }
    }

    const tiempoPromedioMin = serviciosFinalizadosConTiempo > 0 ? Math.round(tiempoTotalMinutos / serviciosFinalizadosConTiempo) : 0;
    const distribucionBahias = Object.values(bahiasStats).map(b => ({ nombre: b.nombre, total: b.total })).sort((a, b) => b.total - a.total).slice(0, 7);
    const tiemposBahias = Object.values(bahiasStats).filter(b => b.finalizados > 0).map(b => ({ nombre: b.nombre, promedio: Math.round(b.tiempoTotalMin / b.finalizados) })).sort((a, b) => a.promedio - b.promedio).slice(0, 7);
    // Serie unificada: cantidad de lavados + tiempo promedio por bahía (con su agencia de origen).
    const bahias = Object.values(bahiasStats)
      .map(b => ({ nombre: b.nombre, cantidad: b.total, tiempoPromedioMin: b.finalizados > 0 ? Math.round(b.tiempoTotalMin / b.finalizados) : 0 }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 8);
    const bahiaMasActiva = distribucionBahias[0] || { nombre: 'Sin actividad', total: 0 };
    const flujoArr = Object.keys(flujoHorario).sort().map(hora => ({ hora, cantidad: flujoHorario[hora] }));

    const maquinasDañadas: Record<string, { nombre: string; total: number }> = {};
    const agenciasIncidentes: Record<string, { nombre: string; total: number }> = {};
    const incidentesPorTipo: Record<string, number> = {};
    for (const inc of todosIncidentes30Dias) {
      if (inc.maquinaria) {
        const mKey = `${inc.maquinaria.codigo} - ${inc.maquinaria.nombre}`;
        maquinasDañadas[mKey] = { nombre: mKey, total: (maquinasDañadas[mKey]?.total || 0) + 1 };
        incidentesPorTipo[inc.maquinaria.tipo || 'Desconocido'] = (incidentesPorTipo[inc.maquinaria.tipo || 'Desconocido'] || 0) + 1;
        const aKey = inc.maquinaria.agencia?.nombre || 'Desconocida';
        agenciasIncidentes[aKey] = { nombre: aKey, total: (agenciasIncidentes[aKey]?.total || 0) + 1 };
      }
    }
    const topMaquinasDañadas = Object.values(maquinasDañadas).sort((a, b) => b.total - a.total).slice(0, 5);
    const topAgenciasIncidentes = Object.values(agenciasIncidentes).sort((a, b) => b.total - a.total).slice(0, 5);

    return {
      success: true,
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      isSupervisorView,
      kpis: {
        totalLavadosHoy, lavadosFinalizados: estadosCount['FINALIZADO'] || 0, lavadosEnProceso: estadosCount['EN_PROCESO'] || 0,
        lavadosEnEspera: estadosCount['EN_ESPERA'] || 0, lavadosCancelados: estadosCount['CANCELADO'] || 0,
        cumplimientoSlaPct: slaTotal > 0 ? Math.round((slaCumplen / slaTotal) * 100) : null,
        desviacionPromedioMin: slaTotal > 0 ? Math.round(desviacionTotalMin / slaTotal) : null,
        tiempoPromedioMin, costoQuimicosTotalUSD: Number(costoTotalQuimicosUSD.toFixed(2)), bahiaMasActiva,
        incidentesAbiertos, alertasStockPendientes: alertasPendientes.length,
        alertasCriticas: alertasPendientes.filter(a => a.nivel === 'CRITICO').length,
      },
      flujoHorario: flujoArr,
      bahias,
      distribucionBahias,
      tiemposBahias,
      topMaquinasDañadas,
      topAgenciasIncidentes,
      mixServicios: Object.keys(mixServicios).map(k => ({ nombre: k, cantidad: mixServicios[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 6),
      topMarcas: Object.keys(topMarcas).map(k => ({ nombre: k, cantidad: topMarcas[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5),
      incidentesPorTipo: Object.keys(incidentesPorTipo).map(k => ({ nombre: k, cantidad: incidentesPorTipo[k] })),
      // Alertas operativas unificadas: stock + mantenimiento (incidentes abiertos y preventivos vencidos).
      alertasOperativas: [
        ...alertasPendientes.map(a => ({
          grupo: 'stock' as const,
          severidad: (a.nivel === 'CRITICO' || a.nivel === 'AGOTADO') ? 'critica' : (a.nivel === 'BAJO' ? 'advertencia' : 'info'),
          titulo: `Stock ${a.nivel}`,
          detalle: a.insumo?.nombre || 'Insumo',
          origen: a.agencia?.nombre || (a.pulidor ? `${a.pulidor.name} ${a.pulidor.lastname}` : null),
          region: a.agencia?.region || null,
          nivel: a.nivel as string,
          estado: a.estado as string,
          fecha: a.createdAt,
        })),
        ...incidentesActivosList.map(i => ({
          grupo: 'mantenimiento' as const,
          severidad: (i.gravedad === 'CRITICA' || i.gravedad === 'ALTA') ? 'critica' : (i.gravedad === 'MEDIA' ? 'advertencia' : 'info'),
          titulo: `Incidente ${i.gravedad}`,
          detalle: i.titulo,
          origen: i.maquinaria ? `${i.maquinaria.codigo} · ${i.maquinaria.nombre}` : null,
          region: i.maquinaria?.agencia?.region || null,
          nivel: 'INCIDENTE',
          estado: 'ABIERTO',
          fecha: i.createdAt,
        })),
        ...mantenimientosVencidos.map(m => ({
          grupo: 'mantenimiento' as const,
          severidad: 'advertencia' as const,
          titulo: 'Mantenimiento vencido',
          detalle: `${m.maquinaria?.nombre ?? 'Máquina'} (${m.tipo})`,
          origen: m.maquinaria ? `${m.maquinaria.codigo} · ${m.maquinaria.nombre}` : null,
          region: m.maquinaria?.agencia?.region || null,
          nivel: 'VENCIDO',
          estado: 'PENDIENTE',
          fecha: m.fechaProgramada,
        })),
      ],
      alertasRecientes: alertasPendientes.map(a => ({ id: a.id, mensaje: a.mensaje, nivel: a.nivel, createdAt: a.createdAt, agencia: a.agencia?.nombre, pulidor: a.pulidor ? `${a.pulidor.name} ${a.pulidor.lastname}` : null })),
      distribucionEstados: estadosCount,
      maquinariasPorEstado: maquinariasStats.reduce((acc, curr) => { acc[curr.estadoOperativo] = curr._count.id; return acc; }, {} as Record<string, number>),
    };
  }

  async getConsumoQuimicos(dto: ConsumoQuimicosAnalyticsDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    let fechaHasta = ahora;
    if (dto.fechaHasta) { fechaHasta = new Date(dto.fechaHasta); if (dto.fechaHasta.length <= 10) fechaHasta.setUTCHours(23, 59, 59, 999); }
    const where: any = { createdAt: { gte: fechaDesde, lte: fechaHasta } };
    if (hayFiltro) { const agencias = await this.prisma.agencia.findMany({ where: filtro as any, select: { id: true } }); where.agenciaId = { in: agencias.map(a => a.id) }; }

    const consumos = await this.prisma.consumoServicio.findMany({
      where, include: {
        insumo: { select: { id: true, codigoSKU: true, nombre: true, categoria: true, costoUnitarioUSD: true, unidadMedida: { select: { simbolo: true } } } },
        servicio: { select: { bahia: { select: { agencia: { select: { nombre: true } } } } } },
      },
    });

    const acumuladoPorInsumo: Record<string, any> = {};
    const consumoPorAgencia: Record<string, number> = {};
    const consumoPorCategoria: Record<string, number> = {};
    let granTotalCostoUSD = 0;

    for (const c of consumos) {
      const cant = Number(c.cantidadUsada);
      const costoUnit = Number(c.insumo.costoUnitarioUSD || 0);
      const costoSubtotal = cant * costoUnit;
      granTotalCostoUSD += costoSubtotal;
      const agenciaKey = c.servicio?.bahia?.agencia?.nombre || 'Agencia General';
      consumoPorAgencia[agenciaKey] = (consumoPorAgencia[agenciaKey] || 0) + cant;
      consumoPorCategoria[c.insumo.categoria || 'Sin Categoría'] = (consumoPorCategoria[c.insumo.categoria || 'Sin Categoría'] || 0) + cant;
      if (!acumuladoPorInsumo[c.insumoId]) acumuladoPorInsumo[c.insumoId] = { insumoId: c.insumoId, codigoSKU: c.insumoSKU || c.insumo.codigoSKU, nombre: c.insumoNombre || c.insumo.nombre, categoria: c.insumo.categoria, simboloUnidad: c.unidadSimbolo || c.insumo.unidadMedida?.simbolo || 'u', cantidadTotal: 0, costoUnitario: costoUnit, costoTotalUSD: 0, vecesConsumido: 0, agencias: {} };
      acumuladoPorInsumo[c.insumoId].cantidadTotal += cant;
      acumuladoPorInsumo[c.insumoId].costoTotalUSD += costoSubtotal;
      acumuladoPorInsumo[c.insumoId].vecesConsumido++;
      acumuladoPorInsumo[c.insumoId].agencias[agenciaKey] = (acumuladoPorInsumo[c.insumoId].agencias[agenciaKey] || 0) + cant;
    }

    const listaOrdenada = Object.values(acumuladoPorInsumo).map(item => {
      const topAgencia = Object.keys(item.agencias).sort((a, b) => item.agencias[b] - item.agencias[a])[0];
      const sufijoAgencia = topAgencia && topAgencia !== 'Agencia General' ? ` (${topAgencia})` : '';
      return { 
        ...item, 
        nombre: `${item.nombre}${sufijoAgencia}`,
        cantidadTotal: Number(item.cantidadTotal.toFixed(3)), 
        costoTotalUSD: Number(item.costoTotalUSD.toFixed(2)) 
      };
    }).sort((a, b) => b.costoTotalUSD - a.costoTotalUSD);

    // Serie temporal de costo, agrupada según lo pidió el cliente (para graficar la evolución del consumo).
    const agrupacion = dto.agrupacion ?? 'DIA';
    const costoPorPeriodo: Record<string, number> = {};
    for (const c of consumos) {
      const periodo = this.clavePeriodo(c.createdAt, agrupacion);
      costoPorPeriodo[periodo] = (costoPorPeriodo[periodo] || 0) + Number(c.cantidadUsada) * Number(c.insumo.costoUnitarioUSD || 0);
    }
    const serie = Object.keys(costoPorPeriodo).sort().map((periodo) => ({ periodo, costoUSD: Number(costoPorPeriodo[periodo].toFixed(2)) }));

    return { success: true, rango: { desde: fechaDesde.toISOString().split('T')[0], hasta: fechaHasta.toISOString().split('T')[0] }, agrupacion, granTotalCostoUSD: Number(granTotalCostoUSD.toFixed(2)), totalInsumosDistintos: listaOrdenada.length, insumos: listaOrdenada, serie, consumoPorAgencia: Object.keys(consumoPorAgencia).map(k => ({ nombre: k, costo: Number(consumoPorAgencia[k].toFixed(2)) })).sort((a, b) => b.costo - a.costo).slice(0, 5), consumoPorCategoria: Object.keys(consumoPorCategoria).map(k => ({ nombre: k, cantidad: Number(consumoPorCategoria[k].toFixed(2)) })) };
  }

  /** Clave de agrupación temporal (día, semana ISO o mes) para las series de analítica. */
  private clavePeriodo(fecha: Date, agrupacion: 'DIA' | 'SEMANA' | 'MES'): string {
    const y = fecha.getUTCFullYear();
    const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
    if (agrupacion === 'MES') return `${y}-${m}`;
    if (agrupacion === 'SEMANA') {
      const d = new Date(Date.UTC(y, fecha.getUTCMonth(), fecha.getUTCDate()));
      const dow = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dow);
      const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86400000 + 1) / 7);
      return `${d.getUTCFullYear()}-S${String(semana).padStart(2, '0')}`;
    }
    return `${y}-${m}-${String(fecha.getUTCDate()).padStart(2, '0')}`;
  }

  async getRankingLavadores(dto: RankingLavadoresDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    let fechaHasta = ahora;
    if (dto.fechaHasta) { fechaHasta = new Date(dto.fechaHasta); if (dto.fechaHasta.length <= 10) fechaHasta.setUTCHours(23, 59, 59, 999); }
    const where: any = { estado: { in: [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO] }, horaIngreso: { gte: fechaDesde, lte: fechaHasta } };
    if (hayFiltro) where.bahia = { agencia: filtro };

    const servicios = await this.prisma.servicioLavado.findMany({ where, select: { operadorId: true, horaIngreso: true, horaSalida: true, operador: { select: { id: true, name: true, lastname: true } } } });
    const acumulado: Record<string, any> = {};
    for (const s of servicios) {
      if (!s.operadorId) continue;
      if (!acumulado[s.operadorId]) acumulado[s.operadorId] = { operadorId: s.operadorId, nombre: s.operador ? `${s.operador.name} ${s.operador.lastname}` : 'Operador', cantidadServicios: 0, tiempoTotalMin: 0, serviciosConTiempo: 0 };
      acumulado[s.operadorId].cantidadServicios++;
      if (s.horaSalida) { acumulado[s.operadorId].tiempoTotalMin += Math.max(0, Math.round((new Date(s.horaSalida).getTime() - new Date(s.horaIngreso).getTime()) / 60000)); acumulado[s.operadorId].serviciosConTiempo++; }
    }
    const ranking = Object.values(acumulado).map(a => ({ operadorId: a.operadorId, nombre: a.nombre, cantidadServicios: a.cantidadServicios, tiempoPromedioMin: a.serviciosConTiempo > 0 ? Math.round(a.tiempoTotalMin / a.serviciosConTiempo) : 0 })).sort((a, b) => b.cantidadServicios - a.cantidadServicios || a.tiempoPromedioMin - b.tiempoPromedioMin).slice(0, 10);
    return { success: true, rango: { desde: fechaDesde.toISOString().split('T')[0], hasta: fechaHasta.toISOString().split('T')[0] }, ranking };
  }

  async getRankingPulidores(dto: RankingLavadoresDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    let fechaHasta = ahora;
    if (dto.fechaHasta) { fechaHasta = new Date(dto.fechaHasta); if (dto.fechaHasta.length <= 10) fechaHasta.setUTCHours(23, 59, 59, 999); }
    const where: any = { estado: { in: [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO] }, horaIngreso: { gte: fechaDesde, lte: fechaHasta } };
    if (hayFiltro) where.bahia = { agencia: filtro };

    const servicios = await this.prisma.servicioLavado.findMany({ 
      where, 
      select: { 
        operadorId: true, 
        precio: true,
        operador: { select: { id: true, name: true, lastname: true, agenciaId: true, role: { select: { namerol: true } } } } 
      } 
    });

    const acumulado: Record<string, any> = {};
    for (const s of servicios) {
      if (!s.operadorId || !s.operador || s.operador.role.namerol !== 'PULIDOR') continue;
      if (!acumulado[s.operadorId]) acumulado[s.operadorId] = { 
        operadorId: s.operadorId, 
        nombre: `${s.operador.name} ${s.operador.lastname}`, 
        esFijo: s.operador.agenciaId !== null,
        cantidadServicios: 0, 
        dineroTotal: 0 
      };
      acumulado[s.operadorId].cantidadServicios++;
      if (s.precio) { acumulado[s.operadorId].dineroTotal += Number(s.precio); }
    }
    
    const rankingFijos = Object.values(acumulado).filter(a => a.esFijo).map(a => ({ ...a, dineroTotal: Number(a.dineroTotal.toFixed(2)) })).sort((a, b) => b.cantidadServicios - a.cantidadServicios || b.dineroTotal - a.dineroTotal).slice(0, 10);
    const rankingMoviles = Object.values(acumulado).filter(a => !a.esFijo).map(a => ({ ...a, dineroTotal: Number(a.dineroTotal.toFixed(2)) })).sort((a, b) => b.cantidadServicios - a.cantidadServicios || b.dineroTotal - a.dineroTotal).slice(0, 10);
    
    return { success: true, rankingFijos, rankingMoviles };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD TALLER: Coordinador Mantenimiento + Técnico
  // Datos reales: incidentes, mantenimientos, maquinaria, costos de reparación
  // ═══════════════════════════════════════════════════════════════════════
  async getDashboardTaller(dto: DashboardDedicadoDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const maqWhere = hayFiltro ? { agencia: filtro } : {};
    const incWhere: any = { ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) };
    const { desde: startOfDay } = this.resolverPeriodo(dto);
    const hace30Dias = startOfDay;

    const [maquinarias, incidentesActivos, incidentes30Dias, mantenimientos30Dias, proxMantenimientos] = await Promise.all([
      // Estado actual del parque de maquinaria
      this.prisma.maquinaria.findMany({
        where: maqWhere,
        select: { id: true, nombre: true, codigo: true, tipo: true, estadoOperativo: true, agencia: { select: { nombre: true } } }
      }),
      // Incidentes abiertos ahora mismo
      this.prisma.incidenteTecnico.count({ where: { estado: { in: ['ABIERTO', 'EN_PROCESO'] }, ...incWhere } }),
      // Incidentes de los últimos 30 días con datos de tiempo y costo
      this.prisma.incidenteTecnico.findMany({
        where: { createdAt: { gte: hace30Dias }, ...incWhere },
        select: {
          id: true, titulo: true, gravedad: true, estado: true, costoTotal: true,
          fechaReporte: true, fechaSolucion: true, createdAt: true,
          maquinaria: { select: { nombre: true, codigo: true, tipo: true } }
        }
      }),
      // Mantenimientos ejecutados en 30 días
      this.prisma.mantenimientoMaquinaria.findMany({
        where: { createdAt: { gte: hace30Dias }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
        select: { tipo: true, estado: true, costoTotal: true, fechaEjecucion: true, proximoMantenimiento: true, maquinaria: { select: { nombre: true, tipo: true } } }
      }),
      // Próximos mantenimientos preventivos programados
      this.prisma.mantenimientoMaquinaria.findMany({
        where: { estado: 'PENDIENTE', fechaProgramada: { gte: startOfDay }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
        orderBy: { fechaProgramada: 'asc' },
        take: 5,
        select: { tipo: true, fechaProgramada: true, maquinaria: { select: { nombre: true, codigo: true } } }
      }),
    ]);

    // Estado del parque
    const estadoMaq: Record<string, number> = { OPERATIVA: 0, EN_MANTENIMIENTO: 0, FUERA_SERVICIO: 0, BAJA: 0 };
    const tipoMaq: Record<string, number> = {};
    for (const m of maquinarias) {
      const est = m.estadoOperativo || 'OPERATIVA';
      estadoMaq[est] = (estadoMaq[est] || 0) + 1;
      tipoMaq[m.tipo] = (tipoMaq[m.tipo] || 0) + 1;
    }

    // Procesar incidentes 30d
    const gravedadCount: Record<string, number> = { BAJA: 0, MEDIA: 0, ALTA: 0, CRITICA: 0 };
    const estadoIncCount: Record<string, number> = { ABIERTO: 0, EN_PROCESO: 0, RESUELTO: 0, CANCELADO: 0 };
    const maquinaMasProblematica: Record<string, { nombre: string; total: number; costoTotal: number }> = {};
    let costoTotalReparaciones = 0;
    let tiempoTotalResolucionHoras = 0;
    let incidentesResueltos = 0;

    for (const inc of incidentes30Dias) {
      gravedadCount[inc.gravedad] = (gravedadCount[inc.gravedad] || 0) + 1;
      estadoIncCount[inc.estado] = (estadoIncCount[inc.estado] || 0) + 1;
      if (inc.costoTotal) costoTotalReparaciones += Number(inc.costoTotal);
      if (inc.estado === 'RESUELTO' && inc.fechaSolucion) {
        const horas = (new Date(inc.fechaSolucion).getTime() - new Date(inc.fechaReporte).getTime()) / 3600000;
        tiempoTotalResolucionHoras += horas;
        incidentesResueltos++;
      }
      if (inc.maquinaria) {
        const key = `${inc.maquinaria.codigo} · ${inc.maquinaria.nombre}`;
        if (!maquinaMasProblematica[key]) maquinaMasProblematica[key] = { nombre: key, total: 0, costoTotal: 0 };
        maquinaMasProblematica[key].total++;
        if (inc.costoTotal) maquinaMasProblematica[key].costoTotal += Number(inc.costoTotal);
      }
    }

    const tiempoPromedioResolucionHoras = incidentesResueltos > 0 ? Number((tiempoTotalResolucionHoras / incidentesResueltos).toFixed(1)) : 0;
    const topMaquinasProblematicas = Object.values(maquinaMasProblematica).sort((a, b) => b.total - a.total).slice(0, 5);

    // Mantenimientos preventivos vs correctivos
    const tipoMantenimiento: Record<string, number> = { PREVENTIVO: 0, CORRECTIVO: 0 };
    for (const m of mantenimientos30Dias) tipoMantenimiento[m.tipo] = (tipoMantenimiento[m.tipo] || 0) + 1;

    return {
      success: true,
      kpis: {
        totalMaquinaria: maquinarias.length,
        maquinariaOperativa: estadoMaq['OPERATIVA'] || 0,
        maquinariaEnMantenimiento: estadoMaq['EN_MANTENIMIENTO'] || 0,
        maquinariaFueraServicio: (estadoMaq['FUERA_SERVICIO'] || 0) + (estadoMaq['BAJA'] || 0),
        incidentesActivos,
        costoTotalReparaciones: Number(costoTotalReparaciones.toFixed(2)),
        tiempoPromedioResolucionHoras,
        mantenimientosEjecutados30d: mantenimientos30Dias.length,
      },
      estadoParque: Object.keys(estadoMaq).filter(k => estadoMaq[k] > 0).map(k => ({ nombre: k.replace(/_/g, ' '), total: estadoMaq[k] })),
      gravedadIncidentes: Object.keys(gravedadCount).filter(k => gravedadCount[k] > 0).map(k => ({ nombre: k, cantidad: gravedadCount[k] })),
      estadoIncidentes: Object.keys(estadoIncCount).filter(k => estadoIncCount[k] > 0).map(k => ({ nombre: k.replace(/_/g, ' '), cantidad: estadoIncCount[k] })),
      topMaquinasProblematicas,
      tipoMantenimiento: Object.keys(tipoMantenimiento).map(k => ({ nombre: k, cantidad: tipoMantenimiento[k] })),
      distribucionTipoMaquinaria: Object.keys(tipoMaq).map(k => ({ nombre: k, total: tipoMaq[k] })).sort((a, b) => b.total - a.total),
      proxMantenimientos: proxMantenimientos.map(m => ({ nombre: m.maquinaria.nombre, codigo: m.maquinaria.codigo, tipo: m.tipo, fechaProgramada: m.fechaProgramada })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD BODEGA: Coordinador + Asistente de Bodega
  // Datos reales: stock, alertas, movimientos de inventario, despachos pendientes
  // ═══════════════════════════════════════════════════════════════════════
  async getDashboardBodega(dto: DashboardDedicadoDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const hace30Dias = this.resolverPeriodo(dto).desde;

    // El alcance del usuario se resuelve a ids de agencia (y de bodega si hay región) y se aplica a las
    // tres consultas: sin esto, movimientos y stock mostraban datos de agencias fuera del alcance.
    const agenciaIds = hayFiltro
      ? (await this.prisma.agencia.findMany({ where: filtro as any, select: { id: true } })).map((a) => a.id)
      : null;
    const regionId = this.regionDeAlcance(user, dto);
    const bodegaIds = regionId
      ? (await this.prisma.bodega.findMany({ where: { regionId }, select: { id: true } })).map((b) => b.id)
      : [];

    const alertaWhere: any = { estado: { notIn: ['RESUELTO', 'DESPACHADO'] } };
    const movWhere: any = { createdAt: { gte: hace30Dias } };
    let stockWhere: any = { cantidadActual: { gt: 0 } };
    if (agenciaIds) {
      alertaWhere.agenciaId = { in: agenciaIds };
      movWhere.OR = [
        { origenAgenciaId: { in: agenciaIds } },
        { destinoAgenciaId: { in: agenciaIds } },
        ...(bodegaIds.length ? [{ origenBodegaId: { in: bodegaIds } }, { destinoBodegaId: { in: bodegaIds } }] : []),
      ];
      stockWhere = { ...stockWhere, OR: [{ agenciaId: { in: agenciaIds } }, ...(regionId ? [{ bodega: { regionId } }] : [])] };
    }

    const [alertasActivas, movimientos30Dias, stocks] = await Promise.all([
      this.prisma.alertaStock.findMany({
        where: alertaWhere,
        include: { insumo: { select: { nombre: true, categoria: true } }, agencia: { select: { nombre: true } } },
        orderBy: [{ nivel: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.movimientoInventario.findMany({
        where: movWhere,
        select: { tipo: true, estadoDespacho: true, createdAt: true, detalles: { select: { cantidadEnviada: true, costoUnitarioUSD: true, insumo: { select: { nombre: true, categoria: true } } } } },
      }),
      this.prisma.stockUbicacion.findMany({
        where: stockWhere,
        include: { insumo: { select: { nombre: true, categoria: true, costoUnitarioUSD: true } } },
      }),
    ]);

    // KPIs alertas
    const alertasCriticas = alertasActivas.filter(a => a.nivel === 'CRITICO' || a.nivel === 'AGOTADO').length;
    const alertasBajas = alertasActivas.filter(a => a.nivel === 'BAJO').length;
    const alertasPorInsumo: Record<string, number> = {};
    for (const a of alertasActivas) {
      const k = a.insumo?.nombre || 'Sin nombre';
      alertasPorInsumo[k] = (alertasPorInsumo[k] || 0) + 1;
    }

    // Movimientos: despachados pendientes, en tránsito, recibidos
    const despachosEstado: Record<string, number> = { PENDIENTE: 0, EN_TRANSITO: 0, RECIBIDO: 0, RECHAZADO: 0 };
    const consumoPorCategoria: Record<string, number> = {};
    const consumoPorInsumo: Record<string, number> = {};
    let valorEnTransito = 0;
    let despachos30d = 0;

    for (const mov of movimientos30Dias) {
      if (mov.tipo === 'DESPACHO_AGENCIA' || mov.tipo === 'DESPACHO_BODEGA') {
        despachosEstado[mov.estadoDespacho] = (despachosEstado[mov.estadoDespacho] || 0) + 1;
        despachos30d++;
        if (mov.estadoDespacho === 'EN_TRANSITO') {
          for (const d of mov.detalles) valorEnTransito += Number(d.cantidadEnviada || 0) * Number(d.costoUnitarioUSD || 0);
        }
      }
      for (const d of mov.detalles) {
        const cantidad = Number(d.cantidadEnviada || 0);
        const cat = d.insumo?.categoria || 'Sin Categoría';
        consumoPorCategoria[cat] = (consumoPorCategoria[cat] || 0) + cantidad;
        const insumo = d.insumo?.nombre || 'Insumo';
        consumoPorInsumo[insumo] = (consumoPorInsumo[insumo] || 0) + cantidad;
      }
    }

    // Rotación real desde bodega: insumos con más unidades despachadas en 30 días.
    const topInsumosConsumo = Object.keys(consumoPorInsumo)
      .map((nombre) => ({ nombre, cantidad: Number(consumoPorInsumo[nombre].toFixed(2)) }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 7);

    // Valor total del stock disponible
    let valorStockUSD = 0;
    for (const s of stocks) valorStockUSD += Number(s.cantidadActual || 0) * Number(s.insumo?.costoUnitarioUSD || 0);

    // Top insumos con alerta
    const topInsumosCriticos = Object.keys(alertasPorInsumo).map(k => ({ nombre: k, alertas: alertasPorInsumo[k] })).sort((a, b) => b.alertas - a.alertas).slice(0, 7);

    return {
      success: true,
      kpis: {
        totalAlertasActivas: alertasActivas.length,
        alertasCriticas,
        alertasBajas,
        despachosEnTransito: despachosEstado['EN_TRANSITO'] || 0,
        despachosPendientes: despachosEstado['PENDIENTE'] || 0,
        despachos30d,
        valorEnTransitoUSD: Number(valorEnTransito.toFixed(2)),
        valorStockUSD: Number(valorStockUSD.toFixed(2)),
      },
      topInsumosCriticos,
      topInsumosConsumo,
      despachosEstado: Object.keys(despachosEstado).filter(k => despachosEstado[k] > 0).map(k => ({ nombre: k.replace(/_/g, ' '), cantidad: despachosEstado[k] })),
      consumoPorCategoria: Object.keys(consumoPorCategoria).map(k => ({ nombre: k, cantidad: Number(consumoPorCategoria[k].toFixed(2)) })).sort((a, b) => b.cantidad - a.cantidad),
      nivelAlertas: [
        { nombre: 'CRÍTICO/AGOTADO', cantidad: alertasCriticas },
        { nombre: 'BAJO', cantidad: alertasBajas },
      ].filter(x => x.cantidad > 0),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD ESPECIALES: Coordinador + Pulidor de Servicios Especiales
  // Datos reales: ServicioEspecial, tiempos efectivos, estados, tipos, calidad
  // ═══════════════════════════════════════════════════════════════════════
  async getDashboardEspeciales(dto: DashboardDedicadoDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const { desde: startOfDay, hasta: endOfDay } = this.resolverPeriodo(dto);
    const hace30Dias = startOfDay;

    const seWhere: any = { deletedAt: null, ...(hayFiltro ? { agencia: filtro } : {}) };

    const [serviciosHoy, servicios30Dias, serviciosPendientes] = await Promise.all([
      this.prisma.servicioEspecial.findMany({
        where: { ...seWhere, createdAt: { gte: startOfDay, lte: endOfDay } },
        select: { estado: true, tipoServicio: true, tiempoEfectivoSeg: true, calificacionCalidad: true, precio: true, prioridad: true },
      }),
      this.prisma.servicioEspecial.findMany({
        where: { ...seWhere, createdAt: { gte: hace30Dias } },
        select: {
          estado: true, tipoServicio: true, tiempoEfectivoSeg: true,
          calificacionCalidad: true, precio: true, prioridad: true,
          createdAt: true, fechaFin: true,
          operador: { select: { id: true, name: true, lastname: true, agenciaId: true } },
        },
      }),
      this.prisma.servicioEspecial.findMany({
        where: { ...seWhere, estado: { in: ['Pendiente', 'En Proceso'] } },
        select: { estado: true, prioridad: true, tipoServicio: true, placa: true, clienteNombre: true, fechaProgramada: true },
        orderBy: [{ prioridad: 'desc' }, { fechaProgramada: 'asc' }],
        take: 10,
      }),
    ]);

    // KPIs del día
    const estadosHoy: Record<string, number> = { Pendiente: 0, 'En Proceso': 0, Completado: 0, Cancelado: 0 };
    for (const s of serviciosHoy) estadosHoy[s.estado] = (estadosHoy[s.estado] || 0) + 1;
    const ingresoHoy = serviciosHoy.filter(s => s.estado === 'Completado').reduce((sum, s) => sum + Number(s.precio || 0), 0);

    // Métricas de 30 días
    const tipoServicioCount: Record<string, number> = {};
    const prioridadCount: Record<string, number> = {};
    const calificaciones: number[] = [];
    const operadoresCount: Record<string, number> = {};
    const pulidoresFijos: Record<string, { nombre: string; servicios: number; ingresos: number }> = {};
    const pulidoresMoviles: Record<string, { nombre: string; servicios: number; ingresos: number }> = {};
    let tiempoEfectivoTotal = 0; let serviciosConTiempo = 0;
    let ingresoTotal30d = 0;
    const flujoDiario: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      flujoDiario[d.toISOString().split('T')[0]] = 0;
    }

    for (const s of servicios30Dias) {
      tipoServicioCount[s.tipoServicio] = (tipoServicioCount[s.tipoServicio] || 0) + 1;
      prioridadCount[s.prioridad] = (prioridadCount[s.prioridad] || 0) + 1;
      if (s.calificacionCalidad) calificaciones.push(s.calificacionCalidad);
      if (s.tiempoEfectivoSeg) { tiempoEfectivoTotal += s.tiempoEfectivoSeg; serviciosConTiempo++; }
      if (s.estado === 'Completado') ingresoTotal30d += Number(s.precio || 0);
      if (s.operador) {
        const k = `${s.operador.name} ${s.operador.lastname}`;
        operadoresCount[k] = (operadoresCount[k] || 0) + 1;
        // Fijo = pulidor con agencia asignada; móvil = sin agencia (opera en su región).
        const bucket = s.operador.agenciaId ? pulidoresFijos : pulidoresMoviles;
        const reg = (bucket[s.operador.id] ??= { nombre: k, servicios: 0, ingresos: 0 });
        reg.servicios += 1;
        if (s.estado === 'Completado') reg.ingresos += Number(s.precio || 0);
      }
      const k = s.createdAt.toISOString().split('T')[0];
      if (flujoDiario[k] !== undefined) flujoDiario[k]++;
    }

    const calificacionPromedio = calificaciones.length > 0 ? Number((calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length).toFixed(1)) : 0;
    const tiempoPromedioMin = serviciosConTiempo > 0 ? Math.round((tiempoEfectivoTotal / serviciosConTiempo) / 60) : 0;

    const topOperadores = Object.keys(operadoresCount).map(k => ({ nombre: k, servicios: operadoresCount[k] })).sort((a, b) => b.servicios - a.servicios).slice(0, 5);
    const aRanking = (rec: Record<string, { nombre: string; servicios: number; ingresos: number }>) =>
      Object.values(rec)
        .map((p) => ({ nombre: p.nombre, servicios: p.servicios, ingresos: Number(p.ingresos.toFixed(2)) }))
        .sort((a, b) => b.servicios - a.servicios)
        .slice(0, 10);
    const pulidores = { fijos: aRanking(pulidoresFijos), moviles: aRanking(pulidoresMoviles) };

    return {
      success: true,
      kpis: {
        serviciosHoy: serviciosHoy.length,
        completadosHoy: estadosHoy['Completado'] || 0,
        enProcesoHoy: estadosHoy['En Proceso'] || 0,
        pendientesHoy: estadosHoy['Pendiente'] || 0,
        ingresoHoy: Number(ingresoHoy.toFixed(2)),
        ingresoTotal30d: Number(ingresoTotal30d.toFixed(2)),
        calificacionPromedio,
        tiempoPromedioMin,
      },
      flujoSemanal: Object.keys(flujoDiario).sort().map(hora => ({ hora, cantidad: flujoDiario[hora] })),
      tipoServicio: Object.keys(tipoServicioCount).map(k => ({ nombre: k, cantidad: tipoServicioCount[k] })).sort((a, b) => b.cantidad - a.cantidad),
      prioridad: Object.keys(prioridadCount).map(k => ({ nombre: k, cantidad: prioridadCount[k] })),
      estadosHoy: Object.keys(estadosHoy).filter(k => estadosHoy[k] > 0).map(k => ({ nombre: k, cantidad: estadosHoy[k] })),
      topOperadores,
      pulidores,
      colaActiva: serviciosPendientes.map(s => ({ placa: s.placa, cliente: s.clienteNombre, tipo: s.tipoServicio, estado: s.estado, prioridad: s.prioridad, fecha: s.fechaProgramada })),
    };
  }
}

