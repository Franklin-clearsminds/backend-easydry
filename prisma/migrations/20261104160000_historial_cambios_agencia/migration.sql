-- Historial de cambios de agencia (con fecha y hora, quién y por qué) y motivo de salida en el historial de bahías.
ALTER TABLE "HistorialAsignacionBahia" ADD COLUMN "motivoFin" TEXT;

CREATE TABLE "HistorialCambioAgencia" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "agenciaOrigenId" TEXT,
    "agenciaOrigenNombre" TEXT,
    "agenciaDestinoId" TEXT,
    "agenciaDestinoNombre" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'CAMBIO',
    "motivo" TEXT NOT NULL,
    "realizadoPorId" TEXT,
    "realizadoPorNombre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialCambioAgencia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HistorialCambioAgencia_usuarioId_idx" ON "HistorialCambioAgencia"("usuarioId");
CREATE INDEX "HistorialCambioAgencia_createdAt_idx" ON "HistorialCambioAgencia"("createdAt");
CREATE INDEX "HistorialCambioAgencia_realizadoPorId_idx" ON "HistorialCambioAgencia"("realizadoPorId");

ALTER TABLE "HistorialCambioAgencia" ADD CONSTRAINT "HistorialCambioAgencia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistorialCambioAgencia" ADD CONSTRAINT "HistorialCambioAgencia_realizadoPorId_fkey" FOREIGN KEY ("realizadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
