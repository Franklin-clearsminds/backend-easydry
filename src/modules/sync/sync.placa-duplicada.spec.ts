import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Cuando el backend detecta que la placa ya tiene otra orden activa en la agencia (ventana de 4h), la registra en
 * `syncDeadLetterQueue` para resolución manual — pero antes le devolvía al cliente `status: 'FAILED'`, no
 * `'DEAD_LETTER'`. El outbox del móvil reintenta un `FAILED` cada ciclo de sync (30s) para siempre: como la condición
 * nunca se resuelve sola, esto reintentaba un rechazo ya definitivo sin fin y sin que nadie se enterara.
 * Ver conversación con el usuario del 2026-09-30.
 *
 * Mundo: Agencia A1 con la bahía B1, un lavador y una orden activa de la placa DUP; la bahía y el servicio del
 * catálogo pertenecen a A1.
 */
describe('placa con otra orden activa (ventana de 4h) — base real', () => {
  let env: Entorno;
  let service: SyncService;
  let lavador: any;
  let bahia: any;
  let catalogo: any;
  let placa: string;

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
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [catalogo.id] } });
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: a1.id });
    placa = `DUP-${env.marca.slice(1, 5).toUpperCase()}`;
    // La orden activa que ya existe para esa placa en la agencia.
    await env.servicioLavado({ bahiaId: bahia.id, operadorId: lavador.id, catalogoId: catalogo.id, estado: 'EN_PROCESO', placa, horaSalida: null });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('devuelve DEAD_LETTER, no FAILED, para que el móvil deje de reintentar un rechazo definitivo', async () => {
    const mutationId = `${env.marca}-op-crear-1`;
    const resultado = await service.processPush(
      {
        mutations: [
          {
            mutationId,
            clientUuid: `${env.marca}-uuid-1`,
            entity: 'servicio_lavado',
            action: 'CREATE',
            timestamp: Date.now(),
            data: { placa, bahiaId: bahia.id, servicioCatalogoId: catalogo.id },
          },
        ],
      },
      lavador.id,
    );

    expect(resultado.results[0].status).toBe('DEAD_LETTER');
    expect(resultado.results[0].error).toMatch(/POSIBLE_DUPLICADO_PLACA/);
    // Y quedó registrada para resolución manual, no solo devuelta al cliente.
    const enCola = await env.prisma.syncDeadLetterQueue.findUniqueOrThrow({ where: { mutationId } });
    expect(enCola.errorMotivo).toContain('POSIBLE_DUPLICADO_PLACA');
    expect(enCola.resuelto).toBe(false);
    // No se creó una segunda orden para esa placa.
    expect(await env.prisma.servicioLavado.count({ where: { placa, bahiaId: bahia.id, deletedAt: null } })).toBe(1);
  });
});
