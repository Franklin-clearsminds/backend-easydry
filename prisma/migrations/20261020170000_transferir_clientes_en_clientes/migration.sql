-- «Transferir agencias entre clientes» pasa a la pestaña Clientes (antes «Transferir agencia a otro cliente», en la pestaña Agencias).
-- Quien la tenía conserva el permiso si tiene la pestaña Clientes; después se retira el código antiguo.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['agencias.clientes.transferir', 'agencias.transferir']))
WHERE 'agencias.agencias.transferir' = ANY("capacidades") AND 'pagina.agencias.clientes' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'agencias.agencias.transferir')
WHERE 'agencias.agencias.transferir' = ANY("capacidades");
