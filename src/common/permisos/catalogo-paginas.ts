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
  /** Bloque al que pertenece la casilla dentro de la página (Consultar, Operar, Evidencias…). */
  grupo?: string;
  /**
   * Acciones que van de la mano y se marcan juntas. Si se otorga la primera, las demás se agregan solas: no tiene
   * sentido, por ejemplo, dejar reportar un incidente sin poder subir la foto que lo respalda.
   */
  implica?: string[];
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
  /** Permisos clásicos de apoyo (lista de agencias, catálogo…): se otorgan al activar la página. */
  otorga: string[];
  /**
   * Permiso de lectura de la pantalla. A diferencia de `otorga`, solo se entrega cuando el rol tiene al menos una acción
   * o sección marcada dentro de la página: activar el menú sin marcar nada no muestra datos.
   */
  lectura?: string[];
  subs: SubPaginaDef[];
  /** Acciones de una página sin sub-páginas. */
  acciones: AccionDef[];
}

const accion = (codigo: string, nombre: string, otorga: string[] = [], extra: Partial<AccionDef> = {}): AccionDef => ({ codigo, nombre, otorga, ...extra });

const PRECIOS = accion('precios.ver', 'Ver precios y costos', ['precios.ver'], { compartida: true });
const CEDULA = accion('datos.cedula.ver', 'Ver cédula del personal', [], { compartida: true, migrarSi: ['__nunca__'] });
const CONTACTO = accion('datos.contacto.ver', 'Ver correo y teléfono del personal', [], { compartida: true, migrarSi: ['__nunca__'] });
const EVID_VER = accion('evidencias.ver', 'Ver evidencias (fotos y videos)', ['evidencias.ver'], { compartida: true, grupo: 'Consultar' });
/** Acciones que viven en dos páginas (Maquinaria y Taller): una sola casilla, con el mismo código en ambas. */
const REPORTAR_INCIDENTE = accion('taller.incidentes.reportar', 'Reportar incidencia con foto', ['incidentes.reportar', 'evidencias.subir', 'evidencias.ver', 'maquinaria.evidencias'], { compartida: true, grupo: 'Operar' });
const PROGRAMAR_MANTENIMIENTO = accion('taller.mantenimientos.programar', 'Programar mantenimiento', ['maquinaria.gestionar', 'usuarios.ver'], { compartida: true, grupo: 'Operar', migrarSi: ['maquinaria.gestionar'] });
const REGISTRAR_LIMPIEZA = accion('taller.limpiezas.registrar', 'Registrar limpieza con foto', ['limpiezas.evidencias', 'evidencias.ver'], { compartida: true, grupo: 'Operar' });
/** Despachar y reajustar stock aparecen en varias pestañas de Inventario, pero son una sola casilla compartida cada una. */
const DESPACHAR_INSUMOS = accion('inventario.despachar', 'Despachar insumos', ['despachos.crear', 'usuarios.ver'], { compartida: true, migrarSi: ['despachos.crear'], grupo: 'Operar' });
const REAJUSTAR_STOCK = accion('inventario.reajustar', 'Reajustar stock', ['stock.ajustar'], { compartida: true, grupo: 'Stock' });
const CREAR_ALERTA = accion('inventario.alertas.crear', 'Crear alerta', ['alertas.crear', 'alertas.ver'], { compartida: true, grupo: 'Operar' });
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

