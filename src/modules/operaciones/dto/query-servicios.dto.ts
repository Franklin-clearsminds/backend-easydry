import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ServiceStatus } from '@prisma/client';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class QueryServiciosDto extends DataGridQueryDto {
  @ApiPropertyOptional({ example: 'sucursal-uuid-01', description: 'Filtrar por ID de sucursal' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ enum: ServiceStatus, description: 'Filtrar por estado operativo' })
  @IsOptional()
  @IsEnum(ServiceStatus)
  estado?: ServiceStatus;
}
