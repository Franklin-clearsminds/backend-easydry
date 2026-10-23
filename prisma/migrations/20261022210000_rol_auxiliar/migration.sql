-- Auxiliar del líder: lavador de una bahía con las mismas capacidades del Líder Operador (uno por agencia).
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
  'AUXILIAR',
  'Auxiliar del líder: lavador de una bahía que, con las mismas capacidades del líder, opera su agencia (uno por agencia).',
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
