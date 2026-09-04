import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Refresh Token JWT obtenido durante el login o en el último refresco',
  })
  @IsString({ message: 'El refreshToken debe ser un texto válido' })
  @IsNotEmpty({ message: 'El refreshToken es requerido' })
  refreshToken: string;
}
