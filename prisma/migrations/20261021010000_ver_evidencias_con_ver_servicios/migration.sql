-- «Ver evidencias» deja de ser una casilla aparte en Servicios: con la pestaña de servicios generales o especiales activa se ven las
-- evidencias (fotos y videos de inicio y fin). Quien tenga una de esas pestañas recibe el permiso de ver evidencias.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['evidencias.ver']))
WHERE "capacidades" && ARRAY['pagina.servicios.generales', 'pagina.servicios.especiales'];
