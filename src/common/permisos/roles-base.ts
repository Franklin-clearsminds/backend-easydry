import {
  Ambito,
  CODIGOS_PERMISOS,
  CodigoPermiso,
} from './catalogo-permisos.js';
import { capacidadesConPaginas } from './migracion-paginas.js';

/**
 * Los 16 roles oficiales con los permisos acordados. Es lo que carga el seed y lo que usan las pruebas para verificar la
 * matriz. Después de sembrado, la fuente de verdad es la tabla `roles` (se edita desde «Roles y Permisos»).
 */
export interface RolBase {
  namerol: string;
  descripcion: string;
  ambito: Ambito;
  capacidades: CodigoPermiso[];
}

const p = (...c: CodigoPermiso[]): CodigoPermiso[] => c;

const LECTURA_RED: CodigoPermiso[] = p(
  'agencias.ver',
  'usuarios.ver',
  'catalogo.ver',
  'evidencias.ver',
);

const ADMIN_CAPACIDADES: CodigoPermiso[] = CODIGOS_PERMISOS.filter(
  (c) => c !== 'roles.gestionar' && c !== 'especiales.crear',
);

/** Lo que los roles comerciales consultan, solo lectura: OT especiales, agencias, mapa, lavadores, inventario y envíos. */
const LECTURA_COMERCIAL: CodigoPermiso[] = p(
  'especiales.ver',
  'operadores.ver',
  'agencias.consultar',
  'mapa.ver',
  'inventario.ver',
  'despachos.ver',
);

/**
 * Roles que no ven precios ni costos. Los coordinadores (en su región) y el Jefe Comercial sí los ven. El líder de agencia
 * (y su reemplazo BACKUP y el auxiliar, que copian sus permisos) trabaja con cantidades: nunca ve dinero.
 */
const ROLES_SIN_PRECIOS = ['LAVADOR', 'LIDER', 'BACKUP', 'AUXILIAR'];
/** Roles que ven inventario pero no el stock de los kits (hoy ninguno: los comerciales y los coordinadores también lo ven). */
const ROLES_SIN_KITS: string[] = [];

/**
 * Auditorías. Pueden auditar (crear informes de inspección, firmarlos y verlos dentro de su ámbito) todos los roles menos el líder
 * de bahía (LIDER y su reemplazo BACKUP), el lavador y el pulidor, que solo ven el resultado de su inspección 5S y sus informes.
 * Editar y eliminar los borradores de otros, y verificar las acciones correctivas, es de quien administra: ADMIN, SUPER_ADMIN y SUPERVISOR.
 */
const ROLES_SOLO_VEN_AUDITORIA = ['LIDER', 'BACKUP', 'AUXILIAR', 'LAVADOR', 'PULIDOR'];
/** El aprobador solo aprueba servicios: no tiene informes de inspección ni auditorías 5S. */
const ROLES_SIN_AUDITORIA = ['APROBADOR'];
const ROLES_REVISAN_INFORMES = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR'];
const CAPACIDADES_AUDITOR: CodigoPermiso[] = p(
  'informes.ver',
  'informes.crear',
  'informes.firmar',
  'informes.seguimiento',
  'inspecciones.ver',
  'inspecciones.crear',
  'inspecciones.acciones',
);
const CAPACIDADES_VER_AUDITORIA: CodigoPermiso[] = p('informes.ver', 'inspecciones.ver');
const CAPACIDADES_REVISOR: CodigoPermiso[] = p('informes.administrar', 'informes.eliminar', 'inspecciones.verificar', 'inspecciones.eliminar');

const CAPACIDADES_LIDER = p(
  ...LECTURA_RED,
  'dashboard.ver',
  'operadores.ver',
  'servicios.ver',
  'servicios.crear',
  'servicios.editar',
  'servicios.finalizar',
  'servicios.anular',
  'consumos.ver',
  'recetas.ver',
  'retos.ver',
  'inventario.ver',
  'despachos.ver',
  'despachos.crear',
  'despachos.recibir',
  'alertas.ver',
  'alertas.crear',
  'maquinaria.ver',
  'incidentes.ver',
  'incidentes.reportar',
  'mantenimientos.ver',
  'maquinaria.evidencias',
  'limpiezas.evidencias',
  'limpiezas.ver',
  'evidencias.subir',
  'sync.usar',
);

