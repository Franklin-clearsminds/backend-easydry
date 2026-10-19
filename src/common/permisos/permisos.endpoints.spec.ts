import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { PERMISO_KEY, PUBLICO_KEY, SOLO_AUTENTICADO_KEY } from './permisos.decorators.js';
import { esCodigoPermiso } from './catalogo-permisos.js';
import { CONTROLADORES, rutas } from './controladores.js';
import { MaquinariaController } from '../../modules/maquinaria/maquinaria.controller.js';

describe('todos los endpoints declaran su permiso (falla cerrado)', () => {
  it.each(CONTROLADORES)('%s', (_n, controlador) => {
    const lista = rutas(controlador);
    expect(lista.length).toBeGreaterThan(0);
    for (const { nombre, handler } of lista) {
      const permisos: string[] | undefined = Reflect.getMetadata(PERMISO_KEY, handler);
      const publico = Reflect.getMetadata(PUBLICO_KEY, handler);
      const solo = Reflect.getMetadata(SOLO_AUTENTICADO_KEY, handler);
      expect(Boolean(permisos?.length || publico || solo), `${controlador.name}.${nombre} no declara permiso`).toBe(true);
      for (const p of permisos ?? []) expect(esCodigoPermiso(p), `${controlador.name}.${nombre}: permiso ${p} fuera del catálogo`).toBe(true);
    }
  });

  it('solo estos endpoints son públicos', () => {
    const publicos: string[] = [];
    for (const [, c] of CONTROLADORES) {
      for (const { nombre, handler } of rutas(c)) if (Reflect.getMetadata(PUBLICO_KEY, handler)) publicos.push(`${c.name}.${nombre}`);
    }
    expect(publicos.sort()).toEqual(['AuthController.login', 'AuthController.logout', 'AuthController.refresh', 'StorageController.getFile', 'SyncController.ping']);
  });

  it('exigen solo sesión únicamente la cuenta propia y el almacenamiento (con chequeo interno)', () => {
    const solos: string[] = [];
    for (const [, c] of CONTROLADORES) {
      for (const { nombre, handler } of rutas(c)) if (Reflect.getMetadata(SOLO_AUTENTICADO_KEY, handler)) solos.push(`${c.name}.${nombre}`);
    }
    expect(solos.sort()).toEqual([
      'AuthController.cambiarPassword', 'AuthController.getMe', 'AuthController.updateProfile',
      // Las notificaciones son siempre del propio usuario (Q4: pantalla de cuenta, no se apaga por rol).
      'NotificationsController.list', 'NotificationsController.marcarLeida', 'NotificationsController.marcarTodasLeidas', 'NotificationsController.resumen',
      'StorageController.getPresignedUrl', 'StorageController.getUploadTicket', 'StorageController.uploadFile',
    ]);
  });

  it('protege por separado la subida de evidencias de maquinaria y limpieza', () => {
    expect(Reflect.getMetadata(PERMISO_KEY, MaquinariaController.prototype.agregarEvidencia)).toEqual(['taller.incidentes.evidencias', 'taller.mantenimientos.evidencias']);
    expect(Reflect.getMetadata(PERMISO_KEY, MaquinariaController.prototype.registrarLimpieza)).toEqual(['taller.limpiezas.registrar']);
  });
});
