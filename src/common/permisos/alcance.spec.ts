import { describe, expect, it } from 'vitest';
import { resolverAlcance, whereAgencias, whereSobreAgencia, puedeSobreAgencia, SIN_RESULTADOS } from './alcance.js';
import { ROLES_BASE } from './roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: 'u1', roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

describe('resolverAlcance', () => {
  it('administradores y jefe comercial ven todo el país sin depender de agencia ni región', () => {
    for (const rol of ['SUPER_ADMIN', 'ADMIN', 'JEFE_COMERCIAL', 'COORD_BODEGA']) {
      expect(resolverAlcance(usuario(rol, { agenciaId: 'a1' }))).toEqual({ tipo: 'GLOBAL' });
    }
  });

  it('supervisor y coordinador comercial ven su región; sin región no ven nada', () => {
    expect(resolverAlcance(usuario('SUPERVISOR', { regionId: 'r1' }))).toEqual({ tipo: 'REGION', regionId: 'r1' });
    expect(resolverAlcance(usuario('COORD_COMERCIAL', { regionId: 'r2' }))).toEqual({ tipo: 'REGION', regionId: 'r2' });
    expect(resolverAlcance(usuario('SUPERVISOR'))).toEqual({ tipo: 'NINGUNO' });
  });

  it('aprobador y líder ven su agencia; sin agencia no ven nada, aunque el cliente mande una', () => {
    expect(resolverAlcance(usuario('APROBADOR', { agenciaId: 'a1' }))).toEqual({ tipo: 'AGENCIA', agenciaId: 'a1' });
    expect(resolverAlcance(usuario('LIDER', { agenciaId: 'a2' }))).toEqual({ tipo: 'AGENCIA', agenciaId: 'a2' });
    expect(resolverAlcance(usuario('LIDER', { regionId: 'r1' }))).toEqual({ tipo: 'NINGUNO' });
  });

  it('el pulidor fijo opera en su agencia y el móvil (sin agencia) en su región', () => {
    expect(resolverAlcance(usuario('PULIDOR', { agenciaId: 'a1', regionId: 'r1' }))).toEqual({ tipo: 'AGENCIA', agenciaId: 'a1' });
    expect(resolverAlcance(usuario('PULIDOR', { regionId: 'r1' }))).toEqual({ tipo: 'REGION', regionId: 'r1' });
    expect(resolverAlcance(usuario('PULIDOR'))).toEqual({ tipo: 'NINGUNO' });
  });

  it('el asistente de bodega usa la región de su bodega; el técnico, la región que tiene asignada', () => {
    expect(resolverAlcance(usuario('ASISTENTE_BODEGA', { bodega: { regionId: 'r9' } }))).toEqual({ tipo: 'REGION', regionId: 'r9' });
    expect(resolverAlcance(usuario('TECNICO', { regionId: 'r3' }))).toEqual({ tipo: 'REGION', regionId: 'r3' });
    expect(resolverAlcance(usuario('TECNICO'))).toEqual({ tipo: 'NINGUNO' });
  });

  it('un ámbito desconocido no da acceso', () => {
    expect(resolverAlcance({ id: 'u', roleDetails: { namerol: 'X', ambito: 'MUNDIAL' } })).toEqual({ tipo: 'NINGUNO' });
  });
});

describe('filtros por alcance', () => {
  it('agencias: todo, la región, la agencia o nada', () => {
    expect(whereAgencias({ tipo: 'GLOBAL' })).toEqual({});
    expect(whereAgencias({ tipo: 'REGION', regionId: 'r1' })).toEqual({ regionId: 'r1' });
    expect(whereAgencias({ tipo: 'AGENCIA', agenciaId: 'a1' })).toEqual({ id: 'a1' });
    expect(whereAgencias({ tipo: 'NINGUNO' })).toEqual(SIN_RESULTADOS);
    expect(whereAgencias({ tipo: 'PROPIO', userId: 'u' })).toEqual(SIN_RESULTADOS);
  });

  it('tablas con agenciaId: filtra por agencia o por la región de la agencia', () => {
    expect(whereSobreAgencia({ tipo: 'AGENCIA', agenciaId: 'a1' })).toEqual({ agenciaId: 'a1' });
    expect(whereSobreAgencia({ tipo: 'REGION', regionId: 'r1' })).toEqual({ agencia: { regionId: 'r1' } });
    expect(whereSobreAgencia({ tipo: 'REGION', regionId: 'r1' }, 'agenciaId', 'bahia')).toEqual({ bahia: { regionId: 'r1' } });
  });

  it('puedeSobreAgencia valida la pertenencia de un recurso concreto', () => {
    expect(puedeSobreAgencia({ tipo: 'GLOBAL' }, { id: 'a9' })).toBe(true);
    expect(puedeSobreAgencia({ tipo: 'AGENCIA', agenciaId: 'a1' }, { id: 'a1' })).toBe(true);
    expect(puedeSobreAgencia({ tipo: 'AGENCIA', agenciaId: 'a1' }, { id: 'a2' })).toBe(false);
    expect(puedeSobreAgencia({ tipo: 'REGION', regionId: 'r1' }, { id: 'a2', regionId: 'r1' })).toBe(true);
    expect(puedeSobreAgencia({ tipo: 'REGION', regionId: 'r1' }, { id: 'a2', regionId: 'r2' })).toBe(false);
    expect(puedeSobreAgencia({ tipo: 'NINGUNO' }, { id: 'a1', regionId: 'r1' })).toBe(false);
  });
});