export const ROLES_BASE: RolBase[] = [
  {
    namerol: 'SUPER_ADMIN',
    descripcion:
      'Nivel máximo de la plataforma. Acceso global inmutable: supervisión nacional, auditoría y gobierno del sistema.',
    ambito: 'GLOBAL',
    capacidades: CODIGOS_PERMISOS.filter((c) => c !== 'especiales.crear'),
  },
  {
    namerol: 'ADMIN',
    descripcion:
      'Administrador operativo de la plataforma. Gestiona usuarios, configuración y módulos asignados. No edita roles ni permisos.',
    ambito: 'GLOBAL',
    capacidades: ADMIN_CAPACIDADES,
  },
  {
    namerol: 'SUPERVISOR',
    descripcion:
      'Supervisor regional: controla agencias, bahías, operadores e inventario de su región, aprueba donde no hay aprobador y consulta (solo lectura) los usuarios de su región, sin los asistentes de mantenimiento.',
    ambito: 'REGION',
    capacidades: p(
      ...LECTURA_RED,
      'roles.ver',
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'agencias.editar',
      'bahias.editar',
      'bahias.asignar',
      'servicios.ver',
      'servicios.decidir',
      'solicitudes.ver',
      'solicitudes.crear',
      'especiales.ver',
      'consumos.ver',
      'recetas.ver',
      'retos.ver',
      'inventario.ver',
      'despachos.ver',
      'alertas.ver',
      'maquinaria.ver',
      'incidentes.ver',
      'incidentes.reportar',
      'maquinaria.evidencias',
      'limpiezas.ver',
      'limpiezas.editar',
      'limpiezas.fotos',
      'evidencias.subir',
      'sync.usar',
    ),
  },
  {
    namerol: 'JEFE_COMERCIAL',
    descripcion:
      'Jefe comercial: visibilidad comercial nacional (solo lectura, con precios), retos, productividad y reportes.',
    ambito: 'GLOBAL',
    capacidades: p(
      ...LECTURA_RED,
      ...LECTURA_COMERCIAL,
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'servicios.ver',
      'retos.ver',
      'retos.crear',
      'retos.editar',
      'retos.cerrar',
      'retos.eliminar',
      'sync.usar',
    ),
  },
  {
    namerol: 'COORD_COMERCIAL',
    descripcion:
      'Coordinador comercial: consulta (solo lectura, con precios) su región, y asigna y monitorea retos, productividad y reportes.',
    ambito: 'REGION',
    capacidades: p(
      ...LECTURA_RED,
      ...LECTURA_COMERCIAL,
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'servicios.ver',
      'retos.ver',
      'retos.crear',
      'retos.editar',
      'retos.cerrar',
      'retos.eliminar',
      'limpiezas.ver',
      'sync.usar',
    ),
  },
  {
    namerol: 'APROBADOR',
    descripcion:
      'Aprobador de agencia: audita evidencias y aprueba, rechaza o anula los servicios de su agencia.',
    ambito: 'AGENCIA',
    capacidades: p(
      'agencias.ver',
      'usuarios.ver',
      'catalogo.ver',
      'evidencias.ver',
      'dashboard.ver',
      'servicios.ver',
      'servicios.decidir',
      'servicios.anular',
      'solicitudes.ver',
      'solicitudes.crear',
      'especiales.ver',
      'especiales.anular',
      'retos.ver',
      // Reporte de sus servicios, solo en PDF (el servidor lo limita a servicios y a los últimos 30 días).
      'reportes.ver',
      'reportes.pdf',
      'sync.usar',
    ),
  },
  {
    namerol: 'LIDER',
    descripcion:
      'Líder operador: registra las OT de su agencia, controla bahías, inventario local, recepciones y despachos a otras agencias de su región.',
    ambito: 'AGENCIA',
    capacidades: CAPACIDADES_LIDER,
  },
  {
    namerol: 'BACKUP',
    descripcion:
      'Líder operador de reemplazo: opera como un líder de agencia mientras está asignado temporalmente a una agencia de su región.',
    ambito: 'AGENCIA',
    capacidades: [...CAPACIDADES_LIDER],
  },
  {
    namerol: 'AUXILIAR',
    descripcion:
      'Auxiliar del líder: lavador de una bahía que, con las mismas capacidades del líder, opera su agencia (varios por agencia, cada uno en su bahía).',
    ambito: 'AGENCIA',
    capacidades: [...CAPACIDADES_LIDER],
  },
  {
    namerol: 'LAVADOR',
    descripcion:
      'Personal de lavado en bahía. No opera la plataforma: solo ve el resultado de su inspección 5S y sus informes de inspección.',
    ambito: 'AGENCIA',
    capacidades: [],
  },
  {
    namerol: 'COORD_SERVICIOS_ESPECIALES',
    descripcion:
      'Coordinador de servicios especiales regional: crea, asigna, reasigna y anula los servicios especiales de su región.',
    ambito: 'REGION',
    capacidades: p(
      ...LECTURA_RED,
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'inventario.ver',
      'especiales.ver',
      'especiales.crear',
      'especiales.asignar',
      'especiales.editar',
      'especiales.reasignar',
      'especiales.anular',
      'recetas.ver',
      'retos.ver',
      'maquinaria.ver',
      'incidentes.ver',
      'incidentes.reportar',
      'maquinaria.evidencias',
      'limpiezas.ver',
      'evidencias.subir',
      'sync.usar',
    ),
  },
  {
    namerol: 'PULIDOR',
    descripcion:
      'Pulidor: especialista en servicios especiales. Fijo (con agencia, opera en su sede) o móvil (sin agencia, opera en su región).',
    ambito: 'AGENCIA',
    capacidades: p(
      'agencias.ver',
      'catalogo.ver',
      'evidencias.ver',
      'dashboard.ver',
      'especiales.ver',
      'especiales.crear',
      'especiales.operar',
      'especiales.finalizar',
      'recetas.ver',
      'retos.ver',
      'inventario.ver',
          'despachos.ver',
      'despachos.recibir',
      'alertas.ver',
      'alertas.crear',
      'maquinaria.ver',
      'incidentes.ver',
      'incidentes.reportar',
      'mantenimientos.ver',
      'maquinaria.evidencias',
      'limpiezas.ver',
      'limpiezas.evidencias',
      'evidencias.subir',
      'sync.usar',
    ),
  },
  {
    namerol: 'COORD_MANTENIMIENTO',
    descripcion:
      'Coordinador de mantenimiento: alta de maquinaria, reparaciones, programación y asignación a técnicos.',
    ambito: 'REGION',
    capacidades: p(
      'agencias.ver',
      'catalogo.ver',
      'usuarios.ver',
      'evidencias.ver',
      'dashboard.ver',
      'maquinaria.ver',
      'maquinaria.crear',
      'maquinaria.gestionar',
      'maquinaria.trazabilidad',
      'incidentes.ver',
      'incidentes.resolver',
      'inventario.ver',
      'mantenimientos.ver',
      'mantenimientos.ejecutar',
      'maquinaria.evidencias',
      'limpiezas.ver',
      'limpiezas.editar',
      'evidencias.subir',
      'sync.usar',
    ),
  },
  {
    namerol: 'TECNICO',
    descripcion:
      'Asistente de mantenimiento: trabaja en la región que tiene asignada y ejecuta y cierra las órdenes de mantenimiento que le asignan.',
    ambito: 'REGION',
    capacidades: p(
      'dashboard.ver',
      'maquinaria.ver',
      'incidentes.ver',
      'incidentes.resolver',
      'mantenimientos.ver',
      'mantenimientos.ejecutar',
      'maquinaria.evidencias',
      'evidencias.subir',
      'evidencias.ver',
      'sync.usar',
    ),
  },
  {
    namerol: 'COORD_BODEGA',
    descripcion:
      'Coordinador de bodega: opera todo el stock nacional, compra a la bodega central y despacha a cualquier destino.',
    ambito: 'GLOBAL',
    capacidades: p(
      'agencias.ver',
      'usuarios.ver',
      'catalogo.ver',
      'dashboard.ver',
      'reportes.ver',
      'consumos.ver',
      'recetas.ver',
      'recetas.gestionar',
      'recetas.historial',
      'inventario.ver',
      'stock.ajustar',
      'compras.registrar',
      'despachos.ver',
      'despachos.crear',
      'despachos.recibir',
      'alertas.ver',
      'alertas.atender',
      'maquinaria.ver',
      'limpiezas.ver',
      'operadores.ver',
      'sync.usar',
    ),
  },
  {
    namerol: 'ASISTENTE_BODEGA',
    descripcion:
      'Asistente de bodega: opera una bodega regional y despacha solo a agencias de la región de su bodega.',
    ambito: 'REGION',
    capacidades: p(
      'agencias.ver',
      'usuarios.ver',
      'catalogo.ver',
      'dashboard.ver',
      'reportes.ver',
      'consumos.ver',
      'recetas.ver',
      'recetas.historial',
      'inventario.ver',
      'stock.ajustar',
      'despachos.ver',
      'despachos.crear',
      'despachos.recibir',
      'alertas.ver',
      'alertas.atender',
      'sync.usar',
    ),
  },
];

