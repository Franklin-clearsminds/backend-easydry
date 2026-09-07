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

  @ApiPropertyOptional({ description: 'Estado: PENDIENTE, EN_PROCESO, FINALIZADO, CANCELADO' })
  @IsString()
  @IsOptional()
  estado?: string;

  @ApiPropertyOptional({ description: 'Tipo: PULIDO, MICRO_PULIDO, CERAMICO, LAVADO_MOTOR' })
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

  @ApiProperty({ description: 'Tipo de servicio especial', example: 'PULIDO' })
  @IsString()
  @IsNotEmpty()
  tipoServicio: string;

  @ApiProperty({
    description: 'Información del vehículo y cliente',
    example: { placa: 'PBA-1234', marca: 'Toyota', modelo: 'Corolla', color: 'Gris', cliente: 'Carlos Perez' },
  })
  @IsNotEmpty()
  vehiculoInfo: Record<string, any>;

  @ApiProperty({ description: 'ID de la agencia donde se efectúa' })
  @IsString()
  @IsNotEmpty()
  agenciaId: string;

  @ApiPropertyOptional({ description: 'ID del técnico especialista asignado' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'Prioridad: BAJA, MEDIA, ALTA, URGENTE', default: 'MEDIA' })
  @IsString()
  @IsOptional()
  prioridad?: string;

  @ApiPropertyOptional({ description: 'Receta de químicos estimados en ml' })
  @IsOptional()
  recetaInsumos?: any;

  @ApiPropertyOptional({ description: 'Evidencias fotográficas (fotos antes)' })
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
}

export class CompletarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

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
