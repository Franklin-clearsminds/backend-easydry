import { ForbiddenException } from '@nestjs/common';

/**
 * Qué permiso por botón exige cada acción que la app sube al sincronizar. El canal de sincronización llama directo a los servicios
 * (no pasa por los controladores), así que sin esta comprobación bastaba con «Usar la app» para registrar o editar órdenes aunque
 * el botón correspondiente estuviera apagado en el rol.
 *
 * Cada acción acepta cualquiera de los permisos de su lista (como `@Permiso(...)`). `null` = la entidad no se procesa por
 * sincronización (la propia rama rechaza con su mensaje) o no exige un permiso adicional.
 */
export interface PermisoDeMutacion {
  /** Basta uno. */
  codigos: string[];
  /** Cómo se llama la acción en el mensaje de rechazo. */
  descripcion: string;
}

const ENTIDADES_SERVICIO = new Set(['servicio_lavado', 'work_order']);
const ENTIDADES_ESPECIAL = new Set(['servicio_especial', 'servicio_extra', 'special_service', 'extra_assignment']);

export function permisoRequeridoPorMutacion(entidad: string, accion: string): PermisoDeMutacion | null {
  const e = String(entidad || '').toLowerCase();
  const a = String(accion || 'CREATE').toUpperCase();

  if (ENTIDADES_SERVICIO.has(e)) {
    if (a === 'CREATE') return { codigos: ['servicios.generales.crear'], descripcion: 'registrar órdenes de servicio' };
    // UPDATE y COMPLETE (iniciar, editar y finalizar una OT) son edición de la OT.
    return { codigos: ['servicios.generales.editar'], descripcion: 'editar órdenes de servicio' };
  }
  if (ENTIDADES_ESPECIAL.has(e)) {
    if (a === 'CREATE') return { codigos: ['servicios.especiales.crear'], descripcion: 'crear servicios especiales' };
    // Iniciar, pausar, reanudar y completar lo hace el pulidor; reasignar, quien gestiona.
    return { codigos: ['servicios.especiales.operar', 'servicios.especiales.reasignar'], descripcion: 'ejecutar servicios especiales' };
  }
  return null;
}

/** Mensaje que ve el usuario en la app y el administrador en la bandeja de errores. */
export function mensajeSinPermiso(requerido: PermisoDeMutacion): string {
  return `Sin permiso: tu rol ya no puede ${requerido.descripcion}. Pide a un administrador que lo active y vuelve a sincronizar.`;
}

/** Rechazo por falta de permiso: distinto de otros 403 de la sincronización (p. ej. de alcance) para poder aislarlo en la bandeja de errores. */
export class SinPermisoMutacionException extends ForbiddenException {}
