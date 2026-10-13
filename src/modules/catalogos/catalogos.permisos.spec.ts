import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CatalogosService } from './catalogos.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: cada botón del Catálogo de Servicios tiene su casilla, separada para generales y especiales.
 * El precio nunca se fija desde el formulario del catálogo y los servicios no se eliminan: se activan o desactivan.
 */
describe('Catálogo de servicios: una casilla por botón y por categoría (base real)', () => {
  let env: Entorno;
  let service: CatalogosService;
  let general: any, especial: any;
  const con = (...capacidades: string[]) => ({ id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades, ambito: 'GLOBAL' } });
  const nuevo = (sufijo: string, categoria: string) =>
    ({ codigo: `${env.marca}-N-${sufijo}`, nombre: `Nuevo ${sufijo}`, categoria, precio: 99, tiempoEstimadoMin: 20 }) as any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new CatalogosService(env.prisma as never);
    general = await env.catalogo('G', { precio: 15 });
    especial = await env.catalogo('E', { categoria: 'ESPECIAL', precio: 25 });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('crear: cada categoría pide su propia casilla', async () => {
    await expect(service.createServicio(nuevo('a', 'GENERAL'), con('catalogo.especiales.crear'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createServicio(nuevo('b', 'ESPECIAL'), con('catalogo.generales.crear'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.createServicio(nuevo('c', 'GENERAL'), con('catalogo.generales.crear'))).resolves.toBeDefined();
    await expect(service.createServicio(nuevo('d', 'ESPECIAL'), con('catalogo.especiales.crear'))).resolves.toBeDefined();
  });

  it('crear no fija precio: queda en 0 aunque el formulario mande otro', async () => {
    const creado: any = await service.createServicio(nuevo('p', 'GENERAL'), con('catalogo.generales.crear'));
    expect(Number(creado.precio)).toBe(0);
  });

  it('editar: pide la casilla de la categoría del servicio y nunca cambia el precio', async () => {
    await expect(service.updateServicio({ id: general.id, nombre: 'X' } as any, con('catalogo.especiales.editar'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.updateServicio({ id: general.id, nombre: 'Renombrado', precio: 0 } as any, con('catalogo.generales.editar'))).resolves.toBeDefined();
    const despues = await env.prisma.catalogoServicio.findUniqueOrThrow({ where: { id: general.id } });
    expect(despues.nombre).toBe('Renombrado');
    expect(Number(despues.precio)).toBe(15);
  });

  it('un servicio especial no se puede pasar a general sin la casilla de editar de ambas categorías', async () => {
    await expect(service.updateServicio({ id: especial.id, categoria: 'GENERAL' } as any, con('catalogo.especiales.editar'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activar o desactivar: casilla propia, alterna el estado y el servicio sigue existiendo', async () => {
    await expect(service.cambiarEstadoServicio(especial.id, con('catalogo.generales.estado'))).rejects.toBeInstanceOf(ForbiddenException);
    await service.cambiarEstadoServicio(especial.id, con('catalogo.especiales.estado'));
    expect((await env.prisma.catalogoServicio.findUniqueOrThrow({ where: { id: especial.id } })).estado).toBe('Inactivo');
    await service.cambiarEstadoServicio(especial.id, con('catalogo.especiales.estado'));
    expect((await env.prisma.catalogoServicio.findUniqueOrThrow({ where: { id: especial.id } })).estado).toBe('Activo');
  });

  it('no existe forma de eliminar un servicio del catálogo', () => {
    expect((service as any).deleteServicio).toBeUndefined();
  });
});
