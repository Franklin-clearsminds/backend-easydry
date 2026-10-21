import { describe, expect, it } from 'vitest';
import { CODIGOS_PERMISOS } from './catalogo-permisos.js';
import {
  CODIGOS_NUEVOS,
  PAGINAS,
  capacidadesDesdeNuevos,
  codigosNuevosActivos,
  dependenciasRotas,
  permisosClasicosDe,
} from './catalogo-paginas.js';
import { capacidadesConPaginas, tienePaginas } from './migracion-paginas.js';
import { ROLES_BASE } from './roles-base.js';
import { modulosDeCapacidades, MODULOS_NAVEGACION } from './modulos-navegacion.js';

const todasLasAcciones = () => PAGINAS.flatMap((p) => [...p.acciones, ...p.subs.flatMap((s) => s.acciones)]);

describe('catálogo de páginas', () => {
  it('los códigos no se repiten salvo las casillas compartidas', () => {
    const vistos = new Map<string, string>();
    for (const p of PAGINAS) {
      const codigos = [p.codigo, ...p.subs.map((s) => s.codigo), ...p.acciones.map((a) => a.codigo), ...p.subs.flatMap((s) => s.acciones.map((a) => a.codigo))];
      for (const c of codigos) {
        const compartida = todasLasAcciones().find((a) => a.codigo === c)?.compartida;
        if (vistos.has(c) && !compartida) throw new Error(`código repetido: ${c}`);
        vistos.set(c, p.id);
      }
    }
  });

  it('todo permiso clásico se puede dar desde alguna página, sub-página o acción (ninguno queda huérfano)', () => {
    const otorgados = new Set<string>();
    for (const p of PAGINAS) {
      p.otorga.forEach((c) => otorgados.add(c));
      p.subs.forEach((s) => s.otorga.forEach((c) => otorgados.add(c)));
      todasLasAcciones().forEach((a) => a.otorga.forEach((c) => otorgados.add(c)));
    }
    const huerfanos = CODIGOS_PERMISOS.filter((c) => !otorgados.has(c));
    expect(huerfanos).toEqual([]);
  });

  it('cada página con menú coincide con un módulo de navegación y viceversa', () => {
    const modulos = PAGINAS.filter((p) => p.modulo !== null).map((p) => p.modulo as string);
    expect(modulos.sort()).toEqual([...MODULOS_NAVEGACION].sort());
  });
});

describe('dependencias entre página, sub-página y acción', () => {
  it('una sub-página sin su página, o una acción sin su sub-página, es una dependencia rota', () => {
    expect(dependenciasRotas(['pagina.servicios.generales'])).toHaveLength(1);
    expect(dependenciasRotas(['pagina.servicios', 'servicios.generales.crear'])).toHaveLength(1);
    expect(dependenciasRotas(['pagina.servicios', 'pagina.servicios.generales', 'servicios.generales.crear'])).toEqual([]);
  });

  it('lo apagado no otorga permisos: sin la sub-página generales, crear OT no se concede', () => {
    const activos = codigosNuevosActivos(['pagina.servicios', 'pagina.servicios.especiales', 'servicios.generales.crear']);
    expect(activos.has('servicios.generales.crear')).toBe(false);
    const clasicos = permisosClasicosDe(activos);
    expect(clasicos.has('especiales.ver')).toBe(true);
    expect(clasicos.has('servicios.crear')).toBe(false);
    expect(clasicos.has('servicios.ver')).toBe(false);
  });

  it('los datos de apoyo los otorga la página que los usa', () => {
    const clasicos = permisosClasicosDe(['pagina.servicios']);
    expect(clasicos.has('agencias.ver')).toBe(true);
    expect(clasicos.has('catalogo.ver')).toBe(true);
    expect(clasicos.has('inventario.ver')).toBe(false);
  });

  it('una casilla compartida (precios) sigue activa si al menos una de sus sub-páginas lo está', () => {
    const activos = codigosNuevosActivos(['pagina.servicios', 'pagina.servicios.especiales', 'precios.ver']);
    expect(activos.has('precios.ver')).toBe(true);
    expect(codigosNuevosActivos(['pagina.dashboard', 'precios.ver']).has('precios.ver')).toBe(false);
  });

  it('el menú sale de las páginas activas', () => {
    const caps = capacidadesDesdeNuevos(['pagina.dashboard', 'pagina.servicios', 'pagina.servicios.generales']);
    const m = modulosDeCapacidades(caps, 'X');
    expect(m).toEqual(expect.arrayContaining(['dashboard', 'servicios', 'notificaciones', 'perfil']));
    expect(m).not.toContain('inventario');
    // Aunque tenga 'catalogo.ver' como dato de apoyo de Servicios, no ve la pantalla Catálogo.
    expect(caps).toContain('catalogo.ver');
    expect(m).not.toContain('configuracion/servicios');
  });
});

