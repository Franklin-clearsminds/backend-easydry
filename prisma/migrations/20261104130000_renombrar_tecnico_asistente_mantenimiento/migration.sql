-- El rol TECNICO se muestra ahora como «Asistente de Mantenimiento». El código interno del rol no cambia; solo su descripción.
UPDATE "roles"
   SET "descripcion" = replace("descripcion", 'Técnico de maquinaria:', 'Asistente de mantenimiento:')
 WHERE "namerol" = 'TECNICO'
   AND "descripcion" LIKE 'Técnico de maquinaria:%';
