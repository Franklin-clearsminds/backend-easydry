/**
 * Casillas que el servidor NO puede exigir por sí solas, con el motivo. A diferencia de la línea base (deuda que debe llegar a cero),
 * esto es una decisión permanente y razonada: el dato de la casilla viaja dentro de una respuesta que la misma pantalla u otras
 * comparten, así que separarlo en el servidor rompería esas otras pantallas. Esas casillas sí se exigen en la pantalla.
 * Si algún día un endpoint pasa a exigirla, se borra de aquí.
 */
export const EXCEPCIONES_SERVIDOR: Record<string, string> = {
  'pagina.agencias.mapa':
    'La pestaña Mapa muestra agencias, bahías y lavadores, datos que otras pantallas piden por los mismos endpoints (agencias/list, bahias/list). Se oculta en pantalla.',
  'mapa.lavador.ver':
    'El lavador asignado viaja dentro de bahias/list, respuesta que también usan Servicios y Lavadores. Se oculta en el bloque del mapa.',
  'mapa.vehiculo.ver':
    'El vehículo en servicio (placa y OT) viaja como «ocupada» dentro de bahias/list, que Servicios usa para validar bahías ocupadas. Se oculta en el bloque del mapa.',
  'mapa.maquinaria.ver':
    "Los datos salen de maquinaria/list, que el servidor ya exige con 'maquinaria.ver', permiso que esta casilla otorga: apagarla quita ese acceso.",
  'operadores.ficha.ver':
    'La ficha y la productividad salen del mismo listado operadores/list que la tabla de lavadores, que exigen usuarios.ver u operadores.ver. Se oculta el botón y la columna en pantalla.',
  'pagina.agencias.agencias':
    'Es la pestaña principal: sus listados (agencias/list, bahias/list…) alimentan los desplegables de muchas pantallas y los exige el permiso de la página. Sus botones sí se exigen uno a uno.',
};
