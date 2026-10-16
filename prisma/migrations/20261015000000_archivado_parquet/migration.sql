-- Archivado de datos viejos a Parquet en S3: corridas del job y lotes (un .parquet verificado cada uno).
CREATE TABLE "archivado_corridas" (
    "id" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fin" TIMESTAMP(3),
    "estado" TEXT NOT NULL DEFAULT 'EN_CURSO',
    "simulacro" BOOLEAN NOT NULL DEFAULT false,
    "resumen" JSONB,
    "error" TEXT,

    CONSTRAINT "archivado_corridas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archivado_lotes" (
    "id" TEXT NOT NULL,
    "corridaId" TEXT,
    "tabla" TEXT NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "parte" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "filas" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "esquemaVersion" INTEGER NOT NULL,
    "fechaMin" TIMESTAMP(3) NOT NULL,
    "fechaMax" TIMESTAMP(3) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'SUBIDO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "borradoEn" TIMESTAMP(3),

    CONSTRAINT "archivado_lotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archivado_lotes_tabla_clave_key" ON "archivado_lotes"("tabla", "clave");
CREATE INDEX "archivado_lotes_tabla_anio_mes_idx" ON "archivado_lotes"("tabla", "anio", "mes");
CREATE INDEX "archivado_lotes_estado_idx" ON "archivado_lotes"("estado");
CREATE INDEX "archivado_corridas_inicio_idx" ON "archivado_corridas"("inicio");

ALTER TABLE "archivado_lotes" ADD CONSTRAINT "archivado_lotes_corridaId_fkey" FOREIGN KEY ("corridaId") REFERENCES "archivado_corridas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
