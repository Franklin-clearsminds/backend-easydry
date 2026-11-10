-- El auxiliar copia los permisos del líder, así que también asigna tareas y ve las timbradas de su agencia.
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['rrhh.tareas.asignar', 'rrhh.timbradas.ver']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'AUXILIAR';

UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.rrhh-tareas.asignadas', 'pagina.rrhh-timbradas.equipo']::text[]) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'AUXILIAR' AND EXISTS (SELECT 1 FROM unnest(r."capacidades") x WHERE x LIKE 'pagina.%');
