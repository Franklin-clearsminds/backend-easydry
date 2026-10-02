import { describe, expect, it, vi } from 'vitest';
import { OperacionesService } from './operaciones.service.js';

/**
 * Precio efectivo de una OT general al crearla: override de la agencia si existe, si no el precio
 * global del catálogo; en ambos casos queda congelado en el registro (no se recalcula después).
 */
function armar(opts: { precioCatalogo?: number; override?: number | null } = {}) {
  const { precioCatalogo = 10, override = null } = opts;
  const prisma: any = {
    bahia: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'b1',
        nombre: 'Bahía 1',
        agenciaId: 'a1',
        agencia: { regionId: 'r1' },
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'u1', agenciaId: 'a1', estado: 1 }),
    },
    catalogoServicio: {
      findUnique: vi.fn().mockResolvedValue({
        id: 1,
        estado: 'Activo',
        nombre: 'Lavado Express',
        tiempoEstimadoMin: 30,
        precio: precioCatalogo,
        recetas: [],
      }),
    },
    agencia: {
      findUnique: vi.fn().mockResolvedValue({ id: 'a1', nombre: 'Agencia Uno', servicioIds: [1] }),
    },
    precioAgenciaServicio: {
      findUnique: vi.fn().mockResolvedValue(override != null ? { precio: override } : null),
    },
    servicioLavado: {
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        // La verificación de bahía ocupada y la de "hermana" (foto heredada) buscan por bahiaId/OT,
        // no por id: ninguna de las dos debe interferir con findOneRaw (que busca por id/clientUuid).
        if (args?.where?.OR?.some((c: any) => 'id' in c)) {
          return { id: 's1', bahia: { agencia: { id: 'a1' } }, catalogo: { recetas: [] } };
        }
        return null;
      }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation(async (a: any) => ({
        id: 's1',
        ...a.data,
        bahia: { agencia: { id: 'a1' } },
        catalogo: { recetas: [] },
      })),
    },
    maquinaria: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  return { prisma, service: new OperacionesService(prisma) };
}

const dto = (extra: Record<string, unknown> = {}) => ({
  placa: 'ABC-1234',
  modelo: 'Corolla',
  servicioCatalogoId: 1,
  bahiaId: '11111111-1111-1111-1111-111111111111',
  ordenTrabajoOT: 'OT-1',
  ...extra,
}) as any;

describe('OperacionesService.create — precio congelado', () => {
  it('usa el precio global del catálogo cuando la agencia no tiene override', async () => {
    const { prisma, service } = armar({ precioCatalogo: 12.5 });
    await service.create(dto(), 'u1');
    expect(prisma.servicioLavado.create.mock.calls[0][0].data.precio).toBe(12.5);
  });

  it('usa el override de la agencia cuando existe, aunque difiera del precio del catálogo', async () => {
    const { prisma, service } = armar({ precioCatalogo: 12.5, override: 9.99 });
    await service.create(dto(), 'u1');
    expect(prisma.servicioLavado.create.mock.calls[0][0].data.precio).toBe(9.99);
  });

  it('consulta el override con el par agencia+servicio correcto', async () => {
    const { prisma, service } = armar();
    await service.create(dto(), 'u1');
    expect(prisma.precioAgenciaServicio.findUnique).toHaveBeenCalledWith({
      where: { agenciaId_catalogoServicioId: { agenciaId: 'a1', catalogoServicioId: 1 } },
      select: { precio: true },
    });
  });
});
