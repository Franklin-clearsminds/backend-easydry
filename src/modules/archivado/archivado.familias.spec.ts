import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { ArchivadoService, type ResultadoCorrida } from './archivado.service.js';
import { TABLAS_OPERACION, type TablaArchivable } from './archivado.tablas.js';
import type { AlmacenArchivo } from './almacen.js';
import { leerIds } from './parquet.js';
import { parquetReadObjects } from 'hyparquet';

/** Almacén en memoria con ganchos para provocar fallos y para colar filas en medio de un lote. */
class AlmacenMemoria implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  fallarPut: number | null = null;
  alSubir: ((clave: string) => Promise<void>) | null = null;
  private puts = 0;

  async put(clave: string, cuerpo: Buffer) {
    this.puts++;
    if (this.fallarPut === this.puts) throw new Error('S3 caído (simulado)');
    this.objetos.set(clave, Buffer.from(cuerpo));
    if (clave.endsWith('.parquet')) await this.alSubir?.(clave);
  }
  async get(clave: string) {
    return this.objetos.get(clave) ?? null;
  }
  parquets() {
    return [...this.objetos.keys()].filter((k) => k.endsWith('.parquet')).sort();
  }
}

const KARDEX = TABLAS_OPERACION.find((t) => t.tabla === 'kardex_movimiento')!;

/** La configuración REAL de la familia de movimientos (con su regla de "vivo"). */
const MOVIMIENTO = TABLAS_OPERACION.find((t) => t.tabla === 'movimiento_inventario')!;

const SERVICIO = TABLAS_OPERACION.find((t) => t.tabla === 'servicio_lavado')!;

const ESPECIAL = TABLAS_OPERACION.find((t) => t.tabla === 'servicio_especial')!;

