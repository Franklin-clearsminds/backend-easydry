import { ambitoDeUsuario } from './capacidades.js';
import { rolDeUsuario } from './alias-roles.js';

/**
 * Sobre qué datos actúa el usuario. Regla única para todos los módulos:
 *  - GLOBAL: todo el país.
 *  - REGION: su región (la del usuario; el asistente de bodega usa la de su bodega).
 *  - AGENCIA: su agencia. Un pulidor móvil (sin agencia) opera en su región.
 *  - PROPIO: solo lo asignado a él.
 *  - NINGUNO: al usuario le falta el dato de su ámbito (agencia o región): no ve nada.
 * Nunca se usa un id que mande el cliente como respaldo.
 */
export type Alcance =
  | { tipo: 'GLOBAL' }
  | { tipo: 'REGION'; regionId: string }
  | { tipo: 'AGENCIA'; agenciaId: string }
  | { tipo: 'PROPIO'; userId: string }
  | { tipo: 'NINGUNO' };

const NINGUNO: Alcance = { tipo: 'NINGUNO' };

export function resolverAlcance(user: any): Alcance {
  const ambito = ambitoDeUsuario(user);
  const regionId: string | undefined = user?.regionId || user?.bodega?.regionId || undefined;
  const agenciaId: string | undefined = user?.agenciaId || undefined;

  switch (ambito) {
    case 'GLOBAL':
      return { tipo: 'GLOBAL' };
    case 'REGION':
      return regionId ? { tipo: 'REGION', regionId } : NINGUNO;
    case 'AGENCIA':
      if (agenciaId) return { tipo: 'AGENCIA', agenciaId };
      // El pulidor móvil no tiene agencia: opera en su región.
      if (rolDeUsuario(user) === 'PULIDOR' && regionId) return { tipo: 'REGION', regionId };
      return NINGUNO;
    case 'PROPIO':
      return user?.id ? { tipo: 'PROPIO', userId: String(user.id) } : NINGUNO;
    default:
      return NINGUNO;
  }
}

/** Condición que no coincide con ningún registro. */
export const SIN_RESULTADOS = { id: { in: [] as string[] } };

/** Filtro Prisma sobre la tabla de agencias (`agencia.id` / `agencia.regionId`). */
export function whereAgencias(a: Alcance): Record<string, unknown> {
  switch (a.tipo) {
    case 'GLOBAL':
      return {};
    case 'REGION':
      return { regionId: a.regionId };
    case 'AGENCIA':
      return { id: a.agenciaId };
    default:
      return SIN_RESULTADOS;
  }
}

/**
 * Filtro Prisma para una tabla que guarda `agenciaId` (servicios, bahías, stock…). `relacion` es el nombre de la relación
 * a la agencia (por defecto `agencia`) para poder filtrar por región.
 */
export function whereSobreAgencia(a: Alcance, campoAgenciaId = 'agenciaId', relacion = 'agencia'): Record<string, unknown> {
  switch (a.tipo) {
    case 'GLOBAL':
      return {};
    case 'REGION':
      return { [relacion]: { regionId: a.regionId } };
    case 'AGENCIA':
      return { [campoAgenciaId]: a.agenciaId };
    default:
      return SIN_RESULTADOS;
  }
}

/** ¿Puede el usuario actuar sobre una agencia concreta (y su región)? */
export function puedeSobreAgencia(a: Alcance, agencia: { id?: string | null; regionId?: string | null }): boolean {
  switch (a.tipo) {
    case 'GLOBAL':
      return true;
    case 'REGION':
      return !!agencia.regionId && agencia.regionId === a.regionId;
    case 'AGENCIA':
      return !!agencia.id && agencia.id === a.agenciaId;
    default:
      return false;
  }
}
