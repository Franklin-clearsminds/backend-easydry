-- Todos los mantenimientos son preventivos: se elimina el tipo de mantenimiento (el índice se elimina con la columna).
ALTER TABLE "MantenimientoMaquinaria" DROP COLUMN IF EXISTS "tipo";
