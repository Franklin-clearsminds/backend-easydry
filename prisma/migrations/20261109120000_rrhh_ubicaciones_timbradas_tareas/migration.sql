-- RRHH: ubicación de agencias y bodegas, timbradas, tareas del personal y bitácora de cambios de ubicación.

ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_ASIGNADA';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_COMPLETADA';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_REVISADA';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_DEVUELTA';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_CANCELADA';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_REASIGNADA';
ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'TAREA_VENCIDA';

CREATE TYPE "TipoTimbrada" AS ENUM ('ENTRADA', 'SALIDA');
CREATE TYPE "EstadoTarea" AS ENUM ('PENDIENTE', 'COMPLETADA', 'REVISADA', 'CANCELADA');

ALTER TABLE "Agencia" ADD COLUMN "latitud" DOUBLE PRECISION, ADD COLUMN "longitud" DOUBLE PRECISION, ADD COLUMN "radioTimbradaM" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "bodegas" ADD COLUMN "latitud" DOUBLE PRECISION, ADD COLUMN "longitud" DOUBLE PRECISION, ADD COLUMN "radioTimbradaM" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "InformeNovedad" ADD COLUMN "responsableId" TEXT;

CREATE TABLE "timbradas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoTimbrada" NOT NULL,
    "fechaDia" DATE NOT NULL,
    "marcadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horaDispositivo" TIMESTAMP(3),
    "origen" TEXT NOT NULL DEFAULT 'WEB',
    "fotoKey" TEXT NOT NULL,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "precisionM" DOUBLE PRECISION,
    "verificacion" TEXT NOT NULL,
    "agenciaId" TEXT,
    "bodegaId" TEXT,
    "regionId" TEXT,
    "distanciaM" DOUBLE PRECISION,
    "radioM" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timbradas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timbradas_userId_fechaDia_tipo_key" ON "timbradas"("userId", "fechaDia", "tipo");
CREATE INDEX "timbradas_fechaDia_idx" ON "timbradas"("fechaDia");
CREATE INDEX "timbradas_userId_fechaDia_idx" ON "timbradas"("userId", "fechaDia");
CREATE INDEX "timbradas_agenciaId_fechaDia_idx" ON "timbradas"("agenciaId", "fechaDia");
CREATE INDEX "timbradas_bodegaId_fechaDia_idx" ON "timbradas"("bodegaId", "fechaDia");
ALTER TABLE "timbradas" ADD CONSTRAINT "timbradas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tareas_rrhh" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL DEFAULT '',
    "fechaLimite" TIMESTAMP(3),
    "estado" "EstadoTarea" NOT NULL DEFAULT 'PENDIENTE',
    "asignadoAId" TEXT NOT NULL,
    "asignadoPorId" TEXT NOT NULL,
    "agenciaId" TEXT,
    "regionId" TEXT,
    "respuesta" TEXT,
    "completadaEn" TIMESTAMP(3),
    "revisadaEn" TIMESTAMP(3),
    "revisadaPorId" TEXT,
    "canceladaEn" TIMESTAMP(3),
    "motivoCancelacion" TEXT,
    "vencidaAvisadaEn" TIMESTAMP(3),
    "informeId" TEXT,
    "novedadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tareas_rrhh_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tareas_rrhh_novedadId_key" ON "tareas_rrhh"("novedadId");
CREATE INDEX "tareas_rrhh_asignadoAId_estado_idx" ON "tareas_rrhh"("asignadoAId", "estado");
CREATE INDEX "tareas_rrhh_asignadoPorId_idx" ON "tareas_rrhh"("asignadoPorId");
CREATE INDEX "tareas_rrhh_agenciaId_idx" ON "tareas_rrhh"("agenciaId");
CREATE INDEX "tareas_rrhh_regionId_idx" ON "tareas_rrhh"("regionId");
CREATE INDEX "tareas_rrhh_estado_fechaLimite_idx" ON "tareas_rrhh"("estado", "fechaLimite");
CREATE INDEX "tareas_rrhh_createdAt_idx" ON "tareas_rrhh"("createdAt");
ALTER TABLE "tareas_rrhh" ADD CONSTRAINT "tareas_rrhh_asignadoAId_fkey" FOREIGN KEY ("asignadoAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tareas_rrhh" ADD CONSTRAINT "tareas_rrhh_asignadoPorId_fkey" FOREIGN KEY ("asignadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tareas_rrhh_adjuntos" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "etapa" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanioBytes" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "subidoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tareas_rrhh_adjuntos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tareas_rrhh_adjuntos_tareaId_idx" ON "tareas_rrhh_adjuntos"("tareaId");
ALTER TABLE "tareas_rrhh_adjuntos" ADD CONSTRAINT "tareas_rrhh_adjuntos_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas_rrhh"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tareas_rrhh_historial" (
    "id" TEXT NOT NULL,
    "tareaId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "detalle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tareas_rrhh_historial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tareas_rrhh_historial_tareaId_idx" ON "tareas_rrhh_historial"("tareaId");
ALTER TABLE "tareas_rrhh_historial" ADD CONSTRAINT "tareas_rrhh_historial_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas_rrhh"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ubicacion_cambios" (
    "id" TEXT NOT NULL,
    "sitioTipo" TEXT NOT NULL,
    "sitioId" TEXT NOT NULL,
    "sitioNombre" TEXT NOT NULL,
    "antes" JSONB,
    "despues" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ubicacion_cambios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ubicacion_cambios_sitioTipo_sitioId_idx" ON "ubicacion_cambios"("sitioTipo", "sitioId");
