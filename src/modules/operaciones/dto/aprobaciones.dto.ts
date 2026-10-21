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

export class AnularServicioDto {
  @ApiProperty({ description: 'ID o clientUuid del servicio a anular' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Motivo de la anulación (obligatorio: queda registrado quién anuló y por qué)' })
  @IsString()
  @IsNotEmpty()
  motivo: string;

  @ApiPropertyOptional({ description: 'Reponer al inventario los insumos ya consumidos (por defecto sí)', default: true })
  @IsOptional()
  reponerInsumos?: boolean;
}

export class AnularServicioEspecialDto {
  @ApiProperty({ description: 'ID del servicio especial a anular' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Motivo de la anulación (obligatorio: queda registrado quién anuló y por qué)' })
  @IsString()
  @IsNotEmpty()
  motivo: string;
}
