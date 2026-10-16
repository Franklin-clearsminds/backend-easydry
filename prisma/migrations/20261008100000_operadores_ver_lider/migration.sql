-- Nuevo permiso 'operadores.ver': ver los lavadores y pulidores fijos de la agencia (solo lectura).
-- El líder operador (y Backup, que opera como líder) pasan a solo ver a quién tienen asignado: se les quita
-- 'bahias.asignar' (asignar/quitar lavadores de bahía), que sigue disponible para admin y supervisor y se puede
-- devolver desde «Roles y Permisos».
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'operadores.ver')
WHERE "namerol" IN ('LIDER', 'BACKUP')
  AND NOT ('operadores.ver' = ANY("capacidades"));

UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'bahias.asignar')
WHERE "namerol" IN ('LIDER', 'BACKUP');
