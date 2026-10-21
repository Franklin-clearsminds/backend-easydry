-- La página «Dashboard de Auditorías» deja de existir (cada sección de auditorías ya trae sus propios indicadores).
-- Se retira su módulo y su permiso de los roles que los tenían guardados.
UPDATE "roles"
SET "capacidades" = array_remove(array_remove("capacidades", 'auditorias.ver'), 'pagina.auditorias')
WHERE 'auditorias.ver' = ANY("capacidades") OR 'pagina.auditorias' = ANY("capacidades");

UPDATE "roles"
SET "permisos" = array_remove("permisos", 'auditorias')
WHERE 'auditorias' = ANY("permisos");

DELETE FROM "modulos_sistema" WHERE "codigo" = 'auditorias';
