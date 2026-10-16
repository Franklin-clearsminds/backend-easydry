import { BadRequestException } from '@nestjs/common';

/**
 * Política de contraseñas del sistema. Es la ÚNICA definición: la usan el backend (crear usuarios y asignar contraseñas), el script de
 * importación del Excel y el seed. Debe coincidir con `frontend-easy-dry/src/app/core/utils/password-politica.ts`, que la repite para
 * avisar al usuario antes de enviar el formulario.
 */
export const PASSWORD_LARGO_MINIMO = 10;
export const PASSWORD_MENSAJE = `La contraseña debe tener al menos ${PASSWORD_LARGO_MINIMO} caracteres, con mayúscula, minúscula, número y un carácter especial (por ejemplo ! @ # $ % & * ?).`;

const COMUNES = ['password', 'contraseña', 'contrasena', 'qwerty', '123456', 'abc123', 'easydry', 'admin', 'bienvenido'];

/** Un carácter que no es letra, número ni espacio. */
const ESPECIAL = /[^\p{L}\p{N}\s]/u;

/** ¿Hay `n` o más caracteres seguidos iguales (aaaa) o consecutivos, ascendentes o descendentes (1234, abcd, dcba)? */
function tieneSecuenciaObvia(minuscula: string, n = 4): boolean {
  let iguales = 1;
  let sube = 1;
  let baja = 1;
  for (let i = 1; i < minuscula.length; i++) {
    const d = minuscula.charCodeAt(i) - minuscula.charCodeAt(i - 1);
    const alfanumerico = /[a-z0-9]/.test(minuscula[i]) && /[a-z0-9]/.test(minuscula[i - 1]);
    iguales = d === 0 ? iguales + 1 : 1;
    sube = d === 1 && alfanumerico ? sube + 1 : 1;
    baja = d === -1 && alfanumerico ? baja + 1 : 1;
    if (iguales >= n || sube >= n || baja >= n) return true;
  }
  return false;
}

/** Devuelve el motivo por el que la contraseña no sirve, o `null` si cumple la política. */
export function motivoPasswordDebil(password: string, email?: string): string | null {
  if (password !== password.trim()) return 'La contraseña no puede empezar ni terminar con espacios.';
  if (password.length < PASSWORD_LARGO_MINIMO || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !ESPECIAL.test(password)) {
    return PASSWORD_MENSAJE;
  }
  const minuscula = password.toLowerCase();
  if (COMUNES.some((c) => minuscula.includes(c))) return 'La contraseña es demasiado común: evite palabras como "password", "admin" o "123456".';
  if (tieneSecuenciaObvia(minuscula)) return 'La contraseña no puede tener secuencias obvias (1234, abcd) ni cuatro caracteres iguales seguidos.';
  const usuario = (email ?? '').split('@')[0].toLowerCase();
  if (usuario.length >= 4 && minuscula.includes(usuario)) return 'La contraseña no puede contener el correo del usuario.';
  return null;
}

export function exigirPasswordSegura(password: string, email?: string): void {
  const motivo = motivoPasswordDebil(password, email);
  if (motivo) throw new BadRequestException(motivo);
}
