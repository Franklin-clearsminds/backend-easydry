-- Quien ve las timbradas del equipo ve también los horarios de su alcance (solo lectura).
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY['pagina.rrhh-timbradas.horarios']::text[]
 WHERE 'pagina.rrhh-timbradas.equipo' = ANY (r."capacidades") AND NOT ('pagina.rrhh-timbradas.horarios' = ANY (r."capacidades"));
