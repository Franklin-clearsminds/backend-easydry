import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateRoleDto {
  @ApiProperty({ example: '1b6b0bba-9ee1-4f99-a194-89e728542969', description: 'ID del rol a actualizar' })
  @IsString({ message: 'El id debe ser una cadena válida' })
  @IsNotEmpty({ message: 'El id es requerido' })
  id: string;

  @ApiProperty({ example: 'SUPERVISOR_REGIONAL_EDIT', description: 'Nuevo nombre de rol', required: false })
  @IsOptional()
  @IsString({ message: 'El campo namerol debe ser una cadena de texto' })
  namerol?: string;

  @ApiProperty({ example: 1, description: 'Nuevo estado del rol: 1 = Activo, 0 = Inactivo', required: false })
  @IsOptional()
  @IsIn([0, 1], { message: 'El estado debe ser 1 (Activo) o 0 (Inactivo)' })
  estado?: number;

  @ApiProperty({
    example: ['dashboard', 'sucursales', 'reportes'],
    description: 'Nueva lista de permisos (array de cadenas / lista)',
    type: [String],
    required: false,
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  })
  @IsArray({ message: 'El campo permisos debe ser una lista de cadenas' })
  @IsString({ each: true, message: 'Cada elemento de permisos debe ser una cadena' })
  permisos?: string[];
}
