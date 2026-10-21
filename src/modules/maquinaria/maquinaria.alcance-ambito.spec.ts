import { describe, expect, it } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';

const scope = (actor: Actor) =>
  (new MaquinariaService({} as never, {} as never, {} as never) as any).scopeMaquinaria(actor);

const actor = (parcial: Partial<Actor>): Actor => ({
  id: 'u1', rol: 'ROL_PERSONALIZADO', regionId: 'r1', agenciaId: 'a1', ...parcial,
});

describe('alcance de maquinaria según el ámbito del rol', () => {
  it('todo el país: ve toda la maquinaria', () => {
    expect(scope(actor({ ambito: 'GLOBAL' }))).toEqual({});
  });

  it('región: solo la de su región', () => {
    expect(scope(actor({ ambito: 'REGION' }))).toEqual({ agencia: { regionId: 'r1' } });
  });

  it('agencia: solo la de su agencia', () => {
    expect(scope(actor({ ambito: 'AGENCIA' }))).toEqual({ agenciaId: 'a1' });
  });

  it('sin región o sin agencia no ve nada', () => {
    expect(scope(actor({ ambito: 'REGION', regionId: null }))).toEqual({ agencia: { regionId: '__sin_region__' } });
    expect(scope(actor({ ambito: 'AGENCIA', agenciaId: null }))).toEqual({ agenciaId: '__ninguno__' });
  });

  it('el pulidor con ámbito de agencia sigue viendo solo lo asignado a él', () => {
    expect(scope(actor({ rol: 'PULIDOR', ambito: 'AGENCIA' }))).toEqual({ operadorAsignadoId: 'u1' });
  });
});

const scopeDe = (metodo: 'scopeIncidentes' | 'scopeMantenimientos', a: Actor) =>
  (new MaquinariaService({} as never, {} as never, {} as never) as any)[metodo](a);

describe('alcance de incidentes y mantenimientos según el ámbito del rol', () => {
  for (const metodo of ['scopeIncidentes', 'scopeMantenimientos'] as const) {
    it(`${metodo}: país ve todo, región su región, agencia su agencia`, () => {
      expect(scopeDe(metodo, actor({ ambito: 'GLOBAL' }))).toEqual({});
      expect(scopeDe(metodo, actor({ ambito: 'REGION' }))).toEqual({ maquinaria: { agencia: { regionId: 'r1' } } });
      expect(scopeDe(metodo, actor({ ambito: 'AGENCIA' }))).toEqual({ maquinaria: { agenciaId: 'a1' } });
    });

    it(`${metodo}: el técnico sigue viendo solo lo asignado a él aunque su ámbito sea región`, () => {
      const esperado = metodo === 'scopeIncidentes' ? { tecnicoAsignadoId: 'u1' } : { tecnicoId: 'u1' };
      expect(scopeDe(metodo, actor({ rol: 'TECNICO', ambito: 'REGION' }))).toEqual(esperado);
    });
  }
});
