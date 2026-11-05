-- Nuevo permiso 'limpiezas.fotos' (abrir las fotos de evidencia de las limpiezas de maquinaria): solo la supervisión
-- (supervisor regional, admin y super admin). El líder, backup, auxiliar y pulidor siguen registrando limpiezas pero ya no
-- abren las fotos. Se agrega solo si no lo tenían, sin tocar el resto de permisos ajustados desde la plataforma.
UPDATE "roles"
SET "capacidades" = array_append(array_append("capacidades", 'limpiezas.fotos'), 'taller.limpiezas.fotos')
WHERE "namerol" IN ('ADMIN', 'SUPER_ADMIN', 'SUPERVISOR')
  AND NOT ('limpiezas.fotos' = ANY("capacidades"));
