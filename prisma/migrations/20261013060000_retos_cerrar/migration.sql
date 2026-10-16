-- «Editar reto» nunca existió como botón: lo que hacía era cerrar el reto. Pasa a ser «Cerrar reto» con permiso propio.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['retos.cerrar']))
WHERE 'retos.crear' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT CASE c WHEN 'productividad.retos.editar' THEN 'productividad.retos.cerrar' ELSE c END
  FROM unnest("capacidades") AS c
)
WHERE 'productividad.retos.editar' = ANY("capacidades");
