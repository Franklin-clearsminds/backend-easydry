-- «Registrar limpieza» también es una casilla de la página Maquinaria & Equipos (además de Taller > Limpiezas).
-- Quien ya podía registrar desde el taller y ve la página de maquinaria conserva la acción en ambos lugares.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['maquinaria.limpieza.registrar']))
WHERE 'taller.limpiezas.registrar' = ANY("capacidades") AND 'pagina.maquinaria' = ANY("capacidades");
