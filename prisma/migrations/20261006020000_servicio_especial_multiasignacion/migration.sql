CREATE TABLE "ServicioEspecialOperador" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServicioEspecialOperador_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicioEspecialOperador_servicioId_operadorId_key"
    ON "ServicioEspecialOperador"("servicioId", "operadorId");
CREATE INDEX "ServicioEspecialOperador_operadorId_idx"
    ON "ServicioEspecialOperador"("operadorId");
CREATE INDEX "ServicioEspecialOperador_servicioId_orden_idx"
    ON "ServicioEspecialOperador"("servicioId", "orden");

ALTER TABLE "ServicioEspecialOperador"
    ADD CONSTRAINT "ServicioEspecialOperador_servicioId_fkey"
    FOREIGN KEY ("servicioId") REFERENCES "ServicioEspecial"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicioEspecialOperador"
    ADD CONSTRAINT "ServicioEspecialOperador_operadorId_fkey"
    FOREIGN KEY ("operadorId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ServicioEspecialOperador" ("id", "servicioId", "operadorId", "orden")
SELECT gen_random_uuid()::text, "id", "operadorId", 0
FROM "ServicioEspecial"
WHERE "operadorId" IS NOT NULL
ON CONFLICT ("servicioId", "operadorId") DO NOTHING;
