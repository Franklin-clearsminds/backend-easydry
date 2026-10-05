-- Contraseña temporal: el usuario debe cambiarla antes de usar el sistema (aditivo)
ALTER TABLE "User" ADD COLUMN "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT false;
