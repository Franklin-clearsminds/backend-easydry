import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Solo documentación (Swagger): describe el cuerpo de `storage/ticket`, `storage/upload` y `sync/media/ticket`.
 * No se usa como tipo del parámetro, así que no cambia la validación en ejecución.
 */
export class UploadTicketDocDto {
  @ApiProperty({
    description: 'Tipo de evidencia',
    enum: [
      'FOTO_INGRESO', 'FOTO_SALIDA', 'FOTO_DANO_PREVIO', 'FOTO_PROCESO', 'VIDEO_INSPECCION', 'VIDEO_INICIAL', 'VIDEO_FINAL',
      'VIDEO_PAUSA', 'VIDEO_REANUDAR', 'FOTO_MAQUINA', 'FOTO_LIMPIEZA', 'FICHA_TECNICA', 'DOCUMENTO', 'FOTO_INCIDENTE',
      'VIDEO_INCIDENTE', 'DOCUMENTO_INCIDENTE', 'PDF_CIERRE', 'IMAGEN_PRODUCTO', 'FOTO_AJUSTE_INVENTARIO',
      'FOTO_INGRESO_INVENTARIO', 'FOTO_ENVIO', 'FOTO_AUDITORIA', 'FOTO_PERFIL',
    ],
  })
  type!: string;

  @ApiPropertyOptional({
    description: 'Carpeta lógica del archivo; si falta se deduce del tipo',
    enum: [
      'SERVICIOS_GENERALES', 'SERVICIOS_ESPECIALES', 'MAQUINARIA_IMAGEN', 'MAQUINARIA_FICHA', 'MAQUINARIA_INCIDENTE',
      'MAQUINARIA_MANTENIMIENTO', 'MAQUINARIA_LIMPIEZA', 'DOCUMENTO', 'CATALOGO_INSUMOS', 'INVENTARIO_ENVIOS', 'AUDITORIAS',
      'PERFIL_USUARIO',
    ],
  })
  category?: string;

  @ApiPropertyOptional({ description: 'UUID generado por el cliente (idempotencia offline). Con FOTO_PERFIL se ignora y se usa el id del usuario' })
  clientUuid?: string;

  @ApiPropertyOptional({ description: 'Agencia dueña de la evidencia (UUID, nombre o código)' })
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Servicio u orden de trabajo al que pertenece' })
  servicioId?: string;

  @ApiPropertyOptional({ description: 'Máquina a la que pertenece' })
  maquinariaId?: string;

  @ApiPropertyOptional()
  maquinariaNombre?: string;

  @ApiPropertyOptional()
  maquinariaCodigo?: string;

  @ApiPropertyOptional({ description: 'Incidente al que pertenece' })
  incidenteId?: string;

  @ApiPropertyOptional({ enum: ['reporte', 'reparacion', 'fallas', 'resoluciones'], description: "'fallas' y 'resoluciones' son alias antiguos" })
  incidenteFase?: string;

  @ApiPropertyOptional({ description: 'Mantenimiento al que pertenece' })
  mantenimientoId?: string;

  @ApiPropertyOptional()
  insumoId?: string;

  @ApiPropertyOptional()
  insumoNombre?: string;

  @ApiPropertyOptional({ description: 'Número de guía del envío (evidencias de envíos)' })
  envioGuia?: string;

  @ApiPropertyOptional({ enum: ['envio', 'recepcion', 'rechazo', 'resolucion'] })
  envioEtapa?: string;

  @ApiPropertyOptional({ enum: ['informes', '5s'], description: 'Módulo de la evidencia de auditoría' })
  auditoriaTipo?: string;

  @ApiPropertyOptional({ description: 'Informe o auditoría al que pertenece; si aún no existe se guarda como «borrador»' })
  auditoriaId?: string;

  @ApiPropertyOptional({ description: 'Nombre del archivo original' })
  fileName?: string;

  @ApiPropertyOptional({ example: 'image/jpeg', description: 'MIME del archivo' })
  contentType?: string;
}

/** Solo documentación (Swagger): cuerpo de `sync/media/confirm`. */
export class ConfirmarMediaDocDto {
  @ApiProperty({ description: 'UUID generado por el cliente' })
  clientUuid!: string;

  @ApiProperty({ description: 'Tipo de evidencia (mismo catálogo que el ticket de subida)' })
  type!: string;

  @ApiProperty({ description: 'URL o clave del archivo ya subido a S3' })
  fileUrl!: string;

  @ApiPropertyOptional()
  category?: string;

  @ApiPropertyOptional()
  maquinariaId?: string;

  @ApiPropertyOptional()
  incidenteId?: string;

  @ApiPropertyOptional()
  servicioId?: string;

  @ApiPropertyOptional({ enum: ['START', 'PAUSE', 'RESUME', 'FINISH'], description: 'Acción de servicio especial que acompaña a la evidencia' })
  specialAction?: string;

  @ApiPropertyOptional()
  specialOperatorId?: string;

  @ApiPropertyOptional({ description: 'Motivo de la pausa (con PAUSE)' })
  pauseReason?: string;

  @ApiPropertyOptional({ description: 'Notas al reanudar (con RESUME)' })
  resumeNotes?: string;

  @ApiPropertyOptional({ description: 'Momento de la captura (ISO 8601)' })
  capturedAt?: string;
}

/** Solo documentación (Swagger): cuerpo de las rutas que reciben únicamente un `id`. */
export class IdDocDto {
  @ApiProperty({ description: 'ID del registro' })
  id!: string;
}
