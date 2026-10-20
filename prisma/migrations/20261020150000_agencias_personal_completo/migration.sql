-- «Ver personal de la agencia», «Ver cédula» y «Ver correo y teléfono» se unifican en la pestaña Agencias: «Ver personal completo de la agencia».
-- Quien ya veía el personal de la agencia recibe también la cédula y el correo y teléfono. Las casillas de datos siguen existiendo en las demás pantallas.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['datos.cedula.ver', 'datos.contacto.ver']))
WHERE 'agencias.personal.ver' = ANY("capacidades");
