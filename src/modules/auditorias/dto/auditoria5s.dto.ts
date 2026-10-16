import { Type } from 'class-transformer';
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
  @IsOptional() @IsUUID() agenciaId?: string;
  @IsOptional() @IsUUID() auditorId?: string;
  @IsOptional() @IsIn(AREAS_5S) area?: string;
  @IsOptional() @IsIn(FORMATOS_5S) formato?: string;
  @IsOptional() @IsIn(ESTADOS_AUDITORIA_5S) estado?: string;
  @IsOptional() @IsIn(['VERDE', 'AMARILLO', 'ROJO']) semaforo?: string;
  @IsOptional() @IsDateString() desde?: string;
  @IsOptional() @IsDateString() hasta?: string;
}

export class ResumenAuditorias5sDto {
  /** Sin formato: todos juntos. */
  @IsOptional() @IsIn(FORMATOS_5S) formato?: string;
}

export class IdAuditoria5sDto {
  @IsUUID() id!: string;
}

export class RespuestaDto {
  /** Número de la pregunta en el catálogo del formato (1 a 50). */
  @IsInt() @Min(1) @Max(50) criterio!: number;
  /** Puntaje de 0 a 5 (según el formato); en SI/NO, 1 = SI y 0 = NO. null o ausente = sin evaluar. */
  @IsOptional() @IsInt() @Min(0) @Max(5) puntaje?: number | null;
  @IsOptional() @IsString() @MaxLength(TEXTO) hallazgo?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO) observaciones?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO) accionCorrectiva?: string;
  @IsOptional() @IsString() @MaxLength(120) responsable?: string;
  @IsOptional() @IsDateString() fechaCompromiso?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) fotos?: string[];
}

export class GuardarAuditoria5sDto {
  /** Solo en `update`. */
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() agenciaId!: string;
  /** Ya no se pide en los formularios: sin área, la auditoría queda como «General». */
  @IsOptional() @IsIn([...AREAS_5S, AREA_GENERAL]) area?: string;
  /** Solo en `create`: los formatos a realizar en esta visita. Cada uno se guarda como una auditoría aparte con los mismos datos. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @IsIn(FORMATOS_5S, { each: true }) formatos?: string[];
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsString() @MaxLength(160) responsableAgencia?: string;
  @IsOptional() @IsString() @MaxLength(160) equipoPersona?: string;
  @IsOptional() @IsString() @MaxLength(TEXTO) comentarios?: string;
  /** Comentarios / acciones por cada S: { SEIRI: '…' }. */
  @IsOptional() @IsObject() comentariosCategoria?: Record<string, string>;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RespuestaDto) respuestas?: RespuestaDto[];
}

export class ListAccionesDto extends PaginacionOpcionalDto {
  @IsOptional() @IsUUID() agenciaId?: string;
  @IsOptional() @IsUUID() auditoriaId?: string;
  /** PENDIENTE | EN_PROCESO | EN_VERIFICACION | CERRADA | VENCIDA | ABIERTAS */
  @IsOptional() @IsIn([...ESTADOS_ACCION, 'VENCIDA', 'ABIERTAS']) estado?: string;
}

export class SeguimientoAccionDto {
  @IsUUID() id!: string;
  /** Quien da seguimiento no cierra: como máximo la manda a verificación. */
  @IsIn(['PENDIENTE', 'EN_PROCESO', 'EN_VERIFICACION']) estado!: string;
  @IsOptional() @IsString() @MaxLength(TEXTO) observaciones?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @MaxLength(600, { each: true }) evidenciaCorreccion?: string[];
}

export class VerificarAccionDto {
  @IsUUID() id!: string;
  @IsIn(['CERRAR', 'DEVOLVER']) decision!: 'CERRAR' | 'DEVOLVER';
  /** Obligatorio al devolver. */
  @IsOptional() @IsString() @MaxLength(1000) motivo?: string;
}

export class CompararDto {
  @IsUUID() agenciaId!: string;
  @IsOptional() @IsIn([...AREAS_5S, AREA_GENERAL]) area?: string;
  @IsIn(FORMATOS_5S) formato!: string;
}
