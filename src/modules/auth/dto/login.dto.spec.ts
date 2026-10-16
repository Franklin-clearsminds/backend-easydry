import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto.js';

const errores = async (datos: Record<string, unknown>) => (await validate(plainToInstance(LoginDto, datos))).map((e) => e.property);

describe('LoginDto', () => {
  it('acepta un correo y una contraseña normales', async () => {
    expect(await errores({ email: 'ana@easydry.com', password: 'Lavado#2026Seco' })).toEqual([]);
  });

  it('rechaza correos que no son correos, y los intentos clásicos de inyección', async () => {
    for (const email of ["' OR '1'='1", "admin@easydry.com'; DROP TABLE \"User\";--", '<script>alert(1)</script>', 'sin-arroba', '']) {
      expect(await errores({ email, password: 'Lavado#2026Seco' }), email).toContain('email');
    }
  });

  it('limita el largo: un correo o una contraseña enormes no llegan al servicio', async () => {
    expect(await errores({ email: `${'a'.repeat(250)}@easydry.com`, password: 'Lavado#2026Seco' })).toContain('email');
    expect(await errores({ email: 'ana@easydry.com', password: 'A'.repeat(129) })).toContain('password');
    expect(await errores({ email: 'ana@easydry.com', password: 'A'.repeat(128) })).toEqual([]);
  });

  it('rechaza valores que no son texto (objetos para colarse en la consulta)', async () => {
    expect(await errores({ email: { $ne: null }, password: 'Lavado#2026Seco' })).toContain('email');
    expect(await errores({ email: 'ana@easydry.com', password: { $ne: null } })).toContain('password');
    expect(await errores({ email: 'ana@easydry.com', password: ['x'] })).toContain('password');
  });
});
