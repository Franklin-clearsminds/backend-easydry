import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateRoleDto {
  @ApiProperty({ example: 'SUPERVISOR_REGIONAL', description: 'Nombre único del rol (string)' })
  @IsString({ message: 'El campo namerol debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El campo namerol es requerido' })
  namerol: string;

  @ApiProperty({ example: 1, description: 'Estado del rol: 1 = Activo, 0 = Inactivo', default: 1 })
  @IsOptional()
  @IsIn([0, 1], { message: 'El estado debe ser 1 (Activo) o 0 (Inactivo)' })
  estado?: number;

  @ApiProperty({
    example: ['dashboard', 'sucursales', 'operadores', 'reportes'],
    description: 'Lista de permisos asignados al rol (array de cadenas / lista)',
    type: [String],
    default: [],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  })
  @IsArray({ message: 'El campo permisos debe ser una lista de cadenas' })
  @IsString({ each: true, message: 'Cada permiso dentro de la lista debe ser un string' })
  permisos?: string[];
}
