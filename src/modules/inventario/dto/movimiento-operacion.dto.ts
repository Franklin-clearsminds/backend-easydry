import { IsString, IsOptional, IsNumber, IsPositive, IsArray, IsBoolean, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataGridQueryDto, PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';

export class RegistrarMovimientoOperativoDto {
  @ApiProperty({ description: 'UUID del insumo/producto' })
  @IsString()
  insumoId: string;

  @ApiProperty({ description: 'UUID del tipo de movimiento (ENTRY, CONSUMPTION, etc.)' })
  @IsString()
  tipoMovimientoId: string;

  @ApiProperty({ example: 5, description: 'Cantidad ingresada o consumida' })
  @IsNumber()
  @IsPositive()
  cantidad: number;

  @ApiPropertyOptional({ description: 'UUID de la unidad de medida (si se omite se usa la del insumo)' })
  @IsOptional()
  @IsString()
  unidadId?: string;

  @ApiPropertyOptional({ description: 'UUID de la presentación seleccionada (si aplica)' })
  @IsOptional()
  @IsString()
  presentacionId?: string;

  @ApiPropertyOptional({ description: 'UUID del motivo del movimiento' })
  @IsOptional()
  @IsString()
  motivoId?: string;

  @ApiPropertyOptional({ description: 'ID de ubicación (Agencia o Bodega)' })
  @IsOptional()
  @IsString()
  ubicacionId?: string;

  @ApiPropertyOptional({ description: 'ID de bodega destino (alias de ubicacionId para ingresos a almacén)' })
  @IsOptional()
  @IsString()
  bodegaId?: string;

  @ApiPropertyOptional({ description: 'Etiqueta o nombre del origen (Proveedor, Bodega X, etc.)' })
  @IsOptional()
  @IsString()
  origenUbicacion?: string;

  @ApiPropertyOptional({ description: 'Etiqueta o nombre del destino (Bodega Y, Agencia Z, etc.)' })
  @IsOptional()
  @IsString()
  destinoUbicacion?: string;

  @ApiPropertyOptional({ example: 'FAC-2026-9812', description: 'Número de factura, orden o guía' })
  @IsOptional()
  @IsString()
  referencia?: string;

  @ApiPropertyOptional({ example: 'Consumo para limpieza profunda de bahía 1' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'URLs S3 de evidencia fotográfica del ingreso u otro movimiento' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenciasUrls?: string[];
}

export class ListMovimientosGlobalesDto extends DataGridQueryDto {
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

  @ApiPropertyOptional({ example: 'fecha', description: 'Columna: fecha, comprobante, producto, sku, tipo, ruta, destino, cantidad, cantidadBase, stockAnterior, stockNuevo, responsable. Por defecto: más reciente primero.' })
  @IsOptional()
  @IsString()
  override sortField?: string = undefined;

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = undefined;

  @ApiPropertyOptional({ description: 'Filtrar por insumo' })
  @IsOptional()
  @IsString()
  insumoId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de movimiento' })
  @IsOptional()
  @IsString()
  tipoMovimientoId?: string;

  @ApiPropertyOptional({ example: '2026-01-01', description: 'Fecha inicio ISO' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Fecha fin ISO' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ubicación afectada (ID de bodega, agencia o pulidor)' })
  @IsOptional()
  @IsString()
  ubicacionId?: string;

  @ApiPropertyOptional({ description: 'Incluye en la respuesta el conteo por tipo de movimiento con los mismos filtros (menos el de tipo)' })
  @IsOptional()
  @IsBoolean()
  incluirResumen?: boolean;
}

/**
 * Insumos con stock por debajo del mínimo de bodega. Siempre responde `{ items, total, page, … }`; sin page/pageSize
 * devuelve la primera página de 100 (antes 20). Orden permitido: sku, nombre, tipo, stock, minimo, deficit, fecha
 * (por defecto el de menor stock primero).
 */
export class ListStockBajoDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Filtro por tipo de producto' })
  @IsOptional()
  @IsString()
  tipoProductoId?: string;
}
