import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ReportesArchivoService } from './reportes.archivo.js';
import { ReportesService } from './reportes.service.js';
import { REPORTES } from './reportes.definiciones.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const hayDuckdb = await duckdbDisponible;

/**
 * Reportes de consumo de insumos: por agencia y por pulidor, con el mismo filtro de periodo que los demás reportes. Se comprueban las
 * cantidades exactas con datos en la base y, después, que salen IDÉNTICOS cuando los servicios ya están archivados en Parquet.
 */
describe('reportes de consumo de insumos (base real)', () => {
  let env: Entorno;
  let raiz: string;
  let actor: any;
  const ids: Record<string, string> = {};
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const periodo = { modo: 'RANGO' as const, desde: '2019-01-01', hasta: '2019-12-31' };
  const corridas: string[] = [];
  const antes = new Map<string, any>();

  const quitarHora = (r: any) => {
    const { generadoEn: _ignorado, ...resto } = r;
    return resto;
  };
  const dtoAgencias = (reporteId: string, extra: Record<string, unknown> = {}) => ({ reporteId, agenciaIds: [ids.ag1, ids.ag2], periodo, ...extra }) as any;
  const dtoRegion = (reporteId: string) => ({ reporteId, regionId: ids.region, periodo }) as any;
  const CASOS: Array<[string, (r: string) => any]> = [
    ['por agencias elegidas', (r) => dtoAgencias(r)],
    ['por región (con pulidores móviles)', (r) => dtoRegion(r)],
    ['solo marzo', (r) => dtoAgencias(r, { periodo: { modo: 'RANGO', desde: '2019-03-01', hasta: '2019-03-31' } })],
    ['solo abril', (r) => dtoAgencias(r, { periodo: { modo: 'RANGO', desde: '2019-04-01', hasta: '2019-04-30' } })],
    ['solo febrero', (r) => dtoAgencias(r, { periodo: { modo: 'RANGO', desde: '2019-02-01', hasta: '2019-02-28' } })],
  ];
  const REPORTES_CONSUMO = ['consumo-insumos-agencia', 'consumo-insumos-pulidor'];

  /** Aplana un reporte: una fila por línea con el grupo (agencia) y el bloque (mes) al que pertenece. */
  const filas = (r: any) => r.grupos.flatMap((g: any) => g.bloques.flatMap((b: any) => b.filas.map((f: any) => ({ grupo: g.titulo, bloque: b.etiqueta, ...f }))));
  const sumaPor = (lista: any[], clave: (f: any) => string, campo: string) => {
    const m: Record<string, number> = {};
    for (const f of lista) m[clave(f)] = Math.round(((m[clave(f)] ?? 0) + f[campo]) * 10000) / 10000;
    return m;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'consumo-insumos-'));
    actor = await env.actor((await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } })).id);
    const region = await env.region('ci');
    const ag1 = await env.agencia('ci1', { regionId: region.id });
    const ag2 = await env.agencia('ci2', { regionId: region.id });
    const b1 = await env.bahia('ci1', ag1.id);
    const b2 = await env.bahia('ci2', ag2.id);
    const cat = await env.catalogo('ci');
    const catEsp = await env.catalogo('cie', { categoria: 'ESPECIAL' });
    const lavador = await env.usuario('ci-lav', 'LAVADOR', { agenciaId: ag1.id });
    const p1 = await env.usuario('ci-p1', 'PULIDOR', { agenciaId: ag1.id, name: `Ana${env.marca}`, lastname: 'Pulido' });
    const p2 = await env.usuario('ci-p2', 'PULIDOR', { regionId: region.id, name: `Beto${env.marca}`, lastname: 'Movil' });
    const x1 = await env.insumo('ci1');
    const x2 = await env.insumo('ci2');
    Object.assign(ids, { region: region.id, ag1: ag1.id, ag2: ag2.id, x1: x1.id, x2: x2.id, x1sku: x1.codigoSKU, x2sku: x2.codigoSKU, p1: p1.id, p2: p2.id });

    const f = (d: number, h: number, mes: number) => new Date(Date.UTC(2019, mes - 1, d, h));
    const lavado = (estado: any, bahiaId: string, ingreso: Date) =>
      env.servicioLavado({ bahiaId, operadorId: lavador.id, catalogoId: cat.id, estado, horaIngreso: ingreso, horaSalida: new Date(ingreso.getTime() + 3600000), precio: 10, ordenTrabajoOT: `${env.marca}-CI` });
    const linea = (servicioId: string, insumo: { id: string }, agenciaId: string, cantidad: string, creado: Date) =>
      env.prisma.consumoServicio.create({ data: { servicioId, insumoId: insumo.id, agenciaId, cantidadUsada: cantidad, insumoNombre: insumo === x1 ? 'Jabón' : 'Cera', insumoSKU: insumo === x1 ? 'SKU-J' : 'SKU-C', unidadSimbolo: insumo === x1 ? 'ml' : 'u', createdAt: creado } as never });
    const sA1 = await lavado('APROBADO', b1.id, f(10, 15, 2));
    const sA2 = await lavado('APROBADO', b1.id, f(11, 15, 2));
    const sB = await lavado('APROBADO', b2.id, f(5, 15, 3));
    const sV = await lavado('FINALIZADO', b1.id, f(6, 15, 3)); // vivo: se queda en la base
    await linea(sA1.id, x1, ag1.id, '2.5000', f(10, 15, 2));
    await linea(sA1.id, x2, ag1.id, '1.0000', f(10, 16, 2));
    await linea(sA2.id, x1, ag1.id, '1.5000', f(11, 15, 2));
    await linea(sB.id, x1, ag2.id, '4.0000', f(5, 15, 3));
    await linea(sV.id, x1, ag1.id, '3.0000', f(6, 15, 3));
    await linea(sA2.id, x2, ag1.id, '0.5000', f(5, 15, 4)); // línea registrada casi dos meses después de su servicio

    let n = 0;
    const especial = (estado: string, agenciaId: string | null, pulidor: { id: string }, creado: Date) => {
      n++;
      return env.servicioEspecial({ operadorId: pulidor.id, agenciaId, regionId: region.id, catalogoId: catEsp.id, estado, precio: 50, placa: `CI${n}-${env.marca.slice(1, 4).toUpperCase()}`, datos: { createdAt: creado } });
    };
    const lineaEsp = (servicioEspecialId: string, insumo: { id: string }, pulidorId: string, cantidad: string, creado: Date) =>
      env.prisma.consumoServicioEspecial.create({ data: { servicioEspecialId, insumoId: insumo.id, pulidorId, cantidadUsada: cantidad, insumoNombre: insumo === x1 ? 'Jabón' : 'Cera', insumoSKU: insumo === x1 ? 'SKU-J' : 'SKU-C', unidadSimbolo: insumo === x1 ? 'ml' : 'u', createdAt: creado } as never });
    const eA = await especial('Completado', ag1.id, p1, f(10, 15, 3));
    const eA2 = await especial('Completado', ag1.id, p1, f(12, 15, 3));
    const eM = await especial('Completado', null, p2, f(15, 15, 3)); // pulidor móvil: sin agencia
    const eB = await especial('Completado', ag2.id, p2, f(20, 15, 3));
    const eP = await especial('Pendiente', ag1.id, p1, f(25, 15, 3)); // vivo: se queda en la base
    await lineaEsp(eA.id, x1, p1.id, '0.5000', f(10, 16, 3));
    await lineaEsp(eA.id, x2, p1.id, '2.0000', f(10, 16, 3));
    await lineaEsp(eA2.id, x1, p1.id, '0.2500', f(12, 16, 3));
    await lineaEsp(eM.id, x2, p2.id, '7.0000', f(15, 16, 3));
    await lineaEsp(eB.id, x1, p2.id, '1.0000', f(20, 16, 3));
    await lineaEsp(eP.id, x1, p1.id, '9.0000', f(25, 16, 3));

    const base = new ReportesService(env.prisma as never);
    for (const r of REPORTES_CONSUMO) for (const [nombre, dto] of CASOS) antes.set(`${r}|${nombre}`, quitarHora(await base.generar(dto(r), actor)));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('los dos reportes están en la sección de insumos y exigen su permiso', () => {
    for (const id of REPORTES_CONSUMO) {
      const def = REPORTES.find((r) => r.id === id)!;
      expect(def.modulo).toBe('Gestión de insumos');
      expect(def.permisos).toContain('inventario.ver');
      expect(def.periodo).toBe(true);
    }
  });

  it('por agencia: cuánto se usó de cada producto, separando servicios generales y especiales', async () => {
    const r = antes.get('consumo-insumos-agencia|por agencias elegidas');
    const lista = filas(r);
    const t = (grupoParte: string, sku: string, campo: string) => lista.filter((f: any) => f.grupo.includes(grupoParte) && f.sku === sku).reduce((a: number, f: any) => a + f[campo], 0);
    // Agencia 1: jabón 2,5 + 1,5 + 3 (servicio vivo) en generales y 0,5 + 0,25 + 9 (pendiente) en especiales; cera 1 y 2.
    expect(t('Agencia ci1', 'SKU-J', 'generales')).toBe(7);
    expect(t('Agencia ci1', 'SKU-J', 'especiales')).toBe(9.75);
    expect(t('Agencia ci1', 'SKU-J', 'total')).toBe(16.75);
    expect(t('Agencia ci1', 'SKU-C', 'generales')).toBe(1.5);
    expect(t('Agencia ci1', 'SKU-C', 'especiales')).toBe(2);
    // Agencia 2: jabón 4 en generales y 1 en especiales.
    expect(t('Agencia ci2', 'SKU-J', 'generales')).toBe(4);
    expect(t('Agencia ci2', 'SKU-J', 'especiales')).toBe(1);
    // Con una fila por mes: febrero tiene lo de los servicios del 10 y 11.
    expect(sumaPor(lista.filter((f: any) => f.grupo.includes('Agencia ci1') && f.sku === 'SKU-J'), (f) => f.bloque, 'generales')).toEqual(expect.objectContaining({}));
    expect(lista.filter((f: any) => f.grupo.includes('Agencia ci1') && f.sku === 'SKU-J' && /febrero/i.test(f.bloque)).reduce((a: number, f: any) => a + f.generales, 0)).toBe(4);
    // Cada fila lleva el nombre, el SKU y la unidad del momento del consumo.
    expect(lista.find((f: any) => f.sku === 'SKU-J')).toMatchObject({ insumo: 'Jabón', unidad: 'ml' });
    expect(r.columnas.map((c: any) => c.clave)).toEqual(['ord', 'sku', 'insumo', 'unidad', 'generales', 'especiales', 'total', 'servicios']);
  });

  it('por pulidor: qué usó cada uno, con los móviles aparte cuando se pide por región', async () => {
    const porAgencias = filas(antes.get('consumo-insumos-pulidor|por agencias elegidas'));
    const ana = porAgencias.filter((f: any) => f.pulidor.includes('Ana'));
    expect(sumaPor(ana, (f) => f.sku, 'cantidad')).toEqual({ 'SKU-J': 9.75, 'SKU-C': 2 });
    // Con agencias elegidas solo salen los servicios de esas agencias: el móvil sin agencia no aparece, pero sí lo que hizo en la agencia 2.
    expect(porAgencias.some((f: any) => f.grupo.includes('móviles'))).toBe(false);
    const betoEnAgencia2 = porAgencias.filter((f: any) => f.pulidor.includes('Beto') && f.grupo.includes('Agencia ci2'));
    expect(sumaPor(betoEnAgencia2, (f) => f.sku, 'cantidad')).toEqual({ 'SKU-J': 1 });

    const porRegion = filas(antes.get('consumo-insumos-pulidor|por región (con pulidores móviles)'));
    const moviles = porRegion.filter((f: any) => f.grupo.includes('móviles'));
    expect(sumaPor(moviles, (f) => f.pulidor.replace(env.marca, ''), 'cantidad')).toEqual({ 'Beto Movil': 7 });
    expect(moviles[0]).toMatchObject({ sku: 'SKU-C', insumo: 'Cera', unidad: 'u', servicios: 1 });
  });

  it('el filtro de fechas deja solo lo del periodo, y fuera del periodo no sale nada', async () => {
    const marzo = filas(antes.get('consumo-insumos-agencia|solo marzo'));
    const febrero = filas(antes.get('consumo-insumos-agencia|solo febrero'));
    expect(sumaPor(febrero.filter((f: any) => f.grupo.includes('Agencia ci1')), (f) => f.sku, 'total')).toEqual({ 'SKU-J': 4, 'SKU-C': 1 });
    expect(febrero.some((f: any) => f.grupo.includes('Agencia ci2'))).toBe(false);
    expect(sumaPor(marzo.filter((f: any) => f.grupo.includes('Agencia ci2')), (f) => f.sku, 'total')).toEqual({ 'SKU-J': 5 });
    // La línea de abril se cuenta en abril aunque su servicio sea de febrero.
    expect(sumaPor(filas(antes.get('consumo-insumos-agencia|solo abril')), (f) => f.sku, 'generales')).toEqual({ 'SKU-C': 0.5 });
    const nada = await new ReportesService(env.prisma as never).generar(dtoAgencias('consumo-insumos-agencia', { periodo: { modo: 'RANGO', desde: '2020-01-01', hasta: '2020-01-31' } }), actor);
    expect(nada.totalFilas).toBe(0);
  });

  it.skipIf(!hayDuckdb)('salen idénticos cuando los servicios ya están archivados en Parquet', async () => {
    for (const [clave, r] of antes) expect(r.totalFilas, clave).toBeGreaterThan(-1);
    expect(antes.get('consumo-insumos-agencia|por agencias elegidas').totalFilas).toBeGreaterThanOrEqual(5);

    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => ['servicio_lavado', 'servicio_especial'].includes(t.tabla)),
      tablas: ['servicio_lavado', 'servicio_especial'],
      filtroExtra: { servicio_lavado: { bahia: { agenciaId: { in: [ids.ag1, ids.ag2] } } }, servicio_especial: { regionId: ids.region } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.servicio_lavado.archivadas).toBe(3); // los aprobados; el FINALIZADO se queda
    expect(r.tablas.servicio_especial.archivadas).toBe(4); // los completados; el pendiente se queda

    volcarAlDisco(almacen, raiz);
    const archivo = new ReportesArchivoService(env.prisma as never, new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz)));
    const conArchivo = new ReportesService(env.prisma as never, undefined, archivo);
    const sinArchivo = new ReportesService(env.prisma as never);
    const diferentes: string[] = [];
    for (const rep of REPORTES_CONSUMO) {
      for (const [nombre, dto] of CASOS) {
        const clave = `${rep}|${nombre}`;
        const despues = quitarHora(await conArchivo.generar(dto(rep), actor));
        if (JSON.stringify(despues) !== JSON.stringify(antes.get(clave))) diferentes.push(clave);
      }
    }
    expect(diferentes).toEqual([]);
    // Sin la capa de archivo, lo archivado desaparecería del reporte.
    const soloBase = await sinArchivo.generar(dtoAgencias('consumo-insumos-agencia'), actor);
    expect(soloBase.totalFilas).toBeLessThan(antes.get('consumo-insumos-agencia|por agencias elegidas').totalFilas);
  });
});
