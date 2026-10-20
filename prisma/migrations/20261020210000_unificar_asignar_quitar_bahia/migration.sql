-- Gestión de Lavadores: «Asignar a bahía» y «Quitar de bahía» se unifican en «Asignar y quitar de bahía».
-- Quien tenía cualquiera de las dos recibe la unificada; después se retira el código antiguo.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['operadores.bahia.asignar', 'bahias.asignar']))
WHERE 'operadores.bahia.quitar' = ANY("capacidades") AND 'pagina.operadores' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'operadores.bahia.quitar')
WHERE 'operadores.bahia.quitar' = ANY("capacidades");
