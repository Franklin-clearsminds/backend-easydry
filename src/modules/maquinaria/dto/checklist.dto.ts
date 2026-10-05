import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PasoPlantillaChecklistDto {
  @ApiProperty({ description: 'Texto del paso' })
  @IsString()
  @IsNotEmpty()
  texto: string;

  @ApiPropertyOptional({ description: 'Si es obligatorio para poder cerrar la orden (por defecto sí)', default: true })
  @IsOptional()
  @IsBoolean()
  obligatorio?: boolean;
}

export class GuardarPlantillaChecklistDto {
  @ApiProperty({ enum: ['PREVENTIVO', 'CORRECTIVO'] })
  @IsIn(['PREVENTIVO', 'CORRECTIVO'])
  tipo: string;

  @ApiPropertyOptional({ description: 'Nombre visible de la plantilla' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiProperty({ type: [PasoPlantillaChecklistDto], description: 'Pasos en orden (1 a 30)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PasoPlantillaChecklistDto)
  pasos: PasoPlantillaChecklistDto[];
}

export class ChecklistMantenimientoDto {
  @ApiProperty({ description: 'ID del mantenimiento' })
  @IsString()
  @IsNotEmpty()
  mantenimientoId: string;
}

export class MarcarPasoChecklistDto extends ChecklistMantenimientoDto {
  @ApiProperty({ description: 'ID del paso de la orden (ChecklistRespuesta)' })
  @IsString()
  @IsNotEmpty()
  pasoId: string;

  @ApiProperty({ description: 'true = hecho, false = pendiente' })
  @IsBoolean()
  completado: boolean;

  @ApiPropertyOptional({ description: 'Observación del técnico sobre este paso' })
  @IsOptional()
  @IsString()
  observacion?: string;
}
