-- Por agencia: permitir o no registrar más de una OT en proceso en la misma bahía (por defecto se permite, como hasta ahora en el servidor).
ALTER TABLE "Agencia" ADD COLUMN IF NOT EXISTS "permiteVariasOtPorBahia" BOOLEAN NOT NULL DEFAULT true;
