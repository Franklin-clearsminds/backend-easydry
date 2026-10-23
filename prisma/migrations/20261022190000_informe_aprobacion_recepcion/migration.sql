-- La firma de recepción ya no se hace al elaborar el informe: un Admin o Super Admin lo aprueba, ya guardado, firmando la recepción.
-- Se guarda quién aprobó (la fecha ya existía en «aprobadoEn»).
ALTER TABLE "InformeInspeccion"
    ADD COLUMN "aprobadoPorId" TEXT,
    ADD COLUMN "aprobadoPorNombre" TEXT;

-- «Aprobar informes y firmar la recepción» es solo de Admin y Super Admin.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['informes.aprobar']))
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN');
