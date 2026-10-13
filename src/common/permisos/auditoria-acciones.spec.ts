import { describe, expect, it } from 'vitest';
import { auditar } from './auditoria-permisos.js';
import { SIN_PANTALLA, SIN_SERVIDOR } from './auditoria-acciones.baseline.js';

/**
 * Cada casilla del editor de roles debe hacer algo cuando se enciende y cuando se apaga:
 *  - el servidor la exige en algún endpoint (apagarla bloquea de verdad), y
 *  - alguna pantalla de la web o de la app la usa (apagarla oculta el botón o la pestaña).
 * Lo que todavía no cumple está en la línea base, que solo puede encogerse (trinquete): si una casilla ya cumple y sigue en la
 * lista, la prueba falla para obligar a borrarla y no perder el avance.
 */
describe('auditoría de las casillas del editor de roles', () => {
  const { resultados, hayPantallas } = auditar();

  it('toda casilla nueva que se agrega al catálogo nace exigida por el servidor', () => {
    const sinCablear = resultados.filter((r) => r.servidor === 0 && !SIN_SERVIDOR.includes(r.codigo)).map((r) => r.codigo);
    expect(sinCablear, 'casillas que ningún endpoint exige (agrega @Permiso en el endpoint o, si es deuda conocida, a la línea base)').toEqual([]);
  });

  it('la línea base de servidor no conserva casillas que ya están exigidas', () => {
    const resueltas = SIN_SERVIDOR.filter((c) => (resultados.find((r) => r.codigo === c)?.servidor ?? 0) > 0);
    expect(resueltas, 'ya las exige un endpoint: bórralas de SIN_SERVIDOR').toEqual([]);
  });

  it('la línea base de servidor no conserva códigos que ya no existen en el catálogo', () => {
    const huerfanas = SIN_SERVIDOR.filter((c) => !resultados.some((r) => r.codigo === c));
    expect(huerfanas).toEqual([]);
  });

  describe.skipIf(!hayPantallas)('pantallas (web y app)', () => {
    it('toda casilla nueva que se agrega al catálogo nace usada por alguna pantalla', () => {
      const sinPantalla = resultados.filter((r) => r.pantalla === 0 && !SIN_PANTALLA.includes(r.codigo)).map((r) => r.codigo);
      expect(sinPantalla, 'casillas que ninguna pantalla usa (usa puede(código) en la web o en la app)').toEqual([]);
    });

    it('la línea base de pantallas no conserva casillas que ya usa alguna pantalla', () => {
      const resueltas = SIN_PANTALLA.filter((c) => (resultados.find((r) => r.codigo === c)?.pantalla ?? 0) > 0);
      expect(resueltas, 'ya las usa una pantalla: bórralas de SIN_PANTALLA').toEqual([]);
    });
  });
});
