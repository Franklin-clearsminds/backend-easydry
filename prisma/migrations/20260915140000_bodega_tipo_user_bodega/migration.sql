-- Tipo de bodega: CENTRAL (única nacional) | REGIONAL
DO $$ BEGIN
  CREATE TYPE "TipoBodega" AS ENUM ('CENTRAL', 'REGIONAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The Bodega model was added to the Prisma schema without a corresponding
-- CreateTable migration. Create the physical table before extending it.
CREATE TABLE IF NOT EXISTS "bodegas" (
  "id" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "ciudad" TEXT,
  "direccion" TEXT,
  "telefono" TEXT,
  "tipo" "TipoBodega" NOT NULL DEFAULT 'REGIONAL',
  "esCentral" BOOLEAN NOT NULL DEFAULT false,
  "activa" BOOLEAN NOT NULL DEFAULT true,
  "regionId" TEXT,
  "porcentajeAlerta" INTEGER NOT NULL DEFAULT 20,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "bodegas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "bodegas_codigo_key" ON "bodegas"("codigo");
CREATE INDEX IF NOT EXISTS "bodegas_activa_idx" ON "bodegas"("activa");
CREATE INDEX IF NOT EXISTS "bodegas_regionId_idx" ON "bodegas"("regionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bodegas_regionId_fkey'
  ) THEN
    ALTER TABLE "bodegas"
      ADD CONSTRAINT "bodegas_regionId_fkey"
      FOREIGN KEY ("regionId") REFERENCES "Region"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "bodegas" ADD COLUMN IF NOT EXISTS "tipo" "TipoBodega" NOT NULL DEFAULT 'REGIONAL';

-- Migrar flag legacy esCentral → tipo
UPDATE "bodegas" SET "tipo" = 'CENTRAL' WHERE "esCentral" = true;
UPDATE "bodegas" SET "esCentral" = true WHERE "tipo" = 'CENTRAL';
UPDATE "bodegas" SET "esCentral" = false WHERE "tipo" = 'REGIONAL';

-- Bodega CENTRAL puede no tener región
ALTER TABLE "bodegas" ALTER COLUMN "regionId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "bodegas_tipo_idx" ON "bodegas"("tipo");

-- Solo una bodega CENTRAL activa (índice único parcial)
CREATE UNIQUE INDEX IF NOT EXISTS "bodegas_unica_central_idx"
  ON "bodegas" ("tipo")
  WHERE "tipo" = 'CENTRAL' AND "activa" = true;

-- User.bodegaId para asistentes de bodega (tabla Prisma = "User")
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "bodegaId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'User_bodegaId_fkey'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_bodegaId_fkey"
      FOREIGN KEY ("bodegaId") REFERENCES "bodegas"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "User_bodegaId_idx" ON "User"("bodegaId");
