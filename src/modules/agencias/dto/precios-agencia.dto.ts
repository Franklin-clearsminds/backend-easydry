import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsString, Min, ValidateNested } from 'class-validator';

export class ListPreciosAgenciaDto {
  @ApiProperty({ example: 'uuid-agencia', description: 'Agencia cuyos precios de servicios generales se consultan' })
  @IsString()
  agenciaId: string;
}

export class PrecioServicioItemDto {
  @ApiProperty({ example: 1, description: 'ID del servicio del catálogo (general o especial, habilitado en la agencia)' })
  @Type(() => Number)
  @IsInt()
  catalogoServicioId: number;

  @ApiProperty({ example: 8.5, description: 'Precio a fijar para esta agencia' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precio: number;
}

export class SetPreciosAgenciaDto {
  @ApiProperty({ example: 'uuid-agencia' })
  @IsString()
  agenciaId: string;

  @ApiProperty({ type: [PrecioServicioItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PrecioServicioItemDto)
  precios: PrecioServicioItemDto[];
}
