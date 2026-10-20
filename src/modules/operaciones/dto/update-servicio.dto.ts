import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceStatus } from '@prisma/client';

export class UpdateServicioDto {
  @ApiProperty({ example: '3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c', description: 'ID o clientUuid del servicio a actualizar' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ enum: ServiceStatus, example: ServiceStatus.FINALIZADO })
  @IsOptional()
  @IsEnum(ServiceStatus)
  estado?: ServiceStatus;

  @ApiPropertyOptional({ example: 'https://storage.../foto-ingreso.jpg' })
  @IsOptional()
  @IsString()
  fotoIngresoUrl?: string;

  @ApiPropertyOptional({ example: 'https://storage.../foto-salida.jpg' })
  @IsOptional()
  @IsString()
  fotoSalidaUrl?: string;

  @ApiPropertyOptional({ example: 'Lavado completado y verificado' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ example: 'ABC-1234', description: 'Corrige la placa de toda la OT (casilla «Editar OT»).' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  placa?: string;

  @ApiPropertyOptional({ example: 12, description: 'Cambia el servicio de la OT (casilla «Editar OT») mientras está en espera o en proceso: devuelve los insumos del anterior y descuenta los del nuevo.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  servicioCatalogoId?: number;

  @ApiPropertyOptional({ example: 'Toyota' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  marca?: string;

  @ApiPropertyOptional({ example: 'Hilux' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  modelo?: string;

  @ApiPropertyOptional({ example: 'Blanco' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @ApiPropertyOptional({ example: 'Juan Pérez' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  cliente?: string;

  @ApiPropertyOptional({ description: 'Motivo de la corrección. Obligatorio (y solo para administradores) al editar un servicio ya aprobado.' })
  @IsOptional()
  @IsString()
  motivoCorreccion?: string;
}
