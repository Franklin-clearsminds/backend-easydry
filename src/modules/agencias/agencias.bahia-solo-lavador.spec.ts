import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AgenciasService } from './agencias.service.js';

function armar(rol: string) {
  const prisma: any = {
    bahia: {
      findUnique: vi.fn().mockResolvedValue({ id: 'b1', nombre: 'Bahía 1', agenciaId: 'a1', agencia: { id: 'a1', maxLavadoresPorBahia: 1 }, operadorActualId: null }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'u1', name: 'Ana', agenciaId: 'a1', role: { namerol: rol }, bahiaOperadores: [] }),
      update: vi.fn().mockResolvedValue({}),
    },
    role: { findFirst: vi.fn().mockResolvedValue({ id: 'r-pulidor', namerol: 'PULIDOR' }) },
    bahiaOperador: {
      findMany: vi.fn().mockResolvedValue([{ bahiaId: 'b1' }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    historialAsignacionBahia: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const service = new AgenciasService(prisma, { notificarUsuarios: vi.fn() } as any);
  return { prisma, service };
}

describe('La bahía es solo para lavadores', () => {
  it('asignarOperadorABahia rechaza a un pulidor', async () => {
    const { service } = armar('PULIDOR');
    await expect(service.asignarOperadorABahia({ bahiaId: 'b1', operadorId: 'u1' } as any, 'admin')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateOperador libera la bahía cuando el rol deja de ser lavador', async () => {
    const { prisma, service } = armar('LAVADOR');
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'u1', name: 'Ana', agenciaId: 'a1', role: { namerol: 'LAVADOR' }, bahiaOperadores: [] })
      .mockResolvedValue({ id: 'u1', name: 'Ana', agenciaId: 'a1', role: { namerol: 'PULIDOR' }, bahiaOperadores: [] });

    await service.updateOperador({ id: 'u1', rol: 'PULIDOR', bahiaId: 'b1' } as any, 'admin');

    expect(prisma.bahiaOperador.updateMany).toHaveBeenCalledWith({ where: { operadorId: 'u1', activo: true }, data: { activo: false } });
    expect(prisma.bahia.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b1'] }, operadorActualId: 'u1' }, data: { operadorActualId: null } });
    // No se le asigna la bahía que venía en el formulario.
    expect(prisma.bahia.findUnique).not.toHaveBeenCalled();
  });
});
