import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBahiaDto {
  @ApiProperty({ example: 'QNOR-B04', description: 'Código único de la bahía' })
  @IsString()
  @IsNotEmpty({ message: 'El código de la bahía es obligatorio' })
  codigo: string;

  @ApiProperty({ example: 'Bahía 04 - Detallado Especial', description: 'Nombre descriptivo de la bahía' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la bahía es obligatorio' })
  nombre: string;

  @ApiProperty({ example: 'uuid-agencia', description: 'ID de la agencia a la que pertenece' })
  @IsString()
  @IsNotEmpty({ message: 'El agenciaId es obligatorio' })
  agenciaId: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean = true;
}

export class UpdateBahiaDto {
  @ApiProperty({ example: 'uuid-bahia', description: 'ID de la bahía a editar' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ example: 'Bahía 04 - VIP Coating' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class ListBahiasDto {
  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'Filtrar por agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: true, description: 'Filtrar por bahías activas o inactivas' })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class ToggleActivaBahiaDto {
  @ApiProperty({ example: 'uuid-bahia', description: 'ID de la bahía' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ example: false, description: 'Estado activa deseado (si se omite se invierte)' })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
