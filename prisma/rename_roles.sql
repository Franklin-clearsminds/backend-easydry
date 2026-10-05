-- Migración: Renombrar roles operacionales
-- OPERADOR → LAVADOR
-- LIDER_OPERADOR → LIDER

UPDATE "roles" SET "namerol" = 'LAVADOR' WHERE "namerol" = 'OPERADOR';
UPDATE "roles" SET "namerol" = 'LIDER'   WHERE "namerol" = 'LIDER_OPERADOR';

-- Verificación
SELECT "namerol", "estado" FROM "roles" ORDER BY "namerol";
