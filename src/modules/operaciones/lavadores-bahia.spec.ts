import { describe, expect, it, vi } from 'vitest';
import { validarLavadoresDeLaOT } from './lavadores-bahia.js';

const lavador = (id: string, extra: Record<string, unknown> = {}) => ({ id, agenciaId: 'ag1', estado: 1, ...extra });

function armar(opts: { usuarios: any[]; maximo?: number; asignados?: string[] }) {
  return {
    user: { findMany: vi.fn(async ({ where }: any) => opts.usuarios.filter((u) => where.id.in.includes(u.id))) },
    agencia: { findUnique: vi.fn().mockResolvedValue({ maxLavadoresPorBahia: opts.maximo ?? 1 }) },
    bahiaOperador: { findMany: vi.fn().mockResolvedValue((opts.asignados ?? []).map((operadorId) => ({ operadorId }))) },
  } as any;
}
const llamar = (prisma: any, ids: string[]) =>
  validarLavadoresDeLaOT(prisma, { bahiaId: 'b1', agenciaId: 'ag1', operadorIds: ids });

describe('lavadores de una OT por bahía', () => {
  it('bahía sin lavadores asignados: se puede elegir uno o más de la agencia, hasta el máximo', async () => {
    await expect(llamar(armar({ usuarios: [lavador('a')], maximo: 3 }), ['a'])).resolves.toBeUndefined();
    await expect(llamar(armar({ usuarios: [lavador('a'), lavador('b')], maximo: 3 }), ['a', 'b'])).resolves.toBeUndefined();
  });

  it('no deja pasar del máximo de lavadores por bahía configurado en la agencia', async () => {
    const prisma = armar({ usuarios: [lavador('a'), lavador('b')], maximo: 1 });
    await expect(llamar(prisma, ['a', 'b'])).rejects.toThrow(/hasta 1 lavador/);
  });

  it('bahía con lavadores asignados: solo se elige entre ellos, todos o una parte', async () => {
    const prisma = () => armar({ usuarios: [lavador('a'), lavador('b')], maximo: 3, asignados: ['a', 'b'] });
    await expect(llamar(prisma(), ['a', 'b'])).resolves.toBeUndefined();
    await expect(llamar(prisma(), ['a'])).resolves.toBeUndefined();
    const ajeno = armar({ usuarios: [lavador('a'), lavador('c')], maximo: 3, asignados: ['a', 'b'] });
    await expect(llamar(ajeno, ['a', 'c'])).rejects.toThrow(/solo puedes elegir entre ellos/);
  });

  it('rechaza lavadores de otra agencia, inactivos o inexistentes', async () => {
    await expect(llamar(armar({ usuarios: [lavador('a', { agenciaId: 'otra' })] }), ['a'])).rejects.toThrow(/agencia de la bahía/);
    await expect(llamar(armar({ usuarios: [lavador('a', { estado: 0 })] }), ['a'])).rejects.toThrow(/inactivos/);
    await expect(llamar(armar({ usuarios: [] }), ['a'])).rejects.toThrow(/ya no existen/);
  });

  it('sin lavadores seleccionados no valida nada', async () => {
    const prisma = armar({ usuarios: [] });
    await expect(llamar(prisma, [])).resolves.toBeUndefined();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
