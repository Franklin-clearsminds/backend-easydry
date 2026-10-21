import { describe, expect, it, vi } from 'vitest';
import { dentroDeVentanaRetoque, finVentanaRetoque, validarAgregarServicioAOT } from './retoque.js';

// 21/10/2026 15:00 hora de Ecuador = 20:00 UTC
const FINALIZADA = new Date('2026-10-21T20:00:00.000Z');

describe('ventana del retoque', () => {
  it('termina a las 23:59 (hora de Ecuador) del segundo día después de finalizar', () => {
    // 23/10/2026 23:59:59.999 Ecuador = 24/10 04:59:59.999 UTC
    expect(finVentanaRetoque(FINALIZADA).toISOString()).toBe('2026-10-24T04:59:59.999Z');
  });

  it('el mismo día, el día siguiente y el segundo día entran; el tercero no', () => {
    expect(dentroDeVentanaRetoque(FINALIZADA, new Date('2026-10-21T22:00:00Z'))).toBe(true);
    expect(dentroDeVentanaRetoque(FINALIZADA, new Date('2026-10-22T15:00:00Z'))).toBe(true);
    expect(dentroDeVentanaRetoque(FINALIZADA, new Date('2026-10-24T04:59:00Z'))).toBe(true); // 23/10 23:59 Ecuador
    expect(dentroDeVentanaRetoque(FINALIZADA, new Date('2026-10-24T05:00:00Z'))).toBe(false); // 24/10 00:00 Ecuador
  });

  it('una OT finalizada de noche cuenta por el día de Ecuador, no por el de UTC', () => {
    // 21/10 22:30 Ecuador = 22/10 03:30 UTC: el día local sigue siendo el 21
    const tarde = new Date('2026-10-22T03:30:00Z');
    expect(finVentanaRetoque(tarde).toISOString()).toBe('2026-10-24T04:59:59.999Z');
  });
});

function armar(filas: any[], catalogos: any[]) {
  return {
    servicioLavado: { findMany: vi.fn().mockResolvedValue(filas) },
    catalogoServicio: { findMany: vi.fn().mockResolvedValue(catalogos) },
  } as any;
}
const fila = (estado: string, horaSalida: Date | null = FINALIZADA) => ({ estado, horaSalida, updatedAt: FINALIZADA });
const validar = (prisma: any, ahora: string, catalogoIds = [9]) =>
  validarAgregarServicioAOT(prisma, { ordenTrabajoOT: 'OT-1', catalogoIds, ahora: new Date(ahora) });

describe('agregar un servicio a una OT existente', () => {
  it('OT nueva o abierta: cualquier servicio, como siempre', async () => {
    await expect(validar(armar([], []), '2026-10-30T00:00:00Z')).resolves.toBeUndefined();
    const abierta = armar([fila('FINALIZADO'), fila('EN_PROCESO', null)], [{ nombre: 'Lavado', esRetoque: false }]);
    await expect(validar(abierta, '2026-10-30T00:00:00Z')).resolves.toBeUndefined();
  });

  it('OT finalizada: se acepta un retoque dentro de la ventana', async () => {
    const prisma = armar([fila('FINALIZADO'), fila('APROBADO')], [{ nombre: 'Retoque', esRetoque: true }]);
    await expect(validar(prisma, '2026-10-22T14:00:00Z')).resolves.toBeUndefined();
  });

  it('OT finalizada: un servicio que no es retoque se rechaza', async () => {
    const prisma = armar([fila('FINALIZADO')], [{ nombre: 'Lavado Deluxe', esRetoque: false }]);
    await expect(validar(prisma, '2026-10-22T14:00:00Z')).rejects.toThrow(/solo se puede agregar un retoque/);
  });

  it('OT finalizada: pasada la ventana se rechaza, con la fecha límite', async () => {
    const prisma = armar([fila('FINALIZADO')], [{ nombre: 'Retoque', esRetoque: true }]);
    await expect(validar(prisma, '2026-10-24T05:30:00Z')).rejects.toThrow(/terminó el 23\/10\/2026/);
  });
});
