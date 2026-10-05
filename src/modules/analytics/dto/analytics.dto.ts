import { IsString, IsOptional, IsDateString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Periodos predefinidos del filtro de fecha global (compartido por todos los dashboards). */
export const RANGOS_PERIODO = ['HOY', 'SEMANA', 'MES', 'TRIMESTRE', 'SEMESTRE', 'ANIO', 'RANGO'] as const;
export type RangoPeriodo = (typeof RANGOS_PERIODO)[number];

/**
 * Filtro base de toda la analítica. Es el ESTÁNDAR de filtros: acota por periodo, agencia, región y pulidor.
 * El servidor SIEMPRE intersecta esto con el alcance del usuario, así que un id de fuera de su alcance
 * nunca se usa como respaldo.
 */
export class FiltroAnaliticaDto {
  @ApiPropertyOptional({ enum: RANGOS_PERIODO, description: 'Periodo del dashboard. Por defecto HOY.' })
  @IsOptional()
  @IsIn(RANGOS_PERIODO as unknown as string[])
  rango?: RangoPeriodo;

  @ApiPropertyOptional({ description: 'Filtrar por región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por agencia específica' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por pulidor (servicios especiales)' })
  @IsOptional()
  @IsString()
  pulidorId?: string;
}

/** Filtro por rango de fechas (aplica cuando `rango = RANGO`), además de agencia/región/pulidor. */
export class RangoAnaliticaDto extends FiltroAnaliticaDto {
  @ApiPropertyOptional({ description: 'Fecha inicio del rango (YYYY-MM-DD). Usar con rango=RANGO.' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha fin del rango (YYYY-MM-DD). Usar con rango=RANGO.' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;
}

export class DashboardAnalyticsDto extends RangoAnaliticaDto {
  @ApiPropertyOptional({ description: 'Fecha exacta (YYYY-MM-DD). Compatibilidad: equivale a rango=RANGO de un día.' })
  @IsOptional()
  @IsDateString()
  fecha?: string;
}

/** Filtro de los dashboards dedicados (Taller, Bodega, Servicios Especiales). */
export class DashboardDedicadoDto extends RangoAnaliticaDto {}

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
