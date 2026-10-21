import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { accionesLegacy } from './acciones-legacy';
import { capacidadesDesdeNuevos, codigosNuevosActivos, dependenciasRotas } from './catalogo-paginas';
import { esCodigoPermiso } from './catalogo-permisos';
import { modulosDeCapacidades } from './modulos-navegacion';
import { NOMBRES_ROLES_BASE, ROLES_BASE } from './roles-base';

/** El seed carga prisma/data/roles.json: debe ser coherente con el catálogo vigente de páginas y permisos. */
const roles: Array<{ namerol: string; ambito: string; permisos: string[]; capacidades: string[]; acciones: unknown }> = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../prisma/data/roles.json'), 'utf8'),
);
const ordenado = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));

describe('prisma/data/roles.json (lo que siembra el seed)', () => {
  it('trae los roles oficiales, cada uno con su ámbito', () => {
    expect(roles.map((r) => r.namerol).sort()).toEqual([...NOMBRES_ROLES_BASE].sort());
    for (const r of roles) expect(r.ambito, r.namerol).toBe(ROLES_BASE.find((b) => b.namerol === r.namerol)!.ambito);
  });

  it.each(roles.map((r) => [r.namerol, r] as const))('%s: solo códigos que existen (sin restos de funciones eliminadas)', (_n, r) => {
    const desconocidos = r.capacidades.filter((c) => !esCodigoPermiso(c));
    expect(desconocidos).toEqual([]);
  });

  it.each(roles.map((r) => [r.namerol, r] as const))('%s: ninguna acción sin su página y nada que el catálogo no otorgue', (_n, r) => {
    expect(dependenciasRotas(codigosNuevosActivos(r.capacidades))).toEqual([]);
    expect([...capacidadesDesdeNuevos(r.capacidades)].sort()).toEqual([...r.capacidades].sort());
  });

  it.each(roles.map((r) => [r.namerol, r] as const))('%s: módulos y acciones legacy derivados al día', (_n, r) => {
    expect([...modulosDeCapacidades(r.capacidades, r.namerol)].sort()).toEqual([...r.permisos].sort());
    expect(ordenado(r.acciones)).toBe(ordenado(accionesLegacy(r.capacidades, r.ambito as never)));
  });
});
