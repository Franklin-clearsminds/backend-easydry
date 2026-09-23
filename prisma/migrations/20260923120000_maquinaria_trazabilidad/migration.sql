-- AlterTable Agencia
ALTER TABLE "Agencia" ADD COLUMN IF NOT EXISTS "tipoUbicacion" TEXT NOT NULL DEFAULT 'OPERATIVA';

-- AlterTable IncidenteTecnico
ALTER TABLE "IncidenteTecnico" ADD COLUMN IF NOT EXISTS "tecnicoAsignadoId" TEXT;
ALTER TABLE "IncidenteTecnico" ADD COLUMN IF NOT EXISTS "fechaAsignacion" TIMESTAMP(3);
ALTER TABLE "IncidenteTecnico" ADD COLUMN IF NOT EXISTS "destinoTallerId" TEXT;

-- CreateTable EvidenciaMantenimiento
CREATE TABLE IF NOT EXISTS "EvidenciaMantenimiento" (
    "id" TEXT NOT NULL,
    "mantenimientoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "descripcion" TEXT,
    "metadata" JSONB,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaMantenimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable MovimientoMaquinaria
CREATE TABLE IF NOT EXISTS "MovimientoMaquinaria" (
    "id" TEXT NOT NULL,
    "maquinariaId" TEXT NOT NULL,
    "origenAgenciaId" TEXT,
    "destinoAgenciaId" TEXT,
    "origenBahiaId" TEXT,
    "destinoBahiaId" TEXT,
    "motivo" TEXT NOT NULL,
    "usuarioId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoMaquinaria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Agencia_tipoUbicacion_idx" ON "Agencia"("tipoUbicacion");
CREATE INDEX IF NOT EXISTS "IncidenteTecnico_tecnicoAsignadoId_idx" ON "IncidenteTecnico"("tecnicoAsignadoId");
CREATE INDEX IF NOT EXISTS "IncidenteTecnico_destinoTallerId_idx" ON "IncidenteTecnico"("destinoTallerId");
CREATE INDEX IF NOT EXISTS "EvidenciaMantenimiento_mantenimientoId_idx" ON "EvidenciaMantenimiento"("mantenimientoId");
CREATE INDEX IF NOT EXISTS "EvidenciaMantenimiento_tipo_idx" ON "EvidenciaMantenimiento"("tipo");
CREATE INDEX IF NOT EXISTS "MovimientoMaquinaria_maquinariaId_idx" ON "MovimientoMaquinaria"("maquinariaId");
CREATE INDEX IF NOT EXISTS "MovimientoMaquinaria_origenAgenciaId_idx" ON "MovimientoMaquinaria"("origenAgenciaId");
CREATE INDEX IF NOT EXISTS "MovimientoMaquinaria_destinoAgenciaId_idx" ON "MovimientoMaquinaria"("destinoAgenciaId");
CREATE INDEX IF NOT EXISTS "MovimientoMaquinaria_fecha_idx" ON "MovimientoMaquinaria"("fecha");

DO $$ BEGIN
  ALTER TABLE "IncidenteTecnico" ADD CONSTRAINT "IncidenteTecnico_tecnicoAsignadoId_fkey" FOREIGN KEY ("tecnicoAsignadoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "IncidenteTecnico" ADD CONSTRAINT "IncidenteTecnico_destinoTallerId_fkey" FOREIGN KEY ("destinoTallerId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EvidenciaMantenimiento" ADD CONSTRAINT "EvidenciaMantenimiento_mantenimientoId_fkey" FOREIGN KEY ("mantenimientoId") REFERENCES "MantenimientoMaquinaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MovimientoMaquinaria" ADD CONSTRAINT "MovimientoMaquinaria_maquinariaId_fkey" FOREIGN KEY ("maquinariaId") REFERENCES "Maquinaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MovimientoMaquinaria" ADD CONSTRAINT "MovimientoMaquinaria_origenAgenciaId_fkey" FOREIGN KEY ("origenAgenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MovimientoMaquinaria" ADD CONSTRAINT "MovimientoMaquinaria_destinoAgenciaId_fkey" FOREIGN KEY ("destinoAgenciaId") REFERENCES "Agencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MovimientoMaquinaria" ADD CONSTRAINT "MovimientoMaquinaria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
