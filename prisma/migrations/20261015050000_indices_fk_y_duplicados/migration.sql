-- Índices de claves foráneas que no tenían uno que las cubriera (JOINs y borrados en cascada recorrían la tabla entera)

CREATE INDEX IF NOT EXISTS "RecetaInsumo_unidadConsumoId_idx" ON "RecetaInsumo"("unidadConsumoId");
CREATE INDEX IF NOT EXISTS "ServicioLavado_operadorId_idx" ON "ServicioLavado"("operadorId");
CREATE INDEX IF NOT EXISTS "RecetaInsumoHistorial_insumoId_idx" ON "RecetaInsumoHistorial"("insumoId");
CREATE INDEX IF NOT EXISTS "RecetaInsumoHistorial_usuarioId_idx" ON "RecetaInsumoHistorial"("usuarioId");
CREATE INDEX IF NOT EXISTS "PresentacionInsumo_unidadId_idx" ON "PresentacionInsumo"("unidadId");
CREATE INDEX IF NOT EXISTS "MotivoMovimientoInventario_tipoMovimientoId_idx" ON "MotivoMovimientoInventario"("tipoMovimientoId");
CREATE INDEX IF NOT EXISTS "MovimientoInventarioGlobal_unidadId_idx" ON "MovimientoInventarioGlobal"("unidadId");
CREATE INDEX IF NOT EXISTS "MovimientoInventarioGlobal_presentacionId_idx" ON "MovimientoInventarioGlobal"("presentacionId");
CREATE INDEX IF NOT EXISTS "MovimientoInventarioGlobal_responsableId_idx" ON "MovimientoInventarioGlobal"("responsableId");
CREATE INDEX IF NOT EXISTS "MovimientoInventarioGlobal_motivoId_idx" ON "MovimientoInventarioGlobal"("motivoId");
CREATE INDEX IF NOT EXISTS "Insumo_unidadMedidaId_idx" ON "Insumo"("unidadMedidaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_usuarioDespachaId_idx" ON "MovimientoInventario"("usuarioDespachaId");
CREATE INDEX IF NOT EXISTS "MovimientoInventario_usuarioRecibeId_idx" ON "MovimientoInventario"("usuarioRecibeId");
CREATE INDEX IF NOT EXISTS "FaltanteDespacho_insumoId_idx" ON "FaltanteDespacho"("insumoId");
CREATE INDEX IF NOT EXISTS "MovimientoDetalle_movimientoId_idx" ON "MovimientoDetalle"("movimientoId");
CREATE INDEX IF NOT EXISTS "MovimientoDetalle_insumoId_idx" ON "MovimientoDetalle"("insumoId");
CREATE INDEX IF NOT EXISTS "AlertaStock_insumoId_idx" ON "AlertaStock"("insumoId");
CREATE INDEX IF NOT EXISTS "AlertaStock_usuarioEmisorId_idx" ON "AlertaStock"("usuarioEmisorId");
CREATE INDEX IF NOT EXISTS "Maquinaria_creadoPorId_idx" ON "Maquinaria"("creadoPorId");
CREATE INDEX IF NOT EXISTS "Maquinaria_desactivadoPorId_idx" ON "Maquinaria"("desactivadoPorId");
CREATE INDEX IF NOT EXISTS "LimpiezaMaquinaria_registradoPorId_idx" ON "LimpiezaMaquinaria"("registradoPorId");
CREATE INDEX IF NOT EXISTS "IncidenteTecnico_resueltoPorId_idx" ON "IncidenteTecnico"("resueltoPorId");
CREATE INDEX IF NOT EXISTS "MantenimientoMaquinaria_creadoPorId_idx" ON "MantenimientoMaquinaria"("creadoPorId");
CREATE INDEX IF NOT EXISTS "MantenimientoMaquinaria_ejecutadoPorId_idx" ON "MantenimientoMaquinaria"("ejecutadoPorId");
CREATE INDEX IF NOT EXISTS "MovimientoMaquinaria_usuarioId_idx" ON "MovimientoMaquinaria"("usuarioId");
CREATE INDEX IF NOT EXISTS "KardexMovimiento_usuarioId_idx" ON "KardexMovimiento"("usuarioId");
CREATE INDEX IF NOT EXISTS "SolicitudAprobacion_solicitanteId_idx" ON "SolicitudAprobacion"("solicitanteId");
CREATE INDEX IF NOT EXISTS "SolicitudAprobacion_aprobadorId_idx" ON "SolicitudAprobacion"("aprobadorId");
CREATE INDEX IF NOT EXISTS "HistorialAsignacionBahia_asignadoPorId_idx" ON "HistorialAsignacionBahia"("asignadoPorId");
CREATE INDEX IF NOT EXISTS "BahiaOperador_asignadoPorId_idx" ON "BahiaOperador"("asignadoPorId");
CREATE INDEX IF NOT EXISTS "ServicioEspecial_servicioCatalogoId_idx" ON "ServicioEspecial"("servicioCatalogoId");
CREATE INDEX IF NOT EXISTS "archivado_lotes_corridaId_idx" ON "archivado_lotes"("corridaId");

-- Índices duplicados: la restricción UNIQUE de la misma columna ya crea un índice igual

DROP INDEX IF EXISTS "roles_namerol_idx";
DROP INDEX IF EXISTS "User_email_idx";
DROP INDEX IF EXISTS "ServicioLavado_clientUuid_idx";
DROP INDEX IF EXISTS "TipoEnvase_codigo_idx";
DROP INDEX IF EXISTS "TipoProducto_codigo_idx";
DROP INDEX IF EXISTS "UnidadMedida_codigo_idx";
DROP INDEX IF EXISTS "TipoMovimientoInventario_codigo_idx";
DROP INDEX IF EXISTS "MotivoMovimientoInventario_codigo_idx";
DROP INDEX IF EXISTS "Insumo_codigoSKU_idx";
DROP INDEX IF EXISTS "MovimientoInventario_numeroGuia_idx";
DROP INDEX IF EXISTS "SyncDevice_deviceId_idx";
DROP INDEX IF EXISTS "ServicioEspecial_clientUuid_idx";
DROP INDEX IF EXISTS "ServicioEspecial_codigoSE_idx";
