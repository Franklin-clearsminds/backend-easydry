import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ServiceStatus } from '@prisma/client';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class QueryServiciosDto extends DataGridQueryDto {
  @ApiPropertyOptional({ example: 'sucursal-uuid-01', description: 'Filtrar por ID de sucursal' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ example: 'agencia-uuid-01', description: 'Filtrar por ID de agencia (mismo que sucursal)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'region-uuid-01', description: 'Filtrar por ID de región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado operativo' })
  @IsOptional()
  @IsString()
  estado?: string | ServiceStatus;
}
