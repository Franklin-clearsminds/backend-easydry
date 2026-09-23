import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ListRetosDto {
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  incluirTodos?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  soloActivos?: boolean;
}

export class CreateRetoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  titulo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  premio?: string;

  @IsDateString()
  fechaInicio!: string;

  @IsDateString()
  fechaFin!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  regiones?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  marcas?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sucursalesIds?: string[];

  @IsOptional()
  @IsIn(['ACTIVO', 'FINALIZADO', 'PENDIENTE', 'INACTIVO'])
  estado?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  criterios?: string[];
}

export class DeleteRetoDto {
  @IsString()
  id!: string;
}
