import { IsString, IsNotEmpty, IsOptional, IsInt, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRegionDto {
  @ApiProperty({ example: 'REG-SIERRA', description: 'Código único de la región' })
  @IsString()
  @IsNotEmpty({ message: 'El código de la región es obligatorio' })
  codigo: string;

  @ApiProperty({ example: 'Sierra', description: 'Nombre oficial de la región' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la región es obligatorio' })
  nombre: string;

  @ApiPropertyOptional({ example: 'Clúster operativo de la Sierra Centro y Norte' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number = 1;

  @ApiPropertyOptional({ example: 'uuid-supervisor', description: 'ID del supervisor asignado como responsable' })
  @IsOptional()
  @IsString()
  supervisorId?: string;

  @ApiPropertyOptional({ example: 'Carlos Mendoza', description: 'Nombre denormalizado del responsable' })
  @IsOptional()
  @IsString()
  responsable?: string;
}

export class UpdateRegionDto {
  @ApiProperty({ example: 'uuid-region', description: 'ID de la región' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la región es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'REG-SIERRA' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({ example: 'Región Sierra Andina' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 'Clúster operativo actualizado' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;

  @ApiPropertyOptional({ example: 'uuid-supervisor', description: 'ID del supervisor asignado como responsable' })
  @IsOptional()
  @IsString()
  supervisorId?: string;

  @ApiPropertyOptional({ example: 'Carlos Mendoza', description: 'Nombre denormalizado del responsable' })
  @IsOptional()
  @IsString()
  responsable?: string;
}

export class ListRegionesDto {
  @ApiPropertyOptional({ example: 'Sierra', description: 'Buscar por nombre o código' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filtrar por estado: 1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}

export class ToggleEstadoRegionDto {
  @ApiProperty({ example: 'uuid-region', description: 'ID de la región' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la región es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 0, description: '1 activo, 0 inactivo (si se omite se invierte)' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}
