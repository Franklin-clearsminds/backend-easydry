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

export class ReajusteStockDto {
  @ApiPropertyOptional({ description: 'ID de StockUbicacion. Si no se envía, se resuelve con insumoId + bodegaId' })
  @IsOptional()
  @IsString()
  stockUbicacionId?: string;

  @ApiPropertyOptional({ description: 'ID del insumo a reajustar' })
  @IsOptional()
  @IsString()
  insumoId?: string;

  @ApiPropertyOptional({ description: 'ID de la bodega donde se reajusta el stock' })
  @IsOptional()
  @IsString()
  bodegaId?: string;

  @ApiPropertyOptional({ description: 'ID de la agencia donde se reajusta el stock' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor cuyo kit se reajusta' })
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiProperty({ description: 'Cantidad física contada (valor absoluto, >= 0)' })
  @IsNumber()
  @Type(() => Number)
  cantidadContada: number;

  @ApiProperty({ description: 'Explicación escrita de por qué se aumenta o disminuye el stock' })
  @IsString()
  motivoTexto: string;

  @ApiProperty({ description: 'URL S3 de la foto de evidencia del conteo' })
  @IsString()
  evidenciaUrl: string;
}
