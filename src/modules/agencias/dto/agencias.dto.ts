import { IsString, IsNotEmpty, IsOptional, IsInt, IsIn, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgenciaDto {
  @ApiProperty({ example: 'AGN-CENTRO', description: 'Código único de la agencia' })
  @IsString()
  @IsNotEmpty({ message: 'El código de la agencia es obligatorio' })
  codigo: string;

  @ApiProperty({ example: 'EasyDry Centro Histórico', description: 'Nombre oficial de la agencia' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la agencia es obligatorio' })
  nombre: string;

  @ApiPropertyOptional({ example: 'Pichincha', description: 'Provincia o región operativa (texto)' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'ID de la región oficial parametrizada' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'Calle Guayaquil y Espejo' })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ example: '022987654' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 'centro@easydry.com' })
  @IsOptional()
  @IsEmail({}, { message: 'El formato de email no es válido' })
  email?: string;

  @ApiPropertyOptional({ example: 3, description: 'Capacidad de bahías' })
  @IsOptional()
  @IsInt()
  numeroBahias?: number = 2;

  @ApiPropertyOptional({ example: 'uuid-marca', description: 'ID de la marca a la que pertenece la agencia' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number = 1;
}

export class UpdateAgenciaDto {
  @ApiProperty({ example: 'uuid-agencia', description: 'ID de la agencia a actualizar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la agencia es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'AGN-CENTRO' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({ example: 'EasyDry Centro Plaza Grande' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 'Pichincha' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'ID de la región oficial' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'Calle Chile y Benalcázar' })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ example: '022987654' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 'centro@easydry.com' })
  @IsOptional()
  @IsEmail({}, { message: 'El formato de email no es válido' })
  email?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  numeroBahias?: number;

  @ApiPropertyOptional({ example: 'uuid-marca' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}

export class ListAgenciasDto {
  @ApiPropertyOptional({ example: 'Quito', description: 'Buscar por nombre o código' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'Pichincha', description: 'Filtrar por región (nombre)' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'Filtrar por ID de región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'uuid-marca', description: 'Filtrar por marca' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}

export class DetailAgenciaDto {
  @ApiProperty({ example: 'uuid-agencia', description: 'ID de la agencia' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la agencia es obligatorio' })
  id: string;
}

export class ToggleEstadoAgenciaDto {
  @ApiProperty({ example: 'uuid-agencia', description: 'ID de la agencia' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la agencia es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 0, description: '1 activo, 0 inactivo (si se omite se invierte)' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}

export class ResumenAgenciaDto {
  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'ID de la agencia (si se omite, toma la del usuario si no es ADMIN)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;
}
