import { describe, expect, it } from 'vitest';
import { normalizarCelularEc } from './telefono-ec.js';

describe('celular ecuatoriano', () => {
  it('acepta 10 dígitos que empiezan con 09 y quita separadores', () => {
    expect(normalizarCelularEc('0991234567')).toBe('0991234567');
    expect(normalizarCelularEc('099 123-4567')).toBe('0991234567');
    expect(normalizarCelularEc(' (099) 123 4567 ')).toBe('0991234567');
  });

  it('normaliza el prefijo internacional', () => {
    expect(normalizarCelularEc('+593 99 123 4567')).toBe('0991234567');
    expect(normalizarCelularEc('593991234567')).toBe('0991234567');
  });

  it('vacío es válido, salvo que sea obligatorio', () => {
    expect(normalizarCelularEc('')).toBe('');
    expect(normalizarCelularEc(undefined)).toBe('');
    expect(() => normalizarCelularEc('  ', true)).toThrow(/obligatorio/);
  });

  it('rechaza lo que no es un celular de 10 dígitos con 09', () => {
    for (const malo of ['0891234567', '099123456', '09912345678', 'abc', '022345678', '+1 555 123 4567']) {
      expect(() => normalizarCelularEc(malo)).toThrow(/celular ecuatoriano/);
    }
  });
});
