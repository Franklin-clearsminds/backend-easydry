-- Bitácora de exportaciones de Reportes Operativos (solo la consultan ADMIN y SUPER_ADMIN).
CREATE TABLE "exportaciones_reporte" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "usuarioNombre" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "reporte" TEXT NOT NULL,
    "formato" TEXT NOT NULL,
    "filtros" JSONB,
    "totalFilas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exportaciones_reporte_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "exportaciones_reporte_usuarioId_idx" ON "exportaciones_reporte"("usuarioId");
CREATE INDEX "exportaciones_reporte_reporte_idx" ON "exportaciones_reporte"("reporte");
CREATE INDEX "exportaciones_reporte_createdAt_idx" ON "exportaciones_reporte"("createdAt");
