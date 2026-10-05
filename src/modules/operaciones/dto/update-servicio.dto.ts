import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

  @ApiPropertyOptional({ description: 'Motivo de la corrección. Obligatorio (y solo para administradores) al editar un servicio ya aprobado.' })
  @IsOptional()
  @IsString()
  motivoCorreccion?: string;
}
