import { IsString, IsOptional, IsNumber, IsEnum, IsIn, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';

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

  @ApiPropertyOptional({ description: 'ID de la agencia que emite la alerta (mismo efecto que sucursalId)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Mensaje descriptivo con el problema' })
  @IsOptional()
  @IsString()
  mensaje?: string;

  @ApiPropertyOptional({ description: 'Stock actual reportado al momento de la alerta' })
  @IsOptional()
  @IsNumber()
  stockReportado?: number;
}

/**
 * Sin page/pageSize: arreglo con hasta 100 alertas (y sincroniza las necesidades sin stock, con límite de frecuencia).
 * Con page o pageSize: página con orden, búsqueda y filtros en el servidor; NO escribe en la base (la sincronización es
 * `alertas/sincronizar`). Orden permitido: fecha, nivel, estado, insumo, agencia. Con `incluirResumen`: activas, resueltas, total.
 */
export class ListAlertasDto extends PaginacionOpcionalDto {
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

  @ApiPropertyOptional({ description: 'Filtrar por agencia (mismo efecto que sucursalId)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ enum: ['CRITICO', 'BAJO'], description: 'Grupo de nivel: CRITICO incluye crítico y agotado; BAJO, bajo mínimo' })
  @IsOptional()
  @IsIn(['CRITICO', 'BAJO'])
  grupoNivel?: 'CRITICO' | 'BAJO';

  @ApiPropertyOptional({ description: 'Solo alertas sin resolver (pendientes, en proceso o despachadas)' })
  @IsOptional()
  @IsBoolean()
  soloActivas?: boolean;
}

export class SincronizarAlertasDto {
  @ApiPropertyOptional({ description: 'Ignora el límite de frecuencia (botón "Actualizar")' })
  @IsOptional()
  @IsBoolean()
  forzar?: boolean;
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
