import { IsString, IsNotEmpty, IsOptional, IsInt, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMarcaDto {
  @ApiProperty({ example: 'EasyDry Detailing Studio', description: 'Nombre único de la marca' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la marca es obligatorio' })
  nombre: string;

  @ApiPropertyOptional({ example: 1, description: 'Estado de la marca: 1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: 'El estado debe ser 0 (inactivo) o 1 (activo)' })
  estado?: number = 1;
}

export class UpdateMarcaDto {
  @ApiProperty({ example: 'uuid-marca', description: 'ID de la marca' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la marca es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'EasyDry Detailing Studio Pro' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 1, description: 'Estado de la marca: 1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: 'El estado debe ser 0 (inactivo) o 1 (activo)' })
  estado?: number;
}

export class ListMarcasDto {
  @ApiPropertyOptional({ example: 'EasyDry', description: 'Buscar por nombre' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filtrar por estado: 1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}

export class ToggleEstadoMarcaDto {
  @ApiProperty({ example: 'uuid-marca', description: 'ID de la marca' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la marca es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 0, description: 'Nuevo estado: 1 activo, 0 inactivo (si se omite, se invierte)' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}
