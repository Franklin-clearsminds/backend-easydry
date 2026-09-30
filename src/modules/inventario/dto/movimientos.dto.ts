import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
  IsPositive,
  IsInt,
  IsIn,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum TipoMovimientoInvEnum {
  COMPRA_PROVEEDOR = 'COMPRA_PROVEEDOR',
  DESPACHO_AGENCIA = 'DESPACHO_AGENCIA',
  DESPACHO_PULIDOR = 'DESPACHO_PULIDOR',
  DESPACHO_BODEGA = 'DESPACHO_BODEGA',
  AJUSTE_MERMA = 'AJUSTE_MERMA',
}

export class DetalleMovimientoDto {
  @ApiProperty({ description: 'ID del insumo' })
  @IsString()
  insumoId: string;

  @ApiProperty({
    description:
      'Cantidad en UNIDADES completas del envase (enteros). El backend convierte a unidad base (volumen) usando contenidoNeto al reservar/mover stock. Aplica a DESPACHO_AGENCIA, DESPACHO_PULIDOR y DESPACHO_BODEGA.',
  })
  @IsNumber()
  @IsPositive()
  cantidadEnviada: number;

  @ApiPropertyOptional({ description: 'Costo unitario en USD (para compras a proveedor)' })
  @IsOptional()
  @IsNumber()
  costoUnitarioUSD?: number;
}

export class RegistrarCompraDto {
  @ApiPropertyOptional({ description: 'Número de guía/factura. Si no se envía, se autogenera.' })
  @IsOptional()
  @IsString()
  numeroGuia?: string;

  @ApiPropertyOptional({ example: 'Bodega Central Pifo' })
  @IsOptional()
  @IsString()
  origenUbicacion?: string;

  @ApiProperty({ description: 'Nombre del proveedor / origen de la compra' })
  @IsString()
  proveedorNombre: string;

  @ApiPropertyOptional({ description: 'Observaciones generales del ingreso' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({ type: [DetalleMovimientoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DetalleMovimientoDto)
  detalles: DetalleMovimientoDto[];
}

export class CrearDespachoDto {
  @ApiPropertyOptional({ description: 'Número de guía. Si no se envía, se autogenera.' })
  @IsOptional()
  @IsString()
  numeroGuia?: string;

  @ApiProperty({ enum: ['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'DESPACHO_BODEGA'] })
  @IsEnum(['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'DESPACHO_BODEGA'])
  tipo: 'DESPACHO_AGENCIA' | 'DESPACHO_PULIDOR' | 'DESPACHO_BODEGA';

  @ApiPropertyOptional({ description: 'ID de la agencia destino' })
  @IsOptional()
  @IsString()
  sucursalDestinoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agenciaDestinoId?: string;

  @ApiPropertyOptional({ description: 'ID de bodega destino (DESPACHO_BODEGA)' })
  @IsOptional()
  @IsString()
  destinoBodegaId?: string;

  @ApiPropertyOptional({ description: 'ID bodega origen (opcional; se infiere del usuario)' })
  @IsOptional()
  @IsString()
  origenBodegaId?: string;

  @ApiPropertyOptional({ description: 'ID agencia origen (opcional; se infiere del líder)' })
  @IsOptional()
  @IsString()
  origenAgenciaId?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor destino' })
  @IsOptional()
  @IsString()
  pulidorDestinoId?: string;

  @ApiPropertyOptional({ description: 'Alias de pulidorDestinoId' })
  @IsOptional()
  @IsString()
  destinoPulidorId?: string;

  @ApiPropertyOptional({ example: 'Bodega Central Pifo' })
  @IsOptional()
  @IsString()
  origenUbicacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiProperty({ type: [DetalleMovimientoDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DetalleMovimientoDto)
  detalles: DetalleMovimientoDto[];
}

export class ConfirmarRecepcionDto {
  @ApiProperty({ description: 'ID del movimiento de inventario' })
  @IsString()
  movimientoId: string;

  @ApiProperty({ enum: ['RECIBIDO', 'RECHAZADO'] })
  @IsEnum(['RECIBIDO', 'RECHAZADO'])
  accion: 'RECIBIDO' | 'RECHAZADO';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Motivo (obligatorio si se rechaza)' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'Motivo de rechazo (alias)' })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({
    type: [Object],
    description: 'Cantidades realmente recibidas por detalle',
  })
  @IsOptional()
  @IsArray()
  cantidadesRecibidas?: { detalleId: string; cantidadRecibida: number }[];
}

export class RechazarDespachoDto {
  @ApiProperty()
  @IsString()
  movimientoId: string;

  @ApiProperty({ description: 'Motivo del rechazo (obligatorio, texto libre)' })
  @IsString()
  motivo: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agenciaId?: string;
}

export class ListMovimientosDto {
  @ApiPropertyOptional({ enum: TipoMovimientoInvEnum })
  @IsOptional()
  @IsEnum(TipoMovimientoInvEnum)
  tipo?: TipoMovimientoInvEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estadoDespacho?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  numeroGuia?: string;
}

/**
 * Filtros y paginación de `despachos/list`. Sin `page` ni `pageSize` (clientes antiguos, como la app móvil) responde
 * un arreglo con hasta 100 despachos; con alguno de los dos responde `{ items, total, page, … }`.
 * No fija valores por defecto para poder distinguir ambos casos.
 */
export class ListDespachosDto extends ListMovimientosDto {
  // Estos dos ya los enviaban los clientes, pero al no estar declarados el validador global los descartaba.
  @ApiPropertyOptional({ description: 'Agencia destino (id, nombre o código)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Agencia destino (id, nombre o código)' })
  @IsOptional()
  @IsString()
  agenciaDestinoId?: string;

  @ApiPropertyOptional({ example: 1, description: 'Página (1 = primera)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25, description: 'Filas por página (máximo 100; un valor mayor se recorta)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({ example: 'fecha', description: 'Columna: fecha, guia, estado, origen, destino, recepcion. Por defecto: más reciente primero.' })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ description: 'Búsqueda por palabras: guía, origen, destino, responsables e insumos (mínimo 2 letras)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Incluye los contadores por estado con los mismos filtros (menos el de estado)' })
  @IsOptional()
  @IsBoolean()
  incluirResumen?: boolean;
}
