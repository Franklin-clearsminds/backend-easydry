-- Reportes Operativos genera un único reporte con botones Excel y PDF. Las casillas de exportar por tema nunca tuvieron pantalla:
-- se retiran. Quien ve la página conserva lo que ve y gana las dos casillas de exportar.
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['reportes.excel', 'reportes.pdf']))
WHERE 'pagina.reportes' = ANY("capacidades");

-- La exportación de limpiezas vive ahora con la sub-página Limpiezas de Taller Técnico.
UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'reportes.maquinaria.limpiezas')
WHERE 'reportes.maquinaria.limpiezas' = ANY("capacidades") AND NOT ('pagina.taller.limpiezas' = ANY("capacidades"));

UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT c FROM unnest("capacidades") AS c
  WHERE c NOT IN (
    'pagina.reportes.servicios', 'pagina.reportes.inventario', 'pagina.reportes.agencias', 'pagina.reportes.maquinaria', 'pagina.reportes.productividad',
    'reportes.servicios.generales', 'reportes.servicios.especiales', 'reportes.servicios.aprobaciones', 'reportes.servicios.catalogo',
    'reportes.inventario.productos', 'reportes.inventario.movimientos', 'reportes.inventario.consumo', 'reportes.inventario.envios',
    'reportes.agencias.agencias', 'reportes.agencias.operadores', 'reportes.agencias.usuarios',
    'reportes.maquinaria.maquinas', 'reportes.maquinaria.incidentes', 'reportes.maquinaria.mantenimientos',
    'reportes.productividad.ranking', 'reportes.productividad.dashboard'
  )
);
