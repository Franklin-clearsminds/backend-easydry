-- «Reasignar pulidor» deja de ser una casilla aparte en servicios especiales: forma parte de «Editar OT especial».
-- Quien podía reasignar recibe «Editar OT especial» (con el permiso de reasignar y ver usuarios); después se retira el código antiguo.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['servicios.especiales.editar', 'especiales.editar', 'especiales.reasignar', 'usuarios.ver']))
WHERE 'servicios.especiales.reasignar' = ANY("capacidades") AND 'pagina.servicios.especiales' = ANY("capacidades");

UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'servicios.especiales.reasignar')
WHERE 'servicios.especiales.reasignar' = ANY("capacidades");
