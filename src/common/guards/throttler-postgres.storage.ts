import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import type { PrismaService } from '../../modules/prisma/prisma.service.js';

const LIMPIEZA_CADA_MS = 10 * 60 * 1000;

/**
 * Contadores del límite de peticiones guardados en PostgreSQL en vez de en la memoria del proceso: así el límite vale
 * para todas las instancias del servidor y no se reinicia al desplegar. Es una ventana fija por clave (cada ventana
 * dura `ttl`); una sola sentencia atómica suma el golpe, sin carreras entre instancias.
 *
 * Si la base falla, el límite se omite (no se bloquea a nadie): el límite es una defensa adicional, no la puerta.
 */
export class PostgresThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(PostgresThrottlerStorage.name);
  private temporizador?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  /** Nest no ejecuta ganchos de ciclo de vida en el almacenamiento que se pasa por opciones: la limpieza arranca con el primer uso. */
  private iniciarLimpieza(): void {
    if (this.temporizador) return;
    this.temporizador = setInterval(() => void this.limpiar(), LIMPIEZA_CADA_MS);
    this.temporizador.unref();
  }

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    this.iniciarLimpieza();
    const clave = `${throttlerName}:${key}`;
    try {
      const filas = await this.prisma.$queryRaw<{ hits: number; segundos: number }[]>`
        INSERT INTO "LimiteSolicitud" ("clave", "hits", "expiraEn")
        VALUES (${clave}, 1, now() + (${ttl} * interval '1 millisecond'))
        ON CONFLICT ("clave") DO UPDATE SET
          "hits" = CASE WHEN "LimiteSolicitud"."expiraEn" <= now() THEN 1 ELSE "LimiteSolicitud"."hits" + 1 END,
          "expiraEn" = CASE WHEN "LimiteSolicitud"."expiraEn" <= now()
                            THEN now() + (${ttl} * interval '1 millisecond')
                            ELSE "LimiteSolicitud"."expiraEn" END
        RETURNING "hits", CEIL(EXTRACT(EPOCH FROM ("expiraEn" - now())))::int AS "segundos"`;
      const { hits, segundos } = filas[0];
      const bloqueado = hits > limit;
      return {
        totalHits: hits,
        timeToExpire: Math.max(segundos, 0),
        isBlocked: bloqueado,
        timeToBlockExpire: bloqueado ? Math.max(segundos, 0) : 0,
      };
    } catch (err) {
      this.logger.warn(`No se pudo contar la petición (se omite el límite): ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  /** Borra las ventanas vencidas para que la tabla no crezca. */
  async limpiar(): Promise<void> {
    try {
      await this.prisma.$executeRaw`DELETE FROM "LimiteSolicitud" WHERE "expiraEn" < now()`;
    } catch (err) {
      this.logger.warn(`No se pudo limpiar el límite de peticiones: ${(err as Error).message}`);
    }
  }
}
