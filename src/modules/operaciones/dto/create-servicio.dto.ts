import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsInt, IsOptional, IsEnum, IsArray } from 'class-validator';
import { ServiceStatus } from '@prisma/client';

export class CreateServicioDto {
  @ApiPropertyOptional({ example: 'OT-9840', description: 'Número de Orden de Trabajo (OT)' })
  @IsOptional()
  @IsString()
  ordenTrabajoOT?: string;

  @ApiProperty({ example: 'PDF-4589', description: 'Placa del vehículo' })
  @IsString()
  @IsNotEmpty()
  placa: string;

  @ApiPropertyOptional({ example: 'Toyota', description: 'Marca del vehículo' })
  @IsOptional()
  @IsString()
  marca?: string;

  @ApiProperty({ example: 'Rav4', description: 'Modelo del vehículo' })
  @IsString()
  @IsNotEmpty()
  modelo: string;

  @ApiPropertyOptional({ example: 'Blanco', description: 'Color del vehículo' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ example: 'Concesionario Casabaca' })
  @IsOptional()
  @IsString()
  cliente?: string;

  @ApiProperty({ example: 'bahia-uuid-01' })
  @IsString()
  @IsNotEmpty()
  bahiaId: string;

  @ApiPropertyOptional({
    example: 'lavador-uuid-01',
    description:
      'Lavador que realiza el servicio (elegido en la app). Debe pertenecer a la misma agencia que la bahía. ' +
      'Si no se indica, la OT queda a nombre de quien la registra.',
  })
  @IsOptional()
  @IsString()
  operadorId?: string;

  @ApiPropertyOptional({
    example: ['lavador-uuid-01', 'lavador-uuid-02'],
    description: 'Lavadores activos asignados a la bahía que comparten la responsabilidad de esta OT.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operadorIds?: string[];

  @ApiProperty({ example: 1 })
  @IsInt()
  servicioCatalogoId: number;

  @ApiPropertyOptional({
    example: [1, 4],
    description: 'Servicios generales adicionales para la misma OT y vehículo. Se crea una fila por servicio.',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  servicioCatalogoIds?: number[];

  @ApiPropertyOptional({ enum: ServiceStatus, default: ServiceStatus.EN_ESPERA })
  @IsOptional()
  @IsEnum(ServiceStatus)
  estado?: ServiceStatus;

  @ApiPropertyOptional({ example: 'client-generated-uuid-v4' })
  @IsOptional()
  @IsString()
  clientUuid?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fotoIngresoUrl?: string;

  @ApiPropertyOptional({ description: 'Video de ingreso cuando la OT también trae una foto adicional en `fotoIngresoUrl`.' })
  @IsOptional()
  @IsString()
  videoInicialUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fotoSalidaUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;
}
