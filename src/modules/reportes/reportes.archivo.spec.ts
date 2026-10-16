import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { LectorDuckDb } from '../archivado/lector-duckdb.js';
import type { ConsultaArchivo } from '../archivado/archivo-lector.js';
import type { AlmacenArchivo } from '../archivado/almacen.js';
import { ReportesArchivoService } from './reportes.archivo.js';
import { ReportesService } from './reportes.service.js';

/** ¿Carga DuckDB en este equipo? Si no (p. ej. Windows con Application Control), la prueba se omite. */
const duckdbDisponible = await import('@duckdb/node-api').then(
  async (d) => {
    try {
      await (await d.DuckDBInstance.create(':memory:')).connect();
      return true;
    } catch {
      return false;
    }
  },
  () => false,
);

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

/**
 * Las pruebas de archivado comparten la tabla `archivado_lotes` y corren en paralelo: aquí podrían aparecer lotes de otra prueba
 * cuyos archivos solo existen en la memoria de ESA prueba. Este lector lee únicamente los archivos que esta prueba escribió en
 * disco. (En producción un lote sin su archivo debe fallar con ruido, y así es.)
 */
class LectorSoloLocal extends LectorDuckDb {
  constructor(private readonly carpeta: string) {
    super(new ConfigService({ ARCHIVO_RAIZ_LOCAL: carpeta }));
  }
  private propias(c: ConsultaArchivo): ConsultaArchivo {
    return { ...c, claves: c.claves.filter((k) => existsSync(join(this.carpeta, k))) };
  }
  override async consultar(c: ConsultaArchivo) {
    const propia = this.propias(c);
    return propia.claves.length ? super.consultar(propia) : [];
  }
  override async contar(c: ConsultaArchivo) {
    const propia = this.propias(c);
    return propia.claves.length ? super.contar(propia) : 0;
  }
}

class AlmacenMemoria implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  async put(clave: string, cuerpo: Buffer) {
    this.objetos.set(clave, Buffer.from(cuerpo));
  }
  async get(clave: string) {
    return this.objetos.get(clave) ?? null;
  }
}

/**
 * La prueba que importa: el mismo reporte, con los mismos filtros, sale IDÉNTICO antes y después de archivar los datos del
 * periodo. Se archiva de verdad (con el archivador y un almacén en memoria), se lee con DuckDB desde disco y se compara.
 */
