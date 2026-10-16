-- Auditoría 5S con tres formatos (lista de 20 criterios, 25 criterios 0-4 y cuestionario SI/NO), guardados por separado.
-- Las auditorías hechas en una misma visita comparten `grupoId` y los datos de la visita. Lo que ya existía es el formato de 20 criterios.
ALTER TABLE "Auditoria5s" ADD COLUMN "formato" TEXT NOT NULL DEFAULT 'LISTA_20';
ALTER TABLE "Auditoria5s" ADD COLUMN "grupoId" TEXT;
ALTER TABLE "Auditoria5s" ADD COLUMN "equipoPersona" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Auditoria5s" ADD COLUMN "comentariosCategoria" JSONB;

DROP INDEX IF EXISTS "Auditoria5s_agenciaId_area_fecha_idx";
CREATE INDEX "Auditoria5s_agenciaId_area_formato_fecha_idx" ON "Auditoria5s"("agenciaId", "area", "formato", "fecha");
CREATE INDEX "Auditoria5s_grupoId_idx" ON "Auditoria5s"("grupoId");
