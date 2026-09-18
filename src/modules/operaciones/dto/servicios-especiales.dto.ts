import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueryServicioEspecialDto {
  @ApiPropertyOptional({ description: 'ID de agencia' })
  @IsString()
  @IsOptional()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Alias de agenciaId' })
  @IsString()
  @IsOptional()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'ID de región (para filtrado por zona)' })
  @IsString()
  @IsOptional()
  regionId?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor / operador asignado' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'Estado: Pendiente, En Proceso, Completado, Cancelado' })
  @IsString()
  @IsOptional()
  estado?: string;

  @ApiPropertyOptional({ description: 'Tipo: Pulido, Micro Pulido, Cerámico, Lavado de motor' })
  @IsString()
  @IsOptional()
  tipoServicio?: string;

  @ApiPropertyOptional({ description: 'Búsqueda por placa, código o cliente' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  pageSize?: number;
}

export class CreateServicioEspecialDto {
  @ApiPropertyOptional({ description: 'UUID único originado offline en móvil' })
  @IsString()
  @IsOptional()
  clientUuid?: string;

  @ApiPropertyOptional({ description: 'Código único ej: SE-2026-001 (se autogenera si se omite)' })
  @IsString()
  @IsOptional()
  codigoSE?: string;

  @ApiProperty({ description: 'Tipo de servicio especial', example: 'Pulido y Recubrimiento Cerámico' })
  @IsString()
  @IsNotEmpty()
  tipoServicio: string;

  @ApiProperty({
    description: 'Información del vehículo y cliente',
    example: { placa: 'PBA-1234', marca: 'Toyota', modelo: 'Corolla', color: 'Gris', cliente: 'Carlos Perez' },
  })
  @IsNotEmpty()
  vehiculoInfo: Record<string, any>;

  @ApiPropertyOptional({ description: 'ID de la agencia (opcional para servicios móviles zonales)' })
  @IsString()
  @IsOptional()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'ID de la región asignada (Sierra / Costa)' })
  @IsString()
  @IsOptional()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Nombre textual de la región' })
  @IsString()
  @IsOptional()
  regionNombre?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor especialista asignado' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'Prioridad: Baja, Media, Alta, Urgente', default: 'Media' })
  @IsString()
  @IsOptional()
  prioridad?: string;

  @ApiPropertyOptional({ description: 'URL del video de inspección inicial (opcional en creación)' })
  @IsString()
  @IsOptional()
  videoInicialUrl?: string;

  @ApiPropertyOptional({ description: 'Receta de químicos estimados' })
  @IsOptional()
  recetaInsumos?: any;

  @ApiPropertyOptional({ description: 'Evidencias fotográficas' })
  @IsOptional()
  evidencias?: any;

  @ApiPropertyOptional({ description: 'Observaciones o requerimientos específicos del cliente' })
  @IsString()
  @IsOptional()
  observaciones?: string;
}

export class IniciarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'ID del operador que inicia' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'URL o evidencia del Video Inicial obligatorio de inspección' })
  @IsString()
  @IsOptional()
  videoInicialUrl?: string;
}

export class CompletarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'URL o evidencia del Video Final obligatorio de entrega' })
  @IsString()
  @IsOptional()
  videoFinalUrl?: string;

  @ApiPropertyOptional({ description: 'Evidencias fotográficas finales (fotos después)' })
  @IsOptional()
  evidencias?: any;

  @ApiPropertyOptional({ description: 'Calificación de calidad (1 a 5 estrellas)' })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  calificacionCalidad?: number;

  @ApiPropertyOptional({ description: 'Observaciones finales de entrega' })
  @IsString()
  @IsOptional()
  observaciones?: string;
}

export class PausarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Motivo de la pausa del servicio', example: 'Lluvia en bahía exterior' })
  @IsString()
  @IsNotEmpty()
  motivo: string;

  @ApiProperty({ description: 'URL o evidencia en vídeo del estado del vehículo al pausar' })
  @IsString()
  @IsNotEmpty()
  videoPausaUrl: string;
}

export class ReanudarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'URL o evidencia en vídeo del estado del vehículo al reanudar' })
  @IsString()
  @IsNotEmpty()
  videoReanudarUrl: string;

  @ApiPropertyOptional({ description: 'Observaciones al reanudar el trabajo' })
  @IsString()
  @IsOptional()
  observaciones?: string;
}



