import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import { IsString, IsNotEmpty, IsOptional, IsInt, IsIn, IsEmail, IsArray, IsBoolean } from 'class-validator';
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

  @ApiPropertyOptional({ example: 2, description: 'Máximo de lavadores simultáneos por bahía' })
  @IsOptional()
  @IsInt()
  maxLavadoresPorBahia?: number = 1;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'ID del cliente corporativo al que pertenece la agencia' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'Alias retrocompatible para clienteId' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number = 1;

  @ApiPropertyOptional({ example: 'uuid-gerente', description: 'ID del usuario gerente responsable' })
  @IsOptional()
  @IsString()
  gerenteId?: string;

  @ApiPropertyOptional({ example: 'uuid-lider', description: 'ID del usuario líder operador de la agencia' })
  @IsOptional()
  @IsString()
  liderOperadorId?: string;

  @ApiPropertyOptional({ example: [6, 7, 8, 9], description: 'IDs de los servicios del catálogo que ofrece la agencia' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  servicioIds?: number[];

  @ApiPropertyOptional({ example: ['Lavado Express', 'Lavado Full'], description: 'Nombres de los servicios asignados' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviciosNombres?: string[];

  @ApiPropertyOptional({ example: true, description: 'Si la agencia tiene activos los servicios especiales' })
  @IsOptional()
  @IsBoolean()
  tieneServiciosEspeciales?: boolean;

  @ApiPropertyOptional({ example: 'OPERATIVA', enum: ['OPERATIVA', 'TALLER_NACIONAL', 'TALLER_REGIONAL'] })
  @IsOptional()
  @IsString()
  @IsIn(['OPERATIVA', 'TALLER_NACIONAL', 'TALLER_REGIONAL'])
  tipoUbicacion?: string;
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

  @ApiPropertyOptional({ example: 2, description: 'Máximo de lavadores simultáneos por bahía' })
  @IsOptional()
  @IsInt()
  maxLavadoresPorBahia?: number;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'ID del cliente corporativo' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'Alias retrocompatible para clienteId' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1])
  estado?: number;

  @ApiPropertyOptional({ example: 'uuid-gerente', description: 'ID del usuario gerente responsable' })
  @IsOptional()
  @IsString()
  gerenteId?: string;

  @ApiPropertyOptional({ example: 'uuid-lider', description: 'ID del usuario líder operador de la agencia' })
  @IsOptional()
  @IsString()
  liderOperadorId?: string;

  @ApiPropertyOptional({ example: [6, 7, 8, 9], description: 'IDs de los servicios del catálogo que ofrece la agencia' })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  servicioIds?: number[];

  @ApiPropertyOptional({ example: ['Lavado Express', 'Lavado Full'], description: 'Nombres de los servicios asignados' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviciosNombres?: string[];

  @ApiPropertyOptional({ example: true, description: 'Si la agencia tiene activos los servicios especiales' })
  @IsOptional()
  @IsBoolean()
  tieneServiciosEspeciales?: boolean;

  @ApiPropertyOptional({ example: 'OPERATIVA', enum: ['OPERATIVA', 'TALLER_NACIONAL', 'TALLER_REGIONAL'] })
  @IsOptional()
  @IsString()
  @IsIn(['OPERATIVA', 'TALLER_NACIONAL', 'TALLER_REGIONAL'])
  tipoUbicacion?: string;
}

/**
 * Sin page/pageSize: arreglo con hasta 100 agencias (con todos sus usuarios, como siempre). Con alguno: página estándar; los
 * datos calculados (productividad del mes, gerente, líder) se resuelven solo para las agencias de la página.
 * Orden: nombre, codigo, region, estado, cliente, bahias, usuarios, fecha.
 */
export class ListAgenciasDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ example: 'Pichincha', description: 'Filtrar por región (nombre)' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'Filtrar por ID de región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'Filtrar por cliente corporativo' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'Alias retrocompatible para clienteId' })
  @IsOptional()
  @IsString()
  marcaId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 activo, 0 inactivo, 2 mantenimiento' })
  @IsOptional()
  @IsInt()
  @IsIn([0, 1, 2])
  estado?: number;

  @ApiPropertyOptional({ example: 'Norte', description: 'Región por nombre exacto (sin distinguir mayúsculas)' })
  @IsOptional()
  @IsString()
  regionNombre?: string;

  @ApiPropertyOptional({ example: 'Corporación Favorita', description: 'Cliente por nombre exacto (sin distinguir mayúsculas)' })
  @IsOptional()
  @IsString()
  clienteNombre?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'false omite la productividad del mes (una consulta de todos los servicios del mes); úsalo si solo necesitas la lista de agencias',
  })
  @IsOptional()
  @IsBoolean()
  incluirProductividad?: boolean;
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
