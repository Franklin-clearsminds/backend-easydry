ALTER TABLE "Reto"
ADD COLUMN "catalogoServicioIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN "tipoReto" TEXT NOT NULL DEFAULT 'AGENCIA',
ADD COLUMN "pulidoresIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Reto"
SET "catalogoServicioIds" = ARRAY["catalogoServicioId"]
WHERE "catalogoServicioId" IS NOT NULL;

CREATE INDEX "ServicioEspecial_operadorId_estado_fechaFin_idx"
ON "ServicioEspecial"("operadorId", "estado", "fechaFin");
