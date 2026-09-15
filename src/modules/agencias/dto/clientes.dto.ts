import { IsString, IsNotEmpty, IsOptional, IsInt, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClienteDto {
  @ApiProperty({ example: 'EasyDry Detailing Studio', description: 'Nombre único del cliente' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del cliente es obligatorio' })
  nombre: string;

  @ApiPropertyOptional({ example: 1, description: 'Estado del cliente: 1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: 'El estado debe ser 0 (inactivo) o 1 (activo)' })
  estado?: number = 1;
}

export class UpdateClienteDto {
  @ApiProperty({ example: 'uuid-cliente', description: 'ID del cliente' })
  @IsString()
  @IsNotEmpty({ message: 'El ID del cliente es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'EasyDry Detailing Studio Pro' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 1, description: 'Estado del cliente: 1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1], { message: 'El estado debe ser 0 (inactivo) o 1 (activo)' })
  estado?: number;
}

export class ListClientesDto {
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

export class ToggleEstadoClienteDto {
  @ApiProperty({ example: 'uuid-cliente', description: 'ID del cliente' })
  @IsString()
  @IsNotEmpty({ message: 'El ID del cliente es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 0, description: 'Nuevo estado: 1 activo, 0 inactivo (si se omite, se invierte)' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;
}

// Aliases retrocompatibles
export {
  CreateClienteDto as CreateMarcaDto,
  UpdateClienteDto as UpdateMarcaDto,
  ListClientesDto as ListMarcasDto,
  ToggleEstadoClienteDto as ToggleEstadoMarcaDto,
};
