import { describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service.js';

/**
 * Cuando el backend detecta que la placa ya tiene otra orden activa en la agencia (ventana de 4h),
 * la registra en `syncDeadLetterQueue` para resolución manual — pero antes le devolvía al cliente
 * `status: 'FAILED'`, no `'DEAD_LETTER'`. El outbox del móvil reintenta un `FAILED` cada ciclo de
 * sync (30s) para siempre: como la condición nunca se resuelve sola, esto reintentaba un rechazo ya
 * definitivo sin fin y sin que nadie se enterara. Ver conversación con el usuario del 2026-09-30.
 */
function armarPrisma(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'op-1', estado: 1, agenciaId: 'agencia-1',
        role: { namerol: 'LAVADOR' },
        agencia: { id: 'agencia-1', bahias: [{ id: 'bahia-1', agenciaId: 'agencia-1' }] },
      }),
    },
    syncDevice: { upsert: vi.fn().mockResolvedValue({}) },
    syncOutboxAudit: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    servicioLavado: {
      findUnique: vi.fn().mockResolvedValue(null), // idempotencia: no existe todavía
      findFirst: vi.fn().mockResolvedValue({ id: 'otro-servicio', placa: 'ABC-1234' }), // duplicateActive
    },
    bahia: { findUnique: vi.fn().mockResolvedValue({ id: 'bahia-1', agenciaId: 'agencia-1' }) },
    catalogoServicio: { findUnique: vi.fn().mockResolvedValue({ id: 1, nombre: 'Lavado General' }) },
    syncDeadLetterQueue: { upsert: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
  return { prisma, service: new SyncService(prisma, {} as any, {} as any, {} as any) };
}

describe('placa con otra orden activa (ventana de 4h)', () => {
  it('devuelve DEAD_LETTER, no FAILED, para que el móvil deje de reintentar un rechazo definitivo', async () => {
    const { prisma, service } = armarPrisma();
    const resultado = await service.processPush(
      {
        mutations: [{
          mutationId: 'op-crear-1', clientUuid: 'uuid-1', entity: 'servicio_lavado', action: 'CREATE',
          timestamp: Date.now(),
          data: { placa: 'ABC-1234', bahiaId: 'bahia-1', servicioCatalogoId: 1 },
        }],
      },
      'op-1',
    );

    expect(resultado.results[0].status).toBe('DEAD_LETTER');
    expect(resultado.results[0].error).toMatch(/POSIBLE_DUPLICADO_PLACA/);
    // Y quedó registrada para resolución manual, no solo devuelta al cliente.
    expect(prisma.syncDeadLetterQueue.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ errorMotivo: expect.stringContaining('POSIBLE_DUPLICADO_PLACA') }),
    }));
  });
});
