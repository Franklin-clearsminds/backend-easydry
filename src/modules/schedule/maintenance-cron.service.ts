import { Injectable, Logger, Optional } from '@nestjs/common';
import { CacheService } from '../../common/cache/cache.service.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FUNCION, rolConFuncion } from '../../common/permisos/funciones.js';
import { esHoyDiaDebido, limpiezaAtrasada, reglaLimpieza } from '../../common/utils/limpieza-maquinaria.js';

@Injectable()
export class MaintenanceCronService {
  private readonly logger = new Logger(MaintenanceCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  // La purga de SyncOutboxAudit (más de 90 días) pasó al módulo `archivado`: ahora se archiva a Parquet antes de borrar.

  @Cron('0 6 * * *')
  async programado_verificarMantenimientosVencidos(): Promise<void> {
    // Con varias instancias del servidor, solo una la ejecuta (candado en Redis con vencimiento propio).
    const tarea = async () => {
      await this.verificarMantenimientosVencidos();
    };
    if (this.cache) await this.cache.unaVez('cron:verificarMantenimientosVencidos', 3600, tarea);
    else await tarea();
  }

  // Cron diario: Todos los días a las 06:00 AM (Detección de mantenimientos preventivos vencidos)
  async verificarMantenimientosVencidos() {
    this.logger.log('[Cron] Verificando mantenimientos de maquinaria con fecha vencida...');
    const now = new Date();

    try {
      // Vencido = ya pasó su fecha programada y sigue sin ejecutarse (los finalizados no cuentan).
      const mantenimientosVencidos = await this.prisma.mantenimientoMaquinaria.findMany({
        where: {
          estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
          fechaProgramada: { lt: now },
          maquinaria: { activa: true, estadoOperativo: { not: 'DE_BAJA' } },
        },
        include: {
          maquinaria: { include: { agencia: { select: { regionId: true } } } },
        },
        take: 200,
      });

      for (const m of mantenimientosVencidos) {
        this.logger.warn(`[Mantenimiento Alerta] La máquina ${m.maquinaria.codigo} (${m.maquinaria.nombre}) tiene un mantenimiento vencido desde ${m.fechaProgramada?.toISOString()}`);
        // Solo el coordinador de mantenimiento de la región de la máquina.
        await this.notifications.notificarCoordinadorRegion({
          regionId: m.maquinaria.agencia?.regionId,
          title: `Mantenimiento vencido: ${m.maquinaria.codigo}`,
          body: `${m.maquinaria.nombre} no se ha atendido desde ${m.fechaProgramada?.toISOString().slice(0, 10)}`,
          data: { type: 'MANTENIMIENTO_VENCIDO', mantenimientoId: m.id, maquinariaId: m.maquinariaId },
          opts: { tipo: 'MANTENIMIENTO_VENCIDO', entidadTipo: 'MAQUINARIA', entidadId: m.maquinariaId },
        });
      }

      return { count: mantenimientosVencidos.length };
    } catch (err: any) {
      this.logger.error(`[Cron] Error verificando mantenimientos: ${err.message}`);
      return { error: err.message };
    }
  }

  /** Máquinas activas a las que les aplica alguna regla de limpieza (con agencia o pulidor asignado). */
  private candidatasLimpieza() {
    return this.prisma.maquinaria.findMany({
      where: {
        activa: true,
        OR: [{ agenciaId: { not: null } }, { operadorAsignadoId: { not: null } }],
      },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        agenciaId: true,
        operadorAsignadoId: true,
        agencia: { select: { regionId: true } },
      },
      take: 500,
    });
  }

  @Cron('0 7 * * *')
  async programado_recordatorioLimpiezaDelDia(): Promise<void> {
    // Con varias instancias del servidor, solo una la ejecuta (candado en Redis con vencimiento propio).
    const tarea = async () => {
      await this.recordatorioLimpiezaDelDia();
    };
    if (this.cache) await this.cache.unaVez('cron:recordatorioLimpiezaDelDia', 3600, tarea);
    else await tarea();
  }

