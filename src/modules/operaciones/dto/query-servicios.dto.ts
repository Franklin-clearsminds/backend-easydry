import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ServiceStatus } from '@prisma/client';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class QueryServiciosDto extends DataGridQueryDto {
  // Sin valores por defecto en el DTO: así el servidor distingue a un cliente antiguo (que no envía página ni tamaño)
  // de uno nuevo. Antes el DTO fijaba pageSize = 20 y la lista solo devolvía las 20 órdenes más recientes.
  @ApiPropertyOptional({ example: 1, description: 'Página (1 = primera)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  override page?: number = undefined;

  @ApiPropertyOptional({ example: 25, description: 'Filas por página (máximo 100; un valor mayor se recorta)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  override pageSize?: number = undefined;

  @ApiPropertyOptional({
    example: 'fecha',
    description: 'Columna: fecha, ot, placa, modelo, cliente, estado, servicio, operador, agencia, bahia, createdAt. Por defecto: más reciente primero.',
  })
  @IsOptional()
  @IsString()
  override sortField?: string = undefined;

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = undefined;

  @ApiPropertyOptional({ example: 'sucursal-uuid-01', description: 'Filtrar por ID de sucursal' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ example: 'agencia-uuid-01', description: 'Filtrar por ID de agencia (mismo que sucursal)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'region-uuid-01', description: 'Filtrar por ID de región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por estado operativo' })
  @IsOptional()
  @IsString()
  estado?: string | ServiceStatus;

  @ApiPropertyOptional({ description: 'Filtrar por bahía' })
  @IsOptional()
  @IsString()
  bahiaId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por operador (lavador). Un lavador siempre ve solo los suyos.' })
  @IsOptional()
  @IsString()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por servicio del catálogo' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  servicioId?: number;

  @ApiPropertyOptional({ description: 'Filtrar por cliente / marca de la agencia' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  // Filtros por NOMBRE (para las pantallas que trabajan con los nombres que emite el filter-bar).
  @ApiPropertyOptional({ description: 'Nombre exacto de la agencia (sin distinguir mayúsculas)' })
  @IsOptional()
  @IsString()
  agenciaNombre?: string;

  @ApiPropertyOptional({ description: 'Nombre exacto de la bahía' })
  @IsOptional()
  @IsString()
  bahiaNombre?: string;

  @ApiPropertyOptional({ description: 'Nombre del operador (cada palabra debe aparecer en su nombre o apellido)' })
  @IsOptional()
  @IsString()
  operadorNombre?: string;

  @ApiPropertyOptional({ description: 'Nombre exacto del cliente/marca de la agencia' })
  @IsOptional()
  @IsString()
  clienteNombre?: string;

  @ApiPropertyOptional({ example: '2026-09-01T05:00:00.000Z', description: 'Desde (inclusive), por hora de ingreso. ISO 8601.' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2026-09-30T04:59:59.999Z', description: 'Hasta (inclusive), por hora de ingreso. ISO 8601.' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Incluye en la respuesta el conteo por estado con los mismos filtros (menos el de estado)' })
  @IsOptional()
  @IsBoolean()
  incluirResumen?: boolean;
}
