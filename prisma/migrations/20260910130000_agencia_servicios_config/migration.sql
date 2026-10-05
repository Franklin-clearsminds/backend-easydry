-- AlterTable: config de servicios ofrecidos por la agencia (origen de verdad en base)
ALTER TABLE "Agencia" ADD COLUMN "tieneServiciosEspeciales" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agencia" ADD COLUMN "servicioIds" JSONB;
ALTER TABLE "Agencia" ADD COLUMN "serviciosNombres" JSONB;