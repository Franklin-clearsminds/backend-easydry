import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, IsNumber, IsArray, IsIn, Min, Max, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const TIPOS_EVENTO_MAQUINARIA = [
  'MAQUINA_CREADA',
  'MAQUINA_EDITADA',
  'MAQUINA_ACTIVADA',
  'MAQUINA_DESACTIVADA',
  'OPERADOR_ASIGNADO',
  'MOVIMIENTO',
  'INCIDENTE_REPORTADO',
  'INCIDENTE_ASIGNADO',
  'INCIDENTE_REPARADO',
  'INCIDENTE_CANCELADO',
  'INCIDENTE_EDITADO',
  'MANTENIMIENTO_PROGRAMADO',
  'MANTENIMIENTO_ASIGNADO',
  'MANTENIMIENTO_EJECUTADO',
  'MANTENIMIENTO_EDITADO',
  'EVIDENCIA_AGREGADA',
  'LIMPIEZA_REGISTRADA',
  'LIMPIEZA_EDITADA',
  'LIMPIEZA_ELIMINADA',
] as const;
export type TipoEventoMaquinaria = (typeof TIPOS_EVENTO_MAQUINARIA)[number];

/** Evidencia que el cliente ya subió a S3 con el ticket de /storage/ticket. */
export class EvidenciaInputDto {
  @ApiPropertyOptional({ description: 'Solo informativo; el servidor detecta el tipo real del archivo.' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiProperty({ description: 'URL pública o clave S3 devuelta por el ticket de subida' })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;
}

export class PaginacionDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class DetalleMaquinariaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class SetActivaMaquinariaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiProperty({ description: 'true = activar, false = desactivar (equivale a dar de baja)' })
  @IsBoolean()
  activa: boolean;

  @ApiPropertyOptional({ description: 'Obligatorio al desactivar' })
  @IsOptional()
  @IsString()
  motivo?: string;
}

export class AsignarOperadorDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiPropertyOptional({ description: 'Pulidor o líder operador. null/omitido = quitar la asignación.' })
  @IsOptional()
  @IsString()
  operadorId?: string | null;
}

export class ConfigurarVentanaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiPropertyOptional({ description: 'Días de adelanto permitidos para ejecutar un mantenimiento' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dias?: number;

  @ApiPropertyOptional({ description: 'Semanas de adelanto (se suman a los días)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  semanas?: number;
}

export class HistorialMaquinariaDto extends PaginacionDto {
  @ApiProperty({ description: 'ID de la máquina' })
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiPropertyOptional({ enum: TIPOS_EVENTO_MAQUINARIA, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(TIPOS_EVENTO_MAQUINARIA as unknown as string[], { each: true })
  tipos?: string[];

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional()
  @IsString()
  desde?: string;

  @ApiPropertyOptional({ description: 'ISO 8601, inclusive' })
  @IsOptional()
  @IsString()
  hasta?: string;

  @ApiPropertyOptional({ description: 'Solo eventos hechos por este usuario' })
  @IsOptional()
  @IsString()
  actorId?: string;
}

export class EditarIncidenteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  incidenteId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titulo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] })
  @IsOptional()
  @IsIn(['BAJA', 'MEDIA', 'ALTA', 'CRITICA'])
  gravedad?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  solucion?: string;

  @ApiPropertyOptional({ description: 'Corrección del costo de la reparación (solo ADMIN, SUPER_ADMIN o COORD_MANTENIMIENTO)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costoTotal?: number;
}

export class EditarMantenimientoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  mantenimientoId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  repuestosUsados?: unknown;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  costoTotal?: number;

  @ApiPropertyOptional({ description: 'Solo mientras no esté finalizado' })
  @IsOptional()
  @IsString()
  fechaProgramada?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  frecuenciaDias?: number;
}

export class AgregarEvidenciaDto {
  @ApiProperty({ enum: ['INCIDENTE', 'MANTENIMIENTO'] })
  @IsIn(['INCIDENTE', 'MANTENIMIENTO'])
  entidad: 'INCIDENTE' | 'MANTENIMIENTO';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  entidadId: string;

  @ApiPropertyOptional({ description: 'REPORTE o REPARACION (incidentes). Ignorado en mantenimientos.' })
  @IsOptional()
  @IsIn(['REPORTE', 'REPARACION'])
  etapa?: 'REPORTE' | 'REPARACION';

  @ApiProperty({ type: [EvidenciaInputDto] })
  @IsArray()
  evidencias: EvidenciaInputDto[];

  @ApiPropertyOptional({ description: 'Si reemplaza a otra evidencia, esta queda oculta pero nunca se borra.' })
  @IsOptional()
  @IsString()
  reemplazaEvidenciaId?: string;
}

export class RegistrarLimpiezaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiProperty({ type: [EvidenciaInputDto], description: 'Una o varias fotos de la limpieza realizada.' })
  @IsArray()
  fotos: EvidenciaInputDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Fecha (YYYY-MM-DD) que cubre esta limpieza. Por defecto, hoy.' })
  @IsOptional()
  @IsString()
  fecha?: string;
}

export class ListLimpiezasDto extends PaginacionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maquinariaId?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Desde (AAAA-MM-DD), inclusive' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaDesde debe ser AAAA-MM-DD' })
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Hasta (AAAA-MM-DD), inclusive' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaHasta debe ser AAAA-MM-DD' })
  fechaHasta?: string;
}

export class ExportarLimpiezasDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maquinariaId?: string;

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Desde (AAAA-MM-DD), inclusive' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaDesde debe ser AAAA-MM-DD' })
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Hasta (AAAA-MM-DD), inclusive' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fechaHasta debe ser AAAA-MM-DD' })
  fechaHasta?: string;
}

export class EditarLimpiezaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  limpiezaId: string;

  @ApiPropertyOptional({ description: 'Observaciones nuevas (vacío borra las actuales). Si se omite, no se tocan.' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class EliminarLimpiezaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  limpiezaId: string;

  @ApiPropertyOptional({ description: 'Por qué se elimina el registro (queda en la línea de tiempo).' })
  @IsOptional()
  @IsString()
  motivo?: string;
}
