import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CambiarPasswordDto {
  @ApiProperty({ description: 'Contraseña actual' })
  @IsString()
  @IsNotEmpty({ message: 'Escribe tu contraseña actual' })
  @MaxLength(128)
  passwordActual: string;

  @ApiProperty({ description: 'Nueva contraseña (mín. 10 caracteres, con mayúscula, minúscula, número y carácter especial)' })
  @IsString()
  @IsNotEmpty({ message: 'Escribe la nueva contraseña' })
  @MaxLength(128)
  passwordNueva: string;
}
