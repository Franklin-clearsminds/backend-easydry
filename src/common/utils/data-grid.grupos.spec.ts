import { describe, expect, it } from 'vitest';
import { paginarPorGrupos, rangoFechas, type GrupoOrden } from './data-grid.helpers.js';

/** Tres grupos con filas numeradas de forma continua: A=1..3, B=4..8, C=9..10. */
function montar() {
  const datos: Record<string, number[]> = { A: [1, 2, 3], B: [4, 5, 6, 7, 8], C: [9, 10] };
  const grupos: GrupoOrden[] = ['A', 'B', 'C'].map((g) => ({ where: { g }, orderBy: [{ id: 'asc' }] }));
  // Fuente de datos en memoria; `llamadas` registra cada consulta a un grupo (grupo, skip, take).
  const llamadas: Array<{ g: string; skip: number; take: number }> = [];
  const contar = async (where: Record<string, unknown>) => datos[where.g as string].length;
  const buscar = async (where: Record<string, unknown>, _o: unknown[], skip: number, take: number) => {
    llamadas.push({ g: where.g as string, skip, take });
    return datos[where.g as string].slice(skip, skip + take);
  };
  return { grupos, contar, buscar, llamadas };
}

describe('paginarPorGrupos', () => {
  it('la primera página toma solo del primer grupo si alcanza', async () => {
    const { grupos, contar, buscar, llamadas } = montar();
    const r = await paginarPorGrupos(grupos, 0, 2, contar, buscar);
    expect(r.items).toEqual([1, 2]);
    expect(r.total).toBe(10);
    expect(r.conteos).toEqual([3, 5, 2]);
    expect(llamadas).toHaveLength(1);
  });

  it('una página que cruza grupos junta el final de uno con el inicio del siguiente', async () => {
    const { grupos, contar, buscar, llamadas } = montar();
    const r = await paginarPorGrupos(grupos, 2, 4, contar, buscar);
    expect(r.items).toEqual([3, 4, 5, 6]);
    expect(llamadas).toEqual([
      { g: 'A', skip: 2, take: 1 },
      { g: 'B', skip: 0, take: 3 },
    ]);
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
    const { grupos, contar, buscar, llamadas } = montar();
    const r = await paginarPorGrupos(grupos, 8, 5, contar, buscar);
    expect(r.items).toEqual([9, 10]);
    expect(llamadas).toEqual([{ g: 'C', skip: 0, take: 2 }]);
  });

  it('más allá del final devuelve vacío pero con el total', async () => {
    const { grupos, contar, buscar, llamadas } = montar();
    const r = await paginarPorGrupos(grupos, 50, 10, contar, buscar);
    expect(r.items).toEqual([]);
    expect(r.total).toBe(10);
    expect(llamadas).toEqual([]);
  });

  it('con grupos vacíos no rompe', async () => {
    const grupos: GrupoOrden[] = [{ where: { g: 'X' }, orderBy: [] }, { where: { g: 'Y' }, orderBy: [] }];
    const r = await paginarPorGrupos(grupos, 0, 5, async () => 0, async () => []);
    expect(r).toEqual({ items: [], total: 0, conteos: [0, 0] });
  });
});

describe('rangoFechas', () => {
  it('una fecha de solo día es un día de Ecuador: desde abre a las 00:00 y hasta incluye todo ese día', () => {
    expect(rangoFechas('2026-09-01', '2026-09-30')).toEqual({
      gte: new Date('2026-09-01T00:00:00.000-05:00'),
      lte: new Date('2026-09-30T23:59:59.999-05:00'),
    });
  });

  it('respeta las fechas ISO completas y ignora las inválidas', () => {
    expect(rangoFechas(undefined, '2026-09-30T04:59:59.999Z')).toEqual({ lte: new Date('2026-09-30T04:59:59.999Z') });
    expect(rangoFechas('no-es-fecha', 'tampoco')).toBeUndefined();
    expect(rangoFechas()).toBeUndefined();
  });
});
