import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsNumber, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBodegaDto {
  @ApiProperty({ example: 'Bodega Regional Manabí - Manta', description: 'Nombre oficial de la bodega' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la bodega es obligatorio' })
  nombre: string;

  @ApiPropertyOptional({ example: 'BOD-MANABI', description: 'Código único identificador' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({
    example: 'REGIONAL',
    description: 'CENTRAL = única nacional (despacha a todo el país). REGIONAL = solo agencias de su región.',
    enum: ['CENTRAL', 'REGIONAL'],
  })
  @IsOptional()
  @IsIn(['CENTRAL', 'REGIONAL'])
  tipo?: 'CENTRAL' | 'REGIONAL';

  @ApiPropertyOptional({
    example: 'uuid-region',
    description: 'ID de región (obligatorio para REGIONAL; omitir o null para CENTRAL)',
  })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'Manta', description: 'Ciudad donde se ubica la bodega' })
  @IsOptional()
  @IsString()
  ciudad?: string;

  @ApiPropertyOptional({ example: 'Av. Malecón y Calle 15, HUB Logístico', description: 'Dirección física de la bodega' })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ example: '0991234567', description: 'Teléfono o contacto de la bodega' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 20, description: 'Porcentaje (%) de umbral para alertas de stock mínimo en esta bodega' })
  @IsOptional()
  @IsNumber()
  porcentajeAlerta?: number;
}

export class UpdateBodegaDto {
  @ApiProperty({ example: 'uuid-bodega', description: 'ID de la bodega a actualizar' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la bodega es obligatorio' })
  id: string;

  @ApiPropertyOptional({ example: 'Bodega Regional Manabí - Manta' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ example: 'BOD-MANABI' })
  @IsOptional()
  @IsString()
  codigo?: string;

  @ApiPropertyOptional({ example: 'uuid-region', description: 'Nueva región asignada' })
  @IsOptional()
  @IsString()
  regionId?: string;

  @ApiPropertyOptional({ example: 'REGIONAL', enum: ['CENTRAL', 'REGIONAL'] })
  @IsOptional()
  @IsIn(['CENTRAL', 'REGIONAL'])
  tipo?: 'CENTRAL' | 'REGIONAL';

  @ApiPropertyOptional({ example: 'Manta' })
  @IsOptional()
  @IsString()
  ciudad?: string;

  @ApiPropertyOptional({ example: 'Av. Malecón y Calle 15' })
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional({ example: '0991234567' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ example: 20, description: 'Porcentaje (%) de umbral para alertas de stock mínimo' })
  @IsOptional()
  @IsNumber()
  porcentajeAlerta?: number;

  @ApiPropertyOptional({ example: true, description: 'Estado activo o inactivo' })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class ToggleActivaBodegaDto {
  @ApiProperty({ example: 'uuid-bodega' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la bodega es obligatorio' })
  id: string;
}

export class DeleteBodegaDto {
  @ApiProperty({ example: 'uuid-bodega' })
  @IsString()
  @IsNotEmpty({ message: 'El ID de la bodega es obligatorio' })
  id: string;
}
