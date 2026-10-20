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

import { esCodigoNuevo } from './catalogo-paginas.js';

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
  def('Panel', 'reportes.ver', 'Ver reportes operativos', 'Informes consolidados de servicios y rendimiento dentro de su ámbito.'),

  def('Agencias', 'agencias.ver', 'Ver agencias, bahías, regiones y clientes', 'Listados, detalle, resumen y desplegables dentro de su ámbito.'),
  def('Agencias', 'agencias.consultar', 'Ver la pantalla de Agencias', 'Consultar la información de cada agencia (datos, servicios, bahías y personal) sin poder editarla.'),
  def('Agencias', 'mapa.ver', 'Ver el Mapa Operativo', 'Ver las bahías de su ámbito y quién está asignado en cada una, sin poder asignar.'),
  def('Agencias', 'agencias.crear', 'Crear agencias', 'Registrar una agencia nueva.'),
  def('Agencias', 'agencias.transferir', 'Transferir agencias entre clientes', 'Cambiar el cliente al que pertenece una agencia.'),
  def('Agencias', 'regiones.transferir', 'Transferir agencias entre regiones', 'Cambiar la región a la que pertenece una agencia.'),
  def('Agencias', 'agencias.editar', 'Editar agencias', 'Modificar datos de una agencia de su ámbito.'),
  def('Agencias', 'agencias.estado', 'Activar o desactivar agencias', 'Cambiar el estado de una agencia.'),
  def('Agencias', 'regiones.gestionar', 'Gestionar regiones', 'Crear, editar y activar regiones.'),
  def('Agencias', 'clientes.gestionar', 'Gestionar clientes', 'Crear, editar y activar clientes (marcas).'),
  def('Agencias', 'bahias.editar', 'Editar bahías', 'Modificar y activar o desactivar bahías de su ámbito.'),
  def('Agencias', 'bahias.asignar', 'Asignar operadores a bahías', 'Asignar y desasignar operadores de una bahía de su ámbito.'),
  def('Agencias', 'agencias.precios.gestionar', 'Fijar precios por agencia', 'Fijar o editar el precio override de un servicio general para una agencia (solo ADMIN/SUPER_ADMIN).'),

  def('Usuarios', 'usuarios.ver', 'Ver usuarios', 'Listar usuarios y operadores de su ámbito (nombre, rol y estado).'),
  def('Usuarios', 'usuarios.gestionar', 'Gestionar usuarios', 'Crear, editar, activar, eliminar y asignar usuarios.'),
  def('Usuarios', 'backup.gestionar', 'Gestionar usuarios Backup', 'Crear usuarios Backup de su región y asignarlos temporalmente a una agencia.'),
  def('Usuarios', 'operadores.ver', 'Ver operadores', 'Ver los lavadores y pulidores fijos asignados a su agencia, con su bahía (solo lectura).'),
  def('Usuarios', 'operadores.gestionar', 'Gestionar operadores', 'Registrar y editar lavadores y pulidores.'),
  def('Usuarios', 'roles.ver', 'Ver roles', 'Consultar roles, módulos y permisos.'),
  def('Usuarios', 'roles.gestionar', 'Gestionar roles y permisos', 'Crear roles, editar sus permisos y ámbito, y eliminarlos.'),

  def('Servicios', 'servicios.ver', 'Ver servicios (OT)', 'Listado y detalle de servicios de lavado dentro de su ámbito.'),
  def('Servicios', 'servicios.crear', 'Registrar servicios (OT)', 'Crear órdenes de trabajo generales.'),
  def('Servicios', 'servicios.editar', 'Editar servicios (OT)', 'Corregir los datos del vehículo, el cliente y las observaciones de una orden de trabajo aún no aprobada.'),
  def('Servicios', 'servicios.finalizar', 'Finalizar servicios (OT)', 'Finalizar una orden de trabajo en proceso o en cola, con su evidencia.'),
  def('Servicios', 'servicios.anular', 'Anular servicios (OT)', 'Anular un servicio con motivo; queda registro de quién y por qué.'),
  def('Servicios', 'servicios.decidir', 'Aprobar y rechazar servicios', 'Aprobar, rechazar y aprobar todos. Regla de aprobador designado en el servicio.'),
  def('Servicios', 'consumos.ver', 'Ver consumo de insumos por servicio', 'Consumo de insumos de cada servicio.'),
  def('Servicios', 'solicitudes.ver', 'Ver solicitudes de aprobación', 'Listado de solicitudes de aprobación.'),
  def('Servicios', 'solicitudes.crear', 'Crear solicitudes de aprobación', 'Solicitar una aprobación.'),
  def('Servicios', 'especiales.ver', 'Ver servicios especiales', 'Listado y detalle de servicios especiales, pulidores y su stock.'),
  def('Servicios', 'especiales.crear', 'Crear servicios especiales', 'Registrar y asignar servicios especiales.'),
  def('Servicios', 'especiales.editar', 'Editar servicios especiales', 'Corregir los datos del vehículo, el cliente, la prioridad y las observaciones de un servicio especial que no está completado ni cancelado.'),
  def('Servicios', 'especiales.operar', 'Ejecutar servicios especiales', 'Iniciar, pausar y reanudar (solo el pulidor asignado).'),
  def('Servicios', 'especiales.finalizar', 'Finalizar servicios especiales', 'Completar un servicio especial con su video final y calificación (solo el pulidor asignado).'),
  def('Servicios', 'especiales.reasignar', 'Reasignar servicios especiales', 'Cambiar el pulidor asignado.'),
  def('Servicios', 'especiales.anular', 'Anular servicios especiales', 'Anular con motivo; nunca se borran.'),

  def('Catálogo', 'precios.ver', 'Ver precios y costos', 'Precios de servicios (catálogo, OT y agencia) y costos de insumos. Sin este permiso el servidor no los envía.'),
  def('Catálogo', 'catalogo.ver', 'Ver catálogo de servicios', 'Consultar el catálogo dentro del alcance de su sede.'),
  def('Catálogo', 'catalogo.gestionar', 'Gestionar catálogo de servicios', 'Crear, editar y eliminar servicios del catálogo.'),
  def('Catálogo', 'recetas.ver', 'Ver recetas de insumos', 'Consultar la receta de cada servicio.'),
  def('Catálogo', 'recetas.gestionar', 'Gestionar recetas de insumos', 'Asignar y quitar insumos de una receta.'),
  def('Catálogo', 'recetas.historial', 'Ver historial de recetas', 'Consultar los cambios de las recetas.'),

  def('Retos', 'retos.ver', 'Ver retos', 'Consultar los retos visibles para su región o sede.'),
  def('Retos', 'retos.crear', 'Crear retos', 'Crear retos (un coordinador solo para su región).'),
  def('Retos', 'retos.cerrar', 'Cerrar retos', 'Cerrar un reto registrando ganador y resultado.'),
  def('Retos', 'retos.eliminar', 'Eliminar retos', 'Eliminar retos propios (un administrador, cualquiera).'),

  def('Inventario', 'inventario.ver', 'Ver inventario', 'Stock, insumos, catálogos, movimientos y kardex dentro de su ámbito.'),
  def('Inventario', 'inventario.catalogos.gestionar', 'Gestionar catálogos de inventario', 'Insumos, envases, unidades, tipos, presentaciones y motivos.'),
  def('Inventario', 'bodegas.gestionar', 'Gestionar bodegas', 'Crear, editar, activar y eliminar bodegas.'),
  def('Inventario', 'stock.ajustar', 'Ajustar stock', 'Ajustes, reajustes y movimientos de stock.'),
  def('Inventario', 'compras.registrar', 'Registrar compras', 'Ingresar compras a la bodega central.'),
  def('Inventario', 'inventario.kits.ver', 'Ver kits de pulidores', 'Stock de insumos en el kit de cada pulidor (sección Pulidores del inventario).'),
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
  def('Maquinaria', 'maquinaria.evidencias', 'Subir evidencias de incidencias y mantenimiento', 'Adjuntar fotos, videos o documentos a una incidencia o mantenimiento.'),
  def('Maquinaria', 'limpiezas.evidencias', 'Subir evidencias de limpieza', 'Registrar fotos de limpieza de maquinaria. Este permiso es independiente de evidencias de servicios, incidencias y mantenimiento.'),
  def('Maquinaria', 'limpiezas.ver', 'Ver limpiezas de maquinaria', 'Auditoría de limpiezas registradas (fecha, quién y fotos) dentro de su ámbito.'),
  def('Maquinaria', 'limpiezas.editar', 'Editar o eliminar limpiezas', 'Corregir las observaciones o eliminar un registro de limpieza dentro de su ámbito.'),

  def('Auditorías', 'auditorias.ver', 'Ver el dashboard de auditorías', 'Indicadores de las inspecciones de su ámbito: estados, calificaciones y planes de acción.'),
  def('Auditorías', 'informes.ver', 'Ver informes de inspección', 'Listado y detalle de los informes de su ámbito. Quien no puede auditar solo ve los informes ya aprobados o cerrados de su agencia.'),
  def('Auditorías', 'informes.crear', 'Crear y editar informes de inspección', 'Hacer inspecciones: crear informes, editar sus borradores, registrar novedades, actividades y planes de acción, adjuntar evidencias y enviarlos a revisión.'),
  def('Auditorías', 'informes.firmar', 'Registrar observaciones y calificación del informe', 'Registrar las observaciones del jefe de taller y la calificación del servicio de un informe de inspección.'),
  def('Auditorías', 'informes.seguimiento', 'Dar seguimiento a los planes de acción', 'Actualizar el estado y la evidencia de cumplimiento de los planes de acción de un informe.'),
  def('Auditorías', 'informes.revisar', 'Revisar, aprobar, rechazar y cerrar informes', 'Decidir sobre los informes en revisión, reabrir los rechazados y cerrar los aprobados.'),
  def('Auditorías', 'informes.eliminar', 'Eliminar informes en borrador', 'Eliminar (con registro) un informe que aún es borrador.'),
  def('Auditorías', 'inspecciones.ver', 'Ver auditorías 5S', 'Resultados de las auditorías 5S de su ámbito. Quien no puede auditar solo ve las finalizadas de su agencia.'),
  def('Auditorías', 'inspecciones.crear', 'Hacer auditorías 5S', 'Crear auditorías 5S, evaluar los 20 criterios, registrar hallazgos y evidencias, y finalizarlas.'),
  def('Auditorías', 'inspecciones.acciones', 'Dar seguimiento a las acciones correctivas 5S', 'Actualizar el estado y la evidencia de corrección de las acciones correctivas de una auditoría 5S.'),
  def('Auditorías', 'inspecciones.verificar', 'Verificar y cerrar auditorías 5S', 'Verificar la corrección de una acción (única forma de cerrarla) y cerrar las auditorías finalizadas.'),
  def('Auditorías', 'inspecciones.eliminar', 'Eliminar auditorías 5S en borrador', 'Eliminar (con registro) una auditoría 5S que aún no se finalizó.'),

  def('Sistema', 'sync.usar', 'Usar la sincronización de la app', 'Sincronizar datos de la app móvil y registrar el dispositivo.'),
  def('Sistema', 'sync.dlq.gestionar', 'Gestionar errores de sincronización', 'Ver, resolver y reintentar los errores de todos los usuarios.'),
  def('Sistema', 'evidencias.subir', 'Subir evidencias de servicios', 'Subir fotos y videos de órdenes de servicios generales y especiales.'),
  def('Sistema', 'evidencias.ver', 'Ver evidencias', 'Consultar fotos y videos dentro de su ámbito.'),
] as const satisfies readonly DefinicionPermiso[];

export type CodigoPermiso = (typeof CATALOGO_PERMISOS)[number]['codigo'];

export const CODIGOS_PERMISOS: readonly CodigoPermiso[] = CATALOGO_PERMISOS.map((p) => p.codigo);

const CODIGOS_SET = new Set<string>(CODIGOS_PERMISOS);
/** Permiso clásico (el que exigen los endpoints) o código del catálogo de páginas (página, sub-página o acción). */
export const esCodigoPermiso = (codigo: string): boolean => CODIGOS_SET.has(codigo) || esCodigoNuevo(codigo);

/** Sobre qué datos actúa un rol. */
export const AMBITOS = ['GLOBAL', 'REGION', 'AGENCIA', 'PROPIO'] as const;
export type Ambito = (typeof AMBITOS)[number];
export const esAmbito = (v: unknown): v is Ambito => typeof v === 'string' && (AMBITOS as readonly string[]).includes(v);

/** Roles oficiales: no se pueden eliminar. SUPER_ADMIN además es inmutable. */
export const ROL_SUPER_ADMIN = 'SUPER_ADMIN';
