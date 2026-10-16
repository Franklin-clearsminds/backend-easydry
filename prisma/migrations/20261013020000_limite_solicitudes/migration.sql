-- Contadores del límite de peticiones compartidos entre instancias del servidor.
CREATE TABLE "LimiteSolicitud" (
    "clave" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimiteSolicitud_pkey" PRIMARY KEY ("clave")
);

CREATE INDEX "LimiteSolicitud_expiraEn_idx" ON "LimiteSolicitud"("expiraEn");
