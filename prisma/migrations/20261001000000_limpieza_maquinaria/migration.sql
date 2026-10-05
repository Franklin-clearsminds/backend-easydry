-- Limpieza periódica de maquinaria: 2x/semana (miércoles y sábado) para las que están en una
-- agencia (la cumple el líder), diaria para las asignadas a un pulidor (la cumple ese pulidor).
-- Un registro por máquina y día (ver @@unique más abajo).
CREATE TABLE "LimpiezaMaquinaria" (
    "id" TEXT NOT NULL,
    "maquinariaId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "fotos" TEXT[],
    "observaciones" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimpiezaMaquinaria_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LimpiezaMaquinaria_maquinariaId_fecha_key" ON "LimpiezaMaquinaria"("maquinariaId", "fecha");
CREATE INDEX "LimpiezaMaquinaria_maquinariaId_idx" ON "LimpiezaMaquinaria"("maquinariaId");
CREATE INDEX "LimpiezaMaquinaria_fecha_idx" ON "LimpiezaMaquinaria"("fecha");

ALTER TABLE "LimpiezaMaquinaria" ADD CONSTRAINT "LimpiezaMaquinaria_maquinariaId_fkey" FOREIGN KEY ("maquinariaId") REFERENCES "Maquinaria"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LimpiezaMaquinaria" ADD CONSTRAINT "LimpiezaMaquinaria_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
