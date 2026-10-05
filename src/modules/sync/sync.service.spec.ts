import { describe, expect, it, vi } from 'vitest';
import { SyncService } from './sync.service.js';

describe('SyncService media tickets', () => {
  it('resuelve agencia y OT canónica para videos de servicios especiales', async () => {
    const prisma = {
      servicioLavado: { findFirst: vi.fn().mockResolvedValue(null) },
      servicioEspecial: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'server-id',
          clientUuid: 'mobile-uuid',
          codigoSE: 'SE-2026-100',
          ordenTrabajoOT: 'OT-2026-100',
          agenciaId: 'agency-id',
        }),
      },
    };
    const storage = {
      generateUploadTicket: vi.fn().mockImplementation((dto) => dto),
    };
    const service = new SyncService(
      prisma as any,
      {} as any,
      {} as any,
      storage as any,
    );

    const result = await service.generateMediaUploadTicket({
      clientUuid: 'mobile-uuid',
      type: 'VIDEO_PAUSA',
      category: 'SERVICIOS_ESPECIALES',
      fileName: 'pausa.mp4',
    });

    expect(storage.generateUploadTicket).toHaveBeenCalledWith(expect.objectContaining({
      agenciaId: 'agency-id',
      servicioId: 'OT-2026-100',
      clientUuid: 'mobile-uuid',
    }));
    expect(result).toEqual(expect.objectContaining({
      agenciaId: 'agency-id',
      servicioId: 'OT-2026-100',
    }));
  });
});
