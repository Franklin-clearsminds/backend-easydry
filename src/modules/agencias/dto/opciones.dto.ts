import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OpcionesDto } from '../../../common/utils/opciones.js';

/** Opciones de agencias (mismo alcance por rol que `agencias/list`). Orden: por nombre. */
export class AgenciasOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() regionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clienteId?: string;
  @ApiPropertyOptional({ description: '1 activas, 0 inactivas; sin valor: todas' })
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([0, 1]) estado?: number;
}

export class RegionesOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional({ description: '1 activas, 0 inactivas; sin valor: todas' })
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([0, 1]) estado?: number;
}

/** Clientes / marcas. */
export class ClientesOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional({ description: 'Filtrar por región para traer solo clientes con agencias en esa región' })
  @IsOptional() @IsString() regionId?: string;

  @ApiPropertyOptional({ description: '1 activos, 0 inactivos; sin valor: todos' })
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([0, 1]) estado?: number;
}

export class BahiasOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional({ description: 'Solo las bahías de esta agencia' })
  @IsOptional() @IsString() agenciaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() activa?: boolean;
}

/** Operadores (lavadores y pulidores): mismo alcance por rol que `operadores/list`. */
export class OperadoresOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() agenciaId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() rol?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() categoriaRol?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() estado?: number;
}

/** Usuarios del sistema (sin SUPER_ADMIN). */
export class UsuariosOpcionesDto extends OpcionesDto {
  @ApiPropertyOptional() @IsOptional() @IsString() agenciaId?: string;
  @ApiPropertyOptional({ description: 'Roles separados por coma' })
  @IsOptional() @IsString() rolNombre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() regionId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() estado?: number;
}
