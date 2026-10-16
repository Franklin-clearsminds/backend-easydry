import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsInt, IsIn, IsBoolean, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class AsignarUsuarioAgenciaDto {
  @ApiProperty({ example: 'uuid-usuario', description: 'ID del usuario a reasignar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  usuarioId: string;

  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'ID de la agencia principal asignada' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'ID de la región asignada (para roles como SUPERVISOR, COORD_COMERCIAL)' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({
    example: ['uuid-agencia-1', 'uuid-agencia-2'],
    description: 'Lista de IDs de agencias a las que tiene acceso (opcional, para supervisores/comerciales)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agenciasIds?: string[];
}

/**
 * Listado de usuarios. Dos modos según el cuerpo:
 *  - HEREDADO: sin `page` ni `pageSize` → arreglo plano completo (orden nombre asc), como siempre. Lo usan selectores,
 *    filtros y la app móvil como fuente de listas completas.
 *  - PAGINADO: con `page` o `pageSize` → formato estándar {items, total, page, ...} con orden, búsqueda y filtros en servidor.
 */
export class ListUsuariosAgenciaDto extends DataGridQueryDto {
  // Sin valores por defecto: así se distingue a un cliente antiguo (no envía página ni tamaño) de uno nuevo.
  @ApiPropertyOptional({ example: 1, description: 'Página (1 = primera). Activa el modo paginado.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  override page?: number = undefined;

  @ApiPropertyOptional({ example: 25, description: 'Filas por página (máximo 100; un valor mayor se recorta). Activa el modo paginado.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  override pageSize?: number = undefined;

  @ApiPropertyOptional({
    example: 'nombre',
    description: 'Columna: nombre, email, rol, agencia, region, estado, creado. Por defecto: más reciente primero.',
  })
  @IsOptional()
  @IsString()
  override sortField?: string = undefined;

  @ApiPropertyOptional({ example: 'asc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  override sortOrder?: 'asc' | 'desc' = undefined;

  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'Filtrar por agencia (si se omite, lista todos o los de la agencia del usuario)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'PULIDOR_FIJO', description: 'Filtrar por nombre de rol (modo paginado: varios separados por coma)' })
  @IsOptional()
  @IsString()
  rolNombre?: string;

  @ApiPropertyOptional({ example: 'uuid-rol', description: 'Filtrar por id de rol (solo modo paginado)' })
  @IsOptional()
  @IsString()
  rolId?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filtrar por estado: 1 (Activo), 0 (Inactivo)' })
  @IsOptional()
  @IsNumber()
  estado?: number;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'Usuarios de la región (directa o por su agencia). Solo modo paginado.' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'uuid-cliente', description: 'Usuarios de agencias de este cliente/marca. Solo modo paginado.' })
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({
    example: 'lavadores',
    enum: ['lavadores', 'supervisores', 'bodega', 'admins', 'inactivos'],
    description: 'Segmento rápido de la pantalla de usuarios. Solo modo paginado.',
  })
  @IsOptional()
  @IsIn(['todos', 'lavadores', 'supervisores', 'bodega', 'admins', 'inactivos'])
  segmento?: string;

  @ApiPropertyOptional({ description: 'Incluye los conteos por segmento con los mismos filtros (sin el segmento). Solo modo paginado.' })
  @IsOptional()
  @IsBoolean()
  incluirResumen?: boolean;
}

export class ToggleEstadoUsuarioDto {
  @ApiProperty({ example: 'uuid-usuario', description: 'ID del usuario a activar o desactivar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  usuarioId: string;

  @ApiPropertyOptional({ example: 0, description: 'Estado deseado: 1 (activo) o 0 (inactivo). Si se omite, se invierte.' })
  @IsOptional()
  @IsNumber()
  estado?: number;
}

export class AsignarPasswordDto {
  @ApiProperty({ example: 'uuid-usuario' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  id: string;

  @ApiProperty({ example: 'Lavado#2026Seco', description: 'Nueva contraseña (mín. 10 caracteres, con mayúscula, minúscula, número y carácter especial)' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password: string;
}

export class UpdateUsuarioDto {
  @ApiProperty({ example: 'uuid-usuario', description: 'ID del usuario a actualizar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'Carlos' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Mendoza' })
  @IsOptional()
  @IsString()
  lastname?: string;

  @ApiPropertyOptional({ example: 'carlos@easydry.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: 1, description: '1 = Activo, 0 = Inactivo' })
  @IsOptional()
  @IsNumber()
  estado?: number;

  @ApiPropertyOptional({ example: 'uuid-rol' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ example: 'SUPERVISOR' })
  @IsOptional()
  @IsString()
  rolNombre?: string;

  @ApiPropertyOptional({ example: 'uuid-agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'EasyDry Quito Norte dsd' })
  @IsOptional()
  @IsString()
  agencia?: string;

  @ApiPropertyOptional({ example: 'uuid-region' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'uuid-bodega', description: 'Bodega asignada (ASISTENTE_BODEGA)' })
  @IsOptional()
  @IsString()
  bodegaId?: string;

  @ApiPropertyOptional({ example: 'NuevaClave123*', description: 'Nueva contraseña si se desea actualizar' })
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional({ example: 'MOVIL', description: 'Modalidad de operador especial: FIJO o MOVIL' })
  @IsOptional()
  @IsString()
  modalidadPulidor?: string;

  @ApiPropertyOptional({
    example: [3, 5],
    description: 'IDs de CatalogoServicio asignados al pulidor móvil (insumos necesarios)',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  servicioIds?: number[];
}

export class DeleteUsuarioDto {
  @ApiProperty({ example: 'uuid-usuario', description: 'ID del usuario a eliminar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  id: string;
}

export class CreateUsuarioDto {
  @ApiProperty({ example: 'Carlos' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  name: string;

  @ApiPropertyOptional({ example: 'Mendoza' })
  @IsOptional()
  @IsString()
  lastname?: string;

  @ApiProperty({ example: 'carlos@easydry.com' })
  @IsString()
  @IsNotEmpty({ message: 'El correo es obligatorio' })
  email: string;

  @ApiProperty({ example: 'Password123*', description: 'Contraseña de acceso' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password: string;

  @ApiPropertyOptional({ example: 1, description: '1 = Activo, 0 = Inactivo' })
  @IsOptional()
  @IsNumber()
  estado?: number;

  @ApiPropertyOptional({ example: 'uuid-rol' })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({ example: 'SUPERVISOR' })
  @IsOptional()
  @IsString()
  rolNombre?: string;

  @ApiPropertyOptional({ example: 'uuid-agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'EasyDry Quito Norte' })
  @IsOptional()
  @IsString()
  agencia?: string;

  @ApiPropertyOptional({ example: 'uuid-region' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'uuid-bodega', description: 'Bodega asignada (obligatoria para ASISTENTE_BODEGA)' })
  @IsOptional()
  @IsString()
  bodegaId?: string;

  @ApiPropertyOptional({ example: 'MOVIL', description: 'Modalidad de operador especial: FIJO o MOVIL' })
  @IsOptional()
  @IsString()
  modalidadPulidor?: string;

  @ApiPropertyOptional({
    example: [3, 5],
    description: 'IDs de CatalogoServicio asignados al pulidor móvil (insumos necesarios)',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  servicioIds?: number[];
}

/** Sin page/pageSize: arreglo (hasta 100). Con alguno: página. Orden: nombre, agencia, rol, estado, fecha. */
export class ListOperadoresDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'ID o nombre de la agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 = Activo, 0 = Inactivo' })
  @IsOptional()
  @IsNumber()
  estado?: number;

  @ApiPropertyOptional({ example: 'PULIDOR', description: 'Filtrar por rol específico o prefijo' })
  @IsOptional()
  @IsString()
  rol?: string;

  @ApiPropertyOptional({ example: 'PULIDOR', description: 'Filtrar por categoría (PULIDOR o LAVADOR)' })
  @IsOptional()
  @IsString()
  categoriaRol?: string;

  @ApiPropertyOptional({ description: 'Nombre (o parte) de la bahía asignada' })
  @IsOptional()
  @IsString()
  bahiaNombre?: string;

  @ApiPropertyOptional({ description: 'Nombre exacto del cliente/marca de la agencia' })
  @IsOptional()
  @IsString()
  clienteNombre?: string;
}

export class CreateOperadorDto {
  @ApiProperty({ example: 'Pedro Ramírez' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  nombre: string;

  @ApiProperty({ example: 'Lavado#2026Seco', description: 'Contraseña inicial (mín. 10 caracteres, con mayúscula, minúscula, número y carácter especial)' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password: string;

  @ApiPropertyOptional({ example: '1723456789' })
  @IsOptional()
  @IsString()
  cedula?: string;

  @ApiPropertyOptional({ example: '0998765432' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 'Operador de Bahía' })
  @IsOptional()
  @IsString()
  rol?: string;

  @ApiProperty({ example: 'uuid-agencia' })
  @IsString()
  @IsNotEmpty({ message: 'La agencia es obligatoria' })
  agenciaId: string;

  @ApiPropertyOptional({ example: 'uuid-bahia' })
  @IsOptional()
  @IsString()
  bahiaId?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @IsNumber()
  estado?: number;
}

export class UpdateOperadorDto {
  @ApiProperty({ example: 'uuid-operador' })
  @IsString()
  @IsNotEmpty({ message: 'El ID del operador es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'Pedro Ramírez' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: '1723456789' })
  @IsOptional()
  @IsString()
  cedula?: string;

  @ApiPropertyOptional({ example: '0998765432' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 'Operador de Bahía' })
  @IsOptional()
  @IsString()
  rol?: string;

  @ApiPropertyOptional({ example: 'uuid-agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'uuid-bahia' })
  @IsOptional()
  @IsString()
  bahiaId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  estado?: number;
}

