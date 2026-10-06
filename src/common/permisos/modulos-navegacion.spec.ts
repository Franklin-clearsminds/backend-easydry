import { describe, expect, it } from 'vitest';
import { ROLES_BASE } from './roles-base.js';
import { MODULOS_NAVEGACION, PERMISOS_POR_MODULO, modulosDeCapacidades, modulosDeRol } from './modulos-navegacion.js';

const pantallas = (namerol: string) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return modulosDeCapacidades(r.capacidades, r.namerol);
};

describe('pantallas derivadas de los permisos', () => {
  it('un permiso de lectura habilita su pantalla', () => {
    expect(modulosDeCapacidades(['inventario.ver'])).toEqual(['notificaciones', 'inventario', 'perfil']);
    expect(modulosDeCapacidades(['despachos.ver'])).toContain('envios');
    expect(modulosDeCapacidades(['limpiezas.ver'])).toContain('taller-tecnico');
  });

  it('sin permisos no hay pantallas (ni notificaciones ni perfil)', () => {
    expect(modulosDeCapacidades([])).toEqual([]);
    expect(modulosDeCapacidades(null)).toEqual([]);
    expect(pantallas('LAVADOR')).toEqual([]);
  });

  it('SUPER_ADMIN ve todas las pantallas aunque sus permisos guardados estén vacíos', () => {
    expect(modulosDeRol({ namerol: 'SUPER_ADMIN', capacidades: [] })).toEqual([...MODULOS_NAVEGACION]);
  });

  it('los permisos de consulta para desplegables no abren pantallas de gestión', () => {
    const m = modulosDeCapacidades(['agencias.ver', 'usuarios.ver', 'catalogo.ver']);
    expect(m).not.toContain('agencias');
    expect(m).not.toContain('mapa-operativo');
    expect(m).not.toContain('usuarios');
  });

  it('el coordinador de mantenimiento ve Inventario en cuanto se le da inventario.ver', () => {
    const r = ROLES_BASE.find((x) => x.namerol === 'COORD_MANTENIMIENTO')!;
    expect(pantallas('COORD_MANTENIMIENTO')).not.toContain('inventario');
    expect(modulosDeCapacidades([...r.capacidades, 'inventario.ver'], r.namerol)).toContain('inventario');
  });

  it('pantallas de los roles oficiales', () => {
    expect(pantallas('APROBADOR')).toEqual(['dashboard', 'notificaciones', 'configuracion/servicios', 'servicios', 'aprobaciones', 'perfil']);
    expect(pantallas('COORD_MANTENIMIENTO')).toEqual(['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'perfil']);
    expect(pantallas('SUPERVISOR')).toContain('usuarios');
    expect(pantallas('SUPERVISOR')).toContain('reportes');
    expect(pantallas('LIDER')).toContain('mapa-operativo');
    expect(pantallas('LIDER')).not.toContain('agencias');
    expect(pantallas('ASISTENTE_BODEGA')).not.toContain('reportes');
  });

  it('toda pantalla tiene al menos un permiso que la habilita, salvo las de cuenta', () => {
    for (const [m, permisos] of Object.entries(PERMISOS_POR_MODULO)) {
      if (m === 'notificaciones' || m === 'perfil') expect(permisos).toBeNull();
      else expect(permisos!.length).toBeGreaterThan(0);
    }
  });
});
