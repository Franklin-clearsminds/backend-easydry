ALTER TABLE "Reto"
ADD COLUMN "catalogoServicioId" INTEGER;

CREATE INDEX "Reto_catalogoServicioId_idx" ON "Reto"("catalogoServicioId");

CREATE INDEX "ServicioLavado_servicioCatalogoId_estado_horaSalida_idx"
ON "ServicioLavado"("servicioCatalogoId", "estado", "horaSalida");

ALTER TABLE "Reto"
ADD CONSTRAINT "Reto_catalogoServicioId_fkey"
FOREIGN KEY ("catalogoServicioId") REFERENCES "CatalogoServicio"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