describe('migración de roles existentes', () => {
  it('nadie pierde permisos: el resultado incluye todo lo que el rol ya tenía', () => {
    const clasicos = ['dashboard.ver', 'servicios.ver', 'servicios.crear', 'agencias.ver', 'usuarios.ver', 'catalogo.ver', 'retos.ver'];
    const r = capacidadesConPaginas(clasicos);
    for (const c of clasicos) expect(r).toContain(c);
    expect(tienePaginas(r)).toBe(true);
    expect(r).toEqual(expect.arrayContaining(['pagina.dashboard', 'pagina.servicios', 'pagina.servicios.generales', 'servicios.generales.crear']));
    expect(r).not.toContain('servicios.generales.editar');
  });

  it('es idempotente y no toca a un rol que ya guarda sus páginas', () => {
    const una = capacidadesConPaginas(['dashboard.ver', 'servicios.ver']);
    expect(capacidadesConPaginas(una)).toEqual(una);
    expect(capacidadesConPaginas([])).toEqual([]);
  });

  it('cada rol oficial conserva exactamente las pantallas que tenía', () => {
    const esperadas: Record<string, string[]> = {
      APROBADOR: ['dashboard', 'notificaciones', 'configuracion/servicios', 'servicios', 'aprobaciones', 'informes-inspeccion', 'auditorias-5s', 'perfil'],
      COORD_MANTENIMIENTO: ['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'informes-inspeccion', 'auditorias-5s', 'perfil'],
    };
    for (const [rol, pantallas] of Object.entries(esperadas)) {
      const r = ROLES_BASE.find((x) => x.namerol === rol)!;
      expect(modulosDeCapacidades(r.capacidades, rol)).toEqual(pantallas);
    }
  });

  it('cada rol oficial guarda sus páginas y todos sus códigos nuevos son válidos', () => {
    for (const r of ROLES_BASE) {
      if (r.capacidades.length === 0) continue;
      expect(tienePaginas(r.capacidades), r.namerol).toBe(true);
      expect(dependenciasRotas(r.capacidades.filter((c) => CODIGOS_NUEVOS.has(c))), r.namerol).toEqual([]);
    }
  });

  it('guardar de nuevo un rol oficial desde el editor no le quita nada y solo agrega las vistas de lectura de sus páginas', () => {
    const permitidasDeMas = new Set(['mapa.ver', 'agencias.consultar', 'operadores.ver']);
    for (const r of ROLES_BASE) {
      const recalculado = new Set(capacidadesDesdeNuevos(r.capacidades.filter((c) => CODIGOS_NUEVOS.has(c))));
      expect(r.capacidades.filter((c) => !recalculado.has(c)), `${r.namerol} pierde`).toEqual([]);
      expect([...recalculado].filter((c) => !r.capacidades.includes(c) && !permitidasDeMas.has(c)), `${r.namerol} gana`).toEqual([]);
    }
  });

  it('el Líder solo ve y no puede asignar bahías ni crear servicios especiales', () => {
    const lider = ROLES_BASE.find((r) => r.namerol === 'LIDER')!.capacidades;
    expect(lider).toContain('servicios.generales.crear');
    expect(lider).not.toContain('servicios.especiales.crear');
    expect(lider).not.toContain('operadores.bahia.asignar');
    expect(lider).not.toContain('mapa.bahia.asignar');
  });

  it('los roles comerciales ven en solo lectura; solo el Coordinador ve precios', () => {
    for (const nombre of ['COORD_COMERCIAL', 'JEFE_COMERCIAL']) {
      const caps = ROLES_BASE.find((r) => r.namerol === nombre)!.capacidades;
      expect(caps).toEqual(expect.arrayContaining(['pagina.agencias', 'pagina.agencias.mapa', 'pagina.operadores', 'pagina.inventario', 'pagina.envios']));
      expect(caps).not.toContain('operadores.registrar');
      expect(caps).not.toContain('operadores.gestionar');
      expect(caps).not.toContain('envios.confirmar');
      expect(caps).not.toContain('inventario.kits.ver');
    }
    const coord = ROLES_BASE.find((r) => r.namerol === 'COORD_COMERCIAL')!.capacidades;
    const jefe = ROLES_BASE.find((r) => r.namerol === 'JEFE_COMERCIAL')!.capacidades;
    expect(coord).toContain('precios.ver');
    expect(jefe).not.toContain('precios.ver');
  });

  it('el Coordinador Comercial ve servicios generales y especiales, agencias y lavadores, solo de su región', () => {
    const coord = ROLES_BASE.find((r) => r.namerol === 'COORD_COMERCIAL')!;
    expect(coord.ambito).toBe('REGION');
    expect(coord.capacidades).toEqual(expect.arrayContaining(['servicios.ver', 'especiales.ver', 'agencias.ver', 'agencias.consultar', 'operadores.ver', 'catalogo.ver', 'precios.ver']));
  });
});
