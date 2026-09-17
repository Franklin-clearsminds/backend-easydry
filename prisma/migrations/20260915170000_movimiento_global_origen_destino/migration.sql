-- These tables were added to the datamodel before their CreateTable migration.
-- Keep this migration safe on both legacy and clean databases.
DO $$
BEGIN
  IF to_regclass('"MovimientoInventarioGlobal"') IS NOT NULL THEN
    ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "origenUbicacion" TEXT;
    ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "destinoUbicacion" TEXT;
  END IF;
END $$;

-- Etiquetas de tipo más claras en UI
DO $$
BEGIN
IF to_regclass('"TipoMovimientoInventario"') IS NOT NULL THEN
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Ingreso' WHERE "codigo" = 'ENTRY';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Consumo' WHERE "codigo" = 'CONSUMPTION';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Ajuste (+)' WHERE "codigo" = 'POSITIVE_ADJUSTMENT';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Ajuste (−)' WHERE "codigo" = 'NEGATIVE_ADJUSTMENT';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Merma' WHERE "codigo" = 'WASTE';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Devolución' WHERE "codigo" = 'RETURN';
UPDATE "TipoMovimientoInventario" SET "nombre" = 'Envío / Transferencia' WHERE "codigo" = 'TRANSFER';
END IF;
END $$;
