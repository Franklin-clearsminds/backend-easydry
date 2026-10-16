-- Verificación semanal del archivo histórico: cuándo se comprobó cada lote y qué problema se encontró.
ALTER TABLE "archivado_lotes" ADD COLUMN "verificadoEn" TIMESTAMP(3), ADD COLUMN "problema" TEXT;
