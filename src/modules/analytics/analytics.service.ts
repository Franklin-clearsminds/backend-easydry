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
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    const baseDate = dto.fecha ? new Date(dto.fecha) : new Date();
    const startOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0);
    const endOfDay = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 23, 59, 59, 999);
    const hace30Dias = new Date();
    hace30Dias.setDate(hace30Dias.getDate() - 30);

    const servicioWhere: any = {
      horaIngreso: { gte: startOfDay, lte: endOfDay },
    };

    if (hayFiltro) {
      servicioWhere.bahia = { agencia: filtro };
    }

    const [
      serviciosHoy,
      totalLavadosHoy,
      incidentesAbiertos,
      alertasPendientes,
      maquinariasStats,
      todosIncidentes30Dias
    ] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: servicioWhere,
        select: {
          id: true,
          estado: true,
          horaIngreso: true,
          horaInicio: true,
          horaSalida: true,
          marca: true,
          catalogo: { select: { nombre: true, categoria: true } },
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
      this.prisma.alertaStock.findMany({
        where: {
          estado: { notIn: ['RESUELTO', 'DESPACHADO'] },
          ...(hayFiltro ? { agencia: filtro } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          agencia: { select: { nombre: true } },
          pulidor: { select: { name: true, lastname: true, region: { select: { nombre: true } } } },
        }
      }),
      this.prisma.maquinaria.groupBy({
        by: ['estadoOperativo'],
        _count: { id: true },
        where: hayFiltro ? { agencia: filtro } : {},
      }),
      this.prisma.incidenteTecnico.findMany({
        where: {
          createdAt: { gte: hace30Dias },
          ...(hayFiltro ? { maquinaria: { agencia: filtro } } : {})
        },
        include: {
          maquinaria: { select: { codigo: true, nombre: true, tipo: true, agencia: { select: { nombre: true } } } }
        }
      })
    ]);

    const estadosCount: Record<string, number> = {
      EN_ESPERA: 0, EN_PROCESO: 0, FINALIZADO: 0, CANCELADO: 0,
    };

    let tiempoTotalMinutos = 0;
    let serviciosFinalizadosConTiempo = 0;
    let costoTotalQuimicosUSD = 0;
    
    // Para bahías y mix de servicios
    const bahiasStats: Record<string, { id: string; nombre: string; total: number; tiempoTotalMin: number; finalizados: number }> = {};
    const mixServicios: Record<string, number> = {};
    const topMarcas: Record<string, number> = {};
    const flujoHorario: Record<string, number> = {};
    for (let i = 7; i <= 21; i++) {
      flujoHorario[`${i.toString().padStart(2, '0')}:00`] = 0;
    }

    for (const s of serviciosHoy) {
      estadosCount[s.estado] = (estadosCount[s.estado] || 0) + 1;

      const time = s.horaInicio || s.horaIngreso;
      if (time) {
        const hour = new Date(time).getHours();
        const key = `${hour.toString().padStart(2, '0')}:00`;
        if (flujoHorario[key] !== undefined) flujoHorario[key]++;
        else flujoHorario[key] = 1;
      }
      
      if (s.catalogo?.nombre) {
        const catName = s.catalogo.nombre;
        mixServicios[catName] = (mixServicios[catName] || 0) + 1;
      }
      
      if (s.marca) {
        topMarcas[s.marca] = (topMarcas[s.marca] || 0) + 1;
      }

      let duracionMin = 0;
      if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) {
        const inicio = s.horaInicio || s.horaIngreso;
        duracionMin = Math.max(0, Math.round((new Date(s.horaSalida).getTime() - new Date(inicio).getTime()) / (1000 * 60)));
        tiempoTotalMinutos += duracionMin;
        serviciosFinalizadosConTiempo++;
      }

      if (s.consumos && s.consumos.length > 0) {
        for (const c of s.consumos) {
          costoTotalQuimicosUSD += Number(c.cantidadUsada || 0) * Number(c.insumo?.costoUnitarioUSD || 0);
        }
      }

      if (s.bahia) {
        if (!bahiasStats[s.bahia.id]) {
          bahiasStats[s.bahia.id] = { id: s.bahia.id, nombre: s.bahia.nombre, total: 0, tiempoTotalMin: 0, finalizados: 0 };
        }
        bahiasStats[s.bahia.id].total++;
        if (s.estado === ServiceStatus.FINALIZADO && s.horaSalida) {
          bahiasStats[s.bahia.id].finalizados++;
          bahiasStats[s.bahia.id].tiempoTotalMin += duracionMin;
        }
      }
    }

    const tiempoPromedioMin = serviciosFinalizadosConTiempo > 0 ? Math.round(tiempoTotalMinutos / serviciosFinalizadosConTiempo) : 0;
    
    let bahiaMasActiva: { id: string; nombre: string; total: number } | null = null;
    const distribucionBahias = [];
    const tiemposBahias = [];

    for (const bId in bahiasStats) {
      const b = bahiasStats[bId];
      if (!bahiaMasActiva || b.total > bahiaMasActiva.total) bahiaMasActiva = b;
      distribucionBahias.push({ nombre: b.nombre, total: b.total });
      if (b.finalizados > 0) {
        tiemposBahias.push({ nombre: b.nombre, promedio: Math.round(b.tiempoTotalMin / b.finalizados) });
      }
    }
    
    distribucionBahias.sort((a, b) => b.total - a.total);
    tiemposBahias.sort((a, b) => a.promedio - b.promedio); // Menor a mayor tiempo es mejor
    
    // Limitar bahías para no saturar gráficos si hay más de 7
    const topDistribucionBahias = distribucionBahias.slice(0, 7);
    const topTiemposBahias = tiemposBahias.slice(0, 7);

    const flujoArr = Object.keys(flujoHorario).sort().map(hora => ({ hora, cantidad: flujoHorario[hora] }));

    // Procesar Incidentes (Maquinas y Agencias)
    const maquinasDañadas: Record<string, { nombre: string, total: number }> = {};
    const agenciasIncidentes: Record<string, { nombre: string, total: number }> = {};
    const incidentesPorTipo: Record<string, number> = {};
    
    for (const inc of todosIncidentes30Dias) {
      if (inc.maquinaria) {
        const mKey = `${inc.maquinaria.codigo} - ${inc.maquinaria.nombre}`;
        if (!maquinasDañadas[mKey]) maquinasDañadas[mKey] = { nombre: mKey, total: 0 };
        maquinasDañadas[mKey].total++;
        
        const tipo = inc.maquinaria.tipo || 'Desconocido';
        incidentesPorTipo[tipo] = (incidentesPorTipo[tipo] || 0) + 1;
        
        const aKey = inc.maquinaria.agencia?.nombre || 'Desconocida';
        if (!agenciasIncidentes[aKey]) agenciasIncidentes[aKey] = { nombre: aKey, total: 0 };
        agenciasIncidentes[aKey].total++;
      }
    }

    const topMaquinasDañadas = Object.values(maquinasDañadas).sort((a, b) => b.total - a.total).slice(0, 5);
    const topAgenciasIncidentes = Object.values(agenciasIncidentes).sort((a, b) => b.total - a.total).slice(0, 5);

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
        alertasStockPendientes: alertasPendientes.length,
        alertasCriticas: alertasPendientes.filter(a => a.nivel === 'CRITICO').length,
      },
      flujoHorario: flujoArr,
      distribucionBahias: topDistribucionBahias,
      tiemposBahias: topTiemposBahias,
      topMaquinasDañadas,
      topAgenciasIncidentes,
      alertasRecientes: alertasPendientes.map(a => ({
        id: a.id,
        mensaje: a.mensaje,
        nivel: a.nivel,
        createdAt: a.createdAt,
        agencia: a.agencia?.nombre,
        pulidor: a.pulidor ? `${a.pulidor.name} ${a.pulidor.lastname}` : null,
      })),
      distribucionEstados: estadosCount,
      maquinariasPorEstado: maquinariasStats.reduce((acc, curr) => {
        acc[curr.estadoOperativo] = curr._count.id;
        return acc;
      }, {} as Record<string, number>),
      mixServicios: Object.keys(mixServicios).map(k => ({ nombre: k, cantidad: mixServicios[k] })).sort((a,b)=>b.cantidad-a.cantidad).slice(0, 6),
      topMarcas: Object.keys(topMarcas).map(k => ({ nombre: k, cantidad: topMarcas[k] })).sort((a,b)=>b.cantidad-a.cantidad).slice(0, 5),
      incidentesPorTipo: Object.keys(incidentesPorTipo).map(k => ({ nombre: k, cantidad: incidentesPorTipo[k] }))
    };
  }

  async getConsumoQuimicos(dto: ConsumoQuimicosAnalyticsDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    // Rango de fechas
    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1); // inicio de mes
    
    let fechaHasta = ahora;
    if (dto.fechaHasta) {
      fechaHasta = new Date(dto.fechaHasta);
      // Asegurar que abarque todo el día si viene sin hora
      if (dto.fechaHasta.length <= 10) {
        fechaHasta.setUTCHours(23, 59, 59, 999);
      }
    }

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
        servicio: { select: { bahia: { select: { agencia: { select: { nombre: true } } } } } }
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

    const consumoPorAgencia: Record<string, number> = {};
    const consumoPorCategoria: Record<string, number> = {};
    let granTotalCostoUSD = 0;

    for (const c of consumos) {
      const insumoId = c.insumoId;
      const cant = Number(c.cantidadUsada);
      const costoUnit = Number(c.insumo.costoUnitarioUSD || 0);
      const costoSubtotal = cant * costoUnit;
      granTotalCostoUSD += costoSubtotal;
      
      const agenciaKey = c.servicio?.bahia?.agencia?.nombre || 'Agencia General';
      consumoPorAgencia[agenciaKey] = (consumoPorAgencia[agenciaKey] || 0) + cant; // Using quantity instead of cost
      
      const catKey = c.insumo.categoria || 'Sin Categoría';
      consumoPorCategoria[catKey] = (consumoPorCategoria[catKey] || 0) + cant;

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
      consumoPorAgencia: Object.keys(consumoPorAgencia).map(k => ({ nombre: k, costo: Number(consumoPorAgencia[k].toFixed(2)) })).sort((a,b)=>b.costo-a.costo).slice(0, 5),
      consumoPorCategoria: Object.keys(consumoPorCategoria).map(k => ({ nombre: k, cantidad: Number(consumoPorCategoria[k].toFixed(2)) }))
    };
  }

  async getRankingLavadores(dto: RankingLavadoresDto, user: any) {
    const filtro = this.filtroAgencia(user, dto);
    const hayFiltro = Object.keys(filtro).length > 0;

    const ahora = new Date();
    const fechaDesde = dto.fechaDesde ? new Date(dto.fechaDesde) : new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    
    let fechaHasta = ahora;
    if (dto.fechaHasta) {
      fechaHasta = new Date(dto.fechaHasta);
      if (dto.fechaHasta.length <= 10) {
        fechaHasta.setUTCHours(23, 59, 59, 999);
      }
    }

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
