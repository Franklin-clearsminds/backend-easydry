-- DropForeignKey
ALTER TABLE "Agencia" DROP CONSTRAINT "Agencia_marcaId_fkey";

-- DropForeignKey
ALTER TABLE "Insumo" DROP CONSTRAINT "Insumo_tipoEnvaseId_fkey";

-- DropIndex
DROP INDEX "Agencia_marcaId_idx";

-- AlterTable
ALTER TABLE "Agencia" DROP COLUMN "marcaId",
ADD COLUMN     "clienteId" TEXT,
ADD COLUMN     "maxLavadoresPorBahia" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Insumo" DROP COLUMN "tipoEnvaseId",
ADD COLUMN     "stockActual" DECIMAL(12,4) NOT NULL DEFAULT 0.0,
ADD COLUMN     "tipoProductoId" TEXT;

-- AlterTable
ALTER TABLE "ServicioEspecial" ADD COLUMN     "regionId" TEXT,
ADD COLUMN     "regionNombre" TEXT,
ADD COLUMN     "videoFinalUrl" TEXT,
ADD COLUMN     "videoInicialUrl" TEXT;

-- AlterTable
ALTER TABLE "modulos_sistema" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "roles" RENAME CONSTRAINT "Role_pkey" TO "roles_pkey";

