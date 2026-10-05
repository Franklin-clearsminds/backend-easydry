import { IsString, IsOptional, IsNumber, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';

/** Orden permitido: codigo, nombre, simbolo, tipo, factorBase, estado, fecha. */
export class ListUnidadesDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ example: 'VOLUMEN', description: 'Filtrar por tipo: VOLUMEN, MASA, UNITARIO' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  estado?: number;

}

export class CreateUnidadDto {
  @ApiProperty({ example: 'L' })
  @IsString()
  codigo: string;

  @ApiProperty({ example: 'Litro' })
  @IsString()
  nombre: string;

  @ApiProperty({ example: 'L' })
  @IsString()
  simbolo: string;

  @ApiProperty({ example: 'VOLUMEN', description: 'VOLUMEN | MASA | UNITARIO' })
  @IsString()
  tipo: string;

  @ApiPropertyOptional({ example: 1.0, description: 'Factor de conversión a unidad base de su familia' })
  @IsOptional()
  @IsNumber()
  factorBase?: number;

  @ApiPropertyOptional({ example: 1.0 })
  @IsOptional()
  @IsNumber()
  factorLitro?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  estado?: number;
}

export class UpdateUnidadDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  simbolo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ example: 1.0 })
  @IsOptional()
  @IsNumber()
  factorBase?: number;

  @ApiPropertyOptional({ example: 1.0 })
  @IsOptional()
  @IsNumber()
  factorLitro?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  estado?: number;
}
