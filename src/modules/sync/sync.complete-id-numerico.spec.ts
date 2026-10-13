import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Bug real reportado por el usuario el 2026-09-30: al crear una OT offline, la app móvil le asigna un id numérico de
 * placeholder (1, 2, 3...) que nunca es un id real de servidor (`agregarServicios` en DataContext.tsx). El CREATE lo
 * descarta antes de encolar, pero el COMPLETE (al finalizar) lo mandaba tal cual en `data.id`. Como
 * `ServicioLavado.id` es un `String @id` en Prisma, la consulta `findFirst({ where: { OR: [..., { id: 1 }] } })`
 * fallaba con un error de VALIDACIÓN de Prisma ("Invalid invocation"), tumbando la mutación completa — la OT se
 * quedaba en EN_PROCESO para siempre y el usuario no tenía forma de finalizarla.
 */
describe('COMPLETE con id numérico de placeholder (bug del 2026-09-30) — base real', () => {
  let env: Entorno;
  let service: SyncService;
  let lavador: any;
  let bahia: any;
  let catalogo: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new SyncService(
      env.prisma as never,
      new OperacionesService(env.prisma as never),
      new ServiciosEspecialesService(env.prisma as never),
      env.storage(),
    );
    const region = await env.region('R1');
    const a1 = await env.agencia('A1', { regionId: region.id });
    bahia = await env.bahia('B1', a1.id);
    catalogo = await env.catalogo('LAVADO');
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: a1.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('no revienta la consulta cuando data.id es un número: usa clientUuid para encontrar la fila', async () => {
    const clientUuid = `${env.marca}-cli_abc123`;
    const servicio = await env.servicioLavado({
      bahiaId: bahia.id,
      operadorId: lavador.id,
      catalogoId: catalogo.id,
      estado: 'EN_PROCESO',
      horaSalida: null,
      datos: { clientUuid },
    });

    const resultado = await service.processPush(
      {
        mutations: [
          {
            mutationId: `${env.marca}-op-complete-1`,
            clientUuid,
            entity: 'servicio_lavado',
            action: 'COMPLETE',
            timestamp: Date.now(),
            data: { id: 1, estado: 'FINALIZADO', status: 'COMPLETED' }, // id numérico de placeholder, como manda(ba) la app
          },
        ],
      },
      lavador.id,
    );

    expect(resultado.results[0].status).toBe('APPLIED');
    // La fila encontrada por clientUuid quedó finalizada.
    expect((await env.prisma.servicioLavado.findUniqueOrThrow({ where: { id: servicio.id } })).estado).toBe('FINALIZADO');
  });
});
