-- Permisos exigidos por el backend, ámbito y marca de rol oficial (aditivo)
ALTER TABLE "roles" ADD COLUMN "capacidades" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "roles" ADD COLUMN "ambito" TEXT NOT NULL DEFAULT 'AGENCIA';
ALTER TABLE "roles" ADD COLUMN "esSistema" BOOLEAN NOT NULL DEFAULT false;
