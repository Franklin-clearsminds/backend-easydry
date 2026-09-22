import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ServiceStatus } from '@prisma/client';

export class MutationDataDto {
  @ApiProperty({ example: 'PDF-4589', description: 'Placa del vehículo' })
  @IsString()
  @IsNotEmpty()
  placa: string;

  @ApiProperty({ example: 'Toyota Rav4', description: 'Modelo del vehículo' })
  @IsString()
  @IsNotEmpty()
  modelo: string;

  @ApiPropertyOptional({ example: 'Blanco', description: 'Color del vehículo' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'Concesionario Casabaca', description: 'Nombre del cliente' })
  @IsOptional()
  @IsString()
  cliente?: string;

  @ApiProperty({ example: 1, description: 'ID del catálogo de servicios' })
  @IsInt()
  servicioCatalogoId: number;

  @ApiProperty({ example: 'bahia-uuid-01', description: 'ID de la bahía' })
  @IsString()
  @IsNotEmpty()
  bahiaId: string;

  @ApiPropertyOptional({ enum: ServiceStatus, default: ServiceStatus.EN_ESPERA })
  @IsOptional()
  @IsEnum(ServiceStatus)
  estado?: ServiceStatus;

  @ApiPropertyOptional({ example: '2026-09-04T10:00:00.000Z' })
  @IsOptional()
  @IsString()
  horaIngreso?: string;

  @ApiPropertyOptional({ example: '2026-09-04T10:45:00.000Z' })
  @IsOptional()
  @IsString()
  horaSalida?: string;

  @ApiPropertyOptional({ example: 'https://storage.../foto-ingreso.jpg' })
  @IsOptional()
  @IsString()
  fotoIngresoUrl?: string;

  @ApiPropertyOptional({ example: 'https://storage.../foto-salida.jpg' })
  @IsOptional()
  @IsString()
  fotoSalidaUrl?: string;

  @ApiPropertyOptional({ example: 'Rayón leve en puerta trasera' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ example: 1, description: 'Versión del registro para control de concurrencia optimista (OCC)' })
  @IsOptional()
  @IsInt()
  version?: number;
}

export class MutationItemDto {
  @ApiProperty({ example: 'mut-550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  @IsNotEmpty()
  mutationId: string;

  @ApiProperty({ example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', description: 'UUID v4 generado en SQLite (clave de idempotencia)' })
  @IsString()
  @IsNotEmpty()
  clientUuid: string;

  @ApiProperty({ example: 'servicio_lavado' })
  @IsString()
  @IsNotEmpty()
  entity: string;

  @ApiProperty({ example: 'CREATE', enum: ['CREATE', 'UPDATE'] })
  @IsString()
  @IsNotEmpty()
  action: string;

  @ApiProperty({ example: 1756910400000 })
  @IsNumber()
  timestamp: number;

  @ApiProperty({ type: Object, description: 'Payload específico de la entidad' })
  @IsObject()
  data: Record<string, unknown>;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  attempts?: number;
}

export class SyncPushDto {
  @ApiProperty({ example: 'samsung-sm-a525m-uuid', description: 'Identificador único del dispositivo' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({
    type: [MutationItemDto],
    description: 'Lista de mutaciones generadas offline (máx 50 por petición para evitar timeouts)',
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'El lote debe contener al menos 1 mutación' })
  @ArrayMaxSize(50, { message: 'Lote excede el máximo permitido de 50 mutaciones por petición. Por favor divida en tandas de hasta 50.' })
  @ValidateNested({ each: true })
  @Type(() => MutationItemDto)
  mutations: MutationItemDto[];
}

export class ReplayDlqDto {
  @ApiProperty({ example: 'dlq-uuid-1234', description: 'ID del registro en SyncDeadLetterQueue' })
  @IsString()
  @IsNotEmpty()
  dlqId: string;

  @ApiPropertyOptional({ description: 'Payload corregido opcional para reinyectar la mutación' })
  @IsOptional()
  payloadCorregido?: any;
}

export class QueryPendingMediaDto {
  @ApiProperty({
    example: ['uuid-orden-1', 'uuid-orden-2'],
    description: 'Lista de clientUuids a consultar para verificar fotos pendientes de vinculación',
  })
  @IsArray()
  @IsString({ each: true })
  clientUuids: string[];
}

