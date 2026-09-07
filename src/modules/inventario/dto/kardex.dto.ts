import { IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class ListKardexDto extends DataGridQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por insumo específico' })
  @IsOptional()
  @IsString()
  insumoId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ubicación (ID de agencia o BODEGA_CENTRAL)' })
  @IsOptional()
  @IsString()
  ubicacionId?: string;

  @ApiPropertyOptional({ description: 'Tipo de movimiento (CONSUMO_SERVICIO, COMPRA_INGRESO, DESPACHO_SALIDA, DESPACHO_ENTRADA, AJUSTE_MERMA)' })
  @IsOptional()
  @IsString()
  tipoMovimiento?: string;

  @ApiPropertyOptional({ description: 'Fecha inicio (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha fin (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;
}
