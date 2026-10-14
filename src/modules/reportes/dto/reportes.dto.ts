import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export const MODOS_PERIODO = ['HOY', 'SEMANA', 'MES', 'ANIO', 'DIA', 'SEMANA_DE', 'MES_DE', 'ANIO_DE', 'RANGO'] as const;

export class PeriodoReporteDto {
  @ApiProperty({ enum: MODOS_PERIODO })
  @IsIn(MODOS_PERIODO as unknown as string[])
  modo!: (typeof MODOS_PERIODO)[number];

  @ApiPropertyOptional({ description: 'YYYY-MM-DD: el día (DIA) o cualquier día de la semana (SEMANA_DE)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM (MES_DE)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  mes?: string;

  @ApiPropertyOptional({ description: 'Año (ANIO_DE)' })
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2100)
  anio?: number;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (RANGO)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  desde?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD (RANGO)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  hasta?: string;
}

/** Filtros de un reporte. El servidor siempre los cruza con el alcance del usuario. */
export class GenerarReporteDto {
  @ApiProperty({ example: 'servicios-especiales' })
  @IsString()
  @MaxLength(60)
  reporteId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clienteId?: string;

  @ApiPropertyOptional({ type: [String], description: 'Agencias elegidas; vacío = todas las de su alcance' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  agenciaIds?: string[];

  @ApiPropertyOptional({ type: PeriodoReporteDto, description: 'Solo para reportes por periodo' })
  @IsOptional()
  @ValidateNested()
  @Type(() => PeriodoReporteDto)
  periodo?: PeriodoReporteDto;

  @ApiPropertyOptional({ description: 'Estado del registro (según el reporte)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  estado?: string;

  @ApiPropertyOptional({ description: 'Lavador (servicios generales)' })
  @IsOptional()
  @IsString()
  lavadorId?: string;

  @ApiPropertyOptional({ description: 'Insumo (kardex)' })
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional({ enum: ['AGENCIA', 'PULIDOR', 'BODEGA'], description: 'Tipo de ubicación (stock)' })
  @IsOptional()
  @IsIn(['AGENCIA', 'PULIDOR', 'BODEGA'])
  ubicacion?: 'AGENCIA' | 'PULIDOR' | 'BODEGA';

  @ApiPropertyOptional({ enum: ['VERDE', 'AMARILLO', 'ROJO'], description: 'Semáforo (auditorías 5S)' })
  @IsOptional()
  @IsIn(['VERDE', 'AMARILLO', 'ROJO'])
  semaforo?: 'VERDE' | 'AMARILLO' | 'ROJO';
}

export class RegistrarExportacionDto extends GenerarReporteDto {
  @ApiProperty({ enum: ['EXCEL', 'PDF'] })
  @IsIn(['EXCEL', 'PDF'])
  formato!: 'EXCEL' | 'PDF';

  @ApiPropertyOptional({ description: 'Filas exportadas, para la bitácora' })
  @IsOptional()
  @IsInt()
  @Min(0)
  totalFilas?: number;
}
