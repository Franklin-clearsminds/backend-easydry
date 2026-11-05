-- Los coordinadores (Servicios Especiales, Mantenimiento y Comercial) ven, solo lectura, el inventario de insumos de las agencias y los
-- kits de los pulidores de su región (el alcance lo resuelve el servidor); el Jefe Comercial lo ve de todo el país, con precios.

-- Coordinadores de Servicios Especiales y de Mantenimiento: inventario completo en solo lectura.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY[
           'inventario.ver', 'inventario.kits.ver', 'pagina.inventario', 'pagina.inventario.productos', 'pagina.inventario.bodegas',
           'pagina.inventario.agencias', 'pagina.inventario.pulidores', 'pagina.inventario.stock-bajo',
           'pagina.inventario.movimientos', 'pagina.inventario.configuracion'
         ]) AS c WHERE NOT (c = ANY (r."capacidades"))),
       "permisos" = CASE WHEN 'inventario' = ANY (r."permisos") THEN r."permisos" ELSE array_append(r."permisos", 'inventario') END
 WHERE r."namerol" IN ('COORD_SERVICIOS_ESPECIALES', 'COORD_MANTENIMIENTO');

-- Coordinador Comercial y Jefe Comercial: ya veían inventario; ahora también los kits de los pulidores.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['inventario.kits.ver', 'pagina.inventario.pulidores']) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" IN ('COORD_COMERCIAL', 'JEFE_COMERCIAL');

-- Jefe Comercial: ahora ve precios.
UPDATE "roles"
   SET "capacidades" = array_append("capacidades", 'precios.ver'),
       "descripcion" = replace("descripcion", 'solo lectura, sin precios', 'solo lectura, con precios')
 WHERE "namerol" = 'JEFE_COMERCIAL'
   AND NOT ('precios.ver' = ANY ("capacidades"));
