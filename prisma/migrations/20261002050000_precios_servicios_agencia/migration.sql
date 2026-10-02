-- Precio override por agencia de un servicio GENERAL del catálogo (lo fija ADMIN/SUPER_ADMIN desde
-- Sucursales); sin registro aquí rige el precio global de CatalogoServicio.precio. Los ESPECIAL no
-- tienen override: usan directamente el precio del catálogo. En ambos casos el precio efectivo se
-- congela en la OT al crearla (ServicioLavado.precio / ServicioEspecial.precio).

-- AlterTable
ALTER TABLE "ServicioLavado" ADD COLUMN     "precio" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ServicioEspecial" ADD COLUMN     "precio" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "PrecioAgenciaServicio" (
    "id" TEXT NOT NULL,
    "agenciaId" TEXT NOT NULL,
    "catalogoServicioId" INTEGER NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrecioAgenciaServicio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrecioAgenciaServicio_agenciaId_catalogoServicioId_key" ON "PrecioAgenciaServicio"("agenciaId", "catalogoServicioId");
CREATE INDEX "PrecioAgenciaServicio_agenciaId_idx" ON "PrecioAgenciaServicio"("agenciaId");
CREATE INDEX "PrecioAgenciaServicio_catalogoServicioId_idx" ON "PrecioAgenciaServicio"("catalogoServicioId");

ALTER TABLE "PrecioAgenciaServicio" ADD CONSTRAINT "PrecioAgenciaServicio_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrecioAgenciaServicio" ADD CONSTRAINT "PrecioAgenciaServicio_catalogoServicioId_fkey" FOREIGN KEY ("catalogoServicioId") REFERENCES "CatalogoServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
