-- Cédula (única) y ciudad del usuario, cargadas desde el listado de personal.
ALTER TABLE "User" ADD COLUMN "cedula" TEXT;
ALTER TABLE "User" ADD COLUMN "ciudad" TEXT;

CREATE UNIQUE INDEX "User_cedula_key" ON "User"("cedula");
