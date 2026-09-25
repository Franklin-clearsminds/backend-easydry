import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class MaintenanceCronService {
  private readonly logger = new Logger(MaintenanceCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // Cron programado: Todos los domingos a las 02:00 AM (Limpieza de auditoría de sincronización)
  @Cron('0 2 * * 0')
  async purgarAuditoriaAntigua(dias: number = 90) {
    this.logger.log(`[Cron] Iniciando purga programada de SyncOutboxAudit (más de ${dias} días)...`);
    const cutoffDate = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    try {
      const result = await this.prisma.syncOutboxAudit.deleteMany({
        where: {
          syncedAt: { lt: cutoffDate },
        },
      });

      this.logger.log(`[Cron] Purga completada exitosamente: ${result.count} registros de auditoría eliminados.`);
      return { success: true, count: result.count };
    } catch (err: any) {
      this.logger.error(`[Cron] Error al purgar SyncOutboxAudit: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Cron diario: Todos los días a las 06:00 AM (Detección de mantenimientos preventivos vencidos)
  @Cron('0 6 * * *')
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
        });
      }

      return { count: mantenimientosVencidos.length };
    } catch (err: any) {
      this.logger.error(`[Cron] Error verificando mantenimientos: ${err.message}`);
      return { error: err.message };
    }
  }
}
