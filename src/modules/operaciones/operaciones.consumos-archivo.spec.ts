import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { OperacionesService } from './operaciones.service.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * El libro de consumo por OT (`listConsumosPorServicio`) con líneas archivadas debe agrupar EXACTAMENTE lo mismo que cuando todo
 * estaba en la base. Se archiva de verdad (servicios de lavado y especiales con sus líneas de consumo) y se lee con DuckDB.
 */
describe.skipIf(!(await duckdbDisponible))('consumo por orden de trabajo con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];
  type Caso = { nombre: string; dto: Record<string, unknown> };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();
  const ids: Record<string, string> = {};
  let nombreInsumo = '';

  const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v);
  const listar = (servicio: OperacionesService, c: Caso) => servicio.listConsumosPorServicio({ page: 1, pageSize: 100, ...c.dto } as never).then((r) => JSON.stringify(canonico(JSON.parse(JSON.stringify(r)))));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'consumos-archivo-'));
    const r1 = await env.region('c1');
    const ag1 = await env.agencia('c1', { regionId: r1.id });
    const ag2 = await env.agencia('c2', { regionId: r1.id });
    const bahia1 = await env.bahia('c1', ag1.id);
    const bahia2 = await env.bahia('c2', ag2.id);
    const cat = await env.catalogo('con');
    const catEsp = await env.catalogo('conesp', { categoria: 'ESPECIAL' });
    const op1 = await env.usuario('c-o1', 'LAVADOR', { name: `Lola${env.marca}`, lastname: 'Pardo' });
    const op2 = await env.usuario('c-o2', 'LAVADOR', { name: `Mario${env.marca}`, lastname: 'Quispe' });
    const i1 = await env.insumo('c1');
    const i2 = await env.insumo('c2');
    nombreInsumo = i1.nombre;
    Object.assign(ids, { ag1: ag1.id, ag2: ag2.id });

    const linea = async (servicioId: string, insumo: { id: string; nombre: string; codigoSKU: string }, cantidad: number, creado: string, agenciaId: string | null) =>
      env.prisma.consumoServicio.create({ data: { servicioId, insumoId: insumo.id, cantidadUsada: cantidad, agenciaId, insumoNombre: insumo.nombre, insumoSKU: insumo.codigoSKU, unidadSimbolo: 'ml', createdAt: new Date(creado) } as never });
    const lineaEsp = async (servicioEspecialId: string, insumo: { id: string; nombre: string; codigoSKU: string }, cantidad: number, creado: string, pulidorId: string) =>
      env.prisma.consumoServicioEspecial.create({ data: { servicioEspecialId, insumoId: insumo.id, cantidadUsada: cantidad, pulidorId, insumoNombre: insumo.nombre, insumoSKU: insumo.codigoSKU, unidadSimbolo: 'ml', createdAt: new Date(creado) } as never });

    let n = 0;
    const lavado = (estado: 'APROBADO' | 'RECHAZADO' | 'CANCELADO' | 'FINALIZADO', ingreso: string, bahiaId: string, operadorId: string, placa: string) => {
      n++;
      return env.servicioLavado({ bahiaId, operadorId, catalogoId: cat.id, estado, horaIngreso: new Date(ingreso), horaSalida: new Date(new Date(ingreso).getTime() + 3600000), ordenTrabajoOT: `${env.marca}-OT${n}`, placa });
    };
    const lA = await lavado('APROBADO', '2019-02-02T14:00:00Z', bahia1.id, op1.id, 'CAA-111');
    const lB = await lavado('RECHAZADO', '2019-04-04T14:00:00Z', bahia2.id, op2.id, 'CBB-222');
    const lC = await lavado('CANCELADO', '2019-06-06T14:00:00Z', bahia1.id, op2.id, 'CCC-333');
    const lD = await lavado('FINALIZADO', '2019-05-05T14:00:00Z', bahia1.id, op1.id, 'CDD-444'); // vivo: se queda en la base
    const lE = await lavado('APROBADO', '2020-08-08T14:00:00Z', bahia1.id, op1.id, 'CEE-555'); // reciente: se queda
    await linea(lA.id, i1, 1.5, '2019-02-02T15:00:00Z', ag1.id);
    await linea(lA.id, i2, 0.25, '2019-02-02T15:01:00Z', ag1.id);
    await linea(lA.id, i1, 2, '2019-03-15T09:00:00Z', ag1.id); // línea creada semanas después que el servicio
    await linea(lA.id, i2, 0.75, '2019-03-03T23:59:59.999', ag1.id); // último milisegundo del día (hora local), sin Z
    await linea(lB.id, i2, 3, '2019-04-04T15:30:00Z', ag2.id);
    await linea(lC.id, i1, 4.125, '2019-06-06T16:00:00Z', ag1.id);
    await linea(lD.id, i1, 5, '2019-05-05T15:00:00Z', ag1.id);
    await linea(lE.id, i2, 6, '2020-08-08T15:00:00Z', ag1.id);

    const especial = (estado: string, creado: string, agenciaId: string | null, operadorId: string, placa: string) => {
      n++;
      return env.servicioEspecial({ operadorId, agenciaId, regionId: r1.id, catalogoId: catEsp.id, estado, placa, tipoServicio: n % 2 ? 'Pulido' : 'Micro Pulido', datos: { createdAt: new Date(creado), ordenTrabajoOT: `${env.marca}-OE${n}` } });
    };
    const eA = await especial('Completado', '2019-03-03T14:00:00Z', ag1.id, op1.id, 'EAA-111');
    const eB = await especial('Cancelado', '2019-07-07T14:00:00Z', ag2.id, op2.id, 'EBB-222');
    const eC = await especial('Completado', '2019-08-08T14:00:00Z', null, op1.id, 'ECC-333'); // sin agencia
    const eD = await especial('Pendiente', '2019-05-05T14:00:00Z', ag1.id, op1.id, 'EDD-444'); // vivo
    const eE = await especial('Completado', '2020-09-09T14:00:00Z', ag1.id, op2.id, 'EEE-555'); // reciente
    await lineaEsp(eA.id, i1, 7.5, '2019-03-03T15:00:00Z', op1.id);
    await lineaEsp(eA.id, i2, 0.5, '2019-03-03T15:01:00Z', op1.id);
    await lineaEsp(eB.id, i1, 8, '2019-07-07T16:00:00Z', op2.id);
    await lineaEsp(eC.id, i2, 9, '2019-08-08T16:00:00Z', op1.id);
    await lineaEsp(eD.id, i1, 10, '2019-05-05T16:00:00Z', op1.id);
    await lineaEsp(eE.id, i2, 11, '2020-09-09T16:00:00Z', op2.id);

    const c = (nombre: string, dto: Record<string, unknown>): Caso => ({ nombre, dto });
    const m = { busqueda: env.marca };
    casos = [
      c('todo por la marca', m),
      c('solo generales', { ...m, tipo: 'GENERAL' }),
      c('solo especiales', { ...m, tipo: 'ESPECIAL' }),
      c('agencia 1', { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31' }),
      c('agencia 2', { agenciaId: ids.ag2, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31' }),
      c('agencia 1, solo generales', { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31', tipo: 'GENERAL' }),
      c('agencia 1, solo especiales', { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31', tipo: 'ESPECIAL' }),
      c('rango solo archivado', { ...m, fechaDesde: '2019-01-01', fechaHasta: '2019-12-31' }),
      c('rango que cruza el límite', { ...m, fechaDesde: '2019-06-01', fechaHasta: '2020-08-31' }),
      c('rango solo reciente', { ...m, fechaDesde: '2020-01-01' }),
      c('línea posterior al servicio', { ...m, fechaDesde: '2019-03-10', fechaHasta: '2019-03-20' }),
      c('hasta un día exacto', { ...m, fechaHasta: '2019-03-03' }),
      c('desde un día exacto', { ...m, fechaDesde: '2019-03-03', fechaHasta: '2019-03-03' }),
      c('búsqueda por OT', { busqueda: `${env.marca}-OT1` }),
      c('búsqueda por placa', { ...m, busqueda: 'CAA-111' }),
      c('búsqueda por placa especial', { busqueda: 'EAA-111' }),
      c('búsqueda por insumo', { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31', busqueda: nombreInsumo }),
      c('búsqueda por servicio del catálogo', { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31', busqueda: 'con' }),
      c('búsqueda por tipo de servicio especial', { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31', busqueda: 'micro' }),
      c('búsqueda por código especial', { busqueda: `${env.marca}-SE-` }),
      c('búsqueda que no encuentra', { ...m, busqueda: 'zzzzzz' }),
      ...[1, 2, 3].map((page) => c(`página ${page} de 4`, { agenciaId: ids.ag1, fechaDesde: '2019-01-01', fechaHasta: '2020-12-31', page, pageSize: 4 })),
    ];

    const base = new OperacionesService(env.prisma as never);
    for (const caso of casos) antes.set(caso.nombre, await listar(base, caso));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('todas las consultas dan exactamente lo mismo antes y después de archivar', async () => {
    const datos = (nombre: string) => JSON.parse(antes.get(nombre)!);
    expect(JSON.stringify(datos('todo por la marca')).length).toBeGreaterThan(500);
    expect(JSON.stringify(datos('solo especiales')).length).toBeGreaterThan(300);
    expect(JSON.stringify(datos('búsqueda que no encuentra')).length).toBeLessThan(JSON.stringify(datos('todo por la marca')).length);

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
    expect(r.tablas.servicio_lavado.archivadas).toBe(3);
    expect(r.tablas.servicio_especial.archivadas).toBe(3);
    expect(await env.prisma.consumoServicio.count({ where: { servicio: { ordenTrabajoOT: { contains: env.marca } } } })).toBe(2); // los de lD y lE

    volcarAlDisco(almacen, raiz);
    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    const conArchivo = new OperacionesService(env.prisma as never, undefined, undefined, historico);

    const diferentes: string[] = [];
    for (const caso of casos) {
      const despues = await listar(conArchivo, caso);
      if (despues !== antes.get(caso.nombre)) diferentes.push(`${caso.nombre}: ${antes.get(caso.nombre)!.slice(0, 200)} → ${despues.slice(0, 200)}`);
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería del libro.
    const soloBase = await listar(new OperacionesService(env.prisma as never), casos[0]);
    expect(soloBase).not.toBe(antes.get('todo por la marca'));
  });
});
