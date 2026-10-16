import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { deserializar, serializar } from './serializador.js';

const MAX_ENTRADAS_MEMORIA = 5000;
const AVISO_CADA_MS = 60_000;

/** Huella corta y estable de cualquier valor JSON (las claves de objeto se ordenan): sirve para armar claves de caché. */
export function huella(valor: unknown): string {
  const estable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(estable) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, estable(x)])) : v;
  return createHash('sha1').update(serializar(estable(valor))).digest('hex').slice(0, 24);
}

/**
 * Caché compartida del sistema. Con `REDIS_URL` guarda en Redis, así todas las instancias del servidor ven lo mismo; sin ella usa la
 * memoria del proceso (desarrollo y pruebas), con el mismo comportamiento.
 *
 * Principios:
 *  - La caché NUNCA es la fuente de verdad ni puede romper una petición: si Redis falla o tarda, se calcula directo y se sigue.
 *  - Una misma clave pedida a la vez por muchas peticiones se calcula UNA vez en esta instancia (`obtenerOCalcular`).
 *  - Todo tiene vencimiento: lo que no se invalida vuelve a calcularse solo.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis | null;
  private readonly prefijo: string;
  private readonly memoria = new Map<string, { v: string; vence: number }>();
  private readonly enVuelo = new Map<string, Promise<unknown>>();
  private ultimoAviso = 0;
  readonly estadisticas = { aciertos: 0, fallos: 0, errores: 0 };

  constructor(config: ConfigService) {
    this.prefijo = config.get<string>('REDIS_PREFIX') || 'easydry';
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      this.redis = null;
      return;
    }
    this.redis = new Redis(url, {
      // Si Redis cae, los comandos fallan enseguida (no se acumulan en una cola) y la petición se calcula sin caché.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: 800,
      connectTimeout: 2000,
      retryStrategy: (intento) => Math.min(intento * 200, 5000),
    });
    this.redis.on('error', (e: Error) => this.avisar(`Redis: ${e.message}`));
    this.redis.on('ready', () => this.logger.log('Redis conectado'));
  }

  /** Cliente de Redis (o `null` en modo memoria) para quien necesite comandos propios (límite de peticiones, adaptador de sockets). */
  get cliente(): Redis | null {
    return this.redis;
  }

  get usaRedis(): boolean {
    return this.redis !== null;
  }

  private avisar(mensaje: string): void {
    this.estadisticas.errores++;
    const ahora = Date.now();
    if (ahora - this.ultimoAviso > AVISO_CADA_MS) {
      this.ultimoAviso = ahora;
      this.logger.warn(`${mensaje} (se sigue sin caché)`);
    }
  }

  private clave(c: string): string {
    return `${this.prefijo}:${c}`;
  }

  async get<T>(clave: string): Promise<T | undefined> {
    const k = this.clave(clave);
    try {
      let texto: string | null | undefined;
      if (this.redis) texto = await this.redis.get(k);
      else {
        const e = this.memoria.get(k);
        if (e && e.vence > Date.now()) texto = e.v;
        else if (e) this.memoria.delete(k);
      }
      if (texto === null || texto === undefined) return undefined;
      return deserializar<T>(texto);
    } catch (e) {
      this.avisar(`Lectura de caché: ${(e as Error).message}`);
      return undefined;
    }
  }

  async set(clave: string, valor: unknown, ttlSegundos: number): Promise<void> {
    if (valor === undefined || ttlSegundos <= 0) return;
    const k = this.clave(clave);
    try {
      const texto = serializar(valor);
      if (this.redis) await this.redis.set(k, texto, 'EX', Math.ceil(ttlSegundos));
      else {
        if (this.memoria.size >= MAX_ENTRADAS_MEMORIA) {
          const antigua = this.memoria.keys().next().value;
          if (antigua !== undefined) this.memoria.delete(antigua);
        }
        this.memoria.delete(k);
        this.memoria.set(k, { v: texto, vence: Date.now() + ttlSegundos * 1000 });
      }
    } catch (e) {
      this.avisar(`Escritura de caché: ${(e as Error).message}`);
    }
  }

  async del(...claves: string[]): Promise<void> {
    if (!claves.length) return;
    try {
      if (this.redis) await this.redis.del(...claves.map((c) => this.clave(c)));
      else for (const c of claves) this.memoria.delete(this.clave(c));
    } catch (e) {
      this.avisar(`Borrado de caché: ${(e as Error).message}`);
    }
  }

  /** Borra todas las claves que empiezan por `prefijo` (invalidar un grupo: p. ej. todos los paneles). */
  async delPrefijo(prefijo: string): Promise<void> {
    const patron = this.clave(prefijo);
    try {
      if (this.redis) {
        let cursor = '0';
        do {
          const [siguiente, claves] = await this.redis.scan(cursor, 'MATCH', `${patron}*`, 'COUNT', 500);
          cursor = siguiente;
          if (claves.length) await this.redis.unlink(...claves);
        } while (cursor !== '0');
      } else for (const k of [...this.memoria.keys()]) if (k.startsWith(patron)) this.memoria.delete(k);
    } catch (e) {
      this.avisar(`Borrado por prefijo: ${(e as Error).message}`);
    }
  }

  /**
   * Devuelve lo guardado o lo calcula y lo guarda. Las peticiones simultáneas de una misma clave comparten UN cálculo. `ttl` puede
   * depender del resultado (p. ej. un periodo ya cerrado dura más); devolver 0 no lo guarda. Si `fn` falla, el error se propaga y
   * nada se guarda.
   */
  async obtenerOCalcular<T>(clave: string, ttlSegundos: number | ((resultado: T) => number), fn: () => Promise<T>): Promise<T> {
    const guardado = await this.get<T>(clave);
    if (guardado !== undefined) {
      this.estadisticas.aciertos++;
      return guardado;
    }
    const k = this.clave(clave);
    const pendiente = this.enVuelo.get(k) as Promise<T> | undefined;
    if (pendiente) return pendiente;
    this.estadisticas.fallos++;
    const calculo = (async () => {
      const resultado = await fn();
      await this.set(clave, resultado, typeof ttlSegundos === 'function' ? ttlSegundos(resultado) : ttlSegundos);
      return resultado;
    })().finally(() => this.enVuelo.delete(k));
    this.enVuelo.set(k, calculo);
    return calculo;
  }

  /**
   * Ejecuta `fn` solo si nadie más (otra instancia) la está ejecutando: para tareas programadas que no deben repetirse cuando hay
   * varias instancias. El candado vence solo (`ttlSegundos`), así que una instancia caída no lo deja tomado para siempre.
   * Sin Redis (una sola instancia) siempre ejecuta. Si Redis falla, ejecuta (mejor repetir una tarea idempotente que no correrla).
   */
  async unaVez(nombre: string, ttlSegundos: number, fn: () => Promise<void>): Promise<boolean> {
    let tomado = true;
    if (this.redis) {
      try {
        tomado = (await this.redis.set(this.clave(`candado:${nombre}`), String(process.pid), 'EX', Math.ceil(ttlSegundos), 'NX')) === 'OK';
      } catch (e) {
        this.avisar(`Candado de tarea ${nombre}: ${(e as Error).message}`);
      }
    }
    if (!tomado) return false;
    await fn();
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => this.redis?.disconnect());
  }
}
