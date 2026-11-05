-- La página Inventario (que ahora ve el Coordinador de Mantenimiento) pide también ver el catálogo.
UPDATE "roles"
   SET "capacidades" = array_append("capacidades", 'catalogo.ver')
 WHERE "namerol" = 'COORD_MANTENIMIENTO'
   AND NOT ('catalogo.ver' = ANY ("capacidades"));
