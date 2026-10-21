import { BadRequestException } from '@nestjs/common';

export const MENSAJE_CELULAR_EC = 'El teléfono debe ser un celular ecuatoriano de 10 dígitos que empiece con 09 (por ejemplo 0991234567).';

/**
 * Normaliza un celular de Ecuador a 10 dígitos (09XXXXXXXX). Acepta espacios, guiones, paréntesis y el prefijo +593 / 593.
 * Vacío es válido salvo que sea obligatorio. Cualquier otro formato se rechaza.
 */
export function normalizarCelularEc(valor: unknown, obligatorio = false): string {
  const bruto = String(valor ?? '').trim();
  if (!bruto) {
    if (obligatorio) throw new BadRequestException('El teléfono es obligatorio para este rol. ' + MENSAJE_CELULAR_EC);
    return '';
  }
  let digitos = bruto.replace(/[\s\-().]/g, '');
  if (digitos.startsWith('+593')) digitos = '0' + digitos.slice(4);
  else if (digitos.startsWith('593') && digitos.length === 12) digitos = '0' + digitos.slice(3);
  if (!/^09\d{8}$/.test(digitos)) throw new BadRequestException(MENSAJE_CELULAR_EC);
  return digitos;
}
