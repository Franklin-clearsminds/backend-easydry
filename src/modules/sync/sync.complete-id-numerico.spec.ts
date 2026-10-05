import { describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service.js';

/**
 * Bug real reportado por el usuario el 2026-09-30: al crear una OT offline, la app móvil le asigna
 * un id numérico de placeholder (1, 2, 3...) que nunca es un id real de servidor (`agregarServicios`
 * en DataContext.tsx). El CREATE lo descarta antes de encolar, pero el COMPLETE (al finalizar) lo
 * mandaba tal cual en `data.id`. Como `ServicioLavado.id` es un `String @id` en Prisma, la consulta
 * `findFirst({ where: { OR: [..., { id: 1 }] } })` fallaba con un error de VALIDACIÓN de Prisma
 * ("Invalid invocation"), tumbando la mutación completa — la OT se quedaba en EN_PROCESO para
 * siempre y el usuario no tenía forma de finalizarla.
 */
function armarPrisma(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'op-1', estado: 1, agenciaId: 'agencia-1',
        role: { namerol: 'LAVADOR' },
        agencia: { id: 'agencia-1', bahias: [] },
      }),
    },
    syncDevice: { upsert: vi.fn().mockResolvedValue({}) },
    syncOutboxAudit: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    servicioLavado: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'srv-real-uuid', clientUuid: 'cli_abc123', estado: 'EN_PROCESO', version: 1, observaciones: null,
      }),
    },
    ...overrides,
  };
  return { prisma, service: new SyncService(prisma, { update: vi.fn().mockResolvedValue({ id: 'srv-real-uuid' }) } as any, {} as any, {} as any) };
}

describe('COMPLETE con id numérico de placeholder (bug del 2026-09-30)', () => {
  it('no revienta la consulta cuando data.id es un número: usa clientUuid para encontrar la fila', async () => {
    const { prisma, service } = armarPrisma();
    const resultado = await service.processPush(
      {
        mutations: [{
          mutationId: 'op-complete-1', clientUuid: 'cli_abc123', entity: 'servicio_lavado', action: 'COMPLETE',
          timestamp: Date.now(),
          data: { id: 1, estado: 'FINALIZADO', status: 'COMPLETED' }, // id numérico de placeholder, como manda(ba) la app
        }],
      },
      'op-1',
    );

    // La consulta debe haberse ejecutado con `id` convertido a string (no el número crudo 1).
    const where = prisma.servicioLavado.findFirst.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ id: '1' });

    expect(resultado.results[0].status).toBe('APPLIED');
  });
});
