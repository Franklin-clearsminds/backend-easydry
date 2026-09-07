import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AprobarServicioDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio a aprobar' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiPropertyOptional({ description: 'Observación del gerente/supervisor al aprobar' })
  @IsString()
  @IsOptional()
  observacion?: string;
}

export class RechazarServicioDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio a rechazar' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Motivo técnico del rechazo' })
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

export class AprobarTodosDto {
  @ApiPropertyOptional({ description: 'ID de la agencia a cerrar y aprobar' })
  @IsString()
  @IsOptional()
  agenciaId?: string;

  @ApiPropertyOptional({ description: 'Alias de agenciaId (compatibilidad con frontend)' })
  @IsString()
  @IsOptional()
  sucursalId?: string;

  @ApiPropertyOptional({ description: 'Fecha YYYY-MM-DD para limitar el cierre (opcional)' })
  @IsString()
  @IsOptional()
  fecha?: string;

  @ApiPropertyOptional({ description: 'Exigir que el servicio cuente con foto de salida para ser aprobado (Quality Gate)', default: true })
  @IsOptional()
  requiereFotoSalida?: boolean;
}

