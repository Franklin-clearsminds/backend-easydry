-- El Técnico de Maquinaria pasa de ámbito PROPIO a REGION: trabaja sobre la región que tiene asignada.
UPDATE "roles" SET "ambito" = 'REGION' WHERE "namerol" = 'TECNICO' AND "ambito" = 'PROPIO';

-- Los técnicos que ya existían sin región heredan la de su agencia para no quedarse sin datos.
UPDATE "User" u
SET "regionId" = a."regionId"
FROM "Agencia" a
WHERE u."agenciaId" = a."id"
  AND u."regionId" IS NULL
  AND a."regionId" IS NOT NULL
  AND u."roleId" IN (SELECT "id" FROM "roles" WHERE "namerol" = 'TECNICO');

-- El técnico ya no se vincula a una agencia: su ámbito es la región.
UPDATE "User"
SET "agenciaId" = NULL
WHERE "agenciaId" IS NOT NULL
  AND "roleId" IN (SELECT "id" FROM "roles" WHERE "namerol" = 'TECNICO');
