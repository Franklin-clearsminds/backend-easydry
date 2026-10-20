-- Gestión de Lavadores ya no cambia el rol de nadie: el rol se elige al registrar. Se retira la casilla «Cambiar rol».
UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'operadores.rol')
WHERE 'operadores.rol' = ANY("capacidades");
