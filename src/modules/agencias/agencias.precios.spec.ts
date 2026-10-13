import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Datos de partida: dos servicios GENERALES (10 y 15) y uno ESPECIAL,
 * habilitados en la agencia A1; la agencia A2 es de otro líder.
 */
describe('Precios de servicios por agencia (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let a1: any;
  let express: any;
  let premium: any;
  let especial: any;
  let liderA2: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);

    express = await env.catalogo('EXPRESS', { precio: 10 });
    premium = await env.catalogo('PREMIUM', { precio: 15 });
    especial = await env.catalogo('ESPECIAL', { categoria: 'ESPECIAL', precio: 50 });

    const region = await env.region('R1');
    a1 = await env.agencia('A1', { regionId: region.id });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [express.id, premium.id, especial.id] } });
    const a2 = await env.agencia('A2', { regionId: region.id });
    const lider = await env.usuario('lider-a2', 'LIDER', { agenciaId: a2.id });
    liderA2 = await env.actor(lider.id);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const fila = (lista: any[], id: number) => lista.find((x) => x.catalogoServicioId === id);
  const precioEnBase = async (agenciaId: string, servicioId: number) => {
    const r = await env.prisma.precioAgenciaServicio.findUnique({
      where: { agenciaId_catalogoServicioId: { agenciaId, catalogoServicioId: servicioId } },
    });
    return r ? Number(r.precio) : null;
  };

  describe('listPreciosServicios', () => {
    it('devuelve el precio del catálogo cuando no hay override', async () => {
      const r: any[] = await service.listPreciosServicios({ agenciaId: a1.id } as any);
      expect(fila(r, express.id)).toMatchObject({ codigo: express.codigo, nombre: express.nombre, estado: 'Activo' });
      expect(Number(fila(r, express.id).precioCatalogo)).toBe(10);
      expect(fila(r, express.id).precioAgencia).toBeNull();
      expect(Number(fila(r, express.id).precioEfectivo)).toBe(10);
      expect(Number(fila(r, premium.id).precioEfectivo)).toBe(15);
    });

    it('respeta el alcance: un líder de otra agencia no puede consultar precios ajenos', async () => {
      await expect(service.listPreciosServicios({ agenciaId: a1.id } as any, liderA2)).rejects.toThrow(/no pertenece a tu alcance/);
    });
  });

  describe('setPreciosServicios', () => {
    it('fija el precio de un servicio habilitado y el override manda sobre el precio del catálogo', async () => {
      await service.setPreciosServicios({ agenciaId: a1.id, precios: [{ catalogoServicioId: express.id, precio: 8.5 }] } as any);
      expect(await precioEnBase(a1.id, express.id)).toBe(8.5);

      const r: any[] = await service.listPreciosServicios({ agenciaId: a1.id } as any);
      const f = fila(r, express.id);
      expect(Number(f.precioCatalogo)).toBe(10);
      expect(Number(f.precioAgencia)).toBe(8.5);
      expect(Number(f.precioEfectivo)).toBe(8.5);

      // Volver a fijarlo actualiza la misma fila, no crea otra.
      await service.setPreciosServicios({ agenciaId: a1.id, precios: [{ catalogoServicioId: express.id, precio: 9.99 }] } as any);
      expect(await precioEnBase(a1.id, express.id)).toBe(9.99);
      expect(await env.prisma.precioAgenciaServicio.count({ where: { agenciaId: a1.id, catalogoServicioId: express.id } })).toBe(1);
    });

    it('rechaza un servicio que no está habilitado para la agencia', async () => {
      const otro = await env.catalogo('NO-HABILITADO');
      await expect(
        service.setPreciosServicios({ agenciaId: a1.id, precios: [{ catalogoServicioId: otro.id, precio: 5 }] } as any),
      ).rejects.toThrow(/no están habilitados/);
      expect(await precioEnBase(a1.id, otro.id)).toBeNull();
    });

    it('rechaza fijar precio a un servicio ESPECIAL (el override solo aplica a GENERAL)', async () => {
      await expect(
        service.setPreciosServicios({ agenciaId: a1.id, precios: [{ catalogoServicioId: especial.id, precio: 5 }] } as any),
      ).rejects.toThrow(/no son servicios GENERALES/);
      expect(await precioEnBase(a1.id, especial.id)).toBeNull();
    });
  });
});
