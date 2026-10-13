/**
 * No hay alias de rol: cada nombre de la tabla `roles` es un rol distinto. `normalizarRol` solo limpia el texto
 * (espacios, mayúsculas, guion bajo) para poder comparar nombres sin depender de cómo llegaron escritos.
 */
export function normalizarRol(nombre: unknown): string {
  return String(nombre ?? '').trim().toUpperCase().replace(/\s+/g, '_');
}

/**
 * BACKUP es un rol propio (reemplazo temporal de un líder, con sus reglas de gestión de usuarios) que tiene las mismas
 * capacidades que LIDER. Todo lo que hoy se pregunta como "¿es líder de agencia?" debe incluir a ambos: usa esta lista
 * (o `esLiderDeAgencia`) en vez de repetir `['LIDER', 'BACKUP']` a mano.
 */
export const ROLES_LIDER_AGENCIA: readonly string[] = ['LIDER', 'BACKUP'];

/** `rol` ya normalizado (`normalizarRol` / `rolDeUsuario`). */
export function esLiderDeAgencia(rol: string): boolean {
  return ROLES_LIDER_AGENCIA.includes(rol);
}

/** Nombre del rol de un usuario ya autenticado (`req.user`), normalizado. */
export function rolDeUsuario(user: any): string {
  const bruto = user?.roleDetails?.namerol ?? user?.role?.namerol ?? (typeof user?.role === 'string' ? user.role : '');
  return normalizarRol(bruto);
}
