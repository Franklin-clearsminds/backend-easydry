-- "Marca" fue reemplazada por "Cliente" (Agencia.clienteId). Se elimina la estructura antigua que quedó en la base:
-- la tabla "Marca" (vacía) y la columna Agencia."marcaId" (sin valores), con su llave foránea e índice.
-- `marcaId` sigue aceptándose en la API solo como alias de entrada de `clienteId`.
ALTER TABLE "Agencia" DROP CONSTRAINT IF EXISTS "Agencia_marcaId_fkey";
DROP INDEX IF EXISTS "Agencia_marcaId_idx";
ALTER TABLE "Agencia" DROP COLUMN IF EXISTS "marcaId";
DROP TABLE IF EXISTS "Marca";
