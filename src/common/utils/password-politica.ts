import { BadRequestException } from '@nestjs/common';

/** Debe coincidir con `frontend-easy-dry/src/app/core/utils/password-politica.ts`. */
export const PASSWORD_LARGO_MINIMO = 10;
export const PASSWORD_MENSAJE = `La contraseña debe tener al menos ${PASSWORD_LARGO_MINIMO} caracteres, con mayúscula, minúscula y número.`;

const COMUNES = ['password', 'contraseña', 'contrasena', 'qwerty', '123456', 'abc123', 'easydry', 'admin', 'bienvenido'];

/** Devuelve el motivo por el que la contraseña no sirve, o `null` si cumple la política. */
export function motivoPasswordDebil(password: string, email?: string): string | null {
  if (password.length < PASSWORD_LARGO_MINIMO || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return PASSWORD_MENSAJE;
  }
  const minuscula = password.toLowerCase();
  if (COMUNES.some((c) => minuscula.includes(c))) return 'La contraseña es demasiado común: evite palabras como "password", "admin" o "123456".';
  const usuario = (email ?? '').split('@')[0].toLowerCase();
  if (usuario.length >= 4 && minuscula.includes(usuario)) return 'La contraseña no puede contener el correo del usuario.';
  return null;
}

export function exigirPasswordSegura(password: string, email?: string): void {
  const motivo = motivoPasswordDebil(password, email);
  if (motivo) throw new BadRequestException(motivo);
}
