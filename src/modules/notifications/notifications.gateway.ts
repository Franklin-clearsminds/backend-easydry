import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { secretoObligatorio } from '../../common/config/secretos.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Canal en tiempo real de notificaciones para la web (push a mobile sigue por Expo, sin cambios).
 * Autenticación del handshake: mismo criterio que `JwtStrategy.validate()` (ver jwt.strategy.ts),
 * pero Socket.IO no manda `Authorization` como header — el cliente manda el JWT en `auth.token`.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: true, credentials: true }, namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  /** userId -> ids de socket conectados (una pestaña/dispositivo cada uno). */
  private readonly userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = client.handshake.auth?.['token'] as string | undefined;
      if (!token) throw new Error('Falta el token');
      const secret = secretoObligatorio(
        this.configService.get<string>('JWT_SECRET'),
        'JWT_SECRET',
        'EasyDrySecretKey2026*OfflineSync',
      );
      const payload = await this.jwtService.verifyAsync(token, { secret });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        include: { role: true },
      });
      if (!user || user.estado !== 1 || !user.role || user.role.estado === 0) {
        throw new Error('Sesión inválida o usuario inactivo');
      }
      client.data.userId = user.id;
      if (!this.userSockets.has(user.id)) this.userSockets.set(user.id, new Set());
      this.userSockets.get(user.id)!.add(client.id);
    } catch (err: any) {
      this.logger.debug(`Conexión WS rechazada: ${err?.message || err}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data?.userId as string | undefined;
    if (userId) this.userSockets.get(userId)?.delete(client.id);
  }

  /** Emite un evento solo a los sockets conectados de estos usuarios (nunca un broadcast global). */
  emitToUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.server) return;
    for (const userId of userIds) {
      for (const socketId of this.userSockets.get(userId) ?? []) {
        this.server.to(socketId).emit(event, payload);
      }
    }
  }
}
