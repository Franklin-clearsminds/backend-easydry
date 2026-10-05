/**
 * Nombres antiguos de rol que aún pueden llegar (datos viejos o clientes desactualizados) y el rol oficial al que
 * equivalen. Toda comparación de roles en el backend pasa por `normalizarRol`, para no repetir listas de alias.
 */
const ALIAS: Record<string, string> = {
  GERENTE: 'APROBADOR',
  GERENTE_REGIONAL: 'SUPERVISOR',
  LIDER_AGENCIA: 'LIDER',
  LIDER_OPERADOR: 'LIDER',
  OPERADOR: 'LAVADOR',
  PULIDOR_FIJO: 'PULIDOR',
  PULIDOR_MOVIL: 'PULIDOR',
  DISTRIBUIDOR: 'COORD_BODEGA',
  ADMINISTRADOR: 'ADMIN',
};

export function normalizarRol(nombre: unknown): string {
  const limpio = String(nombre ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  return ALIAS[limpio] ?? limpio;
}

/** Nombre del rol de un usuario ya autenticado (`req.user`), normalizado. */
export function rolDeUsuario(user: any): string {
  const bruto = user?.roleDetails?.namerol ?? user?.role?.namerol ?? (typeof user?.role === 'string' ? user.role : '');
  return normalizarRol(bruto);
}
