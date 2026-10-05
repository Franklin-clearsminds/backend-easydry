import { IsInt, IsString, IsNumber, IsOptional, IsBoolean, IsPositive, IsArray, ValidateNested, ArrayNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ─── Asignar / actualizar una línea de receta ───────────────────────────────
export class AsignarRecetaItemDto {
  @ApiProperty({ description: 'ID del insumo a consumir' })
  @IsString()
  insumoId: string;

  @ApiProperty({
    example: 250,
    description: 'Cantidad a consumir en la unidad indicada (ej: 250 si la unidad es ML)',
  })
  @IsNumber()
  @IsPositive()
  cantidadUsada: number;

  @ApiPropertyOptional({ description: 'ID de la UnidadMedida en que se expresa la cantidad (ej: ID de ML, L, KG, U)' })
  @IsOptional()
  @IsString()
  unidadConsumoId?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Si true, no bloquea la finalización aunque no haya stock suficiente',
  })
  @IsOptional()
  @IsBoolean()
  esOpcional?: boolean;

  @ApiPropertyOptional({ example: '250ml para acabado de llantas' })
  @IsOptional()
  @IsString()
  observacion?: string;
}

// ─── Request: asignar/reemplazar receta completa de un servicio ──────────────
export class AsignarRecetaDto {
  @ApiProperty({ description: 'ID (número) del servicio del catálogo' })
  @IsInt()
  catalogoServicioId: number;

  @ApiProperty({ type: [AsignarRecetaItemDto], description: 'Lista completa de insumos de la receta' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AsignarRecetaItemDto)
  items: AsignarRecetaItemDto[];
}

// ─── Request: ver receta de un servicio ────────────────────────────────────
export class ListRecetaDto {
  @ApiProperty({ description: 'ID del servicio del catálogo' })
  @IsInt()
  catalogoServicioId: number;
}

// ─── Request: eliminar un insumo de la receta ──────────────────────────────
export class EliminarRecetaItemDto {
  @ApiProperty({ description: 'ID del servicio del catálogo' })
  @IsInt()
  catalogoServicioId: number;

  @ApiProperty({ description: 'ID del insumo a quitar de la receta' })
  @IsString()
  insumoId: string;
}

// ─── Simular consumo antes de finalizar ────────────────────────────────────
export class SimularConsumoDto {
  @ApiProperty({ description: 'ID del servicio a simular' })
  @IsString()
  servicioId: string;
}
