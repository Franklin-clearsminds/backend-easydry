import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el precio de un servicio especial se congela desde el catálogo al crearlo.
 *
 * Mundo: una agencia A1 de la región R1 (sin pulidor fijo), un pulidor móvil de R1 con insumos en su kit (la creación
 * lo exige) y el coordinador de servicios especiales. Cada prueba usa su propio servicio de catálogo ESPECIAL.
 */
describe('ServiciosEspecialesService.create — precio congelado desde el catálogo (base real)', () => {
  let env: Entorno;
  let service: ServiciosEspecialesService;
  let a1: any;
  let pulidor: any;
  let insumo: any;
  let coordinador: any;
  let n = 0;

  const dto = (extra: Record<string, unknown> = {}) =>
    ({
      ordenTrabajoOT: `${env.marca}-ot-esp-${++n}`,
      tipoServicio: `${env.marca} servicio sin catálogo`,
      operadorId: pulidor.id,
      agenciaId: a1.id,
      vehiculoInfo: { placa: 'XYZ-999' },
      recetaInsumos: [{ insumoId: insumo.id, cantidad: 0 }], // el kit del pulidor tiene este insumo
      ...extra,
    }) as any;
  /** La OT en mayúsculas es el código del servicio creado. */
  const creado = async (d: any) => {
    const fila = await env.prisma.servicioEspecial.findFirstOrThrow({ where: { codigoSE: d.ordenTrabajoOT.toUpperCase() } });
    env.rastrear('ServicioEspecial', fila.id);
    return fila;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new ServiciosEspecialesService(env.prisma as never, new DecisionesService(env.prisma as never));

    const region = await env.region('R1');
    a1 = await env.agencia('A1', { regionId: region.id });
    pulidor = await env.usuario('pulidor', 'PULIDOR', { regionId: region.id });
    coordinador = await env.actor((await env.usuario('coord', 'COORD_SERVICIOS_ESPECIALES')).id);
    insumo = await env.insumo('KIT');
    await env.stock({ insumoId: insumo.id, tipoUbicacion: 'PULIDOR_MOVIL', pulidorId: pulidor.id, cantidad: 50 });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('usa el catálogo indicado por servicioCatalogoId y congela su precio', async () => {
    const c = await env.catalogo('ESPECIAL-1', { categoria: 'ESPECIAL', precio: 20 });
    const d = dto({ servicioCatalogoId: c.id });
    await service.create(d, coordinador.id, coordinador);
    const fila = await creado(d);
    expect(fila.servicioCatalogoId).toBe(c.id);
    expect(Number(fila.precio)).toBe(20);
  });

  it('sin servicioCatalogoId, lo resuelve por el nombre de tipoServicio contra el catálogo ESPECIAL', async () => {
    const c = await env.catalogo('ESPECIAL-2', { categoria: 'ESPECIAL', precio: 30 });
    const d = dto({ tipoServicio: c.nombre });
    await service.create(d, coordinador.id, coordinador);
    const fila = await creado(d);
    expect(fila.servicioCatalogoId).toBe(c.id);
    expect(Number(fila.precio)).toBe(30);
  });

  it('un servicio con ese nombre pero de la categoría GENERAL no se toma (solo ESPECIAL)', async () => {
    const general = await env.catalogo('GENERAL-1', { categoria: 'GENERAL', precio: 5 });
    const d = dto({ tipoServicio: general.nombre });
    await service.create(d, coordinador.id, coordinador);
    const fila = await creado(d);
    expect(fila.servicioCatalogoId).toBeNull();
    expect(fila.precio).toBeNull();
  });

  it('si no se resuelve ningún catálogo, la OT se crea igual sin precio (no bloquea)', async () => {
    const d = dto();
    await service.create(d, coordinador.id, coordinador);
    const fila = await creado(d);
    expect(fila.servicioCatalogoId).toBeNull();
    expect(fila.precio).toBeNull();
  });

  it('usa el precio que la agencia tiene fijado para ese servicio especial, no el del catálogo', async () => {
    const c = await env.catalogo('ESPECIAL-4', { categoria: 'ESPECIAL', precio: 0 });
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: a1.id, catalogoServicioId: c.id, precio: 85 } });
    const d = dto({ servicioCatalogoId: c.id });
    await service.create(d, coordinador.id, coordinador);
    expect(Number((await creado(d)).precio)).toBe(85);
  });

  it('una agencia sin precio fijado para el servicio especial queda con el valor del catálogo (0 si no tiene precio base)', async () => {
    const c = await env.catalogo('ESPECIAL-5', { categoria: 'ESPECIAL', precio: 0 });
    const d = dto({ servicioCatalogoId: c.id });
    await service.create(d, coordinador.id, coordinador);
    expect(Number((await creado(d)).precio)).toBe(0);
  });

  it('el precio queda congelado: un cambio posterior del catálogo no afecta a la OT', async () => {
    const c = await env.catalogo('ESPECIAL-3', { categoria: 'ESPECIAL', precio: 40 });
    const d = dto({ servicioCatalogoId: c.id });
    await service.create(d, coordinador.id, coordinador);
    await env.prisma.catalogoServicio.update({ where: { id: c.id }, data: { precio: 99 } });
    expect(Number((await creado(d)).precio)).toBe(40);
  });
});
