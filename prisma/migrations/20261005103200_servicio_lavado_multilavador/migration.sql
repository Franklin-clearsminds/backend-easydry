CREATE TABLE "ServicioLavadoOperador" (
    "id" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "operadorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServicioLavadoOperador_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServicioLavadoOperador_servicioId_operadorId_key"
    ON "ServicioLavadoOperador"("servicioId", "operadorId");
CREATE INDEX "ServicioLavadoOperador_operadorId_idx"
    ON "ServicioLavadoOperador"("operadorId");

ALTER TABLE "ServicioLavadoOperador"
    ADD CONSTRAINT "ServicioLavadoOperador_servicioId_fkey"
    FOREIGN KEY ("servicioId") REFERENCES "ServicioLavado"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServicioLavadoOperador"
    ADD CONSTRAINT "ServicioLavadoOperador_operadorId_fkey"
    FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ServicioLavadoOperador" ("id", "servicioId", "operadorId")
SELECT gen_random_uuid()::text, "id", "operadorId"
FROM "ServicioLavado";
