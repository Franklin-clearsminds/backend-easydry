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
import { REPORTES } from '../../modules/reportes/reportes.definiciones.js';

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

/** ADMIN y SUPER_ADMIN no timbran ni reciben tareas. */
const NO_TIMBRAN: string[] = ['rrhh.timbrar', 'rrhh.tareas.propias'];

describe('catálogo de permisos', () => {
  it('no repite códigos y todos siguen el formato modulo.accion', () => {
    expect(new Set(CODIGOS_PERMISOS).size).toBe(CODIGOS_PERMISOS.length);
    for (const p of CATALOGO_PERMISOS)
      expect(p.codigo).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });

  it('los 16 roles oficiales existen, sin repetir, con ámbito válido y solo permisos del catálogo', () => {
    expect(ROLES_BASE).toHaveLength(16);
    expect(new Set(ROLES_BASE.map((r) => r.namerol)).size).toBe(16);
    for (const r of ROLES_BASE) {
      expect(AMBITOS).toContain(r.ambito);
      for (const c of r.capacidades) expect(esCodigoPermiso(c), `${r.namerol}: ${c} fuera del catálogo`).toBe(true);
      expect(new Set(r.capacidades).size).toBe(r.capacidades.length);
    }
  });

  it('los nombres oficiales no son alias de otro rol', () => {
    for (const r of ROLES_BASE)
      expect(normalizarRol(r.namerol)).toBe(r.namerol);
  });
});

