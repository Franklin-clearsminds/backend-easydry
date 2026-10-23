-- Costo congelado de cada consumo de insumos (unidad base y total): cambiar luego el precio del insumo no altera lo que costó el servicio.
ALTER TABLE "ConsumoServicio" ADD COLUMN IF NOT EXISTS "costoUnitarioUSD" DECIMAL(14,6);
ALTER TABLE "ConsumoServicio" ADD COLUMN IF NOT EXISTS "costoTotalUSD" DECIMAL(12,4);
ALTER TABLE "ConsumoServicioEspecial" ADD COLUMN IF NOT EXISTS "costoUnitarioUSD" DECIMAL(14,6);
ALTER TABLE "ConsumoServicioEspecial" ADD COLUMN IF NOT EXISTS "costoTotalUSD" DECIMAL(12,4);
