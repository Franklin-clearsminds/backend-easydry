import { describe, expect, it } from 'vitest';
import { motivoPasswordDebil } from './password-politica.js';
import { generarPasswordTemporal } from './password-temporal.js';
import { tokenRevocado } from '../../modules/auth/jwt.strategy.js';

describe('política de contraseñas', () => {
  it('acepta una contraseña de 10+ caracteres con mayúscula, minúscula y número', () => {
    expect(motivoPasswordDebil('Lavado2026Seco')).toBeNull();
  });

  it.each(['corta1A', 'todominusculas123', 'TODOMAYUSCULAS123', 'SinNumerosAquiii'])('rechaza %s', (clave) => {
    expect(motivoPasswordDebil(clave)).not.toBeNull();
  });

  it('rechaza palabras comunes y el propio correo', () => {
    expect(motivoPasswordDebil('Password12345')).toMatch(/común/);
    expect(motivoPasswordDebil('Maria.Perez2026X', 'maria.perez@easydry.com')).toMatch(/correo/);
  });

  it('las contraseñas temporales que genera el sistema cumplen la política', () => {
    for (let i = 0; i < 200; i++) expect(motivoPasswordDebil(generarPasswordTemporal())).toBeNull();
  });
});

describe('revocación de access tokens', () => {
  const t = (seg: number) => new Date(seg * 1000);
  it('sin revocación, el token vale', () => expect(tokenRevocado(1000, null)).toBe(false));
  it('un token emitido antes de la revocación no vale', () => expect(tokenRevocado(1000, t(1500))).toBe(true));
  it('un token emitido después de la revocación vale', () => expect(tokenRevocado(2000, t(1500))).toBe(false));
  it('un token sin fecha de emisión no vale si hubo revocación', () => expect(tokenRevocado(undefined, t(1500))).toBe(true));
});
