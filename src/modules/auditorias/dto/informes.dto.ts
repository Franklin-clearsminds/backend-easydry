import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import {
  CALIFICACIONES,
  CATEGORIAS_NOVEDAD,
  ESTADOS_INFORME,
  ESTADOS_PLAN,
  TIPOS_INSPECCION,
} from '../informes.reglas.js';

const TEXTO_LARGO = 8000;

export class ListInformesDto extends PaginacionOpcionalDto {
  @IsOptional() @IsUUID() agenciaId?: string;
  @IsOptional() @IsUUID() inspectorId?: string;
  @IsOptional() @IsIn(ESTADOS_INFORME) estado?: string;
  @IsOptional() @IsIn(CALIFICACIONES) calificacion?: string;
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
}

export class IdInformeDto {
  @IsUUID() id!: string;
}

export class NovedadDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(160) titulo!: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) descripcion?: string;
  @IsOptional() @IsIn(CATEGORIAS_NOVEDAD) categoria?: string;
  @IsOptional() @IsString() @MaxLength(120) area?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) fotos?: string[];}

export class ActividadDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(160) nombre!: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) descripcion?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) fotos?: string[];
}

export class PlanAccionDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @IsNotEmpty() @MaxLength(TEXTO_LARGO) problema!: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) accionRequerida?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) evidenciaCumplimiento?: string[];
}

export class GuardarInformeDto {
  /** Solo en `update`. */
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() agenciaId!: string;
  @IsOptional() @IsUUID() destinatarioId?: string;
  @IsOptional() @IsString() @MaxLength(160) destinatarioNombre?: string;
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsDateString() fechaVisita?: string;
  @IsOptional() @IsIn(TIPOS_INSPECCION) tipoInspeccion?: string;
  /** `false` si el jefe de taller no estuvo: no se valida su contraseña ni se pide su firma. */
  @IsOptional() @IsBoolean() jefeTallerPresente?: boolean;
  @IsOptional() @IsString() @MaxLength(300) asunto?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) antecedentes?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) desarrollo?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) actividadesGeneral?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) planesGeneral?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) observacionesJefeTaller?: string;
  @IsOptional() @IsIn(CALIFICACIONES) calificacion?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => NovedadDto) novedades?: NovedadDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ActividadDto) actividades?: ActividadDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => PlanAccionDto) planes?: PlanAccionDto[];
}

export class SeguimientoPlanDto {
  @IsUUID() planId!: string;
  @IsIn(ESTADOS_PLAN) estado!: string;
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) observaciones?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) evidenciaCumplimiento?: string[];
}

export class ListPlanesDto extends PaginacionOpcionalDto {
  @IsOptional() @IsUUID() agenciaId?: string;
  /** PENDIENTE | EN_PROCESO | COMPLETADO | CANCELADO | ABIERTOS (pendiente y en proceso) */
  @IsOptional() @IsIn([...ESTADOS_PLAN, 'ABIERTOS']) estado?: string;
}
