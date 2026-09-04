-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'GERENTE', 'SUPERVISOR', 'COORD_MANTENIMIENTO', 'TECNICO', 'OPERADOR', 'COORD_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES', 'OPERADOR_SERVICIOS_ESPECIALES', 'DISTRIBUIDOR', 'ASISTENTE_BODEGA');

-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('EN_ESPERA', 'EN_PROCESO', 'FINALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "role" "RoleType" NOT NULL,
    "sucursalId" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sucursal" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "direccion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bahia" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bahia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogoServicio" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "tiempoEstimadoMin" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "CatalogoServicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServicioLavado" (
    "id" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "color" TEXT,
    "cliente" TEXT,
    "estado" "ServiceStatus" NOT NULL DEFAULT 'EN_ESPERA',
    "bahiaId" TEXT NOT NULL,
    "servicioCatalogoId" INTEGER NOT NULL,
    "operadorId" TEXT NOT NULL,
    "fotoIngresoUrl" TEXT,
    "fotoSalidaUrl" TEXT,
    "observaciones" TEXT,
    "horaIngreso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horaInicio" TIMESTAMP(3),
    "horaSalida" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServicioLavado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOutboxAudit" (
    "id" TEXT NOT NULL,
    "clientUuid" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "entity" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncOutboxAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Sucursal_codigo_key" ON "Sucursal"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Bahia_codigo_key" ON "Bahia"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogoServicio_codigo_key" ON "CatalogoServicio"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ServicioLavado_clientUuid_key" ON "ServicioLavado"("clientUuid");

-- CreateIndex
CREATE INDEX "ServicioLavado_placa_idx" ON "ServicioLavado"("placa");

-- CreateIndex
CREATE INDEX "ServicioLavado_estado_idx" ON "ServicioLavado"("estado");

-- CreateIndex
CREATE INDEX "ServicioLavado_bahiaId_idx" ON "ServicioLavado"("bahiaId");

-- CreateIndex
CREATE INDEX "ServicioLavado_clientUuid_idx" ON "ServicioLavado"("clientUuid");

-- CreateIndex
CREATE INDEX "ServicioLavado_updatedAt_idx" ON "ServicioLavado"("updatedAt");

-- CreateIndex
CREATE INDEX "SyncOutboxAudit_clientUuid_idx" ON "SyncOutboxAudit"("clientUuid");

-- CreateIndex
CREATE INDEX "SyncOutboxAudit_syncedAt_idx" ON "SyncOutboxAudit"("syncedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bahia" ADD CONSTRAINT "Bahia_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioLavado" ADD CONSTRAINT "ServicioLavado_bahiaId_fkey" FOREIGN KEY ("bahiaId") REFERENCES "Bahia"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioLavado" ADD CONSTRAINT "ServicioLavado_servicioCatalogoId_fkey" FOREIGN KEY ("servicioCatalogoId") REFERENCES "CatalogoServicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServicioLavado" ADD CONSTRAINT "ServicioLavado_operadorId_fkey" FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
