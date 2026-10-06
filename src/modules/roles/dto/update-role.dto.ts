import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { AMBITOS } from '../../../common/permisos/catalogo-permisos.js';

const aLista = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

export class UpdateRoleDto {
  @ApiProperty({ example: '1b6b0bba-9ee1-4f99-a194-89e728542969', description: 'ID del rol a actualizar' })
  @IsString({ message: 'El id debe ser una cadena válida' })
  @IsNotEmpty({ message: 'El id es requerido' })
  id: string;

  @ApiProperty({ example: 'SUPERVISOR_ZONA', description: 'Nuevo nombre (no se puede cambiar en los roles oficiales)', required: false })
  @IsOptional()
  @IsString({ message: 'El campo namerol debe ser una cadena de texto' })
  namerol?: string;

  @ApiProperty({ example: 'Descripción actualizada del rol', description: 'Nueva descripción', required: false })
  @IsOptional()
  @IsString({ message: 'El campo descripcion debe ser una cadena de texto' })
  descripcion?: string;

  @ApiProperty({ example: 1, description: 'Nuevo estado del rol: 1 = Activo, 0 = Inactivo', required: false })
  @IsOptional()
  @IsIn([0, 1], { message: 'El estado debe ser 1 (Activo) o 0 (Inactivo)' })
  estado?: number;

  @ApiProperty({ description: 'Obsoleto: se ignora. Las pantallas del rol salen de sus permisos (capacidades).', type: [String], required: false, deprecated: true })
  @IsOptional()
  @Transform(aLista)
  @IsArray({ message: 'El campo permisos debe ser una lista de cadenas' })
  @IsString({ each: true, message: 'Cada elemento de permisos debe ser una cadena' })
  permisos?: string[];

  @ApiProperty({ example: ['servicios.ver'], description: 'Nueva lista de permisos que el backend exige', type: [String], required: false })
  @IsOptional()
  @Transform(aLista)
  @IsArray({ message: 'El campo capacidades debe ser una lista de cadenas' })
  @IsString({ each: true, message: 'Cada permiso debe ser un string' })
  capacidades?: string[];

  @ApiProperty({ example: 'AGENCIA', description: 'Sobre qué datos actúa el rol', enum: AMBITOS, required: false })
  @IsOptional()
  @IsIn([...AMBITOS], { message: 'El ámbito debe ser GLOBAL, REGION, AGENCIA o PROPIO' })
  ambito?: string;
}
