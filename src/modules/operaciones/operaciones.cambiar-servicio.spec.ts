import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OperacionesService } from './operaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real. Los insumos se descuentan al REGISTRAR la OT, así que:
 *  - cambiar el servicio de una OT devuelve los insumos del anterior y descuenta los del nuevo (con su precio);
 *  - si el stock no alcanza para el nuevo, no se cambia nada;
 *  - anular una OT (en espera, en proceso o finalizada) devuelve sus insumos, una sola vez.
 */
describe('Servicios: cambiar el servicio de una OT y anular devuelven los insumos (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let agencia: any, bahia: any, lavador: any;
  let sA: any, sB: any, sC: any, sFuera: any;
  let iA: any, iB: any;
  const ot = (sufijo: string) => `${env.marca}-OT-${sufijo}`.toUpperCase();
  const con = (...capacidades: string[]) => ({ id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades, ambito: 'GLOBAL' } });
  const stockDe = async (insumoId: string) =>
    Number((await env.prisma.stockUbicacion.findFirstOrThrow({ where: { insumoId, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id } })).cantidadActual);
  const fila = (id: string) => env.prisma.servicioLavado.findUniqueOrThrow({ where: { id }, include: { consumos: true } });
  const nuevaOT = async (sufijo: string, servicioId: number) => {
    const r: any = await service.create(
      { placa: 'ABC-1234', modelo: 'Corolla', servicioCatalogoId: servicioId, bahiaId: bahia.id, ordenTrabajoOT: ot(sufijo), fotoIngresoUrl: 'https://x/ingreso.mp4' } as any,
      lavador.id,
      con('servicios.generales.crear'),
    );
    return (Array.isArray(r) ? r[0] : r).id as string;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);
    const region = await env.region('R1');
    agencia = await env.agencia('A1', { regionId: region.id });
    bahia = await env.bahia('B1', agencia.id);
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: agencia.id });
    await env.prisma.bahiaOperador.create({ data: { bahiaId: bahia.id, operadorId: lavador.id } });

    iA = await env.insumo('A');
    iB = await env.insumo('B');
    const unidadId = (await env.prisma.insumo.findUniqueOrThrow({ where: { id: iA.id } })).unidadMedidaId;
    await env.stock({ insumoId: iA.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id, cantidad: 100 });
    await env.stock({ insumoId: iB.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id, cantidad: 1 });

    sA = await env.catalogo('A', { precio: 10 });
    sB = await env.catalogo('B', { precio: 20 });
    sC = await env.catalogo('C', { precio: 30 });
    sFuera = await env.catalogo('FUERA', { precio: 40 });
    const receta = (catalogoServicioId: number, insumoId: string, cantidadUsada: number) =>
      env.prisma.recetaInsumo.create({ data: { catalogoServicioId, insumoId, cantidadUsada, unidadConsumoId: unidadId } });
    await receta(sA.id, iA.id, 2);
    await receta(sB.id, iB.id, 2); // la agencia solo tiene 1: no alcanza
    await receta(sC.id, iA.id, 3);
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { servicioIds: [sA.id, sB.id, sC.id] } });
    // La agencia tiene fijado su propio precio para el servicio C.
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: agencia.id, catalogoServicioId: sC.id, precio: 55 } });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('cambiar el servicio al editar', () => {
    it('devuelve los insumos del servicio anterior, descuenta los del nuevo y recalcula el precio', async () => {
      const inicial = await stockDe(iA.id);
      const id = await nuevaOT('cambia', sA.id);
      expect(await stockDe(iA.id)).toBe(inicial - 2);
      expect(Number((await fila(id)).precio)).toBe(10);

      await service.update(id, { id, servicioCatalogoId: sC.id } as any, false, con('servicios.generales.editar'));

      const f = await fila(id);
      expect(f.servicioCatalogoId).toBe(sC.id);
      expect(Number(f.precio)).toBe(55); // el precio de la agencia manda sobre el del catálogo
      expect(f.consumos.map((c) => [c.insumoId, Number(c.cantidadUsada)])).toEqual([[iA.id, 3]]);
      expect(await stockDe(iA.id)).toBe(inicial - 3); // se devolvieron 2 y se descontaron 3
      const reversa = await env.prisma.kardexMovimiento.count({ where: { referenciaId: id, tipoMovimiento: 'EDICION_SERVICIO_REVERSA' } });
      expect(reversa).toBe(1);
    });

    it('sin «Editar OT» no se cambia el servicio', async () => {
      const id = await nuevaOT('sin-permiso', sA.id);

      await expect(service.update(id, { id, servicioCatalogoId: sC.id } as any, false, con('servicios.generales.finalizar'))).rejects.toBeInstanceOf(ForbiddenException);
      expect((await fila(id)).servicioCatalogoId).toBe(sA.id);
    });

    it('si el stock no alcanza para el servicio nuevo, no cambia nada', async () => {
      const id = await nuevaOT('sin-stock', sA.id);
      const antes = await stockDe(iA.id);

      await expect(service.update(id, { id, servicioCatalogoId: sB.id } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(BadRequestException);

      const f = await fila(id);
      expect(f.servicioCatalogoId).toBe(sA.id);
      expect(f.consumos).toHaveLength(1);
      expect(await stockDe(iA.id)).toBe(antes);
    });

    it('el servicio nuevo debe estar en la lista de servicios de la agencia', async () => {
      const id = await nuevaOT('fuera-lista', sA.id);

      await expect(service.update(id, { id, servicioCatalogoId: sFuera.id } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(BadRequestException);
      expect((await fila(id)).servicioCatalogoId).toBe(sA.id);
    });

    it('una OT finalizada ya no cambia de servicio', async () => {
      const id = await nuevaOT('finalizada', sA.id);
      await env.prisma.servicioLavado.update({ where: { id }, data: { estado: 'FINALIZADO' } });

      await expect(service.update(id, { id, servicioCatalogoId: sC.id } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('no se puede repetir un servicio que la misma OT ya tiene', async () => {
      const a = await nuevaOT('repetido', sA.id);
      const b: any = await service.create(
        { placa: 'ABC-1234', modelo: 'Corolla', servicioCatalogoId: sC.id, bahiaId: bahia.id, ordenTrabajoOT: ot('repetido') } as any,
        lavador.id,
        con('servicios.generales.agregar'),
      );
      expect((Array.isArray(b) ? b[0] : b).id).toBeTruthy();

      await expect(service.update(a, { id: a, servicioCatalogoId: sC.id } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('anular devuelve los insumos', () => {
    it('una OT en proceso (aún no finalizada) devuelve sus insumos al anularse, y solo una vez', async () => {
      const antes = await stockDe(iA.id);
      const id = await nuevaOT('anula', sA.id);
      expect(await stockDe(iA.id)).toBe(antes - 2);

      await service.softDelete(id, 'Se registró por error', true);
      expect(await stockDe(iA.id)).toBe(antes);

      await service.softDelete(id, 'Segundo intento', true);
      expect(await stockDe(iA.id)).toBe(antes);
    });

    it('con reponerInsumos = false no devuelve nada', async () => {
      const antes = await stockDe(iA.id);
      const id = await nuevaOT('anula-sin', sA.id);

      await service.softDelete(id, 'Insumo ya usado', false);

      expect(await stockDe(iA.id)).toBe(antes - 2);
    });
  });
});
