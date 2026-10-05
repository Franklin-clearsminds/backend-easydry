-- Dueño de cada error de sincronización (aditivo)
ALTER TABLE "SyncDeadLetterQueue" ADD COLUMN "usuarioId" TEXT;
CREATE INDEX "SyncDeadLetterQueue_usuarioId_idx" ON "SyncDeadLetterQueue"("usuarioId");
