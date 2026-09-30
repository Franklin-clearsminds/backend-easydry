import { IsOptional, IsString, IsDateString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class ListKardexDto extends DataGridQueryDto {
  // Sin valores por defecto en el DTO: así el servidor distingue a un cliente antiguo (que no envía página ni tamaño)
  // de uno nuevo (sin tamaño recibe hasta 100 filas, como antes de paginar en el servidor).
  @ApiPropertyOptional({ example: 1, description: 'Página (1 = primera)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  override page?: number = undefined;

  @ApiPropertyOptional({ example: 25, description: 'Filas por página (máximo 100; un valor mayor se recorta)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  override pageSize?: number = undefined;

  @ApiPropertyOptional({ example: 'fecha', description: 'Columna: fecha, insumo, sku, ubicacion, tipo, cantidad, stockAnterior, stockPosterior, costoUnitario, costoTotal, usuario. Por defecto: más reciente primero.' })
  @IsOptional()
  @IsString()
  override sortField?: string = undefined;

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = undefined;

  @ApiPropertyOptional({ description: 'Filtrar por insumo específico' })
  @IsOptional()
  @IsString()
  insumoId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ubicación (ID de agencia o BODEGA_CENTRAL)' })
  @IsOptional()
  @IsString()
  ubicacionId?: string;

  @ApiPropertyOptional({ description: 'Tipo de movimiento (CONSUMO_SERVICIO, COMPRA_INGRESO, DESPACHO_SALIDA, DESPACHO_ENTRADA, AJUSTE_MERMA)' })
  @IsOptional()
  @IsString()
  tipoMovimiento?: string;

  @ApiPropertyOptional({ description: 'Fecha inicio (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha fin (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;
}
