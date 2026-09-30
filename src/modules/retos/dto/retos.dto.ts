import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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
   * `soloActivos` / `incluirTodos`. La visibilidad por rol (región / sucursal) se mantiene siempre.
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
  @IsArray()
  @IsString({ each: true })
  criterios?: string[];
}

export class DeleteRetoDto {
  @IsString()
  id!: string;
}
