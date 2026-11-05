import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';
import { AREAS_5S, AREA_GENERAL, ESTADOS_ACCION, ESTADOS_AUDITORIA_5S, FORMATOS_5S } from '../auditoria5s.reglas.js';

const TEXTO = 4000;

export class ListAuditorias5sDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por agencia' })
  @IsOptional() @IsUUID() agenciaId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por auditor' })
  @IsOptional() @IsUUID() auditorId?: string;
  @ApiPropertyOptional({ enum: AREAS_5S as unknown as string[], description: 'Filtrar por área' })
  @IsOptional() @IsIn(AREAS_5S) area?: string;
  @ApiPropertyOptional({ enum: FORMATOS_5S as unknown as string[], description: 'Filtrar por formato de auditoría' })
  @IsOptional() @IsIn(FORMATOS_5S) formato?: string;
  @ApiPropertyOptional({ enum: ESTADOS_AUDITORIA_5S as unknown as string[], description: 'Filtrar por estado' })
  @IsOptional() @IsIn(ESTADOS_AUDITORIA_5S) estado?: string;
  @ApiPropertyOptional({ enum: ['VERDE', 'AMARILLO', 'ROJO'], description: 'Filtrar por semáforo del resultado' })
  @IsOptional() @IsIn(['VERDE', 'AMARILLO', 'ROJO']) semaforo?: string;
  @ApiPropertyOptional({ description: 'Fecha inicial (ISO 8601)', example: '2026-11-01' })
  @IsOptional() @IsDateString() desde?: string;
  @ApiPropertyOptional({ description: 'Fecha final (ISO 8601)', example: '2026-11-30' })
  @IsOptional() @IsDateString() hasta?: string;
}

export class ResumenAuditorias5sDto {
  /** Sin formato: todos juntos. */
  @ApiPropertyOptional({ enum: FORMATOS_5S as unknown as string[], description: 'Formato a resumir; sin formato: todos juntos' })
  @IsOptional() @IsIn(FORMATOS_5S) formato?: string;
}

export class IdAuditoria5sDto {
  @ApiProperty({ format: 'uuid', description: 'ID de la auditoría 5S' })
  @IsUUID() id!: string;
}

export class RespuestaDto {
  /** Número de la pregunta en el catálogo del formato (1 a 50). */
  @ApiProperty({ minimum: 1, maximum: 50, description: 'Número de la pregunta en el catálogo del formato (1 a 50)' })
  @IsInt() @Min(1) @Max(50) criterio!: number;
  /** Puntaje de 0 a 5 (según el formato); en SI/NO, 1 = SI y 0 = NO. null o ausente = sin evaluar. */
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 5, description: 'Puntaje de 0 a 5 (según el formato); en SI/NO, 1 = SI y 0 = NO. null o ausente = sin evaluar' })
  @IsOptional() @IsInt() @Min(0) @Max(5) puntaje?: number | null;
  @ApiPropertyOptional({ maxLength: TEXTO, description: 'Hallazgo observado' })
  @IsOptional() @IsString() @MaxLength(TEXTO) hallazgo?: string;
  @ApiPropertyOptional({ maxLength: TEXTO })
  @IsOptional() @IsString() @MaxLength(TEXTO) observaciones?: string;
  @ApiPropertyOptional({ maxLength: TEXTO, description: 'Acción correctiva propuesta' })
  @IsOptional() @IsString() @MaxLength(TEXTO) accionCorrectiva?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 12, description: 'Claves de las fotos de evidencia ya subidas (máx. 12)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) fotos?: string[];
}

