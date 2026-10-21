-- «Ver envíos y su estado» deja de ser una casilla aparte: activar la página Envíos & Confirmación basta para ver todos los
-- envíos de su ámbito. Los roles que ya tienen la página activa reciben el permiso de ver despachos.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['despachos.ver']))
WHERE 'pagina.envios' = ANY("capacidades") AND NOT ('despachos.ver' = ANY("capacidades"));
