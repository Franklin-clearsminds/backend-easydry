-- Stock por bodega física (CENTRAL / REGIONAL)
ALTER TABLE "StockUbicacion" ADD COLUMN IF NOT EXISTS "bodegaId" TEXT;

CREATE INDEX IF NOT EXISTS "StockUbicacion_bodegaId_idx" ON "StockUbicacion"("bodegaId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StockUbicacion_bodegaId_fkey'
  ) THEN
    ALTER TABLE "StockUbicacion"
      ADD CONSTRAINT "StockUbicacion_bodegaId_fkey"
      FOREIGN KEY ("bodegaId") REFERENCES "bodegas"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Vincular stock legado BODEGA_CENTRAL a la bodega CENTRAL existente
UPDATE "StockUbicacion" s
SET "bodegaId" = b."id"
FROM "bodegas" b
WHERE s."tipoUbicacion" = 'BODEGA_CENTRAL'
  AND s."bodegaId" IS NULL
  AND (b."tipo" = 'CENTRAL' OR b."esCentral" = true);
