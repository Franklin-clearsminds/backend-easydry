import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { ArchivadoService } from './archivado.service.js';
import { VerificacionArchivadoService } from './archivado.verificacion.js';
import type { AlmacenArchivo } from './almacen.js';

class AlmacenMemoria implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  /** Si está, `get` de esa clave falla (un bucket que no responde). */
  fallaEn: string | null = null;
  async put(clave: string, cuerpo: Buffer) {
    this.objetos.set(clave, Buffer.from(cuerpo));
  }
  async get(clave: string) {
    if (this.fallaEn && clave.includes(this.fallaEn)) throw new Error('S3 no responde (simulado)');
    return this.objetos.get(clave) ?? null;
  }
}

describe('verificación del archivo histórico (base real, almacén en memoria)', () => {
  let env: Entorno;
  let almacen: AlmacenMemoria;
  let verificador: VerificacionArchivadoService;
  let lotes: Array<{ id: string; clave: string; filas: number }> = [];
  let n = 0;
  const corridas: string[] = [];

  const fila = (fecha: string) =>
    env.prisma.syncOutboxAudit.create({ data: { mutationId: `${env.marca}-m-${++n}`, clientUuid: `${env.marca}-c-${n}`, entity: 'ServicioLavado', action: 'CREATE', payload: {}, syncedAt: new Date(fecha) } });

  /** Archiva una fila de cada mes dado y devuelve los lotes creados (uno por mes). */
  const archivar = async (...fechas: string[]) => {
    for (const f of fechas) await fila(f);
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: new Date('2020-10-15T12:00:00Z'),
      simulacro: false,
      candado: `prueba-${env.marca}`,
      tablas: ['sync_outbox_audit'],
      filtroExtra: { sync_outbox_audit: { clientUuid: { startsWith: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado).toBe('OK');
    return env.prisma.archivadoLote.findMany({ where: { corridaId: r.corridaId, tabla: 'sync_outbox_audit' }, orderBy: { createdAt: 'asc' } });
  };
  const verificar = async (soloLotes: string[], maxLotes?: number) => {
    const r = await verificador.verificar({ soloLotes, maxLotes });
    corridas.push(r.corridaId);
    return r;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    almacen = new AlmacenMemoria();
    verificador = new VerificacionArchivadoService(env.prisma as never, almacen);
    lotes = await archivar('2019-02-05T15:00:00Z', '2019-03-05T15:00:00Z', '2019-04-05T15:00:00Z', '2019-05-05T15:00:00Z', '2019-06-05T15:00:00Z', '2019-07-05T15:00:00Z');
    expect(lotes).toHaveLength(6);
  });

  afterAll(async () => {
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
  });

  it('un archivo íntegro pasa: se anota cuándo se comprobó y que no hay problema', async () => {
    const [bueno] = lotes;
    const r = await verificar([bueno.id]);
    expect(r).toMatchObject({ estado: 'OK', revisados: 1, correctos: 1, problemas: [] });
    const despues = await env.prisma.archivadoLote.findUniqueOrThrow({ where: { id: bueno.id } });
    expect(despues.verificadoEn).toBeInstanceOf(Date);
    expect(despues.problema).toBeNull();
  });

  it('detecta un archivo que ya no está en el bucket', async () => {
    const lote = lotes[1];
    almacen.objetos.delete(lote.clave);
    const r = await verificar([lote.id]);
    expect(r.estado).toBe('ERROR');
    expect(r.problemas).toEqual([{ clave: lote.clave, tabla: 'sync_outbox_audit', motivo: 'El archivo ya no está en el bucket.' }]);
    expect((await env.prisma.archivadoLote.findUniqueOrThrow({ where: { id: lote.id } })).problema).toMatch(/ya no está/);
  });

  it('detecta un archivo alterado (la huella no coincide)', async () => {
    const lote = lotes[2];
    const original = almacen.objetos.get(lote.clave)!;
    almacen.objetos.set(lote.clave, Buffer.concat([original, Buffer.from('x')]));
    const r = await verificar([lote.id]);
    expect(r.problemas[0].motivo).toMatch(/huella no coincide/);
  });

  it('detecta que el número de filas registrado no coincide con el del archivo', async () => {
    const lote = lotes[3];
    await env.prisma.archivadoLote.update({ where: { id: lote.id }, data: { filas: lote.filas + 7 } });
    const r = await verificar([lote.id]);
    expect(r.problemas[0].motivo).toMatch(/número de filas/);
  });

  it('detecta que falta el manifiesto del lote', async () => {
    const lote = lotes[4];
    almacen.objetos.delete(lote.clave.replace('archivo-historico/', 'archivo-historico/_manifiestos/').replace(/\.parquet$/, '.json'));
    const r = await verificar([lote.id]);
    expect(r.problemas[0].motivo).toMatch(/manifiesto/);
  });

  it('si el bucket no responde, lo anota como problema en vez de fallar la verificación entera', async () => {
    const lote = lotes[5];
    almacen.fallaEn = lote.clave;
    const r = await verificar([lote.id]);
    almacen.fallaEn = null;
    expect(r.estado).toBe('ERROR');
    expect(r.problemas[0].motivo).toMatch(/No se pudo comprobar: S3 no responde/);
  });

  it('revisa primero lo que nunca se comprobó o se comprobó hace más tiempo, y recorre todo con el tiempo', async () => {
    const ids = lotes.map((l) => l.id);
    // Dejamos tres lotes sin comprobar y tres comprobados "hace tiempo", en distinto orden.
    await env.prisma.archivadoLote.updateMany({ where: { id: { in: ids } }, data: { verificadoEn: null, problema: null } });
    await env.prisma.archivadoLote.update({ where: { id: lotes[0].id }, data: { verificadoEn: new Date('2020-01-03T00:00:00Z') } });
    await env.prisma.archivadoLote.update({ where: { id: lotes[1].id }, data: { verificadoEn: new Date('2020-01-01T00:00:00Z') } });
    await env.prisma.archivadoLote.update({ where: { id: lotes[2].id }, data: { verificadoEn: new Date('2020-01-02T00:00:00Z') } });

    const primera = await verificar(ids, 3);
    expect(primera.revisados).toBe(3);
    const revisadosPrimera = await env.prisma.archivadoLote.findMany({ where: { id: { in: ids }, verificadoEn: { gt: new Date('2025-01-01T00:00:00Z') } }, select: { id: true } });
    // Los tres nunca comprobados (lotes 3, 4 y 5), no los ya comprobados.
    expect(revisadosPrimera.map((l) => l.id).sort()).toEqual([lotes[3].id, lotes[4].id, lotes[5].id].sort());

    const segunda = await verificar(ids, 3);
    expect(segunda.revisados).toBe(3);
    const todosAhora = await env.prisma.archivadoLote.findMany({ where: { id: { in: ids }, verificadoEn: { gt: new Date('2025-01-01T00:00:00Z') } }, select: { id: true } });
    // La segunda pasada toma los más viejos (1, 2, 0): con dos pasadas se recorrió todo.
    expect(todosAhora).toHaveLength(6);
  });

  it('la verificación queda registrada como una corrida con su resumen', async () => {
    const r = await verificar([lotes[0].id]);
    const corrida = await env.prisma.archivadoCorrida.findUniqueOrThrow({ where: { id: r.corridaId } });
    expect((corrida.resumen as any)._verificacion).toMatchObject({ revisados: 1, correctos: 1 });
    expect(corrida.fin).toBeInstanceOf(Date);
    expect(corrida.estado).toBe('OK');
  });
});
