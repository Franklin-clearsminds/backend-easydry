-- Sello del jefe de taller por agencia y usuarios adjuntos a un informe (reciben una notificación al aprobarse).

ALTER TYPE "TipoNotificacion" ADD VALUE IF NOT EXISTS 'INFORME_INSPECCION_APROBADO';

-- Las agencias empiezan sin sello: un Admin las asigna desde la pantalla de Sellos.
ALTER TABLE "Agencia" ADD COLUMN "selloId" TEXT;
CREATE INDEX "Agencia_selloId_idx" ON "Agencia"("selloId");
ALTER TABLE "Agencia" ADD CONSTRAINT "Agencia_selloId_fkey" FOREIGN KEY ("selloId") REFERENCES "sellos_jefe_taller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "informe_adjuntos" (
    "id" TEXT NOT NULL,
    "informeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agregadoPorId" TEXT,
    "agregadoPorNombre" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificadoEn" TIMESTAMP(3),

    CONSTRAINT "informe_adjuntos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "informe_adjuntos_informeId_userId_key" ON "informe_adjuntos"("informeId", "userId");
CREATE INDEX "informe_adjuntos_userId_idx" ON "informe_adjuntos"("userId");
ALTER TABLE "informe_adjuntos" ADD CONSTRAINT "informe_adjuntos_informeId_fkey" FOREIGN KEY ("informeId") REFERENCES "InformeInspeccion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "informe_adjuntos" ADD CONSTRAINT "informe_adjuntos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
