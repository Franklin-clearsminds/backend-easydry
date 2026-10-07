import {
  Ambito,
  CODIGOS_PERMISOS,
  CodigoPermiso,
} from './catalogo-permisos.js';

/**
 * Los 15 roles oficiales con los permisos acordados. Es lo que carga el seed y lo que usan las pruebas para verificar la
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

const CAPACIDADES_LIDER = p(
  ...LECTURA_RED,
  'dashboard.ver',
  'bahias.editar',
  'bahias.asignar',
  'servicios.ver',
  'servicios.crear',
  'servicios.editar',
  'servicios.anular',
  'solicitudes.ver',
  'solicitudes.crear',
  'consumos.ver',
  'recetas.ver',
  'retos.ver',
  'inventario.ver',
  'stock.consumir',
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
      'Supervisor regional: controla agencias, bahías, operadores e inventario de su región, aprueba donde no hay aprobador y gestiona sus usuarios Backup.',
    ambito: 'REGION',
    capacidades: p(
      ...LECTURA_RED,
      'roles.ver',
      'backup.gestionar',
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'agencias.editar',
      'bahias.editar',
      'bahias.asignar',
      'servicios.ver',
      'servicios.decidir',
      'solicitudes.ver',
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
      'evidencias.subir',
      'sync.usar',
    ),
  },
  {
    namerol: 'JEFE_COMERCIAL',
    descripcion:
      'Jefe comercial: visibilidad comercial nacional, retos, productividad y reportes.',
    ambito: 'GLOBAL',
    capacidades: p(
      ...LECTURA_RED,
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'servicios.ver',
      'retos.ver',
      'retos.crear',
      'retos.eliminar',
      'sync.usar',
    ),
  },
  {
    namerol: 'COORD_COMERCIAL',
    descripcion:
      'Coordinador comercial: asigna y monitorea retos, productividad y reportes de su región.',
    ambito: 'REGION',
    capacidades: p(
      ...LECTURA_RED,
      'dashboard.ver',
      'productividad.ver',
      'reportes.ver',
      'servicios.ver',
      'retos.ver',
      'retos.crear',
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
      'especiales.ver',
      'especiales.anular',
      'retos.ver',
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
    namerol: 'LAVADOR',
    descripcion:
      'Personal de lavado en bahía. Por ahora solo trazabilidad: no usa la plataforma.',
    ambito: 'AGENCIA',
    capacidades: [],
  },
  {
    namerol: 'COORD_SERVICIOS_ESPECIALES',
    descripcion:
      'Coordinador de servicios especiales: crea, asigna, reasigna y anula servicios especiales de la red especializada.',
    ambito: 'GLOBAL',
    capacidades: p(
      ...LECTURA_RED,
      'dashboard.ver',
      'productividad.ver',
      'especiales.ver',
      'especiales.crear',
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
      'especiales.operar',
      'recetas.ver',
      'retos.ver',
      'inventario.ver',
      'stock.consumir',
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
      'usuarios.ver',
      'evidencias.ver',
      'dashboard.ver',
      'maquinaria.ver',
      'maquinaria.crear',
      'maquinaria.gestionar',
      'maquinaria.trazabilidad',
      'incidentes.ver',
      'incidentes.resolver',
      'mantenimientos.ver',
      'mantenimientos.ejecutar',
      'checklist.gestionar',
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
      'Técnico de maquinaria: trabaja en la región que tiene asignada y ejecuta y cierra las órdenes de mantenimiento que le asignan.',
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

export const NOMBRES_ROLES_BASE: readonly string[] = ROLES_BASE.map(
  (r) => r.namerol,
);
export const esRolBase = (namerol: string): boolean =>
  NOMBRES_ROLES_BASE.includes(String(namerol || '').toUpperCase());
