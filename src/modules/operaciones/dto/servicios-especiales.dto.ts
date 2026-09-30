import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max, IsIn, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QueryServicioEspecialDto {
  @ApiPropertyOptional({ description: 'ID de agencia' })
  @IsString()
  @IsOptional()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Alias de agenciaId' })
  @IsString()
  @IsOptional()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'ID de región (para filtrado por zona)' })
  @IsString()
  @IsOptional()
  regionId?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor / operador asignado' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'Estado: Pendiente, En Proceso, Completado, Cancelado' })
  @IsString()
  @IsOptional()
  estado?: string;

  @ApiPropertyOptional({ description: 'Tipo: Pulido, Micro Pulido, Cerámico, Lavado de motor' })
  @IsString()
  @IsOptional()
  tipoServicio?: string;

  @ApiPropertyOptional({ description: 'Búsqueda por placa, código o cliente' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Página (1 = primera)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25, description: 'Filas por página (máximo 100; un valor mayor se recorta). Sin valor: hasta 100 (clientes antiguos).' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  pageSize?: number;

  @ApiPropertyOptional({
    example: 'fecha',
    description: 'Columna: fecha, ot, placa, servicio, agencia, region, operador, estado, tiempoPausa, tiempoEfectivo. Por defecto: más reciente primero.',
  })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ example: 'desc', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ example: '2026-09-01T05:00:00.000Z', description: 'Desde (inclusive), por fecha de creación. ISO 8601.' })
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional({ example: '2026-09-30T04:59:59.999Z', description: 'Hasta (inclusive), por fecha de creación. ISO 8601.' })
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional({ description: 'Incluye el conteo por estado con los mismos filtros (menos el de estado)' })
  @IsOptional()
  @IsBoolean()
  incluirResumen?: boolean;
}

export class CreateServicioEspecialDto {
  @ApiPropertyOptional({ description: 'UUID único originado offline en móvil' })
  @IsString()
  @IsOptional()
  clientUuid?: string;

  @ApiPropertyOptional({ description: 'Código único ej: SE-2026-001 o número de OT ingresado' })
  @IsString()
  @IsOptional()
  codigoSE?: string;

  @ApiPropertyOptional({ description: 'Número de Orden de Trabajo (OT) digitalizado por el usuario', example: 'OT-9840' })
  @IsString()
  @IsOptional()
  ordenTrabajoOT?: string;

  @ApiProperty({ description: 'Tipo de servicio especial', example: 'Pulido y Recubrimiento Cerámico' })
  @IsString()
  @IsNotEmpty()
  tipoServicio: string;

  @ApiProperty({
    description: 'Información del vehículo y cliente',
    example: { placa: 'PBA-1234', marca: 'Toyota', modelo: 'Corolla', color: 'Gris', cliente: 'Carlos Perez' },
  })
  @IsNotEmpty()
  vehiculoInfo: Record<string, any>;

  @ApiPropertyOptional({ description: 'Color del vehículo' })
  @IsString()
  @IsOptional()
  color?: string;

  @ApiPropertyOptional({ description: 'ID de la agencia (opcional para servicios móviles zonales)' })
  @IsString()
  @IsOptional()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'ID de la región asignada (Sierra / Costa)' })
  @IsString()
  @IsOptional()
  regionId?: string;

  @ApiPropertyOptional({ description: 'Nombre textual de la región' })
  @IsString()
  @IsOptional()
  regionNombre?: string;

  @ApiPropertyOptional({ description: 'ID del pulidor especialista asignado' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'Prioridad: Baja, Media, Alta, Urgente', default: 'Media' })
  @IsString()
  @IsOptional()
  prioridad?: string;

  @ApiPropertyOptional({ description: 'URL del video de inspección inicial (opcional en creación)' })
  @IsString()
  @IsOptional()
  videoInicialUrl?: string;

  @ApiPropertyOptional({ description: 'Receta de químicos estimados' })
  @IsOptional()
  recetaInsumos?: any;

  @ApiPropertyOptional({ description: 'Evidencias fotográficas' })
  @IsOptional()
  evidencias?: any;

  @ApiPropertyOptional({ description: 'ID de la bahía (opcional para servicios en bahía)' })
  @IsString()
  @IsOptional()
  bahiaId?: string;

  @ApiPropertyOptional({ description: 'Hora de ingreso (HH:mm)' })
  @IsString()
  @IsOptional()
  horaIngreso?: string;

  @ApiPropertyOptional({ description: 'Hora estimada de salida (HH:mm)' })
  @IsString()
  @IsOptional()
  horaEstimada?: string;

  @ApiPropertyOptional({ description: 'Nombre del cliente o concesionario' })
  @IsString()
  @IsOptional()
  cliente?: string;

  @ApiPropertyOptional({ description: 'Placa directa' })
  @IsString()
  @IsOptional()
  placa?: string;

  @ApiPropertyOptional({ description: 'Marca directa' })
  @IsString()
  @IsOptional()
  marca?: string;

  @ApiPropertyOptional({ description: 'Modelo directo' })
  @IsString()
  @IsOptional()
  modelo?: string;

  @ApiPropertyOptional({ description: 'Observaciones o requerimientos específicos del cliente' })
  @IsString()
  @IsOptional()
  observaciones?: string;
}

export class IniciarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'ID del operador que inicia' })
  @IsString()
  @IsOptional()
  operadorId?: string;

  @ApiPropertyOptional({ description: 'URL o evidencia del Video Inicial obligatorio de inspección' })
  @IsString()
  @IsOptional()
  videoInicialUrl?: string;
}

export class CompletarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'URL o evidencia del Video Final obligatorio de entrega' })
  @IsString()
  @IsOptional()
  videoFinalUrl?: string;

  @ApiPropertyOptional({ description: 'Evidencias fotográficas finales (fotos después)' })
  @IsOptional()
  evidencias?: any;

  @ApiPropertyOptional({ description: 'Calificación de calidad (1 a 5 estrellas)' })
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsOptional()
  calificacionCalidad?: number;

  @ApiPropertyOptional({ description: 'Observaciones finales de entrega' })
  @IsString()
  @IsOptional()
  observaciones?: string;
}

export class PausarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Motivo de la pausa del servicio', example: 'Lluvia en bahía exterior' })
  @IsString()
  @IsNotEmpty()
  motivo: string;

  @ApiProperty({ description: 'URL o evidencia en vídeo del estado del vehículo al pausar' })
  @IsString()
  @IsNotEmpty()
  videoPausaUrl: string;
}

export class ReasignarServicioEspecialDto {
  @ApiProperty({ description: 'ID, OT o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'ID del pulidor. Vacío o 0 deja el servicio sin asignar' })
  @IsOptional()
  operadorId?: string | null;

  @ApiPropertyOptional({ description: 'Receta del servicio para validar el kit del pulidor' })
  @IsOptional()
  recetaInsumos?: any;

  @ApiPropertyOptional({ description: 'Nombre del servicio especial' })
  @IsString()
  @IsOptional()
  tipoServicio?: string;
}

export class ReanudarServicioEspecialDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio especial' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'URL o evidencia en vídeo del estado del vehículo al reanudar' })
  @IsString()
  @IsNotEmpty()
  videoReanudarUrl: string;

  @ApiPropertyOptional({ description: 'Observaciones al reanudar el trabajo' })
  @IsString()
  @IsOptional()
  observaciones?: string;
}



