import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DashboardAnalyticsDto,
  DashboardDedicadoDto,
  ConsumoQuimicosAnalyticsDto,
  RankingLavadoresDto,
  RangoAnaliticaDto,
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
        const desde = dto.fechaDesde ? this.fechaLocal(dto.fechaDesde) : (dto.fecha ? this.fechaLocal(dto.fecha) : new Date(ahora.getFullYear(), ahora.getMonth(), 1));
        const hasta = dto.fechaHasta ? this.fechaLocal(dto.fechaHasta) : (dto.fecha ? this.fechaLocal(dto.fecha) : ahora);
        desde.setHours(0, 0, 0, 0);
        if (dto.fechaHasta || dto.fecha) hasta.setHours(23, 59, 59, 999);
        const etiqueta = `${this.aFechaISO(desde)} → ${this.aFechaISO(hasta)}`;
        return { desde, hasta, rango, etiqueta };
      }
      default:
        return { desde: inicioDeHoy, hasta: finDeHoy, rango: 'HOY', etiqueta: 'Hoy' };
    }
  }

  /**
   * Parsea `YYYY-MM-DD` como fecha LOCAL. `new Date('2026-01-01')` se interpreta en UTC, así que en
   * zonas con desplazamiento negativo (Ecuador, UTC-5) el rango «1 a 31 de enero» terminaba consultando
   * «31 de diciembre a 30 de enero». Con la hora explícita el parseo es local y el día no se desplaza.
   */
  private fechaLocal(valor: string): Date {
    return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? new Date(`${valor}T00:00:00`) : new Date(valor);
  }

  /** Fecha en `YYYY-MM-DD` según el calendario local (no usa UTC, que adelanta/atrasa el día). */
  private aFechaISO(fecha: Date): string {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
  }

  /**
   * Acota las consultas de servicios de lavado por tipo de catálogo (GENERAL o ESPECIAL).
   * Es un modificador continuo como las fechas: se combina con región, agencia y pulidor, y no participa
   * del filtro exclusivo de dimensión.
   */
  private filtroCategoria(categoria?: string): Record<string, unknown> {
    return categoria ? { catalogo: { categoria } } : {};
  }

  /**
   * Vincula los incidentes técnicos con un pulidor. Los incidentes se relacionan con la maquinaria
   * (→ agencia → región) y con quien los reporta, así que «incidentes de un pulidor» se resuelve por el
   * reportante: es el único vínculo disponible sin tocar el schema.
   */
  private filtroIncidentePulidor(pulidorId?: string): Record<string, unknown> {
    return pulidorId ? { reportadoPorId: pulidorId } : {};
  }

  /**
   * Periodo de los endpoints que reciben el filtro global con `rango`.
   * Si el cliente no envía `rango` (consumidores antiguos) se conserva el comportamiento previo: el mes
   * en curso, o el rango explícito de fechas. Antes estas consultas ignoraban los presets y devolvían
   * siempre el mes completo aunque el usuario hubiera elegido Hoy, Semana o Año.
   */
  private periodoDeFiltro(dto: RangoAnaliticaDto): { desde: Date; hasta: Date } {
    if (dto.rango) return this.resolverPeriodo(dto);
    const rango: RangoPeriodo = dto.fechaDesde || dto.fechaHasta ? 'RANGO' : 'MES';
    return this.resolverPeriodo({ ...dto, rango });
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
    const hace30Dias = periodo.desde;
    const roleName = rolDeUsuario(user);

    if (roleName === 'APROBADOR') {
      const metricas = await this.getAprobadorMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, dto?.categoriaServicio);
      return { success: true, isAprobadorView: true, metricasAprobaciones: metricas, ...metricas };
    }

    // Roles que ven el dashboard analítico (Super Admin, Admin, Supervisor, Líder, Comerciales)
    let baseMetrics: any;
    const isComercial = roleName === 'COORD_COMERCIAL' || roleName === 'JEFE_COMERCIAL';
    
    if (isComercial) {
      baseMetrics = await this.getComercialMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, dto?.categoriaServicio);
      baseMetrics.isComercialView = true;
    } else {
      const isSupervisorView = roleName === 'SUPERVISOR';
      baseMetrics = await this.getEjecutivoMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, isSupervisorView, dto);
    }

    // Todos los roles de negocio reciben la analítica estratégica y jerárquica (filtrada por su ámbito)
    const isEjecutivo = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'LIDER', 'BACKUP', 'COORD_COMERCIAL', 'JEFE_COMERCIAL'].includes(roleName);
    
    if (isEjecutivo) {
      const globalMetrics = await this.getAdminEstrategicos(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, dto?.pulidorId, dto?.categoriaServicio);
      const jerarquia = await this.getAdminJerarquia(dto, filtro, hayFiltro, startOfDay, endOfDay, user);
      return {
        success: true,
        isSuperAdminView: ['SUPER_ADMIN', 'ADMIN'].includes(roleName),
        isEjecutivoView: true,
        ...baseMetrics,
        ...globalMetrics,
        jerarquia,
        kpis: { ...(baseMetrics.kpis || {}), ...globalMetrics.kpis },
      };
    }
    
    return { success: true, ...baseMetrics };
  }

  // ═══ ADMIN ═══════════════════════════════════════════════════════════
  private async getAdminMetrics(dto: any, filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date, user: any = null) {
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

    const estrategicos = await this.getAdminEstrategicos(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, dto?.pulidorId, dto?.categoriaServicio);
    const jerarquia = await this.getAdminJerarquia(dto, filtro, hayFiltro, startOfDay, endOfDay, user);

    return {
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      ...estrategicos,
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
      jerarquia,
    };
  }

  /**
   * Drill-down jerárquico para el Super Admin: agrupa los servicios del período según la dimensión activa
   * (País → Región → Agencia → Bahía). Se calcula sobre `ServicioLavado`; no requiere cambios de schema.
   */
  private async getAdminJerarquia(
    dto: any,
    filtro: any,
    hayFiltro: boolean,
    desde: Date,
    hasta: Date,
    user: any,
  ) {
    const finalizados: ServiceStatus[] = [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO];
    const where: any = { horaIngreso: { gte: desde, lte: hasta }, estado: { in: finalizados } };
    if (hayFiltro) where.bahia = { agencia: filtro };
    // Filtro por pulidor: acota a los servicios de ese operador (dimensión POLISHER).
    if (dto?.pulidorId) where.operadorId = dto.pulidorId;
    // Filtro por tipo de servicio (generales / especiales), combinable con todo lo anterior.
    if (dto?.categoriaServicio) where.catalogo = { categoria: dto.categoriaServicio };

    const servicios = await this.prisma.servicioLavado.findMany({
      where,
      select: {
        horaIngreso: true, horaInicio: true, horaSalida: true, precio: true,
        operador: { select: { name: true, lastname: true } },
        bahia: { select: { nombre: true, agencia: { select: { id: true, nombre: true, region: true, regionRel: { select: { nombre: true } } } } } },
      },
    });

    const alcance = resolverAlcance(user);
    const esAlcanceAgencia = alcance.tipo === 'AGENCIA' || !!dto?.agenciaId || !!(filtro as any)?.id;
    const dimension: 'GLOBAL' | 'REGION' | 'AGENCY' | 'POLISHER' =
      dto?.pulidorId ? 'POLISHER'
      : esAlcanceAgencia ? 'AGENCY'
      : (alcance.tipo === 'REGION' ? 'REGION'
      : (dto?.regionId ? 'REGION' : 'GLOBAL'));
    // Desglose explícito del gráfico: en nivel de agencia no aplica desglose por Región o Agencia, solo Pulidor si se pide
    let agrupacion: 'REGION' | 'AGENCY' | 'POLISHER' | null = dto?.desglose ?? null;
    if (esAlcanceAgencia && (agrupacion === 'REGION' || agrupacion === 'AGENCY')) {
      agrupacion = null;
    }

    const regionDe = (ag?: any) => ag?.regionRel?.nombre || ag?.region || 'Sin región';
    const operadorDe = (s: typeof servicios[number]) =>
      [s.operador?.name, s.operador?.lastname].filter(Boolean).join(' ').trim() || 'Sin pulidor';
    const claveDe = (s: typeof servicios[number]): string => {
      const ag = s.bahia?.agencia;
      if (esAlcanceAgencia) {
        if (agrupacion === 'POLISHER') return operadorDe(s);
        if (dimension === 'POLISHER') return new Date(s.horaIngreso).toISOString().split('T')[0];
        return s.bahia?.nombre || 'Sin bahía';
      }
      if (agrupacion === 'REGION') return regionDe(ag);
      if (agrupacion === 'AGENCY') return ag?.nombre || 'Sin agencia';
      if (agrupacion === 'POLISHER') return operadorDe(s);
      // Sin desglose explícito, se agrupa según la dimensión activa.
      // Un solo pulidor seleccionado: la vista útil es su evolución diaria, no una única barra.
      if (dimension === 'POLISHER') return new Date(s.horaIngreso).toISOString().split('T')[0];
      if (dimension === 'AGENCY') return s.bahia?.nombre || 'Sin bahía';
      if (dimension === 'REGION') return ag?.nombre || 'Sin agencia';
      return regionDe(ag); // GLOBAL → por región
    };

    const buckets: Record<string, { nombre: string; cantidad: number; tiempoTotalMin: number; finalizados: number; ingresos: number }> = {};
    for (const s of servicios) {
      const b = (buckets[claveDe(s)] ??= { nombre: claveDe(s), cantidad: 0, tiempoTotalMin: 0, finalizados: 0, ingresos: 0 });
      b.cantidad += 1;
      b.ingresos += Number(s.precio || 0);
      const inicio = s.horaInicio || s.horaIngreso;
      if (s.horaSalida && inicio) {
        b.tiempoTotalMin += Math.max(0, (new Date(s.horaSalida).getTime() - new Date(inicio).getTime()) / 60000);
        b.finalizados += 1;
      }
    }

    const desgloseCompleto = Object.values(buckets)
      .map((b) => ({
        nombre: b.nombre,
        cantidad: b.cantidad,
        tiempoPromedioMin: b.finalizados > 0 ? Math.round(b.tiempoTotalMin / b.finalizados) : 0,
        ingresos: Number(b.ingresos.toFixed(2)),
      }))
      .sort((a, b) => b.cantidad - a.cantidad);
    const desglose = desgloseCompleto.slice(0, 12);

    // Serie propia del gráfico de rendimiento: los 10 mayores y los 10 menores por servicios. Se envían los
    // dos extremos porque el gráfico permite alternar Top 5 / Top 10 en orden descendente o ascendente; con
    // solo el top 10, el orden ascendente mentiría al mostrar los menores de ese top y no los reales.
    const extremosGrafico: Record<string, { nombre: string; cantidad: number; tiempoPromedioMin: number; ingresos: number }> = {};
    for (const d of desgloseCompleto.slice(0, 10)) extremosGrafico[d.nombre] = d;
    for (const d of desgloseCompleto.slice(-10)) extremosGrafico[d.nombre] = d;
    const desgloseGrafico = Object.values(extremosGrafico).sort((a, b) => b.cantidad - a.cantidad);

    // Agrupación efectiva del gráfico: el desglose explícito manda; si no, se deriva de la dimensión activa
    // (país → región, región → agencia, agencia → bahía, pulidor → día).
    const agrupacionEfectiva: 'REGION' | 'AGENCY' | 'POLISHER' | 'BAHIA' | 'DIA' =
      esAlcanceAgencia
        ? (agrupacion === 'POLISHER' ? 'POLISHER' : (dimension === 'POLISHER' ? 'DIA' : 'BAHIA'))
        : (agrupacion ?? (dimension === 'GLOBAL' ? 'REGION' : dimension === 'REGION' ? 'AGENCY' : dimension === 'AGENCY' ? 'BAHIA' : 'DIA'));

    // Top vs Bottom y ranking sobre la misma entidad que agrupa el gráfico.
    const entidad = {
      REGION: 'Región', AGENCY: 'Agencia', POLISHER: 'Pulidor', BAHIA: 'Bahía', DIA: 'Día',
    }[agrupacionEfectiva];
    const top = desgloseCompleto.slice(0, 5);
    const bottom = desgloseCompleto.length > 5 ? desgloseCompleto.slice(-5).reverse() : [];

    // Entidades con menos actividad, sobre la MISMA agrupación del gráfico: así el ranking y las barras
    // cuentan la misma historia. Para agencias y bahías se parte del catálogo, de modo que aparezcan también
    // las que no registraron ningún servicio en el período.
    const entidadBaja: 'REGION' | 'AGENCY' | 'POLISHER' | 'BAHIA' | 'DIA' =
      esAlcanceAgencia
        ? (agrupacion === 'POLISHER' ? 'POLISHER' : 'BAHIA')
        : (agrupacion ?? (dimension === 'GLOBAL' || dimension === 'REGION' ? 'AGENCY' : dimension === 'AGENCY' ? 'BAHIA' : 'DIA'));
    const nombreEntidadBaja = { REGION: 'Región', AGENCY: 'Agencia', POLISHER: 'Pulidor', BAHIA: 'Bahía', DIA: 'Día' }[entidadBaja];

    let candidatas = desgloseCompleto.map((d) => d.nombre);
    let metricasBaja = new Map<string, { cantidad: number; tiempoPromedioMin: number }>(
      desgloseCompleto.map((d) => [d.nombre, { cantidad: d.cantidad, tiempoPromedioMin: d.tiempoPromedioMin }]),
    );
    if (entidadBaja === 'AGENCY') {
      if (agrupacionEfectiva !== 'AGENCY') {
        // El gráfico agrupa por región: para saber qué agencia opera menos hay que agregar aparte.
        const porAgencia = new Map<string, { cantidad: number; totalMin: number; finalizados: number }>();
        for (const s of servicios) {
          const nombre = s.bahia?.agencia?.nombre || 'Sin agencia';
          const reg = porAgencia.get(nombre) ?? { cantidad: 0, totalMin: 0, finalizados: 0 };
          reg.cantidad += 1;
          const inicio = s.horaInicio || s.horaIngreso;
          if (s.horaSalida && inicio) {
            reg.totalMin += Math.max(0, (new Date(s.horaSalida).getTime() - new Date(inicio).getTime()) / 60000);
            reg.finalizados += 1;
          }
          porAgencia.set(nombre, reg);
        }
        metricasBaja = new Map(
          [...porAgencia].map(([nombre, v]) => [
            nombre,
            { cantidad: v.cantidad, tiempoPromedioMin: v.finalizados > 0 ? Math.round(v.totalMin / v.finalizados) : 0 },
          ]),
        );
      }
      const agencias = await this.prisma.agencia.findMany({
        where: { estado: 1, tipoUbicacion: 'OPERATIVA', ...(this.filtroAgencia(user, dto) as any) },
        select: { nombre: true },
      });
      candidatas = agencias.map((a) => a.nombre);
    } else if (entidadBaja === 'BAHIA') {
      const agenciaId = (this.filtroAgencia(user, dto) as { id?: string }).id;
      if (agenciaId) {
        const bahias = await this.prisma.bahia.findMany({ where: { agenciaId }, select: { nombre: true } });
        if (bahias.length) candidatas = bahias.map((b) => b.nombre);
      }
    }
    const bajaActividad = candidatas
      .map((nombre) => ({
        nombre,
        cantidad: metricasBaja.get(nombre)?.cantidad ?? 0,
        tiempoPromedioMin: metricasBaja.get(nombre)?.tiempoPromedioMin ?? 0,
      }))
      .sort((a, b) => a.cantidad - b.cantidad || String(a.nombre).localeCompare(String(b.nombre)))
      .slice(0, 5);

    // Heatmap día de la semana × hora de ingreso (identifica horas pico). Rango operativo 07:00–21:00.
    const dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const horas: string[] = [];
    for (let h = 7; h <= 21; h++) horas.push(String(h).padStart(2, '0'));
    const matriz: number[][] = dias.map(() => horas.map(() => 0));
    for (const s of servicios) {
      const f = new Date(s.horaIngreso);
      const dia = (f.getDay() + 6) % 7; // 0 = lunes
      const hora = f.getHours();
      if (hora >= 7 && hora <= 21) matriz[dia][hora - 7] += 1;
    }
    const heatmap = { dias, horas, matriz };

    let t = 0, n = 0;
    for (const b of Object.values(buckets)) { t += b.tiempoTotalMin; n += b.finalizados; }

    return {
      dimension,
      agrupacion: agrupacionEfectiva,
      titulo: esAlcanceAgencia ? (agrupacion === 'POLISHER' ? 'Rendimiento por Pulidor' : 'Rendimiento por Bahía de Trabajo') : agrupacion === 'REGION' ? 'Rendimiento Operativo Nacional por Región'
        : agrupacion === 'AGENCY' ? 'Rendimiento Operativo Nacional por Agencia'
        : agrupacion === 'POLISHER' ? 'Rendimiento Operativo por Pulidor'
        : dimension === 'GLOBAL'
          ? 'Rendimiento Operativo Nacional por Región'
          : dimension === 'REGION'
            ? 'Análisis Comparativo de Agencias en la Región'
            : dimension === 'AGENCY'
              ? 'Rendimiento por Bahía de Trabajo'
              : 'Evolución Diaria del Pulidor',
      entidad,
      desglose,
      desgloseGrafico,
      ranking: { entidad, top, bottom },
      bajaActividad: { entidad: nombreEntidadBaja, items: bajaActividad },
      heatmap,
      kpis: {
        registros: servicios.length,
        tiempoPromedioMin: n > 0 ? Math.round(t / n) : 0,
        ingresos: Number(servicios.reduce((sum, s) => sum + Number(s.precio || 0), 0).toFixed(2)),
      },
    };
  }

  /**
   * KPIs estratégicos de la red (visión 360° del Admin): ingresos, ticket, crecimiento, productividad
   * nacional, costo de reparaciones y valor del inventario. Todo el país, sin filtro de alcance.
   */
  private async getAdminEstrategicos(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date, pulidorId?: string, categoriaServicio?: string) {
    const inicioMes = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
    const inicioMesAnterior = new Date(startOfDay.getFullYear(), startOfDay.getMonth() - 1, 1);
    const finalizados: ServiceStatus[] = [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO];

    const whereServicios: any = { horaIngreso: { gte: startOfDay, lte: endOfDay }, estado: { in: finalizados } };
    const whereServiciosMes: any = { horaIngreso: { gte: inicioMes, lte: endOfDay }, estado: { in: finalizados } };
    const whereServiciosAnt: any = { horaIngreso: { gte: inicioMesAnterior, lt: inicioMes }, estado: { in: finalizados } };
    
    if (hayFiltro) {
      whereServicios.bahia = { agencia: filtro };
      whereServiciosMes.bahia = { agencia: filtro };
      whereServiciosAnt.bahia = { agencia: filtro };
    }
    // El filtro por pulidor también acota los KPIs estratégicos al operador elegido.
    if (pulidorId) {
      whereServicios.operadorId = pulidorId;
      whereServiciosMes.operadorId = pulidorId;
      whereServiciosAnt.operadorId = pulidorId;
    }
    // Tipo de servicio (generales / especiales): aplica a los tres periodos comparados.
    if (categoriaServicio) {
      for (const w of [whereServicios, whereServiciosMes, whereServiciosAnt]) w.catalogo = { categoria: categoriaServicio };
    }

    const whereIncidentes = { createdAt: { gte: hace30Dias, lte: endOfDay }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}), ...this.filtroIncidentePulidor(pulidorId) };
    const whereMantenimientos = { fechaEjecucion: { gte: hace30Dias, lte: endOfDay }, estado: 'FINALIZADO', ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) };

    const [
      ingresoPeriodoAgg, ingresoMesAgg, ingresoMesAnteriorAgg,
      completadosPeriodo, completadosMes, serviciosPeriodo,
      incidentesPeriodo, mantenimientosPeriodo, stocks, movEnTransito,
    ] = await Promise.all([
      this.prisma.servicioLavado.aggregate({ _sum: { precio: true }, where: whereServicios }),
      this.prisma.servicioLavado.aggregate({ _sum: { precio: true }, where: whereServiciosMes }),
      this.prisma.servicioLavado.aggregate({ _sum: { precio: true }, where: whereServiciosAnt }),
      this.prisma.servicioLavado.count({ where: whereServicios }),
      this.prisma.servicioLavado.count({ where: whereServiciosMes }),
      this.prisma.servicioLavado.findMany({
        where: whereServicios,
        select: {
          precio: true, marca: true, modelo: true, color: true, horaInicio: true, horaSalida: true,
          catalogo: { select: { nombre: true, categoria: true } },
          bahia: { select: { nombre: true, agencia: { select: { nombre: true, region: true } } } },
          consumos: { select: { cantidadUsada: true, insumo: { select: { costoUnitarioUSD: true } } } },
        },
      }),
      this.prisma.incidenteTecnico.findMany({
        where: whereIncidentes,
        select: { costoTotal: true, createdAt: true, maquinaria: { select: { bahia: { select: { nombre: true } }, agencia: { select: { nombre: true } } } } },
      }),
      this.prisma.mantenimientoMaquinaria.findMany({
        where: whereMantenimientos as any,
        select: { costoTotal: true, fechaEjecucion: true, maquinaria: { select: { bahia: { select: { nombre: true } }, agencia: { select: { nombre: true } } } } },
      }),
      this.prisma.stockUbicacion.findMany({ select: { cantidadActual: true } }),
      this.prisma.movimientoInventario.findMany({ where: { estadoDespacho: 'EN_TRANSITO' }, select: { detalles: { select: { cantidadEnviada: true } } } }),
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
    const esAlcanceAgencia = hayFiltro && !!(filtro as any)?.id;
    // Unified stats by agency or bay (in agency scope) for times and rentability.
    const agenciaStats: Record<string, { ingresos: number; unidadesInsumos: number; costoIncidentes: number; costoMantenimientos: number; cantidad: number; tiempoTotalMin: number; finalizados: number }> = {};

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

      let unidadesInsumos = 0;
      for (const c of s.consumos || []) unidadesInsumos += Number(c.cantidadUsada || 0);

      const claveEntidad = esAlcanceAgencia ? (s.bahia?.nombre || 'Sin bahía') : (s.bahia?.agencia?.nombre || 'Sin agencia');
      const reg = (agenciaStats[claveEntidad] ??= { ingresos: 0, unidadesInsumos: 0, costoIncidentes: 0, costoMantenimientos: 0, cantidad: 0, tiempoTotalMin: 0, finalizados: 0 });
      reg.ingresos += Number(s.precio || 0); 
      reg.unidadesInsumos += unidadesInsumos; 
      reg.cantidad += 1;
      if (s.horaSalida && duracionMin > 0) { 
        reg.finalizados += 1; 
        reg.tiempoTotalMin += duracionMin; 
      }
    }

    for (const inc of incidentesPeriodo) {
      if (inc.createdAt >= startOfDay && inc.createdAt <= endOfDay) {
        const claveEntidad = esAlcanceAgencia ? (inc.maquinaria?.bahia?.nombre || 'Sin bahía') : (inc.maquinaria?.agencia?.nombre || 'Sin agencia');
        const reg = (agenciaStats[claveEntidad] ??= { ingresos: 0, unidadesInsumos: 0, costoIncidentes: 0, costoMantenimientos: 0, cantidad: 0, tiempoTotalMin: 0, finalizados: 0 });
        reg.costoIncidentes += Number(inc.costoTotal || 0);
      }
    }

    for (const mant of mantenimientosPeriodo) {
      if (mant.fechaEjecucion && mant.fechaEjecucion >= startOfDay && mant.fechaEjecucion <= endOfDay) {
        const claveEntidad = esAlcanceAgencia ? (mant.maquinaria?.bahia?.nombre || 'Sin bahía') : (mant.maquinaria?.agencia?.nombre || 'Sin agencia');
        const reg = (agenciaStats[claveEntidad] ??= { ingresos: 0, unidadesInsumos: 0, costoIncidentes: 0, costoMantenimientos: 0, cantidad: 0, tiempoTotalMin: 0, finalizados: 0 });
        reg.costoMantenimientos += Number(mant.costoTotal || 0);
      }
    }

    const tiempoPromedioServicioMin = serviciosConTiempo > 0 ? Math.round(tiempoTotalMin / serviciosConTiempo) : 0;
    const topAgenciasProductivas = Object.keys(agenciaStats)
      .map((n) => ({ nombre: n, cantidad: agenciaStats[n].cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad).slice(0, 5);
    
    // Rentabilidad unificada: Ingresos - (Incidentes + Mantenimientos). Los insumos NO entran en el monto
    // (no hay costo por unidad base fiable); se reportan en unidades aparte.
    const topAgenciasRentabilidad = Object.keys(agenciaStats)
      .map((n) => {
        const ag = agenciaStats[n];
        const gastosOperativos = ag.costoIncidentes + ag.costoMantenimientos;
        const gananciaNeta = ag.ingresos - gastosOperativos;
        return {
          nombre: n,
          ingresos: Number(ag.ingresos.toFixed(2)),
          gastosOperativos: Number(gastosOperativos.toFixed(2)),
          unidadesInsumos: Number(ag.unidadesInsumos.toFixed(2)),
          costoIncidentes: Number(ag.costoIncidentes.toFixed(2)),
          costoMantenimientos: Number(ag.costoMantenimientos.toFixed(2)),
          gananciaNeta: Number(gananciaNeta.toFixed(2))
        };
      })
      .sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);

    // Resumen de Aprobaciones para el Dashboard Ejecutivo
    const solicitudesHoy = await this.prisma.solicitudAprobacion.findMany({
      where: { createdAt: { gte: startOfDay, lte: endOfDay }, ...(hayFiltro ? { agencia: filtro } : {}) },
      select: { estado: true }
    });
    const pendientesTotal = await this.prisma.solicitudAprobacion.count({
      where: { estado: 'PENDIENTE', ...(hayFiltro ? { agencia: filtro } : {}) }
    });
    
    const aprobadasHoy = solicitudesHoy.filter(s => s.estado === 'APROBADO').length;
    const rechazadasHoy = solicitudesHoy.filter(s => s.estado === 'RECHAZADO').length;
    
    const chartAprobaciones = {
      labels: ['Aprobadas Hoy', 'Rechazadas Hoy', 'Pendientes Totales'],
      datasets: [{
        label: 'Solicitudes',
        data: [aprobadasHoy, rechazadasHoy, pendientesTotal],
        backgroundColor: ['#10B981', '#F43F5E', '#F59E0B'] // verde, rojo, ambar
      }]
    };

    // Tiempos promedio por Agencia (en lugar de por bahía)
    const tiemposAgencias = Object.keys(agenciaStats)
      .map((n) => {
        const ag = agenciaStats[n];
        return { 
          nombre: n, 
          cantidad: ag.cantidad, 
          tiempoPromedioMin: ag.finalizados > 0 ? Math.round(ag.tiempoTotalMin / ag.finalizados) : 0 
        };
      })
      .filter(a => a.cantidad > 0)
      .sort((a, b) => b.cantidad - a.cantidad).slice(0, 8);

    const costoReparacionesTotal = Object.values(agenciaStats).reduce((acc, ag) => acc + ag.costoIncidentes, 0);

    let unidadesInventario = 0;
    for (const s of stocks) unidadesInventario += Number(s.cantidadActual || 0);
    let unidadesEnTransito = 0;
    for (const m of movEnTransito) for (const d of m.detalles) unidadesEnTransito += Number(d.cantidadEnviada || 0);

    const topN = (rec: Record<string, number>, n: number) =>
      Object.keys(rec).map((nombre) => ({ nombre, cantidad: rec[nombre] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, n);

    // Rankings completos por agencia que alimentan el control de orden (Top N, mayor→menor o menor→mayor).
    // Van sin recortar a propósito: sobre un top 5 ya recortado, un orden ascendente solo invertiría esos
    // cinco y mostraría como "menores" a agencias que no lo son. Son ~74 agencias, así que el coste es nulo.
    const rankingsAgencias = {
      servicios: Object.keys(agenciaStats)
        .map((n) => ({ nombre: n, valor: agenciaStats[n].cantidad }))
        .sort((a, b) => b.valor - a.valor),
      ganancia: Object.keys(agenciaStats)
        .map((n) => {
          const ag = agenciaStats[n];
          return { nombre: n, valor: Number((ag.ingresos - ag.costoIncidentes - ag.costoMantenimientos).toFixed(2)) };
        })
        .sort((a, b) => b.valor - a.valor),
      costoIncidentes: Object.keys(agenciaStats)
        .map((n) => ({ nombre: n, valor: Number(agenciaStats[n].costoIncidentes.toFixed(2)) }))
        .sort((a, b) => b.valor - a.valor),
    };

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
        unidadesInventario: Number(unidadesInventario.toFixed(2)),
        unidadesEnTransito: Number(unidadesEnTransito.toFixed(2)),
        gastosOperativosGlobal: Number((costoReparacionesTotal + topAgenciasRentabilidad.reduce((sum, a) => sum + a.costoMantenimientos, 0)).toFixed(2)),
        gananciaNetaGlobal: Number((topAgenciasRentabilidad.reduce((sum, a) => sum + a.gananciaNeta, 0)).toFixed(2))
      },
      topAgenciasProductivas,
      rankingsAgencias,
      mixGenerales: topN(mixGenerales, 5),
      mixEspeciales: topN(mixEspeciales, 5),
      topColores: topN(colores, 5),
      topMarcasModelos: topN(marcasModelos, 5),
      tiemposAgencias,
      topAgenciasRentabilidad,
      chartAprobaciones,
      metricasAprobaciones: await this.getAprobadorMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, categoriaServicio)
    };
  }

  // ═══ APROBADOR ═══════════════════════════════════════════════════════
  private async getAprobadorMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, _hace30Dias: Date, categoriaServicio?: string) {
    const tiposOperativos = ['DESPACHO_QUIMICOS', 'COMPRA_REPUESTO', 'AJUSTE_MERMA'];
    const whereBase = hayFiltro ? { agencia: filtro, tipo: { notIn: tiposOperativos } } : { tipo: { notIn: tiposOperativos } };

    // Los gráficos de distribución, tipos y auditoría SIEMPRE muestran los últimos 7 días completos
    // independientemente del rango de período seleccionado (HOY, SEMANA, MES…).
    // Los KPIs de tarjetas usan solicitudesHoy (startOfDay → endOfDay del período).
    const fechaVentana7d = new Date(endOfDay);
    fechaVentana7d.setDate(fechaVentana7d.getDate() - 6);
    fechaVentana7d.setHours(0, 0, 0, 0);
    // Para períodos más amplios (SEMANA, MES…) se usa la fecha de inicio del período si abarca más de 7 días
    const fechaInicioConsulta = new Date(Math.min(startOfDay.getTime(), fechaVentana7d.getTime()));

    const agenciaIdFilter = hayFiltro ? (filtro?.id || (typeof filtro === 'string' ? filtro : undefined)) : undefined;

    const [todasSolicitudes, solicitudesHoy, anuladasHoy, auditorias] = await Promise.all([
      this.prisma.solicitudAprobacion.findMany({
        where: { createdAt: { gte: fechaInicioConsulta, lte: endOfDay }, ...whereBase },
        select: {
          id: true,
          tipo: true,
          estado: true,
          createdAt: true,
          fechaDecision: true,
          montoUSD: true,
          entidadRefId: true,
          motivoRechazo: true,
          agencia: { select: { nombre: true } },
          solicitante: { select: { name: true, lastname: true } }
        }
      }),
      this.prisma.solicitudAprobacion.findMany({
        where: { createdAt: { gte: startOfDay, lte: endOfDay }, ...whereBase },
        select: { tipo: true, estado: true, montoUSD: true }
      }),
      // Anulaciones de servicios de su alcance registradas hoy
      this.prisma.servicioLavado.count({
        where: { anuladoEn: { gte: startOfDay, lte: endOfDay }, ...(hayFiltro ? { bahia: { agencia: filtro } } : {}), ...this.filtroCategoria(categoriaServicio) }
      }),
      // Auditoría de decisiones en la agencia (siempre últimos 7 días)
      this.prisma.auditoriaDecision?.findMany
        ? this.prisma.auditoriaDecision.findMany({
            where: {
              ...(agenciaIdFilter ? { agenciaId: agenciaIdFilter } : {}),
              createdAt: { gte: fechaInicioConsulta, lte: endOfDay }
            },
            select: { accion: true, motivo: true, createdAt: true }
          })
        : Promise.resolve([] as any[])
    ]);

    const pendientesHoy = solicitudesHoy.filter(s => s.estado === 'PENDIENTE').length;
    const aprobadasHoy = solicitudesHoy.filter(s => s.estado === 'APROBADO').length;
    const rechazadasHoy = solicitudesHoy.filter(s => s.estado === 'RECHAZADO').length;
    const montoAprobadoHoy = solicitudesHoy.filter(s => s.estado === 'APROBADO').reduce((sum, s) => sum + Number(s.montoUSD || 0), 0);

    const flujoEstados: Record<string, { PENDIENTE: number, APROBADO: number, RECHAZADO: number }> = {};
    const ultimoDia = new Date(endOfDay);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(ultimoDia); d.setDate(d.getDate() - i);
      flujoEstados[this.aFechaISO(d)] = { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 };
    }
    for (const s of todasSolicitudes) {
      const k = this.aFechaISO(s.createdAt);
      if (flujoEstados[k] !== undefined && s.estado in flujoEstados[k]) {
        (flujoEstados[k] as any)[s.estado]++;
      }
    }

    const tiposCount: Record<string, number> = {};
    const estadosCount: Record<string, number> = { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 };
    for (const s of todasSolicitudes) {
      tiposCount[s.tipo] = (tiposCount[s.tipo] || 0) + 1;
      if (estadosCount[s.estado] !== undefined) estadosCount[s.estado]++;
    }

    // Descuentos fuera de rango
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

    // Top Agencias y Top Solicitantes
    const agenciasCount: Record<string, number> = {};
    const solicitantesCount: Record<string, number> = {};
    for (const s of todasSolicitudes) {
      if (s.estado === 'APROBADO') {
        if (s.agencia?.nombre) {
          agenciasCount[s.agencia.nombre] = (agenciasCount[s.agencia.nombre] || 0) + 1;
        }
        if (s.solicitante) {
          const nombreCompleto = `${s.solicitante.name} ${s.solicitante.lastname}`.trim();
          solicitantesCount[nombreCompleto] = (solicitantesCount[nombreCompleto] || 0) + 1;
        }
      }
    }

    // SLA / Tiempo promedio de resolución (minutos)
    const decididasConTiempo = todasSolicitudes.filter(s => s.fechaDecision && s.createdAt);
    const tiempoPromedioResolucionMin = decididasConTiempo.length > 0
      ? Math.round(decididasConTiempo.reduce((acc, s) => acc + (new Date(s.fechaDecision!).getTime() - new Date(s.createdAt).getTime()) / 60000, 0) / decididasConTiempo.length)
      : 32;

    const montoAprobadoPeriodo = todasSolicitudes
      .filter(s => s.estado === 'APROBADO')
      .reduce((sum, s) => sum + Number(s.montoUSD || 0), 0);

    const totalDecididas = estadosCount.APROBADO + estadosCount.RECHAZADO;
    const tasaRechazoPct = totalDecididas > 0 ? Number(((estadosCount.RECHAZADO / totalDecididas) * 100).toFixed(1)) : 0;
    const tasaAprobacionPct = totalDecididas > 0 ? Number(((estadosCount.APROBADO / totalDecididas) * 100).toFixed(1)) : 100;

    // Series de Chart.js recicladas de Super Admin / Formato estándar
    const diasLabels = Object.keys(flujoEstados).sort();
    const flujoSolicitudes = {
      labels: diasLabels.map(d => {
        const p = d.split('-');
        return `${p[2]}/${p[1]}`;
      }),
      datasets: [
        { label: 'Aprobadas', data: diasLabels.map(d => flujoEstados[d].APROBADO), backgroundColor: '#10B981' },
        { label: 'Rechazadas', data: diasLabels.map(d => flujoEstados[d].RECHAZADO), backgroundColor: '#F43F5E' },
        { label: 'Pendientes', data: diasLabels.map(d => flujoEstados[d].PENDIENTE), backgroundColor: '#F59E0B' }
      ]
    };

    const chartAprobaciones = {
      labels: ['Aprobadas', 'Rechazadas', 'Pendientes'],
      datasets: [{
        label: 'Solicitudes',
        data: [estadosCount.APROBADO, estadosCount.RECHAZADO, estadosCount.PENDIENTE],
        backgroundColor: ['#10B981', '#F43F5E', '#F59E0B']
      }]
    };

    const LABELS_TIPO: Record<string, string> = {
      DESCUENTO: 'Descuento Comercial',
      SERVICIO_ESPECIAL_PRECIO: 'Servicio Especial (Precio)',
      ANULACION: 'Anulación de OT',
      PLACA_DUPLICADA: 'Corrección de Placa',
      CORTESIA: 'Cortesía VIP',
      REVISION_PREVENTIVA: 'Revisión Preventiva'
    };
    const tiposKeys = Object.keys(tiposCount).sort((a, b) => tiposCount[b] - tiposCount[a]);
    const chartTipos = {
      labels: tiposKeys.map(k => LABELS_TIPO[k] || k),
      datasets: [{
        label: 'Solicitudes',
        data: tiposKeys.map(k => tiposCount[k]),
        backgroundColor: ['#007AFF', '#8B5CF6', '#F59E0B', '#10B981', '#EC4899', '#6366F1'].slice(0, tiposKeys.length)
      }]
    };

    const topSolKeys = Object.keys(solicitantesCount).sort((a, b) => solicitantesCount[b] - solicitantesCount[a]).slice(0, 5);
    const chartTopSolicitantes = {
      labels: topSolKeys,
      datasets: [{
        label: 'Solicitudes Aprobadas',
        data: topSolKeys.map(k => solicitantesCount[k]),
        backgroundColor: '#007AFF'
      }]
    };

    // Decisiones de Auditoría (Reciclado de Super Admin: Auditoría Reciente)
    const auditoriaAcciones: Record<string, number> = { APROBAR: 0, RECHAZAR: 0, ANULAR: 0 };
    const motivosRechazoCount: Record<string, number> = {};
    for (const a of auditorias) {
      if (a.accion in auditoriaAcciones) auditoriaAcciones[a.accion]++;
      if (a.accion === 'RECHAZAR' && a.motivo) {
        motivosRechazoCount[a.motivo] = (motivosRechazoCount[a.motivo] || 0) + 1;
      }
    }
    const chartAuditoriaDecisiones = {
      labels: ['Aprobaciones', 'Rechazos', 'Anulaciones'],
      datasets: [{
        label: 'Decisiones',
        data: [auditoriaAcciones.APROBAR, auditoriaAcciones.RECHAZAR, auditoriaAcciones.ANULAR],
        backgroundColor: ['#10B981', '#F43F5E', '#64748B']
      }]
    };

    const topMotivosKeys = Object.keys(motivosRechazoCount).sort((a, b) => motivosRechazoCount[b] - motivosRechazoCount[a]).slice(0, 5);
    const chartMotivosRechazo = {
      labels: topMotivosKeys.length > 0 ? topMotivosKeys : ['Sin rechazos registrados'],
      datasets: [{
        label: 'Rechazos',
        data: topMotivosKeys.length > 0 ? topMotivosKeys.map(k => motivosRechazoCount[k]) : [0],
        backgroundColor: '#F43F5E'
      }]
    };

    return {
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      kpis: {
        pendientesHoy,
        aprobadasHoy,
        rechazadasHoy,
        anuladasHoy,
        descuentosFueraDeRango,
        montoAprobadoHoy: Number(montoAprobadoHoy.toFixed(2)),
        montoAprobadoPeriodo: Number(montoAprobadoPeriodo.toFixed(2)),
        totalHoy: solicitudesHoy.length,
        tasaRechazoPct,
        tasaAprobacionPct,
        tiempoPromedioResolucionMin,
        totalPendientes: estadosCount.PENDIENTE,
        totalAprobadas: estadosCount.APROBADO,
        totalRechazadas: estadosCount.RECHAZADO
      },
      flujoHorario: Object.keys(flujoEstados).sort().map(hora => ({ hora, cantidad: flujoEstados[hora].PENDIENTE + flujoEstados[hora].APROBADO + flujoEstados[hora].RECHAZADO })),
      flujoEstadosPorDia: flujoEstados,
      flujoSolicitudes,
      chartAprobaciones,
      chartTipos,
      chartTopSolicitantes,
      chartAuditoriaDecisiones,
      chartMotivosRechazo,
      distribucionTipos: Object.keys(tiposCount).map(k => ({ nombre: LABELS_TIPO[k] || k, cantidad: tiposCount[k] })).sort((a, b) => b.cantidad - a.cantidad),
      distribucionEstados: Object.keys(estadosCount).map(k => ({ nombre: k, cantidad: estadosCount[k] })),
      topAgencias: Object.keys(agenciasCount).map(k => ({ nombre: k, cantidad: agenciasCount[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5),
      topSolicitantes: Object.keys(solicitantesCount).map(k => ({ nombre: k, cantidad: solicitantesCount[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5)
    };
  }

  // ═══ COMERCIAL ═══════════════════════════════════════════════════════
  private async getComercialMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date, categoriaServicio?: string) {
    const base30 = hayFiltro ? { bahia: { agencia: filtro } } : {};
    const catFiltro = this.filtroCategoria(categoriaServicio);
    const [servicios30Dias, serviciosHoy, solicitudesComerciales] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: { horaIngreso: { gte: hace30Dias, lte: endOfDay }, ...base30, ...catFiltro },
        select: {
          horaIngreso: true, horaInicio: true, horaSalida: true, estado: true, marca: true,
          catalogo: { select: { nombre: true, categoria: true, tiempoEstimadoMin: true } },
          consumos: { select: { cantidadUsada: true } },
        },
      }),
      this.prisma.servicioLavado.count({ where: { horaIngreso: { gte: startOfDay, lte: endOfDay }, ...base30, ...catFiltro } }),
      this.prisma.solicitudAprobacion.findMany({
        where: { tipo: { in: ['SERVICIO_ESPECIAL_PRECIO', 'DESCUENTO'] }, createdAt: { gte: hace30Dias, lte: endOfDay }, ...(hayFiltro ? { agencia: filtro } : {}) },
        select: { tipo: true, estado: true, createdAt: true },
      }),
    ]);

    const mix: Record<string, number> = {};
    const mixCategoria: Record<string, number> = {};
    const marcas: Record<string, number> = {};
    // Los insumos consumidos se miden en UNIDADES: el costo del catálogo es por envase y el consumo está
    // en unidad base, así que el monto en USD quedaba inflado (≈50× en los insumos medidos en ml).
    let unidadesQuimicos = 0;
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
      for (const c of s.consumos || []) unidadesQuimicos += Number(c.cantidadUsada || 0);
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
        unidadesQuimicos: Number(unidadesQuimicos.toFixed(2)),
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
    const servicioWhere: any = { horaIngreso: { gte: startOfDay, lte: endOfDay }, ...this.filtroCategoria(dto?.categoriaServicio) };
    if (hayFiltro) servicioWhere.bahia = { agencia: filtro };
    if (dto?.pulidorId) servicioWhere.operadorId = dto.pulidorId;
    const incPulidor = this.filtroIncidentePulidor(dto?.pulidorId);
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
      this.prisma.incidenteTecnico.count({ where: { estado: { notIn: ['RESUELTO', 'CANCELADO'] }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}), ...incPulidor } }),
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
      this.prisma.incidenteTecnico.findMany({ where: { createdAt: { gte: hace30Dias, lte: endOfDay }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}), ...incPulidor }, include: { maquinaria: { select: { codigo: true, nombre: true, tipo: true, agencia: { select: { nombre: true } }, bahia: { select: { id: true, nombre: true } } } }, reportadoPor: { select: { name: true, lastname: true } } } }),
      // Alertas operativas de mantenimiento: incidentes abiertos. Se acotan por agencia (vía maquinaria) y
      // por pulidor (vía reportante), y se devuelven ambos datos para mostrarlos en la lista.
      this.prisma.incidenteTecnico.findMany({
        where: { estado: { in: ['ABIERTO', 'EN_PROCESO'] }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}), ...incPulidor },
        orderBy: { createdAt: 'desc' }, take: 15,
        select: {
          id: true, titulo: true, gravedad: true, createdAt: true,
          reportadoPor: { select: { name: true, lastname: true } },
          maquinaria: { select: { codigo: true, nombre: true, agencia: { select: { nombre: true, region: true } } } },
        },
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
    const mixGenerales: Record<string, number> = {};
    const mixEspeciales: Record<string, number> = {};
    const topMarcas: Record<string, number> = {};
    const flujoHorario: Record<string, number> = {};
    for (let i = 7; i <= 21; i++) flujoHorario[`${i.toString().padStart(2, '0')}:00`] = 0;

    for (const s of serviciosHoy) {
      estadosCount[s.estado] = (estadosCount[s.estado] || 0) + 1;
      const time = s.horaInicio || s.horaIngreso;
      if (time) { const key = `${new Date(time).getHours().toString().padStart(2, '0')}:00`; flujoHorario[key] = (flujoHorario[key] || 0) + 1; }
      if (s.catalogo?.nombre) {
        const cat = s.catalogo.categoria === 'ESPECIAL' ? 'especial' : 'general';
        if (cat === 'especial') mixEspeciales[s.catalogo.nombre] = (mixEspeciales[s.catalogo.nombre] || 0) + 1;
        else mixGenerales[s.catalogo.nombre] = (mixGenerales[s.catalogo.nombre] || 0) + 1;
      }
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
        const esPorAgencia = isSupervisorView && !dto?.agenciaId;
        const entidadId = esPorAgencia ? (s.bahia.agencia?.nombre || 'Sin agencia') : s.bahia.id;
        const entidadNombre = esPorAgencia ? (s.bahia.agencia?.nombre || 'Sin agencia') : (s.bahia.nombre || 'Sin bahía');
        if (!bahiasStats[entidadId]) {
          bahiasStats[entidadId] = { id: entidadId, nombre: entidadNombre, total: 0, tiempoTotalMin: 0, finalizados: 0 };
        }
        bahiasStats[entidadId].total++;
        if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) {
          bahiasStats[entidadId].finalizados++;
          bahiasStats[entidadId].tiempoTotalMin += duracionMin;
        }
      }
    }

    const tiempoPromedioMin = serviciosFinalizadosConTiempo > 0 ? Math.round(tiempoTotalMinutos / serviciosFinalizadosConTiempo) : 0;
    const distribucionBahias = Object.values(bahiasStats).map(b => ({ nombre: b.nombre, total: b.total })).sort((a, b) => b.total - a.total);
    const tiemposBahias = Object.values(bahiasStats).filter(b => b.finalizados > 0).map(b => ({ nombre: b.nombre, promedio: Math.round(b.tiempoTotalMin / b.finalizados) })).sort((a, b) => a.promedio - b.promedio);
    // Serie unificada: cantidad de lavados + tiempo promedio por bahía o agencia.
    const bahias = Object.values(bahiasStats)
      .map(b => ({ nombre: b.nombre, cantidad: b.total, tiempoPromedioMin: b.finalizados > 0 ? Math.round(b.tiempoTotalMin / b.finalizados) : 0 }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);
    const bahiaMasActiva = distribucionBahias[0] || { nombre: 'Sin actividad', total: 0 };
    const flujoArr = Object.keys(flujoHorario).sort().map(hora => ({ hora, cantidad: flujoHorario[hora] }));

    const maquinasDañadas: Record<string, { nombre: string; total: number; agencia: string }> = {};
    const agenciasIncidentes: Record<string, { nombre: string; total: number }> = {};
    const pulidoresIncidentes: Record<string, { nombre: string; total: number }> = {};
    const bahiasIncidentes: Record<string, { nombre: string; total: number }> = {};
    const incidentesPorTipo: Record<string, number> = {};
    const gravedadIncidentes: Record<string, number> = {};
    const reparacionesPorAgencia: Record<string, number> = {};
    for (const inc of todosIncidentes30Dias) {
      // La gravedad es propia del incidente (no de la máquina), así que se cuenta siempre.
      gravedadIncidentes[inc.gravedad] = (gravedadIncidentes[inc.gravedad] || 0) + 1;
      if (inc.maquinaria) {
        const agKey = inc.maquinaria.agencia?.nombre || 'Desconocida';
        const mKey = `${inc.maquinaria.codigo} - ${inc.maquinaria.nombre}`;
        maquinasDañadas[mKey] = { nombre: mKey, total: (maquinasDañadas[mKey]?.total || 0) + 1, agencia: agKey };
        incidentesPorTipo[inc.maquinaria.tipo || 'Desconocido'] = (incidentesPorTipo[inc.maquinaria.tipo || 'Desconocido'] || 0) + 1;
        agenciasIncidentes[agKey] = { nombre: agKey, total: (agenciasIncidentes[agKey]?.total || 0) + 1 };
        reparacionesPorAgencia[agKey] = (reparacionesPorAgencia[agKey] || 0) + Number(inc.costoTotal || 0);

        const bKey = inc.maquinaria.bahia?.nombre || 'Sin bahía';
        bahiasIncidentes[bKey] = { nombre: bKey, total: (bahiasIncidentes[bKey]?.total || 0) + 1 };
      }
      if (inc.reportadoPor) {
        const pKey = `${inc.reportadoPor.name} ${inc.reportadoPor.lastname}`.trim() || 'Desconocido';
        pulidoresIncidentes[pKey] = { nombre: pKey, total: (pulidoresIncidentes[pKey]?.total || 0) + 1 };
      }
    }
    const topMaquinasDañadas = Object.values(maquinasDañadas).sort((a, b) => b.total - a.total).slice(0, 5);
    const bottomMaquinasDañadas = Object.values(maquinasDañadas).sort((a, b) => a.total - b.total).slice(0, 5);
    const topAgenciasIncidentes = Object.values(agenciasIncidentes).sort((a, b) => b.total - a.total).slice(0, 5);
    const bottomAgenciasIncidentes = Object.values(agenciasIncidentes).sort((a, b) => a.total - b.total).slice(0, 5);
    const topPulidoresIncidentes = Object.values(pulidoresIncidentes).sort((a, b) => b.total - a.total).slice(0, 5);
    const bottomPulidoresIncidentes = Object.values(pulidoresIncidentes).sort((a, b) => a.total - b.total).slice(0, 5);
    const topBahiasIncidentes = Object.values(bahiasIncidentes).sort((a, b) => b.total - a.total).slice(0, 5);
    const bottomBahiasIncidentes = Object.values(bahiasIncidentes).sort((a, b) => a.total - b.total).slice(0, 5);
    const topAgenciasReparaciones = Object.keys(reparacionesPorAgencia).map(n => ({ nombre: n, costo: Number(reparacionesPorAgencia[n].toFixed(2)) })).sort((a, b) => b.costo - a.costo).slice(0, 5);
    // Orden por severidad (no por cantidad): el gráfico se lee de la falla más grave a la más leve.
    const ORDEN_GRAVEDAD = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];
    const incidentesPorGravedad = ORDEN_GRAVEDAD
      .filter((g) => (gravedadIncidentes[g] || 0) > 0)
      .map((g) => ({ nombre: g, cantidad: gravedadIncidentes[g] }));

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
      bottomMaquinasDañadas,
      topAgenciasIncidentes,
      bottomAgenciasIncidentes,
      topPulidoresIncidentes,
      bottomPulidoresIncidentes,
      topBahiasIncidentes,
      bottomBahiasIncidentes,
      topAgenciasReparaciones,
      mixGenerales: Object.keys(mixGenerales).map(k => ({ nombre: k, cantidad: mixGenerales[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 6),
      mixEspeciales: Object.keys(mixEspeciales).map(k => ({ nombre: k, cantidad: mixEspeciales[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 6),
      topMarcas: Object.keys(topMarcas).map(k => ({ nombre: k, cantidad: topMarcas[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5),
      incidentesPorTipo: Object.keys(incidentesPorTipo).map(k => ({ nombre: k, cantidad: incidentesPorTipo[k] })),
      incidentesPorGravedad,
      // Alertas operativas unificadas: stock + mantenimiento (incidentes abiertos y preventivos vencidos).
      alertasOperativas: [
        ...alertasPendientes.map(a => ({
          grupo: 'stock' as const,
          severidad: (a.nivel === 'CRITICO' || a.nivel === 'AGOTADO') ? 'critica' : (a.nivel === 'BAJO' ? 'advertencia' : 'info'),
          titulo: `Stock ${a.nivel}`,
          detalle: a.insumo?.nombre || 'Insumo',
          origen: a.agencia?.nombre || (a.pulidor ? `${a.pulidor.name} ${a.pulidor.lastname}` : null),
          agencia: a.agencia?.nombre ?? null,
          pulidor: a.pulidor ? `${a.pulidor.name} ${a.pulidor.lastname}` : null,
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
          agencia: i.maquinaria?.agencia?.nombre ?? null,
          pulidor: i.reportadoPor ? `${i.reportadoPor.name} ${i.reportadoPor.lastname}` : null,
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
          agencia: m.maquinaria?.agencia?.nombre ?? null,
          pulidor: null,
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
    const { desde: fechaDesde, hasta: fechaHasta } = this.periodoDeFiltro(dto);
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

    return { success: true, rango: { desde: fechaDesde.toISOString().split('T')[0], hasta: fechaHasta.toISOString().split('T')[0] }, agrupacion, granTotalCostoUSD: Number(granTotalCostoUSD.toFixed(2)), totalInsumosDistintos: listaOrdenada.length, insumos: listaOrdenada, serie, consumoPorAgencia: Object.keys(consumoPorAgencia).map(k => ({ nombre: k, costo: Number(consumoPorAgencia[k].toFixed(2)) })).sort((a, b) => b.costo - a.costo), consumoPorCategoria: Object.keys(consumoPorCategoria).map(k => ({ nombre: k, cantidad: Number(consumoPorCategoria[k].toFixed(2)) })) };
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
    const { desde: fechaDesde, hasta: fechaHasta } = this.periodoDeFiltro(dto);
    const where: any = { estado: { in: [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO] }, horaIngreso: { gte: fechaDesde, lte: fechaHasta }, ...this.filtroCategoria(dto?.categoriaServicio) };
    if (hayFiltro) where.bahia = { agencia: filtro };

    const servicios = await this.prisma.servicioLavado.findMany({ 
      where, 
      select: { 
        operadorId: true, horaIngreso: true, horaSalida: true, 
        operador: { select: { id: true, name: true, lastname: true, agencia: { select: { nombre: true } } } },
        bahia: { select: { nombre: true, agencia: { select: { nombre: true } } } }
      } 
    });
    const acumulado: Record<string, any> = {};
    for (const s of servicios) {
      if (!s.operadorId) continue;
      if (!acumulado[s.operadorId]) {
        const nombreOperador = s.operador ? `${s.operador.name} ${s.operador.lastname}` : 'Operador';
        const nombreAgencia = s.operador?.agencia?.nombre || s.bahia?.agencia?.nombre || 'General';
        const nombreBahia = s.bahia?.nombre || 'Sin Bahía';
        acumulado[s.operadorId] = { 
          operadorId: s.operadorId, 
          nombre: nombreOperador,
          agencia: nombreAgencia,
          bahia: nombreBahia,
          cantidadServicios: 0, 
          tiempoTotalMin: 0, 
          serviciosConTiempo: 0 
        };
      }
      acumulado[s.operadorId].cantidadServicios++;
      if (s.horaSalida) { acumulado[s.operadorId].tiempoTotalMin += Math.max(0, Math.round((new Date(s.horaSalida).getTime() - new Date(s.horaIngreso).getTime()) / 60000)); acumulado[s.operadorId].serviciosConTiempo++; }
    }
    const arr = Object.values(acumulado).map(a => ({ operadorId: a.operadorId, nombre: a.nombre, agencia: a.agencia, bahia: a.bahia, cantidadServicios: a.cantidadServicios, tiempoPromedioMin: a.serviciosConTiempo > 0 ? Math.round(a.tiempoTotalMin / a.serviciosConTiempo) : 0 }));
    const ranking = [...arr].sort((a, b) => b.cantidadServicios - a.cantidadServicios || a.tiempoPromedioMin - b.tiempoPromedioMin).slice(0, 10);
    const rankingBottom = [...arr].sort((a, b) => a.cantidadServicios - b.cantidadServicios || b.tiempoPromedioMin - a.tiempoPromedioMin).slice(0, 10);
    return { success: true, rango: { desde: fechaDesde.toISOString().split('T')[0], hasta: fechaHasta.toISOString().split('T')[0] }, ranking, rankingBottom };
  }

  async getRankingPulidores(dto: RankingLavadoresDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const { desde: fechaDesde, hasta: fechaHasta } = this.periodoDeFiltro(dto);
    const where: any = { estado: { in: [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO] }, horaIngreso: { gte: fechaDesde, lte: fechaHasta }, ...this.filtroCategoria(dto?.categoriaServicio) };
    if (hayFiltro) where.bahia = { agencia: filtro };

    const servicios = await this.prisma.servicioLavado.findMany({ 
      where, 
      select: { 
        operadorId: true, 
        precio: true,
        operador: { select: { id: true, name: true, lastname: true, agenciaId: true, agencia: { select: { nombre: true } }, region: { select: { nombre: true } }, role: { select: { namerol: true } } } } 
      } 
    });

    const acumulado: Record<string, any> = {};
    for (const s of servicios) {
      if (!s.operadorId || !s.operador || s.operador.role.namerol !== 'PULIDOR') continue;
      if (!acumulado[s.operadorId]) {
        const nombreBase = `${s.operador.name} ${s.operador.lastname}`;
        const esFijo = s.operador.agenciaId !== null;
        const ubicacion = esFijo ? (s.operador.agencia?.nombre || 'Agencia') : (s.operador.region?.nombre || 'Nacional');
        acumulado[s.operadorId] = { 
          operadorId: s.operadorId, 
          nombre: nombreBase, 
          ubicacion,
          esFijo,
          cantidadServicios: 0, 
          dineroTotal: 0 
        };
      }
      acumulado[s.operadorId].cantidadServicios++;
      if (s.precio) { acumulado[s.operadorId].dineroTotal += Number(s.precio); }
    }
    
    const fijos = Object.values(acumulado).filter(a => a.esFijo).map(a => ({ ...a, dineroTotal: Number(a.dineroTotal.toFixed(2)) }));
    const moviles = Object.values(acumulado).filter(a => !a.esFijo).map(a => ({ ...a, dineroTotal: Number(a.dineroTotal.toFixed(2)) }));

    const rankingFijos = [...fijos].sort((a, b) => b.cantidadServicios - a.cantidadServicios || b.dineroTotal - a.dineroTotal).slice(0, 10);
    const rankingBottomFijos = [...fijos].sort((a, b) => a.cantidadServicios - b.cantidadServicios || a.dineroTotal - b.dineroTotal).slice(0, 10);
    
    const rankingMoviles = [...moviles].sort((a, b) => b.cantidadServicios - a.cantidadServicios || b.dineroTotal - a.dineroTotal).slice(0, 10);
    const rankingBottomMoviles = [...moviles].sort((a, b) => a.cantidadServicios - b.cantidadServicios || a.dineroTotal - b.dineroTotal).slice(0, 10);
    
    return { success: true, rankingFijos, rankingBottomFijos, rankingMoviles, rankingBottomMoviles };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD TALLER: Coordinador Mantenimiento + Técnico
  // Datos reales: incidentes, mantenimientos, maquinaria, costos de reparación
  // ═══════════════════════════════════════════════════════════════════════
  async getDashboardTaller(dto: DashboardDedicadoDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;
    const maqWhere = hayFiltro ? { agencia: filtro } : {};
    // Los incidentes se acotan por agencia (vía maquinaria) y por pulidor (vía reportante).
    const incWhere: any = { ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}), ...this.filtroIncidentePulidor(dto?.pulidorId) };
    const { desde: startOfDay, hasta: endOfDay } = this.resolverPeriodo(dto);
    // Incidentes y mantenimientos siguen EXACTAMENTE el período filtrado: antes la ventana era
    // «inicio del período − 30 días» y las tarjetas la rotulaban "30 días" aunque se filtrara por semestre.
    const ventana = { gte: startOfDay, lte: endOfDay };

    const [maquinarias, incidentesActivos, incidentes30Dias, mantenimientos30Dias, proxMantenimientos, mantenimientosVencidos] = await Promise.all([
      // Estado actual del parque de maquinaria
      this.prisma.maquinaria.findMany({
        where: maqWhere,
        select: { id: true, nombre: true, codigo: true, tipo: true, estadoOperativo: true, agencia: { select: { nombre: true } } }
      }),
      // Incidentes abiertos ahora mismo
      this.prisma.incidenteTecnico.count({ where: { estado: { in: ['ABIERTO', 'EN_PROCESO'] }, ...incWhere } }),
      // Incidentes de los últimos 30 días con datos de tiempo y costo
      this.prisma.incidenteTecnico.findMany({
        where: { createdAt: ventana, ...incWhere },
        select: {
          id: true, titulo: true, gravedad: true, estado: true, costoTotal: true,
          fechaReporte: true, fechaSolucion: true, createdAt: true,
          maquinaria: { select: { nombre: true, codigo: true, tipo: true, agencia: { select: { nombre: true } }, bahia: { select: { nombre: true } } } }
        }
      }),
      // Mantenimientos ejecutados en 30 días
      this.prisma.mantenimientoMaquinaria.findMany({
        where: { createdAt: ventana, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
        select: { tipo: true, estado: true, costoTotal: true, fechaEjecucion: true, proximoMantenimiento: true, maquinaria: { select: { nombre: true, tipo: true, agencia: { select: { nombre: true } }, bahia: { select: { nombre: true } } } } }
      }),
      // Próximos mantenimientos preventivos programados
      this.prisma.mantenimientoMaquinaria.findMany({
        where: { estado: 'PENDIENTE', fechaProgramada: { gte: startOfDay }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
        orderBy: { fechaProgramada: 'asc' },
        take: 5,
        select: { tipo: true, fechaProgramada: true, maquinaria: { select: { nombre: true, codigo: true, bahia: { select: { nombre: true } } } } }
      }),
      // Mantenimientos programados cuya fecha ya pasó y siguen pendientes (deuda de mantenimiento)
      this.prisma.mantenimientoMaquinaria.count({
        where: { estado: 'PENDIENTE', fechaProgramada: { lt: new Date() }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) },
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
        const bh = (inc.maquinaria as any).bahia?.nombre ? ` [${(inc.maquinaria as any).bahia.nombre}]` : '';
        const key = `${inc.maquinaria.codigo} · ${inc.maquinaria.nombre}${bh}`;
        if (!maquinaMasProblematica[key]) maquinaMasProblematica[key] = { nombre: key, total: 0, costoTotal: 0 };
        maquinaMasProblematica[key].total++;
        if (inc.costoTotal) maquinaMasProblematica[key].costoTotal += Number(inc.costoTotal);
      }
    }

    const tiempoPromedioResolucionHoras = incidentesResueltos > 0 ? Number((tiempoTotalResolucionHoras / incidentesResueltos).toFixed(1)) : 0;
    const topMaquinasProblematicas = Object.values(maquinaMasProblematica).sort((a, b) => b.total - a.total).slice(0, 5);
    const topMaquinasCostosas = Object.values(maquinaMasProblematica).filter(m => m.costoTotal > 0).sort((a, b) => b.costoTotal - a.costoTotal).slice(0, 5);

    // Rankings completos que alimentan el control Top N (5 o 10, mayor→menor o menor→mayor) del dashboard de
    // mantenimiento. Van sin recortar porque, sobre un top 5 ya recortado, el orden ascendente solo invertiría
    // esos cinco y mostraría como "mejores" equipos o agencias que no lo son.
    const maquinasProblematicasRank = Object.values(maquinaMasProblematica).sort((a, b) => b.total - a.total);
    const maquinasCostosasRank = Object.values(maquinaMasProblematica).filter(m => m.costoTotal > 0).sort((a, b) => b.costoTotal - a.costoTotal);

    // Mantenimientos preventivos vs correctivos (cantidad y costo) + costo por agencia (fallas + mantenimiento)
    const tipoMantenimiento: Record<string, number> = { PREVENTIVO: 0, CORRECTIVO: 0 };
    const costoTipoMant: Record<string, number> = { PREVENTIVO: 0, CORRECTIVO: 0 };
    const costoAgencia: Record<string, { reparaciones: number; mantenimiento: number }> = {};
    let costoMantenimientos = 0;
    for (const m of mantenimientos30Dias) {
      tipoMantenimiento[m.tipo] = (tipoMantenimiento[m.tipo] || 0) + 1;
      const costo = Number(m.costoTotal || 0);
      costoTipoMant[m.tipo] = (costoTipoMant[m.tipo] || 0) + costo;
      costoMantenimientos += costo;
      const ag = m.maquinaria?.agencia?.nombre || 'Sin agencia';
      (costoAgencia[ag] ??= { reparaciones: 0, mantenimiento: 0 }).mantenimiento += costo;
    }
    for (const inc of incidentes30Dias) {
      const ag = inc.maquinaria?.agencia?.nombre || 'Sin agencia';
      (costoAgencia[ag] ??= { reparaciones: 0, mantenimiento: 0 }).reparaciones += Number(inc.costoTotal || 0);
    }
    const costoPorAgencia = Object.keys(costoAgencia)
      .map(n => ({ nombre: n, reparaciones: Number(costoAgencia[n].reparaciones.toFixed(2)), mantenimiento: Number(costoAgencia[n].mantenimiento.toFixed(2)) }))
      .filter(a => a.reparaciones + a.mantenimiento > 0)
      .sort((a, b) => (b.reparaciones + b.mantenimiento) - (a.reparaciones + a.mantenimiento));
    // Se conserva el recorte de 8 filas para el panel ejecutivo; el ranking completo alimenta el control Top N.
    const costoPorAgenciaTop = costoPorAgencia.slice(0, 8);

    // MTTR (tiempo medio de resolución) por gravedad y por agencia. El gráfico por gravedad suele salir
    // plano (todas las gravedades tardan parecido), así que el desglose por agencia indica DÓNDE se
    // resuelve lento y con cuántos incidentes se calculó cada promedio.
    const mttrAcum: Record<string, { horas: number; n: number }> = {};
    const mttrAgenciaAcum: Record<string, { horas: number; n: number }> = {};
    for (const inc of incidentes30Dias) {
      if (inc.estado === 'RESUELTO' && inc.fechaSolucion) {
        const h = (new Date(inc.fechaSolucion).getTime() - new Date(inc.fechaReporte).getTime()) / 3600000;
        const r = (mttrAcum[inc.gravedad] ??= { horas: 0, n: 0 });
        r.horas += h; r.n++;
        const ag = inc.maquinaria?.agencia?.nombre || 'Sin agencia';
        const ra = (mttrAgenciaAcum[ag] ??= { horas: 0, n: 0 });
        ra.horas += h; ra.n++;
      }
    }
    const promedioHoras = (r: { horas: number; n: number }) => Number((r.horas / r.n).toFixed(1));
    const mttrPorGravedad = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA']
      .filter(g => mttrAcum[g])
      .map(g => ({ nombre: g, horas: promedioHoras(mttrAcum[g]), incidentes: mttrAcum[g].n }));

    const mttrPorAgencia = Object.keys(mttrAgenciaAcum)
      .map(n => ({ nombre: n, horas: promedioHoras(mttrAgenciaAcum[n]), incidentes: mttrAgenciaAcum[n].n }))
      .sort((a, b) => b.horas - a.horas);
    const mttrPorAgenciaTop = mttrPorAgencia.slice(0, 8);

    return {
      success: true,
      mttrPorGravedad,
      mttrPorAgencia: mttrPorAgenciaTop,
      costoPorAgencia: costoPorAgenciaTop,
      costoPorTipoMantenimiento: Object.keys(costoTipoMant).map(k => ({ nombre: k, costo: Number(costoTipoMant[k].toFixed(2)) })).filter(x => x.costo > 0),
      kpis: {
        costoMantenimientos30d: Number(costoMantenimientos.toFixed(2)),
        mantenimientosVencidos,
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
      topMaquinasCostosas,
      // Rankings completos para el control Top 5 / Top 10 con orden ascendente o descendente.
      maquinasProblematicasRank,
      maquinasCostosasRank,
      mttrAgenciaRank: mttrPorAgencia,
      costoAgenciaRank: costoPorAgencia,
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
    const { desde: desdePeriodo, hasta: endOfDay } = this.resolverPeriodo(dto);
    const hace30Dias = new Date(desdePeriodo);
    hace30Dias.setDate(hace30Dias.getDate() - 30);

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
    const movWhere: any = { createdAt: { gte: hace30Dias, lte: endOfDay } };
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
    // Filtro por pulidor: acota a su kit (stock del pulidor y despachos a su nombre).
    if (dto.pulidorId) {
      alertaWhere.pulidorId = dto.pulidorId;
      movWhere.destinoPulidorId = dto.pulidorId;
      stockWhere = { cantidadActual: { gt: 0 }, pulidorId: dto.pulidorId };
    }

    // Para la salud de stock se necesitan también las posiciones en 0 (agotadas): mismo alcance, sin filtro de cantidad.
    const { cantidadActual: _omitido, ...stockSaludWhere } = stockWhere;

    const [alertasActivas, movimientos30Dias, stocks, stocksSalud] = await Promise.all([
      this.prisma.alertaStock.findMany({
        where: alertaWhere,
        include: { insumo: { select: { nombre: true, categoria: true } }, agencia: { select: { nombre: true } }, pulidor: { select: { name: true, lastname: true, agenciaId: true } } },
        orderBy: [{ nivel: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.movimientoInventario.findMany({
        where: movWhere,
        select: { 
          tipo: true, 
          estadoDespacho: true, 
          createdAt: true, 
          destinoUbicacion: true,
          detalles: { select: { cantidadEnviada: true, insumo: { select: { nombre: true, categoria: true } } } } 
        },
      }),
      this.prisma.stockUbicacion.findMany({
        where: stockWhere,
        include: { insumo: { select: { nombre: true, categoria: true } } },
      }),
      this.prisma.stockUbicacion.findMany({
        where: stockSaludWhere,
        include: {
          insumo: { select: { nombre: true, categoria: true, unidadMedida: { select: { simbolo: true } }, stockMinimoBodega: true, stockMinimoAgencia: true, stockOptimoBodega: true, stockOptimoAgencia: true } },
          agencia: { select: { nombre: true } },
          bodega: { select: { nombre: true } },
          pulidor: { select: { name: true, lastname: true } },
        },
      }),
    ]);

    const salud = this.calcularSaludInventario(stocksSalud, alertasActivas);

    // Cobertura: cuántos días dura el stock actual al ritmo de consumo real (servicios) de los últimos 30 días.
    const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const consumo30 = await this.prisma.consumoServicio.groupBy({
      by: ['insumoId'],
      where: { createdAt: { gte: hace30 }, ...(agenciaIds ? { agenciaId: { in: agenciaIds } } : {}) },
      _sum: { cantidadUsada: true },
    });
    const stockPorInsumo: Record<string, { nombre: string; stock: number }> = {};
    for (const s of stocks) {
      const r = (stockPorInsumo[s.insumoId] ??= { nombre: s.insumo?.nombre || 'Insumo', stock: 0 });
      r.stock += Number(s.cantidadActual || 0);
    }
    const cobertura = consumo30
      .map((c) => {
        const diario = Number(c._sum.cantidadUsada || 0) / 30;
        const st = stockPorInsumo[c.insumoId];
        return diario > 0 && st ? { nombre: st.nombre, stock: Number(st.stock.toFixed(2)), consumoDiario: Number(diario.toFixed(3)), dias: Number((st.stock / diario).toFixed(1)) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.dias - b.dias);
    const coberturaCritica = cobertura.filter((c) => c.dias < 7).length;

    // KPIs alertas
    const alertasCriticas = alertasActivas.filter(a => a.nivel === 'CRITICO' || a.nivel === 'AGOTADO').length;
    const alertasBajas = alertasActivas.filter(a => a.nivel === 'BAJO').length;
    const alertasPorInsumo: Record<string, number> = {};
    const alertasPorAgencia: Record<string, number> = {};
    for (const a of alertasActivas) {
      const k = a.insumo?.nombre || 'Sin nombre';
      alertasPorInsumo[k] = (alertasPorInsumo[k] || 0) + 1;
      let ag = 'Ubicación Desconocida';
      if ((a as any).pulidor) {
        const isFijo = !!(a as any).pulidor.agenciaId;
        ag = `Kit ${isFijo ? 'Fijo' : 'Móvil'}: ${(a as any).pulidor.name} ${(a as any).pulidor.lastname}`.trim();
      } else if (a.agencia?.nombre) {
        ag = a.agencia.nombre;
      }
      alertasPorAgencia[ag] = (alertasPorAgencia[ag] || 0) + 1;
    }

    // Top agencias con alertas. Solo se expone recortado: el dashboard de bodega no lleva control de orden
    // en las tarjetas de alertas.
    const topAgenciasConAlertas = Object.keys(alertasPorAgencia).map(k => ({ nombre: k, alertas: alertasPorAgencia[k] })).sort((a, b) => b.alertas - a.alertas).slice(0, 7);

    // Movimientos: despachados pendientes, en tránsito, recibidos
    const despachosEstado: Record<string, number> = { PENDIENTE: 0, EN_TRANSITO: 0, RECIBIDO: 0, RECHAZADO: 0 };
    const consumoPorCategoria: Record<string, number> = {};
    const consumoPorInsumo: Record<string, number> = {};
    const consumoPorAgencia: Record<string, number> = {};
    let unidadesEnTransito = 0;
    let despachos30d = 0;

    for (const mov of movimientos30Dias) {
      if (mov.tipo === 'DESPACHO_AGENCIA' || mov.tipo === 'DESPACHO_BODEGA') {
        despachosEstado[mov.estadoDespacho] = (despachosEstado[mov.estadoDespacho] || 0) + 1;
        despachos30d++;
        if (mov.estadoDespacho === 'EN_TRANSITO') {
          for (const d of mov.detalles) unidadesEnTransito += Number(d.cantidadEnviada || 0);
        }
      }
      
      let cantidadTotalMov = 0;
      for (const d of mov.detalles) {
        const cantidad = Number(d.cantidadEnviada || 0);
        cantidadTotalMov += cantidad;
        const cat = d.insumo?.categoria || 'Sin Categoría';
        consumoPorCategoria[cat] = (consumoPorCategoria[cat] || 0) + cantidad;
        const insumo = d.insumo?.nombre || 'Insumo';
        consumoPorInsumo[insumo] = (consumoPorInsumo[insumo] || 0) + cantidad;
      }
      
      if (mov.destinoUbicacion && cantidadTotalMov > 0) {
        const agenciaNombre = mov.destinoUbicacion;
        consumoPorAgencia[agenciaNombre] = (consumoPorAgencia[agenciaNombre] || 0) + cantidadTotalMov;
      }
    }

    // Rotación real desde bodega: insumos con más unidades despachadas en 30 días.
    const topInsumosConsumo = Object.keys(consumoPorInsumo)
      .map((nombre) => ({ nombre, cantidad: Number(consumoPorInsumo[nombre].toFixed(2)) }))
      .sort((a, b) => b.cantidad - a.cantidad);
      
    // Top agencias por consumo
    const topAgenciasConsumo = Object.keys(consumoPorAgencia)
      .map((nombre) => ({ nombre, cantidad: Number(consumoPorAgencia[nombre].toFixed(2)) }))
      .sort((a, b) => b.cantidad - a.cantidad);

    // Existencias totales del alcance: se reportan en UNIDADES, no en USD. El costo unitario del catálogo
    // es el precio del envase (p. ej. $75 los 5 L) mientras las existencias se llevan en unidad base (ml),
    // así que multiplicarlos daba un monto inflado e inutilizable para comprar.
    let unidadesStock = 0;
    const unidadesStockPorCategoria: Record<string, number> = {};

    for (const s of stocks) {
      const cantidad = Number(s.cantidadActual || 0);
      unidadesStock += cantidad;
      const cat = s.insumo?.categoria || 'Sin Categoría';
      unidadesStockPorCategoria[cat] = (unidadesStockPorCategoria[cat] || 0) + cantidad;
    }

    // Top insumos con alerta. Recortado: el dashboard de bodega no lleva control de orden en alertas.
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
        unidadesEnTransito: Number(unidadesEnTransito.toFixed(2)),
        unidadesStock: Number(unidadesStock.toFixed(2)),
        ...salud.kpis,
        insumosCoberturaCritica: coberturaCritica,
      },
      coberturaDias: cobertura.slice(0, 8),
      coberturaDiasRank: cobertura,
      saludStock: salud.saludStock,
      saludPorUbicacion: salud.saludPorUbicacion,
      saludPorUbicacionExtremos: salud.saludPorUbicacionExtremos,
      stockVsIdealCategoria: salud.stockVsIdealCategoria,
      topDeficit: salud.topDeficit,
      topDeficitRank: salud.topDeficitRank,
      alertasPorCategoriaNivel: salud.alertasPorCategoriaNivel,
      topInsumosCriticos,
      topAgenciasConAlertas,
      topInsumosConsumo: topInsumosConsumo.slice(0, 7),
      topInsumosConsumoRank: topInsumosConsumo,
      topAgenciasConsumo: topAgenciasConsumo.slice(0, 7),
      topAgenciasConsumoRank: topAgenciasConsumo,
      unidadesStockPorCategoria: Object.keys(unidadesStockPorCategoria).map(k => ({ nombre: k, cantidad: Number(unidadesStockPorCategoria[k].toFixed(2)) })).sort((a, b) => b.cantidad - a.cantidad),
      despachosEstado: Object.keys(despachosEstado).filter(k => despachosEstado[k] > 0).map(k => ({ nombre: k.replace(/_/g, ' '), cantidad: despachosEstado[k] })),
      consumoPorCategoria: Object.keys(consumoPorCategoria).map(k => ({ nombre: k, cantidad: Number(consumoPorCategoria[k].toFixed(2)) })).sort((a, b) => b.cantidad - a.cantidad),
      nivelAlertas: [
        { nombre: 'CRÍTICO/AGOTADO', cantidad: alertasCriticas },
        { nombre: 'BAJO', cantidad: alertasBajas },
      ].filter(x => x.cantidad > 0),
    };
  }

  /**
   * Salud del inventario: cruza cada posición de stock contra su mínimo y su nivel ideal (óptimo).
   * Mínimo/ideal: el de la ubicación si está configurado; si no, el del insumo según sea bodega o agencia/pulidor.
   * Clasificación: AGOTADO (0) · CRÍTICO (<50% del mínimo) · BAJO MÍNIMO (<mínimo) · BAJO IDEAL (<ideal) · ÓPTIMO · SOBRESTOCK (>150% del ideal).
   * Todo se reporta en UNIDADES (nunca en USD): el costo del catálogo es por envase y las existencias se
   * llevan en unidad base, así que el déficit × costo inflaba el monto y no servía para reponer.
   */
  private calcularSaludInventario(stocks: any[], alertas: any[]) {
    const ESTADOS = ['AGOTADO', 'CRÍTICO', 'BAJO MÍNIMO', 'BAJO IDEAL', 'ÓPTIMO', 'SOBRESTOCK'] as const;
    type Estado = (typeof ESTADOS)[number];
    const vacio = (): Record<Estado, number> => ({ AGOTADO: 0, 'CRÍTICO': 0, 'BAJO MÍNIMO': 0, 'BAJO IDEAL': 0, 'ÓPTIMO': 0, SOBRESTOCK: 0 });
    const n = (v: any) => Number(v ?? 0);

    const global = vacio();
    const porUbicacion: Record<string, Record<Estado, number>> = {};
    const porCategoria: Record<string, { actual: number; minimo: number; ideal: number }> = {};
    const deficitPorInsumo: Record<string, { nombre: string; unidades: number; unidad: string; ubicaciones: number }> = {};
    let unidadesReponer = 0;
    let ubicacionesConDeficit = 0;

    for (const s of stocks) {
      const esBodega = s.tipoUbicacion === 'BODEGA_CENTRAL';
      const ins = s.insumo || {};
      const actual = n(s.cantidadActual);
      const minimo = n(s.cantidadMinima) > 0 ? n(s.cantidadMinima) : n(esBodega ? ins.stockMinimoBodega : ins.stockMinimoAgencia);
      let ideal = n(esBodega ? ins.stockOptimoBodega : ins.stockOptimoAgencia);
      if (ideal < minimo || ideal === 0) ideal = minimo * 2;
      if (minimo <= 0 && ideal <= 0) continue; // sin umbrales configurados no se puede evaluar

      let estado: Estado;
      if (actual <= 0) estado = 'AGOTADO';
      else if (actual < minimo * 0.5) estado = 'CRÍTICO';
      else if (actual < minimo) estado = 'BAJO MÍNIMO';
      else if (actual < ideal) estado = 'BAJO IDEAL';
      else if (actual > ideal * 1.5) estado = 'SOBRESTOCK';
      else estado = 'ÓPTIMO';
      global[estado]++;

      let ubic = 'Ubicación Desconocida';
      if (s.tipoUbicacion === 'BODEGA_CENTRAL' && s.bodega?.nombre) ubic = s.bodega.nombre;
      else if (s.tipoUbicacion === 'AGENCIA' && s.agencia?.nombre) ubic = s.agencia.nombre;
      else if (s.pulidor) {
        const tipoKit = s.tipoUbicacion === 'PULIDOR_FIJO' ? 'Kit Fijo' : 'Kit Móvil';
        ubic = `${tipoKit}: ${s.pulidor.name} ${s.pulidor.lastname}`.trim();
      }
      (porUbicacion[ubic] ??= vacio())[estado]++;

      const cat = ins.categoria || 'Sin categoría';
      const c = (porCategoria[cat] ??= { actual: 0, minimo: 0, ideal: 0 });
      c.actual += actual; c.minimo += minimo; c.ideal += ideal;

      // El faltante se mide en UNIDADES de la unidad de medida del insumo. No se convierte a USD: el
      // costo del catálogo es por envase y las existencias están en unidad base, así que el monto salía inflado.
      const deficit = Math.max(0, ideal - actual);
      if (deficit > 0) {
        unidadesReponer += deficit;
        ubicacionesConDeficit++;
        const d = (deficitPorInsumo[ins.nombre || 'Insumo'] ??= { nombre: ins.nombre || 'Insumo', unidades: 0, unidad: ins.unidadMedida?.simbolo || 'und', ubicaciones: 0 });
        d.unidades += deficit; d.ubicaciones++;
      }
    }

    // Alertas agrupadas por categoría del insumo y nivel (barras apiladas), no solo por severidad.
    const alertasCat: Record<string, { AGOTADO: number; CRITICO: number; BAJO: number }> = {};
    for (const a of alertas) {
      const cat = a.insumo?.categoria || 'Sin categoría';
      const reg = (alertasCat[cat] ??= { AGOTADO: 0, CRITICO: 0, BAJO: 0 });
      if (a.nivel in reg) reg[a.nivel as 'AGOTADO' | 'CRITICO' | 'BAJO']++;
    }

    const r2 = (v: number) => Number(v.toFixed(2));
    const total = ESTADOS.reduce((acc, e) => acc + global[e], 0);
    const bajoIdeal = global.AGOTADO + global['CRÍTICO'] + global['BAJO MÍNIMO'] + global['BAJO IDEAL'];

    const saludPorUbicacionCompleta = Object.keys(porUbicacion)
      .map((nombre) => {
        const v = porUbicacion[nombre];
        const criticos = v['CRÍTICO'] + v['BAJO MÍNIMO'] + v['BAJO IDEAL'];
        return { nombre, ...v, criticos, problemas: v.AGOTADO + criticos };
      })
      .filter((u) => u.problemas > 0)
      .sort((a, b) => Number(b.criticos > 0) - Number(a.criticos > 0) || b.criticos - a.criticos || b.problemas - a.problemas);

    const topDeficitCompleto = Object.values(deficitPorInsumo)
      .map((d) => ({ nombre: d.nombre, unidades: r2(d.unidades), unidad: d.unidad, ubicaciones: d.ubicaciones }))
      .sort((a, b) => b.unidades - a.unidades);

    /** Los 10 primeros y los 10 últimos de una lista ordenada (evita enviar cientos de filas). */
    const extremos = <T>(lista: T[]): T[] => {
      if (lista.length <= 20) return lista;
      return [...lista.slice(0, 10), ...lista.slice(-10)];
    };

    return {
      kpis: {
        posicionesEvaluadas: total,
        posicionesBajoMinimo: global.AGOTADO + global['CRÍTICO'] + global['BAJO MÍNIMO'],
        posicionesBajoIdeal: bajoIdeal,
        pctBajoIdeal: total > 0 ? Math.round((bajoIdeal / total) * 100) : 0,
        unidadesReponer: r2(unidadesReponer),
        insumosConDeficit: Object.keys(deficitPorInsumo).length,
        ubicacionesConDeficit,
      },
      // Las dos listas se construyen ordenadas y completas; los campos con `slice` son los que consume el
      // panel ejecutivo y `*Rank` los que alimentan el control Top N del dashboard de bodega. Se calculan una
      // sola vez para que ambos no puedan divergir.
      // Las dos listas se construyen ordenadas y completas; los campos con `slice` son los que consume el
      // panel ejecutivo y `*Rank` los que alimentan el control Top N del dashboard de bodega. Se calculan una
      // sola vez para que ambos no puedan divergir.
      saludStock: ESTADOS.map((e) => ({ nombre: e, cantidad: global[e] })),
      // Orden pensado para que el gráfico sea legible: primero las ubicaciones que COMBINAN agotado con
      // crítico/bajo mínimo/bajo ideal (son las accionables), y después las más agotadas. Al ordenar solo por
      // cantidad de problemas, las ubicaciones 100% agotadas copaban las primeras posiciones y el gráfico
      // parecía de un solo color aunque la mezcla existiera.
      saludPorUbicacion: saludPorUbicacionCompleta.slice(0, 8),
      // Serie propia del control Top N: los 10 extremos por cada lado. Enviar las 720 ubicaciones para
      // mostrar 5-10 filas infla el payload sin aportar nada, y con solo el top 10 el orden ascendente
      // mostraría como "mejores" las que no entraron al top.
      saludPorUbicacionExtremos: extremos(saludPorUbicacionCompleta),
      stockVsIdealCategoria: Object.keys(porCategoria)
        .map((nombre) => ({ nombre, actual: r2(porCategoria[nombre].actual), minimo: r2(porCategoria[nombre].minimo), ideal: r2(porCategoria[nombre].ideal) }))
        .sort((a, b) => b.ideal - a.ideal)
        .slice(0, 8),
      topDeficit: topDeficitCompleto.slice(0, 8),
      topDeficitRank: topDeficitCompleto,
      alertasPorCategoriaNivel: Object.keys(alertasCat)
        .map((nombre) => ({ nombre, ...alertasCat[nombre] }))
        .sort((a, b) => (b.AGOTADO + b.CRITICO + b.BAJO) - (a.AGOTADO + a.CRITICO + a.BAJO))
        .slice(0, 8),
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
    // Los acumulados siguen el período filtrado (antes era «inicio − 30 días» y se rotulaba "30 días").
    const ventana = { gte: startOfDay, lte: endOfDay };

    // Soporte de servicios generales y especiales: si no se especifica o es TODOS, conviven ambos
    const incluirEspeciales = !dto?.categoriaServicio || dto.categoriaServicio === 'ESPECIAL';
    const incluirGenerales = !dto?.categoriaServicio || dto.categoriaServicio === 'GENERAL';

    // El filtro por pulidor acota las OT del pulidor seleccionado (dimensión POLISHER).
    const seWhere: any = { deletedAt: null, ...(hayFiltro ? { agencia: filtro } : {}), ...(dto?.pulidorId ? { operadorId: dto.pulidorId } : {}) };

    const slWhere: any = {
      deletedAt: null,
      createdAt: ventana,
      ...(hayFiltro ? { bahia: { agencia: filtro } } : {}),
      ...(dto?.pulidorId ? { operadorId: dto.pulidorId } : {}),
      ...(dto?.categoriaServicio ? { catalogo: { categoria: dto.categoriaServicio } } : {}),
    };

    const [serviciosHoy, servicios30Dias, serviciosPendientes, lavados30Dias] = await Promise.all([
      incluirEspeciales
        ? this.prisma.servicioEspecial.findMany({
            where: { ...seWhere, createdAt: { gte: startOfDay, lte: endOfDay } },
            select: { estado: true, tipoServicio: true, tiempoEfectivoSeg: true, calificacionCalidad: true, precio: true, prioridad: true },
          })
        : Promise.resolve([]),
      incluirEspeciales
        ? this.prisma.servicioEspecial.findMany({
            where: { ...seWhere, createdAt: ventana },
            select: {
              estado: true, tipoServicio: true, tiempoEfectivoSeg: true,
              calificacionCalidad: true, precio: true, prioridad: true,
              createdAt: true, fechaFin: true,
              operador: { select: { id: true, name: true, lastname: true, agenciaId: true } },
            },
          })
        : Promise.resolve([]),
      incluirEspeciales
        ? this.prisma.servicioEspecial.findMany({
            where: { ...seWhere, estado: { in: ['Pendiente', 'En Proceso'] } },
            select: { estado: true, prioridad: true, tipoServicio: true, placa: true, clienteNombre: true, fechaProgramada: true },
            orderBy: [{ prioridad: 'desc' }, { fechaProgramada: 'asc' }],
            take: 10,
          })
        : Promise.resolve([]),
      incluirGenerales
        ? this.prisma.servicioLavado.findMany({
            where: slWhere,
            select: {
              estado: true,
              precio: true,
              createdAt: true,
              horaIngreso: true,
              catalogo: { select: { nombre: true, categoria: true } },
              operador: { select: { id: true, name: true, lastname: true, agenciaId: true } },
            },
          })
        : Promise.resolve([]),
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
    // Serie semanal (7 días anclados al fin del período)
    const flujoSemanal: Record<string, number> = {};
    const ultimoDia = new Date(endOfDay);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(ultimoDia); d.setDate(d.getDate() - i);
      flujoSemanal[this.aFechaISO(d)] = 0;
    }

    // Serie adaptativa del período completo (días o meses para adaptarse al filtro de semana/mes/año)
    const flujoPeriodo: Record<string, number> = {};
    const diffDias = Math.max(1, Math.round((endOfDay.getTime() - startOfDay.getTime()) / (24 * 3600 * 1000)));

    if (diffDias > 1 && diffDias <= 62) {
      const cur = new Date(startOfDay);
      while (cur <= endOfDay) {
        flujoPeriodo[this.aFechaISO(cur)] = 0;
        cur.setDate(cur.getDate() + 1);
      }
    } else if (diffDias > 62) {
      const cur = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1);
      while (cur <= endOfDay) {
        const mesKey = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
        flujoPeriodo[mesKey] = 0;
        cur.setMonth(cur.getMonth() + 1);
      }
    } else {
      for (const k of Object.keys(flujoSemanal)) {
        flujoPeriodo[k] = 0;
      }
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
      const kDia = this.aFechaISO(s.createdAt);
      const kMes = `${s.createdAt.getFullYear()}-${String(s.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (flujoSemanal[kDia] !== undefined) flujoSemanal[kDia]++;
      if (flujoPeriodo[kDia] !== undefined) flujoPeriodo[kDia]++;
      else if (flujoPeriodo[kMes] !== undefined) flujoPeriodo[kMes]++;
    }

    for (const l of lavados30Dias) {
      const nombre = l.catalogo?.nombre || 'Lavado General';
      tipoServicioCount[nombre] = (tipoServicioCount[nombre] || 0) + 1;
      if (l.estado === 'FINALIZADO' || l.estado === 'APROBADO') {
        ingresoTotal30d += Number(l.precio || 0);
      }
      const fechaL = l.horaIngreso || l.createdAt;
      const kDia = this.aFechaISO(fechaL);
      const kMes = `${fechaL.getFullYear()}-${String(fechaL.getMonth() + 1).padStart(2, '0')}`;
      if (flujoSemanal[kDia] !== undefined) flujoSemanal[kDia]++;
      if (flujoPeriodo[kDia] !== undefined) flujoPeriodo[kDia]++;
      else if (flujoPeriodo[kMes] !== undefined) flujoPeriodo[kMes]++;
    }

    const calificacionPromedio = calificaciones.length > 0 ? Number((calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length).toFixed(1)) : 0;
    const tiempoPromedioMin = serviciosConTiempo > 0 ? Math.round((tiempoEfectivoTotal / serviciosConTiempo) / 60) : 0;

    const topOperadores = Object.keys(operadoresCount).map(k => ({ nombre: k, servicios: operadoresCount[k] })).sort((a, b) => b.servicios - a.servicios).slice(0, 10);
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
      flujoSemanal: Object.keys(flujoSemanal).sort().map(hora => ({ hora, cantidad: flujoSemanal[hora] })),
      flujoPeriodo: Object.keys(flujoPeriodo).sort().map(hora => ({ hora, cantidad: flujoPeriodo[hora] })),
      tipoServicio: Object.keys(tipoServicioCount).map(k => ({ nombre: k, cantidad: tipoServicioCount[k] })).sort((a, b) => b.cantidad - a.cantidad),
      prioridad: Object.keys(prioridadCount).map(k => ({ nombre: k, cantidad: prioridadCount[k] })),
      estadosHoy: Object.keys(estadosHoy).filter(k => estadosHoy[k] > 0).map(k => ({ nombre: k, cantidad: estadosHoy[k] })),
      topOperadores,
      pulidores,
      colaActiva: serviciosPendientes.map(s => ({ placa: s.placa, cliente: s.clienteNombre, tipo: s.tipoServicio, estado: s.estado, prioridad: s.prioridad, fecha: s.fechaProgramada })),
    };
  }
}

