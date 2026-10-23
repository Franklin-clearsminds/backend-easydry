-- Si el jefe de taller no estuvo en la visita, el informe se firma y se guarda sin su contraseña ni su firma.
ALTER TABLE "InformeInspeccion" ADD COLUMN "jefeTallerPresente" BOOLEAN NOT NULL DEFAULT true;
