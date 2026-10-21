/**
 * Casillas que el servidor NO puede exigir por sí solas, con el motivo. A diferencia de la línea base (deuda que debe llegar a cero),
 * esto es una decisión permanente y razonada: el dato de la casilla viaja dentro de una respuesta que la misma pantalla u otras
 * comparten, así que separarlo en el servidor rompería esas otras pantallas. Esas casillas sí se exigen en la pantalla.
 * Si algún día un endpoint pasa a exigirla, se borra de aquí.
 */
export const EXCEPCIONES_SERVIDOR: Record<string, string> = {
  'dashboard.alertas.ver':
    "El listado de alertas (alertas/list) lo comparten el Dashboard y la pestaña Alertas de Inventario: lo exige 'alertas.ver', que esta casilla otorga. Se oculta el bloque en pantalla.",
  'agencias.personal.ver':
    "El personal sale de usuarios/list, que usan muchas pantallas y exige 'usuarios.ver' (que esta casilla otorga). Se oculta en la ficha de la agencia.",
  'evidencias.ver':
    'Las fotos y videos se piden por /storage/presigned-url, que revisa este permiso (o el de la página dueña de la evidencia) en el controlador de almacenamiento.',
  'pagina.catalogo.generales':
    'El listado de servicios generales alimenta desplegables de Servicios, Agencias y Retos con los mismos endpoints. Se oculta la pestaña; cada botón sí se exige.',
  'pagina.catalogo.especiales':
    'El listado de servicios especiales alimenta desplegables de Servicios y Agencias con los mismos endpoints. Se oculta la pestaña; cada botón sí se exige.',
  'pagina.inventario.productos':
    'Productos, bodegas, agencias, movimientos y configuración comparten sus listados con los desplegables de despachos, envíos y alertas. Se oculta la pestaña; cada botón sí se exige.',
  'pagina.inventario.bodegas': 'Las bodegas alimentan los destinos de despacho y envío: los listados son compartidos. Se oculta la pestaña; cada botón sí se exige.',
  'pagina.inventario.agencias': 'Las agencias alimentan los destinos de despacho y envío: los listados son compartidos. Se oculta la pestaña; cada botón sí se exige.',
  'pagina.inventario.movimientos': 'El kardex y los movimientos se acotan por el ámbito del rol dentro del servicio, no por esta casilla. Se oculta la pestaña.',
  'pagina.inventario.configuracion': 'Los tipos, unidades y presentaciones se leen desde los formularios de insumos. Se oculta la pestaña; crear o editar sí se exige.',
  'pagina.agencias.mapa':
    'La pestaña Mapa muestra agencias, bahías y lavadores, datos que otras pantallas piden por los mismos endpoints (agencias/list, bahias/list). Se oculta en pantalla.',
  'mapa.lavador.ver':
    'El lavador asignado viaja dentro de bahias/list, respuesta que también usan Servicios y Lavadores. Se oculta en el bloque del mapa.',
  'mapa.vehiculo.ver':
    'El vehículo en servicio (placa y OT) viaja como «ocupada» dentro de bahias/list, que Servicios usa para validar bahías ocupadas. Se oculta en el bloque del mapa.',
  'pagina.agencias.agencias':
    'Es la pestaña principal: sus listados (agencias/list, bahias/list…) alimentan los desplegables de muchas pantallas y los exige el permiso de la página. Sus botones sí se exigen uno a uno.',
};

/**
 * Casillas que ninguna pantalla puede usar por su cuenta, con el motivo. Mismo criterio: decisión razonada y permanente, a diferencia
 * de la línea base. Si una pantalla pasa a usarla, se borra de aquí.
 */
export const EXCEPCIONES_PANTALLA: Record<string, string> = {
  'precios.ver': 'El servidor retira los precios de la respuesta (interceptor) a quien no tiene esta casilla: la pantalla muestra lo que llega, sin consultarla.',
  'datos.cedula.ver': 'El servidor omite la cédula del personal en la respuesta si falta la casilla: la pantalla muestra lo que llega.',
  'datos.contacto.ver': 'El servidor omite correo y teléfono del personal en la respuesta si falta la casilla: la pantalla muestra lo que llega.',
  'evidencias.ver': 'Las fotos y videos se piden por URL prefirmada y el servidor decide si se entrega: la pantalla muestra el estado «sin permiso».',
  'evidencias.subir': 'La subida de archivos la valida el servidor (storage/upload-permissions); cada pantalla oculta su botón con su propia casilla de evidencias (las de reportar o resolver incidente, ejecutar mantenimiento y registrar limpieza).',
  'sistema.sync.usar': 'La sincronización no tiene botón: la app la usa en segundo plano y el servidor la rechaza si falta la casilla.',
  'sistema.sync.errores': 'La cola de errores de sincronización se gestiona desde soporte, sin pantalla propia: el servidor la exige.',
};
