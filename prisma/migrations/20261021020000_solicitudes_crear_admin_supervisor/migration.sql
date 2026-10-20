-- «Aprobar servicio» otorga también «Crear solicitudes de aprobación»: Super Admin, Admin, Supervisor y Aprobador (que decide servicios) deben tenerlo activo para trabajar
-- con aprobaciones. Además, quien decide servicios con la página de Aprobaciones activa recibe la casilla «Aprobar servicio».
UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['solicitudes.crear']))
WHERE "namerol" IN ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'APROBADOR');

UPDATE "roles"
SET "capacidades" = ARRAY(SELECT DISTINCT unnest("capacidades" || ARRAY['aprobaciones.aprobar', 'solicitudes.crear']))
WHERE "namerol" IN ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'APROBADOR')
  AND 'pagina.aprobaciones' = ANY("capacidades")
  AND 'servicios.decidir' = ANY("capacidades");
