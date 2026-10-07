-- Retos parametrizables: en vez de criterios fijos, quien crea el reto elige quiénes compiten, qué servicios cuentan,
-- qué se mide y cómo se gana.
ALTER TABLE "Reto"
  ADD COLUMN "tipoServicios" TEXT NOT NULL DEFAULT 'TODOS',
  ADD COLUMN "metrica" TEXT NOT NULL DEFAULT 'SERVICIOS',
  ADD COLUMN "modoGanador" TEXT NOT NULL DEFAULT 'RANKING',
  ADD COLUMN "cantidadGanadores" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "meta" DECIMAL(12,2),
  ADD COLUMN "bahiasIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lavadoresIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "ganadores" JSONB;

-- Los retos existentes se convierten con su PRIMER criterio, conservando lo que contaban antes:
-- los de agencias solo contaban servicios generales; los de pulidores, especiales.
UPDATE "Reto" SET "tipoServicios" = CASE WHEN "tipoReto" = 'PULIDOR' THEN 'ESPECIALES' ELSE 'GENERALES' END;

UPDATE "Reto" SET "tipoServicios" = 'ESPECIFICOS'
WHERE "criterios"[1] = 'Mayor cantidad de servicios de un tipo'
  AND cardinality("catalogoServicioIds") > 0;

UPDATE "Reto" SET "metrica" = 'AUTOS'
WHERE "criterios"[1] = 'Mayor cantidad de autos atendidos';

-- "Servicios por bahía" en un reto de agencias era, en realidad, una competencia entre bahías.
UPDATE "Reto" SET "tipoReto" = 'BAHIA'
WHERE "tipoReto" = 'AGENCIA' AND "criterios"[1] = 'Mayor cantidad de servicios por bahía';
