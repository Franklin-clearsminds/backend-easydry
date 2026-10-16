import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import type { ConsultaArchivo } from '../archivado/archivo-lector.js';
import { InventarioService } from './inventario.service.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

class LectorContador extends LectorSoloLocal {
  llamadas = 0;
  override async consultar(c: ConsultaArchivo) {
    this.llamadas++;
    return super.consultar(c);
  }
  override async contarPor(c: ConsultaArchivo, columna: string) {
    this.llamadas++;
    return super.contarPor(c, columna);
  }
  override async contar(c: ConsultaArchivo) {
    this.llamadas++;
    return super.contar(c);
  }
}

/**
 * El listado de despachos (`despachos/list`) con datos archivados debe devolver EXACTAMENTE lo mismo que cuando todo estaba en la
 * base: mismas filas, mismo orden, mismos detalles, mismas páginas, mismos totales y mismas tarjetas de resumen, para cada tipo de
 * usuario. Se archiva de verdad (archivador + almacén en memoria) y se lee con DuckDB desde disco.
 */
describe.skipIf(!(await duckdbDisponible))('listDespachos con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  let lector: LectorContador;
  const corridas: string[] = [];
  const AHORA = new Date('2020-10-15T12:00:00Z');

  type Caso = { nombre: string; dto: Record<string, unknown>; quien?: () => string | undefined };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();
  const ids: Record<string, string> = {};

  const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v);
  const listar = (servicio: InventarioService, c: Caso) => servicio.listDespachos(c.dto as never, c.quien?.()).then((r) => JSON.stringify(canonico(JSON.parse(JSON.stringify(r)))));

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'despachos-archivo-'));
    const region = await env.region('dp1');
    const ag1 = await env.agencia('dp1', { regionId: region.id });
    const ag2 = await env.agencia('dp2', { regionId: region.id });
    const bodega = await env.bodega('dp1', { regionId: region.id });
    const insumoA = await env.insumo('jabon');
    const insumoB = await env.insumo('cera');
    const despacha = await env.usuario('dp-despacha', 'LAVADOR', { name: `Mario${env.marca}`, lastname: 'Cueva' });
    const recibe = await env.usuario('dp-recibe', 'LAVADOR', { name: `Nora${env.marca}`, lastname: 'Pinto' });
    const lider = await env.usuario('dp-lider', 'LIDER', { agenciaId: ag1.id });
    const supervisor = await env.usuario('dp-super', 'SUPERVISOR', { regionId: region.id });
    const pulidor = await env.usuario('dp-pulidor', 'PULIDOR', { agenciaId: ag1.id, name: `Pablo${env.marca}`, lastname: 'Ruiz' });
    const superAdmin = await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } });
    const admin = await env.prisma.user.findFirstOrThrow({ where: { email: 'admin@easydry.com' }, select: { id: true } });
    Object.assign(ids, { ag1: ag1.id, ag2: ag2.id, lider: lider.id, supervisor: supervisor.id, pulidor: pulidor.id, superAdmin: superAdmin.id, admin: admin.id, nombreAg1: ag1.nombre });

    let n = 0;
    const despacho = async (o: { tipo: 'DESPACHO_AGENCIA' | 'DESPACHO_PULIDOR' | 'DESPACHO_BODEGA'; estado: 'RECIBIDO' | 'RECHAZADO' | 'CANCELADO' | 'EN_TRANSITO' | 'PENDIENTE'; fecha: string; destino: { agencia?: { id: string; nombre: string }; bodega?: string; pulidor?: string }; insumo?: { id: string }; recepcion?: string | null; obs?: string; segundoInsumo?: boolean; origenBodega?: boolean; origenAgencia?: { id: string; nombre: string } }) => {
      n++;
      const m = await env.movimiento({
        usuarioDespachaId: despacha.id, usuarioRecibeId: o.estado === 'RECIBIDO' || o.estado === 'RECHAZADO' ? recibe.id : null, tipo: o.tipo, estadoDespacho: o.estado, numeroGuia: `${env.marca}-D-${String(n).padStart(2, '0')}`,
        fechaDespacho: new Date(o.fecha), observaciones: o.obs ?? null, origenBodegaId: o.origenAgencia || o.origenBodega === false ? null : bodega.id, origenAgenciaId: o.origenAgencia?.id ?? null, destinoAgenciaId: o.destino.agencia?.id ?? null, destinoBodegaId: o.destino.bodega ?? null, destinoPulidorId: o.destino.pulidor ?? null,
        origenUbicacion: o.origenAgencia ? `${o.origenAgencia.nombre} [${o.origenAgencia.id}]` : 'Bodega Central', destinoUbicacion: o.destino.agencia ? `${o.destino.agencia.nombre} [${o.destino.agencia.id}]` : o.destino.pulidor ? `Pulidor ${n}` : `Bodega regional ${n}`,
        detalle: { insumoId: (o.insumo ?? insumoA).id, cantidadEnviada: 5 + n, cantidadRecibida: o.estado === 'RECIBIDO' ? 5 + n : undefined },
      });
      if (o.recepcion) await env.prisma.movimientoInventario.update({ where: { id: m.id }, data: { fechaRecepcion: new Date(o.recepcion) } });
      if (o.segundoInsumo) await env.prisma.movimientoDetalle.create({ data: { movimientoId: m.id, insumoId: insumoB.id, cantidadEnviada: 2.5, cantidadRecibida: 2 } });
      return m;
    };

    // Archivables (estado final y de hace más de 12 meses).
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-02-05T15:00:00Z', destino: { agencia: ag1 }, recepcion: '2019-02-06T15:00:00Z', segundoInsumo: true });
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-03-10T15:00:00Z', destino: { agencia: ag2 }, recepcion: null, insumo: insumoB });
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECHAZADO', fecha: '2019-03-10T15:00:00Z', destino: { agencia: ag1 }, recepcion: '2019-03-11T15:00:00Z', obs: 'RECHAZO: llegó dañado ñ' }); // misma fecha que el anterior: empate
    await despacho({ tipo: 'DESPACHO_PULIDOR', estado: 'RECIBIDO', fecha: '2019-05-20T15:00:00Z', destino: { pulidor: pulidor.id }, recepcion: '2019-05-21T15:00:00Z' });
    await despacho({ tipo: 'DESPACHO_BODEGA', estado: 'CANCELADO', fecha: '2019-07-07T15:00:00Z', destino: { bodega: bodega.id } });
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-09-09T15:00:00Z', destino: { agencia: ag1 }, recepcion: '2019-09-10T15:00:00Z' });
    // Un traslado entre agencias: SALE de la agencia 1 hacia la 2. Quien filtra por la agencia 1 también debe verlo.
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-08-08T15:00:00Z', destino: { agencia: ag2 }, origenAgencia: ag1, recepcion: '2019-08-09T15:00:00Z' });
    // Vivos aunque sean viejos o recientes: se quedan en la base.
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'EN_TRANSITO', fecha: '2019-04-04T15:00:00Z', destino: { agencia: ag1 } });
    await despacho({ tipo: 'DESPACHO_PULIDOR', estado: 'PENDIENTE', fecha: '2019-06-06T15:00:00Z', destino: { pulidor: pulidor.id } });
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-12-12T15:00:00Z', destino: { agencia: ag1 }, recepcion: '2019-12-13T15:00:00Z' }); // reciente
    await despacho({ tipo: 'DESPACHO_AGENCIA', estado: 'RECHAZADO', fecha: '2020-05-05T15:00:00Z', destino: { agencia: ag2 }, recepcion: '2020-05-06T15:00:00Z', obs: 'RECHAZO: no era el pedido' });
    await despacho({ tipo: 'DESPACHO_BODEGA', estado: 'EN_TRANSITO', fecha: '2020-10-01T15:00:00Z', destino: { bodega: bodega.id } });

    // Todas las consultas se acotan a los despachos de esta prueba (la base puede tener otros de pruebas en paralelo).
    const ambos = { search: env.marca };
    const c = (nombre: string, dto: Record<string, unknown>, quien?: string): Caso => ({ nombre, dto: { page: 1, pageSize: 100, ...dto }, quien: quien ? () => quien : undefined });
    casos = [
      ...[1, 2, 3, 4].map((page) => c(`paginación página ${page} de 3`, { ...ambos, page, pageSize: 3 }, ids.superAdmin)),
      c('sin tamaño de página', { ...ambos, pageSize: undefined, page: undefined }, ids.superAdmin),
      ...['fecha', 'guia', 'estado', 'origen', 'destino', 'recepcion'].flatMap((campo) =>
        (['asc', 'desc'] as const).map((dir) => c(`orden ${campo} ${dir}`, { ...ambos, sortField: campo, sortOrder: dir, incluirResumen: true }, ids.superAdmin)),
      ),
      c('orden por recepción, página 2 de 4', { ...ambos, sortField: 'recepcion', sortOrder: 'desc', page: 2, pageSize: 4 }, ids.superAdmin),
      c('con resumen', { ...ambos, incluirResumen: true }, ids.superAdmin),
      ...['recibido', 'RECHAZADO', 'cancelado', 'EN_TRANSITO', 'PENDIENTE'].map((estadoDespacho) => c(`estado ${estadoDespacho} con resumen`, { ...ambos, estadoDespacho, incluirResumen: true }, ids.superAdmin)),
      c('por guía', { numeroGuia: `${env.marca}-D-03`, incluirResumen: true }, ids.superAdmin),
      c('por guía parcial', { numeroGuia: `${env.marca}-D-0`, incluirResumen: true }, ids.superAdmin),
      c('por agencia (id)', { ...ambos, agenciaId: ids.ag1, incluirResumen: true }, ids.superAdmin),
      c('por agencia (sucursalId)', { ...ambos, sucursalId: ids.ag2 }, ids.superAdmin),
      c('por agencia destino', { ...ambos, agenciaDestinoId: ids.ag1 }, ids.superAdmin),
      c('por agencia (nombre)', { ...ambos, agenciaId: ids.nombreAg1 }, ids.superAdmin),
      c('por pulidor', { ...ambos, pulidorId: ids.pulidor, incluirResumen: true }, ids.superAdmin),
      c('búsqueda por guía', { search: `${env.marca}-D-04` }, ids.superAdmin),
      c('búsqueda por destino', { search: `${env.marca} bodega regional` }, ids.superAdmin),
      c('búsqueda por origen', { search: `${env.marca} central`, incluirResumen: true }, ids.superAdmin),
      c('búsqueda por responsable que despacha', { search: `Mario${env.marca}` }, ids.superAdmin),
      c('búsqueda por responsable que recibe', { search: `${env.marca} pinto` }, ids.superAdmin),
      c('búsqueda por insumo', { search: `${env.marca} cera`, incluirResumen: true }, ids.superAdmin),
      c('búsqueda por SKU', { search: `${env.marca}-SKU-jabon` }, ids.superAdmin),
      c('búsqueda de varias palabras', { search: `${env.marca} mario central` }, ids.superAdmin),
      c('búsqueda que no encuentra nada', { search: `${env.marca} zzzzzz`, incluirResumen: true }, ids.superAdmin),
      c('rango que cruza el límite', { ...ambos, fechaDesde: '2019-03-10', fechaHasta: '2020-05-05', incluirResumen: true }, ids.superAdmin),
      c('rango solo archivado', { ...ambos, fechaDesde: '2019-01-01', fechaHasta: '2019-09-30', incluirResumen: true }, ids.superAdmin),
      c('rango solo reciente', { ...ambos, fechaDesde: '2019-11-01', incluirResumen: true }, ids.superAdmin),
      c('hasta un día exacto', { ...ambos, fechaHasta: '2019-03-10' }, ids.superAdmin),
      c('como Admin', { ...ambos, incluirResumen: true }, ids.admin),
      c('como líder de agencia (solo la suya)', { ...ambos, incluirResumen: true }, ids.lider),
      c('como líder, pidiendo otra agencia', { ...ambos, agenciaId: ids.ag2 }, ids.lider),
      c('como supervisor regional', { ...ambos, incluirResumen: true }, ids.supervisor),
      c('como supervisor regional, orden por destino', { ...ambos, sortField: 'destino', sortOrder: 'asc' }, ids.supervisor),
      c('como pulidor (solo lo que se le envió)', { ...ambos, incluirResumen: true }, ids.pulidor),
      c('como pulidor, orden por guía', { ...ambos, sortField: 'guia', sortOrder: 'desc' }, ids.pulidor),
      c('sin usuario', { ...ambos }, undefined),
    ];

    const base = new InventarioService(env.prisma as never);
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
    expect(datos('con resumen').data.length).toBe(12);
    expect(datos('con resumen').resumen.total).toBe(12);
    expect(datos('como pulidor (solo lo que se le envió)').data.length).toBeGreaterThan(1);
    expect(datos('como líder de agencia (solo la suya)').data.length).toBeGreaterThan(2);
    expect(datos('como supervisor regional').data.length).toBeGreaterThan(2);
    // Un despacho con dos insumos, para comprobar que los detalles salen igual.
    expect(datos('con resumen').data.some((d: any) => d.detalles.length === 2)).toBe(true);

    // Archiva de verdad, tocando solo los despachos de esta prueba.
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      simulacro: false,
      candado: `prueba-${env.marca}`,
      configuracion: TABLAS_OPERACION.filter((t) => t.tabla === 'movimiento_inventario'),
      tablas: ['movimiento_inventario'],
      filtroExtra: { movimiento_inventario: { numeroGuia: { startsWith: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(r.tablas)).toBe('OK');
    expect(r.tablas.movimiento_inventario.archivadas).toBe(7);
    expect(await env.prisma.movimientoInventario.count({ where: { numeroGuia: { startsWith: env.marca } } })).toBe(5);

    volcarAlDisco(almacen, raiz);
    lector = new LectorContador(raiz);
    const conArchivo = new InventarioService(env.prisma as never, undefined, new HistoricoService(env.prisma as never, lector));

    const explicar = (a: any, b: any): string => {
      const partes: string[] = [];
      if (a.total !== b.total) partes.push(`total ${a.total} → ${b.total}`);
      if (JSON.stringify(canonico(a.resumen)) !== JSON.stringify(canonico(b.resumen))) partes.push(`resumen ${JSON.stringify(a.resumen)} → ${JSON.stringify(b.resumen)}`);
      const lista = (x: any) => (x.data ?? x).map((d: any) => `${d.numeroGuia.slice(-2)}(${d.detalles?.length})`).join(',');
      if (lista(a) !== lista(b)) partes.push(`filas ${lista(a)} → ${lista(b)}`);
      return partes.join('; ') || 'mismo contenido pero distinto JSON (campos)';
    };
    const diferentes: string[] = [];
    for (const caso of casos) {
      const despues = await listar(conArchivo, caso);
      if (despues !== antes.get(caso.nombre)) diferentes.push(`${caso.nombre}: ${explicar(JSON.parse(antes.get(caso.nombre)!), JSON.parse(despues))}`);
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería del listado: eso es lo que esta capa evita.
    const soloBase = JSON.parse(await listar(new InventarioService(env.prisma as never), casos.find((x) => x.nombre === 'con resumen')!));
    expect(soloBase.data.length).toBe(5);
  });

  it('los usos internos (solo despachos en tránsito, sin tarjetas de resumen) no tocan el archivo', async () => {
    const conArchivo = new InventarioService(env.prisma as never, undefined, new HistoricoService(env.prisma as never, lector));
    const llamadasAntes = lector.llamadas;
    await conArchivo.listDespachos({ estadoDespacho: 'EN_TRANSITO', search: env.marca, page: 1, pageSize: 50 } as never, ids.superAdmin);
    await conArchivo.listDespachos({ estadoDespacho: 'PENDIENTE', search: env.marca, page: 1, pageSize: 50 } as never, ids.superAdmin);
    expect(lector.llamadas).toBe(llamadasAntes);
  });

  it('las tarjetas de resumen sí cuentan lo archivado aunque se filtre por un estado que nunca se archiva (ignoran el filtro de estado)', async () => {
    const conArchivo = new InventarioService(env.prisma as never, undefined, new HistoricoService(env.prisma as never, lector));
    const r: any = await conArchivo.listDespachos({ estadoDespacho: 'EN_TRANSITO', search: env.marca, page: 1, pageSize: 50, incluirResumen: true } as never, ids.superAdmin);
    expect(r.data.every((d: any) => d.estadoDespacho === 'EN_TRANSITO')).toBe(true); // las filas respetan el filtro…
    expect(r.resumen).toMatchObject({ enTransito: 3, recibidos: 6, rechazados: 2, total: 12 }); // …pero las tarjetas cuentan todos los estados, archivados incluidos
  });
});
