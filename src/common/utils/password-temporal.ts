import { randomInt } from 'node:crypto';

const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz';
const NUMEROS = '23456789';
const ESPECIALES = '*#-_.';

const elegir = (alfabeto: string): string => alfabeto[randomInt(alfabeto.length)];

/**
 * Contraseña aleatoria de 12 caracteres (sin letras que se confunden: 0/O, 1/l/I). Contiene mayúscula, minúscula, número
 * y un símbolo. Se entrega una sola vez a quien registra al usuario; solo un administrador puede volver a cambiarla.
 */
export function generarPasswordTemporal(): string {
  const todos = MAYUSCULAS + MINUSCULAS + NUMEROS + ESPECIALES;
  const base = [elegir(MAYUSCULAS), elegir(MINUSCULAS), elegir(NUMEROS), elegir(ESPECIALES)];
  while (base.length < 12) base.push(elegir(todos));
  // mezcla (Fisher-Yates con aleatoriedad criptográfica)
  for (let i = base.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}
