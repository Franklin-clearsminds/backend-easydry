import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InventarioService } from './inventario.service';

/** Eliminar una bodega: solo si ya no guarda insumos (con prisma simulado). */
function servicio(stocks: Array<{ insumo: { nombre: string } }>, central = false) {
  const prisma: any = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: 'b1', nombre: 'Bodega R1', esCentral: central }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn().mockResolvedValue([]),
    stockUbicacion: {
      findMany: vi.fn().mockResolvedValue(stocks),
      count: vi.fn().mockResolvedValue(stocks.length),
      deleteMany: vi.fn(),
    },
  };
  const svc: any = Object.create(InventarioService.prototype);
  svc.prisma = prisma;
  svc.ensureBodegasTable = vi.fn().mockResolvedValue(undefined);
  return { svc: svc as InventarioService, prisma };
}

describe('eliminarBodega', () => {
  it('rechaza eliminar una bodega con insumos en stock y dice cuáles', async () => {
    const { svc, prisma } = servicio([{ insumo: { nombre: 'Cera' } }, { insumo: { nombre: 'Jabón' } }]);
    await expect(svc.eliminarBodega({ id: 'b1' })).rejects.toThrow(/todavía tiene stock de 2 insumo\(s\) \(Cera, Jabón\)/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('elimina la bodega cuando no tiene stock', async () => {
    const { svc, prisma } = servicio([]);
    const r = await svc.eliminarBodega({ id: 'b1' });
    expect(r.message).toMatch(/eliminada correctamente/);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('la Bodega Central nunca se elimina', async () => {
    const { svc } = servicio([], true);
    await expect(svc.eliminarBodega({ id: 'b1' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
