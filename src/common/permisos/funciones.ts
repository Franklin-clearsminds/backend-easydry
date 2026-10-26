import type { Prisma } from '@prisma/client';
import { normalizarRol, rolDeUsuario } from './alias-roles.js';

/**
 * Funciones del rol: lo que el rol «es» para el sistema (líder de agencia, pulidor, técnico…), guardado en sus permisos como cualquier otra
 * casilla. Cada comportamiento que antes dependía del NOMBRE del rol —quién ve solo lo asignado, quién recibe un aviso, a quién se le puede
 * asignar una incidencia— depende ahora de estas casillas. Así un rol creado desde «Roles y permisos» con las mismas casillas y el mismo
 * ámbito que uno oficial se comporta exactamente igual, sea cual sea su nombre.
 *
 * Los roles que todavía no guardan ninguna función (bases sin migrar, pruebas con roles armados a mano) se interpretan por el nombre del rol
 * oficial, para no cambiar lo que hacían.
 */
export const FUNCION = {
  ADMINISTRADOR: 'funcion.administrador',
  LIDER_AGENCIA: 'funcion.lider_agencia',
  LIDER: 'funcion.lider',
  AUXILIAR: 'funcion.auxiliar',
  BACKUP: 'funcion.backup',
  LAVADOR: 'funcion.lavador',
  APROBADOR: 'funcion.aprobador',
  PULIDOR: 'funcion.pulidor',
  TECNICO: 'funcion.tecnico',
  COORD_MANTENIMIENTO: 'funcion.coord_mantenimiento',
  SUPERVISOR: 'funcion.supervisor',
  COORD_ESPECIALES: 'funcion.coord_especiales',
  COMERCIAL: 'funcion.comercial',
  COMERCIAL_NACIONAL: 'funcion.comercial_nacional',
  COORD_BODEGA: 'funcion.coord_bodega',
  ASISTENTE_BODEGA: 'funcion.asistente_bodega',
} as const;

export type CodigoFuncion = (typeof FUNCION)[keyof typeof FUNCION];

export const TODAS_LAS_FUNCIONES: readonly CodigoFuncion[] = Object.values(FUNCION);

/** Funciones que traen los roles oficiales. */
export const FUNCIONES_DE_ROL_OFICIAL: Readonly<Record<string, readonly CodigoFuncion[]>> = {
  SUPER_ADMIN: [FUNCION.ADMINISTRADOR],
  ADMIN: [FUNCION.ADMINISTRADOR],
  SUPERVISOR: [FUNCION.SUPERVISOR],
  COORD_MANTENIMIENTO: [FUNCION.COORD_MANTENIMIENTO],
  COORD_SERVICIOS_ESPECIALES: [FUNCION.COORD_ESPECIALES],
  COORD_COMERCIAL: [FUNCION.COMERCIAL],
  JEFE_COMERCIAL: [FUNCION.COMERCIAL, FUNCION.COMERCIAL_NACIONAL],
  COORD_BODEGA: [FUNCION.COORD_BODEGA],
  ASISTENTE_BODEGA: [FUNCION.ASISTENTE_BODEGA],
  TECNICO: [FUNCION.TECNICO],
  PULIDOR: [FUNCION.PULIDOR],
  LIDER: [FUNCION.LIDER_AGENCIA, FUNCION.LIDER],
  BACKUP: [FUNCION.LIDER_AGENCIA, FUNCION.BACKUP],
  AUXILIAR: [FUNCION.LIDER_AGENCIA, FUNCION.AUXILIAR, FUNCION.LAVADOR],
  LAVADOR: [FUNCION.LAVADOR],
  APROBADOR: [FUNCION.APROBADOR],
};

const PREFIJO = 'funcion.';

/** Permisos guardados del rol del usuario (sin importar de qué forma llegó el usuario: JWT, `roleDetails` o `role`). */
function capacidadesGuardadas(user: any): string[] {
  const g = user?.roleDetails?.capacidades ?? user?.role?.capacidades;
  return Array.isArray(g) ? g : [];
}

/** Funciones que se aplican a un rol: las que guarda y, si no guarda ninguna, las de su nombre oficial. */
export function funcionesDeRol(capacidades: readonly string[] | null | undefined, namerol: unknown): ReadonlySet<string> {
  const propias = (capacidades ?? []).filter((c) => c.startsWith(PREFIJO));
  if (propias.length > 0) return new Set(propias);
  return new Set(FUNCIONES_DE_ROL_OFICIAL[normalizarRol(namerol)] ?? []);
}

export function funcionesDeUsuario(user: any): ReadonlySet<string> {
  return funcionesDeRol(capacidadesGuardadas(user), rolDeUsuario(user));
}

export function tieneFuncion(user: any, funcion: CodigoFuncion): boolean {
  return funcionesDeUsuario(user).has(funcion);
}

export function tieneAlgunaFuncion(user: any, funciones: readonly CodigoFuncion[]): boolean {
  const mias = funcionesDeUsuario(user);
  return funciones.some((f) => mias.has(f));
}

/** Nombres de los roles oficiales que tienen alguna de estas funciones (para los roles que aún no guardan funciones). */
function rolesOficialesCon(funciones: readonly CodigoFuncion[]): string[] {
  return Object.entries(FUNCIONES_DE_ROL_OFICIAL)
    .filter(([, fs]) => fs.some((f) => funciones.includes(f)))
    .map(([nombre]) => nombre);
}

/**
 * Filtro de Prisma para `role: …` que deja a los usuarios cuyo rol tiene alguna de estas funciones. Un rol que no guarda ninguna función
 * se reconoce por su nombre oficial, igual que `funcionesDeRol`.
 */
export function rolConFuncion(...funciones: CodigoFuncion[]): Prisma.RoleWhereInput {
  return {
    OR: [
      { capacidades: { hasSome: funciones } },
      { AND: [{ NOT: { capacidades: { hasSome: [...TODAS_LAS_FUNCIONES] } } }, { namerol: { in: rolesOficialesCon(funciones) } }] },
    ],
  };
}

/** Lo contrario de `rolConFuncion`. */
export function rolSinFuncion(...funciones: CodigoFuncion[]): Prisma.RoleWhereInput {
  return { NOT: rolConFuncion(...funciones) };
}
