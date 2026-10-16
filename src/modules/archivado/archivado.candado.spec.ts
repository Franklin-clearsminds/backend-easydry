import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { ArchivadoService } from './archivado.service.js';
import type { AlmacenArchivo } from './almacen.js';

/** Almacén en memoria con una compuerta: `put` se queda esperando hasta que la prueba la abre. */
class AlmacenConCompuerta implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  private abrir!: () => void;
  readonly compuerta = new Promise<void>((ok) => (this.abrir = ok));
  /** Se cumple cuando la corrida ya llegó a subir su primer archivo. */
  readonly enSubida: Promise<void>;
  private avisar!: () => void;
  private usada = false;
  constructor(private readonly conCompuerta: boolean) {
    this.enSubida = new Promise<void>((ok) => (this.avisar = ok));
  }
  liberar() {
    this.abrir();
  }
  async put(clave: string, cuerpo: Buffer) {
    this.objetos.set(clave, Buffer.from(cuerpo));
    if (this.conCompuerta && !this.usada && clave.endsWith('.parquet')) {
      this.usada = true;
      this.avisar();
      await this.compuerta;
    }
  }
  async get(clave: string) {
    return this.objetos.get(clave) ?? null;
  }
}

/** Una corrida real contra filas marcadas de `sync_outbox_audit`, con un candado propio de la prueba. */
describe('candado del archivado: una sola corrida real a la vez (base real)', () => {
  let env: Entorno;
  let n = 0;
  const corridas: string[] = [];
  const AHORA = new Date('2020-10-15T12:00:00Z');
  let candado: string;

  beforeAll(async () => {
    env = await abrirEntorno();
    candado = `prueba-${env.marca}`;
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
  });

  const fila = (fecha: string) =>
    env.prisma.syncOutboxAudit.create({ data: { mutationId: `${env.marca}-m-${++n}`, clientUuid: `${env.marca}-c-${n}`, entity: 'ServicioLavado', action: 'CREATE', payload: {}, syncedAt: new Date(fecha) } });
  const enBase = () => env.prisma.syncOutboxAudit.count({ where: { clientUuid: { startsWith: env.marca } } });
  const servicio = (almacen: AlmacenArchivo) => new ArchivadoService(env.prisma as never, almacen);
  const correr = async (almacen: AlmacenArchivo, extra: Record<string, unknown> = {}) => {
    const r = await servicio(almacen).ejecutar({
      ahora: AHORA,
      simulacro: false,
      candado,
      tablas: ['sync_outbox_audit'],
      filtroExtra: { sync_outbox_audit: { clientUuid: { startsWith: env.marca } } },
      ...extra,
    });
    if (r.corridaId) corridas.push(r.corridaId);
    return r;
  };
  const tomarCandado = (propietario: string, segundos: number) =>
    env.prisma.$executeRawUnsafe(
      `INSERT INTO archivado_candado (id, propietario, hasta) VALUES ($1, $2, (now() AT TIME ZONE 'UTC') + $3 * interval '1 second')
       ON CONFLICT (id) DO UPDATE SET propietario = EXCLUDED.propietario, hasta = EXCLUDED.hasta`,
      candado, propietario, segundos,
    );

  it('mientras una corrida real está archivando, otra (de otra instancia) se omite y no crea nada', async () => {
    await fila('2019-03-05T15:00:00Z');
    const lenta = new AlmacenConCompuerta(true);

    const primera = correr(lenta); // se queda a mitad de subir un archivo
    try {
      await lenta.enSubida;

      const segunda = await correr(new AlmacenConCompuerta(false));
      expect(segunda.omitida).toBe(true);
      expect(segunda.corridaId).toBe(''); // la omitida no llegó a crear su fila de corrida
      expect(await enBase()).toBe(1); // y no tocó nada
    } finally {
      // Pase lo que pase, la primera termina: si se quedara esperando, mantendría el candado y fallarían en cascada las demás.
      lenta.liberar();
    }
    const r1 = await primera;
    expect(r1.estado).toBe('OK');
    expect(r1.omitida).toBeUndefined();
    expect(await enBase()).toBe(0);
  });

  it('la siguiente corrida real cierra como interrumpida la que quedó "en curso" hace horas, y no toca una reciente', async () => {
    const colgada = await env.prisma.archivadoCorrida.create({ data: { simulacro: false, estado: 'EN_CURSO', inicio: new Date(Date.now() - 3 * 60 * 60 * 1000) } });
    const reciente = await env.prisma.archivadoCorrida.create({ data: { simulacro: false, estado: 'EN_CURSO', inicio: new Date(Date.now() - 2 * 60 * 1000) } });
    corridas.push(colgada.id, reciente.id);

    await correr(new AlmacenConCompuerta(false));

    const cerrada = await env.prisma.archivadoCorrida.findUniqueOrThrow({ where: { id: colgada.id } });
    expect(cerrada.estado).toBe('ERROR');
    expect(cerrada.error).toMatch(/se interrumpió/);
    expect(cerrada.fin).toBeInstanceOf(Date);
    expect((await env.prisma.archivadoCorrida.findUniqueOrThrow({ where: { id: reciente.id } })).estado).toBe('EN_CURSO'); // esa puede estar corriendo de verdad
  });

  it('al terminar libera el candado: la siguiente corrida sí corre', async () => {
    await fila('2019-04-05T15:00:00Z');
    const r = await correr(new AlmacenConCompuerta(false));
    expect(r.omitida).toBeUndefined();
    expect(r.tablas.sync_outbox_audit.archivadas).toBe(1);
  });

  it('un candado vencido (la instancia que lo tenía murió) se puede tomar', async () => {
    await tomarCandado('instancia-muerta', -60); // venció hace un minuto
    await fila('2019-05-05T15:00:00Z');
    const r = await correr(new AlmacenConCompuerta(false));
    expect(r.omitida).toBeUndefined();
    expect(r.tablas.sync_outbox_audit.archivadas).toBe(1);
  });

  it('un candado vigente de otra instancia bloquea la corrida real', async () => {
    await tomarCandado('otra-instancia', 600);
    await fila('2019-06-05T15:00:00Z');
    const r = await correr(new AlmacenConCompuerta(false));
    expect(r.omitida).toBe(true);
    expect(await enBase()).toBe(1);
    await tomarCandado('liberado', -60);
  });

  it('un simulacro no necesita el candado: corre aunque haya una corrida real en curso', async () => {
    await tomarCandado('otra-instancia', 600);
    const r = await correr(new AlmacenConCompuerta(false), { simulacro: true });
    expect(r.omitida).toBeUndefined();
    expect(r.simulacro).toBe(true);
    expect(r.tablas.sync_outbox_audit.simuladas).toBe(1);
    expect(await enBase()).toBe(1);
    await tomarCandado('liberado', -60);
  });

  it('si pierde el candado a mitad de la corrida, se detiene ANTES de borrar de la base', async () => {
    await env.prisma.syncOutboxAudit.deleteMany({ where: { clientUuid: { startsWith: env.marca } } });
    await fila('2019-07-05T15:00:00Z');
    const lenta = new AlmacenConCompuerta(true);

    const corrida = correr(lenta);
    try {
      await lenta.enSubida;
      await tomarCandado('otra-instancia', 600); // otra instancia se lo queda mientras esta sube
    } finally {
      lenta.liberar();
    }
    const r = await corrida;

    expect(r.estado).toBe('ERROR');
    expect(r.tablas.sync_outbox_audit.errores.join(' ')).toMatch(/Se perdió el candado/);
    expect(await enBase()).toBe(1); // lo subido quedó verificado en el bucket, pero NO se borró de la base
    const lote = await env.prisma.archivadoLote.findFirstOrThrow({ where: { corridaId: r.corridaId, tabla: 'sync_outbox_audit' } });
    expect(lote.estado).toBe('VERIFICADO'); // subido y comprobado, pendiente de borrar: lo retoma la siguiente corrida

    // Con el candado libre otra vez, la siguiente corrida retoma ese lote y lo termina, sin duplicarlo.
    await tomarCandado('liberado', -60);
    const siguiente = await correr(lenta, { retomarDespuesDe: 0, retomarDeCorridas: [r.corridaId] });
    expect(siguiente.estado).toBe('OK');
    expect(await enBase()).toBe(0);
    expect((await env.prisma.archivadoLote.findUniqueOrThrow({ where: { id: lote.id } })).estado).toBe('BORRADO');
    expect([...lenta.objetos.keys()].filter((k) => k.endsWith('.parquet') && k.includes('anio=2019/mes=07')).length).toBe(1);
  });
});
