import { describe, expect, it } from 'vitest';
import {
  CATALOGO_PERMISOS,
  CODIGOS_PERMISOS,
  AMBITOS,
  esCodigoPermiso,
} from './catalogo-permisos.js';
import { ROLES_BASE } from './roles-base.js';
import { normalizarRol } from './alias-roles.js';
import { tienePermiso, tieneAlgunPermiso } from './capacidades.js';
import { accionesLegacy } from './acciones-legacy.js';

const rolesCon = (codigo: string): string[] =>
  ROLES_BASE.filter((r) => r.capacidades.includes(codigo as never))
    .map((r) => r.namerol)
    .sort();
const usuario = (namerol: string) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return {
    id: 'u1',
    roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito },
  };
};

describe('catálogo de permisos', () => {
  it('no repite códigos y todos siguen el formato modulo.accion', () => {
    expect(new Set(CODIGOS_PERMISOS).size).toBe(CODIGOS_PERMISOS.length);
    for (const p of CATALOGO_PERMISOS)
      expect(p.codigo).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });

  it('los 15 roles oficiales existen, sin repetir, con ámbito válido y solo permisos del catálogo', () => {
    expect(ROLES_BASE).toHaveLength(15);
    expect(new Set(ROLES_BASE.map((r) => r.namerol)).size).toBe(15);
    for (const r of ROLES_BASE) {
      expect(AMBITOS).toContain(r.ambito);
      for (const c of r.capacidades) expect(esCodigoPermiso(c), `${r.namerol}: ${c} fuera del catálogo`).toBe(true);
      expect(new Set(r.capacidades).size).toBe(r.capacidades.length);
    }
  });

  it('los nombres oficiales no son alias de otro rol', () => {
    for (const r of ROLES_BASE)
      expect(normalizarRol(r.namerol)).toBe(r.namerol === 'BACKUP' ? 'LIDER' : r.namerol);
  });
});

