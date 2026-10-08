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

  /**
   * IDs de usuarios activos con alguno de los roles dados: los de `global` sin importar su región (ej.
   * ADMIN, SUPER_ADMIN, JEFE_COMERCIAL, COORD_BODEGA), los de `regionales` solo si su región está en
   * `regionId`/`regionId[]` (ej. SUPERVISOR, COORD_MANTENIMIENTO). Sin región, los roles regionales no
   * aplican (nunca se interpreta como "todas las regiones" para evitar notificar de más por un dato
   * faltante) — para eso usa explícitamente `regionId: 'TODAS'`.
   */
  async resolverDestinatariosPorRol(params: { global?: string[]; regionales?: string[]; regionId?: string | string[] | null }): Promise<string[]> {
    const or: Record<string, unknown>[] = [];
    if (params.global?.length) or.push({ role: { namerol: { in: params.global }, estado: 1 } });
    if (params.regionales?.length && params.regionId) {
      if (params.regionId === 'TODAS') {
        or.push({ role: { namerol: { in: params.regionales }, estado: 1 } });
      } else {
        const regionIds = Array.isArray(params.regionId) ? params.regionId : [params.regionId];
        if (regionIds.length) or.push({ role: { namerol: { in: params.regionales }, estado: 1 }, regionId: { in: regionIds } });
      }
    }
    if (!or.length) return [];
    const usuarios = await this.prisma.user.findMany({ where: { estado: 1, OR: or }, select: { id: true } });
    return usuarios.map((u) => u.id);
  }

  /** Notifica a los administradores cuando cambian módulos, capacidades o ámbito de un rol. */
  async notificarCambioPermisosRol(params: { roleId: string; roleName: string; actorName?: string }) {
    try {
      const userIds = await this.resolverDestinatariosPorRol({ global: ['ADMIN', 'SUPER_ADMIN'] });
      await this.notificarUsuarios(
        userIds,
        'Permisos de rol actualizados',
        `${params.actorName || 'Un administrador'} actualizó los permisos del rol "${params.roleName}".`,
        { roleId: params.roleId, roleName: params.roleName },
        { tipo: 'USUARIO_ACTUALIZADO', entidadTipo: 'ROL', entidadId: params.roleId },
      );
    } catch (err: any) {
      this.logger.warn(`No se pudo notificar el cambio de permisos del rol ${params.roleId}: ${err?.message || err}`);
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

  /** Avisa a mantenimiento/supervisión de un incidente crítico y lo deja persistido en la campanita web. */
  async notificarIncidenteCritico(params: {
    incidenteId: string;
    titulo: string;
    gravedad: string;
    maquinariaCodigo: string;
    agenciaId?: string;
  }) {
    const destinatarios = await this.prisma.user.findMany({
      where: {
        estado: 1,
        role: { namerol: { in: ['COORD_MANTENIMIENTO', 'SUPERVISOR', 'ADMIN'] } },
        ...(params.agenciaId ? { OR: [{ agenciaId: params.agenciaId }, { agenciasIds: { has: params.agenciaId } }, { agenciaId: null }] } : {}),
      },
      select: { id: true },
    });

    // `notificarUsuarios` hace el push y, con `opts.tipo`, persiste y emite por WebSocket la notificación web.
    await this.notificarUsuarios(
      destinatarios.map((u) => u.id),
      `Alerta Crítica Taller: ${params.maquinariaCodigo}`,
      `Incidente: ${params.titulo} (Gravedad: ${params.gravedad})`,
      { type: 'INCIDENTE_CRITICO', incidenteId: params.incidenteId },
      { tipo: 'INCIDENTE_NUEVO', entidadTipo: 'MAQUINARIA', entidadId: params.incidenteId },
    );
  }

  /**
   * Avisa de un stock crítico solo a quien corresponde a esa agencia: bodega nacional, bodega de su región
   * y líder de la agencia. Antes se avisaba a roles globales sin alcance (toda la red recibía todo).
   */
  async notificarAlertaStock(params: {
    insumoNombre: string;
    nivel: string;
    agenciaId?: string;
    entidadId?: string;
  }) {
    let regionId: string | null = null;
    if (params.agenciaId) {
      const agencia = await this.prisma.agencia.findUnique({
        where: { id: params.agenciaId },
        select: { regionId: true },
      });
      regionId = agencia?.regionId ?? null;
    }

    const destinatarios = await this.prisma.user.findMany({
      where: {
        estado: 1,
        role: { namerol: { in: ['COORD_BODEGA', 'ASISTENTE_BODEGA', 'LIDER_AGENCIA', 'LIDER', 'BACKUP', 'ADMIN'] } },
        ...(params.agenciaId
          ? {
              OR: [
                { role: { namerol: { in: ['COORD_BODEGA', 'ADMIN'] } } },
                ...(regionId ? [{ regionId }] : []),
                { agenciaId: params.agenciaId },
                { agenciasIds: { has: params.agenciaId } },
              ],
            }
          : {}),
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
    const where = {
      userId,
      ...(dto.leida !== undefined ? { leida: dto.leida } : {}),
      ...(dto.tipos?.length ? { tipo: { in: dto.tipos } } : {}),
    };
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
