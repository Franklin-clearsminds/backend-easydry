import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { aUnidadDelInsumo, costoDeConsumo, costoPorUnidadBase, valorarConsumo } from '../../common/utils/costo-insumo.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

describe('costo-insumo — valoración de un consumo', () => {
  it('el costo de una unidad base es el precio del envase dividido entre su contenido', () => {
    expect(costoPorUnidadBase({ costoUnitarioUSD: 75, contenidoNeto: 5 })).toBe(15);
    expect(costoPorUnidadBase({ costoUnitarioUSD: 75 })).toBe(75); // sin contenido se toma 1
    expect(costoPorUnidadBase(null)).toBe(0);
  });

  it('valora lo consumido con el costo de la unidad base', () => {
    expect(valorarConsumo({ costoUnitarioUSD: 75, contenidoNeto: 5000 }, 250)).toEqual({ costoUnitarioUSD: 0.015, costoTotalUSD: 3.75 });
  });

  it('pasa la receta a la unidad propia del insumo', () => {
    expect(aUnidadDelInsumo(10, 0.001, 0.001)).toBe(10); // 10 ml de receta sobre un insumo en ml
    expect(aUnidadDelInsumo(10, 0.001, 1)).toBe(0.01); // 10 ml sobre un insumo en L
    expect(aUnidadDelInsumo(2, 1, 0.001)).toBe(2000); // 2 L sobre un insumo en ml
    expect(aUnidadDelInsumo(0.05, 1, 1)).toBe(0.05); // unidades
    expect(aUnidadDelInsumo(3, undefined, undefined)).toBe(3);
  });

  it('manda el costo congelado; sin él, valora con el costo actual del insumo', () => {
    expect(costoDeConsumo({ cantidadUsada: 2, costoTotalUSD: 30, insumo: { costoUnitarioUSD: 999, contenidoNeto: 1 } })).toBe(30);
    expect(costoDeConsumo({ cantidadUsada: 2, costoTotalUSD: null, insumo: { costoUnitarioUSD: 75, contenidoNeto: 5 } })).toBe(30);
  });
});

/**
 * Integración con la base real. Cada consumo guarda cuánto se usó y cuánto costó (precio del envase ÷ contenido × cantidad) en el
 * momento en que ocurre: si después cambia el precio del insumo, lo que costó el servicio no se mueve.
 *
 * Mundo: Agencia A1 con la bahía B1; un insumo que cuesta 75 por envase de 5 unidades base (15 por unidad), con 100 en stock, y un
 * servicio cuya receta usa 2 unidades.
 */
describe('Servicios: el consumo de insumos guarda su costo congelado (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let agencia: any, bahia: any, lavador: any, servicio: any, insumo: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);
    const region = await env.region('R1');
    agencia = await env.agencia('A1', { regionId: region.id });
    bahia = await env.bahia('B1', agencia.id);
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: agencia.id });
    await env.prisma.bahiaOperador.create({ data: { bahiaId: bahia.id, operadorId: lavador.id } });

    insumo = await env.insumo('COSTO');
    await env.prisma.insumo.update({ where: { id: insumo.id }, data: { costoUnitarioUSD: 75, contenidoNeto: 5 } });
    await env.stock({ insumoId: insumo.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id, cantidad: 100 });
    const unidadId = (await env.prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).unidadMedidaId;
    servicio = await env.catalogo('COSTO', { precio: 10 });
    await env.prisma.recetaInsumo.create({ data: { catalogoServicioId: servicio.id, insumoId: insumo.id, cantidadUsada: 2, unidadConsumoId: unidadId } });
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { servicioIds: [servicio.id] } });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('registra la cantidad usada y lo que costó, y no cambia si luego sube el precio del insumo', async () => {
    const creado: any = await service.create(
      { placa: 'CST-0001', modelo: 'Corolla', servicioCatalogoId: servicio.id, bahiaId: bahia.id, ordenTrabajoOT: `${env.marca}-OT-COSTO`.toUpperCase(), fotoIngresoUrl: 'https://x/ingreso.mp4' } as any,
      lavador.id,
      { id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades: ['servicios.generales.crear'], ambito: 'GLOBAL' } },
    );
    const id = (Array.isArray(creado) ? creado[0] : creado).id as string;

    const [consumo] = await env.prisma.consumoServicio.findMany({ where: { servicioId: id } });
    expect(Number(consumo.cantidadUsada)).toBe(2);
    expect(Number(consumo.costoUnitarioUSD)).toBe(15); // 75 ÷ 5
    expect(Number(consumo.costoTotalUSD)).toBe(30); // 2 × 15

    await env.prisma.insumo.update({ where: { id: insumo.id }, data: { costoUnitarioUSD: 150 } });
    const despues = await env.prisma.consumoServicio.findUniqueOrThrow({ where: { id: consumo.id } });
    expect(Number(despues.costoTotalUSD)).toBe(30);
  });

  it('un insumo en ml (envase de 1000 ml a $10) que gasta 10 ml descuenta 10 ml y suma $0.10', async () => {
    const ml = await env.prisma.unidadMedida.create({ data: { codigo: `${env.marca}-ML`, nombre: `${env.marca} Mililitro`, simbolo: 'ml', tipo: 'VOLUMEN', factorBase: 0.001 } });
    env.rastrear('UnidadMedida', ml.id);
    const liquido = await env.insumo('LIQUIDO');
    await env.prisma.insumo.update({ where: { id: liquido.id }, data: { costoUnitarioUSD: 10, contenidoNeto: 1000, unidadMedidaId: ml.id } });
    await env.stock({ insumoId: liquido.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id, cantidad: 9000 });
    const lavado = await env.catalogo('LIQUIDO', { precio: 10 });
    await env.prisma.recetaInsumo.create({ data: { catalogoServicioId: lavado.id, insumoId: liquido.id, cantidadUsada: 10, unidadConsumoId: ml.id } });
    const actuales = ((await env.prisma.agencia.findUniqueOrThrow({ where: { id: agencia.id } })).servicioIds as number[]) ?? [];
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { servicioIds: [...actuales, lavado.id] } });

    const creado: any = await service.create(
      { placa: 'CST-0002', modelo: 'Corolla', servicioCatalogoId: lavado.id, bahiaId: bahia.id, ordenTrabajoOT: `${env.marca}-OT-LIQUIDO`.toUpperCase(), fotoIngresoUrl: 'https://x/ingreso.mp4' } as any,
      lavador.id,
      { id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades: ['servicios.generales.crear'], ambito: 'GLOBAL' } },
    );
    const id = (Array.isArray(creado) ? creado[0] : creado).id as string;

    const [consumo] = await env.prisma.consumoServicio.findMany({ where: { servicioId: id } });
    expect(Number(consumo.cantidadUsada)).toBe(10);
    expect(Number(consumo.costoUnitarioUSD)).toBe(0.01); // $10 ÷ 1000 ml
    expect(Number(consumo.costoTotalUSD)).toBe(0.1);
    const stock = await env.prisma.stockUbicacion.findFirstOrThrow({ where: { insumoId: liquido.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id } });
    expect(Number(stock.cantidadActual)).toBe(8990);
  });
});
