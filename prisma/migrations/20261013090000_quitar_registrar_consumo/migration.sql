-- «Registrar consumo» nunca tuvo botón: el insumo se descuenta solo al terminar la OT. Se retiran la casilla y el permiso.
UPDATE "roles"
SET "capacidades" = array_remove(array_remove("capacidades", 'inventario.productos.consumir'), 'stock.consumir')
WHERE 'inventario.productos.consumir' = ANY("capacidades") OR 'stock.consumir' = ANY("capacidades");
