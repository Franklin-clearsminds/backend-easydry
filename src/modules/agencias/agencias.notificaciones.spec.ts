import { describe, expect, it, vi } from 'vitest';
import { AgenciasService } from './agencias.service.js';

function armar() {
  const prisma: any = {
    bahiaOperador: { findMany: vi.fn().mockResolvedValue([]) },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', nombre: 'Agencia Uno', regionId: 'r1' }) },
    region: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', nombre: 'Costa' }) },
    role: { findUnique: vi.fn().mockResolvedValue({ id: 'role-aprobador', namerol: 'APROBADOR', ambito: 'AGENCIA' }) },
  };
  const notifications = {
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
    resolverDestinatariosPorRol: vi.fn().mockResolvedValue(['admin-1']),
  };
  const service = new AgenciasService(prisma, notifications as any);
  return { prisma, notifications, service };
}

describe('AgenciasService — notificación de cambios de usuario', () => {
  it('toggleEstadoUsuario: avisa al propio usuario + admin/super admin', async () => {
    const { prisma, notifications, service } = armar();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', name: 'Ana', lastname: 'P', estado: 1 });
    prisma.user.update.mockResolvedValue({ id: 'u1', name: 'Ana', lastname: 'P', estado: 0, role: null, agencia: null, region: null });

    await service.toggleEstadoUsuario({ usuarioId: 'u1', estado: 0 } as any);

    expect(notifications.resolverDestinatariosPorRol).toHaveBeenCalledWith({ global: ['ADMIN', 'SUPER_ADMIN'] });
    const [ids, titulo] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(expect.arrayContaining(['u1', 'admin-1']));
    expect(titulo).toContain('desactivada');
  });

  it('asignarUsuario (transferencia): avisa al usuario transferido', async () => {
    const { prisma, notifications, service } = armar();
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', estado: 1 });
    prisma.user.update.mockResolvedValue({
      id: 'u1', name: 'Ana', lastname: 'P',
      agencia: { id: 'a1', nombre: 'Agencia Uno' }, region: { id: 'r1', nombre: 'Costa' },
    });

    await service.asignarUsuario({ usuarioId: 'u1', agenciaId: 'a1' } as any);

    const [ids, titulo, body] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(expect.arrayContaining(['u1', 'admin-1']));
    expect(titulo).toContain('asignación');
    expect(body).toContain('Agencia Uno');
  });

  it('updateUsuario: cambio de rol dispara la notificación', async () => {
    const { prisma, notifications, service } = armar();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', roleId: 'role-lider', role: { namerol: 'LIDER' }, estado: 1, agenciaId: 'a1', regionId: null, bodegaId: null,
    });
    prisma.user.update.mockResolvedValue({
      id: 'u1', name: 'Ana', lastname: 'P', estado: 1, agenciaId: 'a1',
      role: { namerol: 'APROBADOR' }, agencia: null, region: null, bodega: null, servicioIds: null,
    });

    await service.updateUsuario({ id: 'u1', roleId: 'role-aprobador' } as any);

    const [ids, titulo, body] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(expect.arrayContaining(['u1', 'admin-1']));
    expect(titulo).toContain('actualizada');
    expect(body).toContain('APROBADOR');
  });

  it('updateUsuario: sin cambio de rol ni estado, no notifica', async () => {
    const { prisma, notifications, service } = armar();
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1', roleId: 'role-lider', role: { namerol: 'LIDER' }, estado: 1, agenciaId: 'a1', regionId: null, bodegaId: null,
    });
    prisma.user.update.mockResolvedValue({
      id: 'u1', name: 'Ana', lastname: 'Nueva', estado: 1, agenciaId: 'a1',
      role: { namerol: 'LIDER' }, agencia: null, region: null, bodega: null, servicioIds: null,
    });

    await service.updateUsuario({ id: 'u1', name: 'Ana', lastname: 'Nueva' } as any);

    expect(notifications.notificarUsuarios).not.toHaveBeenCalled();
  });
});
