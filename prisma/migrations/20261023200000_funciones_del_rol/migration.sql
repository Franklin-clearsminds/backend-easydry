-- Las funciones del rol (líder, pulidor, técnico…) pasan a guardarse como permisos del rol en vez de deducirse del nombre.
-- Cada rol oficial recibe las suyas; un rol creado a mano queda como está (se le asignan desde «Roles y permisos»).

UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.administrador', 'pagina.sistema']) AS c) WHERE "namerol" = 'SUPER_ADMIN';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.administrador', 'pagina.sistema']) AS c) WHERE "namerol" = 'ADMIN';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.supervisor', 'pagina.sistema']) AS c) WHERE "namerol" = 'SUPERVISOR';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.coord_mantenimiento', 'pagina.sistema']) AS c) WHERE "namerol" = 'COORD_MANTENIMIENTO';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.coord_especiales', 'pagina.sistema']) AS c) WHERE "namerol" = 'COORD_SERVICIOS_ESPECIALES';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.comercial', 'pagina.sistema']) AS c) WHERE "namerol" = 'COORD_COMERCIAL';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.comercial', 'pagina.sistema']) AS c) WHERE "namerol" = 'JEFE_COMERCIAL';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.coord_bodega', 'pagina.sistema']) AS c) WHERE "namerol" = 'COORD_BODEGA';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.asistente_bodega', 'pagina.sistema']) AS c) WHERE "namerol" = 'ASISTENTE_BODEGA';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.tecnico', 'pagina.sistema']) AS c) WHERE "namerol" = 'TECNICO';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.pulidor', 'pagina.sistema']) AS c) WHERE "namerol" = 'PULIDOR';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.lider_agencia', 'funcion.lider', 'pagina.sistema']) AS c) WHERE "namerol" = 'LIDER';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.lider_agencia', 'funcion.backup', 'pagina.sistema']) AS c) WHERE "namerol" = 'BACKUP';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.lider_agencia', 'funcion.auxiliar', 'funcion.lavador', 'pagina.sistema']) AS c) WHERE "namerol" = 'AUXILIAR';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.lavador', 'pagina.sistema']) AS c) WHERE "namerol" = 'LAVADOR';
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.aprobador', 'pagina.sistema']) AS c) WHERE "namerol" = 'APROBADOR';
