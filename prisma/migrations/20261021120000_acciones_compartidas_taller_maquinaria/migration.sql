-- Reportar incidente, programar mantenimiento y registrar limpieza son una sola casilla compartida entre Maquinaria y Taller
-- (código taller.*). Subir evidencias deja de ser una casilla aparte: va con reportar o resolver incidente y con ejecutar mantenimiento.

-- 1) Los códigos de la página Maquinaria pasan al código compartido.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest(array_remove("capacidades", 'maquinaria.incidente.reportar') || ARRAY['taller.incidentes.reportar']))
WHERE 'maquinaria.incidente.reportar' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest(array_remove("capacidades", 'maquinaria.mantenimiento.programar') || ARRAY['taller.mantenimientos.programar']))
WHERE 'maquinaria.mantenimiento.programar' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest(array_remove("capacidades", 'maquinaria.limpieza.registrar') || ARRAY['taller.limpiezas.registrar']))
WHERE 'maquinaria.limpieza.registrar' = ANY("capacidades");

-- 2) Quien puede reportar o resolver incidentes, o ejecutar o editar mantenimientos, recibe el permiso de subir sus evidencias.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['maquinaria.evidencias']))
WHERE "capacidades" && ARRAY['taller.incidentes.reportar', 'taller.incidentes.resolver', 'taller.mantenimientos.ejecutar', 'taller.mantenimientos.editar'];

-- 3) Se retiran las casillas de evidencias que ya no existen.
UPDATE "roles"
SET "capacidades" = array_remove(array_remove("capacidades", 'taller.incidentes.evidencias'), 'taller.mantenimientos.evidencias')
WHERE "capacidades" && ARRAY['taller.incidentes.evidencias', 'taller.mantenimientos.evidencias'];
