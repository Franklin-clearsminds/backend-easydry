-- «Editar reto» vuelve como casilla propia (título, descripción, premio y vigencia de un reto activo).
-- Quien ya podía cerrar retos la recibe, para que nadie pierda lo que hacía; después se puede quitar desde Roles y Permisos.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['productividad.retos.editar', 'retos.editar']))
WHERE 'productividad.retos.cerrar' = ANY("capacidades");
