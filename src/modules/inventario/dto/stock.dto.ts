import { IsString, IsOptional, IsNumber, IsEnum, IsArray, ValidateNested, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum TipoUbicacionStockEnum {
  BODEGA_CENTRAL = 'BODEGA_CENTRAL',
  AGENCIA = 'AGENCIA',
  PULIDOR_MOVIL = 'PULIDOR_MOVIL',
  PULIDOR_FIJO = 'PULIDOR_FIJO',
}

export class ListStockDto {
  @ApiPropertyOptional({ enum: TipoUbicacionStockEnum, description: 'Filtrar por tipo de ubicación' })
  @IsOptional()
  @IsEnum(TipoUbicacionStockEnum)
  tipoUbicacion?: TipoUbicacionStockEnum;

  @ApiPropertyOptional({ description: 'ID de agencia/sucursal para filtrar stock' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'ID de pulidor para filtrar su kit personal' })
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiPropertyOptional({ description: 'ID de insumo específico' })
  @IsOptional()
  @IsString()
  insumoId?: string;

  @ApiPropertyOptional({ description: 'Si true, incluye solo insumos bajo el mínimo' })
  @IsOptional()
  bajominimo?: boolean;
}

export class AjusteStockDto {
  @ApiProperty({ description: 'ID de la ubicación de stock a ajustar' })
  @IsString()
  stockUbicacionId: string;

  @ApiProperty({ description: 'Nueva cantidad actual (valor absoluto del conteo físico)' })
  @IsNumber()
  cantidadNueva: number;

  @ApiProperty({ description: 'Razón del ajuste (merma, rotura, conteo físico, etc.)' })
  @IsString()
  razon: string;
}
