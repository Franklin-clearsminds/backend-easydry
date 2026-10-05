import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

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
  @Transform(({ value }) => (value === undefined || value === null || value === '' ? undefined : value === true || value === 'true'))
  @IsBoolean()
  leida?: boolean;
}

export class MarcarLeidaDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  notificacionId: string;
}
