import { Injectable, Logger } from '@nestjs/common';
import type { TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsGateway } from './notifications.gateway.js';
import { resolverPaginacion } from '../../common/utils/data-grid.helpers.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import type { ListarNotificacionesDto } from './dto/notifications.dto.js';

export interface PushNotificationPayload {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
}

/** Con `tipo`, además del push la notificación queda guardada y se emite por WebSocket a la web. */
export interface NotificarOpts {
  tipo: TipoNotificacion;
  entidadTipo?: string;
  entidadId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly expoPushUrl = 'https://exp.host/--/api/v2/push/send';

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

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

  /**
   * Push a usuarios concretos (por id); si se pasa `opts.tipo` además persiste una `Notification` por
   * usuario y la emite por WebSocket a la web. Nunca lanza: una falla de notificación no debe romper
   * el flujo de negocio que la dispara.
   */
  async notificarUsuarios(userIds: string[], title: string, body: string, data?: Record<string, any>, opts?: NotificarOpts) {
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

      if (opts?.tipo) {
        await this.prisma.notification.createMany({
          data: ids.map((userId) => ({
            userId,
            tipo: opts.tipo,
            titulo: title,
            mensaje: body,
            data,
            entidadTipo: opts.entidadTipo,
            entidadId: opts.entidadId,
          })),
        });
        this.gateway.emitToUsers(ids, 'notification:new', {
          tipo: opts.tipo,
          titulo: title,
          mensaje: body,
          data,
          entidadTipo: opts.entidadTipo,
          entidadId: opts.entidadId,
          leida: false,
          createdAt: new Date().toISOString(),
        });
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
    opts?: NotificarOpts;
  }) {
    if (!params.regionId) return;
    const coordinadores = await this.prisma.user.findMany({
      where: { estado: 1, regionId: params.regionId, role: { namerol: 'COORD_MANTENIMIENTO' } },
      select: { id: true },
    });
    await this.notificarUsuarios(coordinadores.map((u) => u.id), params.title, params.body, params.data, params.opts);
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
    entidadId?: string;
  }) {
    const destinatarios = await this.prisma.user.findMany({
      where: {
        role: {
          namerol: { in: ['COORD_BODEGA', 'LIDER_AGENCIA', 'LIDER', 'ADMIN'] },
        },
      },
      select: { id: true },
    });

    await this.notificarUsuarios(
      destinatarios.map((u) => u.id),
      `Stock Crítico: ${params.insumoNombre}`,
      `El insumo ha alcanzado el nivel de alerta: ${params.nivel}`,
      { type: 'ALERTA_STOCK' },
      { tipo: 'STOCK_CRITICO', entidadTipo: 'INSUMO', entidadId: params.entidadId },
    );
  }

  // ==============================================================
  // LECTURA (propias del usuario, nunca de otro)
  // ==============================================================

  /** Historial paginado de notificaciones del usuario, más reciente primero. */
  async list(dto: ListarNotificacionesDto, userId: string) {
    const where = { userId, ...(dto.leida !== undefined ? { leida: dto.leida } : {}) };
    const { page, pageSize, skip, take } = resolverPaginacion(dto, { defecto: 50 });
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.notification.count({ where }),
    ]);
    return { success: true, ...buildDataGridResponse(items, total, page, pageSize) };
  }

  /** Cuántas notificaciones sin leer tiene el usuario (para el badge de la campanita). */
  async resumen(userId: string) {
    const pendientes = await this.prisma.notification.count({ where: { userId, leida: false } });
    return { success: true, pendientes };
  }

  /** Marca una notificación como leída; el `where` con `userId` evita marcar la de otro usuario. */
  async marcarLeida(notificacionId: string, userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { id: notificacionId, userId },
      data: { leida: true, leidaEn: new Date() },
    });
    return { success: true, actualizadas: r.count };
  }

  async marcarTodasLeidas(userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, leida: false },
      data: { leida: true, leidaEn: new Date() },
    });
    return { success: true, actualizadas: r.count };
  }
}
