import { IsString, IsOptional, IsNumber, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum NivelAlertaStockEnum {
  BAJO = 'BAJO',
  CRITICO = 'CRITICO',
  AGOTADO = 'AGOTADO',
}

export class CrearAlertaDto {
  @ApiProperty({ description: 'ID del insumo con problema de stock' })
  @IsString()
  insumoId: string;

  @ApiProperty({ enum: NivelAlertaStockEnum })
  @IsEnum(NivelAlertaStockEnum)
  nivel: NivelAlertaStockEnum;

  @ApiPropertyOptional({ description: 'ID de la agencia que emite la alerta (si aplica)' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Mensaje descriptivo con el problema' })
  @IsOptional()
  @IsString()
  mensaje?: string;

  @ApiPropertyOptional({ description: 'Stock actual reportado al momento de la alerta' })
  @IsOptional()
  @IsNumber()
  stockReportado?: number;
}

export class ListAlertasDto {
  @ApiPropertyOptional({ enum: NivelAlertaStockEnum })
  @IsOptional()
  @IsEnum(NivelAlertaStockEnum)
  nivel?: NivelAlertaStockEnum;

  @ApiPropertyOptional({ description: 'PENDIENTE | EN_PROCESO | DESPACHADO | RESUELTO' })
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional({ description: 'Filtrar por agencia' })
  @IsOptional()
  @IsString()
  sucursalId?: string;
}

export class AtenderAlertaDto {
  @ApiProperty({ description: 'ID de la alerta a atender' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Nuevo estado: EN_PROCESO | DESPACHADO | RESUELTO' })
  @IsString()
  estado: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;
}
