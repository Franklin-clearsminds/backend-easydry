import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { TABLAS_ARCHIVABLES } from './archivado.tablas.js';
import { LectorDuckDb } from './lector-duckdb.js';
import { CacheService } from '../../common/cache/cache.service.js';
import { escribirParquet } from './parquet.js';

/** ¿Carga el binario nativo de DuckDB en este equipo? (En Windows con Application Control no: se omite, no falla.) */
const duckdbDisponible = await import('@duckdb/node-api').then(
  async (d) => {
    try {
      await (await d.DuckDBInstance.create(':memory:')).connect();
      return true;
    } catch {
      return false;
    }
  },
  () => false,
);

describe.skipIf(!duckdbDisponible)('lector DuckDB sobre Parquet locales', () => {
  const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === 'sync_outbox_audit')!;
  let raiz: string;
  let lector: LectorDuckDb;

  const clave = (anio: number, mes: number, parte = 1) => `archivo-historico/sync_outbox_audit/anio=${anio}/mes=${String(mes).padStart(2, '0')}/part-${String(parte).padStart(4, '0')}.parquet`;
  const fila = (id: string, syncedAt: Date, extra: Record<string, unknown> = {}) => ({
    id, mutationId: `m-${id}`, clientUuid: 'c', deviceInfo: null, entity: 'ServicioLavado', action: 'CREATE', payload: { id }, syncedAt, ...extra,
  });
  const escribir = (k: string, filas: Record<string, unknown>[]) => {
    const ruta = join(raiz, k);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, escribirParquet(cfg.columnas, filas));
  };
  const ids = (filas: Record<string, unknown>[]) => filas.map((f) => f.id);

  beforeAll(() => {
    raiz = mkdtempSync(join(tmpdir(), 'archivo-'));
    escribir(clave(2025, 3), [fila('a', new Date('2025-03-10T10:00:00.123Z'), { deviceInfo: 'ñandú', entity: 'Otra' }), fila('b', new Date('2025-03-20T12:00:00Z'))]);
    escribir(clave(2025, 4), [fila('c', new Date('2025-04-02T08:00:00Z')), fila('d', new Date('2025-04-30T23:59:59Z'))]);
    lector = new LectorDuckDb(new ConfigService({ ARCHIVO_RAIZ_LOCAL: raiz }));
  });

  afterAll(() => rmSync(raiz, { recursive: true, force: true }));

  const todos = () => [clave(2025, 3), clave(2025, 4)];

  it('devuelve las filas con la forma de Prisma: fechas Date, JSON interpretado, nulos y UTF-8', async () => {
    const [a] = await lector.consultar({ tabla: 'sync_outbox_audit', claves: [clave(2025, 3)], filtros: { id: 'a' } });
    expect(a.syncedAt).toBeInstanceOf(Date);
    expect((a.syncedAt as Date).toISOString()).toBe('2025-03-10T10:00:00.123Z');
    expect(a.payload).toEqual({ id: 'a' });
    expect(a.deviceInfo).toBe('ñandú');
    const [b] = await lector.consultar({ tabla: 'sync_outbox_audit', claves: [clave(2025, 3)], filtros: { id: 'b' } });
    expect(b.deviceInfo).toBeNull();
  });

  it('une varios archivos, ordena por fecha y pagina', async () => {
    const base = { tabla: 'sync_outbox_audit', claves: todos() };
    expect(ids(await lector.consultar({ ...base, orden: 'asc' }))).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(await lector.consultar({ ...base, orden: 'desc' }))).toEqual(['d', 'c', 'b', 'a']);
    expect(ids(await lector.consultar({ ...base, orden: 'asc', limite: 2, offset: 1 }))).toEqual(['b', 'c']);
    expect(await lector.contar(base)).toBe(4);
  });

  it('filtra por rango de fechas (desde incluido, hasta excluido) y por columna', async () => {
    const base = { tabla: 'sync_outbox_audit', claves: todos(), orden: 'asc' as const };
    expect(ids(await lector.consultar({ ...base, desde: new Date('2025-03-20T12:00:00Z'), hasta: new Date('2025-04-30T23:59:59Z') }))).toEqual(['b', 'c']);
    expect(await lector.contar({ ...base, filtros: { entity: 'Otra' } })).toBe(1);
    expect(ids(await lector.consultar({ ...base, filtros: { id: ['a', 'd', 'zzz'] } }))).toEqual(['a', 'd']);
    expect(await lector.contar({ ...base, filtros: { deviceInfo: null } })).toBe(3);
    expect(await lector.contar({ ...base, filtros: { id: [] } })).toBe(0);
  });

  it('lee SOLO los archivos que se le piden (un archivo fallido o ajeno no se mezcla)', async () => {
    expect(ids(await lector.consultar({ tabla: 'sync_outbox_audit', claves: [clave(2025, 4)], orden: 'asc' }))).toEqual(['c', 'd']);
  });

  it('tolera archivos antiguos sin una columna nueva (la rellena con NULL)', async () => {
    const viejas = cfg.columnas.filter((c) => c.nombre !== 'deviceInfo');
    const ruta = join(raiz, clave(2024, 12));
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, escribirParquet(viejas, [fila('v', new Date('2024-12-01T00:00:00Z'))]));
    const filas = await lector.consultar({ tabla: 'sync_outbox_audit', claves: [clave(2024, 12), clave(2025, 3)], orden: 'asc' });
    expect(ids(filas)).toEqual(['v', 'a', 'b']);
    expect(filas[0].deviceInfo).toBeNull();
  });

  it('rechaza columnas inexistentes, tablas que no se archivan y consultas sin archivos', async () => {
    await expect(lector.contar({ tabla: 'sync_outbox_audit', claves: todos(), filtros: { 'id" OR 1=1 --': 'x' } })).rejects.toThrow(/no existe/);
    await expect(lector.contar({ tabla: 'usuarios', claves: todos() })).rejects.toThrow(/no se archiva/);
    await expect(lector.contar({ tabla: 'sync_outbox_audit', claves: [] })).rejects.toThrow(/sin archivos/);
  });

  it('no se deja inyectar por el texto de un filtro', async () => {
    expect(await lector.contar({ tabla: 'sync_outbox_audit', claves: todos(), filtros: { id: "a' OR '1'='1" } })).toBe(0);
  });
});

