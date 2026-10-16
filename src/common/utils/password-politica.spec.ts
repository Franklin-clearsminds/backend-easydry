import { describe, expect, it } from 'vitest';
import { exigirPasswordSegura, motivoPasswordDebil, PASSWORD_MENSAJE } from './password-politica.js';
import { tokenRevocado } from '../../modules/auth/jwt.strategy.js';

describe('política de contraseñas', () => {
  it.each(['Lavado#2026Seco', 'Taller*Norte84', 'Cera.Pulida_77x', 'Ñandú$Verde2026'])('acepta %s', (clave) => {
    expect(motivoPasswordDebil(clave)).toBeNull();
  });

  it.each([
    ['sin carácter especial', 'Lavado2026Seco'],
    ['sin mayúscula', 'lavado#2026seco'],
    ['sin minúscula', 'LAVADO#2026SECO'],
    ['sin número', 'Lavado#SecoLimpio'],
    ['demasiado corta', 'Ab1#xyz'],
    ['solo letras y símbolos', 'Lavado#Seco#Limpio'],
  ])('rechaza una contraseña %s', (_motivo, clave) => {
    expect(motivoPasswordDebil(clave)).toBe(PASSWORD_MENSAJE);
  });

  it('el mínimo es de 10 caracteres: con 9 no pasa y con 10 sí', () => {
    expect(motivoPasswordDebil('Lavad#2026')).toBeNull(); // 10
    expect(motivoPasswordDebil('Lava#2026')).not.toBeNull(); // 9
  });

  it('no admite espacios al inicio o al final, pero sí dentro', () => {
    expect(motivoPasswordDebil(' Lavado#2026Seco')).toMatch(/espacios/);
    expect(motivoPasswordDebil('Lavado#2026Seco ')).toMatch(/espacios/);
    expect(motivoPasswordDebil('Lavado #2026 Seco')).toBeNull();
  });

  it('rechaza palabras comunes y el propio correo', () => {
    expect(motivoPasswordDebil('Password#9x7Z')).toMatch(/común/);
    expect(motivoPasswordDebil('Maria.Perez#2026X', 'maria.perez@easydry.com')).toMatch(/correo/);
  });

  it('rechaza secuencias obvias y caracteres repetidos', () => {
    expect(motivoPasswordDebil('Tallerx#1234Zq')).toMatch(/secuencias/);
    expect(motivoPasswordDebil('Tallerx#9876Zq')).toMatch(/secuencias/);
    expect(motivoPasswordDebil('Zabcd#Tallero5')).toMatch(/secuencias/);
    expect(motivoPasswordDebil('Taller#5Zqaaaa')).toMatch(/secuencias/);
    // Tres seguidas y números separados sí valen.
    expect(motivoPasswordDebil('Taller#5Zqaaa9')).toBeNull();
    expect(motivoPasswordDebil('Taller#1x2Y3z4')).toBeNull();
  });

  it('exigirPasswordSegura lanza 400 con el motivo', () => {
    expect(() => exigirPasswordSegura('debil')).toThrow(PASSWORD_MENSAJE);
    expect(() => exigirPasswordSegura('Lavado#2026Seco')).not.toThrow();
  });
});

describe('revocación de access tokens', () => {
  const t = (seg: number) => new Date(seg * 1000);
  it('sin revocación, el token vale', () => expect(tokenRevocado(1000, null)).toBe(false));
  it('un token emitido antes de la revocación no vale', () => expect(tokenRevocado(1000, t(1500))).toBe(true));
  it('un token emitido después de la revocación vale', () => expect(tokenRevocado(2000, t(1500))).toBe(false));
  it('un token sin fecha de emisión no vale si hubo revocación', () => expect(tokenRevocado(undefined, t(1500))).toBe(true));
});
