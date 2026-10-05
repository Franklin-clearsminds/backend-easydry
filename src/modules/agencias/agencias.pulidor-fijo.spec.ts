import { describe, expect, it, vi } from 'vitest';
import { AgenciasService } from './agencias.service.js';

/**
 * Cada agencia solo puede tener un pulidor fijo (decisión de producto, ver conversación con el
 * usuario del 2026-09-29): un Excel o un formulario que intente asignar un segundo pulidor con
 * `agenciaId` a una sede que ya tiene uno debe rechazarse, no aceptarse en silencio.
 */
function armarPrisma(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: {
      findUnique: vi.fn().mockResolvedValue(null), // sin conflicto de email / usuario existente
      findFirst: vi.fn().mockResolvedValue(null), // sin otro fijo por defecto
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'nuevo-id', ...a.data, role: { namerol: 'PULIDOR' } })),
      update: vi.fn().mockImplementation(async (a: any) => ({ id: a.where.id, ...a.data, role: { namerol: 'PULIDOR' }, servicioIds: [] })),
    },
    role: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({ id: 'role-pulidor', namerol: 'PULIDOR' }),
    },
    agencia: {
      findFirst: vi.fn().mockResolvedValue({ id: 'agencia-1', regionId: 'region-1', nombre: 'PROAUTO GRANADOS' }),
      findUnique: vi.fn().mockResolvedValue({ id: 'agencia-1', nombre: 'PROAUTO GRANADOS' }),
    },
    catalogoServicio: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  return { prisma, service: new AgenciasService(prisma) };
}

describe('un pulidor fijo por agencia', () => {
  it('createUsuario: rechaza asignar un segundo pulidor fijo a una agencia que ya tiene uno', async () => {
    const { prisma, service } = armarPrisma({
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue({ id: 'moises-id', name: 'MOISES EDUARDO', lastname: 'TUMIPAMBA CHILUISA' }),
        create: vi.fn(),
      },
    });
    await expect(
      service.createUsuario({
        name: 'CHRISTIAN ARIEL',
        lastname: 'GRANDA ELIZALDE',
        email: 'christian@easydry.com',
        password: 'temporal123',
        rolNombre: 'PULIDOR',
        agenciaId: 'agencia-1',
      } as any),
    ).rejects.toThrow(/ya tiene un pulidor fijo asignado/);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('createUsuario: permite crear el pulidor fijo cuando la agencia no tiene ninguno', async () => {
    const { prisma, service } = armarPrisma();
    await service.createUsuario({
      name: 'MOISES EDUARDO',
      lastname: 'TUMIPAMBA CHILUISA',
      email: 'moises@easydry.com',
      password: 'temporal123',
      rolNombre: 'PULIDOR',
      agenciaId: 'agencia-1',
    } as any);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  it('updateUsuario: rechaza mover un pulidor a una agencia que ya tiene otro fijo distinto', async () => {
    const { prisma, service } = armarPrisma({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'christian-id',
          agenciaId: null,
          role: { namerol: 'PULIDOR' },
        }),
        findFirst: vi.fn().mockResolvedValue({ id: 'moises-id', name: 'MOISES EDUARDO', lastname: 'TUMIPAMBA CHILUISA' }),
        update: vi.fn(),
      },
    });
    await expect(
      service.updateUsuario({ id: 'christian-id', agenciaId: 'agencia-1' } as any),
    ).rejects.toThrow(/ya tiene un pulidor fijo asignado/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updateUsuario: no se bloquea a sí mismo al reguardar sin cambiar de agencia', async () => {
    const { prisma, service } = armarPrisma({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'moises-id',
          agenciaId: 'agencia-1',
          role: { namerol: 'PULIDOR' },
        }),
        // El único fijo de la agencia es él mismo: assertAgenciaSinOtroFijo lo excluye por id.
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ id: 'moises-id', role: { namerol: 'PULIDOR' }, servicioIds: [] }),
      },
    });
    await expect(service.updateUsuario({ id: 'moises-id', name: 'Moises Eduardo' } as any)).resolves.toBeDefined();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});
