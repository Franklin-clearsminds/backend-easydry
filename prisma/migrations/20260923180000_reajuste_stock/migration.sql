-- Reajuste de stock: auditoría (quién, cuándo, por qué) + evidencia fotográfica
ALTER TABLE "MovimientoInventarioGlobal"
  ADD COLUMN IF NOT EXISTS "evidenciasUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "stockUbicacionId" TEXT,
  ADD COLUMN IF NOT EXISTS "cantidadContada" DECIMAL(12,4);
