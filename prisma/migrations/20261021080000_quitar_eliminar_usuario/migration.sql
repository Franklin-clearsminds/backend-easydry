-- Los usuarios ya no se eliminan: solo se activan o se desactivan. Se retira la casilla «Eliminar usuario» de los roles que la tenían.
UPDATE "roles"
SET "capacidades" = array_remove("capacidades", 'usuarios.usuarios.eliminar')
WHERE 'usuarios.usuarios.eliminar' = ANY("capacidades");
