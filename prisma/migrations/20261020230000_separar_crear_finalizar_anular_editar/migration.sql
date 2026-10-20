-- Servicios: registrar, finalizar, anular y editar son casillas distintas, en generales y en especiales.
-- Registrar OT ya no incluye finalizar, y completar un servicio especial deja de ser parte de «Ejecutar».
-- Quien ya podía completar servicios especiales (tenía «Ejecutar») recibe «Finalizar OT especial» para no perder nada.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['servicios.especiales.finalizar', 'especiales.finalizar']))
WHERE 'servicios.especiales.operar' = ANY("capacidades")
  AND 'pagina.servicios.especiales' = ANY("capacidades");
