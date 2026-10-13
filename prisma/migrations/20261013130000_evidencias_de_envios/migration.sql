-- Evidencias (fotos opcionales) de la recepción, el rechazo y la resolución de faltantes de un envío.
CREATE TABLE "EnvioEvidencia" (
  "id" TEXT NOT NULL,
  "movimientoId" TEXT NOT NULL,
  "faltanteId" TEXT,
  "etapa" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "usuarioId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EnvioEvidencia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EnvioEvidencia_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "MovimientoInventario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EnvioEvidencia_movimientoId_idx" ON "EnvioEvidencia"("movimientoId");
CREATE INDEX "EnvioEvidencia_faltanteId_idx" ON "EnvioEvidencia"("faltanteId");
