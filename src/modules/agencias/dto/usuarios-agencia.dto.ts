import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

export class ListUsuariosAgenciaDto {
  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'Filtrar por agencia (si se omite, lista todos o los de la agencia del usuario)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'PULIDOR_FIJO', description: 'Filtrar por nombre de rol' })
  @IsOptional()
  @IsString()
  rolNombre?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filtrar por estado: 1 (Activo), 0 (Inactivo)' })
  @IsOptional()
  @IsNumber()
  estado?: number;
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

  @ApiPropertyOptional({ example: 'NuevaClave123*', description: 'Nueva contraseña si se desea actualizar' })
  @IsOptional()
  @IsString()
  password?: string;
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

  @ApiPropertyOptional({ example: 'MOVIL', description: 'Modalidad de operador especial: FIJO o MOVIL' })
  @IsOptional()
  @IsString()
  modalidadPulidor?: string;
}

export class ListOperadoresDto {
  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'ID o nombre de la agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 1, description: '1 = Activo, 0 = Inactivo' })
  @IsOptional()
  @IsNumber()
  estado?: number;
}

export class CreateOperadorDto {
  @ApiProperty({ example: 'Pedro Ramírez' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio' })
  nombre: string;

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

