import { IsString, IsOptional, IsInt, IsNumber, IsPositive, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';

/** Orden permitido: nombre, cantidad, factor, estado, insumo, fecha. */
export class ListPresentacionesDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'ID del insumo para filtrar sus presentaciones' })
  @IsOptional()
  @IsString()
  insumoId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  estado?: number;
}

export class CreatePresentacionDto {
  @ApiProperty({ description: 'UUID del insumo/producto al que pertenece la presentación' })
  @IsString()
  insumoId: string;

  @ApiProperty({ example: 'Botella 1000 ml', description: 'Nombre descriptivo de la presentación' })
  @IsString()
  nombre: string;

  @ApiProperty({ description: 'UUID de la unidad de medida de la presentación' })
  @IsString()
  unidadId: string;

  @ApiProperty({ example: 1, description: 'Cantidad numérica de la presentación' })
  @IsNumber()
  @IsPositive()
  cantidad: number;

  @ApiProperty({
    example: 1000,
    description: 'Equivalente en la unidad base del producto (ej: si base es ml y presentación es 1L, factor = 1000)',
  })
  @IsNumber()
  @IsPositive()
  factorAUnidadBase: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  estado?: number;
}

export class UpdatePresentacionDto {
  @ApiProperty({ description: 'UUID de la presentación' })
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'Botella 1000 ml' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  cantidad?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  factorAUnidadBase?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  estado?: number;
}
