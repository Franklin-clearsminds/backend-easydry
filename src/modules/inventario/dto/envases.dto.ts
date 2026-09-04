import { IsString, IsOptional, IsNumber, IsInt, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEnvaseDto {
  @ApiProperty({ example: 'CAN-20L', description: 'Código único del envase' })
  @IsString()
  codigo: string;

  @ApiProperty({ example: 'Caneca Industrial 20 Litros' })
  @IsString()
  @MaxLength(120)
  nombre: string;

  @ApiPropertyOptional({ example: 'Caneca plástica para productos a granel' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 20.0, description: 'Capacidad numérica estándar' })
  @IsOptional()
  @IsNumber()
  capacidad?: number;

  @ApiPropertyOptional({ example: 'L', description: 'Unidad base: L, ml, kg, g, u' })
  @IsOptional()
  @IsString()
  unidadBase?: string;
}

export class UpdateEnvaseDto {
  @ApiProperty({ description: 'ID del tipo de envase a actualizar' })
  @IsString()
  id: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  capacidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadBase?: string;

  @ApiPropertyOptional({ example: 1, description: '1 = activo, 0 = inactivo' })
  @IsOptional()
  @IsInt()
  @Min(0)
  estado?: number;
}

export class ListEnvasesDto {
  @ApiPropertyOptional({ example: 1, description: 'Filtrar por estado (1=activo, 0=inactivo)' })
  @IsOptional()
  @IsInt()
  estado?: number;

  @ApiPropertyOptional({ description: 'Buscar por nombre o código' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class DetailEnvaseDto {
  @ApiProperty({ description: 'ID del tipo de envase' })
  @IsString()
  id: string;
}
