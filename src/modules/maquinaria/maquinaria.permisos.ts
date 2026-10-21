import { ForbiddenException } from '@nestjs/common';
import { esLiderDeAgencia, rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { ambitoDeUsuario } from '../../common/permisos/capacidades.js';

/** Roles del módulo de maquinaria (nombres normalizados, tal cual están en la tabla roles). */
export const ROL = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  COORD_MANTENIMIENTO: 'COORD_MANTENIMIENTO',
  COORD_SERVICIOS_ESPECIALES: 'COORD_SERVICIOS_ESPECIALES',
  COORD_BODEGA: 'COORD_BODEGA',
  COORD_COMERCIAL: 'COORD_COMERCIAL',
  TECNICO: 'TECNICO',
  PULIDOR: 'PULIDOR',
  LIDER: 'LIDER',
} as const;

/**
 * A quién se le puede asignar una máquina como responsable personal (`operadorAsignadoId`): solo
 * pulidores (fijo o móvil). El líder NO se asigna así — ya ve y reporta toda la maquinaria de su
 * agencia por ser líder (`esLider`, ver `scopeMaquinaria`/`scopeIncidentes` y `reportarIncidente`
 * en `maquinaria.service.ts`), así que asignarle además una máquina en concreto no aporta nada y
 * confundía la lista de candidatos con pulidores fijos y móviles.
 */
export const ROLES_OPERADOR: string[] = [ROL.PULIDOR];
export const ROLES_ADMIN: string[] = [ROL.SUPER_ADMIN, ROL.ADMIN];

/**
 * Qué acciones puede hacer cada rol lo deciden los permisos guardados en el rol (decorador Permiso en el controlador).
 * Aquí solo queda el alcance: sobre qué máquinas puede actuar quien ya tiene el permiso.
 */

/** Quién está haciendo la petición, ya normalizado desde el JWT. */
export interface Actor {
  id: string;
  rol: string;
  regionId: string | null;
  agenciaId: string | null;
  /**
   * Ámbito del rol (GLOBAL, REGION, AGENCIA, PROPIO). Manda cuando el rol no es uno de los oficiales del módulo:
   * un rol creado desde Roles ve lo mismo que su ámbito, no lo que diga su nombre.
   */
  ambito?: string;
}

export function actorFromUser(user: any): Actor {
  const rol = rolDeUsuario(user);
  return {
    id: String(user?.id || ''),
    rol,
    // Misma regla que `resolverAlcance`: el asistente de bodega toma la región de su bodega.
    regionId: user?.regionId || user?.bodega?.regionId || null,
    agenciaId: user?.agenciaId || null,
    ambito: ambitoDeUsuario(user),
  };
}

export const esAdmin = (actor: Actor): boolean => ROLES_ADMIN.includes(actor.rol);
export const esOperador = (actor: Actor): boolean => ROLES_OPERADOR.includes(actor.rol);
export const esSupervisor = (actor: Actor): boolean => actor.rol === ROL.SUPERVISOR;
export const esCoordServiciosEspeciales = (actor: Actor): boolean => actor.rol === ROL.COORD_SERVICIOS_ESPECIALES;
export const esCoordMantenimiento = (actor: Actor): boolean => actor.rol === ROL.COORD_MANTENIMIENTO;
export const esCoordComercial = (actor: Actor): boolean => actor.rol === ROL.COORD_COMERCIAL;
export const esTecnico = (actor: Actor): boolean => actor.rol === ROL.TECNICO;
export const esLider = (actor: Actor): boolean => esLiderDeAgencia(actor.rol);
export const esPulidor = (actor: Actor): boolean => actor.rol === ROL.PULIDOR;

const ROLES_OFICIALES = new Set<string>(Object.values(ROL));
/** Rol creado desde la pantalla de Roles (no es uno de los oficiales del módulo): su alcance lo define su ámbito. */
export const esRolPropio = (actor: Actor): boolean => !ROLES_OFICIALES.has(actor.rol);

/**
 * El coordinador (y el técnico) solo operan en la región de la máquina.
 * Admin y super admin no tienen restricción regional.
 */
export function assertRegion(actor: Actor, regionDeLaMaquina: string | null | undefined): void {
  // Ámbito país: no hay región que respetar.
  if (esAdmin(actor) || actor.ambito === 'GLOBAL') return;
  if (!actor.regionId) {
    throw new ForbiddenException('Tu usuario no tiene una región asignada.');
  }
  if (!regionDeLaMaquina || regionDeLaMaquina !== actor.regionId) {
    throw new ForbiddenException('Esta máquina pertenece a otra región.');
  }
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
