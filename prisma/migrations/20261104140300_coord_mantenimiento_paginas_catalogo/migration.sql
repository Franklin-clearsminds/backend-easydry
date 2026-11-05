-- Las páginas del catálogo que acompañan a «catalogo.ver» en el Coordinador de Mantenimiento (consulta, igual que en el resto de roles).
UPDATE "roles" r
   SET "capacidades" = r."capacidades" || ARRAY(
         SELECT c FROM unnest(ARRAY['pagina.catalogo', 'pagina.catalogo.generales', 'pagina.catalogo.especiales']) AS c WHERE NOT (c = ANY (r."capacidades")))
 WHERE r."namerol" = 'COORD_MANTENIMIENTO';
