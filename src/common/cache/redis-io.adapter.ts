import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { INestApplicationContext } from '@nestjs/common';
import { CacheService } from './cache.service.js';

/**
 * Con varias instancias del servidor, un aviso emitido en una debe llegar a los usuarios conectados a otra: el adaptador de Redis
 * reparte los mensajes de socket.io entre todas. Sin Redis (una sola instancia) no se usa y todo funciona como antes.
 */
export class RedisIoAdapter extends IoAdapter {
  private adaptador?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, private readonly cache: CacheService) {
    super(app);
  }

  /** Abre las dos conexiones que pide el adaptador (publicar y suscribir). Devuelve `false` si no hay Redis. */
  conectar(): boolean {
    const base = this.cache.cliente;
    if (!base) return false;
    const pub = base.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, commandTimeout: undefined });
    const sub = base.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null, commandTimeout: undefined });
    // Un error de conexión no debe tumbar el proceso: ioredis reintenta solo.
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);
    this.adaptador = createAdapter(pub, sub);
    return true;
  }

  // `options` va sin tipo: @nestjs/platform-socket.io y socket.io traen versiones distintas de los mismos tipos.
  override createIOServer(port: number, options?: any): any {
    const servidor = super.createIOServer(port, options);
    if (this.adaptador) servidor.adapter(this.adaptador);
    return servidor;
  }
}
