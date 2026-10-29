import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { AnalyticsService } from './analytics.service.js';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

/**
 * Los paneles de análisis (todos los roles y módulos) de un periodo viejo deben dar EXACTAMENTE lo mismo cuando sus servicios,
 * consumos y despachos ya están archivados en Parquet que cuando estaban en la base. Se archiva de verdad y se lee con DuckDB.
 *
 * Los datos son de diciembre de 2018 a enero de 2019 y las consultas se acotan a agencias y regiones creadas aquí.
 */
describe.skipIf(!(await duckdbDisponible))('paneles de análisis con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const corridas: string[] = [];
  type Caso = { nombre: string; ejecutar: (s: AnalyticsService) => Promise<unknown> };
  let casos: Caso[] = [];
  const antes = new Map<string, string>();
  const ids: Record<string, string> = {};

  // Ni las claves de un objeto ni el orden entre los elementos de un arreglo de objetos se comparan: los paneles agrupan filas que la
  // base entrega sin orden definido, y los empates de sus rankings salen en el orden en que llegaron. Lo que se compara es el
  // CONTENIDO exacto: qué elementos hay y con qué valores.
  const canonico = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(canonico);
      return items.some((x) => x && typeof x === 'object') ? items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : items;
    }
    return v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v;
  };
  // Del dashboard principal, el inventario total y lo que va en tránsito son de TODO el sistema (sin filtro de alcance): otras pruebas
  // que corren en paralelo crean y borran existencias, así que esos dos números no se comparan. Nada de ello pasa por el archivo.
  const sinGlobales = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sinGlobales);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).filter(([k]) => k !== 'unidadesInventario' && k !== 'unidadesEnTransito').map(([k, x]) => [k, sinGlobales(x)]));
    return v;
  };
  const texto = async (caso: Caso, s: AnalyticsService) => {
    const salida = JSON.parse(JSON.stringify(await caso.ejecutar(s)));
    return JSON.stringify(canonico(caso.nombre.startsWith('dashboard') ? sinGlobales(salida) : salida));
  };
  const f = (d: number, h = 0, mi = 0, mes = 1, anio = 2019) => new Date(anio, mes - 1, d, h, mi);

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'analytics-archivo-'));
    const r1 = await env.region('an1');
    const r2 = await env.region('an2');
    const a1 = await env.agencia('an1', { regionId: r1.id });
    const a2 = await env.agencia('an2', { regionId: r1.id });
    const a3 = await env.agencia('an3', { regionId: r2.id });
    const b1 = await env.bahia('an1', a1.id);
    const b2 = await env.bahia('an2', a1.id);
    const b3 = await env.bahia('an3', a2.id);
    const b4 = await env.bahia('an4', a3.id);
    const gen = await env.catalogo('ang', { categoria: 'GENERAL', precio: 30 });
    const esp = await env.catalogo('ane', { categoria: 'ESPECIAL', precio: 50 });
    await env.prisma.catalogoServicio.updateMany({ where: { id: { in: [gen.id, esp.id] } }, data: { tiempoEstimadoMin: 30 } });
    const p1 = await env.usuario('an-p1', 'PULIDOR', { agenciaId: a1.id, regionId: r1.id, name: `Pia${env.marca}` });
    const p2 = await env.usuario('an-p2', 'PULIDOR', { regionId: r1.id, name: `Pedro${env.marca}` }); // móvil
    const l1 = await env.usuario('an-l1', 'LAVADOR', { agenciaId: a1.id, regionId: r1.id, name: `Luz${env.marca}` });
    const l2 = await env.usuario('an-l2', 'LAVADOR', { agenciaId: a2.id, regionId: r1.id, name: `Leo${env.marca}` });
    const l3 = await env.usuario('an-l3', 'LAVADOR', { agenciaId: a3.id, regionId: r2.id, name: `Lia${env.marca}` });
    Object.assign(ids, { r1: r1.id, r2: r2.id, a1: a1.id, a2: a2.id, a3: a3.id, p1: p1.id, p2: p2.id });

    const x1 = await env.insumo('an1');
    const x2 = await env.insumo('an2');
    await env.prisma.insumo.update({ where: { id: x1.id }, data: { costoUnitarioUSD: 12.5, categoria: 'Químicos' } as never });
    await env.prisma.insumo.update({ where: { id: x2.id }, data: { costoUnitarioUSD: 3.25, categoria: 'Ceras' } as never });

    type Op = { id: string };
    const lavado = async (estado: 'APROBADO' | 'FINALIZADO' | 'RECHAZADO' | 'CANCELADO' | 'EN_PROCESO', bahia: Op, op: Op, cat: Op & { id: number | string }, precio: number, ingreso: Date, salida: Date | null, extra: Record<string, unknown> = {}) =>
      env.servicioLavado({ bahiaId: bahia.id, operadorId: op.id, catalogoId: cat.id as number, estado, precio, horaIngreso: ingreso, horaSalida: salida, ordenTrabajoOT: `${env.marca}-AN`, datos: { createdAt: ingreso, ...extra } });
    const consumo = (servicioId: string, insumo: Op, agenciaId: string, cantidad: number, creado: Date) =>
      env.prisma.consumoServicio.create({ data: { servicioId, insumoId: insumo.id, agenciaId, cantidadUsada: cantidad, insumoNombre: 'x', insumoSKU: 'x', unidadSimbolo: 'ml', createdAt: creado } as never });

    const sA = await lavado('APROBADO', b1, p1, gen, 30, f(7, 10), f(7, 10, 40), { marca: 'Toyota', modelo: 'Corolla', color: 'Rojo', horaInicio: f(7, 10) });
    const sB = await lavado('APROBADO', b1, p1, esp, 50, f(8, 15), f(8, 16, 30), { marca: 'Toyota', modelo: 'Hilux', color: 'Rojo', horaInicio: f(8, 15) });
    const sC = await lavado('APROBADO', b1, l1, gen, 20, f(8, 11), f(8, 11, 20), { marca: 'Kia', modelo: 'Rio', color: 'Azul' });
    const sD = await lavado('FINALIZADO', b3, l2, gen, 40, f(9, 9), f(9, 9, 30), { marca: 'Chevrolet', modelo: 'Spark', color: 'Blanco' }); // vivo
    await lavado('RECHAZADO', b1, l1, gen, 15, f(10, 9), f(10, 9, 30));
    await lavado('CANCELADO', b1, l1, gen, 10, f(11, 12), null, { anuladoEn: f(11, 12, 7) });
    const sG = await lavado('APROBADO', b1, p1, gen, 80, f(15, 10, 0, 12, 2018), f(15, 11, 0, 12, 2018), { marca: 'Mazda', modelo: '3', color: 'Gris' });
    const sH = await lavado('APROBADO', b4, l3, gen, 60, f(9, 14), f(9, 15), { marca: 'Kia', modelo: 'Rio', color: 'Negro' });
    const sI = await lavado('APROBADO', b1, l1, gen, 25, f(20, 10), f(20, 10, 50), { marca: 'Toyota', modelo: 'Corolla', color: 'Rojo' });
    await lavado('EN_PROCESO', b1, l1, gen, 10, f(9, 9), null); // vivo
    await lavado('CANCELADO', b1, l1, gen, 12, f(20, 9, 0, 11, 2018), null, { anuladoEn: f(11, 12, 30), createdAt: f(20, 9, 0, 11, 2018) }); // ingresó en noviembre, se anuló en enero
    await consumo(sA.id, x1, a1.id, 2, f(7, 10, 30));
    await consumo(sA.id, x2, a1.id, 1.5, f(7, 10, 31));
    await consumo(sB.id, x1, a1.id, 1, f(8, 15, 40));
    await consumo(sC.id, x2, a1.id, 0.75, f(8, 11, 10));
    await consumo(sD.id, x2, a2.id, 5, f(9, 9, 10)); // de un servicio vivo
    await consumo(sG.id, x1, a1.id, 3, f(15, 10, 30, 12, 2018));
    await consumo(sH.id, x1, a3.id, 4, f(9, 14, 30));
    await consumo(sI.id, x1, a1.id, 2.5, f(20, 10, 30));
    await consumo(sC.id, x1, a1.id, 1.25, f(20, 11, 0, 2, 2019)); // línea creada 43 días después de su servicio
    // Solicitud de descuento sobre un servicio que se archivará: el panel del aprobador mira su precio base.
    await env.prisma.solicitudAprobacion.create({ data: { tipo: 'DESCUENTO', titulo: 'Descuento', estado: 'PENDIENTE', montoUSD: 6, entidadRefId: sA.id, solicitanteId: l1.id, agenciaId: a1.id, createdAt: f(8, 9) } as never });
    await env.prisma.solicitudAprobacion.create({ data: { tipo: 'DESCUENTO', titulo: 'Descuento', estado: 'APROBADO', montoUSD: 50, entidadRefId: sB.id, solicitanteId: l1.id, agenciaId: a1.id, createdAt: f(9, 9) } as never });

    let n = 0;
    const especial = (estado: string, creado: Date, agenciaId: string | null, regionId: string, op: Op, o: { precio?: number; tipo?: string; efectivo?: number | null; calidad?: number | null; prioridad?: string } = {}) => {
      n++;
      return env.servicioEspecial({ operadorId: op.id, agenciaId, regionId, catalogoId: esp.id as number, estado, precio: o.precio ?? 50, placa: `AN${n}-${env.marca.slice(1, 4).toUpperCase()}`, tipoServicio: o.tipo ?? 'Pulido', datos: { createdAt: creado, tiempoEfectivoSeg: o.efectivo === undefined ? 3600 : o.efectivo, calificacionCalidad: o.calidad === undefined ? 4 : o.calidad, prioridad: o.prioridad ?? 'NORMAL' } });
    };
    await especial('Completado', f(8, 14), a1.id, r1.id, p1, { precio: 70, calidad: 5, efectivo: 5400 });
    await especial('Cancelado', f(9, 14), a1.id, r1.id, p1, { precio: 20, efectivo: null, calidad: null });
    await especial('Pendiente', f(10, 14), a1.id, r1.id, p1, { precio: 15, efectivo: null, calidad: null, prioridad: 'ALTA' }); // vivo
    await especial('Completado', f(12, 14), null, r1.id, p2, { precio: 90, tipo: 'Micro Pulido', calidad: 3 }); // móvil: sin agencia
    await especial('Completado', f(20, 14), a2.id, r1.id, p2, { precio: 45, tipo: 'Lavado de motor' });
    await especial('Completado', f(9, 14), a3.id, r2.id, p2, { precio: 55 });
    n++;
    await env.servicioEspecial({ operadorId: p1.id, agenciaId: a1.id, regionId: r1.id, catalogoId: esp.id as number, estado: 'Completado', precio: 33, placa: `ANP-${env.marca.slice(1, 4).toUpperCase()}`, tipoServicio: 'Pulido', datos: { createdAt: f(5, 14), fechaProgramada: f(20, 14, 0, 3, 2019), tiempoEfectivoSeg: 1800, calificacionCalidad: 4, prioridad: 'NORMAL' } }); // creado en enero, programado para marzo

    const despacho = async (estado: 'RECIBIDO' | 'CANCELADO' | 'EN_TRANSITO', destino: { id: string; nombre: string }, insumo: Op, cantidad: number, fecha: Date) => {
      const m = await env.movimiento({ usuarioDespachaId: p1.id, tipo: 'DESPACHO_AGENCIA', estadoDespacho: estado, destinoAgenciaId: destino.id, destinoUbicacion: destino.nombre, fechaDespacho: fecha, detalle: { insumoId: insumo.id, cantidadEnviada: cantidad, cantidadRecibida: estado === 'RECIBIDO' ? cantidad : undefined } });
      await env.prisma.movimientoInventario.update({ where: { id: m.id }, data: { createdAt: fecha } });
      return m;
    };
    await despacho('RECIBIDO', a1, x1, 10, f(8, 9));
    await despacho('RECIBIDO', a1, x2, 6, f(9, 9));
    await despacho('CANCELADO', a2, x1, 3, f(9, 10));
    await despacho('RECIBIDO', a3, x1, 8, f(10, 9));
    const tardio = await despacho('RECIBIDO', a1, x2, 4, f(9, 12));
    await env.prisma.movimientoInventario.update({ where: { id: tardio.id }, data: { createdAt: f(19, 12) } }); // se registró 10 días después de despacharse
    await despacho('EN_TRANSITO', a1, x2, 2, f(10, 11)); // vivo

    // Actores de cada rol/módulo.
    const rol = async (sufijo: string, namerol: string, opts: Record<string, unknown> = {}) => env.actor((await env.usuario(sufijo, namerol, opts as never)).id);
    const actores = {
      admin: await rol('an-admin', 'ADMIN'),
      superadmin: await rol('an-super', 'SUPER_ADMIN'),
      lider: await rol('an-lider', 'LIDER', { agenciaId: a1.id }),
      supervisor: await rol('an-sup', 'SUPERVISOR', { regionId: r1.id }),
      aprobador: await rol('an-apr', 'APROBADOR', { agenciaId: a1.id }),
      comercial: await rol('an-com', 'COORD_COMERCIAL', { regionId: r1.id }),
      jefeComercial: await rol('an-jcom', 'JEFE_COMERCIAL', {}),
      coordBodega: await rol('an-cb', 'COORD_BODEGA', {}),
      asistenteBodega: await rol('an-ab', 'ASISTENTE_BODEGA', { regionId: r1.id }),
      coordEspeciales: await rol('an-ce', 'COORD_SERVICIOS_ESPECIALES', { regionId: r1.id }),
    };

    const ENE_5_11 = { rango: 'RANGO', fechaDesde: '2019-01-05', fechaHasta: '2019-01-11' } as any;
    const ENERO = { rango: 'RANGO', fechaDesde: '2019-01-01', fechaHasta: '2019-01-31' } as any;
    const DIC_ENE = { rango: 'RANGO', fechaDesde: '2018-12-01', fechaHasta: '2019-01-31' } as any;
    const DIA = { rango: 'RANGO', fechaDesde: '2019-01-08', fechaHasta: '2019-01-08' } as any;
    const FEBRERO = { rango: 'RANGO', fechaDesde: '2019-02-01', fechaHasta: '2019-02-28' } as any;
    const TARDE = { rango: 'RANGO', fechaDesde: '2019-01-15', fechaHasta: '2019-01-25' } as any;
    const SOLO_RECIENTE = { rango: 'RANGO', fechaDesde: '2020-01-01', fechaHasta: '2020-01-31' } as any;
    const periodos: Record<string, any> = { 'semana': ENE_5_11, 'enero': ENERO, 'diciembre y enero': DIC_ENE, 'un día': DIA, 'febrero': FEBRERO, 'del 15 al 25': TARDE, 'sin datos': SOLO_RECIENTE };
    const alcances: Record<string, any> = { 'agencia 1': { agenciaId: a1.id }, 'agencia 2': { agenciaId: a2.id }, 'región 1': { regionId: r1.id }, 'región 2': { regionId: r2.id } };

    const caso = (nombre: string, ejecutar: Caso['ejecutar']) => casos.push({ nombre, ejecutar });
    // Dashboard principal: todos los roles, periodos y alcances.
    for (const [rolNombre, actor] of Object.entries(actores)) {
      for (const [pNombre, p] of Object.entries(periodos)) {
        const alcance = ['lider', 'aprobador'].includes(rolNombre) ? {} : rolNombre === 'supervisor' || rolNombre === 'comercial' || rolNombre === 'asistenteBodega' ? { regionId: r1.id } : { regionId: r1.id };
        caso(`dashboard ${rolNombre} · ${pNombre}`, (s) => s.getDashboardMetrics({ ...p, ...alcance }, actor));
      }
    }
    for (const [aNombre, a] of Object.entries(alcances)) {
      caso(`dashboard admin · ${aNombre} · enero`, (s) => s.getDashboardMetrics({ ...ENERO, ...a }, actores.admin));
      caso(`dashboard admin · ${aNombre} · diciembre y enero`, (s) => s.getDashboardMetrics({ ...DIC_ENE, ...a }, actores.superadmin));
    }
    for (const desglose of ['REGION', 'AGENCY', 'POLISHER'] as const) caso(`dashboard admin · desglose ${desglose}`, (s) => s.getDashboardMetrics({ ...DIC_ENE, regionId: r1.id, desglose }, actores.admin));
    caso('dashboard admin · pulidor', (s) => s.getDashboardMetrics({ ...DIC_ENE, regionId: r1.id, pulidorId: p1.id }, actores.admin));
    caso('dashboard admin · pulidor móvil', (s) => s.getDashboardMetrics({ ...DIC_ENE, regionId: r1.id, pulidorId: p2.id }, actores.admin));
    caso('dashboard admin · solo generales', (s) => s.getDashboardMetrics({ ...DIC_ENE, regionId: r1.id, categoriaServicio: 'GENERAL' }, actores.admin));
    caso('dashboard admin · solo especiales', (s) => s.getDashboardMetrics({ ...DIC_ENE, regionId: r1.id, categoriaServicio: 'ESPECIAL' }, actores.admin));
    caso('dashboard supervisor · especiales', (s) => s.getDashboardMetrics({ ...ENERO, categoriaServicio: 'ESPECIAL' }, actores.supervisor));
    caso('dashboard comercial · generales', (s) => s.getDashboardMetrics({ ...ENERO, categoriaServicio: 'GENERAL' }, actores.comercial));
    caso('dashboard aprobador · pulidor', (s) => s.getDashboardMetrics({ ...ENERO, pulidorId: l1.id }, actores.aprobador));

    // Consumo de químicos, rankings y paneles dedicados.
    for (const [pNombre, p] of Object.entries(periodos)) {
      for (const [aNombre, a] of Object.entries({ 'agencia 1': alcances['agencia 1'], 'región 1': alcances['región 1'], 'región 2': alcances['región 2'] })) {
        caso(`consumo de químicos · ${pNombre} · ${aNombre}`, (s) => s.getConsumoQuimicos({ ...p, ...a } as never, actores.admin));
        caso(`ranking lavadores · ${pNombre} · ${aNombre}`, (s) => s.getRankingLavadores({ ...p, ...a } as never, actores.admin));
        caso(`ranking pulidores · ${pNombre} · ${aNombre}`, (s) => s.getRankingPulidores({ ...p, ...a } as never, actores.admin));
        caso(`taller · ${pNombre} · ${aNombre}`, (s) => s.getDashboardTaller({ ...p, ...a } as never, actores.admin));
        caso(`bodega · ${pNombre} · ${aNombre}`, (s) => s.getDashboardBodega({ ...p, ...a } as never, actores.coordBodega));
        caso(`especiales · ${pNombre} · ${aNombre}`, (s) => s.getDashboardEspeciales({ ...p, ...a } as never, actores.coordEspeciales));
      }
    }
    caso('ranking lavadores · generales', (s) => s.getRankingLavadores({ ...DIC_ENE, regionId: r1.id, categoriaServicio: 'GENERAL' } as never, actores.admin));
    caso('ranking lavadores · lider', (s) => s.getRankingLavadores({ ...DIC_ENE } as never, actores.lider));
    caso('ranking pulidores · supervisor', (s) => s.getRankingPulidores({ ...DIC_ENE } as never, actores.supervisor));
    caso('consumo de químicos · supervisor', (s) => s.getConsumoQuimicos({ ...DIC_ENE } as never, actores.supervisor));
    caso('consumo de químicos · lider', (s) => s.getConsumoQuimicos({ ...DIC_ENE } as never, actores.lider));
    caso('bodega · asistente de región', (s) => s.getDashboardBodega({ ...DIC_ENE } as never, actores.asistenteBodega));
    caso('bodega · pulidor', (s) => s.getDashboardBodega({ ...DIC_ENE, regionId: r1.id, pulidorId: p1.id } as never, actores.coordBodega));
    caso('especiales · pulidor', (s) => s.getDashboardEspeciales({ ...DIC_ENE, regionId: r1.id, pulidorId: p2.id } as never, actores.coordEspeciales));
    caso('especiales · solo especiales', (s) => s.getDashboardEspeciales({ ...DIC_ENE, regionId: r1.id, categoriaServicio: 'ESPECIAL' } as never, actores.coordEspeciales));
    caso('especiales · solo generales', (s) => s.getDashboardEspeciales({ ...DIC_ENE, regionId: r1.id, categoriaServicio: 'GENERAL' } as never, actores.coordEspeciales));
    caso('taller · pulidor', (s) => s.getDashboardTaller({ ...DIC_ENE, regionId: r1.id, pulidorId: p1.id } as never, actores.admin));

    // La fachada directamente: bordes de fechas y agregados que los paneles solo usan con "ahora" como referencia.
    const fed = (s: AnalyticsService) => (s as any).federados;
    const agencias = { in: [a1.id, a2.id, a3.id] };
    caso('fachada · consumo por insumo', (s) => fed(s).consumoPorInsumo({ by: ['insumoId'], where: { createdAt: { gte: f(1, 0, 0, 12, 2018), lte: f(28, 23, 59, 2, 2019) }, agenciaId: agencias }, _sum: { cantidadUsada: true } }));
    caso('fachada · consumo por insumo, solo archivo', (s) => fed(s).consumoPorInsumo({ by: ['insumoId'], where: { createdAt: { gte: f(1, 0, 0, 2, 2019), lte: f(28, 23, 59, 2, 2019) }, agenciaId: agencias }, _sum: { cantidadUsada: true } }));
    caso('fachada · borde superior inclusivo', (s) => fed(s).findMany('servicioLavado', { where: { horaIngreso: { gte: f(7, 10), lte: f(7, 10) }, bahia: { agencia: { id: a1.id } } }, select: { precio: true, horaIngreso: true } }));
    caso('fachada · borde inferior inclusivo', (s) => fed(s).count('servicioLavado', { where: { horaIngreso: { gte: f(7, 10), lte: f(7, 10, 0, 1, 2019) }, bahia: { agencia: { id: a1.id } } } }));
    caso('fachada · borde superior de movimientos', (s) => fed(s).findMany('movimientoInventario', { where: { createdAt: { gte: f(19, 12), lte: f(19, 12) }, destinoAgenciaId: a1.id }, select: { tipo: true, estadoDespacho: true, createdAt: true } }));
    caso('fachada · suma de precios', (s) => fed(s).aggregate('servicioLavado', { _sum: { precio: true }, where: { horaIngreso: { gte: f(1, 0, 0, 12, 2018), lte: f(31, 23, 59) }, bahia: { agencia: { regionId: r1.id } }, estado: { in: ['FINALIZADO', 'APROBADO'] } } }));

    const base = new AnalyticsService(env.prisma as never);
    for (const c of casos) antes.set(c.nombre, await texto(c, base));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('cada panel da exactamente lo mismo antes y después de archivar', async () => {
    // La comparación tiene datos: si no, no probaría nada.
    const dato = (nombre: string) => JSON.parse(antes.get(nombre)!);
    expect(JSON.stringify(dato('dashboard admin · región 1 · diciembre y enero')).length).toBeGreaterThan(2000);
    expect(JSON.stringify(dato('consumo de químicos · diciembre y enero · región 1')).length).toBeGreaterThan(300);
    expect(JSON.stringify(dato('ranking pulidores · diciembre y enero · región 1')).length).toBeGreaterThan(200);
    expect(JSON.stringify(dato('especiales · diciembre y enero · región 1')).length).toBeGreaterThan(500);
    expect(JSON.stringify(dato('bodega · diciembre y enero · región 1')).length).toBeGreaterThan(500);

    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => ['servicio_lavado', 'servicio_especial', 'movimiento_inventario'].includes(t.tabla)),
      tablas: ['servicio_lavado', 'servicio_especial', 'movimiento_inventario'],
      filtroExtra: {
        servicio_lavado: { ordenTrabajoOT: { contains: env.marca } },
        servicio_especial: { codigoSE: { contains: env.marca } },
        movimiento_inventario: { numeroGuia: { contains: env.marca } },
      },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.servicio_lavado.archivadas).toBe(9); // APROBADO, RECHAZADO y CANCELADO; quedan FINALIZADO y EN_PROCESO
    expect(r.tablas.servicio_especial.archivadas).toBe(6);
    expect(r.tablas.movimiento_inventario.archivadas).toBe(5);

    volcarAlDisco(almacen, raiz);
    const conArchivo = new AnalyticsService(env.prisma as never, new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz)));

    const diferentes: string[] = [];
    for (const c of casos) {
      const despues = await texto(c, conArchivo);
      if (despues !== antes.get(c.nombre)) {
        const a = antes.get(c.nombre)!;
        let i = 0;
        while (i < a.length && a[i] === despues[i]) i++;
        diferentes.push(`${c.nombre}: …${a.slice(Math.max(0, i - 60), i + 80)} → …${despues.slice(Math.max(0, i - 60), i + 80)}`);
      }
    }
    expect(diferentes).toEqual([]);

    // Sin la capa de archivo, lo archivado desaparecería de los paneles.
    const soloBase = await texto(casos.find((c) => c.nombre === 'dashboard admin · región 1 · diciembre y enero')!, new AnalyticsService(env.prisma as never));
    expect(soloBase).not.toBe(antes.get('dashboard admin · región 1 · diciembre y enero'));
  });
});
