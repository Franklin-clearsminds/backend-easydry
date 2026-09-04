import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ServiceStatus } from '@prisma/client';

export class UpdateServicioDto {
  @ApiProperty({ example: 'demo-uuid-in-progress-001', description: 'ID o clientUuid del servicio a actualizar' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ enum: ServiceStatus, example: ServiceStatus.FINALIZADO })
  @IsOptional()
  @IsEnum(ServiceStatus)
  estado?: ServiceStatus;

  @ApiPropertyOptional({ example: 'https://storage.../foto-salida.jpg' })
  @IsOptional()
  @IsString()
  fotoSalidaUrl?: string;

  @ApiPropertyOptional({ example: 'Lavado completado y verificado' })
  @IsOptional()
  @IsString()
  observaciones?: string;
}
