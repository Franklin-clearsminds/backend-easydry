import { IsString, IsOptional, IsNumber, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

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
}

export class ListMovimientosGlobalesDto extends DataGridQueryDto {
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
}

export class ListStockBajoDto extends DataGridQueryDto {
  @ApiPropertyOptional({ description: 'Filtro por tipo de producto' })
  @IsOptional()
  @IsString()
  tipoProductoId?: string;
}
