import { describe, expect, it } from 'vitest';
import { estrellasDe5s, estrellasDeInforme, promedioEstrellas } from './auditorias-estrellas.js';

describe('estrellas de las auditorías', () => {
  it('el informe de inspección: Excelente 5, Bueno 4, Regular 2,5, Malo 1', () => {
    expect(['EXCELENTE', 'BUENO', 'REGULAR', 'MALO'].map(estrellasDeInforme)).toEqual([5, 4, 2.5, 1]);
    expect(estrellasDeInforme(null)).toBeNull();
    expect(estrellasDeInforme('OTRA')).toBeNull();
  });

  it('la 5S: porcentaje ÷ 20 redondeado a la media estrella', () => {
    expect([100, 90, 87, 75, 50, 10, 0].map(estrellasDe5s)).toEqual([5, 4.5, 4.5, 4, 2.5, 0.5, 0]);
    expect(estrellasDe5s(110)).toBe(5);
    expect(estrellasDe5s(null)).toBeNull();
  });

  it('el promedio ignora lo que no tiene valor y usa un decimal', () => {
    expect(promedioEstrellas([5, 4, null, undefined])).toBe(4.5);
    expect(promedioEstrellas([4, 4.5, 5])).toBe(4.5);
    expect(promedioEstrellas([])).toBeNull();
  });
});
