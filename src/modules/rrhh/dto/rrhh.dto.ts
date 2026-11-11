import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ArrayMinSize,
  ValidateNested,
} from 'class-validator';
import { MAX_ADJUNTOS } from '../rrhh.reglas.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

// ───────────────────────── Ubicaciones ─────────────────────────

export class GuardarUbicacionDto {
  @IsIn(['AGENCIA', 'BODEGA'])
  sitioTipo!: 'AGENCIA' | 'BODEGA';

  @IsUUID()
  sitioId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud!: number;

  /** Ya no se configura: el radio es fijo por canal (100 m, tanto en la app como en la web). Se acepta por compatibilidad y se ignora. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  radioM?: number;
}

export class EstadoTimbradaDto {
  @IsOptional()
  @IsIn(['WEB', 'APP'])
  origen?: 'WEB' | 'APP';
}

export class QuitarUbicacionDto {
  @IsIn(['AGENCIA', 'BODEGA'])
  sitioTipo!: 'AGENCIA' | 'BODEGA';

  @IsUUID()
  sitioId!: string;
}

// ───────────────────────── Timbradas ─────────────────────────

export class RegistrarTimbradaDto {
  /** URL o clave de la foto de cámara, ya subida con `storage/upload` (tipo FOTO_TIMBRADA). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  fotoUrl!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitud?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitud?: number;

  /** Precisión del GPS en metros, como la reportó el dispositivo. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precisionM?: number;

  /** Hora que decía el dispositivo: solo se guarda para auditar. */
  @IsOptional()
  @IsDateString()
  horaDispositivo?: string;

  @IsIn(['WEB', 'APP'])
  origen!: 'WEB' | 'APP';
}

export class ConsultarTimbradasDto {
  @IsOptional()
  @Matches(DIA, { message: 'desde debe ser AAAA-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(DIA, { message: 'hasta debe ser AAAA-MM-DD' })
  hasta?: string;

  /** Solo en «equipo»: filtrar por una persona. */
  @IsOptional()
  @IsUUID()
  userId?: string;
}

// ───────────────────────── Horarios ─────────────────────────

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DiaHorarioDto {
  @IsBoolean()
  trabaja!: boolean;

  @Matches(HORA, { message: 'entrada debe ser HH:mm' })
  entrada!: string;

  @Matches(HORA, { message: 'salida debe ser HH:mm' })
  salida!: string;
}

/** Quién: la persona de la que se pide el horario o su historial. */
export class HorarioPersonaDto {
  @IsUUID()
  userId!: string;
}

export class EditarHorarioDto {
  @IsUUID()
  userId!: string;

  /** Siete elementos, de lunes a domingo. */
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DiaHorarioDto)
  dias!: DiaHorarioDto[];

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  motivo!: string;
}

export class EditarAjusteDto {
  @Type(() => Number)
  @IsInt()
  toleranciaMin!: number;

  @Type(() => Number)
  @IsInt()
  ventanaMin!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  motivo!: string;
}

// ───────────────────────── Tareas ─────────────────────────

export class AdjuntoTareaDto {
  /** URL o clave del archivo, ya subido con `storage/upload` (FOTO_TAREA, VIDEO_TAREA o DOCUMENTO_TAREA). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  url!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre!: string;
}

export class CrearTareaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  titulo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @IsOptional()
  @IsDateString()
  fechaLimite?: string;

  /** Siempre obligatorio: toda tarea se asigna a alguien. */
  @IsUUID()
  asignadoAId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ADJUNTOS)
  @ValidateNested({ each: true })
  @Type(() => AdjuntoTareaDto)
  adjuntos?: AdjuntoTareaDto[];
}

export class TareaIdDto {
  @IsUUID()
  id!: string;
}

export class CompletarTareaDto extends TareaIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  respuesta!: string;

  @IsArray()
  @ArrayMaxSize(MAX_ADJUNTOS)
  @ValidateNested({ each: true })
  @Type(() => AdjuntoTareaDto)
  adjuntos!: AdjuntoTareaDto[];
}

export class RevisarTareaDto extends TareaIdDto {
  @IsIn(['APROBAR', 'DEVOLVER'])
  accion!: 'APROBAR' | 'DEVOLVER';

  /** Obligatorio al devolver. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class CancelarTareaDto extends TareaIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class ReasignarTareaDto extends TareaIdDto {
  @IsUUID()
  asignadoAId!: string;
}

export class ListarTareasDto {
  @IsOptional()
  @IsIn(['PENDIENTE', 'COMPLETADA', 'REVISADA', 'CANCELADA'])
  estado?: 'PENDIENTE' | 'COMPLETADA' | 'REVISADA' | 'CANCELADA';

  /** Solo las Pendientes con la fecha límite pasada. */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  soloVencidas?: boolean;

  @IsOptional()
  @IsUUID()
  asignadoAId?: string;
}
