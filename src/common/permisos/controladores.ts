import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from '../../modules/auth/auth.controller.js';
import { AgenciasController } from '../../modules/agencias/agencias.controller.js';
import { AnalyticsController } from '../../modules/analytics/analytics.controller.js';
import { AprobacionesController } from '../../modules/aprobaciones/aprobaciones.controller.js';
import { CatalogosController } from '../../modules/catalogos/catalogos.controller.js';
import { InventarioController } from '../../modules/inventario/inventario.controller.js';
import { MaquinariaController } from '../../modules/maquinaria/maquinaria.controller.js';
import { OperacionesController } from '../../modules/operaciones/operaciones.controller.js';
import { ServiciosEspecialesController } from '../../modules/operaciones/servicios-especiales.controller.js';
import { RetosController } from '../../modules/retos/retos.controller.js';
import { RolesController } from '../../modules/roles/roles.controller.js';
import { StorageController } from '../../modules/storage/storage.controller.js';
import { SyncController } from '../../modules/sync/sync.controller.js';
import { NotificationsController } from '../../modules/notifications/notifications.controller.js';
import { InformesInspeccionController } from '../../modules/auditorias/informes.controller.js';
import { Auditoria5sController } from '../../modules/auditorias/auditoria5s.controller.js';

export type Controlador = new (...args: never[]) => unknown;

/** Todos los controladores de la API: los usan las pruebas de permisos y la auditoría de casillas del editor. */
export const CONTROLADORES: Array<[string, Controlador]> = [
  ['auth', AuthController], ['agencias', AgenciasController], ['analytics', AnalyticsController],
  ['aprobaciones', AprobacionesController], ['catalogos', CatalogosController], ['inventario', InventarioController],
  ['maquinaria', MaquinariaController], ['operaciones', OperacionesController], ['servicios-especiales', ServiciosEspecialesController],
  ['retos', RetosController], ['roles', RolesController], ['storage', StorageController], ['sync', SyncController],
  ['notifications', NotificationsController], ['informes-inspeccion', InformesInspeccionController], ['auditorias-5s', Auditoria5sController],
];

/** Métodos de un controlador que son rutas HTTP. */
export function rutas(controlador: Controlador) {
  const proto = controlador.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
    .map((n) => ({ nombre: n, handler: proto[n] as object }))
    .filter((r) => Reflect.getMetadata(PATH_METADATA, r.handler) !== undefined);
}
