import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { AMBITOS } from '../../../common/permisos/catalogo-permisos.js';

const aLista = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

export class CreateRoleDto {
  @ApiProperty({ example: 'SUPERVISOR_ZONA', description: 'Nombre único del rol (se guarda en mayúsculas)' })
  @IsString({ message: 'El campo namerol debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El campo namerol es requerido' })
  namerol: string;

  @ApiProperty({ example: 'Supervisa las operaciones de las agencias asignadas', description: 'Descripción del rol', required: false })
  @IsOptional()
  @IsString({ message: 'El campo descripcion debe ser una cadena de texto' })
  descripcion?: string;

  @ApiProperty({ example: 1, description: 'Estado del rol: 1 = Activo, 0 = Inactivo', default: 1 })
  @IsOptional()
  @IsIn([0, 1], { message: 'El estado debe ser 1 (Activo) o 0 (Inactivo)' })
  estado?: number;

  @ApiProperty({ example: ['dashboard', 'agencias'], description: 'Módulos de navegación a los que accede (códigos de modulos_sistema)', type: [String], default: [] })
  @IsOptional()
  @Transform(aLista)
  @IsArray({ message: 'El campo permisos debe ser una lista de cadenas' })
  @IsString({ each: true, message: 'Cada módulo dentro de la lista debe ser un string' })
  permisos?: string[];

  @ApiProperty({ example: ['servicios.ver', 'servicios.crear'], description: 'Permisos que el backend exige (catálogo de permisos)', type: [String], default: [] })
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