describe.skipIf(duckdbDisponible)('lector DuckDB no disponible en este equipo', () => {
  it('falla con un error claro en vez de omitir datos', async () => {
    const lector = new LectorDuckDb(new ConfigService({ ARCHIVO_RAIZ_LOCAL: tmpdir() }));
    await expect(lector.contar({ tabla: 'sync_outbox_audit', claves: ['x.parquet'] })).rejects.toThrow(/DuckDB\) no está disponible/);
  });

  it('con caché, repetir la consulta sale de la caché con la misma forma y sin volver a leer el archivo', async () => {
    const cache = new CacheService(new ConfigService({ REDIS_PREFIX: 'lector-test' }));
    const conCache = new LectorDuckDb(new ConfigService({ ARCHIVO_RAIZ_LOCAL: raiz }), cache);
    let lecturas = 0;
    const original = (conCache as any).ejecutar.bind(conCache);
    (conCache as any).ejecutar = (...a: unknown[]) => { lecturas++; return original(...a); };

    const consulta = { tabla: 'sync_outbox_audit', claves: todos(), ordenPor: [{ columna: 'syncedAt', dir: 'asc' as const }] };
    const primera = await conCache.consultar(consulta);
    const segunda = await conCache.consultar(consulta);
    expect(lecturas).toBe(1);
    expect(segunda).toEqual(primera);
    expect(segunda[0].syncedAt).toBeInstanceOf(Date);
    expect(segunda[0].payload).toEqual({ id: 'a' });

    expect(await conCache.contar(consulta)).toBe(4);
    expect(await conCache.contar(consulta)).toBe(4);
    expect(lecturas).toBe(2);
    // Otra consulta (otros archivos o filtros) no comparte respuesta.
    expect(ids(await conCache.consultar({ ...consulta, claves: [clave(2025, 4)] }))).toEqual(['c', 'd']);
    expect(lecturas).toBe(3);
    await cache.delPrefijo('');
  });
});
