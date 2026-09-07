/*
  Warnings:

  - You are about to drop the column `sucursalId` on the `Bahia` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `sucursalId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `sucursalesIds` on the `User` table. All the data in the column will be lost.
  - The `estado` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Sucursal` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `agenciaId` to the `Bahia` table without a default value. This is not possible if the table is not empty.
  - Made the column `roleId` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "TipoUbicacionStock" AS ENUM ('BODEGA_CENTRAL', 'AGENCIA', 'PULIDOR_MOVIL', 'PULIDOR_FIJO');

-- CreateEnum
CREATE TYPE "TipoMovimientoInv" AS ENUM ('COMPRA_PROVEEDOR', 'DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'RECEPCION_CONFIRMADA', 'RECEPCION_RECHAZADA', 'CONSUMO_SERVICIO', 'AJUSTE_MERMA');

-- CreateEnum
CREATE TYPE "EstadoDespacho" AS ENUM ('PENDIENTE', 'EN_TRANSITO', 'RECIBIDO', 'RECHAZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "NivelAlertaStock" AS ENUM ('BAJO', 'CRITICO', 'AGOTADO');

-- CreateEnum
CREATE TYPE "EstadoAlertaStock" AS ENUM ('PENDIENTE', 'EN_PROCESO', 'DESPACHADO', 'RESUELTO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ServiceStatus" ADD VALUE 'APROBADO';
ALTER TYPE "ServiceStatus" ADD VALUE 'RECHAZADO';

-- DropForeignKey
ALTER TABLE "Bahia" DROP CONSTRAINT "Bahia_sucursalId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_roleId_fkey";

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_sucursalId_fkey";

-- DropIndex
DROP INDEX "User_role_idx";

-- AlterTable
ALTER TABLE "Bahia" DROP COLUMN "sucursalId",
ADD COLUMN     "agenciaId" TEXT NOT NULL,
ADD COLUMN     "operadorActualId" TEXT;

-- AlterTable
ALTER TABLE "ServicioLavado" ADD COLUMN     "aprobadoPor" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fechaAprobacion" TIMESTAMP(3),
ADD COLUMN     "motivoRechazo" TEXT,
ADD COLUMN     "observacionGerente" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "role",
DROP COLUMN "sucursalId",
DROP COLUMN "sucursalesIds",
ADD COLUMN     "agenciaId" TEXT,
ADD COLUMN     "agenciasIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "regionId" TEXT,
DROP COLUMN "estado",
ADD COLUMN     "estado" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "roleId" SET NOT NULL;

-- DropTable
DROP TABLE "Sucursal";

-- DropEnum
DROP TYPE "RoleType";

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Marca" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Marca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agencia" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "region" TEXT,
    "direccion" TEXT,
    "telefono" TEXT,
    "email" TEXT,
    "numeroBahias" INTEGER NOT NULL DEFAULT 0,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "marcaId" TEXT,
    "regionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecetaInsumo" (
    "id" TEXT NOT NULL,
    "catalogoServicioId" INTEGER NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidadUsada" DECIMAL(10,4) NOT NULL,
    "unidadConsumoId" TEXT NOT NULL,
    "esOpcional" BOOLEAN NOT NULL DEFAULT false,
    "observacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecetaInsumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumoServicio" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidadUsada" DECIMAL(10,4) NOT NULL,
    "stockUbicacionId" TEXT,
    "agenciaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumoServicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipoEnvase" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "capacidad" DECIMAL(10,3),
    "unidadBase" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoEnvase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidadMedida" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "simbolo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "factorBase" DECIMAL(10,6),
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnidadMedida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insumo" (
    "id" TEXT NOT NULL,
    "codigoSKU" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descripcion" TEXT,
    "tipoEnvaseId" TEXT NOT NULL,
    "unidadMedidaId" TEXT NOT NULL,
    "contenidoNeto" DECIMAL(10,3) NOT NULL DEFAULT 1.0,
    "stockMinimoBodega" DECIMAL(10,2) NOT NULL DEFAULT 10.0,
    "stockMinimoAgencia" DECIMAL(10,2) NOT NULL DEFAULT 2.0,
    "stockOptimoBodega" DECIMAL(10,2),
    "costoUnitarioUSD" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "proveedorPrincipal" TEXT,
    "imagenUrl" TEXT,
    "estado" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insumo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockUbicacion" (
    "id" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "tipoUbicacion" "TipoUbicacionStock" NOT NULL,
    "agenciaId" TEXT,
    "pulidorId" TEXT,
    "cantidadActual" DECIMAL(12,3) NOT NULL DEFAULT 0.0,
    "cantidadMinima" DECIMAL(12,3) NOT NULL DEFAULT 0.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockUbicacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" TEXT NOT NULL,
    "numeroGuia" TEXT NOT NULL,
    "tipo" "TipoMovimientoInv" NOT NULL,
    "estadoDespacho" "EstadoDespacho" NOT NULL DEFAULT 'EN_TRANSITO',
    "origenUbicacion" TEXT NOT NULL,
    "destinoUbicacion" TEXT NOT NULL,
    "usuarioDespachaId" TEXT NOT NULL,
    "usuarioRecibeId" TEXT,
    "fechaDespacho" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaRecepcion" TIMESTAMP(3),
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoDetalle" (
    "id" TEXT NOT NULL,
    "movimientoId" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "cantidadEnviada" DECIMAL(10,3) NOT NULL,
    "cantidadRecibida" DECIMAL(10,3),
    "costoUnitarioUSD" DECIMAL(10,2),
    "subtotalUSD" DECIMAL(10,2),

    CONSTRAINT "MovimientoDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertaStock" (
    "id" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "nivel" "NivelAlertaStock" NOT NULL DEFAULT 'BAJO',
    "estado" "EstadoAlertaStock" NOT NULL DEFAULT 'PENDIENTE',
    "agenciaId" TEXT,
    "usuarioEmisorId" TEXT NOT NULL,
    "mensaje" TEXT,
    "stockReportado" DECIMAL(10,3),
    "fechaAtencion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertaStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncDeadLetterQueue" (
    "id" TEXT NOT NULL,
    "mutationId" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "errorMotivo" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 1,
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncDeadLetterQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncDevice" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "appVersion" TEXT,
    "platform" TEXT,
    "pushToken" TEXT,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenciaServicio" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "descripcion" TEXT,
    "tomadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaServicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Maquinaria" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "serie" TEXT,
    "estadoOperativo" TEXT NOT NULL DEFAULT 'OPERATIVA',
    "fotoUrl" TEXT,
    "horasUso" INTEGER NOT NULL DEFAULT 0,
    "agenciaId" TEXT,
    "bahiaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Maquinaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidenteTecnico" (
    "id" TEXT NOT NULL,
    "maquinariaId" TEXT NOT NULL,
    "reportadoPorId" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "gravedad" TEXT NOT NULL DEFAULT 'MEDIA',
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "fotoEvidenciaUrl" TEXT,
    "solucion" TEXT,
    "resueltoPorId" TEXT,
    "fechaReporte" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaSolucion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncidenteTecnico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MantenimientoMaquinaria" (
    "id" TEXT NOT NULL,
    "maquinariaId" TEXT NOT NULL,
    "tecnicoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'PREVENTIVO',
    "estado" TEXT NOT NULL DEFAULT 'FINALIZADO',
    "observaciones" TEXT,
    "repuestosUsados" JSONB,
    "costoTotal" DECIMAL(10,2),
    "fechaMantenimiento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proximoMantenimiento" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MantenimientoMaquinaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KardexMovimiento" (
    "id" TEXT NOT NULL,
    "insumoId" TEXT NOT NULL,
    "ubicacionId" TEXT NOT NULL,
    "tipoMovimiento" TEXT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,
    "stockAnterior" DECIMAL(12,4) NOT NULL,
    "stockPosterior" DECIMAL(12,4) NOT NULL,
    "costoUnitario" DECIMAL(10,2),
    "costoTotal" DECIMAL(10,2),
    "referenciaId" TEXT,
    "usuarioId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KardexMovimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SolicitudAprobacion" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "montoUSD" DECIMAL(10,2),
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "solicitanteId" TEXT NOT NULL,
    "aprobadorId" TEXT,
    "agenciaId" TEXT,
    "entidadRefId" TEXT,
    "motivoRechazo" TEXT,
    "fechaDecision" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SolicitudAprobacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialAsignacionBahia" (
    "id" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "bahiaId" TEXT NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaFin" TIMESTAMP(3),
    "asignadoPorId" TEXT,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialAsignacionBahia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicioEspecial" (
    "id" TEXT NOT NULL,
    "clientUuid" TEXT,
    "codigoSE" TEXT NOT NULL,
    "tipoServicio" TEXT NOT NULL,
    "clienteNombre" TEXT,
    "placa" TEXT NOT NULL,
    "marca" TEXT,
    "modelo" TEXT,
    "color" TEXT,
    "prioridad" TEXT NOT NULL DEFAULT 'Media',
    "estado" TEXT NOT NULL DEFAULT 'Pendiente',
    "agenciaId" TEXT,
    "operadorId" TEXT,
    "bahiaId" TEXT,
    "fechaProgramada" TIMESTAMP(3),
    "horaEstimada" TEXT,
    "fechaInicio" TIMESTAMP(3),
    "fechaFin" TIMESTAMP(3),
    "recetaInsumos" JSONB,
    "evidencias" JSONB,
    "notasSupervisor" TEXT,
    "notasOperador" TEXT,
    "observaciones" TEXT,
    "calificacionCalidad" INTEGER,
    "syncedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioEspecial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_codigo_key" ON "Region"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Region_nombre_key" ON "Region"("nombre");

-- CreateIndex
CREATE INDEX "Region_estado_idx" ON "Region"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Marca_nombre_key" ON "Marca"("nombre");

-- CreateIndex
CREATE INDEX "Marca_estado_idx" ON "Marca"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Agencia_codigo_key" ON "Agencia"("codigo");

-- CreateIndex
CREATE INDEX "Agencia_region_idx" ON "Agencia"("region");

-- CreateIndex
CREATE INDEX "Agencia_regionId_idx" ON "Agencia"("regionId");

-- CreateIndex
CREATE INDEX "Agencia_estado_idx" ON "Agencia"("estado");

-- CreateIndex
CREATE INDEX "Agencia_marcaId_idx" ON "Agencia"("marcaId");

-- CreateIndex
CREATE INDEX "RecetaInsumo_catalogoServicioId_idx" ON "RecetaInsumo"("catalogoServicioId");

-- CreateIndex
CREATE INDEX "RecetaInsumo_insumoId_idx" ON "RecetaInsumo"("insumoId");

-- CreateIndex
CREATE UNIQUE INDEX "RecetaInsumo_catalogoServicioId_insumoId_key" ON "RecetaInsumo"("catalogoServicioId", "insumoId");

-- CreateIndex
CREATE INDEX "ConsumoServicio_servicioId_idx" ON "ConsumoServicio"("servicioId");

-- CreateIndex
CREATE INDEX "ConsumoServicio_insumoId_idx" ON "ConsumoServicio"("insumoId");

-- CreateIndex
CREATE UNIQUE INDEX "TipoEnvase_codigo_key" ON "TipoEnvase"("codigo");

-- CreateIndex
CREATE INDEX "TipoEnvase_codigo_idx" ON "TipoEnvase"("codigo");

-- CreateIndex
CREATE INDEX "TipoEnvase_estado_idx" ON "TipoEnvase"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "UnidadMedida_codigo_key" ON "UnidadMedida"("codigo");

-- CreateIndex
CREATE INDEX "UnidadMedida_codigo_idx" ON "UnidadMedida"("codigo");

-- CreateIndex
CREATE INDEX "UnidadMedida_estado_idx" ON "UnidadMedida"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "Insumo_codigoSKU_key" ON "Insumo"("codigoSKU");

-- CreateIndex
CREATE INDEX "Insumo_codigoSKU_idx" ON "Insumo"("codigoSKU");

-- CreateIndex
CREATE INDEX "Insumo_categoria_idx" ON "Insumo"("categoria");

-- CreateIndex
CREATE INDEX "Insumo_estado_idx" ON "Insumo"("estado");

-- CreateIndex
CREATE INDEX "StockUbicacion_insumoId_idx" ON "StockUbicacion"("insumoId");

-- CreateIndex
CREATE INDEX "StockUbicacion_tipoUbicacion_idx" ON "StockUbicacion"("tipoUbicacion");

-- CreateIndex
CREATE INDEX "StockUbicacion_agenciaId_idx" ON "StockUbicacion"("agenciaId");

-- CreateIndex
CREATE INDEX "StockUbicacion_pulidorId_idx" ON "StockUbicacion"("pulidorId");

-- CreateIndex
CREATE UNIQUE INDEX "MovimientoInventario_numeroGuia_key" ON "MovimientoInventario"("numeroGuia");

-- CreateIndex
CREATE INDEX "MovimientoInventario_numeroGuia_idx" ON "MovimientoInventario"("numeroGuia");

-- CreateIndex
CREATE INDEX "MovimientoInventario_tipo_idx" ON "MovimientoInventario"("tipo");

-- CreateIndex
CREATE INDEX "MovimientoInventario_estadoDespacho_idx" ON "MovimientoInventario"("estadoDespacho");

-- CreateIndex
CREATE INDEX "AlertaStock_estado_idx" ON "AlertaStock"("estado");

-- CreateIndex
CREATE INDEX "AlertaStock_nivel_idx" ON "AlertaStock"("nivel");

-- CreateIndex
CREATE INDEX "AlertaStock_agenciaId_idx" ON "AlertaStock"("agenciaId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncDeadLetterQueue_mutationId_key" ON "SyncDeadLetterQueue"("mutationId");

-- CreateIndex
CREATE INDEX "SyncDeadLetterQueue_clientUuid_idx" ON "SyncDeadLetterQueue"("clientUuid");

-- CreateIndex
CREATE INDEX "SyncDeadLetterQueue_resuelto_idx" ON "SyncDeadLetterQueue"("resuelto");

-- CreateIndex
CREATE UNIQUE INDEX "SyncDevice_deviceId_key" ON "SyncDevice"("deviceId");

-- CreateIndex
CREATE INDEX "SyncDevice_userId_idx" ON "SyncDevice"("userId");

-- CreateIndex
CREATE INDEX "SyncDevice_deviceId_idx" ON "SyncDevice"("deviceId");

-- CreateIndex
CREATE INDEX "EvidenciaServicio_servicioId_idx" ON "EvidenciaServicio"("servicioId");

-- CreateIndex
CREATE INDEX "EvidenciaServicio_tipo_idx" ON "EvidenciaServicio"("tipo");

-- CreateIndex
CREATE UNIQUE INDEX "Maquinaria_codigo_key" ON "Maquinaria"("codigo");

-- CreateIndex
CREATE INDEX "Maquinaria_tipo_idx" ON "Maquinaria"("tipo");

-- CreateIndex
CREATE INDEX "Maquinaria_estadoOperativo_idx" ON "Maquinaria"("estadoOperativo");

-- CreateIndex
CREATE INDEX "Maquinaria_agenciaId_idx" ON "Maquinaria"("agenciaId");

-- CreateIndex
CREATE INDEX "Maquinaria_bahiaId_idx" ON "Maquinaria"("bahiaId");

-- CreateIndex
CREATE INDEX "IncidenteTecnico_maquinariaId_idx" ON "IncidenteTecnico"("maquinariaId");

-- CreateIndex
CREATE INDEX "IncidenteTecnico_reportadoPorId_idx" ON "IncidenteTecnico"("reportadoPorId");

-- CreateIndex
CREATE INDEX "IncidenteTecnico_estado_idx" ON "IncidenteTecnico"("estado");

-- CreateIndex
CREATE INDEX "IncidenteTecnico_gravedad_idx" ON "IncidenteTecnico"("gravedad");

-- CreateIndex
CREATE INDEX "MantenimientoMaquinaria_maquinariaId_idx" ON "MantenimientoMaquinaria"("maquinariaId");

-- CreateIndex
CREATE INDEX "MantenimientoMaquinaria_tecnicoId_idx" ON "MantenimientoMaquinaria"("tecnicoId");

-- CreateIndex
CREATE INDEX "MantenimientoMaquinaria_tipo_idx" ON "MantenimientoMaquinaria"("tipo");

-- CreateIndex
CREATE INDEX "MantenimientoMaquinaria_estado_idx" ON "MantenimientoMaquinaria"("estado");

-- CreateIndex
CREATE INDEX "KardexMovimiento_insumoId_idx" ON "KardexMovimiento"("insumoId");

-- CreateIndex
CREATE INDEX "KardexMovimiento_ubicacionId_idx" ON "KardexMovimiento"("ubicacionId");

-- CreateIndex
CREATE INDEX "KardexMovimiento_tipoMovimiento_idx" ON "KardexMovimiento"("tipoMovimiento");

-- CreateIndex
CREATE INDEX "KardexMovimiento_fecha_idx" ON "KardexMovimiento"("fecha");

-- CreateIndex
CREATE INDEX "SolicitudAprobacion_estado_idx" ON "SolicitudAprobacion"("estado");

-- CreateIndex
CREATE INDEX "SolicitudAprobacion_agenciaId_idx" ON "SolicitudAprobacion"("agenciaId");

-- CreateIndex
CREATE INDEX "SolicitudAprobacion_tipo_idx" ON "SolicitudAprobacion"("tipo");

-- CreateIndex
CREATE INDEX "HistorialAsignacionBahia_operadorId_idx" ON "HistorialAsignacionBahia"("operadorId");

-- CreateIndex
CREATE INDEX "HistorialAsignacionBahia_bahiaId_idx" ON "HistorialAsignacionBahia"("bahiaId");

-- CreateIndex
CREATE INDEX "HistorialAsignacionBahia_fechaInicio_idx" ON "HistorialAsignacionBahia"("fechaInicio");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioEspecial_clientUuid_key" ON "ServicioEspecial"("clientUuid");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioEspecial_codigoSE_key" ON "ServicioEspecial"("codigoSE");

-- CreateIndex
CREATE INDEX "ServicioEspecial_clientUuid_idx" ON "ServicioEspecial"("clientUuid");

-- CreateIndex
CREATE INDEX "ServicioEspecial_codigoSE_idx" ON "ServicioEspecial"("codigoSE");

-- CreateIndex
CREATE INDEX "ServicioEspecial_estado_idx" ON "ServicioEspecial"("estado");

-- CreateIndex
CREATE INDEX "ServicioEspecial_placa_idx" ON "ServicioEspecial"("placa");

-- CreateIndex
CREATE INDEX "ServicioEspecial_agenciaId_idx" ON "ServicioEspecial"("agenciaId");

-- CreateIndex
CREATE INDEX "ServicioEspecial_operadorId_idx" ON "ServicioEspecial"("operadorId");

-- CreateIndex
CREATE INDEX "Bahia_agenciaId_idx" ON "Bahia"("agenciaId");

-- CreateIndex
CREATE INDEX "Bahia_operadorActualId_idx" ON "Bahia"("operadorActualId");

-- CreateIndex
CREATE INDEX "ServicioLavado_deletedAt_idx" ON "ServicioLavado"("deletedAt");

-- CreateIndex
CREATE INDEX "User_agenciaId_idx" ON "User"("agenciaId");

-- CreateIndex
CREATE INDEX "User_regionId_idx" ON "User"("regionId");

-- CreateIndex
CREATE INDEX "User_estado_idx" ON "User"("estado");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agencia" ADD CONSTRAINT "Agencia_marcaId_fkey" FOREIGN KEY ("marcaId") REFERENCES "Marca"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agencia" ADD CONSTRAINT "Agencia_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bahia" ADD CONSTRAINT "Bahia_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bahia" ADD CONSTRAINT "Bahia_operadorActualId_fkey" FOREIGN KEY ("operadorActualId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaInsumo" ADD CONSTRAINT "RecetaInsumo_catalogoServicioId_fkey" FOREIGN KEY ("catalogoServicioId") REFERENCES "CatalogoServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaInsumo" ADD CONSTRAINT "RecetaInsumo_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecetaInsumo" ADD CONSTRAINT "RecetaInsumo_unidadConsumoId_fkey" FOREIGN KEY ("unidadConsumoId") REFERENCES "UnidadMedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoServicio" ADD CONSTRAINT "ConsumoServicio_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioLavado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumoServicio" ADD CONSTRAINT "ConsumoServicio_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_tipoEnvaseId_fkey" FOREIGN KEY ("tipoEnvaseId") REFERENCES "TipoEnvase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_unidadMedidaId_fkey" FOREIGN KEY ("unidadMedidaId") REFERENCES "UnidadMedida"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUbicacion" ADD CONSTRAINT "StockUbicacion_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUbicacion" ADD CONSTRAINT "StockUbicacion_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockUbicacion" ADD CONSTRAINT "StockUbicacion_pulidorId_fkey" FOREIGN KEY ("pulidorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_usuarioDespachaId_fkey" FOREIGN KEY ("usuarioDespachaId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoInventario" ADD CONSTRAINT "MovimientoInventario_usuarioRecibeId_fkey" FOREIGN KEY ("usuarioRecibeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoDetalle" ADD CONSTRAINT "MovimientoDetalle_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "MovimientoInventario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoDetalle" ADD CONSTRAINT "MovimientoDetalle_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaStock" ADD CONSTRAINT "AlertaStock_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaStock" ADD CONSTRAINT "AlertaStock_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertaStock" ADD CONSTRAINT "AlertaStock_usuarioEmisorId_fkey" FOREIGN KEY ("usuarioEmisorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncDevice" ADD CONSTRAINT "SyncDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenciaServicio" ADD CONSTRAINT "EvidenciaServicio_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "ServicioLavado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maquinaria" ADD CONSTRAINT "Maquinaria_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Maquinaria" ADD CONSTRAINT "Maquinaria_bahiaId_fkey" FOREIGN KEY ("bahiaId") REFERENCES "Bahia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidenteTecnico" ADD CONSTRAINT "IncidenteTecnico_maquinariaId_fkey" FOREIGN KEY ("maquinariaId") REFERENCES "Maquinaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidenteTecnico" ADD CONSTRAINT "IncidenteTecnico_reportadoPorId_fkey" FOREIGN KEY ("reportadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidenteTecnico" ADD CONSTRAINT "IncidenteTecnico_resueltoPorId_fkey" FOREIGN KEY ("resueltoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MantenimientoMaquinaria" ADD CONSTRAINT "MantenimientoMaquinaria_maquinariaId_fkey" FOREIGN KEY ("maquinariaId") REFERENCES "Maquinaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MantenimientoMaquinaria" ADD CONSTRAINT "MantenimientoMaquinaria_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KardexMovimiento" ADD CONSTRAINT "KardexMovimiento_insumoId_fkey" FOREIGN KEY ("insumoId") REFERENCES "Insumo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KardexMovimiento" ADD CONSTRAINT "KardexMovimiento_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudAprobacion" ADD CONSTRAINT "SolicitudAprobacion_solicitanteId_fkey" FOREIGN KEY ("solicitanteId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudAprobacion" ADD CONSTRAINT "SolicitudAprobacion_aprobadorId_fkey" FOREIGN KEY ("aprobadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudAprobacion" ADD CONSTRAINT "SolicitudAprobacion_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialAsignacionBahia" ADD CONSTRAINT "HistorialAsignacionBahia_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialAsignacionBahia" ADD CONSTRAINT "HistorialAsignacionBahia_bahiaId_fkey" FOREIGN KEY ("bahiaId") REFERENCES "Bahia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialAsignacionBahia" ADD CONSTRAINT "HistorialAsignacionBahia_asignadoPorId_fkey" FOREIGN KEY ("asignadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEspecial" ADD CONSTRAINT "ServicioEspecial_agenciaId_fkey" FOREIGN KEY ("agenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioEspecial" ADD CONSTRAINT "ServicioEspecial_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