describe('archivado de familias y kardex (base real, almacén en memoria)', () => {
  let env: Entorno;
  let usuarioId: string;
  let insumoId: string;
  const AHORA = new Date('2026-10-15T12:00:00Z');
  const corridas: string[] = [];

  beforeAll(async () => {
    env = await abrirEntorno();
    usuarioId = (await env.usuario('fam', 'LAVADOR')).id;
    insumoId = (await env.insumo('fam')).id;
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.prisma.kardexMovimiento.deleteMany({ where: { insumoId } });
    await env.cerrar();
  });

  const correr = async (almacen: AlmacenMemoria, cfg: TablaArchivable, filtro: Record<string, unknown>, opc: Parameters<ArchivadoService['ejecutar']>[0] = {}): Promise<ResultadoCorrida> => {
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: [cfg],
      tablas: [cfg.tabla],
      filtroExtra: { [cfg.tabla]: filtro },
      ...opc,
    });
    corridas.push(r.corridaId);
    return r;
  };

  const leer = async (almacen: AlmacenMemoria, clave: string) => {
    const b = almacen.objetos.get(clave)!;
    return parquetReadObjects({ file: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });
  };

  const movimiento = (fecha: string, estadoDespacho: 'EN_TRANSITO' | 'RECIBIDO' = 'RECIBIDO') =>
    env.movimiento({ usuarioDespachaId: usuarioId, fechaDespacho: new Date(fecha), estadoDespacho, detalle: { insumoId, cantidadEnviada: 2.5, cantidadRecibida: 2 } });
  const enBase = (modelo: 'movimientoInventario' | 'movimientoDetalle', where: Record<string, unknown>) => (env.prisma as any)[modelo].count({ where });

  describe('KardexMovimiento (tabla sin hijos)', () => {
    it('archiva lo de más de 12 meses con las cantidades exactas y deja lo reciente', async () => {
      const kardex = (fecha: string, cantidad: string, costoUnitario: string | null) =>
        env.prisma.kardexMovimiento.create({
          data: { insumoId, ubicacionId: 'ubic-prueba', tipoMovimiento: 'COMPRA_INGRESO', cantidad, stockAnterior: '10.0000', stockPosterior: '22.3456', costoUnitario, fecha: new Date(fecha) },
        });
      const vieja = await kardex('2025-03-10T10:00:00Z', '12.3456', null);
      await kardex('2025-03-25T10:00:00Z', '-1.5000', '2.50');
      const reciente = await kardex('2026-09-30T10:00:00Z', '3.0000', '2.50');
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, KARDEX, { insumoId });

      expect(r.estado).toBe('OK');
      expect(r.tablas.kardex_movimiento.archivadas).toBe(2);
      expect((await env.prisma.kardexMovimiento.findMany({ where: { insumoId } })).map((k) => k.id)).toEqual([reciente.id]);
      const [clave] = almacen.parquets();
      expect(clave).toContain('kardex_movimiento/anio=2025/mes=03/');
      const filas = await leer(almacen, clave);
      const guardada = filas.find((f) => f.id === vieja.id)!;
      expect(guardada.cantidad).toBe(12.3456);
      expect(guardada.stockPosterior).toBe(22.3456);
      expect(guardada.costoUnitario).toBeNull();
      expect(filas.find((f) => f.id !== vieja.id)!.costoUnitario).toBe(2.5);
    });
  });

  describe('familia MovimientoInventario + MovimientoDetalle', () => {
    it('archiva padre e hijos en el mismo lote (mismo grupo y partición) y borra los dos de la base', async () => {
      const m1 = await movimiento('2025-03-05T10:00:00Z');
      const m2 = await movimiento('2025-03-15T10:00:00Z');
      const reciente = await movimiento('2026-09-20T10:00:00Z');
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, MOVIMIENTO, { usuarioDespachaId: usuarioId });

      expect(r.estado).toBe('OK');
      expect(r.tablas.movimiento_inventario.archivadas).toBe(2);
      expect(r.tablas.movimiento_inventario.lotes).toBe(2); // un archivo del padre y uno del detalle
      expect(await enBase('movimientoInventario', { id: { in: [m1.id, m2.id] } })).toBe(0);
      expect(await enBase('movimientoDetalle', { movimientoId: { in: [m1.id, m2.id] } })).toBe(0);
      // Lo reciente, con su detalle, no se toca.
      expect(await enBase('movimientoInventario', { id: reciente.id })).toBe(1);
      expect(await enBase('movimientoDetalle', { movimientoId: reciente.id })).toBe(1);

      expect(almacen.parquets().map((k) => k.split('/').slice(1, 4).join('/'))).toEqual(['movimiento_detalle/anio=2025/mes=03', 'movimiento_inventario/anio=2025/mes=03']);
      const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: r.corridaId } });
      expect(new Set(lotes.map((l) => l.grupoId)).size).toBe(1);
      expect(lotes.every((l) => l.estado === 'BORRADO')).toBe(true);

      const detalle = await leer(almacen, lotes.find((l) => l.tabla === 'movimiento_detalle')!.clave);
      expect(detalle.map((d) => d.movimientoId).sort()).toEqual([m1.id, m2.id].sort());
      expect(detalle[0].cantidadEnviada).toBe(2.5);
      expect(detalle[0].cantidadRecibida).toBe(2);
    });

    it('si aparece un hijo nuevo mientras se archiva, no borra nada, marca el grupo FALLIDO y lo archiva completo después', async () => {
      const m = await movimiento('2025-05-05T10:00:00Z');
      const almacen = new AlmacenMemoria();
      let colado = false;
      almacen.alSubir = async () => {
        if (colado) return;
        colado = true;
        await env.prisma.movimientoDetalle.create({ data: { movimientoId: m.id, insumoId, cantidadEnviada: 9 } });
      };

      const r1 = await correr(almacen, MOVIMIENTO, { id: m.id });

      expect(r1.estado).toBe('ERROR');
      expect(r1.tablas.movimiento_inventario.errores[0]).toMatch(/Aparecieron 1 filas nuevas/);
      expect(await enBase('movimientoInventario', { id: m.id })).toBe(1);
      expect(await enBase('movimientoDetalle', { movimientoId: m.id })).toBe(2); // el deshacer restauró también el hijo archivado
      const fallidos = await env.prisma.archivadoLote.findMany({ where: { corridaId: r1.corridaId } });
      expect(fallidos.length).toBeGreaterThan(0);
      expect(fallidos.every((l) => l.estado === 'FALLIDO')).toBe(true);

      almacen.alSubir = null;
      const r2 = await correr(almacen, MOVIMIENTO, { id: m.id });

      expect(r2.estado).toBe('OK');
      expect(await enBase('movimientoInventario', { id: m.id })).toBe(0);
      expect(await enBase('movimientoDetalle', { movimientoId: m.id })).toBe(0);
      const buenos = await env.prisma.archivadoLote.findMany({ where: { corridaId: r2.corridaId, tabla: 'movimiento_detalle' } });
      expect((await leer(almacen, buenos[0].clave)).length).toBe(2); // los dos hijos, incluido el nuevo
    });

    it('retoma una familia a medias sin duplicar ni perder filas', async () => {
      const m = await movimiento('2025-07-07T10:00:00Z');
      const almacen = new AlmacenMemoria();
      almacen.fallarPut = 3; // sube padre e hijo (puts 1 y 2) y falla al escribir el primer manifiesto

      const r1 = await correr(almacen, MOVIMIENTO, { id: m.id });
      expect(r1.estado).toBe('ERROR');
      expect(await enBase('movimientoInventario', { id: m.id })).toBe(1);
      const pendientes = await env.prisma.archivadoLote.findMany({ where: { corridaId: r1.corridaId } });
      expect(pendientes.map((l) => l.estado)).toEqual(['SUBIDO', 'SUBIDO']);

      almacen.fallarPut = null;
      const r2 = await correr(almacen, MOVIMIENTO, { id: m.id }, { retomarDespuesDe: 0, retomarDeCorridas: [r1.corridaId] });

      expect(r2.estado).toBe('OK');
      expect(await enBase('movimientoInventario', { id: m.id })).toBe(0);
      expect(await enBase('movimientoDetalle', { movimientoId: m.id })).toBe(0);
      const despues = await env.prisma.archivadoLote.findMany({ where: { id: { in: pendientes.map((l) => l.id) } } });
      expect(despues.every((l) => l.estado === 'BORRADO')).toBe(true);
      expect(almacen.parquets().filter((k) => k.includes('anio=2025/mes=07/')).length).toBe(2);
      const padre = pendientes.find((l) => l.tabla === 'movimiento_inventario')!;
      expect(await leerIds(almacen.objetos.get(padre.clave)!)).toEqual([m.id]);
    });

    it('no archiva lo vivo (despacho sin cerrar o con un faltante pendiente) y archiva los tres hijos del que sí', async () => {
      const enTransito = await movimiento('2025-01-10T10:00:00Z', 'EN_TRANSITO');
      const conFaltantePendiente = await movimiento('2025-01-11T10:00:00Z');
      const resuelto = await movimiento('2025-01-12T10:00:00Z');
      const faltante = (movimientoId: string, estado: string) =>
        env.prisma.faltanteDespacho.create({ data: { movimientoId, numeroGuia: `${env.marca}-F`, insumoId, cantidadUnd: 1.5, cantidadBase: 1.5, estado } });
      await faltante(conFaltantePendiente.id, 'PENDIENTE');
      const f = await faltante(resuelto.id, 'RESUELTO');
      await env.prisma.envioEvidencia.create({ data: { movimientoId: resuelto.id, faltanteId: f.id, etapa: 'RECEPCION', url: 'https://ejemplo.test/foto.jpg' } });
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, MOVIMIENTO, { usuarioDespachaId: usuarioId, fechaDespacho: { lt: new Date('2025-02-01T00:00:00Z') } });

      expect(r.estado).toBe('OK');
      expect(r.tablas.movimiento_inventario.archivadas).toBe(1);
      expect(await enBase('movimientoInventario', { id: { in: [enTransito.id, conFaltantePendiente.id] } })).toBe(2);
      expect(await enBase('movimientoInventario', { id: resuelto.id })).toBe(0);
      // Lo vivo conserva todos sus hijos.
      expect(await enBase('movimientoDetalle', { movimientoId: { in: [enTransito.id, conFaltantePendiente.id] } })).toBe(2);
      expect(await env.prisma.faltanteDespacho.count({ where: { movimientoId: conFaltantePendiente.id } })).toBe(1);

      const tablas = almacen.parquets().map((k) => k.split('/')[1]).sort();
      expect(tablas).toEqual(['envio_evidencia', 'faltante_despacho', 'movimiento_detalle', 'movimiento_inventario']);
      const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: r.corridaId } });
      expect(lotes.every((l) => l.estado === 'BORRADO')).toBe(true);
      const evidencia = await leer(almacen, lotes.find((l) => l.tabla === 'envio_evidencia')!.clave);
      expect(evidencia[0]).toMatchObject({ movimientoId: resuelto.id, etapa: 'RECEPCION', url: 'https://ejemplo.test/foto.jpg' });
      const faltantes = await leer(almacen, lotes.find((l) => l.tabla === 'faltante_despacho')!.clave);
      expect(faltantes[0]).toMatchObject({ estado: 'RESUELTO', cantidadUnd: 1.5 });
    });

    it('en simulacro cuenta los padres y no sube ni borra nada', async () => {
      const m = await movimiento('2025-09-09T10:00:00Z');
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, MOVIMIENTO, { id: m.id }, { simulacro: true });

      expect(r.tablas.movimiento_inventario.simuladas).toBe(1);
      expect(almacen.objetos.size).toBe(0);
      expect(await enBase('movimientoInventario', { id: m.id })).toBe(1);
      expect(await enBase('movimientoDetalle', { movimientoId: m.id })).toBe(1);
    });
  });
  describe('familia ServicioLavado + consumos, evidencias y operadores', () => {
    let llamadas = 0;
    const preparar = async () => {
      const k = `sv${++llamadas}`;
      const region = await env.region(k);
      const agencia = await env.agencia(k, { regionId: region.id });
      const bahia = await env.bahia(k, agencia.id);
      const catalogo = await env.catalogo(k);
      const operador = await env.usuario(`${k}-op`, 'LAVADOR');
      const ayudante = await env.usuario(`${k}-ay`, 'LAVADOR');
      return { region, agencia, bahia, catalogo, operador, ayudante };
    };

    const servicio = (c: Awaited<ReturnType<typeof preparar>>, estado: 'EN_ESPERA' | 'FINALIZADO' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO', ingreso: string, extra: Record<string, unknown> = {}) =>
      env.servicioLavado({ bahiaId: c.bahia.id, operadorId: c.operador.id, catalogoId: c.catalogo.id, estado, horaIngreso: new Date(ingreso), asignados: [c.ayudante.id], precio: 12.5, ...extra });

    it('archiva los decididos con sus tres hijos y la agencia y región copiadas; deja los pendientes y los recientes', async () => {
      const c = await preparar();
      const aprobado = await servicio(c, 'APROBADO', '2025-02-10T15:00:00Z', { datos: { aprobadoPor: 'Ana Pérez', observaciones: 'Sin novedades ñ' } });
      const anulado = await servicio(c, 'CANCELADO', '2025-02-12T15:00:00Z', { deletedAt: new Date('2025-02-13T00:00:00Z') });
      const finalizado = await servicio(c, 'FINALIZADO', '2025-02-14T15:00:00Z');
      const reciente = await servicio(c, 'APROBADO', '2026-09-25T15:00:00Z');

      await env.prisma.consumoServicio.create({
        data: { servicioId: aprobado.id, insumoId, cantidadUsada: '0.2500', agenciaId: c.agencia.id, insumoNombre: 'Shampoo', insumoSKU: 'SH-1', unidadSimbolo: 'L' },
      });
      await env.prisma.evidenciaServicio.create({ data: { servicioId: aprobado.id, tipo: 'INGRESO', url: 'https://ejemplo.test/ingreso.jpg', metadata: { lat: -0.18, ancho: 800 } } });
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, SERVICIO, { operadorId: c.operador.id });

      expect(r.estado).toBe('OK');
      expect(r.tablas.servicio_lavado.archivadas).toBe(2);
      const enDb = (ids: string[]) => env.prisma.servicioLavado.findMany({ where: { id: { in: ids } }, select: { id: true } });
      expect(await enDb([aprobado.id, anulado.id])).toEqual([]);
      expect((await enDb([finalizado.id, reciente.id])).map((x) => x.id).sort()).toEqual([finalizado.id, reciente.id].sort());
      // Los hijos de lo archivado se fueron; los de lo que se queda siguen.
      expect(await env.prisma.servicioLavadoOperador.count({ where: { servicioId: { in: [aprobado.id, anulado.id] } } })).toBe(0);
      expect(await env.prisma.servicioLavadoOperador.count({ where: { servicioId: { in: [finalizado.id, reciente.id] } } })).toBe(2);

      const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: r.corridaId } });
      expect(lotes.map((l) => l.tabla).sort()).toEqual(['consumo_servicio', 'evidencia_servicio', 'servicio_lavado', 'servicio_lavado_operador']);
      expect(new Set(lotes.map((l) => l.grupoId)).size).toBe(1);
      expect(lotes.every((l) => l.estado === 'BORRADO' && l.anio === 2025 && l.mes === 2)).toBe(true);

      const filas = await leer(almacen, lotes.find((l) => l.tabla === 'servicio_lavado')!.clave);
      const fila = filas.find((f) => f.id === aprobado.id)!;
      expect(fila).toMatchObject({ estado: 'APROBADO', agenciaId: c.agencia.id, regionId: c.region.id, bahiaId: c.bahia.id, precio: 12.5, aprobadoPor: 'Ana Pérez', observaciones: 'Sin novedades ñ', servicioCatalogoId: c.catalogo.id });
      expect((fila.horaIngreso as Date).toISOString()).toBe('2025-02-10T15:00:00.000Z');
      // El anulado conserva su deletedAt para que los reportes puedan seguir excluyéndolo.
      expect(filas.find((f) => f.id === anulado.id)!.deletedAt).toBeInstanceOf(Date);
      expect(fila.deletedAt).toBeNull();

      const consumo = await leer(almacen, lotes.find((l) => l.tabla === 'consumo_servicio')!.clave);
      expect(consumo[0]).toMatchObject({ servicioId: aprobado.id, cantidadUsada: 0.25, insumoNombre: 'Shampoo', unidadSimbolo: 'L' });
      const evidencia = await leer(almacen, lotes.find((l) => l.tabla === 'evidencia_servicio')!.clave);
      expect(JSON.parse(evidencia[0].metadata as string)).toEqual({ lat: -0.18, ancho: 800 });
      const operadores = await leer(almacen, lotes.find((l) => l.tabla === 'servicio_lavado_operador')!.clave);
      expect(operadores.map((o) => o.operadorId)).toEqual([c.ayudante.id, c.ayudante.id]);
    });

    it('si la bahía ya no se resuelve, deja agencia y región en null en vez de fallar', async () => {
      const c = await preparar();
      const filas: Record<string, unknown>[] = [{ bahiaId: c.bahia.id }, { bahiaId: 'bahia-que-no-existe' }];

      await SERVICIO.enriquecer!(env.prisma, filas);

      expect(filas[0]).toMatchObject({ agenciaId: c.agencia.id, regionId: c.region.id });
      expect(filas[1]).toMatchObject({ agenciaId: null, regionId: null });
    });
  });
  describe('familia ServicioEspecial (fecha compuesta: programada o, si no hay, creación)', () => {
    it('parte por la fecha programada (o la de creación si no hay), deja lo vivo y lo que sigue reciente, y archiva los hijos', async () => {
      const pulidor = await env.usuario('esp-op', 'PULIDOR');
      const ayudante = await env.usuario('esp-ay', 'PULIDOR');
      const especial = (estado: string, creado: string, programada: string | null, extra: Record<string, unknown> = {}) =>
        env.servicioEspecial({ operadorId: pulidor.id, estado, asignados: [ayudante.id], precio: 80, datos: { createdAt: new Date(creado), fechaProgramada: programada ? new Date(programada) : null, ...extra } });

      // Creado en enero pero programado para marzo: su mes es marzo, no enero.
      const programadoEnMarzo = await especial('Completado', '2025-01-05T10:00:00Z', '2025-03-10T10:00:00Z', { recetaInsumos: [{ insumo: 'Pulidor', cantidad: 0.5 }], observaciones: 'Quedó impecable ñ' });
      // Sin fecha programada: cuenta la de creación (marzo).
      const sinProgramar = await especial('Cancelado', '2025-03-12T10:00:00Z', null);
      // Otro mes, para comprobar que se parte en lotes distintos.
      const deMayo = await especial('Completado', '2025-05-02T10:00:00Z', null);
      // Creado hace mucho pero programado para hace poco: su fecha del evento es reciente, no se archiva.
      const programadoReciente = await especial('Completado', '2025-01-05T10:00:00Z', '2026-09-20T10:00:00Z');
      // En curso: vivo aunque sea viejo.
      const enCurso = await especial('En Proceso', '2025-03-15T10:00:00Z', null);

      await env.prisma.consumoServicioEspecial.create({
        data: { servicioEspecialId: programadoEnMarzo.id, insumoId, cantidadUsada: '0.5000', pulidorId: pulidor.id, insumoNombre: 'Pulidor', insumoSKU: 'PU-1', unidadSimbolo: 'L' },
      });
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, ESPECIAL, { operadorId: pulidor.id });

      expect(r.estado).toBe('OK');
      expect(r.tablas.servicio_especial.archivadas).toBe(3);
      const quedan = await env.prisma.servicioEspecial.findMany({ where: { operadorId: pulidor.id }, select: { id: true } });
      expect(quedan.map((x) => x.id).sort()).toEqual([programadoReciente.id, enCurso.id].sort());
      expect(await env.prisma.servicioEspecialOperador.count({ where: { servicioId: { in: [programadoEnMarzo.id, sinProgramar.id, deMayo.id] } } })).toBe(0);
      expect(await env.prisma.servicioEspecialOperador.count({ where: { servicioId: { in: [programadoReciente.id, enCurso.id] } } })).toBe(2);

      const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: r.corridaId } });
      const mesesDelPadre = lotes.filter((l) => l.tabla === 'servicio_especial').map((l) => `${l.anio}-${l.mes}`).sort();
      expect(mesesDelPadre).toEqual(['2025-3', '2025-5']);
      expect(lotes.every((l) => l.estado === 'BORRADO')).toBe(true);
      // Los archivos de marzo (padre e hijos) comparten partición y grupo.
      const marzo = lotes.filter((l) => l.mes === 3);
      expect(marzo.map((l) => l.tabla).sort()).toEqual(['consumo_servicio_especial', 'servicio_especial', 'servicio_especial_operador']);
      expect(new Set(marzo.map((l) => l.grupoId)).size).toBe(1);
      // Los rangos de fechas del lote son los de la fecha del evento (esto decide qué lotes lee un reporte).
      const padreMarzo = marzo.find((l) => l.tabla === 'servicio_especial')!;
      expect(padreMarzo.fechaMin.toISOString()).toBe('2025-03-10T10:00:00.000Z');
      expect(padreMarzo.fechaMax.toISOString()).toBe('2025-03-12T10:00:00.000Z');

      const filas = await leer(almacen, padreMarzo.clave);
      const a = filas.find((f) => f.id === programadoEnMarzo.id)!;
      expect((a.fechaEvento as Date).toISOString()).toBe('2025-03-10T10:00:00.000Z');
      expect(a).toMatchObject({ estado: 'Completado', precio: 80, observaciones: 'Quedó impecable ñ' });
      expect(JSON.parse(a.recetaInsumos as string)).toEqual([{ insumo: 'Pulidor', cantidad: 0.5 }]);
      expect((filas.find((f) => f.id === sinProgramar.id)!.fechaEvento as Date).toISOString()).toBe('2025-03-12T10:00:00.000Z');

      const consumos = await leer(almacen, marzo.find((l) => l.tabla === 'consumo_servicio_especial')!.clave);
      expect(consumos[0]).toMatchObject({ servicioEspecialId: programadoEnMarzo.id, cantidadUsada: 0.5, insumoNombre: 'Pulidor' });
      const operadores = await leer(almacen, marzo.find((l) => l.tabla === 'servicio_especial_operador')!.clave);
      expect(operadores.length).toBe(2); // un ayudante por cada uno de los dos servicios de marzo
    });

    it('en simulacro cuenta por la fecha del evento y no toca nada', async () => {
      const pulidor = await env.usuario('esp-sim', 'PULIDOR');
      await env.servicioEspecial({ operadorId: pulidor.id, estado: 'Completado', datos: { createdAt: new Date('2025-01-05T10:00:00Z'), fechaProgramada: new Date('2025-04-04T10:00:00Z') } });
      await env.servicioEspecial({ operadorId: pulidor.id, estado: 'Completado', datos: { createdAt: new Date('2025-02-05T10:00:00Z'), fechaProgramada: null } });
      const almacen = new AlmacenMemoria();

      const r = await correr(almacen, ESPECIAL, { operadorId: pulidor.id }, { simulacro: true });

      expect(r.tablas.servicio_especial.simuladas).toBe(2);
      expect(almacen.objetos.size).toBe(0);
      expect(await env.prisma.servicioEspecial.count({ where: { operadorId: pulidor.id } })).toBe(2);
    });
  });
});
