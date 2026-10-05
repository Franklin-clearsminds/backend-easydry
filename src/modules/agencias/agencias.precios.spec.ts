import { describe, expect, it, vi } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

const AGENCIA = { id: 'a1', nombre: 'Agencia Uno', regionId: 'r1', servicioIds: [1, 2] };

function armar(overrides: Partial<{ overrides: any[] }> = {}) {
  const prisma: any = {
    agencia: { findUnique: vi.fn().mockResolvedValue(AGENCIA) },
    catalogoServicio: {
      findMany: vi.fn().mockResolvedValue([
        { id: 1, codigo: 'SER-001', nombre: 'Lavado Express', precio: 10, estado: 'Activo', categoria: 'GENERAL' },
        { id: 2, codigo: 'SER-002', nombre: 'Lavado Premium', precio: 15, estado: 'Activo', categoria: 'GENERAL' },
      ]),
    },
    precioAgenciaServicio: {
      findMany: vi.fn().mockResolvedValue(overrides.overrides ?? []),
      upsert: vi.fn().mockImplementation(async (a: any) => ({ id: 'p1', ...a.create })),
    },
    $transaction: vi.fn().mockImplementation(async (ops: any[]) => Promise.all(ops)),
  };
  return { prisma, service: new AgenciasService(prisma) };
}

describe('AgenciasService.listPreciosServicios', () => {
  it('devuelve el precio del catálogo cuando no hay override', async () => {
    const { service } = armar();
    const r = await service.listPreciosServicios({ agenciaId: 'a1' } as any);
    expect(r).toEqual([
      { catalogoServicioId: 1, codigo: 'SER-001', nombre: 'Lavado Express', estado: 'Activo', precioCatalogo: 10, precioAgencia: null, precioEfectivo: 10 },
      { catalogoServicioId: 2, codigo: 'SER-002', nombre: 'Lavado Premium', estado: 'Activo', precioCatalogo: 15, precioAgencia: null, precioEfectivo: 15 },
    ]);
  });

  it('el override de la agencia manda sobre el precio del catálogo', async () => {
    const { service } = armar({ overrides: [{ catalogoServicioId: 1, precio: 8.5 }] });
    const r = await service.listPreciosServicios({ agenciaId: 'a1' } as any);
    const servicio1 = r.find((x: any) => x.catalogoServicioId === 1);
    expect(servicio1).toMatchObject({ precioCatalogo: 10, precioAgencia: 8.5, precioEfectivo: 8.5 });
  });

  it('respeta el alcance: un líder de otra agencia no puede consultar precios ajenos', async () => {
    const { service } = armar();
    await expect(
      service.listPreciosServicios({ agenciaId: 'a1' } as any, usuario('LIDER', { agenciaId: 'a-otra' })),
    ).rejects.toThrow(/no pertenece a tu alcance/);
  });
});

describe('AgenciasService.setPreciosServicios', () => {
  it('fija el precio de un servicio habilitado para la agencia', async () => {
    const { prisma, service } = armar();
    await service.setPreciosServicios({ agenciaId: 'a1', precios: [{ catalogoServicioId: 1, precio: 9.99 }] } as any);
    expect(prisma.precioAgenciaServicio.upsert).toHaveBeenCalledWith({
      where: { agenciaId_catalogoServicioId: { agenciaId: 'a1', catalogoServicioId: 1 } },
      create: { agenciaId: 'a1', catalogoServicioId: 1, precio: 9.99 },
      update: { precio: 9.99 },
    });
  });

  it('rechaza un servicio que no está habilitado para la agencia', async () => {
    const { service } = armar();
    await expect(
      service.setPreciosServicios({ agenciaId: 'a1', precios: [{ catalogoServicioId: 99, precio: 5 }] } as any),
    ).rejects.toThrow(/no están habilitados/);
  });

  it('rechaza fijar precio a un servicio ESPECIAL (el override solo aplica a GENERAL)', async () => {
    const { prisma, service } = armar();
    prisma.agencia.findUnique.mockResolvedValue({ ...AGENCIA, servicioIds: [1, 3] });
    prisma.catalogoServicio.findMany.mockResolvedValue([{ id: 3, categoria: 'ESPECIAL' }]);
    await expect(
      service.setPreciosServicios({ agenciaId: 'a1', precios: [{ catalogoServicioId: 3, precio: 5 }] } as any),
    ).rejects.toThrow(/no son servicios GENERALES/);
  });
});
