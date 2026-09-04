import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class SyncPullQueryDto {
  @ApiPropertyOptional({ example: '2026-09-04T00:00:00.000Z', description: 'Timestamp o fecha ISO para descarga incremental' })
  @IsOptional()
  @IsString()
  since?: string;

  @ApiPropertyOptional({ example: 'bahia-uuid-01', description: 'Filtrar por ID de bahía' })
  @IsOptional()
  @IsString()
  bahiaId?: string;
}
