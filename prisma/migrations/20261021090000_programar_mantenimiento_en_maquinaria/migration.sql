-- «Programar mantenimiento» también es una casilla de la página Maquinaria & Equipos (además de Taller > Mantenimientos).
-- Quien ya podía programar desde el taller y ve la página de maquinaria conserva la acción en ambos lugares.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['maquinaria.mantenimiento.programar']))
WHERE 'taller.mantenimientos.programar' = ANY("capacidades") AND 'pagina.maquinaria' = ANY("capacidades");
