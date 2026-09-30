import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PERMISO_KEY, PUBLICO_KEY, SOLO_AUTENTICADO_KEY } from './permisos.decorators.js';
import { CODIGOS_PERMISOS } from './catalogo-permisos.js';
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

type Controlador = new (...args: never[]) => unknown;

const CONTROLADORES: Array<[string, Controlador]> = [
  ['auth', AuthController], ['agencias', AgenciasController], ['analytics', AnalyticsController],
  ['aprobaciones', AprobacionesController], ['catalogos', CatalogosController], ['inventario', InventarioController],
  ['maquinaria', MaquinariaController], ['operaciones', OperacionesController], ['servicios-especiales', ServiciosEspecialesController],
  ['retos', RetosController], ['roles', RolesController], ['storage', StorageController], ['sync', SyncController],
];

function rutas(controlador: Controlador) {
  const proto = controlador.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
    .map((n) => ({ nombre: n, handler: proto[n] as object }))
    .filter((r) => Reflect.getMetadata(PATH_METADATA, r.handler) !== undefined);
}

describe('todos los endpoints declaran su permiso (falla cerrado)', () => {
  it.each(CONTROLADORES)('%s', (_n, controlador) => {
    const lista = rutas(controlador);
    expect(lista.length).toBeGreaterThan(0);
    for (const { nombre, handler } of lista) {
      const permisos: string[] | undefined = Reflect.getMetadata(PERMISO_KEY, handler);
      const publico = Reflect.getMetadata(PUBLICO_KEY, handler);
      const solo = Reflect.getMetadata(SOLO_AUTENTICADO_KEY, handler);
      expect(Boolean(permisos?.length || publico || solo), `${controlador.name}.${nombre} no declara permiso`).toBe(true);
      for (const p of permisos ?? []) expect(CODIGOS_PERMISOS, `${controlador.name}.${nombre}: permiso ${p} fuera del catálogo`).toContain(p);
    }
  });

  it('solo estos endpoints son públicos', () => {
    const publicos: string[] = [];
    for (const [, c] of CONTROLADORES) {
      for (const { nombre, handler } of rutas(c)) if (Reflect.getMetadata(PUBLICO_KEY, handler)) publicos.push(`${c.name}.${nombre}`);
    }
    expect(publicos.sort()).toEqual(['AuthController.login', 'AuthController.refresh', 'StorageController.getFile', 'SyncController.ping']);
  });

  it('exigen solo sesión únicamente la cuenta propia y el almacenamiento (con chequeo interno)', () => {
    const solos: string[] = [];
    for (const [, c] of CONTROLADORES) {
      for (const { nombre, handler } of rutas(c)) if (Reflect.getMetadata(SOLO_AUTENTICADO_KEY, handler)) solos.push(`${c.name}.${nombre}`);
    }
    expect(solos.sort()).toEqual([
      'AuthController.getMe', 'AuthController.updateProfile',
      'StorageController.getPresignedUrl', 'StorageController.getUploadTicket', 'StorageController.uploadFile',
    ]);
  });
});
