import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por agencia' })
  @IsOptional() @IsUUID() agenciaId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por inspector' })
  @IsOptional() @IsUUID() inspectorId?: string;
  @ApiPropertyOptional({ enum: ESTADOS_INFORME as unknown as string[], description: 'Filtrar por estado del informe' })
  @IsOptional() @IsIn(ESTADOS_INFORME) estado?: string;
  @ApiPropertyOptional({ enum: CALIFICACIONES as unknown as string[], description: 'Filtrar por calificación' })
  @IsOptional() @IsIn(CALIFICACIONES) calificacion?: string;
  @ApiPropertyOptional({ description: 'Fecha inicial (ISO 8601)', example: '2026-11-01' })
  @IsOptional() @IsDateString() desde?: string;
  @ApiPropertyOptional({ description: 'Fecha final (ISO 8601)', example: '2026-11-30' })
  @IsOptional() @IsDateString() hasta?: string;
}

export class IdInformeDto {
  @ApiProperty({ format: 'uuid', description: 'ID del informe de inspección' })
  @IsUUID() id!: string;
}

export class NovedadDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'ID de la novedad existente (al actualizar)' })
  @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ maxLength: 160 })
  @IsString() @IsNotEmpty() @MaxLength(160) titulo!: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) descripcion?: string;
  @ApiPropertyOptional({ enum: CATEGORIAS_NOVEDAD as unknown as string[] })
  @IsOptional() @IsIn(CATEGORIAS_NOVEDAD) categoria?: string;
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120) area?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 12, description: 'Claves de las fotos ya subidas (máx. 12)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) fotos?: string[];
}

export class ActividadDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'ID de la actividad existente (al actualizar)' })
  @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ maxLength: 160 })
  @IsString() @IsNotEmpty() @MaxLength(160) nombre!: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) descripcion?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 12, description: 'Claves de las fotos ya subidas (máx. 12)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) fotos?: string[];
}

export class PlanAccionDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'ID del plan existente (al actualizar)' })
  @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ maxLength: TEXTO_LARGO, description: 'Problema detectado' })
  @IsString() @IsNotEmpty() @MaxLength(TEXTO_LARGO) problema!: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) accionRequerida?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 12, description: 'Claves de las fotos de evidencia de cumplimiento (máx. 12)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) evidenciaCumplimiento?: string[];
}

export class GuardarInformeDto {
  /** Solo en `update`. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Solo en `update`: ID del informe' })
  @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ format: 'uuid', description: 'Agencia inspeccionada' })
  @IsUUID() agenciaId!: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Usuario destinatario del informe' })
  @IsOptional() @IsUUID() destinatarioId?: string;
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional() @IsString() @MaxLength(160) destinatarioNombre?: string;
  @ApiPropertyOptional({ description: 'Fecha del informe (ISO 8601)', example: '2026-11-05' })
  @IsOptional() @IsDateString() fecha?: string;
  @ApiPropertyOptional({ description: 'Fecha de la visita (ISO 8601)', example: '2026-11-05' })
  @IsOptional() @IsDateString() fechaVisita?: string;
  @ApiPropertyOptional({ enum: TIPOS_INSPECCION as unknown as string[] })
  @IsOptional() @IsIn(TIPOS_INSPECCION) tipoInspeccion?: string;
  /** `false` si el jefe de taller no estuvo: no se valida su contraseña ni se pide su firma. */
  @ApiPropertyOptional({ description: '`false` si el jefe de taller no estuvo: no se valida su contraseña ni se pide su firma' })
  @IsOptional() @IsBoolean() jefeTallerPresente?: boolean;
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional() @IsString() @MaxLength(300) asunto?: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) antecedentes?: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) desarrollo?: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) actividadesGeneral?: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) planesGeneral?: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) observacionesJefeTaller?: string;
  @ApiPropertyOptional({ enum: CALIFICACIONES as unknown as string[] })
  @IsOptional() @IsIn(CALIFICACIONES) calificacion?: string;
  @ApiPropertyOptional({ type: () => [NovedadDto], maxItems: 60 })
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => NovedadDto) novedades?: NovedadDto[];
  @ApiPropertyOptional({ type: () => [ActividadDto], maxItems: 60 })
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => ActividadDto) actividades?: ActividadDto[];
  @ApiPropertyOptional({ type: () => [PlanAccionDto], maxItems: 60 })
  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => PlanAccionDto) planes?: PlanAccionDto[];
}

export class SeguimientoPlanDto {
  @ApiProperty({ format: 'uuid', description: 'ID del plan de acción' })
  @IsUUID() planId!: string;
  @ApiProperty({ enum: ESTADOS_PLAN as unknown as string[] })
  @IsIn(ESTADOS_PLAN) estado!: string;
  @ApiPropertyOptional({ maxLength: TEXTO_LARGO })
  @IsOptional() @IsString() @MaxLength(TEXTO_LARGO) observaciones?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 12, description: 'Claves de las fotos de evidencia de cumplimiento (máx. 12)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) evidenciaCumplimiento?: string[];
}

export class ListPlanesDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por agencia' })
  @IsOptional() @IsUUID() agenciaId?: string;
  /** PENDIENTE | EN_PROCESO | COMPLETADO | CANCELADO | ABIERTOS (pendiente y en proceso) */
  @ApiPropertyOptional({ enum: [...ESTADOS_PLAN, 'ABIERTOS'], description: 'ABIERTOS = pendientes y en proceso' })
  @IsOptional() @IsIn([...ESTADOS_PLAN, 'ABIERTOS']) estado?: string;
}

/** Adjunta usuarios a un informe: cuando se aprueba, a cada uno le llega una notificación. */
export class AdjuntarUsuariosDto {
  @ApiProperty({ format: 'uuid', description: 'ID del informe' })
  @IsUUID() informeId!: string;
  @ApiProperty({ type: [String], minItems: 1, maxItems: 100, description: 'IDs de los usuarios a adjuntar' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('all', { each: true }) userIds!: string[];
}

export class QuitarAdjuntoDto {
  @ApiProperty({ format: 'uuid', description: 'ID del informe' })
  @IsUUID() informeId!: string;
  @ApiProperty({ format: 'uuid', description: 'ID del usuario adjunto a quitar' })
  @IsUUID() userId!: string;
}

/** Búsqueda de usuarios a quienes adjuntar un informe. */
export class BuscarAdjuntablesDto {
  @ApiPropertyOptional({ maxLength: 80, description: 'Texto a buscar en nombre o correo' })
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() regionId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() clienteId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() agenciaId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() roleId?: string;
}
