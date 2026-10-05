-- Nuevo permiso 'limpiezas.editar' (corregir observaciones o eliminar un registro de limpieza): admin,
-- super admin, supervisor regional y coordinador de mantenimiento, cada uno dentro de su propio alcance
-- (misma región que ya usan para ver la maquinaria). Se agrega solo si no lo tenían ya, sin tocar el
-- resto de permisos que el Super Admin haya ajustado desde la plataforma.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'limpiezas.editar')
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR', 'COORD_MANTENIMIENTO')
  AND NOT ('limpiezas.editar' = ANY("capacidades"));