export class GuardarAuditoria5sDto {
  /** Solo en `update`. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Solo en `update`: ID de la auditoría' })
  @IsOptional() @IsUUID() id?: string;
  @ApiProperty({ format: 'uuid', description: 'Agencia auditada' })
  @IsUUID() agenciaId!: string;
  /** Ya no se pide en los formularios: sin área, la auditoría queda como «General». */
  @ApiPropertyOptional({ enum: [...AREAS_5S, AREA_GENERAL], description: 'Ya no se pide en los formularios: sin área, la auditoría queda como «General»' })
  @IsOptional() @IsIn([...AREAS_5S, AREA_GENERAL]) area?: string;
  /** Solo en `create`: los formatos a realizar en esta visita. Cada uno se guarda como una auditoría aparte con los mismos datos. */
  @ApiPropertyOptional({ type: [String], enum: FORMATOS_5S as unknown as string[], minItems: 1, maxItems: 3, description: 'Solo en `create`: los formatos a realizar en esta visita. Cada uno se guarda como una auditoría aparte con los mismos datos' })
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(FORMATOS_5S, { each: true }) formatos?: string[];
  @ApiPropertyOptional({ description: 'Fecha de la auditoría (ISO 8601)', example: '2026-11-05' })
  @IsOptional() @IsDateString() fecha?: string;
  @ApiPropertyOptional({ maxLength: 160, description: 'Responsable de la agencia durante la visita' })
  @IsOptional() @IsString() @MaxLength(160) responsableAgencia?: string;
  @ApiPropertyOptional({ maxLength: 160, description: 'Persona del equipo auditado' })
  @IsOptional() @IsString() @MaxLength(160) equipoPersona?: string;
  @ApiPropertyOptional({ maxLength: TEXTO })
  @IsOptional() @IsString() @MaxLength(TEXTO) comentarios?: string;
  /** Comentarios / acciones por cada S: { SEIRI: '…' }. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, example: { SEIRI: 'Retirar lo innecesario' }, description: 'Comentarios / acciones por cada S' })
  @IsOptional() @IsObject() comentariosCategoria?: Record<string, string>;
  @ApiPropertyOptional({ type: () => [RespuestaDto], maxItems: 50, description: 'Respuestas por criterio' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RespuestaDto) respuestas?: RespuestaDto[];
}

export class ListAccionesDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por agencia' })
  @IsOptional() @IsUUID() agenciaId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtrar por auditoría de origen' })
  @IsOptional() @IsUUID() auditoriaId?: string;
  /** PENDIENTE | EN_PROCESO | EN_VERIFICACION | CERRADA | ABIERTAS */
  @ApiPropertyOptional({ enum: [...ESTADOS_ACCION, 'ABIERTAS'], description: 'Estado de la acción; ABIERTAS = todas las no cerradas' })
  @IsOptional() @IsIn([...ESTADOS_ACCION, 'ABIERTAS']) estado?: string;
}

export class SeguimientoAccionDto {
  @ApiProperty({ format: 'uuid', description: 'ID de la acción correctiva' })
  @IsUUID() id!: string;
  /** Quien da seguimiento no cierra: como máximo la manda a verificación. */
  @ApiProperty({ enum: ['PENDIENTE', 'EN_PROCESO', 'EN_VERIFICACION'], description: 'Quien da seguimiento no cierra: como máximo la manda a verificación' })
  @IsIn(['PENDIENTE', 'EN_PROCESO', 'EN_VERIFICACION']) estado!: string;
  @ApiPropertyOptional({ maxLength: TEXTO })
  @IsOptional() @IsString() @MaxLength(TEXTO) observaciones?: string;
  @ApiPropertyOptional({ type: [String], maxItems: 12, description: 'Claves de las fotos de evidencia de la corrección (máx. 12)' })
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) evidenciaCorreccion?: string[];
}

export class VerificarAccionDto {
  @ApiProperty({ format: 'uuid', description: 'ID de la acción correctiva' })
  @IsUUID() id!: string;
  @ApiProperty({ enum: ['CERRAR', 'DEVOLVER'], description: 'CERRAR da por buena la corrección; DEVOLVER la regresa a seguimiento' })
  @IsIn(['CERRAR', 'DEVOLVER']) decision!: 'CERRAR' | 'DEVOLVER';
  /** Obligatorio al devolver. */
  @ApiPropertyOptional({ maxLength: 1000, description: 'Obligatorio al devolver' })
  @IsOptional() @IsString() @MaxLength(1000) motivo?: string;
}

export class CompararDto {
  @ApiProperty({ format: 'uuid', description: 'Agencia a comparar' })
  @IsUUID() agenciaId!: string;
  @ApiPropertyOptional({ enum: [...AREAS_5S, AREA_GENERAL], description: 'Área a comparar' })
  @IsOptional() @IsIn([...AREAS_5S, AREA_GENERAL]) area?: string;
  @ApiProperty({ enum: FORMATOS_5S as unknown as string[], description: 'Formato a comparar' })
  @IsIn(FORMATOS_5S) formato!: string;
}
