-- Una firma vale para el contenido tal como estaba al firmar. Si el contenido del informe cambia, la firma deja de ser vigente y
-- la debe repetir la misma persona. Se guarda la huella del contenido firmado y si la firma sigue vigente.
ALTER TABLE "InformeFirma"
    ADD COLUMN "vigente" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "contenidoHash" TEXT;
