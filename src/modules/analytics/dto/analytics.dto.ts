import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class DashboardAnalyticsDto {
  @ApiPropertyOptional({ description: 'Filtrar por agencia específica' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Fecha para el cálculo (YYYY-MM-DD). Si no se envía, se usa hoy.' })
  @IsOptional()
  @IsDateString()
  fecha?: string;
}

export class ConsumoQuimicosAnalyticsDto {
  @ApiPropertyOptional({ description: 'Filtrar por agencia específica' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Fecha inicio del rango (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha fin del rango (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Agrupación temporal: DIA | SEMANA | MES', example: 'DIA' })
  @IsOptional()
  @IsString()
  agrupacion?: 'DIA' | 'SEMANA' | 'MES';
}
