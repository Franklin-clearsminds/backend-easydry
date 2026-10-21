-- Despachar y reajustar stock eran una casilla por pestaña de Inventario (productos, bodegas, agencias, kits, stock bajo).
-- Ahora son dos casillas compartidas: «inventario.despachar» e «inventario.reajustar». Quien tenía alguna de las viejas conserva el permiso.

UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT DISTINCT unnest(
    array_remove(array_remove(array_remove(array_remove(array_remove("capacidades",
      'inventario.productos.despachar'), 'inventario.bodegas.despachar'), 'inventario.agencias.despachar'),
      'inventario.pulidores.despachar'), 'inventario.stockbajo.despachar') || ARRAY['inventario.despachar']
  )
)
WHERE "capacidades" && ARRAY['inventario.productos.despachar', 'inventario.bodegas.despachar', 'inventario.agencias.despachar', 'inventario.pulidores.despachar', 'inventario.stockbajo.despachar'];

UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT DISTINCT unnest(
    array_remove(array_remove(array_remove("capacidades",
      'inventario.bodegas.reajustar'), 'inventario.agencias.reajustar'), 'inventario.pulidores.reajustar') || ARRAY['inventario.reajustar']
  )
)
WHERE "capacidades" && ARRAY['inventario.bodegas.reajustar', 'inventario.agencias.reajustar', 'inventario.pulidores.reajustar'];
