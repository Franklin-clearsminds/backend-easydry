import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateCatalogoServicioDto {
  @ApiProperty({ example: 'SER-001', description: 'Código único del servicio' })
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @ApiProperty({ example: 'Lavado Express Ecológico', description: 'Nombre descriptivo del servicio' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiProperty({ example: 'GENERAL', description: 'Categoría: GENERAL o ESPECIAL' })
  @IsString()
  @IsNotEmpty()
  categoria: string;

  @ApiPropertyOptional({ example: 'Lavado exterior en seco con cera bio-protectora' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 15.0, default: 0.0 })
  @IsOptional()
  @IsNumber()
  precio?: number;

  @ApiPropertyOptional({ example: 30, default: 30 })
  @IsOptional()
  @IsNumber()
  tiempoEstimadoMin?: number;
}

export class UpdateCatalogoServicioDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  id: number;

  @ApiPropertyOptional({ example: 'SER-001' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({ example: 'Lavado Express Actualizado' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 'GENERAL' })
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional({ example: 'Descripción actualizada' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 18.0 })
  @IsOptional()
  @IsNumber()
  precio?: number;

  @ApiPropertyOptional({ example: 35 })
  @IsOptional()
  @IsNumber()
  tiempoEstimadoMin?: number;
}

export class ListCatalogoServiciosDto {
  @ApiPropertyOptional({ example: 'GENERAL' })
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional({ example: 'Express' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'uuid-agencia-123', description: 'Filtrar servicios habilitados para esta agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;
}

export class DeleteCatalogoServicioDto {
  @ApiProperty({ example: 1 })
  @IsNumber()
  @IsNotEmpty()
  id: number;
}
