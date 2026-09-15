export interface SystemPermission {
  codigo: string;
  nombre: string;
  descripcion: string;
  grupo: string;
  icono?: string;
  rutaPrincipal?: string;
  orden?: number;
}

/**
 * @deprecated El catálogo vive en la tabla `modulos_sistema`.
 * Este archivo se mantiene solo como tipado auxiliar; RolesService lee desde BD.
 */
export const OFFICIAL_PERMISSIONS: SystemPermission[] = [];
export const OFFICIAL_PERMISSION_CODES: string[] = [];
