import { IsString, IsOptional, IsInt, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListTiposMovimientoDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  estado?: number;

  @ApiPropertyOptional({ example: true, description: 'Filtrar solo entradas (true) o solo salidas/consumos (false)' })
  @IsOptional()
  @IsBoolean()
  esEntrada?: boolean;
}

export class ListMotivosDto {
  @ApiPropertyOptional({ description: 'ID del tipo de movimiento al que aplica el motivo' })
  @IsOptional()
  @IsString()
  tipoMovimientoId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  estado?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateMotivoDto {
  @ApiProperty({ example: 'LIMPIEZA_MAQ', description: 'Código único para identificación' })
  @IsString()
  codigo: string;

  @ApiProperty({ example: 'Limpieza de Maquinaria', description: 'Nombre del motivo' })
  @IsString()
  nombre: string;

  @ApiPropertyOptional({ example: 'Consumo para desengrase y lavado interno de equipos' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ description: 'ID opcional del tipo de movimiento asociado' })
  @IsOptional()
  @IsString()
  tipoMovimientoId?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  estado?: number;
}

export class UpdateMotivoDto {
  @ApiProperty({ description: 'UUID del motivo' })
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
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipoMovimientoId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  estado?: number;
}
