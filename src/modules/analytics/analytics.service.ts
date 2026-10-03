import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardAnalyticsDto, ConsumoQuimicosAnalyticsDto, RankingLavadoresDto } from './dto/analytics.dto.js';
import { ServiceStatus } from '@prisma/client';
import { SIN_RESULTADOS, resolverAlcance } from '../../common/permisos/alcance.js';

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

  async getDashboardMetrics(dto: DashboardAnalyticsDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    const baseDate = dto.fecha ? new Date(dto.fecha) : new Date();
    const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
    const hace30Dias = new Date(); hace30Dias.setDate(hace30Dias.getDate() - 30);

    const roleName = user?.role?.namerol;

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
    return this.getEjecutivoMetrics(filtro, hayFiltro, startOfDay, endOfDay, hace30Dias, isSupervisorView);
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
      },
      flujoHorario: Object.keys(flujoUsuarios).sort().map(hora => ({ hora, cantidad: flujoUsuarios[hora] })),
      distribucionRoles,
      distribucionDecisiones: decisionesAgrupadas.map(d => ({ nombre: d.accion, total: d._count.id })).sort((a, b) => b.total - a.total),
      distribucionCategorias: serviciosPorCategoria.map(s => ({ nombre: s.categoria, total: s._count.id })).sort((a, b) => b.total - a.total),
    };
  }

  // ═══ APROBADOR ═══════════════════════════════════════════════════════
  private async getAprobadorMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date) {
    const whereBase = hayFiltro ? { agencia: filtro } : {};

    const [todasSolicitudes, solicitudesHoy] = await Promise.all([
      this.prisma.solicitudAprobacion.findMany({ where: { createdAt: { gte: hace30Dias }, ...whereBase }, select: { tipo: true, estado: true, createdAt: true, montoUSD: true } }),
      this.prisma.solicitudAprobacion.findMany({ where: { createdAt: { gte: startOfDay, lte: endOfDay }, ...whereBase }, select: { tipo: true, estado: true, montoUSD: true } }),
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

    return {
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      kpis: { pendientesHoy, aprobadasHoy, rechazadasHoy, montoAprobadoHoy: Number(montoAprobadoHoy.toFixed(2)), totalHoy: solicitudesHoy.length },
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
        select: { horaIngreso: true, marca: true, catalogo: { select: { nombre: true, categoria: true } }, consumos: { select: { cantidadUsada: true, insumo: { select: { costoUnitarioUSD: true } } } } },
      }),
      this.prisma.servicioLavado.count({ where: { horaIngreso: { gte: startOfDay, lte: endOfDay }, ...base30 } }),
      this.prisma.solicitudAprobacion.findMany({
        where: { tipo: { in: ['SERVICIO_ESPECIAL_PRECIO', 'DESCUENTO'] }, createdAt: { gte: hace30Dias }, ...(hayFiltro ? { agencia: filtro } : {}) },
        select: { tipo: true, estado: true, createdAt: true },
      }),
    ]);

    const mix: Record<string, number> = {};
    const marcas: Record<string, number> = {};
    let costoQuimicos30d = 0;
    const flujoServicios: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      flujoServicios[d.toISOString().split('T')[0]] = 0;
    }

    for (const s of servicios30Dias) {
      if (s.catalogo?.nombre) mix[s.catalogo.nombre] = (mix[s.catalogo.nombre] || 0) + 1;
      if (s.marca) marcas[s.marca] = (marcas[s.marca] || 0) + 1;
      for (const c of s.consumos || []) costoQuimicos30d += Number(c.cantidadUsada || 0) * Number(c.insumo?.costoUnitarioUSD || 0);
      const k = s.horaIngreso.toISOString().split('T')[0];
      if (flujoServicios[k] !== undefined) flujoServicios[k]++;
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
      },
      flujoHorario: Object.keys(flujoServicios).sort().map(hora => ({ hora, cantidad: flujoServicios[hora] })),
      mixServicios: Object.keys(mix).map(k => ({ nombre: k, cantidad: mix[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 7),
      topMarcas: Object.keys(marcas).map(k => ({ nombre: k, cantidad: marcas[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 7),
      solicitudesComerciales: Object.keys(estComercial).map(k => ({ nombre: k, cantidad: estComercial[k] })),
    };
  }

  // ═══ EJECUTIVO GENERAL (Supervisor, Líder Operador, Super Admin) ═════
  private async getEjecutivoMetrics(filtro: any, hayFiltro: boolean, startOfDay: Date, endOfDay: Date, hace30Dias: Date, isSupervisorView: boolean) {
    const servicioWhere: any = { horaIngreso: { gte: startOfDay, lte: endOfDay } };
    if (hayFiltro) servicioWhere.bahia = { agencia: filtro };

    const [serviciosHoy, totalLavadosHoy, incidentesAbiertos, alertasPendientes, maquinariasStats, todosIncidentes30Dias] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: servicioWhere,
        select: {
          id: true, estado: true, horaIngreso: true, horaInicio: true, horaSalida: true, marca: true,
          catalogo: { select: { nombre: true, categoria: true } },
          bahia: { select: { id: true, nombre: true } },
          consumos: { select: { cantidadUsada: true, insumo: { select: { costoUnitarioUSD: true } } } },
        },
      }),
      this.prisma.servicioLavado.count({ where: servicioWhere }),
      this.prisma.incidenteTecnico.count({ where: { estado: { notIn: ['RESUELTO', 'CANCELADO'] }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) } }),
      this.prisma.alertaStock.findMany({ where: { estado: { notIn: ['RESUELTO', 'DESPACHADO'] }, ...(hayFiltro ? { agencia: filtro } : {}) }, orderBy: { createdAt: 'desc' }, take: 10, include: { agencia: { select: { nombre: true } }, pulidor: { select: { name: true, lastname: true } } } }),
      this.prisma.maquinaria.groupBy({ by: ['estadoOperativo'], _count: { id: true }, where: hayFiltro ? { agencia: filtro } : {} }),
      this.prisma.incidenteTecnico.findMany({ where: { createdAt: { gte: hace30Dias }, ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) }, include: { maquinaria: { select: { codigo: true, nombre: true, tipo: true, agencia: { select: { nombre: true } } } } } }),
    ]);

    const estadosCount: Record<string, number> = { EN_ESPERA: 0, EN_PROCESO: 0, FINALIZADO: 0, CANCELADO: 0 };
    let tiempoTotalMinutos = 0, serviciosFinalizadosConTiempo = 0, costoTotalQuimicosUSD = 0;
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
      }
      for (const c of s.consumos || []) costoTotalQuimicosUSD += Number(c.cantidadUsada || 0) * Number(c.insumo?.costoUnitarioUSD || 0);
      if (s.bahia) {
        if (!bahiasStats[s.bahia.id]) bahiasStats[s.bahia.id] = { id: s.bahia.id, nombre: s.bahia.nombre, total: 0, tiempoTotalMin: 0, finalizados: 0 };
        bahiasStats[s.bahia.id].total++;
        if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) { bahiasStats[s.bahia.id].finalizados++; bahiasStats[s.bahia.id].tiempoTotalMin += duracionMin; }
      }
    }

    const tiempoPromedioMin = serviciosFinalizadosConTiempo > 0 ? Math.round(tiempoTotalMinutos / serviciosFinalizadosConTiempo) : 0;
    const distribucionBahias = Object.values(bahiasStats).map(b => ({ nombre: b.nombre, total: b.total })).sort((a, b) => b.total - a.total).slice(0, 7);
    const tiemposBahias = Object.values(bahiasStats).filter(b => b.finalizados > 0).map(b => ({ nombre: b.nombre, promedio: Math.round(b.tiempoTotalMin / b.finalizados) })).sort((a, b) => a.promedio - b.promedio).slice(0, 7);
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
        tiempoPromedioMin, costoQuimicosTotalUSD: Number(costoTotalQuimicosUSD.toFixed(2)), bahiaMasActiva,
        incidentesAbiertos, alertasStockPendientes: alertasPendientes.length,
        alertasCriticas: alertasPendientes.filter(a => a.nivel === 'CRITICO').length,
      },
      flujoHorario: flujoArr,
      distribucionBahias: isSupervisorView ? topAgenciasIncidentes : distribucionBahias,
      tiemposBahias,
      topMaquinasDañadas: isSupervisorView ? topAgenciasIncidentes : topMaquinasDañadas,
      topAgenciasIncidentes,
      mixServicios: Object.keys(mixServicios).map(k => ({ nombre: k, cantidad: mixServicios[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 6),
      topMarcas: Object.keys(topMarcas).map(k => ({ nombre: k, cantidad: topMarcas[k] })).sort((a, b) => b.cantidad - a.cantidad).slice(0, 5),
      incidentesPorTipo: Object.keys(incidentesPorTipo).map(k => ({ nombre: k, cantidad: incidentesPorTipo[k] })),
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
      if (!acumuladoPorInsumo[c.insumoId]) acumuladoPorInsumo[c.insumoId] = { insumoId: c.insumoId, codigoSKU: c.insumoSKU || c.insumo.codigoSKU, nombre: c.insumoNombre || c.insumo.nombre, categoria: c.insumo.categoria, simboloUnidad: c.unidadSimbolo || c.insumo.unidadMedida?.simbolo || 'u', cantidadTotal: 0, costoUnitario: costoUnit, costoTotalUSD: 0, vecesConsumido: 0 };
      acumuladoPorInsumo[c.insumoId].cantidadTotal += cant;
      acumuladoPorInsumo[c.insumoId].costoTotalUSD += costoSubtotal;
      acumuladoPorInsumo[c.insumoId].vecesConsumido++;
    }

    const listaOrdenada = Object.values(acumuladoPorInsumo).map(item => ({ ...item, cantidadTotal: Number(item.cantidadTotal.toFixed(3)), costoTotalUSD: Number(item.costoTotalUSD.toFixed(2)) })).sort((a, b) => b.costoTotalUSD - a.costoTotalUSD);
    return { success: true, rango: { desde: fechaDesde.toISOString().split('T')[0], hasta: fechaHasta.toISOString().split('T')[0] }, granTotalCostoUSD: Number(granTotalCostoUSD.toFixed(2)), totalInsumosDistintos: listaOrdenada.length, insumos: listaOrdenada, consumoPorAgencia: Object.keys(consumoPorAgencia).map(k => ({ nombre: k, costo: Number(consumoPorAgencia[k].toFixed(2)) })).sort((a, b) => b.costo - a.costo).slice(0, 5), consumoPorCategoria: Object.keys(consumoPorCategoria).map(k => ({ nombre: k, cantidad: Number(consumoPorCategoria[k].toFixed(2)) })) };
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
    const ranking = Object.values(acumulado).map(a => ({ operadorId: a.operadorId, nombre: a.nombre, cantidadServicios: a.cantidadServicios, tiempoPromedioMin: a.serviciosConTiempo > 0 ? Math.round(a.tiempoTotalMin / a.serviciosConTiempo) : 0 })).sort((a, b) => b.cantidadServicios - a.cantidadServicios).slice(0, 10);
    return { success: true, rango: { desde: fechaDesde.toISOString().split('T')[0], hasta: fechaHasta.toISOString().split('T')[0] }, ranking };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DASHBOARD TALLER: Coordinador Mantenimiento + Técnico
  // Datos reales: incidentes, mantenimientos, maquinaria, costos de reparación
  // ═══════════════════════════════════════════════════════════════════════
  async getDashboardTaller(user: any) {
    const filtro = this.filtroAgencia(user, {});
    const hayFiltro = Object.keys(filtro).length > 0;
    const maqWhere = hayFiltro ? { agencia: filtro } : {};
    const incWhere: any = { ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}) };
    const hace30Dias = new Date(); hace30Dias.setDate(hace30Dias.getDate() - 30);
    const hoy = new Date(); const startOfDay = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);

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
  async getDashboardBodega(user: any) {
    const filtro = this.filtroAgencia(user, {});
    const hayFiltro = Object.keys(filtro).length > 0;
    const hace30Dias = new Date(); hace30Dias.setDate(hace30Dias.getDate() - 30);

    // Obtener las bodegas del usuario
    const bodegaWhere: any = {};
    if (hayFiltro && filtro['regionId']) bodegaWhere.regionId = filtro['regionId'];

    const [alertasActivas, movimientos30Dias, stocks] = await Promise.all([
      this.prisma.alertaStock.findMany({
        where: { estado: { notIn: ['RESUELTO', 'DESPACHADO'] }, ...(hayFiltro ? { agencia: filtro } : {}) },
        include: { insumo: { select: { nombre: true, categoria: true } }, agencia: { select: { nombre: true } } },
        orderBy: [{ nivel: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.movimientoInventario.findMany({
        where: { createdAt: { gte: hace30Dias }, ...(hayFiltro ? { OR: [{ origenAgenciaId: { not: null } }, { destinoAgenciaId: { not: null } }] } : {}) },
        select: { tipo: true, estadoDespacho: true, createdAt: true, detalles: { select: { cantidadEnviada: true, costoUnitarioUSD: true, insumo: { select: { nombre: true, categoria: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.prisma.stockUbicacion.findMany({
        where: { cantidadActual: { gt: 0 } },
        include: { insumo: { select: { nombre: true, categoria: true, costoUnitarioUSD: true } } },
        take: 100,
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
        const cat = d.insumo?.categoria || 'Sin Categoría';
        consumoPorCategoria[cat] = (consumoPorCategoria[cat] || 0) + Number(d.cantidadEnviada || 0);
      }
    }

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
  async getDashboardEspeciales(user: any) {
    const filtro = this.filtroAgencia(user, {});
    const hayFiltro = Object.keys(filtro).length > 0;
    const hace30Dias = new Date(); hace30Dias.setDate(hace30Dias.getDate() - 30);
    const hoy = new Date();
    const startOfDay = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
    const endOfDay = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);

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
          operador: { select: { name: true, lastname: true } },
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
      }
      const k = s.createdAt.toISOString().split('T')[0];
      if (flujoDiario[k] !== undefined) flujoDiario[k]++;
    }

    const calificacionPromedio = calificaciones.length > 0 ? Number((calificaciones.reduce((a, b) => a + b, 0) / calificaciones.length).toFixed(1)) : 0;
    const tiempoPromedioMin = serviciosConTiempo > 0 ? Math.round((tiempoEfectivoTotal / serviciosConTiempo) / 60) : 0;

    const topOperadores = Object.keys(operadoresCount).map(k => ({ nombre: k, servicios: operadoresCount[k] })).sort((a, b) => b.servicios - a.servicios).slice(0, 5);

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
      colaActiva: serviciosPendientes.map(s => ({ placa: s.placa, cliente: s.clienteNombre, tipo: s.tipoServicio, estado: s.estado, prioridad: s.prioridad, fecha: s.fechaProgramada })),
    };
  }
}

