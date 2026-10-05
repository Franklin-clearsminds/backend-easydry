CREATE TABLE "EvidenciaIncidente" (
    "id" TEXT NOT NULL,
    "incidenteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "descripcion" TEXT,
    "metadata" JSONB,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenciaIncidente_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EvidenciaIncidente_incidenteId_idx" ON "EvidenciaIncidente"("incidenteId");
CREATE INDEX "EvidenciaIncidente_tipo_idx" ON "EvidenciaIncidente"("tipo");

ALTER TABLE "EvidenciaIncidente"
ADD CONSTRAINT "EvidenciaIncidente_incidenteId_fkey"
FOREIGN KEY ("incidenteId") REFERENCES "IncidenteTecnico"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
