import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ServiceStatus } from '@prisma/client';

export class QueryServiciosDto {
  @ApiPropertyOptional({ example: 'sucursal-uuid-01', description: 'Filtrar por ID de sucursal' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ enum: ServiceStatus, description: 'Filtrar por estado operativo' })
  @IsOptional()
  @IsEnum(ServiceStatus)
  estado?: ServiceStatus;

  @ApiPropertyOptional({ example: 'PBX', description: 'Buscar por placa, modelo o nombre de cliente' })
  @IsOptional()
  @IsString()
  search?: string;
}
