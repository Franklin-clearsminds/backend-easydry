UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'limpiezas.evidencias')
WHERE "namerol" IN ('LIDER', 'PULIDOR')
  AND 'maquinaria.evidencias' = ANY("capacidades")
  AND NOT 'limpiezas.evidencias' = ANY("capacidades");
