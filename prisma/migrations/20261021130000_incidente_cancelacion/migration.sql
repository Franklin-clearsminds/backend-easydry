-- Al cancelar una incidencia queda quién la canceló, cuándo y el motivo.
ALTER TABLE "IncidenteTecnico" ADD COLUMN "canceladoPorId" TEXT;
ALTER TABLE "IncidenteTecnico" ADD COLUMN "fechaCancelacion" TIMESTAMP(3);
ALTER TABLE "IncidenteTecnico" ADD COLUMN "motivoCancelacion" TEXT;
ALTER TABLE "IncidenteTecnico" ADD CONSTRAINT "IncidenteTecnico_canceladoPorId_fkey" FOREIGN KEY ("canceladoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Las canceladas anteriores guardaban el motivo en «solución» y a quien la cerró no se registraba: se toma de la línea de tiempo.
UPDATE "IncidenteTecnico" i
SET "motivoCancelacion" = i."solucion",
    "canceladoPorId" = e."actorId",
    "fechaCancelacion" = e."ocurridoEn"
FROM "MaquinariaEvento" e
WHERE i."estado" = 'CANCELADO' AND e."tipo" = 'INCIDENTE_CANCELADO' AND e."entidadId" = i."id";
