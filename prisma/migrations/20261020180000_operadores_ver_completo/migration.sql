-- Gestión de Lavadores: «Ver ficha y productividad», «Ver cédula» y «Ver correo y teléfono» se unifican en «Ver lavadores completo».
-- Quien ya veía la ficha recibe también la cédula y el correo y teléfono. Las casillas de datos siguen existiendo en las demás pantallas.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['datos.cedula.ver', 'datos.contacto.ver']))
WHERE 'operadores.ficha.ver' = ANY("capacidades");
