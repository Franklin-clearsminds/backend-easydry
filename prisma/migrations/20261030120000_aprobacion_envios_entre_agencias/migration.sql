-- Un envío entre agencias que crea un líder queda pendiente de aprobación y no mueve stock hasta que se aprueba.
ALTER TYPE "EstadoDespacho" ADD VALUE IF NOT EXISTS 'PENDIENTE_APROBACION';

ALTER TABLE "MovimientoInventario"
  ADD COLUMN "requiereAprobacion" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aprobadoPorId" TEXT,
  ADD COLUMN "fechaAprobacion" TIMESTAMP(3),
  ADD COLUMN "motivoAprobacion" TEXT,
  ADD COLUMN "avisoAprobacionEn" TIMESTAMP(3);

-- Aprueban el administrador, el super administrador y el coordinador de bodega; otros roles se configuran desde Roles.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['envios.aprobar']))
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN', 'COORD_BODEGA');
