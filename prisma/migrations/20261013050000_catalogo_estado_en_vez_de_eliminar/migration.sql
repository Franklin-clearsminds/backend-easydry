-- Los servicios del catálogo ya no se eliminan: se activan o desactivan. La casilla «eliminar» pasa a «estado».
UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT DISTINCT CASE c
    WHEN 'catalogo.generales.eliminar' THEN 'catalogo.generales.estado'
    WHEN 'catalogo.especiales.eliminar' THEN 'catalogo.especiales.estado'
    ELSE c END
  FROM unnest("capacidades") AS c
)
WHERE 'catalogo.generales.eliminar' = ANY("capacidades") OR 'catalogo.especiales.eliminar' = ANY("capacidades");
