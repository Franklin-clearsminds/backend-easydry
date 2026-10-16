import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import type { ConsultaArchivo } from '../archivado/archivo-lector.js';
import { OperacionesService } from './operaciones.service.js';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

class LectorContador extends LectorSoloLocal {
  llamadas = 0;
  override async consultar(c: ConsultaArchivo) {
    this.llamadas++;
    return super.consultar(c);
  }
}

const canonico = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonico) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonico(x)])) : v);
const json = (v: unknown) => JSON.stringify(canonico(JSON.parse(JSON.stringify(v))));
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Abrir el detalle de un servicio ya archivado (por su id, su clientUuid, su código u orden) debe dar EXACTAMENTE lo mismo que antes
 * de archivarlo: mismos datos, mismos consumos, evidencias y operadores. Y como lo archivado es inmutable, las rutas que lo MODIFICAN
 * siguen sin encontrarlo.
 */
describe.skipIf(!(await duckdbDisponible))('detalle de servicios archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  let lector: LectorContador;
  let admin: any;
  let regionAjena: any;
  let lavado: { id: string; uuid: string };
  let lavadoVivo: { id: string };
  let especial: { id: string; uuid: string; codigo: string; ot: string };
  const corridas: string[] = [];
  const antes = new Map<string, string>();
  let ops: OperacionesService;
  let esp: ServiciosEspecialesService;
  let opsConArchivo: OperacionesService;
  let espConArchivo: ServiciosEspecialesService;

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'detalle-archivo-'));
    admin = await env.actor((await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } })).id);
    const region = await env.region('d1');
    const otra = await env.region('d2');
    regionAjena = { id: 'regional-ajeno', name: 'Ajeno', lastname: 'X', regionId: otra.id, role: { namerol: 'SUPERVISOR', ambito: 'REGION', capacidades: [] } };
    const agencia = await env.agencia('d1', { regionId: region.id });
    const bahia = await env.bahia('d1', agencia.id);
    const catalogo = await env.catalogo('det');
    const insumoA = await env.insumo('det-a');
    const insumoB = await env.insumo('det-b');
    const op1 = await env.usuario('d-op1', 'LAVADOR', { name: `Carlos${env.marca}`, lastname: 'Vega' });
    const op2 = await env.usuario('d-op2', 'LAVADOR', { name: `Diana${env.marca}`, lastname: 'Soto' });
    const op3 = await env.usuario('d-op3', 'LAVADOR', { name: `Elena${env.marca}`, lastname: 'Rojas' });

    // --- Servicio de lavado archivable, con consumos, evidencias y operadores asignados
    const uuid = `${env.marca}-uuid-detalle`;
    const ingreso = new Date('2019-03-05T15:00:00Z');
    const s = await env.servicioLavado({ bahiaId: bahia.id, operadorId: op1.id, catalogoId: catalogo.id, estado: 'APROBADO', horaIngreso: ingreso, horaSalida: new Date(ingreso.getTime() + 40 * 60000), precio: 12.5, placa: 'DET-111', asignados: [op2.id], datos: { clientUuid: uuid, aprobadoPor: 'Ana Pérez', observaciones: 'Todo bien ñ', marca: 'Toyota', color: 'Rojo' } });
    lavado = { id: s.id, uuid };
    await pausa(5);
    await env.prisma.servicioLavadoOperador.create({ data: { servicioId: s.id, operadorId: op3.id } });
    await env.prisma.consumoServicio.create({ data: { servicioId: s.id, insumoId: insumoA.id, cantidadUsada: '0.2500', agenciaId: agencia.id, insumoNombre: 'Shampoo', insumoSKU: 'SH-1', unidadSimbolo: 'L' } });
    await pausa(5);
    await env.prisma.consumoServicio.create({ data: { servicioId: s.id, insumoId: insumoB.id, cantidadUsada: '1.5000', agenciaId: agencia.id, insumoNombre: 'Cera', insumoSKU: 'CE-1', unidadSimbolo: 'kg' } });
    await env.prisma.evidenciaServicio.create({ data: { servicioId: s.id, tipo: 'SALIDA', url: 'https://x.test/salida.jpg', tomadaEn: new Date('2019-03-05T15:40:00Z'), metadata: { lat: -0.18, ancho: 800 } } });
    await env.prisma.evidenciaServicio.create({ data: { servicioId: s.id, tipo: 'INGRESO', url: 'https://x.test/ingreso.jpg', descripcion: 'Con golpe previo', tomadaEn: new Date('2019-03-05T15:00:00Z') } });
    // Más evidencias, insertadas fuera del orden en que se tomaron: el detalle debe devolverlas por hora de toma.
    await env.prisma.evidenciaServicio.create({ data: { servicioId: s.id, tipo: 'PROCESO', url: 'https://x.test/proceso-2.jpg', tomadaEn: new Date('2019-03-05T15:30:00Z') } });
    await env.prisma.evidenciaServicio.create({ data: { servicioId: s.id, tipo: 'DANO_PREVIO', url: 'https://x.test/dano.jpg', tomadaEn: new Date('2019-03-05T15:10:00Z') } });

    // Un servicio que sigue en la base (FINALIZADO sin decidir): el control.
    lavadoVivo = await env.servicioLavado({ bahiaId: bahia.id, operadorId: op1.id, catalogoId: catalogo.id, estado: 'FINALIZADO', horaIngreso: new Date('2019-03-06T15:00:00Z'), horaSalida: new Date('2019-03-06T16:00:00Z'), placa: 'DET-222' });

    // --- Servicio especial archivable, con dos pulidores en orden
    const uuidE = `${env.marca}-uuid-especial`;
    const e = await env.servicioEspecial({ operadorId: op1.id, agenciaId: agencia.id, regionId: region.id, catalogoId: catalogo.id, estado: 'Completado', precio: 80, placa: 'DET-333', asignados: [op1.id, op2.id], datos: { clientUuid: uuidE, createdAt: new Date('2019-04-04T15:00:00Z'), fechaProgramada: null, tiempoEfectivoSeg: 5400, observaciones: 'Quedó impecable ñ', recetaInsumos: [{ insumo: 'Pulidor', cantidad: 0.5 }] } });
    const fe = await env.prisma.servicioEspecial.findUniqueOrThrow({ where: { id: e.id }, select: { codigoSE: true, ordenTrabajoOT: true } });
    especial = { id: e.id, uuid: uuidE, codigo: fe.codigoSE, ot: fe.ordenTrabajoOT ?? fe.codigoSE };

    ops = new OperacionesService(env.prisma as never);
    esp = new ServiciosEspecialesService(env.prisma as never);

    // Lo que devuelve cada lectura ANTES de archivar.
    antes.set('lavado por id', json(await ops.findOne(lavado.id, admin)));
    antes.set('lavado por clientUuid', json(await ops.findOne(lavado.uuid, admin)));
    antes.set('lavado historial', json(await ops.historialDecisiones(lavado.id, admin)));
    antes.set('especial por id', json(await esp.findOne(especial.id, admin)));
    antes.set('especial por clientUuid', json(await esp.findOne(especial.uuid, admin)));
    antes.set('especial por código', json(await esp.findOne(especial.codigo, admin)));
    antes.set('especial por código en minúsculas', json(await esp.findOne(especial.codigo.toLowerCase(), admin)));
    antes.set('especial por orden de trabajo', json(await esp.findOne(especial.ot, admin)));
    antes.set('especial historial', json(await esp.historialDecisiones(especial.id, admin)));
    antes.set('vivo', json(await ops.findOne(lavadoVivo.id, admin)));

    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: new Date('2020-10-15T12:00:00Z'),
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => ['servicio_lavado', 'servicio_especial'].includes(t.tabla)),
      tablas: ['servicio_lavado', 'servicio_especial'],
      filtroExtra: { servicio_lavado: { id: { in: [lavado.id, lavadoVivo.id] } }, servicio_especial: { id: especial.id } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(r.tablas)).toBe('OK');
    expect(await env.prisma.servicioLavado.count({ where: { id: lavado.id } })).toBe(0);
    expect(await env.prisma.servicioLavado.count({ where: { id: lavadoVivo.id } })).toBe(1);
    expect(await env.prisma.servicioEspecial.count({ where: { id: especial.id } })).toBe(0);

    volcarAlDisco(almacen, raiz);
    lector = new LectorContador(raiz);
    const historico = new HistoricoService(env.prisma as never, lector);
    opsConArchivo = new OperacionesService(env.prisma as never, undefined, undefined, historico);
    espConArchivo = new ServiciosEspecialesService(env.prisma as never, undefined, undefined, historico);
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('el detalle de un servicio de lavado archivado es idéntico al de antes (por id y por clientUuid)', async () => {
    // El servicio de prueba tiene datos de verdad: si no, la comparación no probaría nada.
    const previo = JSON.parse(antes.get('lavado por id')!);
    expect(previo.consumos).toHaveLength(2);
    expect(previo.evidencias).toHaveLength(4);
    expect(previo.evidencias.map((e: any) => e.tipo)).toEqual(['INGRESO', 'DANO_PREVIO', 'PROCESO', 'SALIDA']); // por hora de toma
    expect(previo.operadoresAsignados).toHaveLength(2);

    expect(json(await opsConArchivo.findOne(lavado.id, admin))).toBe(antes.get('lavado por id'));
    expect(json(await opsConArchivo.findOne(lavado.uuid, admin))).toBe(antes.get('lavado por clientUuid'));
    expect(json(await opsConArchivo.historialDecisiones(lavado.id, admin))).toBe(antes.get('lavado historial'));
  });

  it('el detalle de un servicio especial archivado es idéntico, por id, clientUuid, código (cualquier caso) y orden de trabajo', async () => {
    expect(JSON.parse(antes.get('especial por id')!).operadoresIds).toHaveLength(2);
    for (const [clave, id] of [
      ['especial por id', especial.id],
      ['especial por clientUuid', especial.uuid],
      ['especial por código', especial.codigo],
      ['especial por código en minúsculas', especial.codigo.toLowerCase()],
      ['especial por orden de trabajo', especial.ot],
    ] as const) {
      expect(json(await espConArchivo.findOne(id, admin)), clave).toBe(antes.get(clave));
    }
    expect(json(await espConArchivo.historialDecisiones(especial.id, admin))).toBe(antes.get('especial historial'));
  });

  it('sin la capa de archivo, el detalle de un servicio archivado no se encontraría (lo que esta capa evita)', async () => {
    await expect(ops.findOne(lavado.id, admin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(esp.findOne(especial.id, admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el alcance del usuario se respeta también en lo archivado: quien no lo puede ver, recibe Forbidden', async () => {
    await expect(opsConArchivo.findOne(lavado.id, regionAjena)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(espConArchivo.findOne(especial.id, regionAjena)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un id que no existe sigue dando NotFound', async () => {
    await expect(opsConArchivo.findOne('no-existe-ni-archivado', admin)).rejects.toBeInstanceOf(NotFoundException);
    await expect(espConArchivo.findOne('no-existe-ni-archivado', admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lo archivado es inmutable: las rutas que modifican un servicio siguen sin encontrarlo', async () => {
    await expect(opsConArchivo.findOneRaw(lavado.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(opsConArchivo.consumirInsumosSiPendiente(lavado.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(espConArchivo.findOneRaw(especial.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un servicio que sigue en la base se lee de la base, sin tocar el archivo', async () => {
    const antesDeLeer = lector.llamadas;
    expect(json(await opsConArchivo.findOne(lavadoVivo.id, admin))).toBe(antes.get('vivo'));
    expect(lector.llamadas).toBe(antesDeLeer);
  });
});
