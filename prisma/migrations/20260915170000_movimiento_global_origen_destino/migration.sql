-- Origen / destino legibles en el Kardex (MovimientoInventarioGlobal)
ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "origenUbicacion" TEXT;
ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "destinoUbicacion" TEXT;

-- Etiquetas de tipo más claras en UI
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Ingreso' WHERE "codigo" = 'ENTRY';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Consumo' WHERE "codigo" = 'CONSUMPTION';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Ajuste (+)' WHERE "codigo" = 'POSITIVE_ADJUSTMENT';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Ajuste (−)' WHERE "codigo" = 'NEGATIVE_ADJUSTMENT';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Merma' WHERE "codigo" = 'WASTE';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Devolución' WHERE "codigo" = 'RETURN';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Envío / Transferencia' WHERE "codigo" = 'TRANSFER';
