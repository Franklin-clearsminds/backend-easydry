import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Filtro base de toda la analítica: acota por agencia y/o región. El servidor SIEMPRE intersecta esto con
 * el alcance del usuario, así que un id de fuera de su alcance nunca se usa como respaldo.
 */
export class FiltroAnaliticaDto {
  @ApiPropertyOptional({ description: 'Filtrar por agencia específica' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por región' })
  @IsOptional()
  @IsString()
  regionId?: string;
}

/** Filtro por rango de fechas, además de agencia/región. */
export class RangoAnaliticaDto extends FiltroAnaliticaDto {
  @ApiPropertyOptional({ description: 'Fecha inicio del rango (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha fin del rango (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;
}

export class DashboardAnalyticsDto extends FiltroAnaliticaDto {
  @ApiPropertyOptional({ description: 'Fecha para el cálculo (YYYY-MM-DD). Si no se envía, se usa hoy.' })
  @IsOptional()
  @IsDateString()
  fecha?: string;
}

/** Filtro de los dashboards dedicados (Taller, Bodega, Servicios Especiales). */
export class DashboardDedicadoDto extends FiltroAnaliticaDto {}

export class ConsumoQuimicosAnalyticsDto extends RangoAnaliticaDto {
  @ApiPropertyOptional({
    description: 'Agrupación temporal de la serie de consumo: DIA | SEMANA | MES',
    enum: ['DIA', 'SEMANA', 'MES'],
    example: 'DIA',
  })
  @IsOptional()
  @IsIn(['DIA', 'SEMANA', 'MES'])
  agrupacion?: 'DIA' | 'SEMANA' | 'MES';
}

export class RankingLavadoresDto extends RangoAnaliticaDto {}
