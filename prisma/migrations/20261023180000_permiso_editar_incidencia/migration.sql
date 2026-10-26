-- Editar una incidencia pasa a tener sus propias casillas (antes iba dentro de «resolver»). Quien ya podía editar lo sigue pudiendo:
-- el técnico solo la solución de las que tiene asignadas; los demás roles con «resolver», cualquier incidencia de su alcance.
UPDATE "roles"
   SET "capacidades" = array_append("capacidades", 'taller.incidentes.editar.asignadas')
 WHERE 'taller.incidentes.resolver' = ANY("capacidades")
   AND "namerol" = 'TECNICO'
   AND NOT ('taller.incidentes.editar.asignadas' = ANY("capacidades"));

UPDATE "roles"
   SET "capacidades" = array_append("capacidades", 'taller.incidentes.editar')
 WHERE 'taller.incidentes.resolver' = ANY("capacidades")
   AND "namerol" <> 'TECNICO'
   AND NOT ('taller.incidentes.editar' = ANY("capacidades"));
