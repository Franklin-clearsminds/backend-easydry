import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import type { CacheService } from './cache.service.js';

/**
 * Contadores del límite de peticiones en Redis: una sola operación atómica por petición (suma el golpe y fija el vencimiento de la
 * ventana la primera vez), sin tocar PostgreSQL. Ventana fija por clave, igual que la versión de PostgreSQL.
 * Si Redis falla, el límite se omite (no se bloquea a nadie): es una defensa adicional, no la puerta.
 */
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { hits, redis.call('PTTL', KEYS[1]) }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  constructor(private readonly cache: CacheService) {}

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const redis = this.cache.cliente;
    if (!redis) return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    try {
      const [hits, ttlMs] = (await redis.eval(SCRIPT, 1, `easydry:limite:${throttlerName}:${key}`, String(ttl))) as [number, number];
      const segundos = Math.max(Math.ceil((ttlMs > 0 ? ttlMs : ttl) / 1000), 0);
      const bloqueado = hits > limit;
      return { totalHits: hits, timeToExpire: segundos, isBlocked: bloqueado, timeToBlockExpire: bloqueado ? segundos : 0 };
    } catch (err) {
      this.logger.warn(`No se pudo contar la petición (se omite el límite): ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
