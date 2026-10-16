import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { RetosService } from './retos.service.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * El avance de un reto cerrado hace más de 12 meses debe dar EXACTAMENTE lo mismo cuando sus servicios ya están archivados. Se
 * archiva de verdad y se compara el ranking de muchos retos (todos los tipos, métricas, lugares y catálogos) antes y después.
 */
describe.skipIf(!(await duckdbDisponible))('avance de retos con servicios archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];
  type Caso = { nombre: string; reto: Record<string, unknown> };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();

  const ranking = (servicio: RetosService, c: Caso) => (servicio as any).calcularRankingReto(c.reto).then((r: unknown) => JSON.stringify(r));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'retos-archivo-'));
    const reg1 = await env.region('r1');
    const reg2 = await env.region('r2');
    const cli1 = await env.cliente('r1');
    const ag1 = await env.agencia('r1', { regionId: reg1.id, clienteId: cli1.id });
    const ag2 = await env.agencia('r2', { regionId: reg1.id });
    const ag3 = await env.agencia('r3', { regionId: reg2.id, clienteId: cli1.id });
    const b1 = await env.bahia('r1', ag1.id);
    const b2 = await env.bahia('r2', ag2.id);
    const b3 = await env.bahia('r3', ag3.id);
    const cat = await env.catalogo('ret');
    const cat2 = await env.catalogo('ret2');
    const catEsp = await env.catalogo('retesp', { categoria: 'ESPECIAL' });
    const catEsp2 = await env.catalogo('retesp2', { categoria: 'ESPECIAL' });
    const l1 = await env.usuario('r-l1', 'LAVADOR', { agenciaId: ag1.id, regionId: reg1.id });
    const l2 = await env.usuario('r-l2', 'LAVADOR', { agenciaId: ag2.id, regionId: reg1.id });
    const l3 = await env.usuario('r-l3', 'LAVADOR', { agenciaId: ag3.id, regionId: reg2.id });
    const p1 = await env.usuario('r-p1', 'PULIDOR', { agenciaId: ag1.id, regionId: reg1.id });
    const p2 = await env.usuario('r-p2', 'PULIDOR', { agenciaId: null, regionId: reg1.id }); // móvil
    const p3 = await env.usuario('r-p3', 'PULIDOR', { agenciaId: ag3.id, regionId: reg2.id });

    let n = 0;
    const lavado = (estado: 'APROBADO' | 'FINALIZADO' | 'RECHAZADO', ingreso: string, salida: string, bahiaId: string, operadorId: string, o: { precio?: number; catalogoId?: number; asignados?: string[]; deletedAt?: Date } = {}) => {
      n++;
      return env.servicioLavado({ bahiaId, operadorId, catalogoId: o.catalogoId ?? cat.id, estado, horaIngreso: new Date(ingreso), horaSalida: new Date(salida), precio: o.precio ?? 10 + n, ordenTrabajoOT: `${env.marca}-RL${n}`, placa: `R${n}-${env.marca.slice(1, 4).toUpperCase()}`, asignados: o.asignados, deletedAt: o.deletedAt });
    };
    // Marzo de 2019 (el reto se mide en hora de Ecuador: el día empieza a las 05:00 UTC).
    await lavado('APROBADO', '2019-03-02T14:00:00Z', '2019-03-02T15:00:00Z', b1.id, l1.id, { precio: 12.5, asignados: [l2.id] });
    await lavado('APROBADO', '2019-03-03T14:00:00Z', '2019-03-03T15:00:00Z', b2.id, l2.id, { precio: 20, catalogoId: cat2.id });
    await lavado('FINALIZADO', '2019-03-05T14:00:00Z', '2019-03-05T15:00:00Z', b1.id, l1.id, { precio: 7 }); // vivo: se queda en la base
    await lavado('APROBADO', '2019-03-06T14:00:00Z', '2019-03-06T15:00:00Z', b3.id, l3.id, { precio: 30 });
    await lavado('RECHAZADO', '2019-03-07T14:00:00Z', '2019-03-07T15:00:00Z', b1.id, l1.id, { precio: 99 }); // no cuenta
    await lavado('APROBADO', '2019-03-08T14:00:00Z', '2019-03-08T15:00:00Z', b1.id, l1.id, { precio: 99, deletedAt: new Date('2019-03-09T00:00:00Z') }); // anulado: no cuenta
    await lavado('APROBADO', '2019-02-28T20:00:00Z', '2019-03-01T05:00:00Z', b1.id, l1.id, { precio: 5 }); // cierra justo al empezar el reto (cuenta)
    await lavado('APROBADO', '2019-02-28T20:00:00Z', '2019-03-01T04:59:59Z', b1.id, l1.id, { precio: 6 }); // un segundo antes (no cuenta)
    await lavado('APROBADO', '2019-03-31T20:00:00Z', '2019-04-01T04:59:59Z', b2.id, l2.id, { precio: 8 }); // último segundo del reto (cuenta)
    await lavado('APROBADO', '2019-03-31T20:00:00Z', '2019-04-01T05:00:00Z', b2.id, l2.id, { precio: 9 }); // fuera
    await lavado('APROBADO', '2019-03-10T14:00:00Z', '2019-03-10T15:00:00Z', b2.id, l2.id, { precio: 11.75, asignados: [l1.id, l3.id] });
    await lavado('APROBADO', '2020-08-08T14:00:00Z', '2020-08-08T15:00:00Z', b1.id, l1.id, { precio: 40 }); // reciente: se queda y no entra en marzo de 2019

    const especial = (estado: string, creado: string, programada: string | null, fin: string, agenciaId: string | null, regionId: string | null, operadorId: string, o: { precio?: number; catalogoId?: number; asignados?: string[] } = {}) => {
      n++;
      return env.servicioEspecial({ operadorId, agenciaId, regionId, catalogoId: o.catalogoId ?? catEsp.id, estado, precio: o.precio ?? 50 + n, placa: `RE${n}-${env.marca.slice(1, 4).toUpperCase()}`, asignados: o.asignados, fechaFin: new Date(fin), datos: { createdAt: new Date(creado), fechaProgramada: programada ? new Date(programada) : null } });
    };
    await especial('Completado', '2019-03-01T14:00:00Z', null, '2019-03-04T20:00:00Z', ag1.id, reg1.id, p1.id, { precio: 80 });
    await especial('Completado', '2019-01-15T14:00:00Z', '2019-02-10T14:00:00Z', '2019-03-12T20:00:00Z', ag3.id, reg2.id, p3.id, { precio: 60.5, asignados: [p1.id] }); // programado semanas antes de cerrarse
    await especial('Completado', '2019-03-15T14:00:00Z', null, '2019-03-16T20:00:00Z', null, reg1.id, p2.id, { precio: 45 }); // móvil: sin agencia
    await especial('Completado', '2019-03-18T14:00:00Z', null, '2019-03-19T20:00:00Z', ag1.id, reg1.id, p1.id, { precio: 33, catalogoId: undefined });
    await especial('Completado', '2019-03-14T14:00:00Z', null, '2019-03-14T20:00:00Z', ag1.id, reg1.id, p1.id, { precio: 21, catalogoId: catEsp2.id }); // otro catálogo
    await especial('Cancelado', '2019-03-20T14:00:00Z', null, '2019-03-21T20:00:00Z', ag1.id, reg1.id, p1.id, { precio: 99 }); // no cuenta
    await especial('Pendiente', '2019-03-22T14:00:00Z', null, '2019-03-23T20:00:00Z', ag1.id, reg1.id, p1.id, { precio: 99 }); // vivo y no completado
    await especial('Completado', '2019-03-24T14:00:00Z', null, '2019-03-25T20:00:00Z', ag2.id, reg1.id, p2.id, { precio: 28 });
    await especial('Completado', '2020-09-09T14:00:00Z', null, '2020-09-09T20:00:00Z', ag1.id, reg1.id, p1.id, { precio: 77 }); // reciente

    const base = { fechaInicio: new Date('2019-03-01T00:00:00Z'), fechaFin: new Date('2019-03-31T00:00:00Z'), regiones: [] as string[], marcas: [] as string[], sucursalesIds: [ag1.id, ag2.id, ag3.id], tipoServicios: 'TODOS', catalogoServicioIds: [] as number[], metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 3, meta: null };
    const c = (nombre: string, extra: Record<string, unknown>): Caso => ({ nombre, reto: { ...base, ...extra } });
    const lav = { lavadoresIds: [l1.id, l2.id, l3.id] };
    const pul = { pulidoresIds: [p1.id, p2.id, p3.id] };
    casos = [
      ...(['SERVICIOS', 'AUTOS', 'MONTO'] as const).flatMap((metrica) => [
        c(`agencias, ${metrica}`, { tipoReto: 'AGENCIA', metrica }),
        c(`bahías, ${metrica}`, { tipoReto: 'BAHIA', metrica }),
        c(`lavadores, ${metrica}`, { tipoReto: 'LAVADOR', metrica, tipoServicios: 'GENERALES', ...lav }),
        c(`pulidores, ${metrica}`, { tipoReto: 'PULIDOR', metrica, tipoServicios: 'ESPECIALES', ...pul, sucursalesIds: [] }),
      ]),
      c('agencias, solo generales', { tipoReto: 'AGENCIA', tipoServicios: 'GENERALES', metrica: 'MONTO' }),
      c('agencias, solo especiales', { tipoReto: 'AGENCIA', tipoServicios: 'ESPECIALES', metrica: 'MONTO' }),
      c('agencias, catálogo específico', { tipoReto: 'AGENCIA', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [cat.id, catEsp.id], metrica: 'MONTO' }),
      c('lavadores, catálogo específico', { tipoReto: 'LAVADOR', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [cat2.id], metrica: 'MONTO', ...lav }),
      c('pulidores, un solo catálogo', { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [catEsp.id], metrica: 'MONTO', ...pul, sucursalesIds: [] }),
      c('lavadores de una sucursal', { tipoReto: 'LAVADOR', tipoServicios: 'GENERALES', sucursalesIds: [ag1.id], metrica: 'MONTO', ...lav }),
      c('lavadores de otra región', { tipoReto: 'LAVADOR', tipoServicios: 'GENERALES', regiones: [reg2.nombre], sucursalesIds: [], metrica: 'MONTO', ...lav }),
      c('lavadores de un cliente', { tipoReto: 'LAVADOR', tipoServicios: 'GENERALES', marcas: [cli1.nombre], sucursalesIds: [], metrica: 'MONTO', ...lav }),
      c('agencias de una región', { tipoReto: 'AGENCIA', regiones: [reg1.nombre], metrica: 'MONTO' }),
      c('agencias de otra región', { tipoReto: 'AGENCIA', regiones: [reg2.nombre], metrica: 'MONTO' }),
      c('agencias de un cliente', { tipoReto: 'AGENCIA', marcas: [cli1.nombre], metrica: 'MONTO' }),
      c('región y cliente a la vez', { tipoReto: 'AGENCIA', regiones: [reg1.nombre], marcas: [cli1.nombre], metrica: 'MONTO' }),
      c('una sola sucursal', { tipoReto: 'AGENCIA', sucursalesIds: [ag1.id], metrica: 'MONTO' }),
      c('pulidores de una región (incluye móviles)', { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', regiones: [reg1.nombre], ...pul, sucursalesIds: [], metrica: 'MONTO' }),
      c('pulidores de otra región', { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', regiones: [reg2.nombre], ...pul, sucursalesIds: [], metrica: 'MONTO' }),
      c('pulidores de un cliente', { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', marcas: [cli1.nombre], ...pul, sucursalesIds: [], metrica: 'MONTO' }),
      c('pulidores de una sucursal', { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', ...pul, sucursalesIds: [ag3.id], metrica: 'MONTO' }),
      c('con meta', { tipoReto: 'AGENCIA', modoGanador: 'META', meta: 2, metrica: 'SERVICIOS' }),
      c('mes de febrero (cierra el 1 de marzo)', { tipoReto: 'AGENCIA', fechaInicio: new Date('2019-02-01T00:00:00Z'), fechaFin: new Date('2019-02-28T00:00:00Z'), metrica: 'MONTO' }),
      c('un solo día', { tipoReto: 'AGENCIA', fechaInicio: new Date('2019-03-02T00:00:00Z'), fechaFin: new Date('2019-03-02T00:00:00Z'), metrica: 'MONTO' }),
      c('de marzo de 2019 a septiembre de 2020', { tipoReto: 'AGENCIA', fechaFin: new Date('2020-09-30T00:00:00Z'), metrica: 'MONTO' }),
      c('solo lo reciente', { tipoReto: 'AGENCIA', fechaInicio: new Date('2020-01-01T00:00:00Z'), fechaFin: new Date('2020-12-31T00:00:00Z'), metrica: 'MONTO' }),
    ];

    const sinArchivo = new RetosService(env.prisma as never);
    for (const caso of casos) antes.set(caso.nombre, await ranking(sinArchivo, caso));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('el ranking de cada reto es exactamente el mismo antes y después de archivar', async () => {
    const total = (nombre: string) => (JSON.parse(antes.get(nombre)!) as Array<{ valor?: number; servicios?: number }>).reduce((s, f) => s + Number(f.valor ?? f.servicios ?? 0), 0);
    expect(total('agencias, MONTO')).toBeGreaterThan(100);
    expect(total('pulidores, MONTO')).toBeGreaterThan(100);
    expect(total('lavadores, SERVICIOS')).toBeGreaterThan(3);

    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => ['servicio_lavado', 'servicio_especial'].includes(t.tabla)),
      tablas: ['servicio_lavado', 'servicio_especial'],
      filtroExtra: { servicio_lavado: { ordenTrabajoOT: { contains: env.marca } }, servicio_especial: { codigoSE: { contains: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.servicio_lavado.archivadas).toBe(10);
    expect(r.tablas.servicio_especial.archivadas).toBe(7); // todos los completados y cancelados, también el programado semanas antes de cerrarse

    volcarAlDisco(almacen, raiz);
    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    const conArchivo = new RetosService(env.prisma as never, undefined, historico);

    const diferentes: string[] = [];
    for (const caso of casos) {
      const despues = await ranking(conArchivo, caso);
      if (despues !== antes.get(caso.nombre)) diferentes.push(`${caso.nombre}: ${antes.get(caso.nombre)!.slice(0, 250)} → ${despues.slice(0, 250)}`);
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería del avance.
    const soloBase = await ranking(new RetosService(env.prisma as never), casos.find((x) => x.nombre === 'agencias, MONTO')!);
    expect(soloBase).not.toBe(antes.get('agencias, MONTO'));
  });
});
