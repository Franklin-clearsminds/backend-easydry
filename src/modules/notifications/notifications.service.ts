import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface PushNotificationPayload {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expoPushUrl = 'https://exp.host/--/api/v2/push/send';

  constructor(private readonly prisma: PrismaService) {}

  async sendPushNotification(payload: PushNotificationPayload) {
    const tokens = Array.isArray(payload.to) ? payload.to : [payload.to];
    const validTokens = tokens.filter((t) => t && (t.startsWith('ExponentPushToken') || t.startsWith('ExpoPushToken')));

    if (validTokens.length === 0) {
      this.logger.debug('No hay tokens Expo válidos para enviar notificación push.');
      return { success: false, sentCount: 0 };
    }

    try {
      const messages = validTokens.map((token) => ({
        to: token,
        sound: payload.sound ?? 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        priority: payload.priority ?? 'high',
      }));

      const res = await fetch(this.expoPushUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const responseData = await res.json();
      this.logger.log(`Notificación push enviada a ${validTokens.length} dispositivos: ${payload.title}`);
      return { success: true, sentCount: validTokens.length, response: responseData };
    } catch (err: any) {
      this.logger.error(`Error enviando notificación push Expo: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /** Push a usuarios concretos (por id). Nunca lanza: una falla de notificación no debe romper el flujo. */
  async notificarUsuarios(userIds: string[], title: string, body: string, data?: Record<string, any>) {
    try {
      const ids = [...new Set(userIds.filter(Boolean))];
      if (!ids.length) return;
      const devices = await this.prisma.syncDevice.findMany({
        where: { userId: { in: ids }, pushToken: { not: null } },
        select: { pushToken: true },
      });
      const tokens = devices.map((d) => d.pushToken as string);
      if (tokens.length) {
        await this.sendPushNotification({ to: tokens, title, body, data });
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo notificar a usuarios: ${err?.message || err}`);
    }
  }

  /** Avisa solo al coordinador de mantenimiento de la región de la máquina. */
  async notificarCoordinadorRegion(params: {
    regionId?: string | null;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    if (!params.regionId) return;
    const coordinadores = await this.prisma.user.findMany({
      where: { estado: 1, regionId: params.regionId, role: { namerol: 'COORD_MANTENIMIENTO' } },
      select: { id: true },
    });
    await this.notificarUsuarios(coordinadores.map((u) => u.id), params.title, params.body, params.data);
  }

  async notificarIncidenteCritico(params: {
    incidenteId: string;
    titulo: string;
    gravedad: string;
    maquinariaCodigo: string;
    agenciaId?: string;
  }) {
    // Buscar usuarios con rol COORD_MANTENIMIENTO y SUPERVISOR
    const destinatarios = await this.prisma.user.findMany({
      where: {
        role: {
          namerol: { in: ['COORD_MANTENIMIENTO', 'SUPERVISOR', 'ADMIN'] },
        },
        ...(params.agenciaId ? { OR: [{ agenciaId: params.agenciaId }, { agenciasIds: { has: params.agenciaId } }, { agenciaId: null }] } : {}),
      },
      select: { id: true },
    });

    const userIds = destinatarios.map((u) => u.id);
    if (userIds.length === 0) return;

    const devices = await this.prisma.syncDevice.findMany({
      where: {
        userId: { in: userIds },
        pushToken: { not: null },
      },
      select: { pushToken: true },
    });

    const tokens = devices.map((d) => d.pushToken as string);
    if (tokens.length > 0) {
      await this.sendPushNotification({
        to: tokens,
        title: `Alerta Crítica Taller: ${params.maquinariaCodigo}`,
        body: `Incidente: ${params.titulo} (Gravedad: ${params.gravedad})`,
        data: {
          type: 'INCIDENTE_CRITICO',
          incidenteId: params.incidenteId,
        },
      });
    }
  }

  async notificarAlertaStock(params: {
    insumoNombre: string;
    nivel: string;
    agenciaId?: string;
  }) {
    const destinatarios = await this.prisma.user.findMany({
      where: {
        role: {
          namerol: { in: ['COORD_BODEGA', 'LIDER_AGENCIA', 'LIDER', 'ADMIN'] },
        },
      },
      select: { id: true },
    });

    const userIds = destinatarios.map((u) => u.id);
    const devices = await this.prisma.syncDevice.findMany({
      where: { userId: { in: userIds }, pushToken: { not: null } },
      select: { pushToken: true },
    });

    const tokens = devices.map((d) => d.pushToken as string);
    if (tokens.length > 0) {
      await this.sendPushNotification({
        to: tokens,
        title: `Stock Crítico: ${params.insumoNombre}`,
        body: `El insumo ha alcanzado el nivel de alerta: ${params.nivel}`,
        data: { type: 'ALERTA_STOCK' },
      });
    }
  }
}
