-- Bloqueo de login por correo persistido en la base y revocación de access tokens al cambiar la contraseña.
ALTER TABLE "User" ADD COLUMN "sesionesRevocadasAt" TIMESTAMP(3);

CREATE TABLE "LoginIntento" (
    "email" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginIntento_pkey" PRIMARY KEY ("email")
);
