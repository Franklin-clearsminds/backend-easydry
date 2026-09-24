import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn, IsArray, IsInt, Min, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMaquinariaDto {
  @ApiProperty({ example: 'HIDRO-001', description: 'Código único de la máquina' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ example: 'Hidrolavadora Kärcher HD 5/15 C', description: 'Nombre del equipo' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'HIDROLAVADORA', description: 'Tipo de máquina (HIDROLAVADORA, ASPIRADORA, COMPRESOR, ESPUMADORA, PULIDORA)' })
  @IsString()
  @IsNotEmpty()
  tipo: string;

  @ApiPropertyOptional({ example: 'Kärcher' })
  @IsOptional()
  @IsString()
  marca?: string;

  @ApiPropertyOptional({ example: 'HD 5/15 C' })
  @IsOptional()
  @IsString()
  modelo?: string;

  @ApiPropertyOptional({ example: 'SN-98234710' })
  @IsOptional()
  @IsString()
  serie?: string;

  @ApiPropertyOptional({ example: 'OPERATIVA', enum: ['OPERATIVA', 'EN_MANTENIMIENTO', 'DE_BAJA'] })
  @IsOptional()
  @IsString()
  estadoOperativo?: string;

  @ApiPropertyOptional({ example: 'https://bucket.easydry.com/maquinaria/hidro-001.jpg' })
  @IsOptional()
  @IsString()
  fotoUrl?: string;

  @ApiPropertyOptional({ description: 'URL S3 de la imagen de ficha técnica' })
  @IsOptional()
  @IsString()
  fichaTecnicaUrl?: string;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsNumber()
  horasUso?: number;

  @ApiPropertyOptional({ description: 'ID de la agencia a la que pertenece' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'ID de la bahía asignada' })
  @IsOptional()
  @IsString()
  bahiaId?: string;
}

