import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterPushTokenDto {
  @ApiProperty({ example: 'device-uuid-123', description: 'Identificador único del hardware móvil' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', description: 'Token de notificación Expo Push' })
  @IsString()
  @IsNotEmpty()
  pushToken: string;

  @ApiPropertyOptional({ example: '1.2.0', description: 'Versión de la aplicación móvil' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ example: 'ANDROID', description: 'Plataforma del dispositivo' })
  @IsOptional()
  @IsString()
  platform?: string;
}
