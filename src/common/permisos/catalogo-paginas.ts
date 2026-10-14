/**
 * Catálogo de páginas del sistema: Página → Sub-página (pestaña real de la pantalla) → Acciones (botones).
 *
 * Un rol guarda en `capacidades` los códigos de este catálogo que tiene activados (`pagina.x`, `pagina.x.sub` y los códigos de
 * acción) junto con los permisos clásicos que de ellos se derivan (`otorga`), que son los que exigen los endpoints. Regla:
 *  - una sub-página solo cuenta si su página está activa, y una acción solo si su sub-página (o su página) lo está;
 *  - los permisos clásicos se calculan SOLO de lo activo, así apagar una página quita también lo que el servidor responde;
 *  - los datos de apoyo (lista de agencias, catálogo, usuarios en desplegables…) los otorga la propia página que los usa.
 */

export interface AccionDef {
  codigo: string;
  nombre: string;
  /** Permisos clásicos que esta acción habilita en el servidor. */
  otorga: string[];
  /** Con qué permisos clásicos se considera activa al migrar un rol existente (por defecto, los de `otorga`). */
  migrarSi?: string[];
  /** La misma casilla aparece en varias páginas (precios, evidencias…). */
  compartida?: boolean;
}

export interface SubPaginaDef {
  id: string;
  codigo: string;
  nombre: string;
  /** Permisos clásicos que habilita poder ver la sub-página. */
  otorga: string[];
  /** Permisos clásicos con los que una sub-página se considera activa al migrar (por defecto, los de `otorga`). */
  migrarSi?: string[];
  acciones: AccionDef[];
}

export interface PaginaDef {
  id: string;
  codigo: string;
  nombre: string;
  ruta: string;
  /** Código del módulo del menú (`modulos_sistema.codigo`); null = no aparece en el menú. */
  modulo: string | null;
  /** Permisos clásicos que habilita la página (lectura base y datos de apoyo). */
  otorga: string[];
  subs: SubPaginaDef[];
  /** Acciones de una página sin sub-páginas. */
  acciones: AccionDef[];
}

const accion = (codigo: string, nombre: string, otorga: string[] = [], extra: Partial<AccionDef> = {}): AccionDef => ({ codigo, nombre, otorga, ...extra });

const PRECIOS = accion('precios.ver', 'Ver precios y costos', ['precios.ver'], { compartida: true });
const CEDULA = accion('datos.cedula.ver', 'Ver cédula del personal', [], { compartida: true, migrarSi: ['__nunca__'] });
const CONTACTO = accion('datos.contacto.ver', 'Ver correo y teléfono del personal', [], { compartida: true, migrarSi: ['__nunca__'] });
const EVID_VER = accion('evidencias.ver', 'Ver evidencias (fotos y videos)', ['evidencias.ver'], { compartida: true });
const EVID_SUBIR = accion('evidencias.subir', 'Subir evidencias', ['evidencias.subir'], { compartida: true });
/** Las exportaciones viven solo en Reportes Operativos; hoy las hace quien ve reportes. */
const exportar = (codigo: string, nombre: string): AccionDef => accion(codigo, nombre, [], { migrarSi: ['reportes.ver'] });

const sub = (pagina: string, id: string, nombre: string, otorga: string[], acciones: AccionDef[], migrarSi?: string[]): SubPaginaDef => ({
  id,
  codigo: `pagina.${pagina}.${id}`,
  nombre,
  otorga,
  acciones,
  ...(migrarSi ? { migrarSi } : {}),
});

const pagina = (id: string, nombre: string, ruta: string, modulo: string | null, otorga: string[], subs: SubPaginaDef[], acciones: AccionDef[] = []): PaginaDef => ({
  id,
  codigo: `pagina.${id}`,
  nombre,
  ruta,
  modulo,
  otorga,
  subs,
  acciones,
});

