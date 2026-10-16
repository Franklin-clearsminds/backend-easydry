import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import type { ConsultaArchivo, LectorArchivo } from './archivo-lector.js';
import { HistoricoService } from './historico.service.js';

type Fila = Record<string, unknown>;

/** Lector en memoria: aplica rango, filtros, orden y paginación sobre las filas que se le cargaron por clave. */
class LectorMemoria implements LectorArchivo {
  porClave = new Map<string, Fila[]>();
  llamadas: ConsultaArchivo[] = [];
  disponible = true;

  private filtrar(c: ConsultaArchivo): Fila[] {
    if (!this.disponible) throw new Error('El lector del archivo histórico (DuckDB) no está disponible en este equipo: simulado');
    this.llamadas.push(c);
    const sentido = c.orden === 'asc' ? 1 : -1;
    return c.claves
      .flatMap((k) => this.porClave.get(k) ?? [])
      .filter((f) => (!c.desde || (f.createdAt as Date) >= c.desde) && (!c.hasta || (f.createdAt as Date) < c.hasta))
      .filter((f) => Object.entries(c.filtros ?? {}).every(([col, v]) => (Array.isArray(v) ? v.includes(f[col] as never) : f[col] === v)))
      .sort((a, b) => ((a.createdAt as Date).getTime() - (b.createdAt as Date).getTime()) * sentido || String(a.id).localeCompare(String(b.id)) * sentido);
  }
  async consultar(c: ConsultaArchivo) {
    const todas = this.filtrar(c);
    const offset = c.offset ?? 0;
    return todas.slice(offset, c.limite === undefined ? undefined : offset + c.limite);
  }
  async contar(c: ConsultaArchivo) {
    return this.filtrar(c).length;
  }
  async contarPor(c: ConsultaArchivo, columna: string) {
    const cuenta: Record<string, number> = {};
    for (const f of this.filtrar(c)) cuenta[String(f[columna])] = (cuenta[String(f[columna])] ?? 0) + 1;
    return cuenta;
  }
}

