-- El super admin pidió que, además de admin/super admin/supervisor/coordinador de mantenimiento/
-- coordinador de servicios especiales, también puedan AUDITAR (solo ver, no registrar) las limpiezas
-- de maquinaria el coordinador de bodega (insumos) y el coordinador comercial. Se agrega solo si no
-- lo tenían ya, sin tocar el resto de permisos que el Super Admin haya ajustado desde la plataforma.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'limpiezas.ver')
WHERE "namerol" IN ('COORD_BODEGA', 'COORD_COMERCIAL')
  AND NOT ('limpiezas.ver' = ANY("capacidades"));

-- La auditoría de limpiezas vive como pestaña dentro de "Taller Técnico": sin el módulo, aunque
-- tengan el permiso, no hay desde dónde navegar a verla. El coordinador de servicios especiales ya
-- tenía 'limpiezas.ver' pero le faltaba este módulo (gap previo, mismo arreglo).
UPDATE "roles"
SET "permisos" = array_append("permisos", 'taller-tecnico')
WHERE "namerol" IN ('COORD_BODEGA', 'COORD_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES')
  AND NOT ('taller-tecnico' = ANY("permisos"));
