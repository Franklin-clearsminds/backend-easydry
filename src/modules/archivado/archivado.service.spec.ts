import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parquetReadObjects } from 'hyparquet';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { ArchivadoService, type ResultadoCorrida } from './archivado.service.js';
import type { AlmacenArchivo } from './almacen.js';
import { leerIds } from './parquet.js';

/** Almacén en memoria: las pruebas nunca tocan el bucket real. */
class AlmacenMemoria implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  corromperLecturas = false;
  /** Falla el put número N (contando desde 1) de esta instancia. */
  fallarPut: number | null = null;
  private puts = 0;

  async put(clave: string, cuerpo: Buffer) {
    this.puts++;
    if (this.fallarPut === this.puts) throw new Error('S3 caído (simulado)');
    this.objetos.set(clave, Buffer.from(cuerpo));
  }
  async get(clave: string) {
    const o = this.objetos.get(clave);
    if (!o) return null;
    return this.corromperLecturas ? Buffer.concat([o, Buffer.from('x')]) : o;
  }
  parquets() {
    return [...this.objetos.keys()].filter((k) => k.endsWith('.parquet')).sort();
  }
}

describe('archivado a Parquet (base real, almacén en memoria)', () => {
  let env: Entorno;
  let n = 0;
  const corridas: string[] = [];
  const AHORA = new Date('2026-10-15T12:00:00Z');
  const hace = (iso: string) => new Date(iso);

  beforeAll(async () => {
    env = await abrirEntorno();
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.prisma.loginIntento.deleteMany({ where: { email: { startsWith: env.marca } } });
    await env.cerrar();
  });

  const auditoria = (syncedAt: Date, payload: unknown = { ok: true }) =>
    env.prisma.syncOutboxAudit.create({
      data: { mutationId: `${env.marca}-m-${++n}`, clientUuid: `${env.marca}-c-${n}`, entity: 'ServicioLavado', action: 'CREATE', payload: payload as never, syncedAt },
    });

  const correr = async (almacen: AlmacenMemoria, opc: Parameters<ArchivadoService['ejecutar']>[0] = {}): Promise<ResultadoCorrida> => {
    const servicio = new ArchivadoService(env.prisma as never, almacen);
    const r = await servicio.ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      tablas: ['sync_outbox_audit'],
      filtroExtra: { sync_outbox_audit: { clientUuid: { startsWith: env.marca } } },
      ...opc,
    });
    corridas.push(r.corridaId);
    return r;
  };

  const cuantas = () => env.prisma.syncOutboxAudit.count({ where: { clientUuid: { startsWith: env.marca } } });

  it('en simulacro informa qué archivaría y no sube ni borra nada', async () => {
    await auditoria(hace('2025-03-10T10:00:00Z'));
    await auditoria(hace('2025-04-02T10:00:00Z'));
    const antes = await cuantas();
    const almacen = new AlmacenMemoria();

    const r = await correr(almacen, { simulacro: true });

    expect(r.estado).toBe('OK');
    expect(r.tablas.sync_outbox_audit.simuladas).toBe(antes);
    expect(almacen.objetos.size).toBe(0);
    expect(await cuantas()).toBe(antes);
    const lotes = await env.prisma.archivadoLote.count({ where: { corridaId: r.corridaId } });
    expect(lotes).toBe(0);
  });

  it('el simulacro es el modo por defecto', async () => {
    const almacen = new AlmacenMemoria();
    const antes = await cuantas();
    const servicio = new ArchivadoService(env.prisma as never, almacen);
    const r = await servicio.ejecutar({ ahora: AHORA, candado: `prueba-${env.marca}`, tablas: ['sync_outbox_audit'], filtroExtra: { sync_outbox_audit: { clientUuid: { startsWith: env.marca } } } });
    corridas.push(r.corridaId);
    expect(r.simulacro).toBe(true);
    expect(await cuantas()).toBe(antes);
    expect(almacen.objetos.size).toBe(0);
  });

  it('archiva por mes completo, verifica, borra de la base y deja lo reciente', async () => {
    await auditoria(hace('2025-03-20T10:00:00Z'), { texto: 'ñandú', n: 3 });
    const reciente = await auditoria(hace('2026-10-01T10:00:00Z'));
    const almacen = new AlmacenMemoria();

    const r = await correr(almacen, { simulacro: false });

    expect(r.estado).toBe('OK');
    expect(r.tablas.sync_outbox_audit.archivadas).toBe(r.tablas.sync_outbox_audit.borradas);
    // Solo queda lo que está dentro de la ventana (la fila de octubre de 2026).
    const restantes = await env.prisma.syncOutboxAudit.findMany({ where: { clientUuid: { startsWith: env.marca } } });
    expect(restantes.map((f) => f.id)).toEqual([reciente.id]);

    const claves = almacen.parquets();
    expect(claves.some((c) => c.includes('sync_outbox_audit/anio=2025/mes=03/part-0001.parquet'))).toBe(true);
    expect(claves.some((c) => c.includes('anio=2025/mes=04/'))).toBe(true);
    // Un manifiesto por lote.
    expect([...almacen.objetos.keys()].filter((k) => k.includes('/_manifiestos/')).length).toBe(claves.length);

    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: r.corridaId } });
    expect(lotes.length).toBe(claves.length);
    expect(lotes.every((l) => l.estado === 'BORRADO' && l.esquemaVersion === 1 && l.borradoEn)).toBe(true);
    expect(lotes.reduce((s, l) => s + l.filas, 0)).toBe(r.tablas.sync_outbox_audit.archivadas);

    // El contenido del Parquet es el de las filas que salieron de la base (JSON como texto, UTF-8 intacto).
    const marzo = lotes.find((l) => l.mes === 3)!;
    const bytes = almacen.objetos.get(marzo.clave)!;
    const filas = await parquetReadObjects({ file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
    expect(filas.length).toBe(marzo.filas);
    // jsonb no conserva el orden de las claves: se compara el contenido, no el texto.
    expect(filas.some((f) => typeof f.payload === 'string' && JSON.stringify(JSON.parse(f.payload)) === JSON.stringify({ n: 3, texto: 'ñandú' }))).toBe(true);
    expect(filas.every((f) => (f.clientUuid as string).startsWith(env.marca))).toBe(true);
  });

  it('si lo subido no coincide, no borra nada y marca el lote como FALLIDO', async () => {
    const fila = await auditoria(hace('2025-05-05T10:00:00Z'));
    const almacen = new AlmacenMemoria();
    almacen.corromperLecturas = true;

    const r = await correr(almacen, { simulacro: false });

    expect(r.estado).toBe('ERROR');
    expect(r.tablas.sync_outbox_audit.errores[0]).toMatch(/no coincide/);
    expect(await env.prisma.syncOutboxAudit.count({ where: { id: fila.id } })).toBe(1);
    const lote = await env.prisma.archivadoLote.findFirstOrThrow({ where: { corridaId: r.corridaId } });
    expect(lote.estado).toBe('FALLIDO');
    const corrida = await env.prisma.archivadoCorrida.findUniqueOrThrow({ where: { id: r.corridaId } });
    expect(corrida.estado).toBe('ERROR');
    expect(corrida.error).toMatch(/sync_outbox_audit/);
  });

  it('retoma un lote que quedó a medias sin duplicar ni perder filas', async () => {
    // Limpia el estado de la prueba anterior para aislar este caso.
    await env.prisma.syncOutboxAudit.deleteMany({ where: { clientUuid: { startsWith: env.marca }, syncedAt: { lt: hace('2026-01-01T00:00:00Z') } } });
    const fila = await auditoria(hace('2025-06-06T10:00:00Z'));
    const caido = new AlmacenMemoria();
    caido.fallarPut = 2; // sube el parquet (put 1) y falla al escribir el manifiesto (put 2)

    const r1 = await correr(caido, { simulacro: false });
    expect(r1.estado).toBe('ERROR');
    expect(await env.prisma.syncOutboxAudit.count({ where: { id: fila.id } })).toBe(1);
    const pendiente = await env.prisma.archivadoLote.findFirstOrThrow({ where: { corridaId: r1.corridaId } });
    expect(pendiente.estado).toBe('SUBIDO');

    caido.fallarPut = null;
    const r2 = await correr(caido, { simulacro: false, retomarDespuesDe: 0, retomarDeCorridas: [r1.corridaId] });

    expect(r2.estado).toBe('OK');
    expect(await env.prisma.syncOutboxAudit.count({ where: { id: fila.id } })).toBe(0);
    const lote = await env.prisma.archivadoLote.findUniqueOrThrow({ where: { id: pendiente.id } });
    expect(lote.estado).toBe('BORRADO');
    // No se creó un segundo archivo para la misma fila.
    expect(caido.parquets().filter((k) => k.includes('anio=2025/mes=06/')).length).toBe(1);
    expect(await leerIds(caido.objetos.get(lote.clave)!)).toEqual([fila.id]);
  });

  it('parte un mes grande en varios archivos y agrega partes nuevas si llegan filas tardías', async () => {
    await env.prisma.syncOutboxAudit.deleteMany({ where: { clientUuid: { startsWith: env.marca }, syncedAt: { lt: hace('2026-01-01T00:00:00Z') } } });
    for (let i = 0; i < 5; i++) await auditoria(hace(`2025-07-0${i + 1}T10:00:00Z`));
    const almacen = new AlmacenMemoria();

    const r = await correr(almacen, { simulacro: false, filasPorParte: 2 });
    expect(r.tablas.sync_outbox_audit.lotes).toBe(3);
    expect(almacen.parquets().map((k) => k.split('/').pop())).toEqual(['part-0001.parquet', 'part-0002.parquet', 'part-0003.parquet']);

    await auditoria(hace('2025-07-20T10:00:00Z')); // fila tardía de un mes ya archivado
    await correr(almacen, { simulacro: false });
    expect(almacen.parquets().filter((k) => k.includes('anio=2025/mes=07/')).length).toBe(4);
    expect(await cuantas()).toBe(0 + (await env.prisma.syncOutboxAudit.count({ where: { clientUuid: { startsWith: env.marca }, syncedAt: { gte: hace('2026-01-01T00:00:00Z') } } })));
  });

  it('no archiva lo que sigue "vivo": una mutación sin resolver se queda en la base', async () => {
    const dlq = (resuelto: boolean) =>
      env.prisma.syncDeadLetterQueue.create({
        data: { mutationId: `${env.marca}-d-${++n}`, clientUuid: `${env.marca}-d-${n}`, entityType: 'ServicioLavado', payload: {}, errorMotivo: 'prueba', resuelto, createdAt: hace('2025-02-02T10:00:00Z') },
      });
    const resuelta = await dlq(true);
    const pendiente = await dlq(false);
    const almacen = new AlmacenMemoria();

    const r = await correr(almacen, { simulacro: false, tablas: ['sync_dead_letter_queue'], filtroExtra: { sync_dead_letter_queue: { clientUuid: { startsWith: env.marca } } } });

    expect(r.estado).toBe('OK');
    expect(await env.prisma.syncDeadLetterQueue.count({ where: { id: resuelta.id } })).toBe(0);
    expect(await env.prisma.syncDeadLetterQueue.count({ where: { id: pendiente.id } })).toBe(1);
    expect(almacen.parquets().some((k) => k.includes('sync_dead_letter_queue/anio=2025/mes=02/'))).toBe(true);
  });

  it('purga las tablas técnicas viejas y deja las recientes, sin archivar', async () => {
    const dias = (d: number) => new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);
    await env.prisma.loginIntento.createMany({
      data: [
        { email: `${env.marca}-vieja@no-existe.test`, intentos: 3, desde: dias(45) },
        { email: `${env.marca}-nueva@no-existe.test`, intentos: 1, desde: dias(2) },
      ],
    });
    const almacen = new AlmacenMemoria();

    const r = await correr(almacen, { simulacro: false, tablas: ['login_intento'], filtroExtra: { login_intento: { email: { startsWith: env.marca } } } });

    expect(r.tablas.login_intento.purgadas).toBe(1);
    const quedan = await env.prisma.loginIntento.findMany({ where: { email: { startsWith: env.marca } } });
    expect(quedan.map((q) => q.email)).toEqual([`${env.marca}-nueva@no-existe.test`]);
    expect(almacen.objetos.size).toBe(0);
  });
});