describe('matriz acordada de permisos por rol', () => {
  it('los administradores no crean servicios especiales para sí mismos (lo hacen el coordinador y el pulidor)', () => {
    expect(
      ROLES_BASE.find((r) => r.namerol === 'SUPER_ADMIN')!.capacidades,
    ).toEqual(expect.arrayContaining(CODIGOS_PERMISOS.filter((c) => c !== 'especiales.crear' && !NO_TIMBRAN.includes(c))));
    const admin = ROLES_BASE.find((r) => r.namerol === 'ADMIN')!.capacidades;
    expect(admin).toEqual(expect.arrayContaining(CODIGOS_PERMISOS.filter((c) => c !== 'roles.gestionar' && c !== 'especiales.crear' && !NO_TIMBRAN.includes(c))));
    expect(admin).not.toContain('roles.gestionar');
    // El admin no crea OT especiales para sí mismo (eso es del pulidor), pero sí las asigna y reasigna a otros pulidores.
    expect(admin).not.toContain('especiales.crear');
    expect(admin).toContain('especiales.asignar');
    expect(rolesCon('roles.gestionar')).toEqual(['SUPER_ADMIN']);
  });

  it('el lavador no opera la plataforma: solo ve sus resultados de auditoría, timbra y recibe tareas', () => {
    const permisos = CODIGOS_PERMISOS.filter((c) => tienePermiso(usuario('LAVADOR'), c));
    expect(permisos.sort()).toEqual(['informes.ver', 'inspecciones.ver', 'rrhh.tareas.propias', 'rrhh.timbrar']);
  });

  it('RRHH: todos timbran y reciben tareas menos ADMIN y SUPER_ADMIN; asignan solo los acordados; las ubicaciones, solo los administradores', () => {
    const todos = ROLES_BASE.map((r) => r.namerol);
    expect(rolesCon('rrhh.timbrar').sort()).toEqual(todos.filter((n) => !['ADMIN', 'SUPER_ADMIN'].includes(n)).sort());
    expect(rolesCon('rrhh.tareas.propias').sort()).toEqual(rolesCon('rrhh.timbrar').sort());
    const asignan = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORD_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES', 'COORD_MANTENIMIENTO', 'COORD_BODEGA', 'LIDER', 'BACKUP', 'AUXILIAR'].sort();
    expect(rolesCon('rrhh.tareas.asignar').sort()).toEqual(asignan);
    expect(rolesCon('rrhh.timbradas.ver').sort()).toEqual(asignan);
    expect(rolesCon('rrhh.ubicaciones.gestionar').sort()).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('auditar (hacer informes de inspección y auditorías 5S) lo pueden todos los roles menos líder, Backup, auxiliar, lavador y pulidor', () => {
    const noAudita = ['AUXILIAR', 'BACKUP', 'LAVADOR', 'LIDER', 'PULIDOR'];
    // El aprobador solo aprueba servicios: no tiene informes ni auditorías 5S.
    const auditan = ROLES_BASE.map((r) => r.namerol).filter((n) => !noAudita.includes(n) && n !== 'APROBADOR').sort();
    const caps0 = ROLES_BASE.find((r) => r.namerol === 'APROBADOR')!.capacidades;
    expect(caps0.filter((c) => /^(informes|inspecciones|auditorias)\./.test(c))).toEqual([]);
    expect(rolesCon('informes.crear')).toEqual(auditan);
    expect(rolesCon('inspecciones.crear')).toEqual(auditan);
    expect(rolesCon('informes.firmar')).toEqual(auditan);
    for (const rol of noAudita) {
      const caps = ROLES_BASE.find((r) => r.namerol === rol)!.capacidades;
      expect(caps, rol).toEqual(expect.arrayContaining(['informes.ver', 'inspecciones.ver']));
      for (const c of ['informes.crear', 'informes.firmar', 'informes.seguimiento', 'informes.revisar', 'informes.eliminar', 'inspecciones.crear', 'inspecciones.acciones', 'inspecciones.verificar', 'inspecciones.eliminar']) {
        expect(caps, `${rol} no debe tener ${c}`).not.toContain(c);
      }
    }
  });

  it('administrar los borradores de otros y verificar acciones de auditoría: administradores y supervisor', () => {
    expect(rolesCon('informes.administrar')).toEqual(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
    expect(rolesCon('inspecciones.verificar')).toEqual(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  });

  it('aprobar los informes y firmar la recepción es solo de Admin y Super Admin', () => {
    expect(rolesCon('informes.aprobar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('configurar los sellos de los jefes de taller es solo de Admin y Super Admin', () => {
    expect(rolesCon('sellos.gestionar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('el Backup hereda las capacidades del líder y el supervisor gestiona solo Backups', () => {
    const lider = ROLES_BASE.find((r) => r.namerol === 'LIDER')!;
    const backup = ROLES_BASE.find((r) => r.namerol === 'BACKUP')!;
    const supervisor = ROLES_BASE.find((r) => r.namerol === 'SUPERVISOR')!;

    expect(backup.capacidades).toEqual(lider.capacidades);
    expect(backup.ambito).toBe('AGENCIA');
    expect(supervisor.capacidades).not.toContain('backup.gestionar'); // solo consulta usuarios
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
      'AUXILIAR',
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
    // BUG-30-PERM-01: el botón Aprobar depende de la acción 'aprobaciones.aprobar', no basta con poder rechazar.
    expect(p).toEqual(expect.arrayContaining(['aprobaciones.aprobar', 'aprobaciones.rechazar', 'aprobaciones.anular']));
  });

  it('crear y editar OT generales: líder y administradores', () => {
    expect(rolesCon('servicios.crear')).toEqual([
      'ADMIN',
      'AUXILIAR',
      'BACKUP',
      'LIDER',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('servicios.editar')).toEqual([
      'ADMIN',
      'AUXILIAR',
      'BACKUP',
      'LIDER',
      'SUPER_ADMIN',
    ]);
  });

  it('servicios especiales: el coordinador crea, reasigna y anula; el pulidor crea las suyas y las opera', () => {
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
      'PULIDOR',
    ]);
  });

  it('retos: cierran los mismos que crean', () => {
    expect(rolesCon('retos.cerrar')).toEqual(rolesCon('retos.crear'));
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
      'AUXILIAR',
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
      'AUXILIAR',
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
      'AUXILIAR',
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

  it('agencias y bahías: supervisor edita agencias y bahías; el líder ya no (no tiene la página Agencias); aprobador ya no', () => {
    expect(rolesCon('agencias.crear')).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect(rolesCon('agencias.editar')).toEqual([
      'ADMIN',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('bahias.editar')).toEqual([
      'ADMIN',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
    expect(rolesCon('bahias.asignar')).toEqual([
      'ADMIN',
      'SUPERVISOR',
      'SUPER_ADMIN',
    ]);
  });

  it('cola de errores de sincronización: gestionarla solo administradores', () => {
    expect(rolesCon('sync.dlq.gestionar')).toEqual(['ADMIN', 'SUPER_ADMIN']);
  });

  it('el coordinador de servicios especiales es solo regional', () => {
    expect(ROLES_BASE.find((r) => r.namerol === 'COORD_SERVICIOS_ESPECIALES')!.ambito).toBe('REGION');
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

  describe('reportes operativos', () => {
    const ambito = (n: string) =>
      ROLES_BASE.find((r) => r.namerol === n)!.ambito;
    /** Reportes que el rol ve en su catálogo: hace falta el permiso de su módulo (y los precios, si el reporte los exige). */
    const reportesDe = (n: string): string[] => {
      const u = usuario(n);
      return REPORTES.filter(
        (d) =>
          tieneAlgunPermiso(u, d.permisos) &&
          (d.permisosTodos ?? []).every((p) => tienePermiso(u, p)),
      ).map((d) => d.id);
    };

    it('los sacan administradores, supervisor, coordinadores de bodega, comercial y de servicios especiales, asistente de bodega y jefe comercial', () => {
      const acordados = [
        'ADMIN',
        'ASISTENTE_BODEGA',
        'COORD_BODEGA',
        'COORD_COMERCIAL',
        'COORD_SERVICIOS_ESPECIALES',
        'JEFE_COMERCIAL',
        'SUPERVISOR',
        'SUPER_ADMIN',
      ];
      // El aprobador saca solo el PDF de sus servicios (el servidor lo limita a esos reportes y a 30 días).
      expect(rolesCon('reportes.ver')).toEqual([...acordados, 'APROBADOR'].sort());
      // Exportar sale con el mismo acceso: nadie exporta sin poder ver el reporte.
      expect(rolesCon('reportes.excel')).toEqual(acordados);
      expect(rolesCon('reportes.pdf')).toEqual([...acordados, 'APROBADOR'].sort());
    });

    it('el supervisor y el coordinador de servicios especiales sacan los reportes de los módulos que tienen activos', () => {
      expect(rolesCon('reportes.ver')).toEqual(expect.arrayContaining(['SUPERVISOR', 'COORD_SERVICIOS_ESPECIALES']));
      expect(reportesDe('COORD_SERVICIOS_ESPECIALES')).toContain('servicios-lavado');
      expect(reportesDe('COORD_SERVICIOS_ESPECIALES')).toContain('insumos-inventario'); // ve el inventario (solo lectura, de su región)
      expect(reportesDe('SUPERVISOR')).toEqual(expect.arrayContaining(['servicios-lavado', 'insumos-inventario']));
    });

    it('todos los que sacan reportes también crean informes de inspección y auditorías 5S, y ven esos reportes', () => {
      for (const n of ['SUPERVISOR', 'COORD_SERVICIOS_ESPECIALES', 'COORD_BODEGA', 'ASISTENTE_BODEGA', 'COORD_COMERCIAL', 'JEFE_COMERCIAL']) {
        expect(tienePermiso(usuario(n), 'informes.crear'), `${n} informes.crear`).toBe(true);
        expect(tienePermiso(usuario(n), 'inspecciones.crear'), `${n} inspecciones.crear`).toBe(true);
        expect(reportesDe(n), n).toEqual(expect.arrayContaining(['informes-inspeccion', 'auditorias-5s']));
      }
    });

    it('el alcance del rol limita los datos del reporte: regional solo su región, nacional todo el país', () => {
      expect(['ASISTENTE_BODEGA', 'COORD_COMERCIAL'].map(ambito)).toEqual([
        'REGION',
        'REGION',
      ]);
      expect(
        ['SUPER_ADMIN', 'ADMIN', 'COORD_BODEGA', 'JEFE_COMERCIAL'].map(ambito),
      ).toEqual(['GLOBAL', 'GLOBAL', 'GLOBAL', 'GLOBAL']);
    });

    it('el asistente de bodega ve los reportes de inventario y ninguno de los módulos que no tiene', () => {
      const vistos = reportesDe('ASISTENTE_BODEGA');
      expect(vistos).toEqual(
        expect.arrayContaining([
          'insumos-inventario',
          'stock-ubicacion',
          'kardex',
          'alertas-stock',
        ]),
      );
      for (const id of [
        'agencias-listado',
        'servicios-lavado',
        'maquinaria-asignada',
        'incidentes',
        'mantenimientos',
      ]) {
        expect(vistos).not.toContain(id);
      }
    });

    it('el coordinador de bodega ve el listado de lavadores y pulidores, pero no los reportes de servicios ni de agencias', () => {
      const vistos = reportesDe('COORD_BODEGA');
      expect(vistos).toEqual(
        expect.arrayContaining(['insumos-inventario', 'stock-ubicacion', 'kardex', 'lavadores-listado']),
      );
      for (const id of [
        'agencias-listado',
        'servicios-lavado',
      ]) {
        expect(vistos).not.toContain(id);
      }
    });

    it('el jefe comercial ve el reporte de precios (tiene permiso de precios)', () => {
      expect(reportesDe('JEFE_COMERCIAL')).toContain('catalogo-precios');
    });

    it('los roles operativos (líder, pulidor, técnico…) no sacan reportes', () => {
      for (const n of [
        'LIDER',
        'BACKUP',
        'AUXILIAR',
        'LAVADOR',
        'PULIDOR',
        'COORD_MANTENIMIENTO',
        'TECNICO',
      ]) {
        expect(tienePermiso(usuario(n), 'reportes.ver')).toBe(false);
      }
    });
  });
});

describe('comprobación de permisos', () => {
  it('SUPER_ADMIN pasa siempre aunque sus permisos guardados estén vacíos (rol inmutable)', () => {
    const sa = { roleDetails: { namerol: 'SUPER_ADMIN', capacidades: [] } };
    expect(tienePermiso(sa, 'roles.gestionar')).toBe(true);
  });

  it('los permisos salen de las capacidades del rol, no del nombre', () => {
    const u = {
      roleDetails: { namerol: 'APROBADOR', capacidades: ['servicios.decidir'] },
    };
    expect(tienePermiso(u, 'servicios.decidir')).toBe(true);
    const sinCapacidades = { role: 'ADMIN', roleDetails: { capacidades: [] } };
    expect(tienePermiso(sinCapacidades, 'servicios.decidir')).toBe(false);
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
