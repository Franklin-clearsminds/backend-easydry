import { ForbiddenException } from '@nestjs/common';

/** Roles del módulo de maquinaria (nombres tal cual están en la tabla roles). */
export const ROL = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  COORD_MANTENIMIENTO: 'COORD_MANTENIMIENTO',
  COORD_BODEGA: 'COORD_BODEGA',
  TECNICO: 'TECNICO',
} as const;

export const ROLES_PULIDOR = ['PULIDOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL'];
export const ROLES_LIDER = ['LIDER', 'LIDER_OPERADOR', 'LIDER_AGENCIA'];
/** Quienes tienen contacto con la máquina: reportan y ven solo lo asignado a ellos. */
export const ROLES_OPERADOR = [...ROLES_PULIDOR, ...ROLES_LIDER];
export const ROLES_ADMIN: string[] = [ROL.SUPER_ADMIN, ROL.ADMIN];

/** Permisos por acción (se aplican en el backend con @Roles y de nuevo en el servicio). */
export const PERMISOS = {
  crearMaquina: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_BODEGA],
  editarMaquina: [ROL.ADMIN, ROL.SUPER_ADMIN],
  activarMaquina: [ROL.ADMIN, ROL.SUPER_ADMIN],
  verMaquinas: [
    ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_BODEGA, ROL.COORD_MANTENIMIENTO, ROL.TECNICO, ...ROLES_OPERADOR,
  ],
  asignarOperador: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO],
  reportarIncidente: ROLES_OPERADOR,
  verIncidentes: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO, ROL.TECNICO, ...ROLES_OPERADOR],
  asignarTrabajo: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO],
  repararIncidente: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO, ROL.TECNICO],
  editarIncidente: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO, ROL.TECNICO],
  programarMantenimiento: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO],
  ejecutarMantenimiento: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO, ROL.TECNICO],
  verMantenimientos: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO, ROL.TECNICO],
  moverMaquina: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO],
  verTrazabilidad: [ROL.ADMIN, ROL.SUPER_ADMIN, ROL.COORD_MANTENIMIENTO],
} as const;

/** Quién está haciendo la petición, ya normalizado desde el JWT. */
export interface Actor {
  id: string;
  rol: string;
  regionId: string | null;
  agenciaId: string | null;
}

export function actorFromUser(user: any): Actor {
  const rol = String(user?.roleDetails?.namerol || user?.role?.namerol || (typeof user?.role === 'string' ? user.role : '') || '');
  return {
    id: String(user?.id || ''),
    rol,
    regionId: user?.regionId || null,
    agenciaId: user?.agenciaId || null,
  };
}

export const esAdmin = (actor: Actor): boolean => ROLES_ADMIN.includes(actor.rol);
export const esOperador = (actor: Actor): boolean => ROLES_OPERADOR.includes(actor.rol);
export const esCoordMantenimiento = (actor: Actor): boolean => actor.rol === ROL.COORD_MANTENIMIENTO;
export const esTecnico = (actor: Actor): boolean => actor.rol === ROL.TECNICO;

/**
 * El coordinador (y el técnico) solo operan en la región de la máquina.
 * Admin y super admin no tienen restricción regional.
 */
export function assertRegion(actor: Actor, regionDeLaMaquina: string | null | undefined): void {
  if (esAdmin(actor)) return;
  if (!actor.regionId) {
    throw new ForbiddenException('Tu usuario no tiene una región asignada.');
  }
  if (!regionDeLaMaquina || regionDeLaMaquina !== actor.regionId) {
    throw new ForbiddenException('Esta máquina pertenece a otra región.');
  }
}

/** true si el rol está en la lista (SUPER_ADMIN siempre pasa, igual que en RolesGuard). */
export function tieneRol(actor: Actor, roles: readonly string[]): boolean {
  return actor.rol === ROL.SUPER_ADMIN || roles.includes(actor.rol);
}

/** Suma días de calendario a una fecha (sin mutar la original). */
export function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}
