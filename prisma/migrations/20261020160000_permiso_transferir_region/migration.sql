-- «Transferir agencias entre regiones» es un permiso aparte (pestaña Regiones); «Transferir agencia» queda solo para el cambio de cliente.
-- Quien podía transferir agencias conserva el cambio de región: nadie gana ni pierde acceso.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['agencias.regiones.transferir', 'regiones.transferir']))
WHERE 'agencias.agencias.transferir' = ANY("capacidades") AND 'pagina.agencias.regiones' = ANY("capacidades");
