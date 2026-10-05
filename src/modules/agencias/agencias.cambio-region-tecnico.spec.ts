import { describe, expect, it, vi } from 'vitest';
import { AgenciasService } from './agencias.service.js';

/**
 * Un técnico (o coordinador de mantenimiento) con trabajo abierto no se puede mover de región sin
 * reasignarlo antes: si no, ese mantenimiento o incidente queda con un tecnicoId que ya nadie ve
 * (scopeMantenimientos/scopeIncidentes solo protegen la visibilidad del propio técnico, no la del
 * resto del equipo de su región anterior). Ver conversación con el usuario del 2026-09-30.
 */
function armarPrisma(overrides: Record<string, any> = {}) {
  const prisma: any = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'tecnico-1',
        regionId: 'region-costa',
        roleId: 'role-tecnico',
        role: { namerol: 'TECNICO' },
      }),
      update: vi.fn().mockImplementation(async (a: any) => ({ id: a.where.id, ...a.data, role: { namerol: 'TECNICO' }, servicioIds: [] })),
    },
    role: {
      findUnique: vi.fn().mockResolvedValue({ id: 'role-tecnico', namerol: 'TECNICO', ambito: 'REGION' }),
      findFirst: vi.fn(),
    },
    region: {
      findFirst: vi.fn().mockResolvedValue({ id: 'region-sierra' }),
    },
    mantenimientoMaquinaria: {
      count: vi.fn().mockResolvedValue(0),
    },
    incidenteTecnico: {
      count: vi.fn().mockResolvedValue(0),
    },
    catalogoServicio: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
  return { prisma, service: new AgenciasService(prisma) };
}

describe('cambio de región de un técnico con trabajo abierto', () => {
  it('rechaza el cambio si tiene mantenimientos e incidentes sin terminar', async () => {
    const { prisma, service } = armarPrisma({
      mantenimientoMaquinaria: { count: vi.fn().mockResolvedValue(3) },
      incidenteTecnico: { count: vi.fn().mockResolvedValue(1) },
    });
    await expect(
      service.updateUsuario({ id: 'tecnico-1', regionId: 'region-sierra' } as any),
    ).rejects.toThrow(/3 mantenimientos y 1 incidente.*Reasígnalos antes de cambiarlo de región/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rechaza el cambio con un solo mantenimiento abierto (singular correcto en el mensaje)', async () => {
    const { prisma, service } = armarPrisma({
      mantenimientoMaquinaria: { count: vi.fn().mockResolvedValue(1) },
    });
    await expect(
      service.updateUsuario({ id: 'tecnico-1', regionId: 'region-sierra' } as any),
    ).rejects.toThrow(/tiene 1 mantenimiento sin terminar/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('permite el cambio de región cuando no tiene trabajo abierto', async () => {
    const { prisma, service } = armarPrisma();
    await expect(service.updateUsuario({ id: 'tecnico-1', regionId: 'region-sierra' } as any)).resolves.toBeDefined();
    expect(prisma.user.update).toHaveBeenCalled();
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.regionId).toBe('region-sierra');
  });

  it('no bloquea guardar al técnico si la región no cambia (solo se le edita el nombre)', async () => {
    const { prisma, service } = armarPrisma({
      mantenimientoMaquinaria: { count: vi.fn().mockResolvedValue(5) }, // aunque tenga trabajo abierto...
    });
    // ...no importa: no se está tocando la región, así que ni se consulta.
    await expect(service.updateUsuario({ id: 'tecnico-1', name: 'Nuevo Nombre' } as any)).resolves.toBeDefined();
    expect(prisma.mantenimientoMaquinaria.count).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('un COORD_MANTENIMIENTO con trabajo abierto tampoco puede cambiarse de región', async () => {
    const { prisma, service } = armarPrisma({
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'coord-1',
          regionId: 'region-costa',
          roleId: 'role-coord',
          role: { namerol: 'COORD_MANTENIMIENTO' },
        }),
        update: vi.fn(),
      },
      role: {
        findUnique: vi.fn().mockResolvedValue({ id: 'role-coord', namerol: 'COORD_MANTENIMIENTO', ambito: 'REGION' }),
        findFirst: vi.fn(),
      },
      incidenteTecnico: { count: vi.fn().mockResolvedValue(2) },
    });
    await expect(
      service.updateUsuario({ id: 'coord-1', regionId: 'region-sierra' } as any),
    ).rejects.toThrow(/2 incidentes sin terminar/);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
