-- El pulidor registra sus propias OT especiales: el pulidor fijo solo en su agencia y el móvil en cualquiera de su región (el alcance
-- lo resuelve el servidor). Antes tenía «ejecutar» pero no «crear», así que la app no le mostraba el botón de registrar.
UPDATE "roles"
   SET "capacidades" = array_append("capacidades", 'especiales.crear')
 WHERE "namerol" = 'PULIDOR'
   AND NOT ('especiales.crear' = ANY("capacidades"));

UPDATE "roles"
   SET "capacidades" = array_append("capacidades", 'servicios.especiales.crear')
 WHERE "namerol" = 'PULIDOR'
   AND NOT ('servicios.especiales.crear' = ANY("capacidades"));
