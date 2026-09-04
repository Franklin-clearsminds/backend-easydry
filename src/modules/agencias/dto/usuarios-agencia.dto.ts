import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AsignarUsuarioAgenciaDto {
  @ApiProperty({ example: 'uuid-usuario', description: 'ID del usuario a reasignar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de usuario es obligatorio' })
  usuarioId: string;

  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'ID de la agencia principal asignada' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'ID de la región asignada (para roles como SUPERVISOR, COORD_COMERCIAL)' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({
    example: ['uuid-agencia-1', 'uuid-agencia-2'],
    description: 'Lista de IDs de agencias a las que tiene acceso (opcional, para supervisores/comerciales)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agenciasIds?: string[];
}

export class ListUsuariosAgenciaDto {
  @ApiPropertyOptional({ example: 'uuid-agencia', description: 'Filtrar por agencia (si se omite, lista todos o los de la agencia del usuario)' })
  @IsOptional()
  @IsString()
  agenciaId?: string;

  @ApiPropertyOptional({ example: 'PULIDOR_FIJO', description: 'Filtrar por nombre de rol' })
  @IsOptional()
  @IsString()
  rolNombre?: string;
}
