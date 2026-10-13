import { describe, expect, it } from 'vitest';
import { esLiderDeAgencia, normalizarRol, ROLES_LIDER_AGENCIA, rolDeUsuario } from './alias-roles.js';

describe('roles - sin alias, BACKUP es un rol propio', () => {
  it('BACKUP ya no se normaliza a LIDER', () => {
    expect(normalizarRol('BACKUP')).toBe('BACKUP');
    expect(rolDeUsuario({ role: { namerol: 'backup' } })).toBe('BACKUP');
  });

  it('no hay alias: los nombres antiguos ya no equivalen a ningún rol oficial', () => {
    for (const antiguo of ['LIDER_AGENCIA', 'LIDER_OPERADOR', 'GERENTE', 'GERENTE_REGIONAL', 'OPERADOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL', 'DISTRIBUIDOR', 'ADMINISTRADOR']) {
      expect(normalizarRol(antiguo)).toBe(antiguo);
    }
  });

  it('normalizarRol solo limpia el texto: espacios, mayúsculas y guion bajo', () => {
    expect(normalizarRol('  coord bodega ')).toBe('COORD_BODEGA');
    expect(normalizarRol(undefined)).toBe('');
  });

  it('esLiderDeAgencia incluye a LIDER y a BACKUP, y a nadie más', () => {
    expect(ROLES_LIDER_AGENCIA).toEqual(['LIDER', 'BACKUP']);
    expect(esLiderDeAgencia('LIDER')).toBe(true);
    expect(esLiderDeAgencia('BACKUP')).toBe(true);
    for (const otro of ['APROBADOR', 'SUPERVISOR', 'ADMIN', 'LAVADOR', 'PULIDOR', '']) {
      expect(esLiderDeAgencia(otro)).toBe(false);
    }
  });
});
