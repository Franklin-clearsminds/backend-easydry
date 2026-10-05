import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListConsumosServicioDto {
  @ApiPropertyOptional({ enum: ['TODOS', 'GENERAL', 'ESPECIAL'], default: 'TODOS' })
  @IsOptional()
  @IsIn(['TODOS', 'GENERAL', 'ESPECIAL'])
  tipo?: 'TODOS' | 'GENERAL' | 'ESPECIAL';

  @ApiPropertyOptional({ description: 'Filtra por agencia (en especiales, la agencia de la OT)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Busca por OT, placa, servicio o producto' })
  @IsOptional()
  @IsString()
  busqueda?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
