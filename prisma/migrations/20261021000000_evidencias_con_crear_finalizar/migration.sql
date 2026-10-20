-- «Subir evidencias» deja de ser una casilla aparte en Servicios: va con registrar, agregar, finalizar (y, en especiales, ejecutar),
-- porque no se puede finalizar sin evidencia. Quien tenga alguna de esas casillas recibe el permiso de subir archivos.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['evidencias.subir']))
WHERE "capacidades" && ARRAY[
  'servicios.generales.crear', 'servicios.generales.agregar', 'servicios.generales.finalizar',
  'servicios.especiales.crear', 'servicios.especiales.operar', 'servicios.especiales.finalizar'
];
