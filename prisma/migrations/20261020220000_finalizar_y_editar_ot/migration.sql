-- Servicios: «Editar OT» pasa a ser una función real (corregir vehículo, cliente y observaciones) y «Finalizar OT» es una casilla aparte.
-- Quien tenía «Editar OT» (que solo servía para finalizar) conserva finalizar y mantiene editar; quien registra OT también finaliza;
-- «Editar OT especial» la reciben los que ya podían crear servicios especiales.

-- Finalizar: quien tenía editar o registrar.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['servicios.generales.finalizar', 'servicios.finalizar']))
WHERE ('servicios.generales.editar' = ANY("capacidades") OR 'servicios.generales.crear' = ANY("capacidades"))
  AND 'pagina.servicios.generales' = ANY("capacidades");

-- Quien registra OT también tiene el permiso de finalizar aunque no tenga la página de generales.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['servicios.finalizar']))
WHERE 'servicios.generales.crear' = ANY("capacidades");

-- Editar OT especial: quien crea servicios especiales.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['servicios.especiales.editar', 'especiales.editar']))
WHERE 'servicios.especiales.crear' = ANY("capacidades")
  AND 'pagina.servicios.especiales' = ANY("capacidades");
