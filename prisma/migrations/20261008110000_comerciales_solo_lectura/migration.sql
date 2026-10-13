-- Permisos nuevos:
--   precios.ver          precios de servicios (catálogo, OT, agencia) y costos de insumos. Sin él el servidor no los envía.
--   inventario.kits.ver  stock de los kits de pulidores (sección Pulidores del inventario).
--   agencias.consultar   pantalla de Agencias en solo lectura.
--   mapa.ver             Mapa Operativo en solo lectura.
-- Todos los roles con permisos conservan lo que ya veían (precios y kits); los comerciales pasan a consultar en solo
-- lectura, dentro de su ámbito, sin precios ni costos.

-- 1. Kits: quien ya veía inventario conserva los kits (antes de dar inventario a los comerciales).
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'inventario.kits.ver')
WHERE 'inventario.ver' = ANY("capacidades")
  AND "namerol" NOT IN ('COORD_COMERCIAL', 'JEFE_COMERCIAL')
  AND NOT ('inventario.kits.ver' = ANY("capacidades"));

-- 2. Precios: todos los roles que usan la plataforma, salvo los comerciales.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'precios.ver')
WHERE COALESCE(array_length("capacidades", 1), 0) > 0
  AND "namerol" NOT IN ('COORD_COMERCIAL', 'JEFE_COMERCIAL')
  AND NOT ('precios.ver' = ANY("capacidades"));

-- 3. Comerciales: consulta en solo lectura.
UPDATE "roles" r
SET "capacidades" = r."capacidades" || ARRAY(
  SELECT p FROM unnest(ARRAY['especiales.ver', 'operadores.ver', 'agencias.consultar', 'mapa.ver', 'inventario.ver', 'despachos.ver']) AS p
  WHERE NOT (p = ANY(r."capacidades"))
)
WHERE r."namerol" IN ('COORD_COMERCIAL', 'JEFE_COMERCIAL');
