import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Precio efectivo de una OT general al crearla: override de la agencia si existe, si no el precio global del catálogo;
 * en ambos casos queda congelado en el registro (no se recalcula después).
 *
 * Mundo: Agencia A1 con la bahía B1 y tres lavadores vinculados a ella; el servicio "Lavado Express" (precio de
 * catálogo 12,50) está habilitado en A1. Cada prueba usa su propio servicio de catálogo para fijar su precio y su override.
 */
describe('OperacionesService.create — precio congelado (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let a1: any;
  let otraAgencia: any;
  let bahia: any;
  const lavadores: any[] = [];
  let n = 0;

  /** Un servicio de catálogo habilitado en A1 con el precio dado. */
  const servicioConPrecio = async (precio: number) => {
    const c = await env.catalogo(`P${++n}`, { precio });
    const actuales = ((await env.prisma.agencia.findUniqueOrThrow({ where: { id: a1.id } })).servicioIds as number[]) ?? [];
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [...actuales, c.id] } });
    return c;
  };
  const dto = (servicioCatalogoId: number, extra: Record<string, unknown> = {}) =>
    ({
      placa: 'ABC-1234',
      modelo: 'Corolla',
      servicioCatalogoId,
      bahiaId: bahia.id,
      ordenTrabajoOT: `${env.marca}-OT-${++n}`,
      ...extra,
    }) as any;
  const enBase = (id: string) =>
    env.prisma.servicioLavado.findUniqueOrThrow({ where: { id }, include: { operadoresAsignados: true } });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);

    const region = await env.region('R1');
    a1 = await env.agencia('A1', { regionId: region.id });
    otraAgencia = await env.agencia('A2', { regionId: region.id });
    bahia = await env.bahia('B1', a1.id);
    for (const i of [1, 2, 3]) {
      const l = await env.usuario(`lav-${i}`, 'LAVADOR', { agenciaId: a1.id });
      await env.prisma.bahiaOperador.create({ data: { bahiaId: bahia.id, operadorId: l.id } });
      lavadores.push(l);
    }
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('asigna a la OT todos los lavadores activos seleccionados y vinculados a la bahía', async () => {
    const c = await servicioConPrecio(10);
    const ids = lavadores.map((l) => l.id);
    const creado: any = await service.create(dto(c.id, { operadorIds: ids }), lavadores[0].id);

    const fila = await enBase(creado.id);
    expect(fila.operadorId).toBe(ids[0]); // el responsable principal es el primero
    expect(fila.operadoresAsignados.map((a) => a.operadorId).sort()).toEqual([...ids].sort());
  });

  it('rechaza un lavador que no está vinculado a la bahía elegida, y no crea nada', async () => {
    const c = await servicioConPrecio(10);
    const sinVinculo = await env.usuario('lav-sin-vinculo', 'LAVADOR', { agenciaId: a1.id });
    const d = dto(c.id, { operadorIds: [lavadores[0].id, sinVinculo.id] });
    await expect(service.create(d, lavadores[0].id)).rejects.toThrow(/asignación activa a la bahía/);
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: d.ordenTrabajoOT.toUpperCase() } })).toBe(0);
  });

  it('usa el precio global del catálogo cuando la agencia no tiene override', async () => {
    const c = await servicioConPrecio(12.5);
    const creado: any = await service.create(dto(c.id), lavadores[0].id);
    expect(Number((await enBase(creado.id)).precio)).toBe(12.5);
  });

  it('usa el override de la agencia cuando existe, aunque difiera del precio del catálogo', async () => {
    const c = await servicioConPrecio(12.5);
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: a1.id, catalogoServicioId: c.id, precio: 9.99 } });
    const creado: any = await service.create(dto(c.id), lavadores[0].id);
    expect(Number((await enBase(creado.id)).precio)).toBe(9.99);
  });

  it('solo cuenta el override de ESA agencia y de ESE servicio', async () => {
    const c = await servicioConPrecio(12.5);
    const otro = await servicioConPrecio(30);
    // Un override del mismo servicio en otra agencia, y uno de otro servicio en esta agencia: ninguno aplica.
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: otraAgencia.id, catalogoServicioId: c.id, precio: 1 } });
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: a1.id, catalogoServicioId: otro.id, precio: 2 } });
    const creado: any = await service.create(dto(c.id), lavadores[0].id);
    expect(Number((await enBase(creado.id)).precio)).toBe(12.5);
  });

  it('el precio queda congelado: un cambio posterior del catálogo o del override no afecta a la OT', async () => {
    const c = await servicioConPrecio(10);
    const creado: any = await service.create(dto(c.id), lavadores[0].id);
    await env.prisma.catalogoServicio.update({ where: { id: c.id }, data: { precio: 99 } });
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: a1.id, catalogoServicioId: c.id, precio: 98 } });
    expect(Number((await enBase(creado.id)).precio)).toBe(10);
  });
});
