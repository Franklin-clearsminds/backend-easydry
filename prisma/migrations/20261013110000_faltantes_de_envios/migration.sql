-- Lo que no llega en una recepción parcial queda retenido hasta que la bodega de origen decida: devolverlo al stock o darlo de baja.
CREATE TABLE "FaltanteDespacho" (
  "id" TEXT NOT NULL,
  "movimientoId" TEXT NOT NULL,
  "numeroGuia" TEXT NOT NULL,
  "insumoId" TEXT NOT NULL,
  "cantidadUnd" DECIMAL(10,3) NOT NULL,
  "cantidadBase" DECIMAL(12,4) NOT NULL,
  "origenBodegaId" TEXT,
  "origenAgenciaId" TEXT,
  "motivoRecepcion" TEXT,
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
  "resolucion" TEXT,
  "observacionResolucion" TEXT,
  "resueltoPorId" TEXT,
  "resueltoEn" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FaltanteDespacho_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FaltanteDespacho_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "MovimientoInventario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FaltanteDespacho_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "FaltanteDespacho_estado_idx" ON "FaltanteDespacho"("estado");
CREATE INDEX "FaltanteDespacho_movimientoId_idx" ON "FaltanteDespacho"("movimientoId");

-- Quien puede despachar puede resolver los faltantes de sus envíos.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['envios.faltantes']))
WHERE 'envios.crear' = ANY("capacidades");
