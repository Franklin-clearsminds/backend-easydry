import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import { Type } from 'class-transformer';
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
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  incluirTodos?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  soloActivos?: boolean;

  /**
   * Vigencia del reto: ACTIVOS (estado ACTIVO), VENCIDOS (ya pasó su fecha de fin) o TODOS. Si se envía, reemplaza a
   * `soloActivos` / `incluirTodos`. La visibilidad por rol (región / agencia / pulidor) se mantiene siempre.
   */
  @IsOptional()
  @IsIn(['ACTIVOS', 'VENCIDOS', 'TODOS'])
  vigencia?: 'ACTIVOS' | 'VENCIDOS' | 'TODOS';
}

export class CreateRetoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  titulo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  premio?: string;

  @IsDateString()
  fechaInicio!: string;

  @IsDateString()
  fechaFin!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regiones?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marcas?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sucursalesIds?: string[];

  @IsOptional()
  @IsIn(['ACTIVO', 'FINALIZADO', 'PENDIENTE', 'INACTIVO'])
  estado?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  catalogoServicioId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  catalogoServicioIds?: number[];

  /** Quiénes compiten. */
  @IsOptional()
  @IsIn(PARTICIPANTES_RETO)
  tipoReto?: ParticipanteReto;

  /** Qué servicios cuentan (ESPECIFICOS = los de catalogoServicioIds). */
  @IsOptional()
  @IsIn(TIPOS_SERVICIO_RETO)
  tipoServicios?: TipoServicioReto;

  @IsOptional()
  @IsIn(METRICAS_RETO)
  metrica?: MetricaReto;

  @IsOptional()
  @IsIn(MODOS_GANADOR)
  modoGanador?: ModoGanador;

  /** Con RANKING: cuántos ganan (los primeros N). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  cantidadGanadores?: number;

  /** Con META: valor a alcanzar (servicios, autos o dólares según la métrica). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  meta?: number;

  /** Pulidores elegidos; vacío = todos los del ámbito. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pulidoresIds?: string[];

  /** Lavadores elegidos; vacío = todos los del ámbito. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  lavadoresIds?: string[];
}

/** Personas que se pueden elegir como participantes. */
export class PersonasRetoDto {
  @IsIn(['LAVADOR', 'PULIDOR'])
  tipo!: 'LAVADOR' | 'PULIDOR';
}

export class DeleteRetoDto {
  @IsString()
  id!: string;
}

export class RankingRetoDto {
  @IsString()
  @IsNotEmpty()
  id!: string;
}

export class CerrarRetoDto {
  @IsString()
  id!: string;

  /** Nota de cierre. El ganador no se escribe: sale del ranking. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resultado?: string;
}
