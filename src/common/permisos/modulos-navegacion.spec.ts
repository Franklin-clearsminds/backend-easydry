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
  });

  it('el lavador solo ve sus resultados de auditoría (informes y 5S), sus notificaciones y su perfil', () => {
    expect(pantallas('LAVADOR')).toEqual(['notificaciones', 'informes-inspeccion', 'auditorias-5s', 'perfil']);
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

  it('el coordinador de mantenimiento ve Inventario en cuanto se le da la página Inventario', () => {
    const r = ROLES_BASE.find((x) => x.namerol === 'COORD_MANTENIMIENTO')!;
    expect(pantallas('COORD_MANTENIMIENTO')).not.toContain('inventario');
    expect(modulosDeCapacidades([...r.capacidades, 'pagina.inventario'], r.namerol)).toContain('inventario');
  });

  it('pantallas de los roles oficiales', () => {
    expect(pantallas('APROBADOR')).toEqual(['dashboard', 'notificaciones', 'configuracion/servicios', 'servicios', 'aprobaciones', 'auditorias', 'informes-inspeccion', 'auditorias-5s', 'perfil']);
    expect(pantallas('COORD_MANTENIMIENTO')).toEqual(['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'auditorias', 'informes-inspeccion', 'auditorias-5s', 'perfil']);
    // El líder (y su reemplazo), el pulidor y el lavador no auditan: no tienen el dashboard de auditorías.
    for (const rol of ['LIDER', 'BACKUP', 'PULIDOR', 'LAVADOR']) {
      expect(pantallas(rol), rol).not.toContain('auditorias');
      expect(pantallas(rol), rol).toEqual(expect.arrayContaining(['informes-inspeccion', 'auditorias-5s']));
    }
    expect(pantallas('SUPERVISOR')).toContain('usuarios');
    // Reportes operativos: administradores, supervisor, coordinadores (bodega, comercial, servicios especiales), asistente de bodega y jefe comercial.
    for (const rol of ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORD_BODEGA', 'ASISTENTE_BODEGA', 'COORD_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES', 'JEFE_COMERCIAL']) {
      expect(pantallas(rol), rol).toContain('reportes');
    }
    expect(pantallas('LIDER')).not.toContain('mapa-operativo');
    expect(pantallas('LIDER')).toContain('operadores');
    expect(pantallas('LIDER')).not.toContain('agencias');
  });

  it('toda pantalla tiene al menos un permiso que la habilita, salvo las de cuenta', () => {
    for (const [m, permisos] of Object.entries(PERMISOS_POR_MODULO)) {
      if (m === 'notificaciones' || m === 'perfil') expect(permisos).toBeNull();
      else expect(permisos!.length).toBeGreaterThan(0);
    }
  });
});
