import { describe, expect, it, vi } from 'vitest';
import { paginarPorGrupos, rangoFechas, type GrupoOrden } from './data-grid.helpers.js';

/** Tres grupos con filas numeradas de forma continua: A=1..3, B=4..8, C=9..10. */
function montar() {
  const datos: Record<string, number[]> = { A: [1, 2, 3], B: [4, 5, 6, 7, 8], C: [9, 10] };
  const grupos: GrupoOrden[] = ['A', 'B', 'C'].map((g) => ({ where: { g }, orderBy: [{ id: 'asc' }] }));
  const contar = vi.fn(async (where: Record<string, unknown>) => datos[where.g as string].length);
  const buscar = vi.fn(async (where: Record<string, unknown>, _o: unknown[], skip: number, take: number) =>
    datos[where.g as string].slice(skip, skip + take));
  return { grupos, contar, buscar };
}

describe('paginarPorGrupos', () => {
  it('la primera página toma solo del primer grupo si alcanza', async () => {
    const { grupos, contar, buscar } = montar();
    const r = await paginarPorGrupos(grupos, 0, 2, contar, buscar);
    expect(r.items).toEqual([1, 2]);
    expect(r.total).toBe(10);
    expect(r.conteos).toEqual([3, 5, 2]);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('una página que cruza grupos junta el final de uno con el inicio del siguiente', async () => {
    const { grupos, contar, buscar } = montar();
    const r = await paginarPorGrupos(grupos, 2, 4, contar, buscar);
    expect(r.items).toEqual([3, 4, 5, 6]);
    expect(buscar).toHaveBeenNthCalledWith(1, { g: 'A' }, expect.anything(), 2, 1);
    expect(buscar).toHaveBeenNthCalledWith(2, { g: 'B' }, expect.anything(), 0, 3);
  });

  it('recorrer todas las páginas devuelve cada fila una sola vez y en orden', async () => {
    const { grupos, contar, buscar } = montar();
    const todas: number[] = [];
    for (let page = 1; page <= 4; page++) {
      const r = await paginarPorGrupos(grupos, (page - 1) * 3, 3, contar, buscar);
      todas.push(...r.items);
    }
    expect(todas).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('una página que salta un grupo completo no lo consulta', async () => {
    const { grupos, contar, buscar } = montar();
    const r = await paginarPorGrupos(grupos, 8, 5, contar, buscar);
    expect(r.items).toEqual([9, 10]);
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenCalledWith({ g: 'C' }, expect.anything(), 0, 2);
  });

  it('más allá del final devuelve vacío pero con el total', async () => {
    const { grupos, contar, buscar } = montar();
    const r = await paginarPorGrupos(grupos, 50, 10, contar, buscar);
    expect(r.items).toEqual([]);
    expect(r.total).toBe(10);
    expect(buscar).not.toHaveBeenCalled();
  });

  it('con grupos vacíos no rompe', async () => {
    const grupos: GrupoOrden[] = [{ where: { g: 'X' }, orderBy: [] }, { where: { g: 'Y' }, orderBy: [] }];
    const r = await paginarPorGrupos(grupos, 0, 5, async () => 0, async () => []);
    expect(r).toEqual({ items: [], total: 0, conteos: [0, 0] });
  });
});

describe('rangoFechas', () => {
  it('un hasta de solo día incluye todo ese día', () => {
    expect(rangoFechas('2026-09-01', '2026-09-30')).toEqual({
      gte: new Date('2026-09-01'),
      lte: new Date('2026-09-30T23:59:59.999Z'),
    });
  });

  it('respeta las fechas ISO completas y ignora las inválidas', () => {
    expect(rangoFechas(undefined, '2026-09-30T04:59:59.999Z')).toEqual({ lte: new Date('2026-09-30T04:59:59.999Z') });
    expect(rangoFechas('no-es-fecha', 'tampoco')).toBeUndefined();
    expect(rangoFechas()).toBeUndefined();
  });
});
