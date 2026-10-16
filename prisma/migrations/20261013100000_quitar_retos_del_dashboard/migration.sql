-- El dashboard no tiene ningún bloque de retos: la casilla nunca tuvo pantalla. Se retira de los roles.
UPDATE "roles" SET "capacidades" = array_remove("capacidades", 'dashboard.retos.ver') WHERE 'dashboard.retos.ver' = ANY("capacidades");

-- Los retos de la app móvil (líder, aprobador, pulidor) pasan a tener su propia casilla en «Sistema», para no perderlos.
UPDATE "roles"
SET "capacidades" = array_append("capacidades", 'sistema.app.retos')
WHERE 'retos.ver' = ANY("capacidades") AND NOT ('sistema.app.retos' = ANY("capacidades"));
