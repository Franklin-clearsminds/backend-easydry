import { SetMetadata } from '@nestjs/common';
import type { CodigoPermiso } from './catalogo-permisos.js';

export const PERMISO_KEY = 'easydry:permisos';
export const SOLO_AUTENTICADO_KEY = 'easydry:solo-autenticado';
export const PUBLICO_KEY = 'easydry:publico';

/** Exige que el rol del usuario tenga alguno de estos permisos (basta uno). SUPER_ADMIN siempre pasa. */
export const Permiso = (...codigos: CodigoPermiso[]) => SetMetadata(PERMISO_KEY, codigos);

/**
 * Cualquier usuario con sesión válida, sin un permiso concreto (perfil propio, cambio de contraseña…).
 * Úsalo solo cuando el dato es siempre del propio usuario.
 */
export const SoloAutenticado = () => SetMetadata(SOLO_AUTENTICADO_KEY, true);

/** Sin sesión (login, refresh, ping). */
export const Publico = () => SetMetadata(PUBLICO_KEY, true);
