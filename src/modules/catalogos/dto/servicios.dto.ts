import { OpcionesDto } from '../../../common/utils/opciones.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsNumber, IsOptional, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';

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
  @Type(() => Number)
  @IsNumber()
  precio?: number;

  @ApiProperty({
    example: 30,
    description: 'Duración estimada en minutos. Se usa para calcular hora de salida al crear la OT.',
    default: 30,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  tiempoEstimadoMin: number;

  @ApiPropertyOptional({ example: 'Activo', description: 'Activo (por defecto) o Inactivo' })
  @IsOptional()
  @IsIn(['Activo', 'Inactivo'])
  estado?: 'Activo' | 'Inactivo';
}

export class UpdateCatalogoServicioDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
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
  @Type(() => Number)
  @IsNumber()
  precio?: number;

  @ApiPropertyOptional({
    example: 35,
    description: 'Duración estimada en minutos para cálculo de hora de salida en OT',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  tiempoEstimadoMin?: number;

  @ApiPropertyOptional({ example: 'Inactivo', description: 'Activo o Inactivo' })
  @IsOptional()
  @IsIn(['Activo', 'Inactivo'])
  estado?: 'Activo' | 'Inactivo';
}

/** Sin page/pageSize: como siempre (hasta 100). Con alguno: página. Orden: codigo, nombre, categoria, precio, tiempo, fecha. */
export class ListCatalogoServiciosDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ example: 'GENERAL' })
  @IsOptional()
  @IsString()
  categoria?: string;

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

export class SiguienteCodigoServicioDto {
  @ApiPropertyOptional({ example: 'GENERAL', description: 'GENERAL → SER-###; ESPECIAL o EXTRA → ESP-###' })
  @IsOptional()
  @IsString()
  categoria?: string;
}

/** Servicios del catálogo para un desplegable con buscador (mismo alcance por agencia/rol que `servicios/list`). */
export class ServiciosOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional({ example: 'GENERAL' })
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional({ description: 'Solo los servicios habilitados para esta agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;
}
