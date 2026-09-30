/**
 * Catálogo único de permisos del sistema.
 *
 * Cada endpoint declara con `@Permiso('codigo')` qué permiso exige. Los permisos de cada rol se guardan en la tabla `roles`
 * (columna `capacidades`) y se editan desde el módulo «Roles y Permisos». Un endpoint sin declaración se rechaza.
 *
 * Los permisos dicen QUÉ acción puede hacer un rol; el ámbito (`AMBITOS`) dice SOBRE QUÉ DATOS (todo el país, su región,
 * su agencia o lo propio). Las reglas de negocio finas (aprobador designado, servicio aprobado, pulidor asignado…) se
 * validan en los servicios, encima del permiso.
 */

export interface DefinicionPermiso {
  codigo: string;
  grupo: string;
  nombre: string;
  descripcion: string;
}

const def = (grupo: string, codigo: string, nombre: string, descripcion: string): DefinicionPermiso => ({ grupo, codigo, nombre, descripcion });

export const CATALOGO_PERMISOS = [
  def('Panel', 'dashboard.ver', 'Ver dashboard y analítica', 'Indicadores, gráficos y consumo de químicos dentro de su ámbito.'),
  def('Panel', 'productividad.ver', 'Ver productividad', 'Comparativas de agencias y ranking de operarios.'),

  def('Agencias', 'agencias.ver', 'Ver agencias, bahías, regiones y clientes', 'Listados, detalle, resumen y desplegables dentro de su ámbito.'),
  def('Agencias', 'agencias.crear', 'Crear agencias', 'Registrar una agencia nueva.'),
  def('Agencias', 'agencias.editar', 'Editar agencias', 'Modificar datos de una agencia de su ámbito.'),
  def('Agencias', 'agencias.estado', 'Activar o desactivar agencias', 'Cambiar el estado de una agencia.'),
  def('Agencias', 'regiones.gestionar', 'Gestionar regiones', 'Crear, editar y activar regiones.'),
  def('Agencias', 'clientes.gestionar', 'Gestionar clientes', 'Crear, editar y activar clientes (marcas).'),
  def('Agencias', 'bahias.crear', 'Crear bahías', 'Registrar bahías nuevas.'),
  def('Agencias', 'bahias.editar', 'Editar bahías', 'Modificar y activar o desactivar bahías de su ámbito.'),
  def('Agencias', 'bahias.asignar', 'Asignar operadores a bahías', 'Asignar y desasignar operadores de una bahía de su ámbito.'),

  def('Usuarios', 'usuarios.ver', 'Ver usuarios', 'Listar usuarios y operadores de su ámbito (nombre, rol y estado).'),
  def('Usuarios', 'usuarios.gestionar', 'Gestionar usuarios', 'Crear, editar, activar, eliminar y asignar usuarios.'),
  def('Usuarios', 'operadores.gestionar', 'Gestionar operadores', 'Registrar y editar lavadores y pulidores.'),
  def('Usuarios', 'roles.ver', 'Ver roles', 'Consultar roles, módulos y permisos.'),
  def('Usuarios', 'roles.gestionar', 'Gestionar roles y permisos', 'Crear roles, editar sus permisos y ámbito, y eliminarlos.'),

  def('Servicios', 'servicios.ver', 'Ver servicios (OT)', 'Listado y detalle de servicios de lavado dentro de su ámbito.'),
  def('Servicios', 'servicios.crear', 'Registrar servicios (OT)', 'Crear órdenes de trabajo generales.'),
  def('Servicios', 'servicios.editar', 'Editar servicios (OT)', 'Modificar una orden de trabajo aún no aprobada.'),
  def('Servicios', 'servicios.anular', 'Anular servicios (OT)', 'Anular un servicio con motivo; queda registro de quién y por qué.'),
  def('Servicios', 'servicios.decidir', 'Aprobar y rechazar servicios', 'Aprobar, rechazar y aprobar todos. Regla de aprobador designado en el servicio.'),
  def('Servicios', 'consumos.ver', 'Ver consumo de insumos por servicio', 'Consumo de insumos de cada servicio.'),
  def('Servicios', 'solicitudes.ver', 'Ver solicitudes de aprobación', 'Listado de solicitudes de aprobación.'),
  def('Servicios', 'solicitudes.crear', 'Crear solicitudes de aprobación', 'Solicitar una aprobación.'),
  def('Servicios', 'especiales.ver', 'Ver servicios especiales', 'Listado y detalle de servicios especiales, pulidores y su stock.'),
  def('Servicios', 'especiales.crear', 'Crear servicios especiales', 'Registrar y asignar servicios especiales.'),
  def('Servicios', 'especiales.operar', 'Ejecutar servicios especiales', 'Iniciar, pausar, reanudar y completar (solo el pulidor asignado).'),
  def('Servicios', 'especiales.reasignar', 'Reasignar servicios especiales', 'Cambiar el pulidor asignado.'),
  def('Servicios', 'especiales.anular', 'Anular servicios especiales', 'Anular con motivo; nunca se borran.'),

  def('Catálogo', 'catalogo.ver', 'Ver catálogo de servicios', 'Consultar el catálogo dentro del alcance de su sede.'),
  def('Catálogo', 'catalogo.gestionar', 'Gestionar catálogo de servicios', 'Crear, editar y eliminar servicios del catálogo.'),
  def('Catálogo', 'recetas.ver', 'Ver recetas de insumos', 'Consultar la receta de cada servicio.'),
  def('Catálogo', 'recetas.gestionar', 'Gestionar recetas de insumos', 'Asignar y quitar insumos de una receta.'),
  def('Catálogo', 'recetas.historial', 'Ver historial de recetas', 'Consultar los cambios de las recetas.'),

  def('Retos', 'retos.ver', 'Ver retos', 'Consultar los retos visibles para su región o sede.'),
  def('Retos', 'retos.crear', 'Crear retos', 'Crear retos (un coordinador solo para su región).'),
  def('Retos', 'retos.eliminar', 'Eliminar retos', 'Eliminar retos propios (un administrador, cualquiera).'),

  def('Inventario', 'inventario.ver', 'Ver inventario', 'Stock, insumos, catálogos, movimientos y kardex dentro de su ámbito.'),
  def('Inventario', 'inventario.catalogos.gestionar', 'Gestionar catálogos de inventario', 'Insumos, envases, unidades, tipos, presentaciones y motivos.'),
  def('Inventario', 'bodegas.gestionar', 'Gestionar bodegas', 'Crear, editar, activar y eliminar bodegas.'),
  def('Inventario', 'stock.ajustar', 'Ajustar stock', 'Ajustes, reajustes y movimientos de stock.'),
  def('Inventario', 'stock.consumir', 'Registrar consumo de stock', 'Descontar insumos al registrar un servicio.'),
  def('Inventario', 'compras.registrar', 'Registrar compras', 'Ingresar compras a la bodega central.'),
  def('Inventario', 'despachos.ver', 'Ver despachos', 'Listado de despachos y pendientes dentro de su ámbito.'),
  def('Inventario', 'despachos.crear', 'Crear despachos', 'Enviar insumos a agencias, bodegas o pulidores.'),
  def('Inventario', 'despachos.recibir', 'Confirmar o rechazar recepciones', 'Confirmar o rechazar un despacho recibido.'),
  def('Inventario', 'alertas.ver', 'Ver alertas de stock', 'Alertas dentro de su ámbito.'),
  def('Inventario', 'alertas.crear', 'Crear alertas de stock', 'Emitir una alerta de desabastecimiento.'),
  def('Inventario', 'alertas.atender', 'Atender alertas de stock', 'Sincronizar y marcar alertas como atendidas.'),

  def('Maquinaria', 'maquinaria.ver', 'Ver maquinaria', 'Máquinas y talleres dentro de su ámbito.'),
  def('Maquinaria', 'maquinaria.crear', 'Crear máquinas', 'Dar de alta maquinaria.'),
  def('Maquinaria', 'maquinaria.editar', 'Editar y activar máquinas', 'Modificar datos de una máquina y activarla o desactivarla.'),
  def('Maquinaria', 'maquinaria.gestionar', 'Gestionar maquinaria', 'Asignar operador, programar trabajos, transferir y configurar ventanas.'),
  def('Maquinaria', 'maquinaria.trazabilidad', 'Ver trazabilidad de maquinaria', 'Historial y movimientos de una máquina.'),
  def('Maquinaria', 'incidentes.ver', 'Ver incidentes', 'Listado de incidentes.'),
  def('Maquinaria', 'incidentes.reportar', 'Reportar incidentes', 'Reportar una falla de una máquina.'),
  def('Maquinaria', 'incidentes.resolver', 'Resolver incidentes', 'Editar y resolver incidentes.'),
  def('Maquinaria', 'mantenimientos.ver', 'Ver mantenimientos', 'Listado de mantenimientos.'),
  def('Maquinaria', 'mantenimientos.ejecutar', 'Ejecutar mantenimientos', 'Ejecutar y editar mantenimientos asignados.'),
  def('Maquinaria', 'maquinaria.evidencias', 'Agregar evidencias de maquinaria', 'Subir fotos o videos a un incidente o mantenimiento.'),
  def('Maquinaria', 'checklist.gestionar', 'Gestionar plantillas de checklist', 'Definir los pasos de cada tipo de mantenimiento (preventivo o correctivo).'),

  def('Sistema', 'sync.usar', 'Usar la sincronización de la app', 'Sincronizar datos de la app móvil y registrar el dispositivo.'),
  def('Sistema', 'sync.dlq.gestionar', 'Gestionar errores de sincronización', 'Ver, resolver y reintentar los errores de todos los usuarios.'),
  def('Sistema', 'evidencias.subir', 'Subir evidencias', 'Subir fotos y videos de servicios.'),
  def('Sistema', 'evidencias.ver', 'Ver evidencias', 'Consultar fotos y videos dentro de su ámbito.'),
] as const satisfies readonly DefinicionPermiso[];

export type CodigoPermiso = (typeof CATALOGO_PERMISOS)[number]['codigo'];

export const CODIGOS_PERMISOS: readonly CodigoPermiso[] = CATALOGO_PERMISOS.map((p) => p.codigo);

const CODIGOS_SET = new Set<string>(CODIGOS_PERMISOS);
export const esCodigoPermiso = (codigo: string): codigo is CodigoPermiso => CODIGOS_SET.has(codigo);

/** Sobre qué datos actúa un rol. */
export const AMBITOS = ['GLOBAL', 'REGION', 'AGENCIA', 'PROPIO'] as const;
export type Ambito = (typeof AMBITOS)[number];
export const esAmbito = (v: unknown): v is Ambito => typeof v === 'string' && (AMBITOS as readonly string[]).includes(v);

/** Roles oficiales: no se pueden eliminar. SUPER_ADMIN además es inmutable. */
export const ROL_SUPER_ADMIN = 'SUPER_ADMIN';
