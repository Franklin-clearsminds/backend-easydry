-- El menú ya no se configura aparte: cada pantalla aparece si el rol tiene alguno de los permisos que la habilitan
-- (src/common/permisos/modulos-navegacion.ts). La columna "permisos" deja de decidir qué se ve.
--
-- "Reportes Operativos" no tenía un permiso propio (dashboard.ver lo tienen casi todos los roles), así que se crea
-- 'reportes.ver' y se otorga a todo rol que hoy tenga la pantalla, oficial o creado desde la plataforma.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'reportes.ver')
WHERE 'reportes' = ANY("permisos")
  AND NOT ('reportes.ver' = ANY("capacidades"));

-- "Asignación de Bahías" solo redirige a "Gestión de Lavadores": no es una pantalla propia.
UPDATE "modulos_sistema" SET "estado" = 0 WHERE "codigo" = 'asignaciones';
