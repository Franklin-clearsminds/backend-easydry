-- CreateEnum
CREATE TYPE "TipoCambioReceta" AS ENUM ('AGREGADO', 'MODIFICADO', 'ELIMINADO');

-- AlterTable
ALTER TABLE "ConsumoServicio" ADD COLUMN     "insumoNombre" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "insumoSKU" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "unidadSimbolo" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Insumo" ADD COLUMN     "stockOptimoAgencia" DECIMAL(10,2) DEFAULT 5.0;

-- AlterTable
ALTER TABLE "ServicioEspecial" ADD COLUMN     "cliente" TEXT,
ADD COLUMN     "creadoPorId" TEXT,
ADD COLUMN     "creadoPorNombre" TEXT,
ADD COLUMN     "evidenciasPausa" JSONB,
ADD COLUMN     "fechaUltimaPausa" TIMESTAMP(3),
ADD COLUMN     "fotosPausaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "historialPausas" JSONB,
ADD COLUMN     "horaIngreso" TEXT,
ADD COLUMN     "motivoUltimaPausa" TEXT,
ADD COLUMN     "ordenTrabajoOT" TEXT,
ADD COLUMN     "servicioCatalogoId" INTEGER,
ADD COLUMN     "tiempoEfectivoSeg" INTEGER,
ADD COLUMN     "tiempoPausaTotalSeg" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "videoPausaUrl" TEXT,
ADD COLUMN     "videoReanudacionUrl" TEXT,
ADD COLUMN     "videoUltimaPausaUrl" TEXT,
ADD COLUMN     "videoUltimaReanudacionUrl" TEXT;

-- AlterTable
ALTER TABLE "ServicioLavado" ADD COLUMN     "marca" TEXT,
ADD COLUMN     "ordenTrabajoOT" TEXT,
ADD COLUMN     "videoFinalUrl" TEXT,
ADD COLUMN     "videoInicialUrl" TEXT;

-- CreateTable
CREATE TABLE "ConsumoServicioEspecial" (
    "id" TEXT NOT NULL,
    "servicioEspecialId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidadUsada" DECIMAL(10,4) NOT NULL,
    "pulidorId" TEXT NOT NULL,
    "insumoNombre" TEXT NOT NULL DEFAULT '',
    "insumoSKU" TEXT NOT NULL DEFAULT '',
    "unidadSimbolo" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumoServicioEspecial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecetaInsumoHistorial" (
    "id" TEXT NOT NULL,
    "catalogoServicioId" INTEGER NOT NULL,
    "loteId" TEXT NOT NULL,
    "tipoCambio" "TipoCambioReceta" NOT NULL,
    "insumoId" TEXT NOT NULL,
    "insumoNombre" TEXT NOT NULL,
    "insumoSKU" TEXT NOT NULL,
    "unidadSimbolo" TEXT NOT NULL,
    "cantidadAnterior" DECIMAL(10,4),
    "cantidadNueva" DECIMAL(10,4),
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecetaInsumoHistorial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumoServicioEspecial_servicioEspecialId_idx" ON "ConsumoServicioEspecial"("servicioEspecialId");

-- CreateIndex
CREATE INDEX "ConsumoServicioEspecial_insumoId_idx" ON "ConsumoServicioEspecial"("insumoId");

-- CreateIndex
CREATE INDEX "ConsumoServicioEspecial_pulidorId_idx" ON "ConsumoServicioEspecial"("pulidorId");

-- CreateIndex
CREATE INDEX "RecetaInsumoHistorial_catalogoServicioId_idx" ON "RecetaInsumoHistorial"("catalogoServicioId");

-- CreateIndex
CREATE INDEX "RecetaInsumoHistorial_loteId_idx" ON "RecetaInsumoHistorial"("loteId");

-- CreateIndex
CREATE INDEX "ServicioEspecial_ordenTrabajoOT_idx" ON "ServicioEspecial"("ordenTrabajoOT");

-- CreateIndex
CREATE INDEX "ServicioLavado_ordenTrabajoOT_idx" ON "ServicioLavado"("ordenTrabajoOT");

-- AddForeignKey
ALTER TABLE "ConsumoServicioEspecial" ADD CONSTRAINT "ConsumoServicioEspecial_servicioEspecialId_fkey" FOREIGN KEY ("servicioEspecialId") REFERENCES "ServicioEspecial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoServicioEspecial" ADD CONSTRAINT "ConsumoServicioEspecial_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaInsumoHistorial" ADD CONSTRAINT "RecetaInsumoHistorial_catalogoServicioId_fkey" FOREIGN KEY ("catalogoServicioId") REFERENCES "CatalogoServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaInsumoHistorial" ADD CONSTRAINT "RecetaInsumoHistorial_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaInsumoHistorial" ADD CONSTRAINT "RecetaInsumoHistorial_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEspecial" ADD CONSTRAINT "ServicioEspecial_servicioCatalogoId_fkey" FOREIGN KEY ("servicioCatalogoId") REFERENCES "CatalogoServicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
