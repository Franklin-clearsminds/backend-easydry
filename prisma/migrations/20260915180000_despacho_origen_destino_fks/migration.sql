-- Tipo de despacho entre bodegas
DO $$ BEGIN
  ALTER TYPE "TipoMovimientoInv" ADD VALUE IF NOT EXISTS 'DESPACHO_BODEGA';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- FKs tipadas origen/destino en movimientos de despacho
ALTER TABLE "MovimientoInventario" ADD COLUMN IF NOT EXISTS "origenBodegaId" TEXT;
ALTER TABLE "MovimientoInventario" ADD COLUMN IF NOT EXISTS "origenAgenciaId" TEXT;
ALTER TABLE "MovimientoInventario" ADD COLUMN IF NOT EXISTS "destinoBodegaId" TEXT;
ALTER TABLE "MovimientoInventario" ADD COLUMN IF NOT EXISTS "destinoAgenciaId" TEXT;
ALTER TABLE "MovimientoInventario" ADD COLUMN IF NOT EXISTS "destinoPulidorId" TEXT;

CREATE INDEX IF NOT EXISTS "MovimientoInventario_origenBodegaId_idx" ON "MovimientoInventario"("origenBodegaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_origenAgenciaId_idx" ON "MovimientoInventario"("origenAgenciaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_destinoBodegaId_idx" ON "MovimientoInventario"("destinoBodegaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_destinoAgenciaId_idx" ON "MovimientoInventario"("destinoAgenciaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_destinoPulidorId_idx" ON "MovimientoInventario"("destinoPulidorId");