describe('consulta histórica: base + archivo (base real, lector en memoria)', () => {
  let env: Entorno;
  let n = 0;
  let lector: LectorMemoria;
  let servicio: HistoricoService;
  let userId: string;
  const clavesCreadas: string[] = [];

  // Se usa `notification` (y no `sync_outbox_audit`) para no cruzarse con las pruebas de archivado.service, que corren en
  // paralelo contra la misma base y retoman cualquier lote pendiente de su tabla.
  const enDb = (createdAt: string) =>
    env.prisma.notification.create({
      data: { userId, tipo: 'STOCK_CRITICO', titulo: `${env.marca} ${++n}`, mensaje: 'prueba', createdAt: new Date(createdAt) },
    });

  const lote = async (sufijo: string, estado: string, anio: number, mes: number, filas: Array<{ id: string; fecha: string }>) => {
    const clave = `${env.marca}/lote-${sufijo}.parquet`;
    clavesCreadas.push(clave);
    const fechas = filas.map((f) => new Date(f.fecha).getTime());
    await env.prisma.archivadoLote.create({
      data: { tabla: 'notification', anio, mes, parte: 1, clave, filas: filas.length, bytes: 1, sha256: 'x', esquemaVersion: 1, estado, fechaMin: new Date(Math.min(...fechas)), fechaMax: new Date(Math.max(...fechas)) },
    });
    lector.porClave.set(clave, filas.map((f) => ({ id: f.id, createdAt: new Date(f.fecha), userId })));
    return clave;
  };

  const consulta = (extra: Partial<Parameters<HistoricoService['consultar']>[0]> = {}) =>
    servicio.consultar({ tabla: 'notification', dondeDb: { userId }, filtrosArchivo: { userId }, limite: 100, ...extra });
  const ids = (r: { filas: Fila[] }) => r.filas.map((f) => f.id);

  beforeAll(async () => {
    env = await abrirEntorno();
    userId = (await env.usuario('hist', 'LAVADOR')).id;
    lector = new LectorMemoria();
    servicio = new HistoricoService(env.prisma as never, lector);
  });

  afterAll(async () => {
    await env.prisma.archivadoLote.deleteMany({ where: { clave: { in: clavesCreadas } } });
    await env.cerrar();
  });

  it('sin lotes que toquen el rango, solo lee la base y NO consulta el archivo', async () => {
    const a = await enDb('2026-10-01T10:00:00Z');
    const b = await enDb('2026-10-05T10:00:00Z');

    const r = await consulta({ desde: new Date('2026-09-01T00:00:00Z') });

    expect(ids(r)).toEqual([b.id, a.id]);
    expect(r.total).toBe(2);
    expect(r.usoArchivo).toBe(false);
    expect(lector.llamadas).toHaveLength(0);
  });

  it('une base y archivo ordenados por fecha, con total de ambos', async () => {
    await lote('ene', 'BORRADO', 2025, 1, [{ id: 'z-ene-1', fecha: '2025-01-10T10:00:00Z' }, { id: 'z-ene-2', fecha: '2025-01-20T10:00:00Z' }]);

    const r = await consulta();

    expect(r.usoArchivo).toBe(true);
    expect(r.total).toBe(4);
    expect(r.filas.map((f) => (f.createdAt as Date).toISOString().slice(0, 10))).toEqual(['2026-10-05', '2026-10-01', '2025-01-20', '2025-01-10']);
    expect(ids(await consulta({ orden: 'asc' })).slice(0, 2)).toEqual(['z-ene-1', 'z-ene-2']);
  });

  it('pagina a través de las dos fuentes sin saltarse ni repetir filas', async () => {
    const todas = ids(await consulta());
    const paginas = [...ids(await consulta({ limite: 3, offset: 0 })), ...ids(await consulta({ limite: 3, offset: 3 }))];
    expect(paginas).toEqual(todas);
    expect(ids(await consulta({ limite: 2, offset: 1 }))).toEqual(todas.slice(1, 3));
    expect((await consulta({ limite: 2, offset: 1 })).total).toBe(todas.length);
  });

  it('solo lee lotes BORRADO: uno VERIFICADO (filas aún en la base) o FALLIDO no duplica ni contamina', async () => {
    await lote('dup', 'VERIFICADO', 2025, 2, [{ id: 'dup-1', fecha: '2025-02-10T10:00:00Z' }]);
    await lote('mal', 'FALLIDO', 2025, 3, [{ id: 'mal-1', fecha: '2025-03-10T10:00:00Z' }]);
    await lote('sub', 'SUBIDO', 2025, 4, [{ id: 'sub-1', fecha: '2025-04-10T10:00:00Z' }]);

    const r = await consulta();

    expect(ids(r)).not.toContain('dup-1');
    expect(ids(r)).not.toContain('mal-1');
    expect(ids(r)).not.toContain('sub-1');
    expect(r.total).toBe(4);
  });

  it('el rango de fechas decide qué lotes se leen; fuera de ellos no toca el archivo', async () => {
    lector.llamadas.length = 0;
    const soloEnero = await consulta({ desde: new Date('2025-01-01T00:00:00Z'), hasta: new Date('2025-02-01T00:00:00Z') });
    expect(ids(soloEnero)).toEqual(['z-ene-2', 'z-ene-1']);
    expect(lector.llamadas[0].claves).toEqual([`${env.marca}/lote-ene.parquet`]);

    lector.llamadas.length = 0;
    const entreMedio = await consulta({ desde: new Date('2025-06-01T00:00:00Z'), hasta: new Date('2026-09-01T00:00:00Z') });
    expect(entreMedio.filas).toHaveLength(0);
    expect(entreMedio.usoArchivo).toBe(false);
    expect(lector.llamadas).toHaveLength(0);
  });

  it('aplica los filtros (ámbito) también al archivo', async () => {
    await lote('otro', 'BORRADO', 2025, 5, [{ id: 'otro-1', fecha: '2025-05-05T10:00:00Z' }]);
    lector.porClave.get(`${env.marca}/lote-otro.parquet`)![0].userId = 'de-otro-usuario';

    const r = await consulta();

    expect(ids(r)).not.toContain('otro-1');
    expect(lector.llamadas.at(-1)?.filtros).toEqual({ userId });
  });

  it('si hay que leer el archivo y el lector no está disponible, falla: nunca omite datos en silencio', async () => {
    lector.disponible = false;
    await expect(consulta()).rejects.toThrow(/no está disponible/);
    // Sin lotes en el rango sigue funcionando.
    await expect(consulta({ desde: new Date('2026-09-01T00:00:00Z') })).resolves.toMatchObject({ usoArchivo: false });
    lector.disponible = true;
  });

  it('rechaza tablas que no se archivan', async () => {
    await expect(servicio.consultar({ tabla: 'users', limite: 5 })).rejects.toThrow(/no se archiva/);
  });
});
