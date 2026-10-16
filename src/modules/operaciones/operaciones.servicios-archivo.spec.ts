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
 * El listado de servicios de lavado (`findAll`) con datos archivados debe devolver EXACTAMENTE lo mismo que cuando todo estaba en
 * la base: mismas filas, mismo orden, mismas páginas, mismos totales, mismo resumen por estado y mismo JSON. Se archiva de verdad
 * (archivador + almacén en memoria) y se lee con DuckDB desde disco.
 */
describe.skipIf(!(await duckdbDisponible))('listado de servicios con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];

  type Actor = any;
  type Caso = { nombre: string; params: Record<string, unknown>; actor: () => Actor };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();

  let admin: Actor;
  const ids: Record<string, string> = {};

  // El orden de las claves de un objeto no importa (p. ej. el resumen por estado sale en el orden que la base agrupa): se compara
  // con las claves ordenadas. El orden de los ARREGLOS sí importa y se respeta.
  const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v);
  const listar = (servicio: OperacionesService, c: Caso) => servicio.findAll(c.params as never, c.actor()).then((r) => JSON.stringify(canonico(JSON.parse(JSON.stringify(r)))));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'servicios-archivo-'));
    const superAdmin = await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } });
    admin = await env.actor(superAdmin.id);

    const r1 = await env.region('v1');
    const r2 = await env.region('v2');
    const cliente = await env.cliente('v');
    const ag1 = await env.agencia('v1', { regionId: r1.id, clienteId: cliente.id });
    const ag2 = await env.agencia('v2', { regionId: r1.id });
    const ag3 = await env.agencia('v3', { regionId: r2.id, clienteId: cliente.id });
    const b1 = await env.bahia('v1', ag1.id);
    const b2 = await env.bahia('v2', ag1.id);
    const b3 = await env.bahia('v3', ag2.id);
    const b4 = await env.bahia('v4', ag3.id);
    const c1 = await env.catalogo('lav');
    const c2 = await env.catalogo('enc');
    const op1 = await env.usuario('v-op1', 'LAVADOR', { name: `Carlos${env.marca}`, lastname: 'Vega' });
    const op2 = await env.usuario('v-op2', 'LAVADOR', { name: `Diana${env.marca}`, lastname: 'Soto' });
    const op3 = await env.usuario('v-op3', 'LAVADOR', { name: `Elena${env.marca}`, lastname: 'Rojas' });
    Object.assign(ids, { r1: r1.id, r2: r2.id, ag1: ag1.id, ag2: ag2.id, ag3: ag3.id, b1: b1.id, b2: b2.id, b3: b3.id, b4: b4.id, c1: c1.id, c2: c2.id, op1: op1.id, op2: op2.id, op3: op3.id, cliente: cliente.id });

    let n = 0;
    const servicio = (estado: any, ingreso: string, bahia: { id: string }, cat: { id: number }, op: { id: string }, extra: { asignados?: string[]; deletedAt?: Date | null; sinSalida?: boolean; placa?: string; marca?: string; modelo?: string; cliente?: string; precio?: number } = {}) => {
      n++;
      const horaIngreso = new Date(ingreso);
      return env.servicioLavado({
        bahiaId: bahia.id, operadorId: op.id, catalogoId: cat.id, estado, horaIngreso,
        horaSalida: extra.sinSalida ? null : new Date(horaIngreso.getTime() + 40 * 60000),
        precio: extra.precio ?? 10 + n, placa: extra.placa ?? `PL${n}-${env.marca.slice(1, 4).toUpperCase()}`, modelo: extra.modelo ?? 'Modelo base',
        ordenTrabajoOT: `OT-${env.marca}-${n}`, asignados: extra.asignados, deletedAt: extra.deletedAt ?? null,
        datos: { marca: extra.marca ?? 'Marca base', cliente: extra.cliente ?? 'Cliente base', color: 'Rojo', observaciones: `Obs ${n} ñ`, ...(estado === 'APROBADO' ? { aprobadoPor: 'Ana Pérez' } : {}) },
      });
    };

    // Archivables (decididos y de hace más de 12 meses): 1 a 6, 9 (anulado) y 14.
    await servicio('APROBADO', '2019-01-10T14:00:00Z', b1, c1, op1, { asignados: [op3.id], placa: 'AAA-111', marca: 'Toyota', modelo: 'Yaris Sedan', cliente: 'Cliente Uno', precio: 12.5 });
    await servicio('APROBADO', '2019-02-15T14:00:00Z', b2, c2, op2, { placa: 'BBB-222', marca: 'Kia', modelo: 'Rio', cliente: 'Cliente Dos' });
    await servicio('RECHAZADO', '2019-03-03T14:00:00Z', b3, c1, op1, { placa: 'CCC-333', marca: 'Chevrolet', modelo: 'Spark' });
    await servicio('CANCELADO', '2019-03-03T14:00:00Z', b3, c2, op2, { placa: 'DDD-444' }); // misma hora que el anterior: empate
    await servicio('APROBADO', '2019-05-20T14:00:00Z', b4, c1, op1, { placa: 'EEE-555', cliente: 'Cliente Uno' });
    await servicio('APROBADO', '2019-08-30T14:00:00Z', b1, c2, op3, { placa: 'FFF-666', marca: 'Toyota', modelo: 'Corolla' });
    // Vivos aunque sean viejos: se quedan en la base.
    await servicio('FINALIZADO', '2019-04-04T14:00:00Z', b1, c1, op1, { placa: 'GGG-777' });
    await servicio('EN_ESPERA', '2019-06-06T14:00:00Z', b2, c1, op2, { sinSalida: true, placa: 'HHH-888' });
    // Anulado: no sale en el listado, pero se archiva igual.
    await servicio('APROBADO', '2019-07-07T14:00:00Z', b1, c1, op1, { deletedAt: new Date('2019-07-08T00:00:00Z'), placa: 'III-999' });
    // Recientes: se quedan en la base.
    await servicio('APROBADO', '2019-11-11T14:00:00Z', b1, c1, op2, { placa: 'JJJ-101', marca: 'Toyota' });
    await servicio('RECHAZADO', '2020-03-03T14:00:00Z', b3, c2, op1, { placa: 'KKK-202' });
    await servicio('FINALIZADO', '2020-09-09T14:00:00Z', b4, c2, op3, { placa: 'LLL-303' });
    await servicio('CANCELADO', '2020-10-02T14:00:00Z', b2, c1, op1, { placa: 'MMM-404' });
    await servicio('APROBADO', '2019-09-09T14:00:00Z', b1, c1, op2, { asignados: [op3.id], placa: 'NNN-505' });

    // Actores de cada alcance. Los de región y agencia se arman a mano: así no se crean usuarios de roles que reciben avisos.
    const sintetico = (ambito: string, extra: Record<string, unknown> = {}) => ({ id: `sintetico-${ambito}`, name: 'Sintético', lastname: ambito, role: { namerol: 'SUPERVISOR', ambito, capacidades: [] }, ...extra });
    const regionR1 = sintetico('REGION', { regionId: r1.id });
    const agenciaAg1 = sintetico('AGENCIA', { agenciaId: ag1.id });
    const sinAlcance = sintetico('REGION');
    // Ningún rol base es de ámbito PROPIO (se configura por rol): se arma con el id de un operador real.
    const propioOp1 = { ...sintetico('PROPIO'), id: op1.id };

    // Todas las consultas se acotan a los servicios de esta prueba (la base puede tener otros de pruebas en paralelo).
    const buscar = (extra?: string) => ({ search: extra ? `${env.marca} ${extra}` : env.marca });
    const c = (nombre: string, params: Record<string, unknown>, actor: () => Actor = () => admin): Caso => ({ nombre, params: { page: 1, pageSize: 100, ...params }, actor });
    casos = [
      ...[1, 2, 3, 4].map((page) => c(`paginación página ${page} de 3`, { ...buscar(), page, pageSize: 3 })),
      c('sin tamaño de página', { ...buscar(), pageSize: undefined, page: undefined }),
      ...['fecha', 'createdAt', 'ot', 'placa', 'modelo', 'cliente', 'estado', 'servicio', 'operador', 'agencia', 'bahia'].flatMap((campo) =>
        (['asc', 'desc'] as const).map((dir) => c(`orden ${campo} ${dir}`, { ...buscar(), sortField: campo, sortOrder: dir, incluirResumen: true })),
      ),
      c('orden por agencia, página 2 de 3', { ...buscar(), sortField: 'agencia', sortOrder: 'asc', page: 2, pageSize: 3 }),
      c('orden por servicio con estado y página', { ...buscar(), sortField: 'servicio', sortOrder: 'desc', estado: 'APROBADO', page: 2, pageSize: 2 }),
      ...['APROBADO', 'RECHAZADO', 'CANCELADO', 'FINALIZADO', 'REALIZADO', 'POR_APROBAR', 'EN_PROCESO', 'Todos'].map((estado) => c(`estado ${estado} con resumen`, { ...buscar(), estado, incluirResumen: true })),
      c('con resumen', { ...buscar(), incluirResumen: true }),
      c('agencia 1', { ...buscar(), agenciaId: ids.ag1, incluirResumen: true }),
      c('sucursalId', { ...buscar(), sucursalId: ids.ag2 }),
      c('región 2', { ...buscar(), regionId: ids.r2, incluirResumen: true }),
      c('varias bahías', { ...buscar(), bahiaId: `${ids.b1},${ids.b3}` }),
      c('servicio del catálogo', { ...buscar(), servicioId: c2.id }),
      c('por cliente', { ...buscar(), clienteId: ids.cliente }),
      c('por nombre de agencia', { ...buscar(), agenciaNombre: ag3.nombre.toUpperCase() }),
      c('por nombre de bahía', { ...buscar(), bahiaNombre: b2.nombre }),
      c('por nombre de operador', { ...buscar(), operadorNombre: `carlos${env.marca}` }),
      c('operador por dos palabras', { ...buscar(), operadorNombre: `Diana${env.marca} soto` }),
      c('operador asignado (tabla hija)', { ...buscar(), operadorId: ids.op3, incluirResumen: true }),
      c('operador principal', { ...buscar(), operadorId: ids.op1 }),
      c('búsqueda por placa', { ...buscar('aaa'), incluirResumen: true }),
      c('búsqueda por modelo', { ...buscar('yaris') }),
      c('búsqueda por marca', { ...buscar('toyota') }),
      c('búsqueda por cliente', { ...buscar('uno') }),
      c('búsqueda por OT', { search: `OT-${env.marca}-5` }),
      c('búsqueda por nombre del operador', { ...buscar('carlos') }),
      c('búsqueda de varias palabras', { ...buscar('toyota yaris') }),
      c('búsqueda que no encuentra nada', { ...buscar('zzzzzz'), incluirResumen: true }),
      c('rango que cruza el límite', { ...buscar(), fechaDesde: '2019-03-03', fechaHasta: '2020-03-03', incluirResumen: true }),
      c('rango solo archivado', { ...buscar(), fechaDesde: '2019-01-01', fechaHasta: '2019-09-30', incluirResumen: true }),
      c('rango solo reciente', { ...buscar(), fechaDesde: '2019-11-01', incluirResumen: true }),
      c('hasta un día exacto', { ...buscar(), fechaHasta: '2019-03-03T23:59:59.999Z' }),
      c('rango inválido se ignora', { ...buscar(), fechaDesde: 'no-es-fecha' }),
      c('alcance de región', { ...buscar(), incluirResumen: true }, () => regionR1),
      c('alcance de región con agencia', { ...buscar(), agenciaId: ids.ag2 }, () => regionR1),
      c('alcance de región pidiendo otra región', { ...buscar(), regionId: ids.r2 }, () => regionR1),
      c('alcance de agencia', { ...buscar(), incluirResumen: true }, () => agenciaAg1),
      c('alcance de agencia pidiendo otra agencia', { ...buscar(), agenciaId: ids.ag3 }, () => agenciaAg1),
      c('alcance propio (hizo o fue asignado)', { ...buscar(), incluirResumen: true }, () => propioOp1),
      c('alcance propio, orden por servicio', { ...buscar(), sortField: 'servicio', sortOrder: 'asc' }, () => propioOp1),
      c('alcance propio pidiendo a otro operador', { ...buscar(), operadorId: ids.op2 }, () => propioOp1),
      c('sin alcance no ve nada', { ...buscar() }, () => sinAlcance),
    ];

    // Resultados ANTES de archivar (todo en la base).
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
    // Las bases de comparación tienen datos: si no, la prueba no probaría nada.
    const datos = (nombre: string) => JSON.parse(antes.get(nombre)!);
    expect(datos('con resumen').data.length).toBe(13); // 14 menos el anulado
    expect(datos('con resumen').resumen.total).toBe(13);
    expect(datos('estado POR_APROBAR con resumen').data.length).toBe(2);
    expect(datos('operador asignado (tabla hija)').data.length).toBeGreaterThan(1);
    expect(datos('alcance propio (hizo o fue asignado)').data.length).toBeGreaterThan(3);
    expect(datos('sin alcance no ve nada').data.length).toBe(0);

    // Archiva de verdad, tocando solo los servicios de esta prueba.
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => t.tabla === 'servicio_lavado'),
      tablas: ['servicio_lavado'],
      filtroExtra: { servicio_lavado: { ordenTrabajoOT: { contains: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.servicio_lavado.archivadas).toBe(8);
    // Los vivos (FINALIZADO, EN_ESPERA) y los recientes se quedan.
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: { contains: env.marca } } })).toBe(6);

    volcarAlDisco(almacen, raiz);
    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    const conArchivo = new OperacionesService(env.prisma as never, undefined, undefined, historico);

    // Cuando una consulta difiere, se explica qué: el total, el resumen o qué filas (y en qué orden) salieron.
    const explicar = (a: any, b: any): string => {
      const partes: string[] = [];
      if (a.total !== b.total) partes.push(`total ${a.total} → ${b.total}`);
      if (JSON.stringify(a.resumen) !== JSON.stringify(b.resumen)) partes.push(`resumen ${JSON.stringify(a.resumen)} → ${JSON.stringify(b.resumen)}`);
      const ia = a.data.map((x: any) => x.placa).join(',');
      const ib = b.data.map((x: any) => x.placa).join(',');
      if (ia !== ib) partes.push(`filas ${ia} → ${ib}`);
      return partes.join('; ') || 'mismo contenido pero distinto JSON (campos o su orden)';
    };
    const diferentes: string[] = [];
    for (const caso of casos) {
      const despues = await listar(conArchivo, caso);
      if (despues !== antes.get(caso.nombre)) diferentes.push(`${caso.nombre}: ${explicar(JSON.parse(antes.get(caso.nombre)!), JSON.parse(despues))}`);
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería del listado: eso es lo que esta capa evita.
    const soloBase = JSON.parse(await listar(new OperacionesService(env.prisma as never), casos.find((x) => x.nombre === 'con resumen')!));
    expect(soloBase.data.length).toBe(6);
  });
});
