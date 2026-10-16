-- Enlaza los archivos de un mismo lote de una familia (padre e hijos): se verifican y se borran juntos.
ALTER TABLE "archivado_lotes" ADD COLUMN "grupoId" TEXT;
CREATE INDEX "archivado_lotes_grupoId_idx" ON "archivado_lotes"("grupoId");
