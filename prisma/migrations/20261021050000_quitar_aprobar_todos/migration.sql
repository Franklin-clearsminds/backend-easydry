-- «Aprobar todos» (cierre masivo del día) deja de existir: se retira su casilla de los roles que la tenían guardada.
UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'aprobaciones.aprobar.todos')
WHERE 'aprobaciones.aprobar.todos' = ANY("capacidades");
