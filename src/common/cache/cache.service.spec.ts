import { afterAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { CacheService, huella } from './cache.service.js';
import { RedisThrottlerStorage } from './throttler-redis.storage.js';
import { deserializar, serializar } from './serializador.js';

const REDIS_URL = process.env.REDIS_TEST_URL;
const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

describe('serializador', () => {
  it('conserva fechas, enteros grandes, nulos y estructuras anidadas', () => {
    const original = { a: new Date('2019-03-10T15:00:00.000Z'), b: [{ c: new Date('2020-01-01T00:00:00Z') }], d: 12345678901234567890n, e: null, f: 'x', g: [1, 2], h: new Date(NaN) };
    const vuelta = deserializar<typeof original>(serializar(original));
    expect(vuelta.a).toBeInstanceOf(Date);
    expect(vuelta.a.getTime()).toBe(original.a.getTime());
    expect(vuelta.b[0].c.getTime()).toBe(original.b[0].c.getTime());
    expect(vuelta.d).toBe(12345678901234567890n);
    expect(vuelta.e).toBeNull();
    expect(vuelta.g).toEqual([1, 2]);
    expect(Number.isNaN(vuelta.h.getTime())).toBe(true);
  });
});

describe('huella', () => {
  it('no depende del orden de las claves y distingue valores distintos', () => {
    expect(huella({ a: 1, b: { c: 2, d: 3 } })).toBe(huella({ b: { d: 3, c: 2 }, a: 1 }));
    expect(huella({ a: 1 })).not.toBe(huella({ a: 2 }));
    expect(huella([1, 2])).not.toBe(huella([2, 1]));
    expect(huella({ f: new Date('2019-01-01') })).not.toBe(huella({ f: new Date('2019-01-02') }));
  });
});

const modos: Array<[string, () => CacheService]> = [['memoria', () => new CacheService(new ConfigService({ REDIS_PREFIX: `t${randomBytes(4).toString('hex')}` }))]];
if (REDIS_URL) modos.push(['Redis real', () => new CacheService(new ConfigService({ REDIS_URL, REDIS_PREFIX: `t${randomBytes(4).toString('hex')}` }))]);

describe.each(modos)('CacheService (%s)', (_nombre, crear) => {
  const cache = crear();
  afterAll(async () => {
    await cache.delPrefijo('');
    await cache.onModuleDestroy();
  });

  it('guarda y lee con la misma forma (fechas incluidas) y respeta el vencimiento', async () => {
    await cache.set('k1', { f: new Date('2019-05-05T10:00:00Z'), n: 3 }, 1);
    const v = await cache.get<{ f: Date; n: number }>('k1');
    expect(v?.f).toBeInstanceOf(Date);
    expect(v?.n).toBe(3);
    expect(await cache.get('no-existe')).toBeUndefined();
    await dormir(1300);
    expect(await cache.get('k1')).toBeUndefined();
  });

  it('no guarda undefined ni vencimientos no positivos', async () => {
    await cache.set('k2', undefined, 10);
    await cache.set('k3', 'x', 0);
    expect(await cache.get('k2')).toBeUndefined();
    expect(await cache.get('k3')).toBeUndefined();
  });

  it('del y delPrefijo borran solo lo indicado', async () => {
    await cache.set('grupo:a', 1, 30);
    await cache.set('grupo:b', 2, 30);
    await cache.set('otro:c', 3, 30);
    await cache.del('grupo:a');
    expect(await cache.get('grupo:a')).toBeUndefined();
    expect(await cache.get('grupo:b')).toBe(2);
    await cache.delPrefijo('grupo:');
    expect(await cache.get('grupo:b')).toBeUndefined();
    expect(await cache.get('otro:c')).toBe(3);
  });

  it('obtenerOCalcular calcula una vez, aunque lo pidan muchos a la vez, y luego sirve de la caché', async () => {
    let llamadas = 0;
    const calcular = async () => {
      llamadas++;
      await dormir(50);
      return { v: llamadas };
    };
    const juntos = await Promise.all(Array.from({ length: 20 }, () => cache.obtenerOCalcular('calc', 30, calcular)));
    expect(llamadas).toBe(1);
    expect(new Set(juntos.map((x) => x.v))).toEqual(new Set([1]));
    expect((await cache.obtenerOCalcular('calc', 30, calcular)).v).toBe(1);
    expect(llamadas).toBe(1);
  });

  it('el vencimiento puede depender del resultado y 0 no guarda', async () => {
    let n = 0;
    await cache.obtenerOCalcular('dinamico', () => 0, async () => ++n);
    await cache.obtenerOCalcular('dinamico', () => 0, async () => ++n);
    expect(n).toBe(2);
  });

  it('si el cálculo falla, el error llega y no se guarda nada (y se puede reintentar)', async () => {
    let n = 0;
    await expect(cache.obtenerOCalcular('falla', 30, async () => { n++; throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await cache.obtenerOCalcular('falla', 30, async () => ++n)).toBe(2);
  });

  it('unaVez deja pasar a uno solo mientras dure el candado (con Redis); sin Redis siempre ejecuta', async () => {
    let corridas = 0;
    const a = await cache.unaVez('tarea', 5, async () => { corridas++; });
    const b = await cache.unaVez('tarea', 5, async () => { corridas++; });
    expect(a).toBe(true);
    if (cache.usaRedis) {
      expect(b).toBe(false);
      expect(corridas).toBe(1);
    } else {
      expect(b).toBe(true);
      expect(corridas).toBe(2);
    }
  });
});

describe.skipIf(!REDIS_URL)('límite de peticiones en Redis', () => {
  const cache = new CacheService(new ConfigService({ REDIS_URL, REDIS_PREFIX: `t${randomBytes(4).toString('hex')}` }));
  afterAll(() => cache.onModuleDestroy());

  it('cuenta por clave, bloquea al pasar el límite y reinicia la ventana', async () => {
    const almacen = new RedisThrottlerStorage(cache);
    const clave = `k${randomBytes(4).toString('hex')}`;
    const resultados = [];
    for (let i = 0; i < 5; i++) resultados.push(await almacen.increment(clave, 1000, 3, 0, 'default'));
    expect(resultados.map((r) => r.totalHits)).toEqual([1, 2, 3, 4, 5]);
    expect(resultados.map((r) => r.isBlocked)).toEqual([false, false, false, true, true]);
    expect(resultados[0].timeToExpire).toBeGreaterThan(0);
    expect((await almacen.increment(`${clave}-otra`, 1000, 3, 0, 'default')).totalHits).toBe(1);
    await dormir(1200);
    expect((await almacen.increment(clave, 1000, 3, 0, 'default')).totalHits).toBe(1);
  });

  it('si Redis no responde no bloquea a nadie ni lanza error', async () => {
    const roto = new CacheService(new ConfigService({ REDIS_URL: 'redis://127.0.0.1:1', REDIS_PREFIX: 'x' }));
    const r = await new RedisThrottlerStorage(roto).increment('k', 1000, 1, 0, 'default');
    expect(r.isBlocked).toBe(false);
    await roto.onModuleDestroy();
  });

  it('con Redis caído, la caché calcula directo sin fallar', async () => {
    const roto = new CacheService(new ConfigService({ REDIS_URL: 'redis://127.0.0.1:1', REDIS_PREFIX: 'x' }));
    expect(await roto.obtenerOCalcular('k', 30, async () => 42)).toBe(42);
    expect(await roto.unaVez('t', 5, async () => undefined)).toBe(true);
    await roto.onModuleDestroy();
  });
});
