import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { ArchivadoService } from './archivado.service.js';
import type { AlmacenArchivo } from './almacen.js';

class AlmacenMemoria implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  async put(clave: string, cuerpo: Buffer) {
    this.objetos.set(clave, Buffer.from(cuerpo));
  }
  async get(clave: string) {
    return this.objetos.get(clave) ?? null;
  }
}

/**
 * Dos corridas que quieren el mismo número de parte (misma tabla y mes). Pasa de verdad cuando hay dos instancias o cuando
 * dos procesos calculan "la siguiente parte" a la vez. Lo que NO debe pasar es que la que pierde pise el archivo de la ganadora.
 */
describe('numeración de partes del archivo: reservar antes de subir (base real)', () => {
  let env: Entorno;
  const corridas: string[] = [];
  const clavesAjenas: string[] = [];
  const AHORA = new Date('2020-10-15T12:00:00Z');

  beforeAll(async () => {
    env = await abrirEntorno();
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { OR: [{ corridaId: { in: corridas } }, { clave: { in: clavesAjenas } }] }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
  });

  it('si el número que calculó ya está ocupado, pide el siguiente y NO sobrescribe el archivo de la otra corrida', async () => {
    const clave1 = 'archivo-historico/sync_outbox_audit/anio=2019/mes=08/part-0001.parquet';
    clavesAjenas.push(clave1);
    // La "otra corrida" ya reservó la parte 1 de ese mes (y subió su archivo, que aquí no existe en el almacén de esta corrida).
    await env.prisma.archivadoLote.create({
      data: { tabla: 'sync_outbox_audit', anio: 2019, mes: 8, parte: 1, clave: clave1, filas: 1, bytes: 1, sha256: 'de-la-otra-corrida', esquemaVersion: 1, estado: 'VERIFICADO', fechaMin: new Date('2019-08-01T00:00:00Z'), fechaMax: new Date('2019-08-02T00:00:00Z') },
    });
    await env.prisma.syncOutboxAudit.create({ data: { mutationId: `${env.marca}-m-1`, clientUuid: `${env.marca}-c-1`, entity: 'ServicioLavado', action: 'CREATE', payload: {}, syncedAt: new Date('2019-08-05T15:00:00Z') } });

    // Esta corrida ve una foto vieja: cree que aún no hay ninguna parte (la primera consulta de "la última parte" devuelve vacío).
    let consultas = 0;
    const prismaConFotoVieja = new Proxy(env.prisma, {
      get(objetivo, propiedad, receptor) {
        if (propiedad === 'archivadoLote') {
          return new Proxy(objetivo.archivadoLote, {
            get(delegado, nombre) {
              if (nombre === 'aggregate') return async (...args: any[]) => (consultas++ === 0 ? { _max: { parte: null } } : (delegado as any).aggregate(...args));
              const v = (delegado as any)[nombre];
              return typeof v === 'function' ? v.bind(delegado) : v;
            },
          });
        }
        const v = Reflect.get(objetivo, propiedad, receptor);
        return typeof v === 'function' ? v.bind(objetivo) : v;
      },
    });
    const almacen = new AlmacenMemoria();

    const r = await new ArchivadoService(prismaConFotoVieja as never, almacen).ejecutar({
      ahora: AHORA,
      simulacro: false,
      candado: `prueba-${env.marca}`,
      tablas: ['sync_outbox_audit'],
      filtroExtra: { sync_outbox_audit: { clientUuid: { startsWith: env.marca } } },
    });
    corridas.push(r.corridaId);

    expect(r.estado, JSON.stringify(r.tablas)).toBe('OK');
    expect(r.tablas.sync_outbox_audit.archivadas).toBe(1);
    // Chocó con la parte 1 (consultas > 1 = reintentó) y se quedó con la 2.
    expect(consultas).toBeGreaterThanOrEqual(2);
    const claves = [...almacen.objetos.keys()].filter((k) => k.endsWith('.parquet'));
    expect(claves).toEqual(['archivo-historico/sync_outbox_audit/anio=2019/mes=08/part-0002.parquet']);
    // La parte 1 de la otra corrida no se tocó: ni subió nada ahí ni cambió su registro.
    expect(almacen.objetos.has(clave1)).toBe(false);
    const ajena = await env.prisma.archivadoLote.findUniqueOrThrow({ where: { tabla_clave: { tabla: 'sync_outbox_audit', clave: clave1 } } });
    expect(ajena).toMatchObject({ sha256: 'de-la-otra-corrida', estado: 'VERIFICADO' });
    expect(await env.prisma.syncOutboxAudit.count({ where: { clientUuid: { startsWith: env.marca } } })).toBe(0);
  });

  it('si la subida del archivo falla, el lote reservado no se pierde: queda SUBIDO y la siguiente corrida lo marca FALLIDO sin borrar nada', async () => {
    await env.prisma.syncOutboxAudit.create({ data: { mutationId: `${env.marca}-m-2`, clientUuid: `${env.marca}-c-2`, entity: 'ServicioLavado', action: 'CREATE', payload: {}, syncedAt: new Date('2019-09-05T15:00:00Z') } });
    const roto: AlmacenArchivo = { put: async () => Promise.reject(new Error('S3 caído (simulado)')), get: async () => null };
    const opciones = { ahora: AHORA, simulacro: false, candado: `prueba-${env.marca}`, tablas: ['sync_outbox_audit'], filtroExtra: { sync_outbox_audit: { clientUuid: { startsWith: env.marca } } } };

    const r1 = await new ArchivadoService(env.prisma as never, roto).ejecutar(opciones);
    corridas.push(r1.corridaId);
    expect(r1.estado).toBe('ERROR');
    expect(await env.prisma.syncOutboxAudit.count({ where: { clientUuid: { startsWith: env.marca } } })).toBe(1); // nada se borró
    const huerfano = await env.prisma.archivadoLote.findFirstOrThrow({ where: { corridaId: r1.corridaId, tabla: 'sync_outbox_audit' } });
    expect(huerfano.estado).toBe('SUBIDO'); // reservado, pero sin archivo

    // La siguiente corrida (con el almacén sano) encuentra el lote sin archivo y lo marca FALLIDO (queda anotado como error), y como la
    // fila sigue en la base la archiva de nuevo, completa, en la parte siguiente.
    const sano = new AlmacenMemoria();
    const r2 = await new ArchivadoService(env.prisma as never, sano).ejecutar({ ...opciones, retomarDespuesDe: 0, retomarDeCorridas: [r1.corridaId] });
    corridas.push(r2.corridaId);
    expect((await env.prisma.archivadoLote.findUniqueOrThrow({ where: { id: huerfano.id } })).estado).toBe('FALLIDO');
    expect(r2.tablas.sync_outbox_audit.errores.join(' ')).toMatch(/no coincide/);
    expect(r2.tablas.sync_outbox_audit.archivadas).toBe(1);
    expect([...sano.objetos.keys()].filter((k) => k.endsWith('.parquet'))).toEqual(['archivo-historico/sync_outbox_audit/anio=2019/mes=09/part-0002.parquet']);
    expect(await env.prisma.syncOutboxAudit.count({ where: { clientUuid: { startsWith: env.marca } } })).toBe(0); // y ahora sí salió de la base, verificada
  });
});
