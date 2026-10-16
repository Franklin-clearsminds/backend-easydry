import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { PostgresThrottlerStorage } from './throttler-postgres.storage.js';

/** Integración con la base real: los contadores del límite de peticiones viven en PostgreSQL y se comparten entre instancias. */
describe('límite de peticiones en PostgreSQL (base real)', () => {
  let env: Entorno;
  let storage: PostgresThrottlerStorage;
  const prefijo = `prueba-${Date.now()}`;

  beforeAll(async () => {
    env = await abrirEntorno();
    storage = new PostgresThrottlerStorage(env.prisma as never);
  });

  afterAll(async () => {
    await env.prisma.limiteSolicitud.deleteMany({ where: { clave: { contains: prefijo } } });
    await env.cerrar();
  });

  it('cuenta los golpes y bloquea al superar el límite', async () => {
    const clave = `${prefijo}-a`;
    const resultados = [];
    for (let i = 0; i < 4; i++) resultados.push(await storage.increment(clave, 60_000, 3, 60_000, 'default'));

    expect(resultados.map((r) => r.totalHits)).toEqual([1, 2, 3, 4]);
    expect(resultados.map((r) => r.isBlocked)).toEqual([false, false, false, true]);
    expect(resultados[3].timeToExpire).toBeGreaterThan(0);
  });

  it('claves distintas no se mezclan', async () => {
    await storage.increment(`${prefijo}-b`, 60_000, 5, 60_000, 'default');
    const otra = await storage.increment(`${prefijo}-c`, 60_000, 5, 60_000, 'default');
    expect(otra.totalHits).toBe(1);
  });

  it('dos instancias del servidor comparten el mismo contador', async () => {
    const otraInstancia = new PostgresThrottlerStorage(env.prisma as never);
    await storage.increment(`${prefijo}-d`, 60_000, 5, 60_000, 'default');
    const desdeLaOtra = await otraInstancia.increment(`${prefijo}-d`, 60_000, 5, 60_000, 'default');
    expect(desdeLaOtra.totalHits).toBe(2);
  });

  it('al vencer la ventana el contador vuelve a empezar', async () => {
    const clave = `${prefijo}-e`;
    await storage.increment(clave, 300, 1, 300, 'default');
    const bloqueado = await storage.increment(clave, 300, 1, 300, 'default');
    expect(bloqueado.isBlocked).toBe(true);

    await new Promise((r) => setTimeout(r, 450));
    const nuevo = await storage.increment(clave, 300, 1, 300, 'default');
    expect(nuevo).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('si la base falla, no bloquea a nadie', async () => {
    const roto = new PostgresThrottlerStorage({ $queryRaw: async () => { throw new Error('sin base'); } } as never);
    expect(await roto.increment('x', 60_000, 1, 60_000, 'default')).toMatchObject({ isBlocked: false, totalHits: 0 });
  });

  it('limpiar borra las ventanas vencidas', async () => {
    const clave = `${prefijo}-f`;
    await storage.increment(clave, 100, 5, 100, 'default');
    await new Promise((r) => setTimeout(r, 200));
    await storage.limpiar();
    expect(await env.prisma.limiteSolicitud.count({ where: { clave: { contains: clave } } })).toBe(0);
  });
});
