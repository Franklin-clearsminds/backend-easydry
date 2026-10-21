import { describe, expect, it, vi } from 'vitest';
import { prepararRetoqueEspecial } from './retoque-especial.js';

const FIN = new Date('2026-10-21T20:00:00.000Z'); // 21/10 15:00 Ecuador

function armar(opts: { base?: any; catalogo?: any; previos?: number }) {
  return {
    servicioEspecial: {
      findFirst: vi.fn().mockResolvedValue(opts.base ?? null),
      count: vi.fn().mockResolvedValue(opts.previos ?? 0),
    },
    catalogoServicio: { findUnique: vi.fn().mockResolvedValue(opts.catalogo ?? null) },
  } as any;
}
const base = (extra: Record<string, unknown> = {}) => ({
  codigoSE: 'SE-2026-001', estado: 'Completado', fechaFin: FIN, updatedAt: FIN, operadoresAsignados: [{ operadorId: 'pul-1' }], ...extra,
});
const retoqueEsp = { nombre: 'RETOQUE ESPECIAL', categoria: 'ESPECIAL', esRetoque: true };
const llamar = (prisma: any, ahora = '2026-10-22T15:00:00Z', codigoBase = 'SE-2026-001') =>
  prepararRetoqueEspecial(prisma, { codigoBase, servicioCatalogoId: 77, ahora: new Date(ahora) });

describe('retoque de un servicio especial', () => {
  it('genera el código con sufijo, ligado a la misma OT, y trae al pulidor original', async () => {
    const r = await llamar(armar({ base: base(), catalogo: retoqueEsp }));
    expect(r.codigoSE).toBe('SE-2026-001-R1');
    expect(r.operadoresBase).toEqual(['pul-1']);
  });

  it('cada retoque nuevo suma uno y se puede pedir desde el código de otro retoque', async () => {
    const r = await llamar(armar({ base: base(), catalogo: retoqueEsp, previos: 1 }), '2026-10-22T15:00:00Z', 'SE-2026-001-R1');
    expect(r.codigoSE).toBe('SE-2026-001-R2');
  });

  it('exige que el servicio original esté completado', async () => {
    await expect(llamar(armar({ base: base({ estado: 'En Proceso' }), catalogo: retoqueEsp }))).rejects.toThrow(/aún no está completado/);
  });

  it('solo acepta el retoque especial del catálogo', async () => {
    await expect(llamar(armar({ base: base(), catalogo: { nombre: 'Pulido', categoria: 'ESPECIAL', esRetoque: false } }))).rejects.toThrow(/solo se puede agregar un retoque/);
    await expect(llamar(armar({ base: base(), catalogo: { nombre: 'RETOQUE', categoria: 'GENERAL', esRetoque: true } }))).rejects.toThrow(/solo se puede agregar un retoque/);
  });

  it('respeta la ventana de 2 días (hasta el 23/10 23:59, hora de Ecuador)', async () => {
    const prisma = () => armar({ base: base(), catalogo: retoqueEsp });
    await expect(llamar(prisma(), '2026-10-24T04:00:00Z')).resolves.toBeDefined();
    await expect(llamar(prisma(), '2026-10-24T05:30:00Z')).rejects.toThrow(/Ya pasó el plazo/);
  });

  it('un código que no existe se informa', async () => {
    await expect(llamar(armar({ catalogo: retoqueEsp }))).rejects.toThrow(/No existe el servicio especial/);
  });
});