// Auditorías: los roles que auditan reciben el paquete de auditor; el líder, el lavador y el pulidor solo ven su resultado.
for (const rol of ROLES_BASE) {
  if (ROLES_SIN_AUDITORIA.includes(rol.namerol)) continue;
  const extra = ROLES_SOLO_VEN_AUDITORIA.includes(rol.namerol)
    ? CAPACIDADES_VER_AUDITORIA
    : [...CAPACIDADES_AUDITOR, ...(ROLES_REVISAN_INFORMES.includes(rol.namerol) ? CAPACIDADES_REVISOR : [])];
  rol.capacidades = [...new Set([...rol.capacidades, ...extra])];
}

// `precios.ver` lo tienen todos los roles que usan la plataforma salvo el Jefe Comercial, e `inventario.kits.ver` todos los que ven
// inventario salvo los comerciales (que ven bodegas y agencias, no el stock de los kits).
for (const rol of ROLES_BASE) {
  if (rol.capacidades.length === 0) continue;
  const extra: CodigoPermiso[] = [];
  if (!ROLES_SIN_PRECIOS.includes(rol.namerol)) extra.push('precios.ver');
  if (rol.capacidades.includes('inventario.ver') && !ROLES_SIN_KITS.includes(rol.namerol)) extra.push('inventario.kits.ver');
  rol.capacidades = [...new Set([...rol.capacidades, ...extra])];
}
// RRHH: todos los roles menos ADMIN y SUPER_ADMIN timbran y reciben tareas. Asignan tareas y ven las timbradas del equipo (dentro de su
// ámbito) los administradores, el supervisor, los coordinadores y el líder. Solo ADMIN y SUPER_ADMIN configuran las ubicaciones.
const ROLES_NO_TIMBRAN = ['SUPER_ADMIN', 'ADMIN'];
// El BACKUP reemplaza al líder y el AUXILIAR copia sus permisos (lavador con las capacidades del líder): heredan los suyos.
const ROLES_ASIGNAN_TAREAS = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORD_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES', 'COORD_MANTENIMIENTO', 'COORD_BODEGA', 'LIDER', 'BACKUP', 'AUXILIAR'];
const ROLES_CONFIGURAN_UBICACION = ['SUPER_ADMIN', 'ADMIN'];
const ROLES_EDITAN_HORARIOS = ['SUPER_ADMIN', 'ADMIN'];
const CAPACIDADES_RRHH_PROPIAS: CodigoPermiso[] = p('rrhh.timbrar', 'rrhh.tareas.propias');
for (const rol of ROLES_BASE) {
  const quitar = ROLES_NO_TIMBRAN.includes(rol.namerol) ? CAPACIDADES_RRHH_PROPIAS : [];
  const extra: CodigoPermiso[] = [
    ...(ROLES_NO_TIMBRAN.includes(rol.namerol) ? [] : CAPACIDADES_RRHH_PROPIAS),
    ...(ROLES_ASIGNAN_TAREAS.includes(rol.namerol) ? p('rrhh.tareas.asignar', 'rrhh.timbradas.ver') : []),
    ...(ROLES_CONFIGURAN_UBICACION.includes(rol.namerol) ? p('rrhh.ubicaciones.gestionar') : []),
    ...(ROLES_EDITAN_HORARIOS.includes(rol.namerol) ? p('rrhh.horarios.gestionar') : []),
  ];
  rol.capacidades = [...new Set([...rol.capacidades.filter((c) => !quitar.includes(c)), ...extra])];
}
// Y cada rol oficial trae también sus páginas, sub-páginas y acciones equivalentes (sin perder ningún permiso clásico).
for (const rol of ROLES_BASE) rol.capacidades = capacidadesConPaginas(rol.capacidades, rol.namerol) as CodigoPermiso[];
// El aprobador saca el reporte de sus servicios solo en PDF: la página de reportes le trae Excel, que se le quita.
for (const rol of ROLES_BASE) if (rol.namerol === 'APROBADOR') rol.capacidades = rol.capacidades.filter((c) => c !== 'reportes.excel');

export const NOMBRES_ROLES_BASE: readonly string[] = ROLES_BASE.map(
  (r) => r.namerol,
);
export const esRolBase = (namerol: string): boolean =>
  NOMBRES_ROLES_BASE.includes(String(namerol || '').toUpperCase());
