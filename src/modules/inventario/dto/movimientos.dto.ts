import {
  IsString,
  IsOptional,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
  ArrayNotEmpty,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum TipoMovimientoInvEnum {
  COMPRA_PROVEEDOR = 'COMPRA_PROVEEDOR',
  DESPACHO_AGENCIA = 'DESPACHO_AGENCIA',
  DESPACHO_PULIDOR = 'DESPACHO_PULIDOR',
  AJUSTE_MERMA = 'AJUSTE_MERMA',
}

// ——— Sub-DTO para líneas de despacho/compra ———
export class DetalleMovimientoDto {
  @ApiProperty({ description: 'ID del insumo' })
  @IsString()
  insumoId: string;

  @ApiProperty({ description: 'Cantidad a despachar/recibir (en unidades del envase)' })
  @IsNumber()
  @IsPositive()
  cantidadEnviada: number;

  @ApiPropertyOptional({ description: 'Costo unitario en USD (para compras a proveedor)' })
  @IsOptional()
  @IsNumber()
  costoUnitarioUSD?: number;
}

// ——— Registrar compra a proveedor ———
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

// ——— Crear despacho hacia agencia o pulidor ———
export class CrearDespachoDto {
  @ApiPropertyOptional({ description: 'Número de guía. Si no se envía, se autogenera.' })
  @IsOptional()
  @IsString()
  numeroGuia?: string;

  @ApiProperty({ enum: ['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR'] })
  @IsEnum(['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR'])
  tipo: 'DESPACHO_AGENCIA' | 'DESPACHO_PULIDOR';

  @ApiPropertyOptional({ description: 'ID de la agencia destino (si tipo=DESPACHO_AGENCIA)' })
  @IsOptional()
  @IsString()
  sucursalDestinoId?: string;

  @ApiPropertyOptional({ description: 'Alias de sucursalDestinoId' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Alias de agenciaId utilizado en el frontend' })
  @IsOptional()
  @IsString()
  agenciaDestinoId?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor destino (si tipo=DESPACHO_PULIDOR)' })
  @IsOptional()
  @IsString()
  pulidorDestinoId?: string;

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

// ——— Confirmar/rechazar recepción ———
export class ConfirmarRecepcionDto {
  @ApiProperty({ description: 'ID del movimiento de inventario' })
  @IsString()
  movimientoId: string;

  @ApiProperty({ enum: ['RECIBIDO', 'RECHAZADO'] })
  @IsEnum(['RECIBIDO', 'RECHAZADO'])
  accion: 'RECIBIDO' | 'RECHAZADO';

  @ApiPropertyOptional({ description: 'ID de la agencia que recibe (opcional)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Alias de agenciaId' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Observaciones (obligatorio si se rechaza)' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({
    type: [Object],
    description: 'Cantidades realmente recibidas por detalle (id y cantidadRecibida)',
  })
  @IsOptional()
  @IsArray()
  cantidadesRecibidas?: { detalleId: string; cantidadRecibida: number }[];
}

export class RechazarDespachoDto {
  @ApiProperty({ description: 'ID del movimiento de despacho a rechazar' })
  @IsString()
  movimientoId: string;

  @ApiPropertyOptional({ description: 'Motivo técnico del rechazo' })
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional({ description: 'Alias de motivo' })
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ description: 'ID de la agencia que rechaza el despacho' })
  @IsOptional()
  @IsString()
  agenciaId?: string;
}

// ——— Listar movimientos ———
export class ListMovimientosDto {
  @ApiPropertyOptional({ enum: TipoMovimientoInvEnum })
  @IsOptional()
  @IsEnum(TipoMovimientoInvEnum)
  tipo?: TipoMovimientoInvEnum;

  @ApiPropertyOptional({ description: 'Filtrar por estado: PENDIENTE, EN_TRANSITO, RECIBIDO, RECHAZADO, CANCELADO' })
  @IsOptional()
  @IsString()
  estadoDespacho?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID de agencia involucrada' })
  @IsOptional()
  @IsString()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID de pulidor involucrado' })
  @IsOptional()
  @IsString()
  pulidorId?: string;

  @ApiPropertyOptional({ description: 'Fecha inicio (ISO 8601)' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'Fecha fin (ISO 8601)' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Número de guía para búsqueda directa' })
  @IsOptional()
  @IsString()
  numeroGuia?: string;
}
