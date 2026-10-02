-- Nuevo permiso 'limpiezas.ver' (auditoría de limpiezas de maquinaria): admin, super admin, supervisor
-- regional y los dos coordinadores (mantenimiento y servicios especiales), cada uno dentro de su propio
-- alcance (ya resuelto por el mismo scopeMaquinaria que usan para ver la maquinaria). Se agrega solo si
-- no lo tenían ya, sin tocar el resto de permisos que el Super Admin haya ajustado desde la plataforma.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'limpiezas.ver')
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR', 'COORD_MANTENIMIENTO', 'COORD_SERVICIOS_ESPECIALES')
  AND NOT ('limpiezas.ver' = ANY("capacidades"));