describe.skipIf(!duckdbDisponible)('reportes con datos archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  let actor: any;
  let agenciaId: string;
  let insumoId: string;
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const periodo = { modo: 'RANGO' as const, desde: '2019-01-01', hasta: '2019-12-31' };
  const corridas: string[] = [];
  const antes = new Map<string, any>();

  const quitarHora = (r: any) => {
    const { generadoEn: _ignorado, ...resto } = r;
    return resto;
  };
  const REPORTES = ['servicios-generales', 'servicios-especiales', 'kardex', 'productividad-agencias'];

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'reportes-archivo-'));
    const admin = await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } });
    actor = await env.actor(admin.id);

    const region = await env.region('rep');
    const agencia = await env.agencia('rep', { regionId: region.id });
    agenciaId = agencia.id;
    const bahia = await env.bahia('rep', agencia.id);
    const catalogo = await env.catalogo('rep');
    const operador = await env.usuario('rep-op', 'LAVADOR');
    const ayudante = await env.usuario('rep-ay', 'LAVADOR');
    const pulidor = await env.usuario('rep-pu', 'PULIDOR');
    insumoId = (await env.insumo('rep')).id;

    const lavado = (estado: any, ingreso: string, extra: Record<string, unknown> = {}) =>
      env.servicioLavado({ bahiaId: bahia.id, operadorId: operador.id, catalogoId: catalogo.id, estado, horaIngreso: new Date(ingreso), horaSalida: new Date(new Date(ingreso).getTime() + 45 * 60000), precio: 12.5, ...extra });
    const s1 = await lavado('APROBADO', '2019-02-10T15:00:00Z', { asignados: [ayudante.id], datos: { aprobadoPor: 'Ana Pérez', observaciones: 'Sin novedades ñ', marca: 'Toyota', color: 'Rojo' } });
    await lavado('CANCELADO', '2019-03-05T15:00:00Z', { precio: 8 });
    await lavado('FINALIZADO', '2019-03-06T15:00:00Z'); // vivo: se queda en la base
    await lavado('APROBADO', '2019-03-07T15:00:00Z', { deletedAt: new Date('2019-03-08T00:00:00Z') }); // anulado: ningún reporte lo muestra
    await env.prisma.consumoServicio.create({ data: { servicioId: s1.id, insumoId, cantidadUsada: '0.2500', agenciaId, insumoNombre: 'X', insumoSKU: 'X', unidadSimbolo: 'L' } });

    const especial = (estado: string, creado: string, programada: string | null, extra: Record<string, unknown> = {}) =>
      env.servicioEspecial({ operadorId: pulidor.id, agenciaId, regionId: region.id, catalogoId: catalogo.id, estado, precio: 80, asignados: [pulidor.id, ayudante.id], datos: { createdAt: new Date(creado), fechaProgramada: programada ? new Date(programada) : null, creadoPorNombre: 'Asesor Uno', tiempoEfectivoSeg: 5400, ...extra } });
    await especial('Completado', '2019-01-05T10:00:00Z', '2019-03-10T15:00:00Z'); // creado en enero, programado para marzo
    await especial('Cancelado', '2019-03-12T15:00:00Z', null);
    await especial('En Proceso', '2019-03-15T15:00:00Z', null); // vivo

    const kardex = (fecha: string, tipo: string, cantidad: string, anterior: string, posterior: string) =>
      env.prisma.kardexMovimiento.create({ data: { insumoId, ubicacionId: agenciaId, tipoMovimiento: tipo, cantidad, stockAnterior: anterior, stockPosterior: posterior, costoTotal: '25.50', usuarioId: operador.id, fecha: new Date(fecha) } });
    await kardex('2019-03-01T15:00:00Z', 'COMPRA_INGRESO', '10.0000', '0.0000', '10.0000');
    await kardex('2019-03-20T15:00:00Z', 'CONSUMO_SERVICIO', '-2.5000', '10.0000', '7.5000');

    // Reportes ANTES de archivar (todo en la base).
    const base = new ReportesService(env.prisma as never);
    for (const reporteId of REPORTES) antes.set(reporteId, quitarHora(await base.generar(dto(reporteId), actor)));
    void s1;
  });

  const dto = (reporteId: string) => ({ reporteId, agenciaIds: [agenciaId], periodo, ...(reporteId === 'kardex' ? { productoId: insumoId } : {}) }) as any;

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.prisma.kardexMovimiento.deleteMany({ where: { insumoId } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('los reportes salen idénticos antes y después de archivar, y sin la capa de archivo faltarían filas', async () => {
    // Las bases de comparación tienen datos: si no, la prueba no probaría nada.
    for (const id of REPORTES) expect(antes.get(id).totalFilas, id).toBeGreaterThan(0);

    // Archiva de verdad, tocando solo las filas de esta prueba.
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => ['servicio_lavado', 'servicio_especial', 'kardex_movimiento'].includes(t.tabla)),
      tablas: ['servicio_lavado', 'servicio_especial', 'kardex_movimiento'],
      filtroExtra: { servicio_lavado: { bahia: { agenciaId } }, servicio_especial: { agenciaId }, kardex_movimiento: { insumoId } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(Object.entries(r.tablas).map(([t, x]) => [t, x.errores]))).toBe('OK');
    expect(r.tablas.servicio_lavado.archivadas).toBe(3); // aprobado, cancelado y el anulado; el FINALIZADO se queda
    expect(r.tablas.servicio_especial.archivadas).toBe(2); // completado y cancelado; el En Proceso se queda
    expect(r.tablas.kardex_movimiento.archivadas).toBe(2);

    // Pone los Parquet en disco y lee con DuckDB, como lo haría el lector de producción.
    for (const [clave, cuerpo] of almacen.objetos) {
      if (!clave.endsWith('.parquet')) continue;
      const ruta = join(raiz, clave);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(ruta, cuerpo);
    }
    const lector = new LectorSoloLocal(raiz);
    const archivo = new ReportesArchivoService(env.prisma as never, new HistoricoService(env.prisma as never, lector));
    const conArchivo = new ReportesService(env.prisma as never, undefined, archivo);
    const sinArchivo = new ReportesService(env.prisma as never);

    for (const reporteId of REPORTES) {
      const despues = quitarHora(await conArchivo.generar(dto(reporteId), actor));
      expect(despues, reporteId).toEqual(antes.get(reporteId));
      // Sin la capa de archivo, lo archivado desaparecería del reporte: eso es lo que esta capa evita.
      const soloBase = await sinArchivo.generar(dto(reporteId), actor);
      expect(soloBase.totalFilas, reporteId).toBeLessThan(antes.get(reporteId).totalFilas);
    }
  });
});
