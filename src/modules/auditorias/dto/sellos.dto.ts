import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { TIPOS_FIRMA } from '../informes.reglas.js';

export class CrearSelloDto {
  @IsString() @IsNotEmpty() @MaxLength(80) nombre!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) apellido!: string;
  /** Logo como imagen en data URL (png, jpeg o webp). */
  @IsOptional() @IsString() logo?: string;
  @IsString() @MinLength(1) @MaxLength(100) password!: string;
}

export class EditarSelloDto {
  @IsUUID() id!: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) nombre?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) apellido?: string;
  /** Imagen nueva; una cadena vacía quita el logo. */
  @IsOptional() @IsString() logo?: string;
  /** Contraseña nueva; sin ella se conserva la actual. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) password?: string;
  @IsOptional() @IsInt() @IsIn([0, 1]) estado?: number;
}

export class SelloIdDto {
  @IsUUID() id!: string;
}

/** Valida el sello del jefe de taller de un informe con su contraseña. */
export class ValidarSelloDto {
  @IsUUID() informeId!: string;
  @IsUUID() selloId!: string;
  @IsString() @MinLength(1) @MaxLength(100) password!: string;
}

/** Firma capturada en pantalla de una de las cuatro firmas del informe. */
/** Aprueba un informe guardado: quien aprueba (Admin o Super Admin) firma la recepción. */
export class AprobarInformeDto {
  @IsUUID() informeId!: string;
  /** Trazo como imagen PNG en data URL. */
  @IsString() imagen!: string;
}

export class FirmarInformeDto {
  @IsUUID() informeId!: string;
  @IsIn(TIPOS_FIRMA as string[]) tipo!: string;
  /** Quién firma; la del jefe de taller toma el nombre de su sello. */
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  /** Trazo como imagen PNG en data URL. */
  @IsString() imagen!: string;
}