  // Cron diario: todos los días a las 07:00 AM (recordatorio al responsable el día que corresponde limpiar)
  async recordatorioLimpiezaDelDia() {
    this.logger.log('[Cron] Verificando recordatorios de limpieza del día...');
    const hoy = new Date();
    try {
      const candidatas = await this.candidatasLimpieza();
      const debidasHoy = candidatas.filter((m) => esHoyDiaDebido(reglaLimpieza(m), hoy));
      if (!debidasHoy.length) return { count: 0 };

      const inicioDia = new Date(hoy); inicioDia.setHours(0, 0, 0, 0);
      const finDia = new Date(hoy); finDia.setHours(23, 59, 59, 999);
      const yaRegistradas = await this.prisma.limpiezaMaquinaria.findMany({
        where: { maquinariaId: { in: debidasHoy.map((m) => m.id) }, fecha: { gte: inicioDia, lte: finDia } },
        select: { maquinariaId: true },
      });
      const registradasIds = new Set(yaRegistradas.map((r) => r.maquinariaId));

      let count = 0;
      for (const m of debidasHoy) {
        if (registradasIds.has(m.id)) continue;
        const responsables = m.operadorAsignadoId
          ? [m.operadorAsignadoId]
          : m.agenciaId
            ? (await this.prisma.user.findMany({
              where: { agenciaId: m.agenciaId, estado: 1, role: rolConFuncion(FUNCION.LIDER_AGENCIA) },
              select: { id: true },
            })).map((u) => u.id)
            : [];
        if (!responsables.length) continue;
        await this.notifications.notificarUsuarios(
          responsables,
          `Limpieza pendiente hoy: ${m.codigo}`,
          `${m.nombre} tiene limpieza programada para hoy.`,
          { type: 'LIMPIEZA_RECORDATORIO', maquinariaId: m.id },
          { tipo: 'LIMPIEZA_RECORDATORIO', entidadTipo: 'MAQUINARIA', entidadId: m.id },
        );
        count++;
      }
      return { count };
    } catch (err: any) {
      this.logger.error(`[Cron] Error en recordatorio de limpieza: ${err.message}`);
      return { error: err.message };
    }
  }

  @Cron('0 8 * * *')
  async programado_escalarLimpiezaAtrasada(): Promise<void> {
    // Con varias instancias del servidor, solo una la ejecuta (candado en Redis con vencimiento propio).
    const tarea = async () => {
      await this.escalarLimpiezaAtrasada();
    };
    if (this.cache) await this.cache.unaVez('cron:escalarLimpiezaAtrasada', 3600, tarea);
    else await tarea();
  }

  // Cron diario: todos los días a las 08:00 AM, una hora después del recordatorio (escalación al coordinador)
  async escalarLimpiezaAtrasada() {
    this.logger.log('[Cron] Verificando máquinas atrasadas de limpieza...');
    const ahora = new Date();
    try {
      const candidatas = await this.candidatasLimpieza();
      if (!candidatas.length) return { count: 0 };

      const ultimas = await this.prisma.limpiezaMaquinaria.groupBy({
        by: ['maquinariaId'],
        where: { maquinariaId: { in: candidatas.map((m) => m.id) } },
        _max: { fecha: true },
      });
      const ultimaFechaPorMaquina = new Map(ultimas.map((r) => [r.maquinariaId, r._max.fecha ?? null]));

      let count = 0;
      for (const m of candidatas) {
        const regla = reglaLimpieza(m);
        const ultimaFecha = ultimaFechaPorMaquina.get(m.id) ?? null;
        if (!limpiezaAtrasada(regla, ultimaFecha, ahora)) continue;

        // Ya se avisó este mismo episodio de atraso (no hubo limpieza nueva desde entonces): no duplicar.
        const yaAvisado = await this.prisma.notification.findFirst({
          where: {
            tipo: 'LIMPIEZA_ATRASADA',
            entidadId: m.id,
            createdAt: ultimaFecha ? { gte: ultimaFecha } : undefined,
          },
        });
        if (yaAvisado) continue;

        await this.notifications.notificarCoordinadorRegion({
          regionId: m.agencia?.regionId,
          title: `Limpieza atrasada: ${m.codigo}`,
          body: `${m.nombre} no se ha limpiado según la regla vigente.`,
          data: { type: 'LIMPIEZA_ATRASADA', maquinariaId: m.id },
          opts: { tipo: 'LIMPIEZA_ATRASADA', entidadTipo: 'MAQUINARIA', entidadId: m.id },
        });
        count++;
      }
      return { count };
    } catch (err: any) {
      this.logger.error(`[Cron] Error escalando limpieza atrasada: ${err.message}`);
      return { error: err.message };
    }
  }
}
