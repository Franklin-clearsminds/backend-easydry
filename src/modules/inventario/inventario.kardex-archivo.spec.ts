import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { InventarioService } from './inventario.service.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * El listado de Kardex (`kardex/list`) con datos archivados debe devolver EXACTAMENTE lo mismo que devolvía cuando todo estaba en
 * la base: mismas filas, mismo orden, mismas páginas, mismos totales y mismo JSON. Se archiva de verdad (archivador + almacén en
 * memoria) y se lee con DuckDB desde disco.
 */
describe.skipIf(!(await duckdbDisponible))('listKardex con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  let insumoA: string;
  let insumoB: string;
  let u1: string; // usuario "propio": solo ve lo que él registró
  let u2: string;
  let u3: string; // usuario con bodega asignada: solo ve esa bodega
  let agencia: string;
  let bodega: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];

  type Caso = { nombre: string; dto: Record<string, unknown>; usuarioId?: () => string | undefined };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();

  const kardex = (o: { insumoId: string; ubicacionId: string; tipo: string; cantidad: string; anterior: string; posterior: string; costoUnitario?: string | null; costoTotal?: string | null; referenciaId?: string | null; usuarioId?: string | null; fecha: string }) =>
    env.prisma.kardexMovimiento.create({
      data: { insumoId: o.insumoId, ubicacionId: o.ubicacionId, tipoMovimiento: o.tipo, cantidad: o.cantidad, stockAnterior: o.anterior, stockPosterior: o.posterior, costoUnitario: o.costoUnitario ?? null, costoTotal: o.costoTotal ?? null, referenciaId: o.referenciaId ?? null, usuarioId: o.usuarioId ?? null, fecha: new Date(o.fecha) },
    });

  const listar = (servicio: InventarioService, c: Caso) => servicio.listKardex(c.dto as never, c.usuarioId?.()).then((r) => JSON.stringify(r));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'kardex-archivo-'));
    insumoA = (await env.insumo('shampoo')).id;
    insumoB = (await env.insumo('cera')).id;
    agencia = (await env.agencia('kar')).id;
    bodega = (await env.bodega('kar')).id;
    u1 = (await env.usuario('k1', 'LAVADOR', { name: `Ana${env.marca}`, lastname: 'Mora' })).id;
    u2 = (await env.usuario('k2', 'LAVADOR', { name: `Beto${env.marca}`, lastname: 'Paz' })).id;
    u3 = (await env.usuario('k3', 'LAVADOR', { bodegaId: bodega })).id;

    // 6 filas viejas (se archivan) y 4 recientes (se quedan). Hay empates de fecha y valores nulos a propósito.
    await kardex({ insumoId: insumoA, ubicacionId: agencia, tipo: 'COMPRA_INGRESO', cantidad: '10.0000', anterior: '0.0000', posterior: '10.0000', costoUnitario: '2.50', costoTotal: '25.00', referenciaId: `REF-${env.marca}-1`, usuarioId: u1, fecha: '2019-03-05T15:00:00Z' });
    await kardex({ insumoId: insumoA, ubicacionId: agencia, tipo: 'CONSUMO_SERVICIO', cantidad: '-2.5000', anterior: '10.0000', posterior: '7.5000', usuarioId: u1, fecha: '2019-03-20T15:00:00Z' });
    await kardex({ insumoId: insumoB, ubicacionId: bodega, tipo: 'COMPRA_INGRESO', cantidad: '100.0000', anterior: '0.0000', posterior: '100.0000', costoUnitario: '1.20', costoTotal: '120.00', referenciaId: `REF-${env.marca}-2`, usuarioId: u2, fecha: '2019-03-20T15:00:00Z' });
    await kardex({ insumoId: insumoA, ubicacionId: bodega, tipo: 'DESPACHO_SALIDA', cantidad: '-1.0000', anterior: '7.5000', posterior: '6.5000', costoUnitario: '2.50', costoTotal: '2.50', fecha: '2019-06-10T15:00:00Z' });
    await kardex({ insumoId: insumoB, ubicacionId: agencia, tipo: 'AJUSTE_MERMA', cantidad: '-0.2500', anterior: '100.0000', posterior: '99.7500', usuarioId: u2, fecha: '2019-09-01T15:00:00Z' });
    await kardex({ insumoId: insumoB, ubicacionId: agencia, tipo: 'CONSUMO_SERVICIO', cantidad: '-1.5000', anterior: '119.7500', posterior: '118.2500', usuarioId: u1, fecha: '2019-03-05T15:00:00Z' });
    await kardex({ insumoId: insumoA, ubicacionId: agencia, tipo: 'COMPRA_INGRESO', cantidad: '5.0000', anterior: '6.5000', posterior: '11.5000', costoUnitario: '2.50', costoTotal: '12.50', referenciaId: `REF-${env.marca}-3`, usuarioId: u1, fecha: '2019-12-12T15:00:00Z' });
    await kardex({ insumoId: insumoA, ubicacionId: agencia, tipo: 'CONSUMO_SERVICIO', cantidad: '-2.0000', anterior: '11.5000', posterior: '9.5000', usuarioId: u1, fecha: '2020-02-02T15:00:00Z' });
    await kardex({ insumoId: insumoB, ubicacionId: bodega, tipo: 'DESPACHO_ENTRADA', cantidad: '20.0000', anterior: '99.7500', posterior: '119.7500', costoUnitario: '1.20', costoTotal: '24.00', referenciaId: `REF-${env.marca}-4`, usuarioId: u2, fecha: '2020-09-20T15:00:00Z' });
    await kardex({ insumoId: insumoA, ubicacionId: bodega, tipo: 'COMPRA_INGRESO', cantidad: '3.0000', anterior: '9.5000', posterior: '12.5000', costoUnitario: '2.50', costoTotal: '7.50', fecha: '2020-10-01T15:00:00Z' });

    // Todas las consultas se acotan a los insumos de esta prueba (la base puede tener movimientos de otras pruebas en paralelo).
    const ambos = { search: env.marca };
    const soloA = { insumoId: insumoA };
    casos = [
      { nombre: 'sin filtro, página 1 de 3', dto: { ...ambos, page: 1, pageSize: 3 } },
      { nombre: 'sin filtro, página 2 de 3', dto: { ...ambos, page: 2, pageSize: 3 } },
      { nombre: 'sin filtro, página 4 de 3', dto: { ...ambos, page: 4, pageSize: 3 } },
      { nombre: 'sin filtro, una sola página', dto: { ...ambos, page: 1, pageSize: 100 } },
      { nombre: 'insumo A', dto: { ...soloA, page: 1, pageSize: 100 } },
      { nombre: 'insumo A página 2 de 2', dto: { ...soloA, page: 2, pageSize: 2 } },
      ...['fecha', 'cantidad', 'stockAnterior', 'stockPosterior', 'costoUnitario', 'costoTotal', 'ubicacion', 'tipo'].flatMap((campo) =>
        (['asc', 'desc'] as const).map((dir) => ({ nombre: `orden ${campo} ${dir}`, dto: { ...ambos, sortField: campo, sortOrder: dir, page: 1, pageSize: 100 } })),
      ),
      ...['insumo', 'sku', 'usuario'].flatMap((campo) =>
        (['asc', 'desc'] as const).map((dir) => ({ nombre: `orden por nombre ${campo} ${dir}`, dto: { ...ambos, sortField: campo, sortOrder: dir, page: 1, pageSize: 100 } })),
      ),
      { nombre: 'orden por costo, página 2 de 4', dto: { ...ambos, sortField: 'costoTotal', sortOrder: 'asc', page: 2, pageSize: 4 } },
      { nombre: 'tipo de movimiento', dto: { ...ambos, tipoMovimiento: 'COMPRA_INGRESO', page: 1, pageSize: 100 } },
      { nombre: 'ubicación bodega', dto: { ...ambos, ubicacionId: bodega, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por insumo', dto: { search: `${env.marca} shampoo`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por SKU', dto: { search: `${env.marca}-SKU-cera`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por usuario', dto: { search: `Ana${env.marca}`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por apellido y marca', dto: { search: `${env.marca} paz`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por referencia', dto: { search: `REF-${env.marca}-2`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por tipo', dto: { search: `${env.marca} merma`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda que no encuentra nada', dto: { search: `${env.marca} zzzzzz`, page: 1, pageSize: 100 } },
      { nombre: 'rango que cruza el límite', dto: { ...ambos, fechaDesde: '2019-03-20', fechaHasta: '2020-02-02', page: 1, pageSize: 100 } },
      { nombre: 'rango solo archivado', dto: { ...ambos, fechaDesde: '2019-01-01', fechaHasta: '2019-09-30', page: 1, pageSize: 100 } },
      { nombre: 'rango solo reciente', dto: { ...ambos, fechaDesde: '2019-11-01', page: 1, pageSize: 100 } },
      { nombre: 'hasta un día exacto', dto: { ...ambos, fechaHasta: '2019-03-20', page: 1, pageSize: 100 } },
      { nombre: 'rol propio (solo lo que registró)', dto: { ...ambos, page: 1, pageSize: 100 }, usuarioId: () => u1 },
      { nombre: 'rol propio, orden por usuario', dto: { ...ambos, sortField: 'usuario', sortOrder: 'asc', page: 1, pageSize: 100 }, usuarioId: () => u1 },
      { nombre: 'rol con bodega asignada', dto: { ...ambos, page: 1, pageSize: 100 }, usuarioId: () => u3 },
      { nombre: 'rol con bodega asignada y búsqueda', dto: { search: `${env.marca} cera`, page: 1, pageSize: 100 }, usuarioId: () => u3 },
    ];

    // Resultados ANTES de archivar (todo en la base).
    const base = new InventarioService(env.prisma as never);
    for (const c of casos) antes.set(c.nombre, await listar(base, c));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.prisma.kardexMovimiento.deleteMany({ where: { insumoId: { in: [insumoA, insumoB] } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('todas las consultas dan exactamente lo mismo antes y después de archivar', async () => {
    // Las bases de comparación tienen datos: si no, la prueba no probaría nada.
    expect(JSON.parse(antes.get('sin filtro, una sola página')!).data.length).toBe(10);
    expect(JSON.parse(antes.get('rol propio (solo lo que registró)')!).data.length).toBe(5);
    expect(JSON.parse(antes.get('rol con bodega asignada')!).data.length).toBe(4);

    // Archiva de verdad, tocando solo las filas de esta prueba.
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => t.tabla === 'kardex_movimiento'),
      tablas: ['kardex_movimiento'],
      filtroExtra: { kardex_movimiento: { insumoId: { in: [insumoA, insumoB] } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.kardex_movimiento.archivadas).toBe(6);
    expect(await env.prisma.kardexMovimiento.count({ where: { insumoId: { in: [insumoA, insumoB] } } })).toBe(4);

    volcarAlDisco(almacen, raiz);
    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    const conArchivo = new InventarioService(env.prisma as never, undefined, historico);

    const diferentes: string[] = [];
    for (const c of casos) {
      const despues = await listar(conArchivo, c);
      if (despues !== antes.get(c.nombre)) diferentes.push(c.nombre);
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería del listado: eso es lo que esta capa evita.
    const soloBase = await listar(new InventarioService(env.prisma as never), casos[3]);
    expect(JSON.parse(soloBase).data.length).toBe(4);
  });
});
