import { ROLES_BASE } from './roles-base.js';
import { ROL_SUPER_ADMIN } from './catalogo-permisos.js';
import { rolDeUsuario } from './alias-roles.js';

/** Permisos del rol del usuario (los que están guardados en la tabla `roles`). */
export function capacidadesDeUsuario(user: any): string[] {
  const guardadas = user?.roleDetails?.capacidades ?? user?.role?.capacidades;
  return Array.isArray(guardadas) ? guardadas : [];
}

/** true si el rol del usuario tiene el permiso. SUPER_ADMIN siempre lo tiene (rol inmutable). */
export function tienePermiso(user: any, codigo: string): boolean {
  if (rolDeUsuario(user) === ROL_SUPER_ADMIN) return true;
  return capacidadesDeUsuario(user).includes(codigo);
}

export function tieneAlgunPermiso(user: any, codigos: readonly string[]): boolean {
  return codigos.some((c) => tienePermiso(user, c));
}

/** Ámbito guardado del rol; si falta (datos antiguos) se toma el del rol oficial y, por defecto, el más restrictivo. */
export function ambitoDeUsuario(user: any): string {
  const guardado = user?.roleDetails?.ambito ?? user?.role?.ambito;
  if (typeof guardado === 'string' && guardado) return guardado;
  return ROLES_BASE.find((r) => r.namerol === rolDeUsuario(user))?.ambito ?? 'AGENCIA';
}
