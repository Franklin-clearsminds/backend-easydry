import { describe, expect, it, vi } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return {
    id: `id-${namerol}`,
    name: 'Ana',
    lastname: namerol,
    roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito },
    ...extra,
  };
};

function armar(catalogoFindUnique: any = null, catalogoFindFirst: any = null) {
  const prisma: any = {
    servicioEspecial: {
      findFirst: vi.fn().mockResolvedValue(null), // sin OT duplicada
      create: vi.fn().mockImplementation(async (a: any) => ({ ...a.data })),
    },
    agencia: {
      findUnique: vi.fn().mockResolvedValue({ id: 'a1', regionId: 'r1' }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([{ id: 'p1', regionId: 'r1' }]),
    },
    catalogoServicio: {
      findUnique: vi.fn().mockResolvedValue(catalogoFindUnique),
      findFirst: vi.fn().mockResolvedValue(catalogoFindFirst),
    },
  };
  const service = new ServiciosEspecialesService(
    prisma,
    new DecisionesService(prisma),
  );
  vi.spyOn(service as any, 'assertPulidorTieneInsumosParaOT').mockResolvedValue(
    [],
  );
  return { prisma, service };
}

const dto = (extra: Record<string, unknown> = {}) =>
  ({
    ordenTrabajoOT: 'OT-ESP-1',
    tipoServicio: 'Pulido',
    operadorId: 'p1',
    agenciaId: 'a1',
    vehiculoInfo: { placa: 'XYZ-999' },
    ...extra,
  }) as any;

describe('ServiciosEspecialesService.create — precio congelado desde el catálogo', () => {
  it('usa el catálogo indicado por servicioCatalogoId y congela su precio', async () => {
    const { prisma, service } = armar({ id: 5, precio: 20 });
    await service.create(
      dto({ servicioCatalogoId: 5 }),
      'u1',
      usuario('COORD_SERVICIOS_ESPECIALES'),
    );
    expect(prisma.servicioEspecial.create.mock.calls[0][0].data).toMatchObject({
      servicioCatalogoId: 5,
      precio: 20,
    });
  });

  it('sin servicioCatalogoId, lo resuelve por el nombre de tipoServicio contra el catálogo ESPECIAL', async () => {
    const { prisma, service } = armar(null, { id: 7, precio: 30 });
    await service.create(dto(), 'u1', usuario('COORD_SERVICIOS_ESPECIALES'));
    expect(
      prisma.catalogoServicio.findFirst.mock.calls[0][0].where.categoria,
    ).toBe('ESPECIAL');
    expect(prisma.servicioEspecial.create.mock.calls[0][0].data).toMatchObject({
      servicioCatalogoId: 7,
      precio: 30,
    });
  });

  it('si no se resuelve ningún catálogo, la OT se crea igual sin precio (no bloquea)', async () => {
    const { prisma, service } = armar(null, null);
    await service.create(dto(), 'u1', usuario('COORD_SERVICIOS_ESPECIALES'));
    expect(prisma.servicioEspecial.create.mock.calls[0][0].data).toMatchObject({
      servicioCatalogoId: null,
      precio: null,
    });
  });
});
