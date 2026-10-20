-- Gestión de Lavadores: con la página activa se ve todo del lavador (ficha, productividad, cédula, correo y teléfono); ya no hay casilla de lectura aparte.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['datos.cedula.ver', 'datos.contacto.ver']))
WHERE 'pagina.operadores' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'operadores.ficha.ver')
WHERE 'operadores.ficha.ver' = ANY("capacidades");
