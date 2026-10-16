import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * El listado de servicios especiales (`findAll`) con datos archivados debe devolver EXACTAMENTE lo mismo que cuando todo estaba en
 * la base: mismas filas, mismo orden, mismas páginas, mismos totales, mismo resumen por estado y mismo JSON. Se archiva de verdad
 * (archivador + almacén en memoria) y se lee con DuckDB desde disco.
 */
describe.skipIf(!(await duckdbDisponible))('listado de servicios especiales con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];

  type Actor = any;
  type Caso = { nombre: string; query: Record<string, unknown>; actor: () => Actor };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();
  let admin: Actor;
  const ids: Record<string, string> = {};

  // El orden de las claves de un objeto no importa (p. ej. el resumen por estado sale en el orden que la base agrupa): se compara
  // con las claves ordenadas. El orden de los ARREGLOS sí importa y se respeta.
  const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v);
  const listar = (servicio: ServiciosEspecialesService, c: Caso) => servicio.findAll(c.query as never, c.actor()).then((r) => JSON.stringify(canonico(JSON.parse(JSON.stringify(r)))));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'especiales-archivo-'));
    const superAdmin = await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } });
    admin = await env.actor(superAdmin.id);

    const r1 = await env.region('e1');
    const r2 = await env.region('e2');
    const ag1 = await env.agencia('e1', { regionId: r1.id });
    const ag2 = await env.agencia('e2', { regionId: r1.id });
    const ag3 = await env.agencia('e3', { regionId: r2.id });
    const cat = await env.catalogo('esp', { categoria: 'ESPECIAL' });
    const p1 = await env.usuario('e-p1', 'LAVADOR', { name: `Pablo${env.marca}`, lastname: 'Mena' });
    const p2 = await env.usuario('e-p2', 'LAVADOR', { name: `Quique${env.marca}`, lastname: 'Naranjo' });
    const p3 = await env.usuario('e-p3', 'LAVADOR', { name: `Rosa${env.marca}`, lastname: 'Ortiz' });
    Object.assign(ids, { r1: r1.id, r2: r2.id, ag1: ag1.id, ag2: ag2.id, ag3: ag3.id, p1: p1.id, p2: p2.id, p3: p3.id });

    let n = 0;
    const especial = (estado: string, creado: string, programada: string | null, o: { agencia?: { id: string } | null; region?: { id: string } | null; op: { id: string }; asignados?: string[]; tipo?: string; placa?: string; marca?: string; modelo?: string; cliente?: string; efectivo?: number | null; pausa?: number; precio?: number; deletedAt?: Date | null }) => {
      n++;
      return env.servicioEspecial({
        operadorId: o.op.id, agenciaId: o.agencia === undefined ? null : (o.agencia?.id ?? null), regionId: o.region?.id ?? null, catalogoId: cat.id,
        estado, precio: o.precio ?? 50 + n, placa: o.placa ?? `PE${n}-${env.marca.slice(1, 4).toUpperCase()}`, tipoServicio: o.tipo ?? 'Pulido', asignados: o.asignados, deletedAt: o.deletedAt ?? null,
        datos: { createdAt: new Date(creado), fechaProgramada: programada ? new Date(programada) : null, clienteNombre: o.cliente ?? 'Cliente base', marca: o.marca ?? 'Marca base', modelo: o.modelo ?? 'Modelo base', observaciones: `Obs ${n} ñ`, tiempoEfectivoSeg: o.efectivo === undefined ? 5400 : o.efectivo, tiempoPausaTotalSeg: o.pausa ?? 0, creadoPorNombre: 'Asesor Uno', fechaFin: new Date(new Date(creado).getTime() + 3600000), horaIngreso: '09:30' },
      });
    };

    // Archivables (completados o cancelados y con la fecha del evento de hace más de 12 meses).
    await especial('Completado', '2019-01-05T14:00:00Z', '2019-03-10T14:00:00Z', { agencia: ag1, region: r1, op: p1, asignados: [p1.id, p3.id], precio: 80, placa: 'AAA-111', marca: 'Toyota', modelo: 'Hilux', cliente: 'Cliente Uno', efectivo: 5400, pausa: 300 }); // creado en enero, programado para marzo
    await especial('Cancelado', '2019-03-12T14:00:00Z', null, { agencia: ag2, region: r1, op: p2, tipo: 'Micro Pulido', precio: 45.5, placa: 'BBB-222', efectivo: null });
    await especial('Completado', '2019-05-20T14:00:00Z', '2019-05-22T14:00:00Z', { agencia: ag3, region: r2, op: p1, tipo: 'Lavado de motor', placa: 'CCC-333', marca: 'Kia' });
    await especial('Completado', '2019-06-10T14:00:00Z', null, { agencia: null, region: r1, op: p3, placa: 'DDD-444', cliente: 'Cliente Uno' }); // móvil zonal: sin agencia
    await especial('Completado', '2019-02-02T14:00:00Z', '2019-04-04T14:00:00Z', { agencia: ag1, region: r1, op: p2, placa: 'EEE-555', efectivo: 7200 });
    await especial('Cancelado', '2019-02-02T14:00:00Z', null, { agencia: ag1, region: r1, op: p1, placa: 'FFF-666', efectivo: null }); // misma createdAt que el anterior: empate
    // Vivos aunque sean viejos.
    await especial('Pendiente', '2019-04-04T14:00:00Z', null, { agencia: ag1, region: r1, op: p1, placa: 'GGG-777', efectivo: null });
    await especial('En Proceso', '2019-05-05T14:00:00Z', null, { agencia: ag2, region: r1, op: p2, placa: 'HHH-888', efectivo: null });
    // Anulado: no sale en el listado, pero se archiva igual.
    await especial('Completado', '2019-07-07T14:00:00Z', null, { agencia: ag1, region: r1, op: p1, placa: 'III-999', deletedAt: new Date('2019-07-08T00:00:00Z') });
    // Recientes o con fecha del evento reciente: se quedan en la base.
    await especial('Completado', '2019-11-11T14:00:00Z', null, { agencia: ag1, region: r1, op: p1, placa: 'JJJ-101', marca: 'Toyota' });
    await especial('Cancelado', '2020-03-03T14:00:00Z', null, { agencia: ag2, region: r1, op: p2, placa: 'KKK-202' });
    await especial('Pendiente', '2020-09-09T14:00:00Z', null, { agencia: ag3, region: r2, op: p3, placa: 'LLL-303', efectivo: null });
    await especial('Completado', '2019-01-05T14:00:00Z', '2020-09-20T14:00:00Z', { agencia: ag1, region: r1, op: p1, placa: 'MMM-404' }); // creado hace mucho, programado hace poco
    await especial('Completado', '2019-09-09T14:00:00Z', null, { agencia: ag1, region: r1, op: p2, asignados: [p3.id], placa: 'NNN-505' });
    // Sin región propia: la región se la da su agencia (el alcance de región debe verlo por esa vía).
    await especial('Completado', '2019-04-20T14:00:00Z', null, { agencia: ag2, region: null, op: p2, placa: 'OOO-606' });

    // Actores de cada alcance, armados a mano (así no se crean usuarios de roles que reciben avisos).
    const sintetico = (namerol: string, ambito: string, extra: Record<string, unknown> = {}) => ({ id: `sintetico-${namerol}-${ambito}`, name: 'Sintético', lastname: namerol, role: { namerol, ambito, capacidades: [] }, ...extra });
    const regionR1 = sintetico('SUPERVISOR', 'REGION', { regionId: r1.id });
    const agenciaAg1 = sintetico('SUPERVISOR', 'AGENCIA', { agenciaId: ag1.id });
    const sinAlcance = sintetico('SUPERVISOR', 'REGION');
    const pulidorP1 = { ...sintetico('PULIDOR', 'AGENCIA', { agenciaId: ag1.id }), id: p1.id };
    const propioP3 = { ...sintetico('ASESOR', 'PROPIO'), id: p3.id };

    const buscar = (extra?: string) => ({ search: extra ? `${env.marca} ${extra}` : env.marca });
    const c = (nombre: string, query: Record<string, unknown>, actor: () => Actor = () => admin): Caso => ({ nombre, query: { page: 1, pageSize: 100, ...query }, actor });
    casos = [
      ...[1, 2, 3, 4].map((page) => c(`paginación página ${page} de 3`, { ...buscar(), page, pageSize: 3 })),
      c('sin tamaño de página', { ...buscar(), pageSize: undefined, page: undefined }),
      ...['fecha', 'ot', 'placa', 'servicio', 'agencia', 'region', 'operador', 'estado', 'tiempoPausa', 'tiempoEfectivo'].flatMap((campo) =>
        (['asc', 'desc'] as const).map((dir) => c(`orden ${campo} ${dir}`, { ...buscar(), sortField: campo, sortOrder: dir, incluirResumen: true })),
      ),
      c('orden por agencia, página 2 de 3', { ...buscar(), sortField: 'agencia', sortOrder: 'asc', page: 2, pageSize: 3 }),
      c('orden por tiempo efectivo, página 2 de 4', { ...buscar(), sortField: 'tiempoEfectivo', sortOrder: 'desc', page: 2, pageSize: 4 }),
      ...['En Proceso', 'Completado', 'Realizado', 'cancelado', 'COMPLETADO', 'Pendiente', 'Todos'].map((estado) => c(`estado ${estado} con resumen`, { ...buscar(), estado, incluirResumen: true })),
      c('con resumen', { ...buscar(), incluirResumen: true }),
      c('tipo de servicio', { ...buscar(), tipoServicio: 'pulido', incluirResumen: true }),
      c('tipo de servicio, otro', { ...buscar(), tipoServicio: 'motor' }),
      c('región 2', { ...buscar(), regionId: ids.r2, incluirResumen: true }),
      c('agencia 1', { ...buscar(), agenciaId: ids.ag1 }),
      c('sucursalId', { ...buscar(), sucursalId: ids.ag2 }),
      c('operador principal', { ...buscar(), operadorId: ids.p2 }),
      c('búsqueda por código', { search: `${env.marca}-SE-3` }),
      c('búsqueda por placa', { ...buscar('aaa'), incluirResumen: true }),
      c('búsqueda por modelo', { ...buscar('hilux') }),
      c('búsqueda por marca', { ...buscar('toyota') }),
      c('búsqueda por cliente', { ...buscar('uno') }),
      c('búsqueda por tipo', { ...buscar('micro') }),
      c('búsqueda por nombre del operador', { ...buscar('pablo') }),
      c('búsqueda de varias palabras', { ...buscar('toyota hilux') }),
      c('búsqueda que no encuentra nada', { ...buscar('zzzzzz'), incluirResumen: true }),
      c('rango que cruza el límite', { ...buscar(), fechaDesde: '2019-03-01', fechaHasta: '2020-03-03', incluirResumen: true }),
      c('rango solo archivado', { ...buscar(), fechaDesde: '2019-01-01', fechaHasta: '2019-09-30', incluirResumen: true }),
      c('rango solo reciente', { ...buscar(), fechaDesde: '2019-11-01', incluirResumen: true }),
      c('creado en enero, programado para marzo', { ...buscar(), fechaDesde: '2019-01-01', fechaHasta: '2019-01-31', incluirResumen: true }),
      c('hasta un día exacto', { ...buscar(), fechaHasta: '2019-03-12T23:59:59.999Z' }),
      c('rango inválido se ignora', { ...buscar(), fechaDesde: 'no-es-fecha' }),
      c('alcance de región (propia o por agencia)', { ...buscar(), incluirResumen: true }, () => regionR1),
      c('alcance de región con agencia', { ...buscar(), agenciaId: ids.ag2 }, () => regionR1),
      c('alcance de agencia', { ...buscar(), incluirResumen: true }, () => agenciaAg1),
      c('alcance de agencia pidiendo otra agencia', { ...buscar(), agenciaId: ids.ag3 }, () => agenciaAg1),
      c('pulidor (solo los suyos o asignados)', { ...buscar(), incluirResumen: true }, () => pulidorP1),
      c('pulidor pidiendo a otro operador', { ...buscar(), operadorId: ids.p2 }, () => pulidorP1),
      c('alcance propio (hizo o fue asignado)', { ...buscar(), incluirResumen: true }, () => propioP3),
      c('alcance propio, orden por operador', { ...buscar(), sortField: 'operador', sortOrder: 'asc' }, () => propioP3),
      c('sin alcance no ve nada', { ...buscar() }, () => sinAlcance),
    ];

    // Resultados ANTES de archivar (todo en la base).
    const base = new ServiciosEspecialesService(env.prisma as never);
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
    // Las bases de comparación tienen datos: si no, la prueba no probaría nada.
    const datos = (nombre: string) => JSON.parse(antes.get(nombre)!);
    expect(datos('con resumen').data.length).toBe(14); // 15 menos el anulado
    expect(datos('con resumen').resumen.total).toBe(14);
    expect(datos('creado en enero, programado para marzo').data.length).toBeGreaterThan(1);
    expect(datos('pulidor (solo los suyos o asignados)').data.length).toBeGreaterThan(3);
    expect(datos('alcance propio (hizo o fue asignado)').data.length).toBeGreaterThan(2);
    expect(datos('sin alcance no ve nada').data.length).toBe(0);

    // Archiva de verdad, tocando solo los servicios de esta prueba.
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => t.tabla === 'servicio_especial'),
      tablas: ['servicio_especial'],
      filtroExtra: { servicio_especial: { codigoSE: { contains: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.servicio_especial.archivadas).toBe(9); // 1 a 6, el anulado, el 14 y el 15
    // Los vivos (Pendiente, En Proceso) y los de fecha del evento reciente se quedan.
    expect(await env.prisma.servicioEspecial.count({ where: { codigoSE: { contains: env.marca } } })).toBe(6);

    volcarAlDisco(almacen, raiz);
    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    const conArchivo = new ServiciosEspecialesService(env.prisma as never, undefined, undefined, historico);

    // Cuando una consulta difiere, se explica qué: el total, el resumen o qué filas (y en qué orden) salieron.
    const explicar = (a: any, b: any): string => {
      const partes: string[] = [];
      if (a.total !== b.total) partes.push(`total ${a.total} → ${b.total}`);
      if (JSON.stringify(canonico(a.resumen)) !== JSON.stringify(canonico(b.resumen))) partes.push(`resumen ${JSON.stringify(a.resumen)} → ${JSON.stringify(b.resumen)}`);
      const ia = a.data.map((x: any) => x.placa).join(',');
      const ib = b.data.map((x: any) => x.placa).join(',');
      if (ia !== ib) partes.push(`filas ${ia} → ${ib}`);
      return partes.join('; ') || 'mismo contenido pero distinto JSON (campos)';
    };
    const diferentes: string[] = [];
    for (const caso of casos) {
      const despues = await listar(conArchivo, caso);
      if (despues !== antes.get(caso.nombre)) diferentes.push(`${caso.nombre}: ${explicar(JSON.parse(antes.get(caso.nombre)!), JSON.parse(despues))}`);
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería del listado: eso es lo que esta capa evita.
    const soloBase = JSON.parse(await listar(new ServiciosEspecialesService(env.prisma as never), casos.find((x) => x.nombre === 'con resumen')!));
    expect(soloBase.data.length).toBe(6);
  });
});
