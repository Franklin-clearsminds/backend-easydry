import { describe, expect, it, vi } from 'vitest';
import { RetosService } from './retos.service.js';

const admin = { id: 'admin-1', roleDetails: { namerol: 'ADMIN', capacidades: [], ambito: 'GLOBAL' } };

function armar(existente: any) {
  const prisma: any = {
    reto: {
      findUnique: vi.fn().mockResolvedValue(existente),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...existente, ...a.data })),
    },
    region: { findMany: vi.fn().mockResolvedValue([{ id: 'r-costa' }, { id: 'r-sierra' }]) },
  };
  const notifications = {
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
    resolverDestinatariosPorRol: vi.fn().mockResolvedValue(['admin-1', 'jefe-com-1']),
  };
  const service = new RetosService(prisma, notifications as any);
  return { prisma, notifications, service };
}

const reto = (extra: Record<string, unknown> = {}) => ({
  id: 'r1', creadoPorId: 'admin-1', estado: 'ACTIVO', titulo: 'Reto de Octubre', regiones: [], ...extra,
});

describe('RetosService.cerrar — notificación', () => {
  it('reto sin regiones (nacional): resuelve destinatarios con regionId "TODAS"', async () => {
    const { notifications, service } = armar(reto({ regiones: [] }));
    await service.cerrar({ id: 'r1', ganadorNombre: 'Juan' } as any, admin);
    expect(notifications.resolverDestinatariosPorRol).toHaveBeenCalledWith({
      global: ['ADMIN', 'SUPER_ADMIN', 'JEFE_COMERCIAL'],
      regionales: ['COORD_COMERCIAL', 'SUPERVISOR'],
      regionId: 'TODAS',
    });
    const [ids, , body] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(['admin-1', 'jefe-com-1']);
    expect(body).toContain('Juan');
  });

  it('reto con "Todas" en regiones: también se trata como nacional', async () => {
    const { notifications, service } = armar(reto({ regiones: ['Todas'] }));
    await service.cerrar({ id: 'r1' } as any, admin);
    expect(notifications.resolverDestinatariosPorRol.mock.calls[0][0].regionId).toBe('TODAS');
  });

  it('reto con regiones específicas: resuelve sus IDs y acota a ellas', async () => {
    const { prisma, notifications, service } = armar(reto({ regiones: ['Costa', 'Sierra'] }));
    await service.cerrar({ id: 'r1' } as any, admin);
    expect(prisma.region.findMany).toHaveBeenCalledWith({ where: { nombre: { in: ['Costa', 'Sierra'] } }, select: { id: true } });
    expect(notifications.resolverDestinatariosPorRol.mock.calls[0][0].regionId).toEqual(['r-costa', 'r-sierra']);
  });

  it('sin ganador, el mensaje no menciona ganador', async () => {
    const { notifications, service } = armar(reto());
    await service.cerrar({ id: 'r1' } as any, admin);
    const [, , body] = notifications.notificarUsuarios.mock.calls[0];
    expect(body).not.toContain('Ganador');
  });
});
