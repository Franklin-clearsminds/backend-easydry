-- «Crear OT especial» se divide en dos casillas independientes: «para mí» (la que ya existía) y «asignarla a otro pulidor», que también
-- permite reasignar el pulidor al editar. Los roles que ya podían crear o reasignar reciben las dos para no perder nada.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['servicios.especiales.asignar', 'especiales.asignar', 'especiales.reasignar', 'usuarios.ver']))
WHERE ("capacidades" && ARRAY['servicios.especiales.crear', 'especiales.reasignar'])
  AND 'pagina.servicios.especiales' = ANY("capacidades");

-- «Editar OT especial» ya no otorga por sí sola reasignar ni ver usuarios: eso viene con «asignar a otro».
UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'servicios.especiales.reasignar')
WHERE 'servicios.especiales.reasignar' = ANY("capacidades");
