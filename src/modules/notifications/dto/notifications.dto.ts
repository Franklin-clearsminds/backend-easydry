import { IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { TipoNotificacion } from '@prisma/client';

export class ListarNotificacionesDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Filtra solo leídas (true) o no leídas (false). Sin filtro: todas.' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  leida?: boolean;

  @ApiPropertyOptional({ enum: TipoNotificacion, isArray: true, description: 'Filtra por uno o más tipos de notificación.' })
  @IsOptional()
  @IsArray()
  @IsEnum(TipoNotificacion, { each: true })
  tipos?: TipoNotificacion[];
}

export class MarcarLeidaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  notificacionId: string;
}
