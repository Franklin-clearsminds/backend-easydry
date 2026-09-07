import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class SyncPullQueryDto extends DataGridQueryDto {
  @ApiPropertyOptional({ example: '2026-09-04T00:00:00.000Z', description: 'Timestamp o fecha ISO para descarga incremental' })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ example: 'bahia-uuid-01', description: 'Filtrar por ID de bahía' })
  @IsOptional()
  @IsString()
  bahiaId?: string;

  @ApiPropertyOptional({ example: 'user-uuid-123', description: 'Filtrar por ID de operador asignado (para pulidores móviles y técnicos)' })
  @IsOptional()
  @IsString()
  operadorId?: string;

  @ApiPropertyOptional({ example: 'srv-uuid-ultimo', description: 'Cursor del último registro obtenido para paginación continua' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ example: 50, description: 'Límite de registros por lote (equivalente a pageSize)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}
