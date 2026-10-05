-- El líder operador y el pulidor pueden REGISTRAR la limpieza de su máquina desde la nueva pestaña
-- "Limpieza" de la ficha (ver maquinaria-detalle-modal), que ahora también muestra el historial de
-- esa máquina (GET /maquinaria/limpiezas/list). Les faltaba 'limpiezas.ver': sin él, el historial
-- respondía 403 ("Tu rol no tiene permiso para esta acción") aunque sí podían registrar. El alcance
-- ya estaba resuelto en scopeMaquinaria (líder: su agencia; pulidor: lo que tiene asignado), así que
-- no hace falta tocar módulos, solo la capacidad.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'limpiezas.ver')
WHERE "namerol" IN ('LIDER', 'PULIDOR')
  AND NOT ('limpiezas.ver' = ANY("capacidades"));
