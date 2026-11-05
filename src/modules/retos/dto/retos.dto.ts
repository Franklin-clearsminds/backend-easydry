import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import {
  METRICAS_RETO,
  MODOS_GANADOR,
  PARTICIPANTES_RETO,
  TIPOS_SERVICIO_RETO,
  type MetricaReto,
  type ModoGanador,
  type ParticipanteReto,
  type TipoServicioReto,
} from '../retos.reglas.js';

/** Sin page/pageSize: arreglo (hasta 100). Con alguno: página. Orden: titulo, inicio, fin, estado, fecha (inicio). */
export class ListRetosDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Incluir también los retos no activos (finalizados, pendientes, inactivos)' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  incluirTodos?: boolean;

  @ApiPropertyOptional({ description: 'Solo retos con estado ACTIVO' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  soloActivos?: boolean;

  /**
   * Vigencia del reto: ACTIVOS (estado ACTIVO), VENCIDOS (ya pasó su fecha de fin) o TODOS. Si se envía, reemplaza a
   * `soloActivos` / `incluirTodos`. La visibilidad por rol (región / agencia / pulidor) se mantiene siempre.
   */
  @ApiPropertyOptional({
    enum: ['ACTIVOS', 'VENCIDOS', 'TODOS'],
    description: 'Vigencia del reto; si se envía reemplaza a soloActivos / incluirTodos. La visibilidad por rol se mantiene siempre',
  })
  @IsOptional()
  @IsIn(['ACTIVOS', 'VENCIDOS', 'TODOS'])
  vigencia?: 'ACTIVOS' | 'VENCIDOS' | 'TODOS';
}

/** Lo que se puede corregir de un reto activo: texto, premio y vigencia. Participantes, métrica y ganadores no cambian (el ranking depende de ellos). */
export class UpdateRetoDto {
  @ApiProperty({ description: 'ID del reto a corregir' })
  @IsString()
  @IsNotEmpty()
  id!: string;

  @ApiPropertyOptional({ description: 'Título del reto', maxLength: 160 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  titulo?: string;

  @ApiPropertyOptional({ description: 'Descripción del reto', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Premio del reto', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  premio?: string;

  @ApiPropertyOptional({ description: 'Fecha de inicio (ISO 8601)', example: '2026-11-01' })
  @IsOptional()
  @IsDateString()
  fechaInicio?: string;

  @ApiPropertyOptional({ description: 'Fecha de fin (ISO 8601)', example: '2026-11-30' })
  @IsOptional()
  @IsDateString()
  fechaFin?: string;
}

export class CreateRetoDto {
  @ApiProperty({ description: 'Título del reto', maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  titulo!: string;

  @ApiPropertyOptional({ description: 'Descripción del reto', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @ApiPropertyOptional({ description: 'Premio del reto', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  premio?: string;

  @ApiProperty({ description: 'Fecha de inicio (ISO 8601)', example: '2026-11-01' })
  @IsDateString()
  fechaInicio!: string;

  @ApiProperty({ description: 'Fecha de fin (ISO 8601)', example: '2026-11-30' })
  @IsDateString()
  fechaFin!: string;

  @ApiPropertyOptional({ type: [String], description: 'IDs de las regiones a las que aplica' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regiones?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Marcas (clientes) a las que aplica' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marcas?: string[];

  @ApiPropertyOptional({ type: [String], description: 'IDs de las agencias (sucursales) a las que aplica' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sucursalesIds?: string[];

  @ApiPropertyOptional({ enum: ['ACTIVO', 'FINALIZADO', 'PENDIENTE', 'INACTIVO'], description: 'Estado inicial del reto' })
  @IsOptional()
  @IsIn(['ACTIVO', 'FINALIZADO', 'PENDIENTE', 'INACTIVO'])
  estado?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, description: 'Servicio del catálogo que cuenta (uno solo)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  catalogoServicioId?: number;

  @ApiPropertyOptional({ type: [Number], description: 'Servicios del catálogo que cuentan (con tipoServicios = ESPECIFICOS)' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  catalogoServicioIds?: number[];

  /** Quiénes compiten. */
  @ApiPropertyOptional({ enum: PARTICIPANTES_RETO, description: 'Quiénes compiten' })
  @IsOptional()
  @IsIn(PARTICIPANTES_RETO)
  tipoReto?: ParticipanteReto;

  /** Qué servicios cuentan (ESPECIFICOS = los de catalogoServicioIds). */
  @ApiPropertyOptional({ enum: TIPOS_SERVICIO_RETO, description: 'Qué servicios cuentan (ESPECIFICOS = los de catalogoServicioIds)' })
  @IsOptional()
  @IsIn(TIPOS_SERVICIO_RETO)
  tipoServicios?: TipoServicioReto;

  @ApiPropertyOptional({ enum: METRICAS_RETO, description: 'Qué se mide: servicios, autos o dólares' })
  @IsOptional()
  @IsIn(METRICAS_RETO)
  metrica?: MetricaReto;

  @ApiPropertyOptional({ enum: MODOS_GANADOR, description: 'Cómo se decide el ganador' })
  @IsOptional()
  @IsIn(MODOS_GANADOR)
  modoGanador?: ModoGanador;

  /** Con RANKING: cuántos ganan (los primeros N). */
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 50, description: 'Con RANKING: cuántos ganan (los primeros N)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  cantidadGanadores?: number;

  /** Con META: valor a alcanzar (servicios, autos o dólares según la métrica). */
  @ApiPropertyOptional({ type: Number, minimum: 0.01, description: 'Con META: valor a alcanzar (servicios, autos o dólares según la métrica)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  meta?: number;

  /** Pulidores elegidos; vacío = todos los del ámbito. */
  @ApiPropertyOptional({ type: [String], description: 'Pulidores elegidos; vacío = todos los del ámbito' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pulidoresIds?: string[];

  /** Lavadores elegidos; vacío = todos los del ámbito. */
  @ApiPropertyOptional({ type: [String], description: 'Lavadores elegidos; vacío = todos los del ámbito' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lavadoresIds?: string[];
}

/** Personas que se pueden elegir como participantes. */
export class PersonasRetoDto {
  @ApiProperty({ enum: ['LAVADOR', 'PULIDOR'], description: 'Tipo de persona a listar' })
  @IsIn(['LAVADOR', 'PULIDOR'])
  tipo!: 'LAVADOR' | 'PULIDOR';
}

export class DeleteRetoDto {
  @ApiProperty({ description: 'ID del reto' })
  @IsString()
  id!: string;
}

export class RankingRetoDto {
  @ApiProperty({ description: 'ID del reto' })
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class CerrarRetoDto {
  @ApiProperty({ description: 'ID del reto a cerrar' })
  @IsString()
  id!: string;

  /** Nota de cierre. El ganador no se escribe: sale del ranking. */
  @ApiPropertyOptional({ description: 'Nota de cierre. El ganador no se escribe: sale del ranking', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resultado?: string;
}
