-- Trazabilidad de maquinaria: línea de tiempo append-only, responsables, activación y evidencias verificadas.

-- Maquinaria: creador, activación/desactivación, operador asignado y ventana de adelanto de mantenimientos
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "creadoPorId" TEXT;
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "activa" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "desactivadoPorId" TEXT;
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "fechaDesactivacion" TIMESTAMP(3);
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "motivoDesactivacion" TEXT;
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "operadorAsignadoId" TEXT;
ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "ventanaAdelantoDias" INTEGER NOT NULL DEFAULT 0;

-- Las máquinas que ya estaban DE_BAJA quedan desactivadas
UPDATE "Maquinaria" SET "activa" = false WHERE "estadoOperativo" = 'DE_BAJA' AND "activa" = true;

-- Mantenimientos: fecha programada y de ejecución separadas, con responsables
ALTER TABLE "MantenimientoMaquinaria" ADD COLUMN IF NOT EXISTS "fechaProgramada" TIMESTAMP(3);
ALTER TABLE "MantenimientoMaquinaria" ADD COLUMN IF NOT EXISTS "fechaEjecucion" TIMESTAMP(3);
ALTER TABLE "MantenimientoMaquinaria" ADD COLUMN IF NOT EXISTS "creadoPorId" TEXT;
ALTER TABLE "MantenimientoMaquinaria" ADD COLUMN IF NOT EXISTS "ejecutadoPorId" TEXT;

UPDATE "MantenimientoMaquinaria" SET "fechaProgramada" = "fechaMantenimiento" WHERE "fechaProgramada" IS NULL;
UPDATE "MantenimientoMaquinaria"
   SET "fechaEjecucion" = "fechaMantenimiento", "ejecutadoPorId" = "tecnicoId"
 WHERE "estado" = 'FINALIZADO' AND "fechaEjecucion" IS NULL;

-- Evidencias: quién la subió y qué archivo es realmente
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "etapa" TEXT;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "s3Key" TEXT;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "tamanoBytes" INTEGER;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "duracionSeg" DOUBLE PRECISION;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "subidoPorId" TEXT;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "reemplazadaPorId" TEXT;
ALTER TABLE "EvidenciaIncidente" ADD COLUMN IF NOT EXISTS "activa" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "etapa" TEXT;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "s3Key" TEXT;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "tamanoBytes" INTEGER;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "duracionSeg" DOUBLE PRECISION;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "subidoPorId" TEXT;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "reemplazadaPorId" TEXT;
ALTER TABLE "EvidenciaMantenimiento" ADD COLUMN IF NOT EXISTS "activa" BOOLEAN NOT NULL DEFAULT true;

-- Línea de tiempo append-only
CREATE TABLE IF NOT EXISTS "MaquinariaEvento" (
    "id" TEXT NOT NULL,
    "maquinariaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "actorId" TEXT,
    "agenciaId" TEXT,
    "regionId" TEXT,
    "entidadId" TEXT,
    "datos" JSONB,
    "ocurridoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaquinariaEvento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MaquinariaEvento_maquinariaId_ocurridoEn_idx" ON "MaquinariaEvento"("maquinariaId", "ocurridoEn");
CREATE INDEX IF NOT EXISTS "MaquinariaEvento_tipo_idx" ON "MaquinariaEvento"("tipo");
CREATE INDEX IF NOT EXISTS "MaquinariaEvento_actorId_idx" ON "MaquinariaEvento"("actorId");
CREATE INDEX IF NOT EXISTS "MaquinariaEvento_regionId_idx" ON "MaquinariaEvento"("regionId");
CREATE INDEX IF NOT EXISTS "MaquinariaEvento_entidadId_idx" ON "MaquinariaEvento"("entidadId");

CREATE INDEX IF NOT EXISTS "Maquinaria_operadorAsignadoId_idx" ON "Maquinaria"("operadorAsignadoId");
CREATE INDEX IF NOT EXISTS "Maquinaria_activa_idx" ON "Maquinaria"("activa");
CREATE INDEX IF NOT EXISTS "MantenimientoMaquinaria_fechaProgramada_idx" ON "MantenimientoMaquinaria"("fechaProgramada");
CREATE INDEX IF NOT EXISTS "EvidenciaIncidente_subidoPorId_idx" ON "EvidenciaIncidente"("subidoPorId");
CREATE INDEX IF NOT EXISTS "EvidenciaMantenimiento_subidoPorId_idx" ON "EvidenciaMantenimiento"("subidoPorId");

-- Llaves foráneas
DO $$ BEGIN
  ALTER TABLE "Maquinaria" ADD CONSTRAINT "Maquinaria_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Maquinaria" ADD CONSTRAINT "Maquinaria_desactivadoPorId_fkey" FOREIGN KEY ("desactivadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Maquinaria" ADD CONSTRAINT "Maquinaria_operadorAsignadoId_fkey" FOREIGN KEY ("operadorAsignadoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MantenimientoMaquinaria" ADD CONSTRAINT "MantenimientoMaquinaria_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MantenimientoMaquinaria" ADD CONSTRAINT "MantenimientoMaquinaria_ejecutadoPorId_fkey" FOREIGN KEY ("ejecutadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EvidenciaIncidente" ADD CONSTRAINT "EvidenciaIncidente_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EvidenciaMantenimiento" ADD CONSTRAINT "EvidenciaMantenimiento_subidoPorId_fkey" FOREIGN KEY ("subidoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MaquinariaEvento" ADD CONSTRAINT "MaquinariaEvento_maquinariaId_fkey" FOREIGN KEY ("maquinariaId") REFERENCES "Maquinaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "MaquinariaEvento" ADD CONSTRAINT "MaquinariaEvento_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- La línea de tiempo no se edita ni se borra, ni siquiera por SQL directo
CREATE OR REPLACE FUNCTION "maquinaria_evento_inmutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MaquinariaEvento es append-only: no se permite % de eventos', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "maquinaria_evento_inmutable_trg" ON "MaquinariaEvento";
CREATE TRIGGER "maquinaria_evento_inmutable_trg"
  BEFORE UPDATE OR DELETE ON "MaquinariaEvento"
  FOR EACH ROW EXECUTE FUNCTION "maquinaria_evento_inmutable"();
