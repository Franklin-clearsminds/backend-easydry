-- Se retiran casillas que nunca tuvieron botón en ninguna pantalla. «Activar o desactivar bahía» ya cubre el botón de bahías.
UPDATE "roles"
SET "capacidades" = ARRAY(
  SELECT c FROM unnest("capacidades") AS c
  WHERE c NOT IN ('servicios.generales.consumos', 'servicios.generales.bahias', 'servicios.generales.solicitudes', 'servicios.generales.solicitar',
                  'aprobaciones.solicitudes.ver', 'aprobaciones.solicitudes.crear', 'agencias.bahias.editar')
);
