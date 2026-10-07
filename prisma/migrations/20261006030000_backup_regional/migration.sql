-- Backup comparte las capacidades del Líder Operador, con alcance regionalmente restringido por su agencia asignada.
INSERT INTO "roles" (
  "id",
  "namerol",
  "descripcion",
  "estado",
  "fechaModificacion",
  "permisos",
  "acciones",
  "capacidades",
  "ambito",
  "esSistema"
)
SELECT
  gen_random_uuid()::text,
  'BACKUP',
  'Líder Operador de reemplazo: pertenece a una región y cubre una agencia a la vez.',
  "estado",
  CURRENT_TIMESTAMP,
  "permisos",
  "acciones",
  "capacidades",
  'AGENCIA',
  true
FROM "roles"
WHERE "namerol" = 'LIDER'
ON CONFLICT ("namerol") DO NOTHING;

-- Permite administrar únicamente Backups mediante endpoints con autorización específica.
UPDATE "roles"
SET
  "capacidades" = CASE
    WHEN 'backup.gestionar' = ANY("capacidades") THEN "capacidades"
    ELSE array_append("capacidades", 'backup.gestionar')
  END,
  "permisos" = CASE
    WHEN 'usuarios' = ANY("permisos") THEN "permisos"
    ELSE array_append("permisos", 'usuarios')
  END
WHERE "namerol" = 'SUPERVISOR';

UPDATE "roles"
SET "capacidades" = CASE
  WHEN 'roles.ver' = ANY("capacidades") THEN "capacidades"
  ELSE array_append("capacidades", 'roles.ver')
END
WHERE "namerol" = 'SUPERVISOR';
