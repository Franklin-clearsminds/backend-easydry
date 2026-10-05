-- Costo de reparación de una incidencia técnica (análogo a MantenimientoMaquinaria.costoTotal, que ya
-- existía). Se vuelve obligatorio al resolver (estado RESUELTO) validado en el servicio, no aquí.
ALTER TABLE "IncidenteTecnico" ADD COLUMN     "costoTotal" DECIMAL(10,2);
