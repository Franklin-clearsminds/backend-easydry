-- Bandera derivada «registrarServicio» del pulidor: ahora que puede crear sus OT especiales (especiales.crear), queda en verdadero.
UPDATE "roles"
   SET "acciones" = jsonb_set("acciones"::jsonb, '{registrarServicio}', 'true'::jsonb)
 WHERE "namerol" = 'PULIDOR'
   AND "acciones" IS NOT NULL;
