import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { EstadoArchivadoService } from './archivado.estado.js';

const usuario = (namerol: string) => ({ id: 'u', role: { namerol, ambito: 'GLOBAL', capacidades: [] } });

describe('estado del archivado (base real)', () => {
  let env: Entorno;
  let tabla: string;
  const ids: string[] = [];
  const corridas: string[] = [];
  const hace = (dias: number) => new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  const lote = async (sufijo: string, estado: string, o: { filas?: number; bytes?: number; desde?: string; hasta?: string; problema?: string | null; creado?: Date } = {}) => {
    const l = await env.prisma.archivadoLote.create({
      data: {
        tabla, anio: 2019, mes: 1, parte: ids.length + 1, clave: `${env.marca}/${sufijo}.parquet`, filas: o.filas ?? 1, bytes: o.bytes ?? 1, sha256: 'x', esquemaVersion: 1, estado,
        fechaMin: new Date(o.desde ?? '2019-01-05T00:00:00Z'), fechaMax: new Date(o.hasta ?? '2019-01-20T00:00:00Z'), problema: o.problema ?? null,
        ...(o.creado ? { createdAt: o.creado } : {}),
      },
    });
    ids.push(l.id);
    return l;
  };
  const servicio = (config: Record<string, string> = {}) => new EstadoArchivadoService(env.prisma as never, new ConfigService(config));

  beforeAll(async () => {
    env = await abrirEntorno();
    tabla = `tabla_prueba_${env.marca}`;
    await lote('a', 'BORRADO', { filas: 10, bytes: 1000, desde: '2019-01-05T00:00:00Z', hasta: '2019-01-20T00:00:00Z' });
    await lote('b', 'BORRADO', { filas: 5, bytes: 500, desde: '2018-11-01T00:00:00Z', hasta: '2019-02-10T00:00:00Z' });
    await lote('fallido', 'FALLIDO');
    await lote('viejo', 'VERIFICADO', { creado: hace(3) }); // verificado y sin borrar desde hace 3 días
    await lote('reciente', 'SUBIDO'); // recién subido: todavía no es un problema
    await lote('con-problema', 'BORRADO', { problema: 'La huella no coincide.' });
  });

  afterAll(async () => {
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: ids } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
  });

  it('solo lo ven ADMIN y SUPER_ADMIN', async () => {
    await expect(servicio().estado(usuario('SUPERVISOR'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio().estado(usuario('LAVADOR'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio().estado(usuario('ADMIN'))).resolves.toBeTruthy();
    await expect(servicio().estado(usuario('SUPER_ADMIN'))).resolves.toBeTruthy();
  });

  it('muestra si está encendido y si solo simula, según la configuración; apagado y simulando por omisión', async () => {
    expect((await servicio().estado(usuario('ADMIN'))).configuracion).toEqual({ activo: false, simulacro: true });
    expect((await servicio({ ARCHIVADO_ACTIVO: 'true' }).estado(usuario('ADMIN'))).configuracion).toEqual({ activo: true, simulacro: true });
    expect((await servicio({ ARCHIVADO_ACTIVO: 'true', ARCHIVADO_SIMULACRO: 'false' }).estado(usuario('ADMIN'))).configuracion).toEqual({ activo: true, simulacro: false });
  });

  it('cuenta por tabla solo lo ya archivado (BORRADO): archivos, filas, bytes y el rango de fechas que cubre', async () => {
    const e = await servicio().estado(usuario('ADMIN'));
    const mia = e.tablas.find((t) => t.tabla === tabla)!;
    expect(mia).toMatchObject({ lotes: 3, filas: 16, bytes: 1501 }); // a (10) + b (5) + con-problema (1); no cuentan fallido, verificado ni subido
    expect(mia.desde).toEqual(new Date('2018-11-01T00:00:00Z'));
    expect(mia.hasta).toEqual(new Date('2019-02-10T00:00:00Z'));
    // Los totales son la suma de todas las tablas.
    expect(e.totales.filas).toBe(e.tablas.reduce((a, t) => a + t.filas, 0));
    expect(e.totales.archivos).toBe(e.tablas.reduce((a, t) => a + t.lotes, 0));
  });

  it('cuenta los lotes por estado', async () => {
    const e = await servicio().estado(usuario('ADMIN'));
    // Hay lotes de otras pruebas en paralelo: aquí solo importa que existan los estados de los míos.
    expect(e.lotes['BORRADO']).toBeGreaterThanOrEqual(3);
    expect(e.lotes['FALLIDO']).toBeGreaterThanOrEqual(1);
    expect(e.lotes['VERIFICADO']).toBeGreaterThanOrEqual(1);
    expect(e.lotes['SUBIDO']).toBeGreaterThanOrEqual(1);
  });

  it('señala lo que requiere atención: fallidos, pendientes viejos y archivos con problemas', async () => {
    const e = await servicio().estado(usuario('ADMIN'));
    expect(e.atencion.join(' ')).toMatch(/fallido/);
    expect(e.atencion.join(' ')).toMatch(/pendiente\(s\) desde hace más de un día/); // el verificado de hace 3 días, no el recién subido
    expect(e.atencion.join(' ')).toMatch(/problemas hallados por la verificación/);
    const problema = e.problemas.find((p) => p.clave === `${env.marca}/con-problema.parquet`);
    expect(problema).toMatchObject({ tabla, problema: 'La huella no coincide.' });
  });

  it('un lote recién subido NO cuenta como pendiente viejo', async () => {
    // Para aislarlo de los lotes de otras pruebas se compara el conteo con y sin mi lote "viejo".
    const antes = (await servicio().estado(usuario('ADMIN'))).atencion.find((a) => a.includes('desde hace más de un día'));
    expect(antes).toBeTruthy();
    const viejo = ids[3];
    await env.prisma.archivadoLote.update({ where: { id: viejo }, data: { createdAt: new Date() } });
    const numero = (texto?: string) => Number(texto?.match(/^(\d+)/)?.[1] ?? 0);
    const despues = (await servicio().estado(usuario('ADMIN'))).atencion.find((a) => a.includes('desde hace más de un día'));
    expect(numero(despues)).toBe(numero(antes) - 1);
  });

  it('señala una corrida que quedó "en curso" desde hace horas (el proceso se interrumpió)', async () => {
    // Otra prueba que haga una corrida real en paralelo cierra las corridas colgadas (es justo lo que debe hacer): si le gana el turno
    // a esta consulta, se vuelve a crear la corrida y se pregunta de nuevo.
    await env.reintentar(async () => {
      const colgada = await env.prisma.archivadoCorrida.create({ data: { simulacro: false, estado: 'EN_CURSO', inicio: hace(0.2) } }); // hace ~5 horas
      corridas.push(colgada.id);
      const e = await servicio().estado(usuario('ADMIN'));
      expect(e.atencion.join(' ')).toMatch(/figuran en curso desde hace más de una hora/);
    }, 8);
  });

  it('refleja la última corrida real, el último simulacro y la última verificación, cada uno aparte', async () => {
    const real = await env.prisma.archivadoCorrida.create({ data: { simulacro: false, estado: 'OK', fin: new Date(), resumen: { [tabla]: { archivadas: 4, purgadas: 0, simuladas: 0, errores: [] } } as never } });
    const simulada = await env.prisma.archivadoCorrida.create({ data: { simulacro: true, estado: 'OK', fin: new Date(), resumen: { [tabla]: { archivadas: 0, purgadas: 0, simuladas: 9, errores: [] } } as never } });
    const verif = await env.prisma.archivadoCorrida.create({ data: { simulacro: false, estado: 'ERROR', fin: new Date(), error: 'x', resumen: { _verificacion: { revisados: 12, correctos: 11, problemas: [{ clave: 'k', tabla: 't', motivo: 'm' }] } } as never } });
    corridas.push(real.id, simulada.id, verif.id);

    const e = await servicio().estado(usuario('ADMIN'));
    // Si otra prueba creó una corrida más reciente en este mismo instante puede variar cuál es "la última": se comprueba la forma.
    expect(e.ultimaCorrida).toMatchObject({ estado: expect.any(String) });
    expect(e.ultimoSimulacro).toBeTruthy();
    expect(e.ultimaVerificacion?.verificacion).toBeDefined();
    expect(e.ultimaVerificacion?.tablas).toBeUndefined(); // una verificación no es una corrida de archivado: no mezcla sus datos
    expect(e.ultimaCorrida?.verificacion).toBeUndefined();
    expect(e.atencion.join(' ')).toMatch(/última verificación encontró problemas|última corrida terminó con errores|fallido/);
  });
});
