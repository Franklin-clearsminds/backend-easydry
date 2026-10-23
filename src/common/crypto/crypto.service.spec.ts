import { describe, expect, it } from 'vitest';
import { CryptoService, PREFIJO_EN_REPOSO } from './crypto.service.js';

const servicio = (clave = 'una-clave-de-prueba-larga-para-el-cifrado') => new CryptoService({ get: () => clave } as never);

describe('cifrado de datos en la base (en reposo)', () => {
  const imagen = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('cifra y vuelve al dato original', () => {
    const c = servicio();
    const guardado = c.protegerEnReposo(imagen)!;
    expect(guardado.startsWith(PREFIJO_EN_REPOSO)).toBe(true);
    expect(guardado).not.toContain('iVBORw0KGgo');
    expect(c.revelarEnReposo(guardado)).toBe(imagen);
  });

  it('cada cifrado sale distinto, pero los dos abren al mismo dato', () => {
    const c = servicio();
    const a = c.protegerEnReposo(imagen)!;
    const b = c.protegerEnReposo(imagen)!;
    expect(a).not.toBe(b);
    expect(c.revelarEnReposo(a)).toBe(c.revelarEnReposo(b));
  });

  it('es idempotente: lo ya cifrado no se cifra otra vez', () => {
    const c = servicio();
    const guardado = c.protegerEnReposo(imagen)!;
    expect(c.protegerEnReposo(guardado)).toBe(guardado);
    expect(c.estaProtegido(guardado)).toBe(true);
    expect(c.estaProtegido(imagen)).toBe(false);
  });

  it('un dato sin la marca (anterior al cifrado) se entrega tal cual; vacío es nulo', () => {
    const c = servicio();
    expect(c.revelarEnReposo(imagen)).toBe(imagen);
    expect(c.revelarEnReposo(null)).toBeNull();
    expect(c.revelarEnReposo('')).toBeNull();
    expect(c.protegerEnReposo(null)).toBeNull();
    expect(c.protegerEnReposo('')).toBeNull();
  });

  it('con otra clave, o si el valor se altera, no se abre (nulo, sin romper)', () => {
    const guardado = servicio('clave-uno-clave-uno-clave-uno-clave')?.protegerEnReposo(imagen)!;
    expect(servicio('clave-dos-clave-dos-clave-dos-clave').revelarEnReposo(guardado)).toBeNull();
    const c = servicio();
    const propio = c.protegerEnReposo(imagen)!;
    const alterado = propio.slice(0, -6) + (propio.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
    expect(c.revelarEnReposo(alterado)).toBeNull();
  });

  it('usa una clave distinta a la del cifrado del tráfico', () => {
    const c = servicio();
    // Lo que sale del cifrado del tráfico no se puede abrir como dato en reposo y al revés.
    const trafico = c.encrypt(imagen);
    expect(c.revelarEnReposo(PREFIJO_EN_REPOSO + Buffer.from(trafico).toString('base64'))).toBeNull();
    expect(c.decrypt(trafico)).toBe(imagen);
  });
});
