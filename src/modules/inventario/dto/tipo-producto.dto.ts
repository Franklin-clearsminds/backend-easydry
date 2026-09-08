import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListTiposProductoDto {
  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  estado?: number;

  @ApiPropertyOptional({ description: 'Filtro de búsqueda por nombre o código' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateTipoProductoDto {
  @ApiProperty({ example: 'GEL', description: 'Código único para identificación' })
  @IsString()
  codigo: string;

  @ApiProperty({ example: 'Gel', description: 'Nombre visual del tipo de producto' })
  @IsString()
  nombre: string;

  @ApiPropertyOptional({ example: 'Productos y lubricantes semilíquidos', description: 'Descripción opcional' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  estado?: number;
}

export class UpdateTipoProductoDto {
  @ApiProperty({ description: 'UUID del tipo de producto' })
  @IsString()
  id: string;

  @ApiPropertyOptional({ example: 'GEL_ESP' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({ example: 'Gel Especial' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 'Descripción actualizada' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  estado?: number;
}