export class UpdateMaquinariaDto {
  @ApiProperty({ description: 'ID de la maquinaria' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  marca?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  modelo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serie?: string;

  @ApiPropertyOptional({ enum: ['OPERATIVA', 'EN_MANTENIMIENTO', 'DE_BAJA'] })
  @IsOptional()
  @IsString()
  estadoOperativo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fotoUrl?: string;

  @ApiPropertyOptional({ description: 'URL S3 de la imagen de ficha técnica' })
  @IsOptional()
  @IsString()
  fichaTecnicaUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  horasUso?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bahiaId?: string;
}

export class ListMaquinariaDto {
  @ApiPropertyOptional({ description: 'Filtro por agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Filtro por bahía' })
  @IsOptional()
  @IsString()
  bahiaId?: string;

  @ApiPropertyOptional({ description: 'Filtro por tipo de máquina' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ description: 'Filtro por estado operativo' })
  @IsOptional()
  @IsString()
  estadoOperativo?: string;

  @ApiPropertyOptional({ description: 'Búsqueda por texto en código, nombre, marca o modelo' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class ReportarIncidenteDto {
  @ApiProperty({ description: 'ID de la máquina afectada' })
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiProperty({ example: 'Fuga de aceite en compresor principal' })
  @IsString()
  @IsNotEmpty()
  titulo: string;

  @ApiProperty({ example: 'El pistón número 2 gotea aceite de alta presión al superar 90 PSI.' })
  @IsString()
  @IsNotEmpty()
  descripcion: string;

  @ApiPropertyOptional({ example: 'ALTA', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] })
  @IsOptional()
  @IsString()
  gravedad?: string;

  @ApiPropertyOptional({ example: 'https://bucket.easydry.com/incidentes/inc-4819.jpg' })
  @IsOptional()
  @IsString()
  fotoEvidenciaUrl?: string;

  @ApiPropertyOptional({ description: 'URLs de fotos/videos del daño' })
  @IsOptional()
  @IsArray()
  evidencias?: Array<{ tipo: string; url: string; descripcion?: string }>;

  @ApiPropertyOptional({ description: 'ID del taller destino (nacional o regional)' })
  @IsOptional()
  @IsString()
  destinoTallerId?: string;
}

export class ResolverIncidenteDto {
  @ApiProperty({ description: 'ID del incidente' })
  @IsString()
  @IsNotEmpty()
  incidenteId: string;

  @ApiProperty({ example: 'Se sustituyó el retén del pistón 2 y se purgó el circuito con aceite ISO 68 nuevo.' })
  @IsString()
  @IsNotEmpty()
  solucion: string;

  @ApiPropertyOptional({ example: 'RESUELTO', enum: ['RESUELTO', 'CANCELADO'] })
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional({ description: 'Repuestos utilizados en la reparación' })
  @IsOptional()
  @IsString()
  repuestosUtilizados?: string;

  @ApiPropertyOptional({ description: 'Fotos, videos y PDFs de la reparación' })
  @IsOptional()
  @IsArray()
  evidencias?: Array<{ tipo: string; url: string; descripcion?: string }>;
}

export class ListIncidentesDto {
  @ApiPropertyOptional({ description: 'Filtro por máquina' })
  @IsOptional()
  @IsString()
  maquinariaId?: string;

  @ApiPropertyOptional({ description: 'Filtro por agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Filtro por estado (ABIERTO, EN_PROCESO, RESUELTO)' })
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional({ description: 'Filtro por gravedad' })
  @IsOptional()
  @IsString()
  gravedad?: string;
}

export class RegistrarMantenimientoDto {
  @ApiProperty({ description: 'ID de la máquina intervenida' })
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiPropertyOptional({ example: 'PREVENTIVO', enum: ['PREVENTIVO', 'CORRECTIVO'] })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ example: 'Cambio de sellos, aceite y ajuste de boquilla de lanza.' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Array de repuestos o insumos utilizados', example: [{ repuesto: 'Empacadura Viton', cantidad: 2, costo: 15.50 }] })
  @IsOptional()
  repuestosUsados?: any;

  @ApiPropertyOptional({ example: 45.00 })
  @IsOptional()
  @IsNumber()
  costoTotal?: number;

  @ApiPropertyOptional({ description: 'Fecha programada de la visita' })
  @IsOptional()
  @IsString()
  fechaProgramada?: string;

  @ApiPropertyOptional({ description: 'Fecha sugerida para el próximo mantenimiento' })
  @IsOptional()
  @IsString()
  proximoMantenimiento?: string;

  @ApiPropertyOptional({ description: 'Cada cuántos días se debe repetir. 0 = única vez' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  frecuenciaDias?: number;

  @ApiPropertyOptional({ description: 'Fotos, videos y PDFs. Opcional al agendar.' })
  @IsOptional()
  @IsArray()
  evidencias?: Array<{ tipo: string; url: string; descripcion?: string }>;

  @ApiPropertyOptional({ description: 'ID del técnico asignado (si no es el usuario actual)' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;
}

export class EjecutarMantenimientoDto {
  @ApiProperty({ description: 'ID del mantenimiento a ejecutar' })
  @IsString()
  @IsNotEmpty()
  mantenimientoId: string;

  @ApiPropertyOptional({ description: 'Informe del trabajo realizado' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaFin?: string;

  @ApiProperty({ description: 'Evidencias del trabajo. Debe incluir al menos una imagen.' })
  @IsArray()
  @ArrayMinSize(1)
  evidencias: Array<{ tipo: string; url: string; descripcion?: string }>;
}

export class ListMantenimientosDto {
  @ApiPropertyOptional({ description: 'Filtro por máquina' })
  @IsOptional()
  @IsString()
  maquinariaId?: string;

  @ApiPropertyOptional({ description: 'Filtro por técnico' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'Filtro por tipo' })
  @IsOptional()
  @IsString()
  tipo?: string;
}

export class AsignarIncidenteDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  incidenteId: string;

  @ApiPropertyOptional({ description: 'Técnico destino. Si se omite, se auto-asigna el usuario actual (Ejecutar yo).' })
  @IsOptional()
  @IsString()
  tecnicoId?: string;

  @ApiPropertyOptional({ description: 'Taller nacional o regional de destino' })
  @IsOptional()
  @IsString()
  destinoTallerId?: string;
}

export class AsignarMantenimientoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  mantenimientoId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tecnicoId?: string;
}

export class TransferirMaquinariaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  maquinariaId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  destinoAgenciaId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinoBahiaId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

export class ListMovimientosMaquinariaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  maquinariaId?: string;
}
