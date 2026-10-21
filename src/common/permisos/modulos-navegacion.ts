import { ROL_SUPER_ADMIN, type CodigoPermiso } from './catalogo-permisos.js';
import { PAGINAS } from './catalogo-paginas.js';

/**
 * Pantallas (módulos de navegación) que habilita cada permiso.
 *
 * El menú ya no se configura aparte: un rol ve una pantalla si tiene al menos uno de los permisos que la habilitan.
 * Así no puede existir un rol con permisos de una pantalla que no ve, ni con una pantalla que abre vacía.
 * `null` = pantalla de cuenta: la ve todo rol que tenga algún permiso.
 *
 * Los códigos coinciden con `modulos_sistema.codigo` y con `moduloCodigo` del menú de la web.
 */
export const PERMISOS_POR_MODULO: Readonly<Record<string, readonly CodigoPermiso[] | null>> = {
  dashboard: ['dashboard.ver'],
  notificaciones: null,
  // «Agencias & Mapa Red» es una sola pantalla: el mapa es una pestaña suya (antes tenía su propio módulo, 'mapa-operativo').
  agencias: ['agencias.consultar', 'mapa.ver', 'bahias.asignar', 'agencias.crear', 'agencias.transferir', 'regiones.transferir', 'agencias.editar', 'agencias.estado', 'regiones.gestionar', 'clientes.gestionar', 'agencias.precios.gestionar'],
  operadores: ['operadores.ver', 'operadores.gestionar', 'bahias.asignar', 'especiales.crear', 'especiales.asignar', 'especiales.reasignar'],
  'configuracion/servicios': ['catalogo.ver'],
  servicios: ['servicios.ver', 'especiales.ver'],
  aprobaciones: ['servicios.decidir'],
  productividad: ['productividad.ver'],
  maquinaria: ['maquinaria.ver'],
  'taller-tecnico': ['incidentes.ver', 'mantenimientos.ver', 'limpiezas.ver'],
  inventario: ['inventario.ver'],
  envios: ['despachos.ver'],
  reportes: ['reportes.ver'],
  'informes-inspeccion': ['informes.ver'],
  'auditorias-5s': ['inspecciones.ver'],
  usuarios: ['usuarios.gestionar', 'backup.gestionar', 'roles.ver', 'roles.gestionar'],
  perfil: null,
};

export const MODULOS_NAVEGACION: readonly string[] = Object.keys(PERMISOS_POR_MODULO);

/** Pantallas que ve un rol según sus permisos (SUPER_ADMIN las ve todas). */
export function modulosDeCapacidades(capacidades: readonly string[] | null | undefined, namerol?: string | null): string[] {
  if (namerol === ROL_SUPER_ADMIN) return [...MODULOS_NAVEGACION];
  const propias = new Set(capacidades ?? []);
  if (!propias.size) return [];
  // Con páginas guardadas, el menú sale de las páginas activas (más las pantallas de cuenta).
  if ([...propias].some((c) => c.startsWith('pagina.'))) {
    const activas = new Set(PAGINAS.filter((p) => propias.has(p.codigo) && p.modulo !== null).map((p) => p.modulo as string));
    return MODULOS_NAVEGACION.filter((m) => PERMISOS_POR_MODULO[m] === null || activas.has(m));
  }
  return MODULOS_NAVEGACION.filter((m) => {
    const requeridos = PERMISOS_POR_MODULO[m];
    return requeridos === null || requeridos.some((c) => propias.has(c));
  });
}

/** Pantallas del rol guardado (acepta el `role` de Prisma o el `roleDetails` del usuario autenticado). */
export function modulosDeRol(role: { namerol?: string | null; capacidades?: readonly string[] | null } | null | undefined): string[] {
  return modulosDeCapacidades(role?.capacidades, role?.namerol);
}
