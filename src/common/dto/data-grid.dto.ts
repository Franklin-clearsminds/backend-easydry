import { IsOptional, IsNumber, IsString, IsIn, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Paginación OPCIONAL para listados que ya existían sin ella. No fija valores por defecto para poder distinguir a un
 * cliente antiguo (sin `page` ni `pageSize`: recibe un arreglo con hasta 100 filas, como antes pero con tope) de uno
 * nuevo (recibe `{ items, total, page, … }`). Ver `esConsultaPaginada`.
 */
export class PaginacionOpcionalDto {
  @ApiPropertyOptional({ example: 1, description: 'Página (1 = primera). Activa el modo paginado.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25, description: 'Filas por página (máximo 100; un valor mayor se recorta). Activa el modo paginado.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Columna por la que ordenar (lista permitida por listado). Sin ella: orden por defecto.' })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Búsqueda por palabras (mínimo 2 letras)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Incluye contadores con los mismos filtros (solo modo paginado, en los listados que lo ofrecen)' })
  @IsOptional()
  @IsBoolean()
  incluirResumen?: boolean;
}

export class DataGridQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Número de página (1-indexed)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, description: 'Cantidad de registros por página' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;

  @ApiPropertyOptional({ example: 'createdAt', description: 'Campo por el cual ordenar' })
  @IsOptional()
  @IsString()
  sortField?: string = 'createdAt';

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'], description: 'Dirección del ordenamiento' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: 'Toyota', description: 'Búsqueda de texto libre' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filtros dinámicos clave-valor' })
  @IsOptional()
  filters?: Record<string, any>;
}

export interface DataGridResult<T> {
  items: T[];
  /** Alias de `items` para los clientes que todavía leen `data` (formato anterior de maquinaria). Se retirará. */
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export function buildDataGridResponse<T>(
  items: T[],
  total: number,
  page: number = 1,
  pageSize: number = 20,
): DataGridResult<T> {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.ceil(total / safePageSize) || 1;

  return {
    items,
    data: items,
    total,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPrevPage: safePage > 1,
  };
}
