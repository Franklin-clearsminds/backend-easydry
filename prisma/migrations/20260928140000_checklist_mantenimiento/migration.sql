-- Checklist de mantenimiento (aditivo)
CREATE TABLE "ChecklistPlantilla" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaPorId" TEXT,
    "creadaPorNombre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistPlantilla_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistPaso" (
    "id" TEXT NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ChecklistPaso_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChecklistRespuesta" (
    "id" TEXT NOT NULL,
    "mantenimientoId" TEXT NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "plantillaVersion" INTEGER NOT NULL,
    "orden" INTEGER NOT NULL,
    "texto" TEXT NOT NULL,
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "completado" BOOLEAN NOT NULL DEFAULT false,
    "observacion" TEXT,
    "marcadoPorId" TEXT,
    "marcadoPorNombre" TEXT,
    "marcadoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistRespuesta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChecklistPlantilla_tipo_version_key" ON "ChecklistPlantilla"("tipo", "version");
CREATE INDEX "ChecklistPlantilla_tipo_activa_idx" ON "ChecklistPlantilla"("tipo", "activa");
CREATE INDEX "ChecklistPaso_plantillaId_idx" ON "ChecklistPaso"("plantillaId");
CREATE INDEX "ChecklistRespuesta_mantenimientoId_idx" ON "ChecklistRespuesta"("mantenimientoId");

ALTER TABLE "ChecklistPaso" ADD CONSTRAINT "ChecklistPaso_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "ChecklistPlantilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChecklistRespuesta" ADD CONSTRAINT "ChecklistRespuesta_mantenimientoId_fkey" FOREIGN KEY ("mantenimientoId") REFERENCES "MantenimientoMaquinaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