const pagina = (id: string, nombre: string, ruta: string, modulo: string | null, otorga: string[], subs: SubPaginaDef[], acciones: AccionDef[] = [], lectura: string[] = []): PaginaDef => ({
  id,
  codigo: `pagina.${id}`,
  nombre,
  ruta,
  modulo,
  otorga,
  subs,
  acciones,
  ...(lectura.length ? { lectura } : {}),
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
      // La maquinaria del mapa sale de maquinaria/list, que acepta esta casilla: verla en el mapa no da el módulo de Maquinaria.
      accion('mapa.maquinaria.ver', 'Ver la maquinaria de cada bahía', ['mapa.maquinaria.ver'], { migrarSi: ['maquinaria.ver'] }),
      accion('mapa.vehiculo.ver', 'Ver el vehículo en servicio de cada bahía', [], { migrarSi: ['mapa.ver'] }),
    ], ['mapa.ver']),
    sub('agencias', 'agencias', 'Agencias', [], [
      accion('agencias.agencias.crear', 'Crear agencia', ['agencias.crear']),
      accion('agencias.agencias.editar', 'Editar datos de la agencia (incluye cantidad de bahías y activar o desactivar bahías)', ['agencias.editar', 'bahias.editar'], { migrarSi: ['agencias.editar'] }),
      accion('agencias.agencias.servicios', 'Habilitar servicios de la agencia', ['agencias.editar']),
      accion('agencias.agencias.estado', 'Activar o desactivar agencia', ['agencias.estado']),
      accion('agencias.bahias.asignar', 'Asignar lavadores a bahía', ['bahias.asignar']),
      // Una sola casilla para el personal: con ella se ve la lista completa, con cédula, correo y teléfono.
      accion('agencias.personal.ver', 'Ver personal completo de la agencia (con cédula, correo y teléfono)', ['usuarios.ver', 'datos.cedula.ver', 'datos.contacto.ver'], { migrarSi: ['usuarios.ver'] }),
      accion('agencias.precios.fijar', 'Fijar precios por agencia', ['agencias.precios.gestionar']),
      PRECIOS,
    ], ['agencias.consultar', 'agencias.crear', 'agencias.editar', 'agencias.estado', 'bahias.editar', 'agencias.precios.gestionar']),
    sub('agencias', 'regiones', 'Regiones', [], [
      accion('agencias.regiones.crear', 'Crear región', ['regiones.gestionar']),
      accion('agencias.regiones.transferir', 'Transferir agencias entre regiones', ['regiones.transferir'], { migrarSi: ['agencias.crear'] }),
      accion('agencias.regiones.editar', 'Editar región', ['regiones.gestionar']),
      accion('agencias.regiones.estado', 'Activar o desactivar región', ['regiones.gestionar']),
    ], ['agencias.consultar', 'regiones.gestionar']),
    sub('agencias', 'clientes', 'Clientes', [], [
      accion('agencias.clientes.crear', 'Crear cliente', ['clientes.gestionar']),
      accion('agencias.clientes.transferir', 'Transferir agencias entre clientes', ['agencias.transferir'], { migrarSi: ['agencias.crear'] }),
      accion('agencias.clientes.editar', 'Editar cliente', ['clientes.gestionar']),
      accion('agencias.clientes.estado', 'Activar o desactivar cliente', ['clientes.gestionar']),
    ], ['agencias.consultar', 'clientes.gestionar']),
    // Aprobadores («gerentes» de la agencia): quién audita y aprueba los servicios de cada agencia.
    sub('agencias', 'aprobadores', 'Aprobadores', ['usuarios.ver'], [
      accion('agencias.aprobadores.asignar', 'Asignar o cambiar el aprobador de una agencia', [], { migrarSi: ['usuarios.gestionar'] }),
    ], ['usuarios.ver']),
  ]),

  // Con la página activa se ve todo del lavador: ficha, productividad, cédula, correo y teléfono (no hay casilla de lectura aparte).
  pagina('operadores', 'Gestión de Lavadores', '/operadores', 'operadores', ['operadores.ver', 'agencias.ver', 'datos.cedula.ver', 'datos.contacto.ver'], [], [
    accion('operadores.registrar', 'Registrar lavador o pulidor', ['operadores.gestionar']),
    accion('operadores.editar', 'Editar datos', ['operadores.gestionar']),
    accion('operadores.bahia.asignar', 'Asignar y quitar de bahía', ['bahias.asignar']),
  ]),

  pagina('servicios', 'Servicios de Lavado', '/servicios', 'servicios', ['agencias.ver', 'catalogo.ver'], [
    // Ver las evidencias (fotos y videos de inicio y fin) va con ver los servicios: no es una casilla aparte.
    sub('servicios', 'generales', 'Servicios generales', ['servicios.ver', 'evidencias.ver'], [
      // Subir evidencias no es una casilla aparte: va con registrar (evidencia de ingreso), agregar y finalizar (no se puede finalizar sin evidencia).
      accion('servicios.generales.crear', 'Registrar OT (incluye subir evidencias)', ['servicios.crear', 'evidencias.subir', 'usuarios.ver'], { migrarSi: ['servicios.crear'] }),
      accion('servicios.generales.agregar', 'Agregar servicios a una OT (incluye subir evidencias)', ['servicios.crear', 'evidencias.subir'], { migrarSi: ['servicios.crear'] }),
      accion('servicios.generales.finalizar', 'Finalizar OT (incluye subir evidencias)', ['servicios.finalizar', 'evidencias.subir'], { migrarSi: ['servicios.editar'] }),
      accion('servicios.generales.editar', 'Editar OT (vehículo, cliente y observaciones)', ['servicios.editar']),
      accion('servicios.generales.anular', 'Anular OT', ['servicios.anular']),
      PRECIOS,
    ], ['servicios.ver']),
    sub('servicios', 'especiales', 'Servicios especiales', ['especiales.ver', 'evidencias.ver'], [
      // Crear una OT especial tiene dos casillas independientes: para uno mismo y para otro pulidor (un rol puede tener una, la otra o las dos).
      accion('servicios.especiales.crear', 'Crear OT especial (para mí)', ['especiales.crear'], { migrarSi: ['especiales.crear'] }),
      accion('servicios.especiales.asignar', 'Crear OT especial y asignarla a otro pulidor (también reasigna al editar)', ['especiales.asignar', 'especiales.reasignar', 'usuarios.ver'], { migrarSi: ['especiales.asignar'] }),
      // Reasignar el pulidor va dentro de editar, pero solo con la casilla de asignar a otro pulidor.
      accion('servicios.especiales.editar', 'Editar OT especial (vehículo, cliente, prioridad y observaciones)', ['especiales.editar']),
      accion('servicios.especiales.anular', 'Anular OT especial', ['especiales.anular']),
      accion('servicios.especiales.operar', 'Ejecutar: iniciar, pausar y reanudar (incluye subir evidencias)', ['especiales.operar', 'evidencias.subir'], { migrarSi: ['especiales.operar'] }),
      accion('servicios.especiales.finalizar', 'Finalizar OT especial (incluye subir evidencias)', ['especiales.finalizar', 'evidencias.subir'], { migrarSi: ['especiales.operar'] }),
      PRECIOS,
    ], ['especiales.ver']),
  ]),

  pagina('catalogo', 'Catálogo de Servicios', '/configuracion/servicios', 'configuracion/servicios', ['catalogo.ver'], [
    sub('catalogo', 'generales', 'Servicios generales', [], [
      accion('catalogo.generales.crear', 'Crear servicio', ['catalogo.gestionar']),
      accion('catalogo.generales.editar', 'Editar servicio', ['catalogo.gestionar']),
      accion('catalogo.generales.estado', 'Activar o desactivar servicio', ['catalogo.gestionar']),
      accion('catalogo.generales.recetas.ver', 'Ver recetas de insumos', ['recetas.ver']),
      accion('catalogo.generales.recetas.editar', 'Editar recetas de insumos', ['recetas.gestionar']),
      accion('catalogo.generales.recetas.historial', 'Ver historial de recetas', ['recetas.historial']),
    ], ['catalogo.ver']),
    sub('catalogo', 'especiales', 'Servicios especiales', [], [
      accion('catalogo.especiales.crear', 'Crear servicio', ['catalogo.gestionar']),
      accion('catalogo.especiales.editar', 'Editar servicio', ['catalogo.gestionar']),
      accion('catalogo.especiales.estado', 'Activar o desactivar servicio', ['catalogo.gestionar']),
      accion('catalogo.especiales.recetas.ver', 'Ver recetas de insumos', ['recetas.ver']),
      accion('catalogo.especiales.recetas.editar', 'Editar recetas de insumos', ['recetas.gestionar']),
      accion('catalogo.especiales.recetas.historial', 'Ver historial de recetas', ['recetas.historial']),
    ], ['catalogo.ver']),
  ]),

  pagina('aprobaciones', 'Aprobaciones del Día', '/aprobaciones', 'aprobaciones', ['servicios.ver', 'agencias.ver', 'usuarios.ver', 'solicitudes.ver'], [], [
    // Aprobar un servicio depende solo de poder decidir: si se exigiera también 'solicitudes.crear', el rol APROBADOR
    // (que decide pero no crea solicitudes) quedaba sin el botón Aprobar aunque sí podía rechazar.
    accion('aprobaciones.aprobar', 'Aprobar servicio', ['servicios.decidir', 'solicitudes.crear'], { migrarSi: ['servicios.decidir'] }),
    accion('aprobaciones.rechazar', 'Rechazar servicio', ['servicios.decidir']),
    accion('aprobaciones.anular', 'Anular servicio', ['servicios.anular']),
    EVID_VER,
  ]),

  pagina('productividad', 'Productividad & Retos', '/productividad', 'productividad', ['agencias.ver'], [
    sub('productividad', 'productividad', 'Productividad', ['productividad.ver'], []),
    sub('productividad', 'retos', 'Retos', ['retos.ver'], [
      accion('productividad.retos.crear', 'Crear reto', ['retos.crear']),
      accion('productividad.retos.editar', 'Editar reto', ['retos.editar'], { migrarSi: ['retos.crear'] }),
      accion('productividad.retos.cerrar', 'Cerrar reto', ['retos.cerrar'], { migrarSi: ['retos.crear'] }),
      accion('productividad.retos.eliminar', 'Eliminar reto', ['retos.eliminar']),
    ]),
  ]),

  pagina('reportes', 'Reportes Operativos', '/reportes', 'reportes', ['reportes.ver', 'agencias.ver'], [], [
    exportar('reportes.excel', 'Exportar reporte a Excel'),
    exportar('reportes.pdf', 'Exportar reporte a PDF'),
  ]),

  pagina('maquinaria', 'Maquinaria & Equipos', '/maquinaria', 'maquinaria', [], [], [
    accion('maquinaria.ver', 'Ver equipos y su estado', ['maquinaria.ver'], { grupo: 'Consultar', migrarSi: ['maquinaria.ver'] }),
    accion('maquinaria.trazabilidad.ver', 'Ver trazabilidad de cada equipo', ['maquinaria.trazabilidad'], { grupo: 'Consultar', implica: ['maquinaria.ver'] }),
    accion('maquinaria.crear', 'Registrar máquina', ['maquinaria.crear', 'agencias.ver'], { migrarSi: ['maquinaria.crear'], grupo: 'Operar', implica: ['maquinaria.ver'] }),
    accion('maquinaria.editar', 'Editar, activar o desactivar máquina', ['maquinaria.editar'], { grupo: 'Operar', implica: ['maquinaria.ver'] }),
    // Cambiar la foto o la ficha es una casilla aparte: el endpoint `update` la acepta sola (no arrastra editar los datos).
    accion('maquinaria.archivos', 'Subir foto o ficha técnica', ['maquinaria.archivos', 'maquinaria.evidencias'], { migrarSi: ['maquinaria.editar'], grupo: 'Operar', implica: ['maquinaria.ver'] }),
    accion('maquinaria.trasladar', 'Trasladar entre agencias o al taller', ['maquinaria.gestionar', 'agencias.ver'], { migrarSi: ['maquinaria.gestionar'], grupo: 'Operar', implica: ['maquinaria.ver'] }),
    // Para elegir a quién asignarla, la pantalla lista usuarios (agencias/usuarios/list exige 'usuarios.ver').
    accion('maquinaria.responsable', 'Asignar responsable o operador', ['maquinaria.gestionar', 'usuarios.ver'], { grupo: 'Operar', implica: ['maquinaria.ver'] }),
    // Reportar una incidencia siempre lleva foto: la evidencia va incluida en la misma casilla (compartida con Taller Técnico).
    // Las tres son la misma casilla que en Taller Técnico (mismo código); desde aquí también dan la lectura de la máquina.
    { ...REPORTAR_INCIDENTE, implica: ['maquinaria.ver'] },
    { ...PROGRAMAR_MANTENIMIENTO, implica: ['maquinaria.ver'] },
    { ...REGISTRAR_LIMPIEZA, implica: ['maquinaria.ver'] },
  ], ['maquinaria.ver']),

  pagina('taller', 'Taller Técnico', '/taller-tecnico', 'taller-tecnico', [], [
    // La pestaña lista equipos con maquinaria/list, que acepta su permiso: abrir Incidentes no regala el módulo de Maquinaria.
    sub('taller', 'incidentes', 'Incidentes', ['incidentes.ver'], [
      // Reportar y resolver incluyen la evidencia: sin la foto no hay incidencia que valga, así que no se separan.
      REPORTAR_INCIDENTE,
      accion('taller.incidentes.asignar', 'Asignar técnico', ['maquinaria.gestionar', 'usuarios.ver'], { migrarSi: ['maquinaria.gestionar'], grupo: 'Operar' }),
      accion('taller.incidentes.resolver', 'Resolver incidencia con evidencia', ['incidentes.resolver', 'evidencias.subir', 'evidencias.ver', 'maquinaria.evidencias'], { grupo: 'Operar' }),
      accion('taller.incidentes.cancelar', 'Cancelar incidencia', ['incidentes.resolver'], { grupo: 'Operar' }),
      PRECIOS,
    ], ['incidentes.ver']),
    sub('taller', 'mantenimientos', 'Mantenimientos', ['mantenimientos.ver'], [
      PROGRAMAR_MANTENIMIENTO,
      accion('taller.mantenimientos.ejecutar', 'Ejecutar mantenimiento con evidencia', ['mantenimientos.ejecutar', 'evidencias.subir', 'evidencias.ver', 'maquinaria.evidencias'], { grupo: 'Operar' }),
      accion('taller.mantenimientos.editar', 'Editar mantenimiento', ['mantenimientos.ejecutar'], { grupo: 'Operar' }),
      PRECIOS,
    ], ['mantenimientos.ver']),
    sub('taller', 'limpiezas', 'Limpiezas', ['limpiezas.ver'], [
      REGISTRAR_LIMPIEZA,
      accion('taller.limpiezas.editar', 'Editar o eliminar limpieza', ['limpiezas.editar'], { grupo: 'Operar' }),
      exportar('reportes.maquinaria.limpiezas', 'Exportar limpiezas'),
    ]),
  ]),

  pagina('inventario', 'Inventario & Suministros', '/inventario', 'inventario', ['agencias.ver', 'catalogo.ver'], [
    sub('inventario', 'productos', 'Productos', [], [
      accion('inventario.productos.gestionar', 'Crear o editar insumo', ['inventario.catalogos.gestionar'], { grupo: 'Catálogo' }),
      accion('inventario.productos.compra', 'Registrar compra', ['compras.registrar'], { grupo: 'Operar' }),
      DESPACHAR_INSUMOS,
    ], ['inventario.ver']),
    sub('inventario', 'bodegas', 'Bodegas', [], [
      accion('inventario.bodegas.gestionar', 'Crear o editar bodega', ['bodegas.gestionar'], { grupo: 'Catálogo' }),
      accion('inventario.bodegas.estado', 'Activar o desactivar bodega', ['bodegas.gestionar'], { grupo: 'Catálogo' }),
      accion('inventario.bodegas.eliminar', 'Eliminar bodega', ['bodegas.gestionar'], { grupo: 'Catálogo' }),
      REAJUSTAR_STOCK,
      DESPACHAR_INSUMOS,
    ], ['inventario.ver']),
    sub('inventario', 'agencias', 'Agencias', [], [
      DESPACHAR_INSUMOS,
      REAJUSTAR_STOCK,
    ], ['inventario.ver']),
    sub('inventario', 'pulidores', 'Pulidores', ['inventario.kits.ver'], [
      DESPACHAR_INSUMOS,
      REAJUSTAR_STOCK,
    ]),
    sub('inventario', 'stock-bajo', 'Stock Bajo', [], [
      DESPACHAR_INSUMOS,
      CREAR_ALERTA,
    ], ['inventario.ver']),
    sub('inventario', 'alertas', 'Alertas de Reabastecimiento', ['alertas.ver'], [
      CREAR_ALERTA,
      accion('inventario.alertas.atender', 'Atender alerta', ['alertas.atender'], { grupo: 'Operar' }),
    ]),
    sub('inventario', 'movimientos', 'Movimientos (kardex)', [], [PRECIOS], ['inventario.ver']),
    sub('inventario', 'consumo', 'Consumo por Servicio', ['consumos.ver'], []),
    sub('inventario', 'configuracion', 'Configuración', [], [
      accion('inventario.config.tipos', 'Gestionar tipos de producto', ['inventario.catalogos.gestionar'], { grupo: 'Catálogo' }),
      accion('inventario.config.unidades', 'Gestionar unidades y presentaciones', ['inventario.catalogos.gestionar'], { grupo: 'Catálogo' }),
    ], ['inventario.ver']),
  ], [], ['inventario.ver']),

  // Activar la página basta para ver todos los envíos de su ámbito: no hay casilla aparte de «ver».
  pagina('envios', 'Envíos & Confirmación', '/envios', 'envios', ['agencias.ver', 'despachos.ver'], [], [
    accion('envios.crear', 'Crear y despachar envío', ['despachos.crear', 'usuarios.ver'], { migrarSi: ['despachos.crear'], grupo: 'Operar' }),
    accion('envios.confirmar', 'Confirmar recepción', ['despachos.recibir'], { grupo: 'Operar' }),
    accion('envios.rechazar', 'Rechazar recepción', ['despachos.recibir'], { grupo: 'Operar', implica: ['envios.confirmar'] }),
    accion('envios.faltantes', 'Resolver faltantes de envíos', ['despachos.ver'], { migrarSi: ['despachos.crear'], grupo: 'Operar' }),
  ]),

  // Auditorías: tres pantallas del menú. Quien no puede auditar (líder, lavador, pulidor) solo ve el resultado de su inspección 5S y sus informes.

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
      accion('usuarios.usuarios.password', 'Asignar y restablecer contraseñas', []),
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

