-- Las contraseñas las gestionan solo el Administrador y el Super Administrador:
-- ya no existe el cambio de contraseña por el propio usuario ni la contraseña temporal.
ALTER TABLE "User" DROP COLUMN IF EXISTS "debeCambiarPassword";
