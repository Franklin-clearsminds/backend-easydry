-- El líder de agencia (y su reemplazo BACKUP y el auxiliar, que copian sus permisos) trabaja con cantidades: no ve precios ni costos.
-- Sin `precios.ver` el servidor retira el dinero de inventario, catálogo y dashboards.
UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'precios.ver')
WHERE "namerol" IN ('LIDER', 'BACKUP', 'AUXILIAR')
  AND 'precios.ver' = ANY("capacidades");