/** Acciones que se marcan juntas: código → códigos que se activan con él. */
const IMPLICACIONES = new Map<string, string[]>(
  PAGINAS.flatMap((p) => accionesDe(p).filter((a) => a.implica?.length).map((a) => [a.codigo, a.implica!] as const)),
);

/** Si se otorga una acción, se otorgan también las que van de la mano (en cascada). */
export function expandirImplicaciones(codigos: Iterable<string>): Set<string> {
  const out = new Set(codigos);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const [codigo, implica] of IMPLICACIONES) {
      if (!out.has(codigo)) continue;
      for (const dependiente of implica) {
        if (out.has(dependiente)) continue;
        out.add(dependiente);
        cambio = true;
      }
    }
  }
  return out;
}

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

/** Códigos que otra casilla otorga (p. ej. la cédula, que da «Ver lavadores completo»): no necesitan su propia página activa. */
const OTORGADOS_POR_ACCION: ReadonlySet<string> = new Set(PAGINAS.flatMap((p) => [...p.otorga, ...p.subs.flatMap((s) => s.otorga), ...accionesDe(p).flatMap((a) => a.otorga)]));

/** Códigos nuevos que no pueden estar activos porque su página o sub-página está apagada. */
export function dependenciasRotas(codigos: Iterable<string>): { codigo: string; requiere: string }[] {
  const activos = new Set(codigos);
  const rotas: { codigo: string; requiere: string }[] = [];
  for (const c of activos) {
    if (OTORGADOS_POR_ACCION.has(c)) continue;
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

/**
 * Permisos clásicos (los que exigen los endpoints) que salen de lo activo.
 *
 * Regla de lectura explícita: una página con contenido configurable NO entrega su permiso de lectura solo por estar
 * activa; necesita al menos una acción marcada o una de sus secciones (sub-página) activa. Así, activar «Envíos» en el
 * menú sin marcar ninguna casilla no muestra datos, y cada sección se abre marcando lo que el rol puede hacer en ella.
 * Las pantallas de consulta pura —sin sub-páginas ni acciones— sí se abren con su interruptor.
 */
export function permisosClasicosDe(codigos: Iterable<string>): Set<string> {
  const activos = codigosNuevosActivos(codigos);
  const out = new Set<string>();

  const paginaAporta = (p: PaginaDef): boolean => {
    if (!p.subs.length && !p.acciones.length) return true;
    if (p.acciones.some((a) => activos.has(a.codigo))) return true;
    return p.subs.some((s) => activos.has(s.codigo));
  };

  for (const p of PAGINAS) {
    if (!activos.has(p.codigo)) continue;
    // Los datos de apoyo se necesitan para pintar la pantalla y no exponen el contenido del módulo.
    p.otorga.forEach((c) => out.add(c));
    // La lectura del módulo sí exige haber marcado algo dentro de la página.
    if (paginaAporta(p)) (p.lectura ?? []).forEach((c) => out.add(c));
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
  const activos = codigosNuevosActivos(expandirImplicaciones(codigos));
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
  const todos = (lista?: string[]) => Array.isArray(lista) && lista.length > 0 && lista.every((c) => tiene.has(c));
  const alguno = (lista?: string[]) => Array.isArray(lista) && lista.some((c) => tiene.has(c));
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
      acciones: s.acciones.map((a) => ({ codigo: a.codigo, nombre: a.nombre, compartida: !!a.compartida, grupo: a.grupo, implica: a.implica })),
    })),
    acciones: p.acciones.map((a) => ({ codigo: a.codigo, nombre: a.nombre, compartida: !!a.compartida, grupo: a.grupo, implica: a.implica })),
  }));
}
