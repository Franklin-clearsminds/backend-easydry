-- El pulidor y el líder ya podían ver y reportar la máquina que tienen asignada/en su agencia,
-- pero no podían ver sus mantenimientos (les faltaba la capacidad 'mantenimientos.ver'). Deriva
-- entre el código y la BD: se corrige agregando la capacidad solo si no la tenían ya, sin tocar
-- el resto de permisos que el Super Admin haya ajustado.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'mantenimientos.ver')
WHERE "namerol" IN ('PULIDOR', 'LIDER')
  AND NOT ('mantenimientos.ver' = ANY("capacidades"));

-- El pulidor también tenía el módulo "maquinaria" en el código pero no en la BD: sin el módulo
-- no llega ni a la pantalla desde la que reporta incidentes ni ve sus mantenimientos.
UPDATE "roles"
SET "permisos" = array_append("permisos", 'maquinaria')
WHERE "namerol" = 'PULIDOR'
  AND NOT ('maquinaria' = ANY("permisos"));
