-- «Crear bahía» y «Activar o desactivar bahía» dejan de ser una casilla aparte: cambiar la cantidad de bahías forma parte de «Editar datos de la agencia».
-- Quien podía crear bahías conserva ese acceso a través de editar la agencia; después se retiran los códigos que ya no existen.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['agencias.agencias.editar', 'agencias.editar', 'bahias.editar']))
WHERE ('agencias.bahias.crear' = ANY("capacidades") OR 'agencias.bahias.estado' = ANY("capacidades")) AND 'pagina.agencias.agencias' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = ARRAY(SELECT c FROM unnest("capacidades") AS c WHERE c NOT IN ('agencias.bahias.crear', 'agencias.bahias.estado', 'bahias.crear'))
WHERE "capacidades" && ARRAY['agencias.bahias.crear', 'agencias.bahias.estado', 'bahias.crear'];
