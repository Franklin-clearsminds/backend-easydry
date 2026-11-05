-- Aprobador: sin informes de inspección ni auditorías 5S, y con el reporte de sus servicios solo en PDF
-- (el servidor lo limita a servicios generales y especiales y a los últimos 30 días).
UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT DISTINCT c FROM unnest(
    array_remove(array_remove(array_remove(array_remove(array_remove(array_remove(array_remove(array_remove(array_remove(
      "capacidades",
      'informes.ver'), 'informes.crear'), 'informes.firmar'), 'informes.seguimiento'),
      'inspecciones.ver'), 'inspecciones.crear'), 'inspecciones.acciones'),
      'pagina.informes'), 'pagina.inspecciones')
    || ARRAY['pagina.reportes', 'reportes.ver', 'reportes.pdf']
  ) AS c
)
WHERE "namerol" = 'APROBADOR';