describe('matriz acordada de permisos por rol', () => {
  it('el coordinador es el único que crea servicios especiales', () => {
    expect(
      ROLES_BASE.find((r) => r.namerol === 'SUPER_ADMIN')!.capacidades,
    ).toEqual(expect.arrayContaining(CODIGOS_PERMISOS.filter((c) => c !== 'especiales.crear')));
    const admin = ROLES_BASE.find((r) => r.namerol === 'ADMIN')!.capacidades;
    expect(admin).toEqual(expect.arrayContaining(CODIGOS_PERMISOS.filter((c) => c !== 'roles.gestionar' && c !== 'especiales.crear')));
    expect(admin).not.toContain('roles.gestionar');
    expect(admin).not.toContain('especiales.crear');
    expect(rolesCon('roles.gestionar')).toEqual(['SUPER_ADMIN']);
  });

  it('el lavador no tiene ningún permiso', () => {
    expect(
      ROLES_BASE.find((r) => r.namerol === 'LAVADOR')!.capacidades,
    ).toEqual([]);
    for (const c of CODIGOS_PERMISOS)
      expect(tienePermiso(usuario('LAVADOR'), c)).toBe(false);
  });

  it('el Backup hereda las capacidades del líder y el supervisor gestiona solo Backups', () => {
    const lider = ROLES_BASE.find((r) => r.namerol === 'LIDER')!;
    const backup = ROLES_BASE.find((r) => r.namerol === 'BACKUP')!;
    const supervisor = ROLES_BASE.find((r) => r.namerol === 'SUPERVISOR')!;

    expect(backup.capacidades).toEqual(lider.capacidades);
    expect(backup.ambito).toBe('AGENCIA');
    expect(supervisor.capacidades).toContain('backup.gestionar');
    expect(supervisor.capacidades).not.toContain('usuarios.gestionar');
  });

  it('aprobar y rechazar: aprobador, supervisor y administradores', () => {
    expect(rolesCon('servicios.decidir')).toEqual([
      'ADMIN',
      'APROBADOR',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
  });

  it('anular servicios: líder, aprobador y administradores (no el supervisor)', () => {
    expect(rolesCon('servicios.anular')).toEqual([
      'ADMIN',
      'APROBADOR',
      'BACKUP',
      'LIDER',
      'SUPER_ADMIN',
    ]);
  });

  it('el aprobador aprueba, rechaza y anula pero no edita ni crea OT', () => {
    const p = ROLES_BASE.find((r) => r.namerol === 'APROBADOR')!.capacidades;
    expect(p).toEqual(
      expect.arrayContaining(['servicios.decidir', 'servicios.anular']),
    );
    expect(p).not.toContain('servicios.editar');
    expect(p).not.toContain('servicios.crear');
  });

  it('crear y editar OT generales: líder y administradores', () => {
    expect(rolesCon('servicios.crear')).toEqual([
      'ADMIN',
      'BACKUP',
      'LIDER',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('servicios.editar')).toEqual([
      'ADMIN',
      'BACKUP',
      'LIDER',
      'SUPER_ADMIN',
    ]);
  });

  it('servicios especiales: el coordinador crea, reasigna y anula; el pulidor opera', () => {
    expect(rolesCon('especiales.reasignar')).toEqual([
      'ADMIN',
      'COORD_SERVICIOS_ESPECIALES',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('especiales.anular')).toEqual([
      'ADMIN',
      'APROBADOR',
      'COORD_SERVICIOS_ESPECIALES',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('especiales.operar')).toEqual([
      'ADMIN',
      'PULIDOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('especiales.crear')).toEqual([
      'COORD_SERVICIOS_ESPECIALES',
    ]);
  });

  it('retos: crean administradores, jefe comercial y coordinador comercial; no aprobador ni supervisor', () => {
    expect(rolesCon('retos.crear')).toEqual([
      'ADMIN',
      'COORD_COMERCIAL',
      'JEFE_COMERCIAL',
      'SUPER_ADMIN',
    ]);
  });

  it('inventario: catálogos y bodegas solo administradores; compras también el coordinador de bodega', () => {
    expect(rolesCon('inventario.catalogos.gestionar')).toEqual([
      'ADMIN',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('bodegas.gestionar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(rolesCon('compras.registrar')).toEqual([
      'ADMIN',
      'COORD_BODEGA',
      'SUPER_ADMIN',
    ]);
  });

  it('alertas de stock: crean líder, pulidor y administradores; atienden bodega y administradores', () => {
    expect(rolesCon('alertas.crear')).toEqual([
      'ADMIN',
      'BACKUP',
      'LIDER',
      'PULIDOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('alertas.atender')).toEqual([
      'ADMIN',
      'ASISTENTE_BODEGA',
      'COORD_BODEGA',
      'SUPER_ADMIN',
    ]);
  });

  it('el líder crea despachos; el asistente y el coordinador de bodega también', () => {
    expect(rolesCon('despachos.crear')).toEqual([
      'ADMIN',
      'ASISTENTE_BODEGA',
      'BACKUP',
      'COORD_BODEGA',
      'LIDER',
      'SUPER_ADMIN',
    ]);
  });

  it('catálogo de servicios: solo administradores; recetas también el coordinador de bodega', () => {
    expect(rolesCon('catalogo.gestionar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(rolesCon('recetas.gestionar')).toEqual([
      'ADMIN',
      'COORD_BODEGA',
      'SUPER_ADMIN',
    ]);
  });

  it('maquinaria: crea el coordinador de mantenimiento, no el de bodega', () => {
    expect(rolesCon('maquinaria.crear')).toEqual([
      'ADMIN',
      'COORD_MANTENIMIENTO',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('maquinaria.editar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('las plantillas de checklist las administran el coordinador de mantenimiento y los administradores', () => {
    expect(rolesCon('checklist.gestionar')).toEqual([
      'ADMIN',
      'COORD_MANTENIMIENTO',
      'SUPER_ADMIN',
    ]);
  });

  it('supervisor y coordinador de servicios especiales reportan incidentes', () => {
    expect(rolesCon('incidentes.reportar')).toEqual(
      expect.arrayContaining([
        'SUPERVISOR',
        'COORD_SERVICIOS_ESPECIALES',
        'LIDER',
        'PULIDOR',
      ]),
    );
  });

  it('las evidencias de limpiezas son independientes de las de incidencias y mantenimientos', () => {
    expect(rolesCon('maquinaria.evidencias')).toContain('LIDER');
    expect(rolesCon('limpiezas.evidencias')).toEqual([
      'ADMIN',
      'BACKUP',
      'LIDER',
      'PULIDOR',
      'SUPER_ADMIN',
    ]);
    expect(
      ROLES_BASE.find((r) => r.namerol === 'LIDER')!.capacidades,
    ).toContain('limpiezas.evidencias');
    expect(
      CATALOGO_PERMISOS.find((p) => p.codigo === 'limpiezas.evidencias')?.grupo,
    ).toBe('Maquinaria');
    expect(
      CATALOGO_PERMISOS.find((p) => p.codigo === 'evidencias.subir')?.nombre,
    ).toBe('Subir evidencias de servicios');
  });

  it('agencias y bahías: supervisor edita agencias; líder edita bahías; aprobador ya no', () => {
    expect(rolesCon('agencias.crear')).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(rolesCon('agencias.editar')).toEqual([
      'ADMIN',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('bahias.editar')).toEqual([
      'ADMIN',
      'BACKUP',
      'LIDER',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('bahias.asignar')).toEqual([
      'ADMIN',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('bahias.crear')).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('cola de errores de sincronización: gestionarla solo administradores', () => {
    expect(rolesCon('sync.dlq.gestionar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('el coordinador comercial, el supervisor y el técnico tienen alcance regional; el aprobador y el líder, de agencia', () => {
    const ambito = (n: string) =>
      ROLES_BASE.find((r) => r.namerol === n)!.ambito;
    expect(['SUPERVISOR', 'COORD_COMERCIAL'].map(ambito)).toEqual([
      'REGION',
      'REGION',
    ]);
    expect(['COORD_MANTENIMIENTO', 'TECNICO'].map(ambito)).toEqual([
      'REGION',
      'REGION',
    ]);
    expect(['APROBADOR', 'LIDER'].map(ambito)).toEqual(['AGENCIA', 'AGENCIA']);
    expect(['SUPER_ADMIN', 'ADMIN', 'JEFE_COMERCIAL'].map(ambito)).toEqual([
      'GLOBAL',
      'GLOBAL',
      'GLOBAL',
    ]);
  });
});

describe('comprobación de permisos', () => {
  it('SUPER_ADMIN pasa siempre aunque sus permisos guardados estén vacíos (rol inmutable)', () => {
    const sa = { roleDetails: { namerol: 'SUPER_ADMIN', capacidades: [] } };
    expect(tienePermiso(sa, 'roles.gestionar')).toBe(true);
  });

  it('un alias antiguo del rol se trata como el rol oficial', () => {
    const u = {
      roleDetails: { namerol: 'GERENTE', capacidades: ['servicios.decidir'] },
    };
    expect(tienePermiso(u, 'servicios.decidir')).toBe(true);
    const admin = { role: 'ADMINISTRADOR', roleDetails: { capacidades: [] } };
    expect(tienePermiso(admin, 'servicios.decidir')).toBe(false);
  });

  it('basta uno de varios permisos', () => {
    expect(
      tieneAlgunPermiso(usuario('LIDER'), [
        'catalogo.gestionar',
        'servicios.crear',
      ]),
    ).toBe(true);
    expect(
      tieneAlgunPermiso(usuario('LIDER'), [
        'catalogo.gestionar',
        'compras.registrar',
      ]),
    ).toBe(false);
  });

  it('sin capacidades guardadas no hay permisos', () => {
    expect(
      tienePermiso({ roleDetails: { namerol: 'LIDER' } }, 'servicios.ver'),
    ).toBe(false);
    expect(tienePermiso(null, 'servicios.ver')).toBe(false);
  });
});

describe('acciones para la web derivadas de los permisos', () => {
  it('el aprobador aprueba pero no crea agencias; el líder registra y despacha', () => {
    const ap = ROLES_BASE.find((r) => r.namerol === 'APROBADOR')!;
    const a = accionesLegacy(ap.capacidades, ap.ambito);
    expect(a.aprobarServicios).toBe(true);
    expect(a.crearSucursal).toBe(false);
    const li = ROLES_BASE.find((r) => r.namerol === 'LIDER')!;
    const b = accionesLegacy(li.capacidades, li.ambito);
    expect(
      b.registrarServicio && b.despacharSuministros && b.accionesEnvios,
    ).toBe(true);
    expect(b.aprobarServicios).toBe(false);
  });

  it('el lavador no tiene ninguna acción', () => {
    expect(
      Object.values(accionesLegacy([], 'AGENCIA')).every((v) => v === false),
    ).toBe(true);
  });
});
