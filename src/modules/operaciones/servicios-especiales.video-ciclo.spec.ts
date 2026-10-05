import { describe, expect, it, vi } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';

const especial = (extra: Record<string, unknown> = {}) => ({
  id: 'e1', codigoSE: 'SE-001', deletedAt: null, version: 1, observaciones: null,
  agenciaId: 'a1', regionId: 'r1', operadorId: 'pul-9',
  agencia: { id: 'a1', regionId: 'r1' }, operador: null, region: null,
  historialPausas: [],
  videoUltimaReanudacionUrl: null,
  ...extra,
});

function armar(item: any) {
  const prisma: any = {
    servicioEspecial: {
      findFirst: vi.fn().mockResolvedValue(item),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...item, ...a.data })),
    },
  };
  return { prisma, service: new ServiciosEspecialesService(prisma, new DecisionesService(prisma)) };
}

describe('adjuntarVideoCiclo — confirmación de video de reanudación (offline)', () => {
  it('vincula el video cuando el servidor ya quedó "en proceso" antes de que llegue la confirmación de subida', async () => {
    const item = especial({
      estado: 'en proceso',
      historialPausas: [{ fechaInicio: '2026-09-30T10:00:00Z', fechaFin: '2026-09-30T10:05:00Z', videoReanudacionUrl: undefined }],
    });
    const { service, prisma } = armar(item);

    const resultado = await service.adjuntarVideoCiclo(
      'REANUDACION',
      { id: 'e1', url: 'https://s3.example.com/video-reanudar.mp4' },
      { id: 'pul-9' },
    );

    expect(prisma.servicioEspecial.update).toHaveBeenCalledTimes(1);
    const data = prisma.servicioEspecial.update.mock.calls[0][0].data;
    expect(data.videoReanudacionUrl).toBe('https://s3.example.com/video-reanudar.mp4');
    expect(data.videoUltimaReanudacionUrl).toBe('https://s3.example.com/video-reanudar.mp4');
    expect(resultado).toBeDefined();
  });

  it('no repite la escritura si el video confirmado ya es el que está vinculado (confirmación duplicada)', async () => {
    const item = especial({
      estado: 'en proceso',
      videoUltimaReanudacionUrl: 'https://s3.example.com/ya-vinculado.mp4',
      historialPausas: [{ fechaInicio: '2026-09-30T10:00:00Z', fechaFin: '2026-09-30T10:05:00Z', videoReanudacionUrl: 'https://s3.example.com/ya-vinculado.mp4' }],
    });
    const { service, prisma } = armar(item);

    await service.adjuntarVideoCiclo(
      'REANUDACION',
      { id: 'e1', url: 'https://s3.example.com/ya-vinculado.mp4' },
      { id: 'pul-9' },
    );

    expect(prisma.servicioEspecial.update).not.toHaveBeenCalled();
  });

  it('sigue reanudando normalmente cuando la confirmación llega primero (estado aún "pausado")', async () => {
    const item = especial({ estado: 'pausado', fechaUltimaPausa: '2026-09-30T10:05:00Z' });
    const { service, prisma } = armar(item);

    await service.adjuntarVideoCiclo(
      'REANUDACION',
      { id: 'e1', url: 'https://s3.example.com/video-reanudar.mp4' },
      { id: 'pul-9' },
    );

    const data = prisma.servicioEspecial.update.mock.calls[0][0].data;
    expect(data.estado).toBe('En Proceso');
    expect(data.videoReanudacionUrl).toBe('https://s3.example.com/video-reanudar.mp4');
  });
});
