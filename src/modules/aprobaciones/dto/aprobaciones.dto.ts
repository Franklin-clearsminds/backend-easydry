import { IsString, IsNotEmpty, IsOptional, IsNumber, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DataGridQueryDto } from '../../../common/dto/data-grid.dto.js';

export class SolicitarAprobacionDto {
  @ApiProperty({ example: 'DESPACHO_QUIMICOS', description: 'Tipo de solicitud (DESPACHO_QUIMICOS, AJUSTE_MERMA, SERVICIO_ESPECIAL_PRECIO, COMPRA_REPUESTO)' })
  @IsString()
  @IsNotEmpty()
  tipo: string;

  @ApiProperty({ example: 'Despacho extraordinario de 5 galones de Sellador Cerámico' })
  @IsString()
  @IsNotEmpty()
  titulo: string;

  @ApiPropertyOptional({ example: 'Aumento imprevisto de lavados especiales por convenio empresarial' })
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional({ example: 450.00 })
  @IsOptional()
  @IsNumber()
  montoUSD?: number;

  @ApiPropertyOptional({ description: 'ID de la agencia vinculada' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'ID de referencia del objeto (movimiento, servicio, etc.)' })
  @IsOptional()
  @IsString()
  entidadRefId?: string;
}

export class DecidirAprobacionDto {
  @ApiProperty({ description: 'ID de la solicitud de aprobación' })
  @IsString()
  @IsNotEmpty()
  solicitudId: string;

  @ApiPropertyOptional({ example: 'Aprobado según presupuesto extraordinario de la sede' })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({ example: 'Monto excede el límite permitido para la agencia en este mes' })
  @IsOptional()
  @IsString()
  motivoRechazo?: string;
}

export class ListAprobacionesDto extends DataGridQueryDto {
  @ApiPropertyOptional({ example: 'PENDIENTE', enum: ['PENDIENTE', 'APROBADO', 'RECHAZADO'] })
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional({ description: 'Filtro por tipo' })
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional({ description: 'Filtro por agencia' })
  @IsOptional()
  @IsString()
  agenciaId?: string;
}
