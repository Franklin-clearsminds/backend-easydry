-- Celular del usuario (10 dígitos, 09XXXXXXXX): obligatorio para líderes y visible en la tabla de usuarios.
ALTER TABLE "User" ADD COLUMN "telefono" TEXT;
