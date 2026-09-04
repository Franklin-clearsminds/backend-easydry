import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DetailServicioDto {
  @ApiProperty({ example: 'demo-uuid-in-progress-001', description: 'ID o clientUuid del servicio de lavado' })
  @IsString()
  @IsNotEmpty()
  id: string;
}
