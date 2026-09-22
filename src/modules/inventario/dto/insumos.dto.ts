import { IsString, IsOptional, IsNumber, IsInt, Min, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInsumoDto {
  @ApiProperty({ example: 'INS-LAV-001', description: 'Código SKU único del insumo' })
  @IsString()
  codigoSKU: string;

  @ApiProperty({ example: 'Shampoo Bio-Espuma Concentrado' })
  @IsString()
  nombre: string;

  @ApiProperty({
    example: 'QUIMICOS_LAVADO',
    description:
      'Categoría: QUIMICOS_LAVADO | CERAS_SELLADORES | PULIMENTOS | DESENGRASANTES | TEXTILES | EPP | ACCESORIOS',
  })
  @IsString()
  categoria: string;

  @ApiPropertyOptional({ example: 'Shampoo concentrado biodegradable de alta espuma' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ description: 'UUID del tipo de producto configurable' })
  @IsOptional()
  @IsString()
  tipoProductoId?: string;


  @ApiProperty({ description: 'ID de la unidad de medida base' })
  @IsString()
  unidadMedidaId: string;

  @ApiPropertyOptional({ example: 20.0, description: 'Cantidad de producto por envase' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  contenidoNeto?: number;

  @ApiProperty({ example: 10.0, description: 'Stock mínimo en bodega central para alerta (obligatorio)' })
  @IsNumber()
  @Min(0.001)
  stockMinimoBodega: number;

  @ApiProperty({ example: 2.0, description: 'Stock mínimo en agencia para alerta (obligatorio)' })
  @IsNumber()
  @Min(0.001)
  stockMinimoAgencia: number;

  @ApiProperty({ example: 50.0, description: 'Stock óptimo en bodega central (obligatorio)' })
  @IsNumber()
  @Min(0.001)
  stockOptimoBodega: number;

  @ApiPropertyOptional({ example: 5.0, description: 'Stock óptimo en agencia para reabastecimiento (opcional/recomendado)' })
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  stockOptimoAgencia?: number;

  @ApiPropertyOptional({ example: 45.5, description: 'Costo unitario en USD' })
  @IsOptional()
  @IsNumber()
  costoUnitarioUSD?: number;

  @ApiPropertyOptional({ example: 'Proveedora Nacional S.A.' })
  @IsOptional()
  @IsString()
  proveedorPrincipal?: string;

  @ApiPropertyOptional({ example: 'https://cdn.easydry.com/img/shampoo.jpg' })
  @IsOptional()
  @IsString()
  imagenUrl?: string;
}

export class UpdateInsumoDto {
  @ApiProperty({ description: 'ID del insumo a actualizar' })
  @IsString()
  id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ description: 'UUID del tipo de producto configurable' })
  @IsOptional()
  @IsString()
  tipoProductoId?: string;


  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadMedidaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contenidoNeto?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  stockMinimoBodega?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  stockMinimoAgencia?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  stockOptimoBodega?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  stockOptimoAgencia?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  costoUnitarioUSD?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proveedorPrincipal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estado?: number;
}

export class ListInsumosDto {
  @ApiPropertyOptional({ example: 'QUIMICOS_LAVADO' })
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  estado?: number;

  @ApiPropertyOptional({ description: 'Buscar por nombre o SKU' })
  @IsOptional()
  @IsString()
  search?: string;


  @ApiPropertyOptional({ description: 'ID del tipo de producto para filtrar' })
  @IsOptional()
  @IsString()
  tipoProductoId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por agencia (obtiene insumos de los servicios autorizados para la agencia)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({
    description: 'Bodega cuyo stock físico se expone en stockActual (StockUbicacion). Si no se envía: bodega del usuario o Central.',
  })
  @IsOptional()
  @IsString()
  bodegaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar estrictamente a insumos requeridos por servicios' })
  @IsOptional()
  soloDeServicios?: boolean;
}

export class DetailInsumoDto {
  @ApiProperty()
  @IsString()
  id: string;
}
