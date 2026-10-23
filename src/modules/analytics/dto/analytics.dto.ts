import { IsString, IsOptional, IsDateString, IsIn, IsArray, IsInt, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
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

  @ApiPropertyOptional({ description: 'Filtrar por cliente corporativo / marca (Ambacar, Casabaca, etc.)' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por bahía específica dentro de la agencia' })
  @IsOptional()
  @IsString()
  bahiaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por pulidor (servicios especiales)' })
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiPropertyOptional({
    enum: ['GENERAL', 'ESPECIAL'],
    description: 'Tipo de servicio del catálogo: lavados generales o especiales. Es un modificador continuo, se combina con los demás filtros.',
  })
  @IsOptional()
  @IsIn(['GENERAL', 'ESPECIAL'])
  categoriaServicio?: 'GENERAL' | 'ESPECIAL';

  @ApiPropertyOptional({
    type: [Number],
    description: 'Servicios concretos del catálogo (ids). Acota los gráficos que dependen del servicio; se combina con la categoría y los demás filtros.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  servicioIds?: number[];

  @ApiPropertyOptional({
    enum: ['REGION', 'AGENCY', 'POLISHER'],
    description: 'Nivel de desglose explícito del gráfico de rendimiento (nivel país), independiente del filtro estructural.',
  })
  @IsOptional()
  @IsIn(['REGION', 'AGENCY', 'POLISHER'])
  desglose?: 'REGION' | 'AGENCY' | 'POLISHER';

  @ApiPropertyOptional({
    enum: ['GLOBAL', 'REGION', 'AGENCY', 'POLISHER'],
    description: 'Nivel de análisis (drill-down). Si no se envía, se infiere del id presente.',
  })
  @IsOptional()
  @IsIn(['GLOBAL', 'REGION', 'AGENCY', 'POLISHER'])
  dimension?: 'GLOBAL' | 'REGION' | 'AGENCY' | 'POLISHER';
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

/** Agencia de la que se piden las estrellas; con alcance de agencia se ignora y se usa la propia. */
export class EstrellasAgenciaDto {
  @ApiPropertyOptional({ description: 'Agencia (solo para quien ve más de una)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;
}

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
