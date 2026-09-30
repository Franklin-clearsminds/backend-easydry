import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginacionOpcionalDto } from '../../../common/dto/data-grid.dto.js';

/** Estados de salud de un insumo en una ubicación (los calcula el servidor). */
const ESTADOS_INSUMO = ['Óptimo', 'Bajo', 'Crítico', 'Agotado', 'Sin Stock', 'No necesario'];

/**
 * Sin page/pageSize: la respuesta de siempre (agencias/pulidores con todos sus insumos, hasta 100 fichas).
 * Con page o pageSize:
 *  - sin `agenciaId`/`pulidorId`: página de FICHAS (sin insumos) con `metricas` de toda la red; orden: nombre, codigo, region,
 *    criticos, insumos, alerta;
 *  - con `agenciaId`/`pulidorId`: la ficha y una página de SUS insumos; orden: sku, nombre, tipo, contenido, stock, minimo,
 *    deficit, estado.
 */
export class StockResumenAgenciasDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Una agencia: devuelve su ficha y sus insumos paginados' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Nombre de la región' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: 'Excluye esta agencia de las fichas (el líder ve "otras agencias"); si no queda ninguna, no se excluye' })
  @IsOptional()
  @IsString()
  excluirAgenciaId?: string;

  @ApiPropertyOptional({ enum: ['alerta', 'optimo'], description: 'Solo sedes en alerta u óptimas (fichas)' })
  @IsOptional()
  @IsIn(['alerta', 'optimo'])
  estadoUbicacion?: 'alerta' | 'optimo';

  @ApiPropertyOptional({ enum: ESTADOS_INSUMO, description: 'Estado de salud del insumo (con agenciaId)' })
  @IsOptional()
  @IsString()
  estado?: string;
}

export class StockResumenPulidoresDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Un pulidor: devuelve su ficha y los insumos de su kit paginados' })
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiPropertyOptional({ description: 'Id de la región' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ enum: ['PULIDOR_FIJO', 'PULIDOR_MOVIL'] })
  @IsOptional()
  @IsIn(['PULIDOR_FIJO', 'PULIDOR_MOVIL'])
  tipoPulidor?: 'PULIDOR_FIJO' | 'PULIDOR_MOVIL';

  @ApiPropertyOptional({ enum: ['alerta', 'optimo'], description: 'Solo kits en alerta u óptimos (fichas)' })
  @IsOptional()
  @IsIn(['alerta', 'optimo'])
  estadoUbicacion?: 'alerta' | 'optimo';

  @ApiPropertyOptional({ enum: ESTADOS_INSUMO, description: 'Estado de salud del insumo (con pulidorId)' })
  @IsOptional()
  @IsString()
  estado?: string;
}

/** Insumos de una bodega con su estado. Orden: sku, nombre, tipo, contenido, stock, minimo, optimo, estado. */
export class StockResumenBodegasDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Bodega a consultar (un asistente siempre ve la suya)' })
  @IsOptional()
  @IsString()
  bodegaId?: string;

  @ApiPropertyOptional({ enum: ESTADOS_INSUMO, description: 'Estado de salud del insumo' })
  @IsOptional()
  @IsString()
  estado?: string;
}

/**
 * Insumos requeridos por los servicios de una agencia o de un pulidor (`agencia/insumos-servicios`,
 * `pulidor/insumos-servicios`). Sin page/pageSize: la respuesta de siempre (hasta 100 insumos). Con page/pageSize: una
 * página con búsqueda, filtro de estado y orden en el servidor; `resumen` cuenta TODOS los insumos.
 * Orden: sku, nombre, tipo, stock, minimo, estado, capacidad, servicios.
 */
export class InsumosServiciosDto extends PaginacionOpcionalDto {
  @ApiPropertyOptional({ description: 'Agencia (id, nombre o código); por defecto la del usuario' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Igual que agenciaId' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Pulidor; por defecto el usuario' })
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiPropertyOptional({ description: 'Servicios a considerar; por defecto los asignados', type: [Number] })
  @IsOptional()
  @IsArray()
  servicioIds?: number[];

  @ApiPropertyOptional({ enum: ['OPTIMO', 'BAJO', 'CRITICO', 'AGOTADO', 'NO_NECESARIO'], description: 'Estado del insumo' })
  @IsOptional()
  @IsString()
  estado?: string;
}