export const PAGINAS: readonly PaginaDef[] = [
  pagina('dashboard', 'Dashboard', '/dashboard', 'dashboard', ['dashboard.ver'], [], [
    accion('dashboard.alertas.ver', 'Ver alertas de stock', ['alertas.ver']),
  ]),

  pagina('notificaciones', 'Notificaciones', '/notificaciones', 'notificaciones', [], []),

  // Una sola pantalla con pestañas (Mapa, Agencias, Regiones, Clientes, Aprobadores). Antes el mapa figuraba como página aparte.
  pagina('agencias', 'Agencias & Mapa Red', '/agencias', 'agencias', ['agencias.consultar', 'agencias.ver', 'usuarios.ver', 'catalogo.ver'], [
    // El mapa es de consulta: lo que muestra de cada bahía se enciende por bloques. Asignar o quitar lavadores se hace en Gestión de Lavadores.
    sub('agencias', 'mapa', 'Mapa Operativo', ['mapa.ver'], [
      accion('mapa.lavador.ver', 'Ver el lavador asignado a cada bahía', [], { migrarSi: ['mapa.ver'] }),
      accion('mapa.maquinaria.ver', 'Ver la maquinaria de cada bahía', ['maquinaria.ver'], { migrarSi: ['maquinaria.ver'] }),
      accion('mapa.vehiculo.ver', 'Ver el vehículo en servicio de cada bahía', [], { migrarSi: ['mapa.ver'] }),
    ], ['mapa.ver']),
    sub('agencias', 'agencias', 'Agencias', [], [
      accion('agencias.agencias.crear', 'Crear agencia', ['agencias.crear']),
      accion('agencias.agencias.editar', 'Editar datos de la agencia', ['agencias.editar']),
      accion('agencias.agencias.servicios', 'Habilitar servicios de la agencia', ['agencias.editar']),
      accion('agencias.agencias.estado', 'Activar o desactivar agencia', ['agencias.estado']),
      accion('agencias.bahias.crear', 'Crear bahía', ['bahias.crear']),
      accion('agencias.bahias.estado', 'Activar o desactivar bahía', ['bahias.editar']),
      accion('agencias.bahias.asignar', 'Asignar lavadores a bahía', ['bahias.asignar']),
      accion('agencias.personal.ver', 'Ver personal de la agencia', ['usuarios.ver']),
      accion('agencias.precios.fijar', 'Fijar precios por agencia', ['agencias.precios.gestionar']),
      PRECIOS, CEDULA, CONTACTO,
    ], ['agencias.consultar', 'agencias.crear', 'agencias.editar', 'agencias.estado', 'bahias.crear', 'bahias.editar', 'agencias.precios.gestionar']),
    sub('agencias', 'regiones', 'Regiones', [], [
      accion('agencias.regiones.crear', 'Crear región', ['regiones.gestionar']),
      accion('agencias.regiones.editar', 'Editar región', ['regiones.gestionar']),
      accion('agencias.regiones.estado', 'Activar o desactivar región', ['regiones.gestionar']),
    ], ['agencias.consultar', 'regiones.gestionar']),
    sub('agencias', 'clientes', 'Clientes', [], [
      accion('agencias.clientes.crear', 'Crear cliente', ['clientes.gestionar']),
      accion('agencias.clientes.editar', 'Editar cliente', ['clientes.gestionar']),
      accion('agencias.clientes.estado', 'Activar o desactivar cliente', ['clientes.gestionar']),
    ], ['agencias.consultar', 'clientes.gestionar']),
    // Aprobadores («gerentes» de la agencia): quién audita y aprueba los servicios de cada agencia.
    sub('agencias', 'aprobadores', 'Aprobadores', ['usuarios.ver'], [
      accion('agencias.aprobadores.asignar', 'Asignar o cambiar el aprobador de una agencia', [], { migrarSi: ['usuarios.gestionar'] }),
    ], ['usuarios.ver']),
  ]),

  pagina('operadores', 'Gestión de Lavadores', '/operadores', 'operadores', ['operadores.ver', 'agencias.ver'], [], [
    accion('operadores.registrar', 'Registrar lavador o pulidor', ['operadores.gestionar']),
    accion('operadores.editar', 'Editar datos', ['operadores.gestionar']),
    accion('operadores.rol', 'Cambiar rol', ['operadores.gestionar']),
    accion('operadores.bahia.asignar', 'Asignar a bahía', ['bahias.asignar']),
    accion('operadores.bahia.quitar', 'Quitar de bahía', ['bahias.asignar']),
    accion('operadores.ficha.ver', 'Ver ficha y productividad', ['operadores.ver']),
    CEDULA, CONTACTO,
  ]),

  pagina('servicios', 'Servicios de Lavado', '/servicios', 'servicios', ['agencias.ver', 'catalogo.ver'], [
    sub('servicios', 'generales', 'Servicios generales', ['servicios.ver'], [
      accion('servicios.generales.crear', 'Registrar OT', ['servicios.crear', 'usuarios.ver'], { migrarSi: ['servicios.crear'] }),
      accion('servicios.generales.agregar', 'Agregar servicios a una OT', ['servicios.crear']),
      accion('servicios.generales.editar', 'Editar OT', ['servicios.editar']),
      accion('servicios.generales.anular', 'Anular OT', ['servicios.anular']),
      EVID_VER, EVID_SUBIR, PRECIOS,
    ]),
    sub('servicios', 'especiales', 'Servicios especiales', ['especiales.ver'], [
      accion('servicios.especiales.crear', 'Crear OT especial', ['especiales.crear', 'usuarios.ver'], { migrarSi: ['especiales.crear'] }),
      accion('servicios.especiales.reasignar', 'Reasignar pulidor', ['especiales.reasignar', 'usuarios.ver'], { migrarSi: ['especiales.reasignar'] }),
      accion('servicios.especiales.anular', 'Anular OT especial', ['especiales.anular']),
      accion('servicios.especiales.operar', 'Ejecutar: iniciar, pausar y completar', ['especiales.operar']),
      EVID_VER, EVID_SUBIR, PRECIOS,
    ]),
  ]),

  pagina('catalogo', 'Catálogo de Servicios', '/configuracion/servicios', 'configuracion/servicios', ['catalogo.ver'], [
    sub('catalogo', 'generales', 'Servicios generales', [], [
      accion('catalogo.generales.crear', 'Crear servicio', ['catalogo.gestionar']),
      accion('catalogo.generales.editar', 'Editar servicio', ['catalogo.gestionar']),
      accion('catalogo.generales.estado', 'Activar o desactivar servicio', ['catalogo.gestionar']),
      accion('catalogo.generales.recetas.ver', 'Ver recetas de insumos', ['recetas.ver']),
      accion('catalogo.generales.recetas.editar', 'Editar recetas de insumos', ['recetas.gestionar']),
      accion('catalogo.generales.recetas.historial', 'Ver historial de recetas', ['recetas.historial']),
      PRECIOS,
    ], ['catalogo.ver']),
    sub('catalogo', 'especiales', 'Servicios especiales', [], [
      accion('catalogo.especiales.crear', 'Crear servicio', ['catalogo.gestionar']),
      accion('catalogo.especiales.editar', 'Editar servicio', ['catalogo.gestionar']),
      accion('catalogo.especiales.estado', 'Activar o desactivar servicio', ['catalogo.gestionar']),
      accion('catalogo.especiales.recetas.ver', 'Ver recetas de insumos', ['recetas.ver']),
      accion('catalogo.especiales.recetas.editar', 'Editar recetas de insumos', ['recetas.gestionar']),
      accion('catalogo.especiales.recetas.historial', 'Ver historial de recetas', ['recetas.historial']),
      PRECIOS,
    ], ['catalogo.ver']),
  ]),

  pagina('aprobaciones', 'Aprobaciones del Día', '/aprobaciones', 'aprobaciones', ['servicios.ver', 'agencias.ver', 'usuarios.ver', 'solicitudes.ver'], [], [
    accion('aprobaciones.aprobar', 'Aprobar servicio', ['servicios.decidir', 'solicitudes.crear']),
    accion('aprobaciones.rechazar', 'Rechazar servicio', ['servicios.decidir']),
    accion('aprobaciones.aprobar.todos', 'Aprobar todos', ['servicios.decidir']),
    accion('aprobaciones.anular', 'Anular servicio', ['servicios.anular']),
  ]),

  pagina('productividad', 'Productividad & Retos', '/productividad', 'productividad', ['agencias.ver'], [
    sub('productividad', 'productividad', 'Productividad', ['productividad.ver'], []),
    sub('productividad', 'retos', 'Retos', ['retos.ver'], [
      accion('productividad.retos.crear', 'Crear reto', ['retos.crear']),
      accion('productividad.retos.cerrar', 'Cerrar reto', ['retos.cerrar'], { migrarSi: ['retos.crear'] }),
      accion('productividad.retos.eliminar', 'Eliminar reto', ['retos.eliminar']),
    ]),
  ]),

  pagina('reportes', 'Reportes Operativos', '/reportes', 'reportes', ['reportes.ver', 'agencias.ver'], [], [
    exportar('reportes.excel', 'Exportar reporte a Excel'),
    exportar('reportes.pdf', 'Exportar reporte a PDF'),
  ]),

  pagina('maquinaria', 'Maquinaria & Equipos', '/maquinaria', 'maquinaria', ['maquinaria.ver'], [], [
    accion('maquinaria.crear', 'Registrar máquina', ['maquinaria.crear', 'agencias.ver'], { migrarSi: ['maquinaria.crear'] }),
    accion('maquinaria.editar', 'Editar, activar o desactivar máquina', ['maquinaria.editar']),
    accion('maquinaria.trasladar', 'Trasladar entre agencias', ['maquinaria.gestionar', 'agencias.ver'], { migrarSi: ['maquinaria.gestionar'] }),
    accion('maquinaria.responsable', 'Asignar responsable', ['maquinaria.gestionar']),
    accion('maquinaria.archivos', 'Subir foto o ficha técnica', ['maquinaria.editar']),
    accion('maquinaria.incidente.reportar', 'Reportar incidente', ['incidentes.reportar']),
    accion('maquinaria.trazabilidad.ver', 'Ver trazabilidad', ['maquinaria.trazabilidad']),
  ]),

  pagina('taller', 'Taller Técnico', '/taller-tecnico', 'taller-tecnico', [], [
    sub('taller', 'incidentes', 'Incidentes', ['incidentes.ver', 'maquinaria.ver'], [
      accion('taller.incidentes.reportar', 'Reportar incidente', ['incidentes.reportar']),
      accion('taller.incidentes.asignar', 'Asignar técnico', ['maquinaria.gestionar', 'usuarios.ver'], { migrarSi: ['maquinaria.gestionar'] }),
      accion('taller.incidentes.resolver', 'Resolver incidente', ['incidentes.resolver']),
      accion('taller.incidentes.cancelar', 'Cancelar incidente', ['incidentes.resolver']),
      accion('taller.incidentes.evidencias', 'Subir evidencias', ['maquinaria.evidencias']),
      EVID_VER, EVID_SUBIR, PRECIOS,
    ], ['incidentes.ver']),
    sub('taller', 'mantenimientos', 'Mantenimientos', ['mantenimientos.ver', 'maquinaria.ver'], [
      accion('taller.mantenimientos.programar', 'Programar mantenimiento', ['maquinaria.gestionar', 'usuarios.ver'], { migrarSi: ['maquinaria.gestionar'] }),
      accion('taller.mantenimientos.ejecutar', 'Ejecutar mantenimiento', ['mantenimientos.ejecutar']),
      accion('taller.mantenimientos.editar', 'Editar mantenimiento', ['mantenimientos.ejecutar']),
      accion('taller.mantenimientos.evidencias', 'Subir evidencias', ['maquinaria.evidencias']),
      EVID_VER, EVID_SUBIR, PRECIOS,
    ], ['mantenimientos.ver']),
    sub('taller', 'limpiezas', 'Limpiezas', ['limpiezas.ver'], [
      accion('taller.limpiezas.registrar', 'Registrar limpieza', ['limpiezas.evidencias']),
      accion('taller.limpiezas.editar', 'Editar o eliminar limpieza', ['limpiezas.editar']),
      exportar('reportes.maquinaria.limpiezas', 'Exportar limpiezas'),
    ]),
    sub('taller', 'checklist', 'Checklist', ['mantenimientos.ver', 'maquinaria.ver'], [
      accion('taller.checklist.gestionar', 'Gestionar plantillas de checklist', ['checklist.gestionar']),
    ], ['checklist.gestionar']),
  ]),

  pagina('inventario', 'Inventario & Suministros', '/inventario', 'inventario', ['inventario.ver', 'agencias.ver', 'catalogo.ver'], [
    sub('inventario', 'productos', 'Productos', [], [
      accion('inventario.productos.gestionar', 'Crear o editar insumo', ['inventario.catalogos.gestionar']),
      accion('inventario.productos.compra', 'Registrar compra', ['compras.registrar']),
      accion('inventario.productos.despachar', 'Despachar insumo', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'] }),
      PRECIOS,
    ], ['inventario.ver']),
    sub('inventario', 'bodegas', 'Bodegas', [], [
      accion('inventario.bodegas.gestionar', 'Crear o editar bodega', ['bodegas.gestionar']),
      accion('inventario.bodegas.estado', 'Activar o desactivar bodega', ['bodegas.gestionar']),
      accion('inventario.bodegas.eliminar', 'Eliminar bodega', ['bodegas.gestionar']),
      accion('inventario.bodegas.reajustar', 'Reajustar stock', ['stock.ajustar']),
      accion('inventario.bodegas.despachar', 'Despachar desde la bodega', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'] }),
    ], ['inventario.ver']),
    sub('inventario', 'agencias', 'Agencias', [], [
      accion('inventario.agencias.despachar', 'Despachar a la agencia', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'] }),
      accion('inventario.agencias.reajustar', 'Reajustar stock de la agencia', ['stock.ajustar']),
    ], ['inventario.ver']),
    sub('inventario', 'pulidores', 'Kits de pulidores', ['inventario.kits.ver'], [
      accion('inventario.pulidores.despachar', 'Despachar al pulidor', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'] }),
      accion('inventario.pulidores.reajustar', 'Reajustar el kit', ['stock.ajustar']),
    ]),
    sub('inventario', 'stock-bajo', 'Stock bajo', [], [
      accion('inventario.stockbajo.despachar', 'Despachar desde stock bajo', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'] }),
    ], ['inventario.ver']),
    sub('inventario', 'alertas', 'Alertas de reabastecimiento', ['alertas.ver'], [
      accion('inventario.alertas.crear', 'Crear alerta', ['alertas.crear']),
      accion('inventario.alertas.atender', 'Atender alerta', ['alertas.atender']),
    ]),
    sub('inventario', 'movimientos', 'Movimientos (kardex)', [], [PRECIOS], ['inventario.ver']),
    sub('inventario', 'consumo', 'Consumo por servicios', ['consumos.ver'], [PRECIOS]),
    sub('inventario', 'configuracion', 'Configuración', [], [
      accion('inventario.config.tipos', 'Gestionar tipos de producto', ['inventario.catalogos.gestionar']),
      accion('inventario.config.unidades', 'Gestionar unidades y presentaciones', ['inventario.catalogos.gestionar']),
    ], ['inventario.ver']),
  ]),

  pagina('envios', 'Envíos & Confirmación', '/envios', 'envios', ['despachos.ver', 'agencias.ver'], [], [
    accion('envios.crear', 'Crear despacho', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'] }),
    accion('envios.confirmar', 'Confirmar recepción', ['despachos.recibir']),
    accion('envios.faltantes', 'Resolver faltantes de envíos', ['despachos.ver'], { migrarSi: ['despachos.crear'] }),
    accion('envios.rechazar', 'Rechazar recepción', ['despachos.recibir']),
  ]),

  // Auditorías: tres pantallas del menú. Quien no puede auditar (líder, lavador, pulidor) solo ve el resultado de su inspección 5S y sus informes.
  pagina('auditorias', 'Dashboard de Auditorías', '/auditorias', 'auditorias', ['auditorias.ver'], []),

  pagina('informes', 'Informes de Inspección', '/informes-inspeccion', 'informes-inspeccion', ['informes.ver'], [], [
    accion('informes.crear', 'Crear y editar informes', ['informes.crear']),
    accion('informes.firmar', 'Registrar observaciones y calificación', ['informes.firmar']),
    accion('informes.seguimiento', 'Dar seguimiento a los planes de acción', ['informes.seguimiento']),
    accion('informes.revisar', 'Revisar, aprobar, rechazar y cerrar', ['informes.revisar']),
    accion('informes.eliminar', 'Eliminar borradores', ['informes.eliminar']),
  ]),

  pagina('inspecciones', 'Auditorías 5S', '/auditorias-5s', 'auditorias-5s', ['inspecciones.ver'], [], [
    accion('inspecciones.crear', 'Hacer auditorías 5S', ['inspecciones.crear']),
    accion('inspecciones.acciones', 'Dar seguimiento a las acciones correctivas', ['inspecciones.acciones']),
    accion('inspecciones.verificar', 'Verificar acciones y cerrar auditorías', ['inspecciones.verificar']),
    accion('inspecciones.eliminar', 'Eliminar borradores', ['inspecciones.eliminar']),
  ]),

  pagina('usuarios', 'Usuarios y Roles', '/usuarios', 'usuarios', [], [
    sub('usuarios', 'usuarios', 'Usuarios', ['usuarios.ver', 'agencias.ver'], [
      accion('usuarios.usuarios.crear', 'Crear usuario', ['usuarios.gestionar']),
      accion('usuarios.usuarios.editar', 'Editar usuario', ['usuarios.gestionar']),
      accion('usuarios.usuarios.estado', 'Activar o desactivar usuario', ['usuarios.gestionar']),
      accion('usuarios.usuarios.eliminar', 'Eliminar usuario', ['usuarios.gestionar']),
      accion('usuarios.usuarios.password', 'Asignar contraseña', ['usuarios.gestionar']),
      accion('usuarios.usuarios.backup', 'Gestionar usuarios Backup', ['backup.gestionar']),
      CEDULA, CONTACTO,
    ], ['usuarios.gestionar', 'backup.gestionar']),
    sub('usuarios', 'roles', 'Roles', ['roles.ver'], [
      accion('usuarios.roles.crear', 'Crear rol', ['roles.gestionar']),
      accion('usuarios.roles.editar', 'Editar permisos de un rol', ['roles.gestionar']),
      accion('usuarios.roles.eliminar', 'Eliminar rol', ['roles.gestionar']),
    ]),
  ]),

  pagina('perfil', 'Perfil', '/perfil', 'perfil', [], []),

  pagina('sistema', 'Sistema (fuera del menú)', 'app móvil y soporte', null, [], [], [
    accion('sistema.app.retos', 'Ver retos en la app móvil', ['retos.ver']),
    accion('sistema.sync.usar', 'Usar la sincronización de la app', ['sync.usar']),
    accion('sistema.sync.errores', 'Gestionar errores de sincronización', ['sync.dlq.gestionar']),
  ]),
];

// ───────────────────────── Índices ─────────────────────────

export const CODIGOS_PAGINAS: ReadonlySet<string> = new Set(PAGINAS.map((p) => p.codigo));
export const CODIGOS_SUBPAGINAS: ReadonlySet<string> = new Set(PAGINAS.flatMap((p) => p.subs.map((s) => s.codigo)));

const accionesDe = (p: PaginaDef): AccionDef[] => [...p.acciones, ...p.subs.flatMap((s) => s.acciones)];

/** Todos los códigos nuevos (páginas, sub-páginas y acciones). */
export const CODIGOS_NUEVOS: ReadonlySet<string> = new Set([
  ...CODIGOS_PAGINAS,
  ...CODIGOS_SUBPAGINAS,
  ...PAGINAS.flatMap((p) => accionesDe(p).map((a) => a.codigo)),
]);

export const esCodigoNuevo = (codigo: string): boolean => CODIGOS_NUEVOS.has(codigo);

/** Códigos de acción que cuelgan de cada sub-página o de cada página (para validar dependencias). */
const PADRES_DE_ACCION = new Map<string, string[]>();
for (const p of PAGINAS) {
  for (const a of p.acciones) PADRES_DE_ACCION.set(a.codigo, [...(PADRES_DE_ACCION.get(a.codigo) ?? []), p.codigo]);
  for (const s of p.subs) for (const a of s.acciones) PADRES_DE_ACCION.set(a.codigo, [...(PADRES_DE_ACCION.get(a.codigo) ?? []), s.codigo]);
}

const PAGINA_DE_SUB = new Map<string, string>(PAGINAS.flatMap((p) => p.subs.map((s) => [s.codigo, p.codigo] as const)));

const NOMBRE_DE = new Map<string, string>([
  ...PAGINAS.map((p) => [p.codigo, p.nombre] as const),
  ...PAGINAS.flatMap((p) => p.subs.map((s) => [s.codigo, `${p.nombre} › ${s.nombre}`] as const)),
  ...PAGINAS.flatMap((p) => accionesDe(p).map((a) => [a.codigo, a.nombre] as const)),
]);
export const nombreDeCodigo = (codigo: string): string => NOMBRE_DE.get(codigo) ?? codigo;

// ───────────────────────── Validación y expansión ─────────────────────────

/** Códigos nuevos que no pueden estar activos porque su página o sub-página está apagada. */
export function dependenciasRotas(codigos: Iterable<string>): { codigo: string; requiere: string }[] {
  const activos = new Set(codigos);
  const rotas: { codigo: string; requiere: string }[] = [];
  for (const c of activos) {
    if (CODIGOS_SUBPAGINAS.has(c)) {
      const pag = PAGINA_DE_SUB.get(c)!;
      if (!activos.has(pag)) rotas.push({ codigo: c, requiere: pag });
    } else if (PADRES_DE_ACCION.has(c)) {
      const padres = PADRES_DE_ACCION.get(c)!;
      if (!padres.some((pd) => activos.has(pd) && (!CODIGOS_SUBPAGINAS.has(pd) || activos.has(PAGINA_DE_SUB.get(pd)!)))) {
        rotas.push({ codigo: c, requiere: padres[0] });
      }
    }
  }
  return rotas;
}

/**
 * Lo realmente activo: quita sub-páginas y acciones cuya página o sub-página está apagada.
 * Una acción compartida sigue activa si al menos uno de sus padres lo está.
 */
export function codigosNuevosActivos(codigos: Iterable<string>): Set<string> {
  const pedidos = new Set([...codigos].filter(esCodigoNuevo));
  const activos = new Set<string>();
  for (const p of PAGINAS) if (pedidos.has(p.codigo)) activos.add(p.codigo);
  for (const p of PAGINAS) {
    if (!activos.has(p.codigo)) continue;
    for (const s of p.subs) if (pedidos.has(s.codigo)) activos.add(s.codigo);
  }
  for (const p of PAGINAS) {
    if (!activos.has(p.codigo)) continue;
    for (const a of p.acciones) if (pedidos.has(a.codigo)) activos.add(a.codigo);
    for (const s of p.subs) {
      if (!activos.has(s.codigo)) continue;
      for (const a of s.acciones) if (pedidos.has(a.codigo)) activos.add(a.codigo);
    }
  }
  return activos;
}

/** Permisos clásicos (los que exigen los endpoints) que salen de lo activo. */
export function permisosClasicosDe(codigos: Iterable<string>): Set<string> {
  const activos = codigosNuevosActivos(codigos);
  const out = new Set<string>();
  for (const p of PAGINAS) {
    if (!activos.has(p.codigo)) continue;
    p.otorga.forEach((c) => out.add(c));
    for (const a of p.acciones) if (activos.has(a.codigo)) a.otorga.forEach((c) => out.add(c));
    for (const s of p.subs) {
      if (!activos.has(s.codigo)) continue;
      s.otorga.forEach((c) => out.add(c));
      for (const a of s.acciones) if (activos.has(a.codigo)) a.otorga.forEach((c) => out.add(c));
    }
  }
  return out;
}

/** Lo que se guarda en el rol: los códigos nuevos activos más los permisos clásicos que de ellos se derivan. */
export function capacidadesDesdeNuevos(codigos: Iterable<string>): string[] {
  const activos = codigosNuevosActivos(codigos);
  return [...new Set([...activos, ...permisosClasicosDe(activos)])];
}

// ───────────────────────── Migración de roles existentes ─────────────────────────

/**
 * Códigos nuevos que corresponden a un rol según sus permisos clásicos actuales, para que nadie pierda lo que ya hacía.
 * Una página está activa si el rol ve su pantalla; una sub-página, si tiene lo que la habilita; una acción, si tiene sus permisos.
 */
export function nuevosDesdeClasicos(
  clasicos: readonly string[],
  paginaVisible: (pagina: PaginaDef) => boolean,
): string[] {
  const tiene = new Set(clasicos);
  const todos = (lista: string[]) => lista.length > 0 && lista.every((c) => tiene.has(c));
  const alguno = (lista: string[]) => lista.some((c) => tiene.has(c));
  const nuevos = new Set<string>();
  for (const p of PAGINAS) {
    if (!paginaVisible(p)) continue;
    nuevos.add(p.codigo);
    for (const a of p.acciones) if (todos(a.migrarSi ?? a.otorga)) nuevos.add(a.codigo);
    for (const s of p.subs) {
      const base = s.migrarSi ?? s.otorga;
      const subActiva = base.length === 0 ? true : alguno(base);
      if (!subActiva) continue;
      nuevos.add(s.codigo);
      for (const a of s.acciones) if (todos(a.migrarSi ?? a.otorga)) nuevos.add(a.codigo);
    }
  }
  return [...nuevos];
}

/** Árbol para la pantalla de roles. */
export function arbolPaginas() {
  return PAGINAS.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    ruta: p.ruta,
    enMenu: p.modulo !== null,
    modulo: p.modulo,
    subs: p.subs.map((s) => ({
      id: s.id,
      codigo: s.codigo,
      nombre: s.nombre,
      acciones: s.acciones.map((a) => ({ codigo: a.codigo, nombre: a.nombre, compartida: !!a.compartida })),
    })),
    acciones: p.acciones.map((a) => ({ codigo: a.codigo, nombre: a.nombre, compartida: !!a.compartida })),
  }));
}
