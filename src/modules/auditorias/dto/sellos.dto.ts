import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TIPOS_FIRMA } from '../informes.reglas.js';

export class CrearSelloDto {
  @ApiProperty({ maxLength: 80, description: 'Nombre del jefe de taller' })
  @IsString() @IsNotEmpty() @MaxLength(80) nombre!: string;
  @ApiProperty({ maxLength: 80, description: 'Apellido del jefe de taller' })
  @IsString() @IsNotEmpty() @MaxLength(80) apellido!: string;
  /** Logo como imagen en data URL (png, jpeg o webp). */
  @ApiPropertyOptional({ description: 'Logo como imagen en data URL (png, jpeg o webp)' })
  @IsOptional() @IsString() logo?: string;
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'Contraseña con la que el jefe de taller valida el sello' })
  @IsString() @MinLength(1) @MaxLength(100) password!: string;
  /** Agencias cuyos informes firma este sello. Una agencia tiene un solo sello: si ya tenía otro, pasa a este. */
  @ApiPropertyOptional({ type: [String], maxItems: 500, description: 'IDs de las agencias cuyos informes firma este sello. Una agencia tiene un solo sello: si ya tenía otro, pasa a este' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) agenciaIds?: string[];
}

export class EditarSelloDto {
  @ApiProperty({ format: 'uuid', description: 'ID del sello' })
  @IsUUID() id!: string;
  @ApiPropertyOptional({ maxLength: 80, description: 'Nombre del jefe de taller' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) nombre?: string;
  @ApiPropertyOptional({ maxLength: 80, description: 'Apellido del jefe de taller' })
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) apellido?: string;
  /** Imagen nueva; una cadena vacía quita el logo. */
  @ApiPropertyOptional({ description: 'Imagen nueva en data URL; una cadena vacía quita el logo' })
  @IsOptional() @IsString() logo?: string;
  /** Contraseña nueva; sin ella se conserva la actual. */
  @ApiPropertyOptional({ minLength: 1, maxLength: 100, description: 'Contraseña nueva; sin ella se conserva la actual' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) password?: string;
  @ApiPropertyOptional({ enum: [0, 1], description: '1 = activo, 0 = inactivo' })
  @IsOptional() @IsInt() @IsIn([0, 1]) estado?: number;
  /** Lista completa de agencias del sello: las que no estén quedan sin sello. Sin este campo no se tocan. */
  @ApiPropertyOptional({ type: [String], maxItems: 500, description: 'Lista completa de agencias del sello: las que no estén quedan sin sello. Sin este campo no se tocan' })
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) agenciaIds?: string[];
}

export class SelloIdDto {
  @ApiProperty({ format: 'uuid', description: 'ID del sello' })
  @IsUUID() id!: string;
}

/** Valida con su contraseña el sello de la agencia del informe. */
export class ValidarSelloDto {
  @ApiProperty({ format: 'uuid', description: 'ID del informe de inspección' })
  @IsUUID() informeId!: string;
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'Contraseña del sello del jefe de taller de la agencia' })
  @IsString() @MinLength(1) @MaxLength(100) password!: string;
}

/** Aprueba un informe guardado: quien aprueba (Admin o Super Admin) firma la recepción. */
export class AprobarInformeDto {
  @ApiProperty({ format: 'uuid', description: 'ID del informe a aprobar' })
  @IsUUID() informeId!: string;
  /** Trazo como imagen PNG en data URL. */
  @ApiProperty({ description: 'Trazo de la firma como imagen PNG en data URL' })
  @IsString() imagen!: string;
}

/** Firma capturada en pantalla de una de las cuatro firmas del informe. */
export class FirmarInformeDto {
  @ApiProperty({ format: 'uuid', description: 'ID del informe a firmar' })
  @IsUUID() informeId!: string;
  @ApiProperty({ enum: TIPOS_FIRMA as unknown as string[], description: 'Cuál de las firmas del informe se captura' })
  @IsIn(TIPOS_FIRMA as string[]) tipo!: string;
  /** Quién firma; la del jefe de taller toma el nombre de su sello. */
  @ApiPropertyOptional({ maxLength: 120, description: 'Quién firma; la del jefe de taller toma el nombre de su sello' })
  @IsOptional() @IsString() @MaxLength(120) nombre?: string;
  /** Trazo como imagen PNG en data URL. */
  @ApiProperty({ description: 'Trazo de la firma como imagen PNG en data URL' })
  @IsString() imagen!: string;
}
