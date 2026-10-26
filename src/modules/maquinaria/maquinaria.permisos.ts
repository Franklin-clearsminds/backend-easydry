import { ForbiddenException } from '@nestjs/common';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { ambitoDeUsuario, capacidadesDeUsuario } from '../../common/permisos/capacidades.js';
import { FUNCION, funcionesDeRol, funcionesDeUsuario, type CodigoFuncion } from '../../common/permisos/funciones.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

/**
 * A quién se le puede asignar una máquina como responsable personal (`operadorAsignadoId`): a quien tiene la función de pulidor (fijo o
 * móvil). El líder NO se asigna así — ya ve y reporta toda la maquinaria de su agencia por ser líder (`esLider`, ver `scopeMaquinaria`/
 * `scopeIncidentes` y `reportarIncidente` en `maquinaria.service.ts`), así que asignarle además una máquina en concreto no aporta nada.
 */

/**
 * Qué acciones puede hacer cada rol lo deciden los permisos guardados en el rol (decorador Permiso en el controlador).
 * Aquí solo queda el alcance: sobre qué máquinas puede actuar quien ya tiene el permiso.
 */

/** Quién está haciendo la petición, ya normalizado desde el JWT. */
export interface Actor {
  id: string;
  /** Nombre del rol: solo informativo (bitácora). Nada decide por él: mandan las funciones, los permisos y el ámbito del rol. */
  rol: string;
  regionId: string | null;
  agenciaId: string | null;
  /**
   * Ámbito del rol (GLOBAL, REGION, AGENCIA, PROPIO): sobre qué máquinas actúa. Un rol creado desde Roles ve lo mismo que su ámbito.
   */
  ambito?: string;
  /** Funciones del rol (líder de agencia, pulidor, técnico…). Si falta (actor armado a mano) se deducen del nombre del rol oficial. */
  funciones?: readonly string[];
  /** Permisos del rol. Si falta (actor armado a mano) se toman los del rol oficial del mismo nombre. */
  capacidades?: readonly string[];
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
    funciones: [...funcionesDeUsuario(user)],
    capacidades: capacidadesDeUsuario(user),
  };
}

const funcionesDe = (actor: Actor): ReadonlySet<string> => (actor.funciones ? new Set(actor.funciones) : funcionesDeRol(undefined, actor.rol));
const tiene = (actor: Actor, funcion: CodigoFuncion): boolean => funcionesDe(actor).has(funcion);

/** ¿El rol del actor tiene este permiso? Un actor armado a mano (sin `capacidades`) usa los del rol oficial de su nombre. */
export function actorTienePermiso(actor: Actor, codigo: string): boolean {
  if (actor.capacidades) return actor.capacidades.includes(codigo) || actor.rol === 'SUPER_ADMIN';
  return actor.rol === 'SUPER_ADMIN' || (ROLES_BASE.find((r) => r.namerol === actor.rol)?.capacidades as readonly string[] | undefined)?.includes(codigo) === true;
}

/** Ámbito del actor; si falta (actor armado a mano) se toma el del rol oficial de su nombre; sin ninguno, no ve nada. */
export const ambitoDeActor = (actor: Actor): string | undefined => actor.ambito ?? ROLES_BASE.find((r) => r.namerol === actor.rol)?.ambito;

export const esAdmin = (actor: Actor): boolean => tiene(actor, FUNCION.ADMINISTRADOR);
/** Recibe máquinas a su nombre y solo ve lo suyo (el pulidor, fijo o móvil). */
export const esOperador = (actor: Actor): boolean => tiene(actor, FUNCION.PULIDOR);
export const esSupervisor = (actor: Actor): boolean => tiene(actor, FUNCION.SUPERVISOR);
export const esCoordServiciosEspeciales = (actor: Actor): boolean => tiene(actor, FUNCION.COORD_ESPECIALES);
export const esCoordMantenimiento = (actor: Actor): boolean => tiene(actor, FUNCION.COORD_MANTENIMIENTO);
/** Repara solo lo que le asignan. */
export const esTecnico = (actor: Actor): boolean => tiene(actor, FUNCION.TECNICO);
export const esLider = (actor: Actor): boolean => tiene(actor, FUNCION.LIDER_AGENCIA);
export const esPulidor = (actor: Actor): boolean => tiene(actor, FUNCION.PULIDOR);

/**
 * Rol sin ninguna de las funciones propias del módulo (creado desde la pantalla de Roles): su alcance lo define su ámbito y sus permisos.
 */
export const esRolPropio = (actor: Actor): boolean => {
  const mias = funcionesDe(actor);
  return ![FUNCION.ADMINISTRADOR, FUNCION.SUPERVISOR, FUNCION.COORD_MANTENIMIENTO, FUNCION.COORD_ESPECIALES, FUNCION.COORD_BODEGA, FUNCION.COMERCIAL, FUNCION.TECNICO, FUNCION.PULIDOR, FUNCION.LIDER_AGENCIA].some((f) => mias.has(f));
};

/** A quién se le puede asignar una incidencia o un mantenimiento: a quien tiene la función de técnico o de coordinador de mantenimiento. */
export const puedeRecibirTrabajo = (funciones: ReadonlySet<string>): boolean =>
  funciones.has(FUNCION.TECNICO) || funciones.has(FUNCION.COORD_MANTENIMIENTO);
/** A quién se le puede asignar una máquina a su nombre: a quien tiene la función de pulidor. */
export const puedeRecibirMaquina = (funciones: ReadonlySet<string>): boolean => funciones.has(FUNCION.PULIDOR);

/**
 * El coordinador (y el técnico) solo operan en la región de la máquina.
 * Admin y super admin no tienen restricción regional.
 */
export function assertRegion(actor: Actor, regionDeLaMaquina: string | null | undefined): void {
  // Ámbito país: no hay región que respetar.
  if (esAdmin(actor) || ambitoDeActor(actor) === 'GLOBAL') return;
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
