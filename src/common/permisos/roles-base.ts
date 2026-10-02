import { Ambito, CODIGOS_PERMISOS, CodigoPermiso } from './catalogo-permisos.js';

/**
 * Los 14 roles oficiales con los permisos acordados. Es lo que carga el seed y lo que usan las pruebas para verificar la
 * matriz. Después de sembrado, la fuente de verdad es la tabla `roles` (se edita desde «Roles y Permisos»).
 */
export interface RolBase {
  namerol: string;
  descripcion: string;
  ambito: Ambito;
  /** Módulos de navegación a los que tiene acceso (FK lógica a `modulos_sistema.codigo`). */
  modulos: string[];
  capacidades: CodigoPermiso[];
}

const p = (...c: CodigoPermiso[]): CodigoPermiso[] => c;

const LECTURA_RED: CodigoPermiso[] = p('agencias.ver', 'usuarios.ver', 'catalogo.ver', 'evidencias.ver');

const ADMIN_CAPACIDADES: CodigoPermiso[] = CODIGOS_PERMISOS.filter((c) => c !== 'roles.gestionar');

export const ROLES_BASE: RolBase[] = [
  {
    namerol: 'SUPER_ADMIN',
    descripcion: 'Nivel máximo de la plataforma. Acceso global inmutable: supervisión nacional, auditoría y gobierno del sistema.',
    ambito: 'GLOBAL',
    modulos: [
      'dashboard', 'mapa-operativo', 'notificaciones', 'agencias', 'operadores', 'asignaciones', 'configuracion/servicios',
      'servicios', 'aprobaciones', 'productividad', 'maquinaria', 'taller-tecnico', 'inventario', 'envios', 'reportes', 'usuarios', 'perfil',
    ],
    capacidades: [...CODIGOS_PERMISOS],
  },
  {
    namerol: 'ADMIN',
    descripcion: 'Administrador operativo de la plataforma. Gestiona usuarios, configuración y módulos asignados. No edita roles ni permisos.',
    ambito: 'GLOBAL',
    modulos: [
      'dashboard', 'mapa-operativo', 'notificaciones', 'agencias', 'operadores', 'asignaciones', 'configuracion/servicios',
      'servicios', 'aprobaciones', 'productividad', 'maquinaria', 'taller-tecnico', 'inventario', 'envios', 'reportes', 'usuarios', 'perfil',
    ],
    capacidades: ADMIN_CAPACIDADES,
  },
  {
    namerol: 'SUPERVISOR',
    descripcion: 'Supervisor regional: controla agencias, bahías, operadores e inventario de su región y aprueba donde la agencia no tiene aprobador.',
    ambito: 'REGION',
    modulos: [
      'dashboard', 'notificaciones', 'mapa-operativo', 'agencias', 'operadores', 'asignaciones', 'servicios',
      'configuracion/servicios', 'aprobaciones', 'productividad', 'maquinaria', 'taller-tecnico', 'inventario', 'envios', 'reportes', 'perfil',
    ],
    capacidades: p(
      ...LECTURA_RED, 'dashboard.ver', 'productividad.ver', 'agencias.editar', 'bahias.editar', 'bahias.asignar',
      'servicios.ver', 'servicios.decidir', 'solicitudes.ver', 'especiales.ver', 'consumos.ver', 'recetas.ver', 'retos.ver',
      'inventario.ver', 'despachos.ver', 'alertas.ver', 'maquinaria.ver', 'incidentes.ver', 'incidentes.reportar',
      'maquinaria.evidencias', 'limpiezas.ver', 'limpiezas.editar', 'evidencias.subir', 'sync.usar',
    ),
  },
  {
    namerol: 'JEFE_COMERCIAL',
    descripcion: 'Jefe comercial: visibilidad comercial nacional, retos, productividad y reportes.',
    ambito: 'GLOBAL',
    modulos: ['dashboard', 'notificaciones', 'productividad', 'servicios', 'configuracion/servicios', 'reportes', 'perfil'],
    capacidades: p(...LECTURA_RED, 'dashboard.ver', 'productividad.ver', 'servicios.ver', 'retos.ver', 'retos.crear', 'retos.eliminar', 'sync.usar'),
  },
  {
    namerol: 'COORD_COMERCIAL',
    descripcion: 'Coordinador comercial: asigna y monitorea retos, productividad y reportes de su región.',
    ambito: 'REGION',
    modulos: ['dashboard', 'notificaciones', 'productividad', 'servicios', 'configuracion/servicios', 'reportes', 'taller-tecnico', 'perfil'],
    capacidades: p(...LECTURA_RED, 'dashboard.ver', 'productividad.ver', 'servicios.ver', 'retos.ver', 'retos.crear', 'retos.eliminar', 'limpiezas.ver', 'sync.usar'),
  },
  {
    namerol: 'APROBADOR',
    descripcion: 'Aprobador de agencia: audita evidencias y aprueba, rechaza o anula los servicios de su agencia.',
    ambito: 'AGENCIA',
    modulos: ['dashboard', 'notificaciones', 'aprobaciones', 'perfil'],
    capacidades: p(
      'agencias.ver', 'usuarios.ver', 'catalogo.ver', 'evidencias.ver', 'dashboard.ver', 'servicios.ver', 'servicios.decidir',
      'servicios.anular', 'solicitudes.ver', 'especiales.ver', 'especiales.anular', 'retos.ver', 'sync.usar',
    ),
  },
  {
    namerol: 'LIDER',
    descripcion: 'Líder operador: registra las OT de su agencia, controla bahías, inventario local, recepciones y despachos a otras agencias de su región.',
    ambito: 'AGENCIA',
    modulos: ['dashboard', 'notificaciones', 'servicios', 'configuracion/servicios', 'maquinaria', 'inventario', 'envios', 'operadores', 'asignaciones', 'perfil'],
    capacidades: p(
      ...LECTURA_RED, 'dashboard.ver', 'bahias.editar', 'bahias.asignar', 'servicios.ver', 'servicios.crear', 'servicios.editar',
      'servicios.anular', 'solicitudes.ver', 'solicitudes.crear', 'consumos.ver', 'recetas.ver', 'retos.ver', 'inventario.ver',
      'stock.consumir', 'despachos.ver', 'despachos.crear', 'despachos.recibir', 'alertas.ver', 'alertas.crear', 'maquinaria.ver',
      'incidentes.ver', 'incidentes.reportar', 'mantenimientos.ver', 'maquinaria.evidencias', 'limpiezas.ver', 'evidencias.subir', 'sync.usar',
    ),
  },
  {
    namerol: 'LAVADOR',
    descripcion: 'Personal de lavado en bahía. Por ahora solo trazabilidad: no usa la plataforma.',
    ambito: 'AGENCIA',
    modulos: ['perfil'],
    capacidades: [],
  },
  {
    namerol: 'COORD_SERVICIOS_ESPECIALES',
    descripcion: 'Coordinador de servicios especiales: crea, asigna, reasigna y anula servicios especiales de la red especializada.',
    ambito: 'GLOBAL',
    modulos: ['dashboard', 'notificaciones', 'servicios', 'configuracion/servicios', 'operadores', 'asignaciones', 'productividad', 'maquinaria', 'taller-tecnico', 'perfil'],
    capacidades: p(
      ...LECTURA_RED, 'dashboard.ver', 'productividad.ver', 'especiales.ver', 'especiales.crear',
      'especiales.reasignar', 'especiales.anular', 'recetas.ver', 'retos.ver', 'maquinaria.ver', 'incidentes.ver',
      'incidentes.reportar', 'maquinaria.evidencias', 'limpiezas.ver', 'evidencias.subir', 'sync.usar',
    ),
  },
  {
    namerol: 'PULIDOR',
    descripcion: 'Pulidor: especialista en servicios especiales. Fijo (con agencia, opera en su sede) o móvil (sin agencia, opera en su región).',
    ambito: 'AGENCIA',
    modulos: ['dashboard', 'notificaciones', 'servicios', 'maquinaria', 'inventario', 'envios', 'perfil'],
    capacidades: p(
      'agencias.ver', 'catalogo.ver', 'evidencias.ver', 'dashboard.ver', 'especiales.ver', 'especiales.crear',
      'especiales.operar', 'recetas.ver', 'retos.ver', 'inventario.ver', 'stock.consumir', 'despachos.ver', 'despachos.recibir',
      'alertas.ver', 'alertas.crear', 'maquinaria.ver', 'incidentes.ver', 'incidentes.reportar', 'mantenimientos.ver', 'maquinaria.evidencias',
      'limpiezas.ver', 'evidencias.subir', 'sync.usar',
    ),
  },
  {
    namerol: 'COORD_MANTENIMIENTO',
    descripcion: 'Coordinador de mantenimiento: alta de maquinaria, reparaciones, programación y asignación a técnicos.',
    ambito: 'REGION',
    modulos: ['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'perfil'],
    capacidades: p(
      'agencias.ver', 'usuarios.ver', 'evidencias.ver', 'dashboard.ver', 'maquinaria.ver', 'maquinaria.crear', 'maquinaria.gestionar',
      'maquinaria.trazabilidad', 'incidentes.ver', 'incidentes.resolver', 'mantenimientos.ver', 'mantenimientos.ejecutar',
      'checklist.gestionar', 'maquinaria.evidencias', 'limpiezas.ver', 'limpiezas.editar', 'evidencias.subir', 'sync.usar',
    ),
  },
  {
    namerol: 'TECNICO',
    descripcion: 'Técnico de maquinaria: trabaja en la región que tiene asignada y ejecuta y cierra las órdenes de mantenimiento que le asignan.',
    ambito: 'REGION',
    modulos: ['dashboard', 'notificaciones', 'maquinaria', 'taller-tecnico', 'perfil'],
    capacidades: p(
      'dashboard.ver', 'maquinaria.ver', 'incidentes.ver', 'incidentes.resolver', 'mantenimientos.ver', 'mantenimientos.ejecutar',
      'maquinaria.evidencias', 'evidencias.subir', 'evidencias.ver', 'sync.usar',
    ),
  },
  {
    namerol: 'COORD_BODEGA',
    descripcion: 'Coordinador de bodega: opera todo el stock nacional, compra a la bodega central y despacha a cualquier destino.',
    ambito: 'GLOBAL',
    modulos: ['dashboard', 'notificaciones', 'inventario', 'envios', 'reportes', 'configuracion/servicios', 'taller-tecnico', 'perfil'],
    capacidades: p(
      'agencias.ver', 'usuarios.ver', 'catalogo.ver', 'dashboard.ver', 'consumos.ver', 'recetas.ver', 'recetas.gestionar',
      'recetas.historial', 'inventario.ver', 'stock.ajustar', 'compras.registrar', 'despachos.ver', 'despachos.crear',
      'despachos.recibir', 'alertas.ver', 'alertas.atender', 'maquinaria.ver', 'limpiezas.ver', 'sync.usar',
    ),
  },
  {
    namerol: 'ASISTENTE_BODEGA',
    descripcion: 'Asistente de bodega: opera una bodega regional y despacha solo a agencias de la región de su bodega.',
    ambito: 'REGION',
    modulos: ['dashboard', 'notificaciones', 'inventario', 'envios', 'configuracion/servicios', 'perfil'],
    capacidades: p(
      'agencias.ver', 'usuarios.ver', 'catalogo.ver', 'dashboard.ver', 'consumos.ver', 'recetas.ver', 'recetas.historial',
      'inventario.ver', 'stock.ajustar', 'despachos.ver', 'despachos.crear', 'despachos.recibir', 'alertas.ver', 'alertas.atender', 'sync.usar',
    ),
  },
];

export const NOMBRES_ROLES_BASE: readonly string[] = ROLES_BASE.map((r) => r.namerol);
export const esRolBase = (namerol: string): boolean => NOMBRES_ROLES_BASE.includes(String(namerol || '').toUpperCase());
