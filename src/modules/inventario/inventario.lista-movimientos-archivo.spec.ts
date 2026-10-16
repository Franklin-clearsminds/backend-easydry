import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ServiciosFederados } from '../archivado/servicios-federados.js';
import { InventarioService } from './inventario.service.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * La lista de movimientos (`movimientos/list`, con guías, tipos, estados y fechas) con datos archivados debe dar EXACTAMENTE lo mismo
 * que cuando todo estaba en la base, para cada tipo de usuario. Se archiva de verdad y se lee con DuckDB desde disco.
 */
describe.skipIf(!(await duckdbDisponible))('listMovimientos con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];
  type Caso = { nombre: string; dto: Record<string, unknown>; actor: () => any };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();
  const antesTope = new Map<string, string>();
  const conTope = async (historico: HistoricoService | undefined, take: number, dir: 'asc' | 'desc') =>
    JSON.stringify(
      (await new ServiciosFederados(env.prisma as never, historico).findMany('movimientoInventario', { where: { numeroGuia: { contains: env.marca, mode: 'insensitive' }, tipo: { in: ['DESPACHO_AGENCIA', 'COMPRA_PROVEEDOR', 'AJUSTE_MERMA'] } }, orderBy: { fechaDespacho: dir }, take, select: { numeroGuia: true, fechaDespacho: true, estadoDespacho: true } })).map((m: any) => [m.fechaDespacho, m.estadoDespacho]),
    );

  // Las líneas de un mismo movimiento no tienen un orden definido (la base las devuelve como las guardó): se compara su contenido.
  const canonico = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(canonico);
      return items.some((x) => x && typeof x === 'object') ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
    }
    return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v;
  };
  // El orden entre movimientos de la MISMA fecha no está definido (ni en la base): se compara el orden por fecha y el contenido.
  const listar = (servicio: InventarioService, c: Caso) =>
    servicio.listMovimientos(c.dto as never, c.actor()).then((r: any[]) => {
      const fechas = r.map((m) => new Date(m.fechaDespacho).getTime());
      expect(fechas, `${c.nombre}: orden por fecha descendente`).toEqual([...fechas].sort((a, b) => b - a));
      return JSON.stringify(canonico(JSON.parse(JSON.stringify([...r].sort((a, b) => String(a.numeroGuia).localeCompare(String(b.numeroGuia)))))));
    });

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'lista-movimientos-'));
    const region = await env.region('lm1');
    const ag1 = await env.agencia('lm1', { regionId: region.id });
    const ag2 = await env.agencia('lm2', { regionId: region.id });
    const bodega = await env.bodega('lm1', { regionId: region.id });
    const insumoA = await env.insumo('lmjabon');
    const insumoB = await env.insumo('lmcera');
    const despacha = await env.usuario('lm-despacha', 'LAVADOR', { name: `Mario${env.marca}`, lastname: 'Cueva' });
    const recibe = await env.usuario('lm-recibe', 'LAVADOR', { name: `Nora${env.marca}`, lastname: 'Pinto' });
    const pulidor = await env.usuario('lm-pulidor', 'PULIDOR', { agenciaId: ag1.id });
    const admin = await env.actor((await env.usuario('lm-admin', 'ADMIN')).id);
    const lider = await env.actor((await env.usuario('lm-lider', 'LIDER', { agenciaId: ag1.id })).id);
    const supervisor = await env.actor((await env.usuario('lm-super', 'SUPERVISOR', { regionId: region.id })).id);
    const pulidorActor = await env.actor(pulidor.id);

    let n = 0;
    const mov = async (o: { tipo: 'COMPRA_PROVEEDOR' | 'DESPACHO_AGENCIA' | 'DESPACHO_PULIDOR' | 'DESPACHO_BODEGA' | 'AJUSTE_MERMA'; estado: 'RECIBIDO' | 'RECHAZADO' | 'CANCELADO' | 'EN_TRANSITO' | 'PENDIENTE'; fecha: string; destinoAgencia?: { id: string; nombre: string }; origenAgencia?: { id: string; nombre: string }; destinoPulidor?: string; segundo?: boolean; guia?: string }) => {
      n++;
      const m = await env.movimiento({
        usuarioDespachaId: despacha.id, usuarioRecibeId: o.estado === 'RECIBIDO' ? recibe.id : null, tipo: o.tipo, estadoDespacho: o.estado, numeroGuia: o.guia ?? `${env.marca}-M-${String(n).padStart(2, '0')}`,
        fechaDespacho: new Date(o.fecha), origenBodegaId: o.origenAgencia ? null : bodega.id, origenAgenciaId: o.origenAgencia?.id ?? null, destinoAgenciaId: o.destinoAgencia?.id ?? null, destinoPulidorId: o.destinoPulidor ?? null,
        origenUbicacion: o.origenAgencia?.nombre ?? 'Bodega Central', destinoUbicacion: o.destinoAgencia?.nombre ?? `Destino ${n}`,
        detalle: { insumoId: insumoA.id, cantidadEnviada: 5 + n, cantidadRecibida: o.estado === 'RECIBIDO' ? 5 + n : undefined },
      });
      if (o.segundo) await env.prisma.movimientoDetalle.create({ data: { movimientoId: m.id, insumoId: insumoB.id, cantidadEnviada: 2.5, cantidadRecibida: 2 } });
      return m;
    };
    // Archivables.
    await mov({ tipo: 'COMPRA_PROVEEDOR', estado: 'RECIBIDO', fecha: '2019-01-15T15:00:00Z', segundo: true, guia: `${env.marca}-ING-2019-0001` });
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-02-05T15:00:00Z', destinoAgencia: ag1 });
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'RECHAZADO', fecha: '2019-03-10T15:00:00Z', destinoAgencia: ag2 });
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-03-10T16:00:00Z', destinoAgencia: ag1 }); // el mismo día, una hora después
    await mov({ tipo: 'DESPACHO_PULIDOR', estado: 'RECIBIDO', fecha: '2019-05-20T15:00:00Z', destinoPulidor: pulidor.id });
    await mov({ tipo: 'DESPACHO_BODEGA', estado: 'CANCELADO', fecha: '2019-07-07T15:00:00Z' });
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-08-08T15:00:00Z', destinoAgencia: ag2, origenAgencia: ag1 }); // sale de la agencia 1
    await mov({ tipo: 'AJUSTE_MERMA', estado: 'RECIBIDO', fecha: '2019-09-09T15:00:00Z' });
    // Vivos o recientes: se quedan en la base.
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'EN_TRANSITO', fecha: '2019-04-04T15:00:00Z', destinoAgencia: ag1 });
    await mov({ tipo: 'DESPACHO_PULIDOR', estado: 'PENDIENTE', fecha: '2019-06-06T15:00:00Z', destinoPulidor: pulidor.id });
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'RECIBIDO', fecha: '2019-12-12T15:00:00Z', destinoAgencia: ag1 });
    await mov({ tipo: 'DESPACHO_AGENCIA', estado: 'RECHAZADO', fecha: '2020-05-05T15:00:00Z', destinoAgencia: ag2 });

    const todo = { numeroGuia: env.marca };
    const c = (nombre: string, dto: Record<string, unknown>, actor: () => any = () => admin): Caso => ({ nombre, dto, actor });
    casos = [
      c('todo', todo),
      c('por tipo compra', { ...todo, tipo: 'COMPRA_PROVEEDOR' }),
      c('por tipo despacho a agencia', { ...todo, tipo: 'DESPACHO_AGENCIA' }),
      c('por tipo merma', { ...todo, tipo: 'AJUSTE_MERMA' }),
      ...['RECIBIDO', 'RECHAZADO', 'CANCELADO', 'EN_TRANSITO', 'PENDIENTE'].map((estadoDespacho) => c(`estado ${estadoDespacho}`, { ...todo, estadoDespacho })),
      c('tipo y estado', { ...todo, tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'RECIBIDO' }),
      c('guía parcial en minúsculas', { numeroGuia: `${env.marca}-m-0`.toLowerCase() }),
      c('guía de compra', { numeroGuia: `${env.marca}-ING` }),
      c('guía que no existe', { numeroGuia: `${env.marca}-zzz` }),
      c('rango que cruza el límite', { ...todo, fechaDesde: '2019-03-10', fechaHasta: '2020-05-05' }),
      c('rango solo archivado', { ...todo, fechaDesde: '2019-01-01', fechaHasta: '2019-09-30' }),
      c('rango solo reciente', { ...todo, fechaDesde: '2019-11-01' }),
      c('desde un día exacto', { ...todo, fechaDesde: '2019-03-10T15:00:00Z' }),
      c('hasta un día exacto', { ...todo, fechaHasta: '2019-03-10T15:00:00Z' }),
      c('rango de un solo día', { ...todo, fechaDesde: '2019-03-10T00:00:00Z', fechaHasta: '2019-03-10T23:59:59Z' }),
      c('líder de agencia', { ...todo }, () => lider),
      c('líder, solo recibidos', { ...todo, estadoDespacho: 'RECIBIDO' }, () => lider),
      c('supervisor regional', { ...todo }, () => supervisor),
      c('supervisor, un tipo', { ...todo, tipo: 'DESPACHO_AGENCIA' }, () => supervisor),
      c('pulidor (lo suyo)', { ...todo }, () => pulidorActor),
      c('sin usuario no ve nada', { ...todo }, () => undefined),
    ];

    const base = new InventarioService(env.prisma as never);
    for (const caso of casos) antes.set(caso.nombre, await listar(base, caso));
    // Con tope (las N más nuevas): el archivo solo debe aportar sus primeras filas, en el sentido pedido.
    for (const take of [1, 3, 5, 9]) for (const dir of ['desc', 'asc'] as const) antesTope.set(`${dir}-${take}`, await conTope(undefined, take, dir));
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
    expect(datos('todo').length).toBe(12);
    expect(datos('líder de agencia').length).toBeGreaterThan(3);
    expect(datos('supervisor regional').length).toBeGreaterThan(5);
    expect(datos('pulidor (lo suyo)').length).toBeGreaterThan(1);
    expect(datos('sin usuario no ve nada').length).toBe(0);
    expect(datos('todo').some((m: any) => m.detalles.length === 2)).toBe(true);

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
    expect(r.tablas.movimiento_inventario.archivadas).toBe(8);

    volcarAlDisco(almacen, raiz);
    const conArchivo = new InventarioService(env.prisma as never, undefined, new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz)));
    const diferentes: string[] = [];
    for (const caso of casos) {
      const despues = await listar(conArchivo, caso);
      if (despues !== antes.get(caso.nombre)) {
        const a = JSON.parse(antes.get(caso.nombre)!);
        const b = JSON.parse(despues);
        const campos = new Set<string>();
        a.forEach((fila: any, i: number) => { for (const k of new Set([...Object.keys(fila), ...Object.keys(b[i] ?? {})])) if (JSON.stringify(canonico(fila[k])) !== JSON.stringify(canonico(b[i]?.[k]))) campos.add(`${k}: ${JSON.stringify(fila[k])?.slice(0, 120)} → ${JSON.stringify(b[i]?.[k])?.slice(0, 120)}`); });
        diferentes.push(`${caso.nombre}: ${a.length} → ${b.length} filas; ${[...campos].slice(0, 3).join(' | ')}`);
      }
    }
    expect(diferentes).toEqual([]);

    const historico = new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz));
    for (const take of [1, 3, 5, 9]) for (const dir of ['desc', 'asc'] as const) expect(await conTope(historico, take, dir), `tope ${take} ${dir}`).toBe(antesTope.get(`${dir}-${take}`));

    const soloBase = JSON.parse(await listar(new InventarioService(env.prisma as never), casos[0]));
    expect(soloBase.length).toBe(4);
  });
});
