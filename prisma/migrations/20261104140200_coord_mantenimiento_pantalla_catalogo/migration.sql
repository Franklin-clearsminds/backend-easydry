-- Con «catalogo.ver» (que pide la página Inventario) el Coordinador de Mantenimiento también ve la pantalla del catálogo de servicios.
UPDATE "roles"
   SET "permisos" = array_append("permisos", 'configuracion/servicios')
 WHERE "namerol" = 'COORD_MANTENIMIENTO'
   AND NOT ('configuracion/servicios' = ANY ("permisos"));
