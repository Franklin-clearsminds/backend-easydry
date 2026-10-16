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
 * El listado de movimientos de inventario (`movimientos/globales`) con datos archivados debe devolver EXACTAMENTE lo mismo que cuando
 * todo estaba en la base: mismas filas, mismo orden, mismas páginas, mismos totales, mismo resumen por tipo y mismo JSON. Se archiva
 * de verdad (archivador + almacén en memoria) y se lee con DuckDB desde disco.
 */
describe.skipIf(!(await duckdbDisponible))('listMovimientosGlobales con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];

  type Caso = { nombre: string; dto: Record<string, unknown>; usuarioId?: () => string | undefined };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();
  const ids: Record<string, string> = {};

  // El orden de las claves de un objeto no importa (p. ej. el resumen por tipo): se compara con las claves ordenadas. El orden de
  // los ARREGLOS sí importa y se respeta.
  const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v);
  const listar = (servicio: InventarioService, c: Caso) =>
    servicio.listMovimientosGlobales(c.dto as never, c.usuarioId?.()).then((r) => JSON.stringify(canonico(JSON.parse(JSON.stringify(r)))));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'movimientos-archivo-'));
    const tipos = await env.prisma.tipoMovimientoInventario.findMany({ take: 2, orderBy: { codigo: 'asc' } });
    expect(tipos.length, 'faltan los tipos de movimiento del seed').toBe(2);
    // La base puede no tener motivos sembrados: la prueba crea el suyo (y lo borra al terminar).
    const motivo = await env.prisma.motivoMovimientoInventario.create({ data: { codigo: `${env.marca}-MOT`, nombre: `Reposicion ${env.marca}` } });
    const insumoA = await env.insumo('lim');
    const insumoB = await env.insumo('cer');
    const unidadId = (await env.prisma.insumo.findUniqueOrThrow({ where: { id: insumoA.id }, select: { unidadMedidaId: true } })).unidadMedidaId;
    const agencia = (await env.agencia('mv')).id;
    const bodega = (await env.bodega('mv')).id;
    const u1 = await env.usuario('m1', 'LAVADOR', { name: `Ana${env.marca}`, lastname: 'Mora' });
    const u2 = await env.usuario('m2', 'LAVADOR', { name: `Beto${env.marca}`, lastname: 'Paz' });
    const u3 = await env.usuario('m3', 'LAVADOR', { bodegaId: bodega });
    Object.assign(ids, { a: insumoA.id, b: insumoB.id, t1: tipos[0].id, t2: tipos[1].id, agencia, bodega, u1: u1.id, u2: u2.id, u3: u3.id });

    let n = 0;
    const mov = (o: { insumo: { id: string }; tipo: string; ubic: string | null; fecha: string; cantidad: string; anterior: string; nuevo: string; resp?: string | null; origen?: string | null; destino?: string | null; ref?: string | null; obs?: string | null; conMotivo?: boolean; evidencias?: string[] }) => {
      n++;
      return env.prisma.movimientoInventarioGlobal.create({
        data: {
          numeroComprobante: `${env.marca}-MOV-${String(n).padStart(3, '0')}`, tipoMovimientoId: o.tipo, insumoId: o.insumo.id, cantidad: o.cantidad, unidadId,
          cantidadBase: o.cantidad, stockAnterior: o.anterior, stockNuevo: o.nuevo, ubicacionId: o.ubic, origenUbicacion: o.origen ?? null, destinoUbicacion: o.destino ?? null,
          responsableId: o.resp ?? null, motivoId: o.conMotivo ? motivo.id : null, referencia: o.ref ?? null, observaciones: o.obs ?? null,
          evidenciasUrls: o.evidencias ?? [], fechaMovimiento: new Date(o.fecha),
        },
      });
    };

    // 6 filas viejas (se archivan) y 4 recientes (se quedan). Hay empates de fecha, nulos y rutas sin guardar a propósito.
    await mov({ insumo: insumoA, tipo: tipos[0].id, ubic: agencia, fecha: '2019-03-05T15:00:00Z', cantidad: '10.0000', anterior: '0.0000', nuevo: '10.0000', resp: u1.id, origen: 'Proveedor Uno', destino: 'Agencia Norte', ref: `FAC-${env.marca}-1`, obs: 'Compra inicial ñ', conMotivo: true, evidencias: ['https://x.test/a.jpg', 'https://x.test/b.jpg'] });
    await mov({ insumo: insumoA, tipo: tipos[1].id, ubic: agencia, fecha: '2019-03-20T15:00:00Z', cantidad: '2.5000', anterior: '10.0000', nuevo: '7.5000', resp: u1.id, origen: 'Agencia Norte', destino: 'Consumo' });
    await mov({ insumo: insumoB, tipo: tipos[0].id, ubic: bodega, fecha: '2019-03-20T15:00:00Z', cantidad: '100.0000', anterior: '0.0000', nuevo: '100.0000', resp: u2.id, origen: 'proveedor dos', destino: 'Bodega Central', ref: `FAC-${env.marca}-2` });
    await mov({ insumo: insumoA, tipo: tipos[1].id, ubic: bodega, fecha: '2019-06-10T15:00:00Z', cantidad: '1.0000', anterior: '7.5000', nuevo: '6.5000', resp: null, origen: null, destino: null, obs: 'Sin ruta guardada' });
    await mov({ insumo: insumoB, tipo: tipos[1].id, ubic: agencia, fecha: '2019-09-01T15:00:00Z', cantidad: '0.2500', anterior: '100.0000', nuevo: '99.7500', resp: u2.id, origen: 'Agencia Norte', destino: 'Merma', conMotivo: true });
    await mov({ insumo: insumoB, tipo: tipos[0].id, ubic: agencia, fecha: '2019-03-05T15:00:00Z', cantidad: '1.5000', anterior: '119.7500', nuevo: '118.2500', resp: u1.id, origen: 'Álvaro Proveedor', destino: 'Agencia Sur' });
    await mov({ insumo: insumoA, tipo: tipos[0].id, ubic: agencia, fecha: '2019-12-12T15:00:00Z', cantidad: '5.0000', anterior: '6.5000', nuevo: '11.5000', resp: u1.id, origen: 'Proveedor Uno', destino: 'Agencia Norte', ref: `FAC-${env.marca}-3` });
    await mov({ insumo: insumoA, tipo: tipos[1].id, ubic: agencia, fecha: '2020-02-02T15:00:00Z', cantidad: '2.0000', anterior: '11.5000', nuevo: '9.5000', resp: u1.id, origen: 'Agencia Norte', destino: 'Consumo' });
    await mov({ insumo: insumoB, tipo: tipos[0].id, ubic: bodega, fecha: '2020-09-20T15:00:00Z', cantidad: '20.0000', anterior: '99.7500', nuevo: '119.7500', resp: u2.id, origen: 'Proveedor Dos', destino: 'Bodega Central', ref: `FAC-${env.marca}-4` });
    await mov({ insumo: insumoA, tipo: tipos[1].id, ubic: bodega, fecha: '2020-10-01T15:00:00Z', cantidad: '3.0000', anterior: '9.5000', nuevo: '12.5000', resp: null, origen: null, destino: null });

    // Todas las consultas se acotan a los movimientos de esta prueba (la base puede tener otros de pruebas en paralelo).
    const ambos = { search: env.marca };
    const nombreTipo = tipos[0].nombre.split(' ')[0];
    casos = [
      ...[1, 2, 3, 4].map((page) => ({ nombre: `paginación página ${page} de 3`, dto: { ...ambos, page, pageSize: 3 } })),
      { nombre: 'una sola página con resumen', dto: { ...ambos, page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'insumo A', dto: { insumoId: insumoA.id, page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'insumo A página 2 de 2', dto: { insumoId: insumoA.id, page: 2, pageSize: 2 } },
      ...['fecha', 'createdAt', 'comprobante', 'producto', 'sku', 'tipo', 'ruta', 'origen', 'destino', 'cantidad', 'cantidadBase', 'stockAnterior', 'stockNuevo', 'responsable'].flatMap((campo) =>
        (['asc', 'desc'] as const).map((dir) => ({ nombre: `orden ${campo} ${dir}`, dto: { ...ambos, sortField: campo, sortOrder: dir, page: 1, pageSize: 100 } })),
      ),
      { nombre: 'orden por producto, página 2 de 4', dto: { ...ambos, sortField: 'producto', sortOrder: 'asc', page: 2, pageSize: 4 } },
      { nombre: 'orden por stock nuevo, página 2 de 4', dto: { ...ambos, sortField: 'stockNuevo', sortOrder: 'desc', page: 2, pageSize: 4 } },
      { nombre: 'por tipo (con resumen sin el filtro de tipo)', dto: { ...ambos, tipoMovimientoId: tipos[0].id, page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'por ubicación', dto: { ...ambos, ubicacionId: bodega, page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'búsqueda por comprobante', dto: { search: `${env.marca}-MOV-003`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por referencia', dto: { search: `FAC-${env.marca}-2`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por observaciones', dto: { search: `${env.marca} compra`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por origen', dto: { search: `${env.marca} proveedor`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por destino', dto: { search: `${env.marca} merma`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por insumo', dto: { search: `${env.marca} cer`, page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'búsqueda por SKU', dto: { search: `${env.marca}-SKU-lim`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por tipo', dto: { search: `${env.marca} ${nombreTipo}`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por motivo', dto: { search: `${env.marca} reposicion`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por responsable', dto: { search: `Ana${env.marca}`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda por apellido y marca', dto: { search: `${env.marca} paz`, page: 1, pageSize: 100 } },
      { nombre: 'búsqueda que no encuentra nada', dto: { search: `${env.marca} zzzzzz`, page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'rango que cruza el límite', dto: { ...ambos, fechaDesde: '2019-03-20', fechaHasta: '2020-02-02', page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'rango solo archivado', dto: { ...ambos, fechaDesde: '2019-01-01', fechaHasta: '2019-09-30', page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'rango solo reciente', dto: { ...ambos, fechaDesde: '2019-11-01', page: 1, pageSize: 100, incluirResumen: true } },
      { nombre: 'hasta un día exacto', dto: { ...ambos, fechaHasta: '2019-03-20', page: 1, pageSize: 100 } },
      { nombre: 'rol propio (solo lo que registró)', dto: { ...ambos, page: 1, pageSize: 100, incluirResumen: true }, usuarioId: () => ids.u1 },
      { nombre: 'rol propio, orden por responsable', dto: { ...ambos, sortField: 'responsable', sortOrder: 'asc', page: 1, pageSize: 100 }, usuarioId: () => ids.u1 },
      { nombre: 'rol con bodega asignada', dto: { ...ambos, page: 1, pageSize: 100, incluirResumen: true }, usuarioId: () => ids.u3 },
      { nombre: 'rol con bodega asignada y búsqueda', dto: { search: `${env.marca} proveedor`, page: 1, pageSize: 100 }, usuarioId: () => ids.u3 },
    ];

    // Resultados ANTES de archivar (todo en la base).
    const base = new InventarioService(env.prisma as never);
    for (const caso of casos) antes.set(caso.nombre, await listar(base, caso));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.prisma.movimientoInventarioGlobal.deleteMany({ where: { numeroComprobante: { startsWith: env.marca } } });
    await env.prisma.motivoMovimientoInventario.deleteMany({ where: { codigo: `${env.marca}-MOT` } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('todas las consultas dan exactamente lo mismo antes y después de archivar', async () => {
    // Las bases de comparación tienen datos: si no, la prueba no probaría nada.
    const datos = (nombre: string) => JSON.parse(antes.get(nombre)!);
    expect(datos('una sola página con resumen').data.length).toBe(10);
    expect(datos('una sola página con resumen').resumen.total).toBe(10);
    expect(datos('rol propio (solo lo que registró)').data.length).toBe(5);
    expect(datos('rol con bodega asignada').data.length).toBe(4);
    // Una fila sin ruta guardada usa la ruta calculada: debe seguir igual al archivarse.
    expect(JSON.stringify(datos('una sola página con resumen').data)).toContain('Sin ruta guardada');
    expect(datos('búsqueda por motivo').data.length).toBe(2);

    // Archiva de verdad, tocando solo los movimientos de esta prueba.
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => t.tabla === 'movimiento_inventario_global'),
      tablas: ['movimiento_inventario_global'],
      filtroExtra: { movimiento_inventario_global: { numeroComprobante: { startsWith: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.movimiento_inventario_global.archivadas).toBe(6);
    expect(await env.prisma.movimientoInventarioGlobal.count({ where: { numeroComprobante: { startsWith: env.marca } } })).toBe(4);

    volcarAlDisco(almacen, raiz);
    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    const conArchivo = new InventarioService(env.prisma as never, undefined, historico);

    // Cuando una consulta difiere, se explica qué: el total, el resumen o qué filas (y en qué orden) salieron.
    const explicar = (a: any, b: any): string => {
      const partes: string[] = [];
      if (a.total !== b.total) partes.push(`total ${a.total} → ${b.total}`);
      if (JSON.stringify(canonico(a.resumen)) !== JSON.stringify(canonico(b.resumen))) partes.push(`resumen ${JSON.stringify(a.resumen)} → ${JSON.stringify(b.resumen)}`);
      const ia = a.data.map((x: any) => x.numeroComprobante.slice(-3)).join(',');
      const ib = b.data.map((x: any) => x.numeroComprobante.slice(-3)).join(',');
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
    const soloBase = JSON.parse(await listar(new InventarioService(env.prisma as never), casos.find((x) => x.nombre === 'una sola página con resumen')!));
    expect(soloBase.data.length).toBe(4);
  });
});
