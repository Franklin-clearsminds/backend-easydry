import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class QueryBahiasDto {
  @ApiPropertyOptional({ example: 'sucursal-uuid-01', description: 'Filtrar bahías por ID de sucursal' })
  @IsOptional()
  @IsString()
  sucursalId?: string;
}
