-- «Transferir agencia» (cambiar su región o cliente) pasa a ser un permiso aparte de «Crear agencia».
-- Quien podía crear agencias conserva la facultad de transferirlas: nadie gana ni pierde acceso.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['agencias.agencias.transferir', 'agencias.transferir']))
WHERE 'agencias.agencias.crear' = ANY("capacidades");
