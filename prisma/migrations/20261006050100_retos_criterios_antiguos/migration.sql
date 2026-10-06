-- Retos creados con la redacción más antigua del criterio de autos ("Mayor Número de Vehículos Atendidos"):
-- se convierten igual que "Mayor cantidad de autos atendidos".
UPDATE "Reto" SET "metrica" = 'AUTOS'
WHERE "metrica" = 'SERVICIOS'
  AND lower("criterios"[1]) LIKE '%veh_culos atendidos%';
