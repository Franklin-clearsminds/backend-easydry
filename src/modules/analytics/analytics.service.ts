import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DashboardAnalyticsDto, ConsumoQuimicosAnalyticsDto, RankingLavadoresDto } from './dto/analytics.dto.js';
import { ServiceStatus } from '@prisma/client';
import { SIN_RESULTADOS, resolverAlcance } from '../../common/permisos/alcance.js';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Filtro sobre agencias según el alcance del usuario (país, región o agencia). Lo que manda el cliente solo acota dentro de
   * ese alcance, nunca lo amplía; sin dato de su ámbito no se ve nada.
   */
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
    // 1. Alcance del usuario (país, región o agencia)
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    // 2. Rango de fecha (Por defecto hoy desde 00:00:00 hasta 23:59:59)
    const baseDate = dto.fecha ? new Date(dto.fecha) : new Date();
    const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);

    // Filtros para servicios
    const servicioWhere: any = {
      horaIngreso: { gte: startOfDay, lte: endOfDay },
    };

    if (hayFiltro) {
      servicioWhere.bahia = { agencia: filtro };
    }

    // Consultas paralelas para el dashboard
    const [
      serviciosHoy,
      totalLavadosHoy,
      incidentesAbiertos,
      alertasPendientes,
      maquinariasStats,
    ] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: servicioWhere,
        select: {
          id: true,
          estado: true,
          horaIngreso: true,
          horaInicio: true,
          horaSalida: true,
          bahia: { select: { id: true, nombre: true } },
          consumos: {
            select: {
              cantidadUsada: true,
              insumo: { select: { costoUnitarioUSD: true } },
            },
          },
        },
      }),
      this.prisma.servicioLavado.count({ where: servicioWhere }),
      this.prisma.incidenteTecnico.count({
        where: {
          estado: { notIn: ['RESUELTO', 'CANCELADO'] },
          ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {}),
        },
      }),
      this.prisma.alertaStock.count({
        where: {
          estado: { notIn: ['RESUELTO', 'DESPACHADO'] },
          ...(hayFiltro ? { agencia: filtro } : {}),
        },
      }),
      this.prisma.maquinaria.groupBy({
        by: ['estadoOperativo'],
        _count: { id: true },
        where: hayFiltro ? { agencia: filtro } : {},
      }),
    ]);

    // Calcular desglose de estados
    const estadosCount: Record<string, number> = {
      EN_ESPERA: 0,
      EN_PROCESO: 0,
      FINALIZADO: 0,
      CANCELADO: 0,
    };

    let tiempoTotalMinutos = 0;
    let serviciosFinalizadosConTiempo = 0;
    let costoTotalQuimicosUSD = 0;
    const bahiasFrecuencia: Record<string, { id: string; nombre: string; total: number }> = {};

    for (const s of serviciosHoy) {
      estadosCount[s.estado] = (estadosCount[s.estado] || 0) + 1;

      // Tiempo de ciclo en finalizados
      if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) {
        const inicio = s.horaInicio || s.horaIngreso;
        const duracionMs = new Date(s.horaSalida).getTime() - new Date(inicio).getTime();
        const duracionMin = Math.max(0, Math.round(duracionMs / (1000 * 60)));
        tiempoTotalMinutos += duracionMin;
        serviciosFinalizadosConTiempo++;
      }

      // Costo de químicos
      if (s.consumos && s.consumos.length > 0) {
        for (const c of s.consumos) {
          const cant = Number(c.cantidadUsada || 0);
          const costoUnit = Number(c.insumo?.costoUnitarioUSD || 0);
          costoTotalQuimicosUSD += cant * costoUnit;
        }
      }

      // Bahía más activa
      if (s.bahia) {
        if (!bahiasFrecuencia[s.bahia.id]) {
          bahiasFrecuencia[s.bahia.id] = { id: s.bahia.id, nombre: s.bahia.nombre, total: 0 };
        }
        bahiasFrecuencia[s.bahia.id].total++;
      }
    }

    const tiempoPromedioMin = serviciosFinalizadosConTiempo > 0
      ? Math.round(tiempoTotalMinutos / serviciosFinalizadosConTiempo)
      : 0;

    let bahiaMasActiva: { id: string; nombre: string; total: number } | null = null;
    for (const bId in bahiasFrecuencia) {
      if (!bahiaMasActiva || bahiasFrecuencia[bId].total > bahiaMasActiva.total) {
        bahiaMasActiva = bahiasFrecuencia[bId];
      }
    }

    return {
      success: true,
      fechaConsultada: startOfDay.toISOString().split('T')[0],
      kpis: {
        totalLavadosHoy,
        lavadosFinalizados: estadosCount['FINALIZADO'] || 0,
        lavadosEnProceso: estadosCount['EN_PROCESO'] || 0,
        lavadosEnEspera: estadosCount['EN_ESPERA'] || 0,
        lavadosCancelados: estadosCount['CANCELADO'] || 0,
        tiempoPromedioMin,
        costoQuimicosTotalUSD: Number(costoTotalQuimicosUSD.toFixed(2)),
        bahiaMasActiva: bahiaMasActiva || { nombre: 'Sin actividad', total: 0 },
        incidentesAbiertos,
        alertasStockPendientes: alertasPendientes,
      },
      distribucionEstados: estadosCount,
      maquinariasPorEstado: maquinariasStats.reduce((acc, curr) => {
        acc[curr.estadoOperativo] = curr._count.id;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  async getConsumoQuimicos(dto: ConsumoQuimicosAnalyticsDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    // Rango de fechas
    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1); // inicio de mes
    const fechaHasta = dto.fechaHasta ? new Date(dto.fechaHasta) : ahora;

    const where: any = {
      createdAt: { gte: fechaDesde, lte: fechaHasta },
    };

    if (hayFiltro) {
      const agencias = await this.prisma.agencia.findMany({ where: filtro as any, select: { id: true } });
      where.agenciaId = { in: agencias.map((a) => a.id) };
    }

    const consumos = await this.prisma.consumoServicio.findMany({
      where,
      include: {
        insumo: {
          select: {
            id: true,
            codigoSKU: true,
            nombre: true,
            categoria: true,
            costoUnitarioUSD: true,
            unidadMedida: { select: { simbolo: true } },
          },
        },
      },
    });

    // Agrupación por Insumo
    const acumuladoPorInsumo: Record<string, {
      insumoId: string;
      codigoSKU: string;
      nombre: string;
      categoria: string;
      simboloUnidad: string;
      cantidadTotal: number;
      costoUnitario: number;
      costoTotalUSD: number;
      vecesConsumido: number;
    }> = {};

    let granTotalCostoUSD = 0;

    for (const c of consumos) {
      const insumoId = c.insumoId;
      const cant = Number(c.cantidadUsada);
      const costoUnit = Number(c.insumo.costoUnitarioUSD || 0);
      const costoSubtotal = cant * costoUnit;
      granTotalCostoUSD += costoSubtotal;

      if (!acumuladoPorInsumo[insumoId]) {
        // Nombre/SKU/unidad: preferir el snapshot congelado al momento del consumo
        // (sobrevive a que el producto cambie de nombre/SKU). Cae al dato actual
        // solo para registros creados antes de que existiera el snapshot.
        acumuladoPorInsumo[insumoId] = {
          insumoId,
          codigoSKU: c.insumoSKU || c.insumo.codigoSKU,
          nombre: c.insumoNombre || c.insumo.nombre,
          categoria: c.insumo.categoria,
          simboloUnidad: c.unidadSimbolo || c.insumo.unidadMedida?.simbolo || 'u',
          cantidadTotal: 0,
          costoUnitario: costoUnit,
          costoTotalUSD: 0,
          vecesConsumido: 0,
        };
      }

      acumuladoPorInsumo[insumoId].cantidadTotal += cant;
      acumuladoPorInsumo[insumoId].costoTotalUSD += costoSubtotal;
      acumuladoPorInsumo[insumoId].vecesConsumido += 1;
    }

    const listaOrdenada = Object.values(acumuladoPorInsumo)
      .map(item => ({
        ...item,
        cantidadTotal: Number(item.cantidadTotal.toFixed(3)),
        costoTotalUSD: Number(item.costoTotalUSD.toFixed(2)),
      }))
      .sort((a, b) => b.costoTotalUSD - a.costoTotalUSD);

    return {
      success: true,
      rango: {
        desde: fechaDesde.toISOString().split('T')[0],
        hasta: fechaHasta.toISOString().split('T')[0],
      },
      granTotalCostoUSD: Number(granTotalCostoUSD.toFixed(2)),
      totalInsumosDistintos: listaOrdenada.length,
      insumos: listaOrdenada,
    };
  }

  async getRankingLavadores(dto: RankingLavadoresDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const fechaHasta = dto.fechaHasta ? new Date(dto.fechaHasta) : ahora;

    const where: any = {
      estado: { in: [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO] },
      horaIngreso: { gte: fechaDesde, lte: fechaHasta },
    };

    if (hayFiltro) {
      where.bahia = { agencia: filtro };
    }

    const servicios = await this.prisma.servicioLavado.findMany({
      where,
      select: {
        operadorId: true,
        horaIngreso: true,
        horaSalida: true,
        operador: { select: { id: true, name: true, lastname: true } },
      },
    });

    const acumuladoPorOperador: Record<string, {
      operadorId: string;
      nombre: string;
      cantidadServicios: number;
      tiempoTotalMin: number;
      serviciosConTiempo: number;
    }> = {};

    for (const s of servicios) {
      if (!s.operadorId) continue;
      if (!acumuladoPorOperador[s.operadorId]) {
        acumuladoPorOperador[s.operadorId] = {
          operadorId: s.operadorId,
          nombre: s.operador ? `${s.operador.name} ${s.operador.lastname}` : 'Operador',
          cantidadServicios: 0,
          tiempoTotalMin: 0,
          serviciosConTiempo: 0,
        };
      }
      const acc = acumuladoPorOperador[s.operadorId];
      acc.cantidadServicios += 1;
      if (s.horaSalida) {
        const duracionMs = new Date(s.horaSalida).getTime() - new Date(s.horaIngreso).getTime();
        acc.tiempoTotalMin += Math.max(0, Math.round(duracionMs / (1000 * 60)));
        acc.serviciosConTiempo += 1;
      }
    }

    const ranking = Object.values(acumuladoPorOperador)
      .map((a) => ({
        operadorId: a.operadorId,
        nombre: a.nombre,
        cantidadServicios: a.cantidadServicios,
        tiempoPromedioMin: a.serviciosConTiempo > 0 ? Math.round(a.tiempoTotalMin / a.serviciosConTiempo) : 0,
      }))
      .sort((a, b) => b.cantidadServicios - a.cantidadServicios)
      .slice(0, 10);

    return {
      success: true,
      rango: {
        desde: fechaDesde.toISOString().split('T')[0],
        hasta: fechaHasta.toISOString().split('T')[0],
      },
      ranking,
    };
  }
}