-- DropTable
DROP TABLE "Marca";

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoProducto" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoProducto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresentacionInsumo" (
    "id" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "unidadId" TEXT NOT NULL,
    "cantidad" DECIMAL(10,3) NOT NULL,
    "factorAUnidadBase" DECIMAL(12,4) NOT NULL,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PresentacionInsumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoMovimientoInventario" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "esEntrada" BOOLEAN NOT NULL DEFAULT true,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoMovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivoMovimientoInventario" (
    "id" TEXT NOT NULL,
    "tipoMovimientoId" TEXT,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivoMovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoInventarioGlobal" (
    "id" TEXT NOT NULL,
    "numeroComprobante" TEXT NOT NULL,
    "tipoMovimientoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,
    "unidadId" TEXT NOT NULL,
    "cantidadBase" DECIMAL(12,4) NOT NULL,
    "stockAnterior" DECIMAL(12,4) NOT NULL,
    "stockNuevo" DECIMAL(12,4) NOT NULL,
    "presentacionId" TEXT,
    "ubicacionId" TEXT,
    "origenUbicacion" TEXT,
    "destinoUbicacion" TEXT,
    "responsableId" TEXT,
    "motivoId" TEXT,
    "referencia" TEXT,
    "observaciones" TEXT,
    "fechaMovimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoInventarioGlobal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BahiaOperador" (
    "id" TEXT NOT NULL,
    "bahiaId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fechaAsignacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asignadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BahiaOperador_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_nombre_key" ON "Cliente"("nombre");

-- CreateIndex
CREATE INDEX "Cliente_estado_idx" ON "Cliente"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "TipoProducto_codigo_key" ON "TipoProducto"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "TipoProducto_nombre_key" ON "TipoProducto"("nombre");

-- CreateIndex
CREATE INDEX "TipoProducto_codigo_idx" ON "TipoProducto"("codigo");

-- CreateIndex
CREATE INDEX "TipoProducto_estado_idx" ON "TipoProducto"("estado");

-- CreateIndex
CREATE INDEX "PresentacionInsumo_insumoId_idx" ON "PresentacionInsumo"("insumoId");

-- CreateIndex
CREATE INDEX "PresentacionInsumo_estado_idx" ON "PresentacionInsumo"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "TipoMovimientoInventario_codigo_key" ON "TipoMovimientoInventario"("codigo");

-- CreateIndex
CREATE INDEX "TipoMovimientoInventario_codigo_idx" ON "TipoMovimientoInventario"("codigo");

-- CreateIndex
CREATE INDEX "TipoMovimientoInventario_estado_idx" ON "TipoMovimientoInventario"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "MotivoMovimientoInventario_codigo_key" ON "MotivoMovimientoInventario"("codigo");

-- CreateIndex
CREATE INDEX "MotivoMovimientoInventario_codigo_idx" ON "MotivoMovimientoInventario"("codigo");

-- CreateIndex
CREATE INDEX "MotivoMovimientoInventario_estado_idx" ON "MotivoMovimientoInventario"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoInventarioGlobal_numeroComprobante_key" ON "MovimientoInventarioGlobal"("numeroComprobante");

-- CreateIndex
CREATE INDEX "MovimientoInventarioGlobal_insumoId_idx" ON "MovimientoInventarioGlobal"("insumoId");

-- CreateIndex
CREATE INDEX "MovimientoInventarioGlobal_tipoMovimientoId_idx" ON "MovimientoInventarioGlobal"("tipoMovimientoId");

-- CreateIndex
CREATE INDEX "MovimientoInventarioGlobal_fechaMovimiento_idx" ON "MovimientoInventarioGlobal"("fechaMovimiento");

-- CreateIndex
CREATE INDEX "BahiaOperador_bahiaId_idx" ON "BahiaOperador"("bahiaId");

-- CreateIndex
CREATE INDEX "BahiaOperador_operadorId_idx" ON "BahiaOperador"("operadorId");

-- CreateIndex
CREATE INDEX "BahiaOperador_activo_idx" ON "BahiaOperador"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "BahiaOperador_bahiaId_operadorId_key" ON "BahiaOperador"("bahiaId", "operadorId");

-- CreateIndex
CREATE INDEX "Agencia_clienteId_idx" ON "Agencia"("clienteId");

-- CreateIndex
CREATE INDEX "Insumo_tipoProductoId_idx" ON "Insumo"("tipoProductoId");

-- CreateIndex
CREATE INDEX "ServicioEspecial_regionId_idx" ON "ServicioEspecial"("regionId");

-- AddForeignKey
ALTER TABLE "Agencia" ADD CONSTRAINT "Agencia_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentacionInsumo" ADD CONSTRAINT "PresentacionInsumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresentacionInsumo" ADD CONSTRAINT "PresentacionInsumo_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "UnidadMedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivoMovimientoInventario" ADD CONSTRAINT "MotivoMovimientoInventario_tipoMovimientoId_fkey" FOREIGN KEY ("tipoMovimientoId") REFERENCES "TipoMovimientoInventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventarioGlobal" ADD CONSTRAINT "MovimientoInventarioGlobal_tipoMovimientoId_fkey" FOREIGN KEY ("tipoMovimientoId") REFERENCES "TipoMovimientoInventario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventarioGlobal" ADD CONSTRAINT "MovimientoInventarioGlobal_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventarioGlobal" ADD CONSTRAINT "MovimientoInventarioGlobal_unidadId_fkey" FOREIGN KEY ("unidadId") REFERENCES "UnidadMedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventarioGlobal" ADD CONSTRAINT "MovimientoInventarioGlobal_presentacionId_fkey" FOREIGN KEY ("presentacionId") REFERENCES "PresentacionInsumo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventarioGlobal" ADD CONSTRAINT "MovimientoInventarioGlobal_responsableId_fkey" FOREIGN KEY ("responsableId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventarioGlobal" ADD CONSTRAINT "MovimientoInventarioGlobal_motivoId_fkey" FOREIGN KEY ("motivoId") REFERENCES "MotivoMovimientoInventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_tipoProductoId_fkey" FOREIGN KEY ("tipoProductoId") REFERENCES "TipoProducto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BahiaOperador" ADD CONSTRAINT "BahiaOperador_bahiaId_fkey" FOREIGN KEY ("bahiaId") REFERENCES "Bahia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BahiaOperador" ADD CONSTRAINT "BahiaOperador_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BahiaOperador" ADD CONSTRAINT "BahiaOperador_asignadoPorId_fkey" FOREIGN KEY ("asignadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEspecial" ADD CONSTRAINT "ServicioEspecial_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Role_estado_idx" RENAME TO "roles_estado_idx";

-- RenameIndex
ALTER INDEX "Role_namerol_idx" RENAME TO "roles_namerol_idx";

-- RenameIndex
ALTER INDEX "Role_namerol_key" RENAME TO "roles_namerol_key";
