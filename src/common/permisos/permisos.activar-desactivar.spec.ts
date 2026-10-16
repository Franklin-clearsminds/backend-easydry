import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PAGINAS, capacidadesDesdeNuevos } from './catalogo-paginas.js';
import { CONTROLADORES, rutas } from './controladores.js';
import { PERMISO_KEY } from './permisos.decorators.js';
import { PermisosGuard } from './permisos.guard.js';

/**
 * Activar y desactivar de verdad: para cada casilla del editor de roles que algún endpoint exige, se arma el rol exactamente como lo
 * deja el editor (la página y sus pestañas encendidas, con y sin esa casilla) y se pasa por el guard real que protege la API.
 *  - con la casilla encendida el endpoint abre;
 *  - con la casilla apagada el endpoint se cierra (salvo que otro permiso que el rol sí tiene lo abra por su cuenta).
 * Es el comportamiento que se prueba a mano activando y desactivando permisos, repetido para todos los endpoints.
 */

// El guard hereda de AuthGuard('jwt'): aquí solo se prueba la decisión de permisos, la sesión se da por válida.
const padre = Object.getPrototypeOf(PermisosGuard.prototype) as { canActivate: (...a: unknown[]) => unknown };
vi.spyOn(padre, 'canActivate').mockResolvedValue(true as never);

const guard = new PermisosGuard(new Reflector());

function contexto(controlador: new (...a: never[]) => unknown, handler: object, user: unknown) {
  return {
    getHandler: () => handler,
    getClass: () => controlador,
    switchToHttp: () => ({ getRequest: () => ({ user, method: 'POST', url: '/prueba' }) }),
  } as never;
}

const usuarioConCapacidades = (capacidades: string[], namerol = 'ROL_DE_PRUEBA') => ({ id: 'u', role: { namerol, capacidades } });

async function abre(controlador: new (...a: never[]) => unknown, handler: object, user: unknown): Promise<boolean> {
  try {
    return await guard.canActivate(contexto(controlador, handler, user));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

/** Endpoints que exigen cada código, con sus alternativas (cualquiera basta). */
const endpointsPorCodigo = new Map<string, Array<{ nombre: string; controlador: new (...a: never[]) => unknown; handler: object; codigos: string[] }>>();
for (const [, controlador] of CONTROLADORES) {
  for (const { nombre, handler } of rutas(controlador)) {
    const codigos: string[] | undefined = Reflect.getMetadata(PERMISO_KEY, handler);
    for (const c of codigos ?? []) {
      endpointsPorCodigo.set(c, [...(endpointsPorCodigo.get(c) ?? []), { nombre: `${controlador.name}.${nombre}`, controlador, handler, codigos: codigos! }]);
    }
  }
}

/** El rol tal como lo deja el editor: la página y todas sus pestañas encendidas, más las casillas indicadas. */
function rolDelEditor(pagina: (typeof PAGINAS)[number], casillas: string[] = []): string[] {
  return capacidadesDesdeNuevos(new Set([pagina.codigo, ...pagina.subs.map((s) => s.codigo), ...casillas]));
}

describe('el guard abre y cierra los endpoints al activar y desactivar cada casilla', () => {
  const casos: Array<{ pagina: (typeof PAGINAS)[number]; codigo: string }> = [];
  for (const pagina of PAGINAS) {
    const codigos = new Set<string>([...pagina.acciones.map((a) => a.codigo), ...pagina.subs.flatMap((s) => s.acciones.map((a) => a.codigo))]);
    for (const codigo of codigos) if (endpointsPorCodigo.has(codigo)) casos.push({ pagina, codigo });
  }

  it('hay casillas cableadas que verificar (si esto llega a cero, la prueba no está probando nada)', () => {
    expect(casos.length).toBeGreaterThan(40);
  });

  it.each(casos.map((c) => [c.pagina.id, c.codigo, c] as const))('%s · %s', async (_p, _codigo, { pagina, codigo }) => {
    const apagada = usuarioConCapacidades(rolDelEditor(pagina));
    const encendida = usuarioConCapacidades(rolDelEditor(pagina, [codigo]));

    for (const e of endpointsPorCodigo.get(codigo)!) {
      expect(await abre(e.controlador, e.handler, encendida), `${e.nombre} debe abrir con «${codigo}» encendida`).toBe(true);
      // Si otro permiso del rol ya lo abría por su cuenta, apagar esta casilla no lo cierra (es otra casilla la que lo gobierna).
      const lAbreOtroPermiso = e.codigos.some((c) => c !== codigo && apagada.role.capacidades.includes(c));
      if (!lAbreOtroPermiso) {
        expect(await abre(e.controlador, e.handler, apagada), `${e.nombre} debe cerrarse con «${codigo}» apagada`).toBe(false);
      }
    }
  });

  it('el Super Admin entra a todos los endpoints sin necesitar ninguna casilla', async () => {
    const superAdmin = usuarioConCapacidades([], 'SUPER_ADMIN');
    for (const [, controlador] of CONTROLADORES) {
      for (const { handler } of rutas(controlador)) {
        const codigos: string[] | undefined = Reflect.getMetadata(PERMISO_KEY, handler);
        if (codigos?.length) expect(await abre(controlador, handler, superAdmin)).toBe(true);
      }
    }
  });

  it('un rol sin ningún permiso no entra a ningún endpoint protegido', async () => {
    const vacio = usuarioConCapacidades([]);
    for (const [, controlador] of CONTROLADORES) {
      for (const { nombre, handler } of rutas(controlador)) {
        const codigos: string[] | undefined = Reflect.getMetadata(PERMISO_KEY, handler);
        if (codigos?.length) expect(await abre(controlador, handler, vacio), `${controlador.name}.${nombre}`).toBe(false);
      }
    }
  });
});
