import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Refresh Token de la app móvil. El cliente web lo manda en una cookie HttpOnly y no lo incluye en el cuerpo.',
  })
  @IsOptional()
  @IsString({ message: 'El refreshToken debe ser un texto válido' })
  refreshToken?: string;
}
