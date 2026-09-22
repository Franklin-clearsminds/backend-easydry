-- Idempotency keys for every offline mutation and technical incident.
ALTER TABLE "SyncOutboxAudit" ADD COLUMN "mutationId" TEXT;
CREATE UNIQUE INDEX "SyncOutboxAudit_mutationId_key" ON "SyncOutboxAudit"("mutationId");

ALTER TABLE "IncidenteTecnico" ADD COLUMN "clientUuid" TEXT;
CREATE UNIQUE INDEX "IncidenteTecnico_clientUuid_key" ON "IncidenteTecnico"("clientUuid");
