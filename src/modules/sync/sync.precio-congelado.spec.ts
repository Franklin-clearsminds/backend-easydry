import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Las OT que se registran desde la app llegan por la sincronización y deben quedar atadas a su precio igual que las de la
 * web: el de la agencia (override) o, si no hay, el del catálogo. Cambiar los precios después no modifica la OT.
 *
 * Mundo: Agencia A1 con la bahía B1, un líder (quien registra las OT desde la app) y un servicio de catálogo habilitado en A1.
 */
describe('sincronización de una OT nueva — precio congelado (base real)', () => {
  let env: Entorno;
  let service: SyncService;
  let a1: any;
  let lider: any;
  let bahia: any;
  let catalogo: any;
  let n = 0;

  const crearDesdeLaApp = async () => {
    n += 1;
    const resultado = await service.processPush(
      {
        mutations: [
          {
            mutationId: `${env.marca}-precio-${n}`,
            clientUuid: `${env.marca}-precio-uuid-${n}`,
            entity: 'servicio_lavado',
            action: 'CREATE',
            timestamp: Date.now(),
            data: {
              placa: `PRC-${env.marca.slice(1, 4).toUpperCase()}${n}`,
              modelo: 'Corolla',
              ordenTrabajoOT: `${env.marca}-OT-PRECIO-${n}`,
              bahiaId: bahia.id,
              servicioCatalogoId: catalogo.id,
            },
          },
        ],
      },
      lider.id,
    );
    expect(resultado.results[0].status).toBe('APPLIED');
    return env.prisma.servicioLavado.findUniqueOrThrow({ where: { id: resultado.results[0].serverAssignedId as string } });
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new SyncService(
      env.prisma as never,
      new OperacionesService(env.prisma as never),
      new ServiciosEspecialesService(env.prisma as never),
      env.storage(),
    );
    const region = await env.region('R1');
    a1 = await env.agencia('A1', { regionId: region.id });
    bahia = await env.bahia('B1', a1.id);
    catalogo = await env.catalogo('LAVADO-PRECIO', { precio: 12.5 });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [catalogo.id] } });
    lider = await env.usuario('lider', 'LIDER', { agenciaId: a1.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('queda con el precio del catálogo cuando la agencia no tiene precio propio, y no cambia si el catálogo cambia', async () => {
    const ot = await crearDesdeLaApp();
    expect(Number(ot.precio)).toBe(12.5);

    await env.prisma.catalogoServicio.update({ where: { id: catalogo.id }, data: { precio: 99 } });
    const despues = await env.prisma.servicioLavado.findUniqueOrThrow({ where: { id: ot.id } });
    expect(Number(despues.precio)).toBe(12.5);
    await env.prisma.catalogoServicio.update({ where: { id: catalogo.id }, data: { precio: 12.5 } });
  });

  it('queda con el precio de la agencia cuando existe, y no cambia si ese precio cambia', async () => {
    await env.prisma.precioAgenciaServicio.upsert({
      where: { agenciaId_catalogoServicioId: { agenciaId: a1.id, catalogoServicioId: catalogo.id } },
      create: { agenciaId: a1.id, catalogoServicioId: catalogo.id, precio: 8 },
      update: { precio: 8 },
    });
    const ot = await crearDesdeLaApp();
    expect(Number(ot.precio)).toBe(8);

    await env.prisma.precioAgenciaServicio.update({
      where: { agenciaId_catalogoServicioId: { agenciaId: a1.id, catalogoServicioId: catalogo.id } },
      data: { precio: 30 },
    });
    const despues = await env.prisma.servicioLavado.findUniqueOrThrow({ where: { id: ot.id } });
    expect(Number(despues.precio)).toBe(8);
  });
});
