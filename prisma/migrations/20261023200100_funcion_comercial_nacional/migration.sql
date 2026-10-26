-- El jefe comercial es comercial de todo el país: función propia para los avisos que reciben todas las regiones.
UPDATE "roles" SET "capacidades" = (SELECT COALESCE(array_agg(DISTINCT c), ARRAY[]::text[]) FROM unnest("capacidades" || ARRAY['funcion.comercial_nacional']) AS c) WHERE "namerol" = 'JEFE_COMERCIAL';
