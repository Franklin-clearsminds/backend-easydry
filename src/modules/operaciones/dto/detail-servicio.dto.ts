import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DetailServicioDto {
  @ApiProperty({ example: '3f2b8c1e-5a4d-4e7b-9c3a-1d2e3f4a5b6c', description: 'ID o clientUuid del servicio de lavado' })
  @IsString()
  @IsNotEmpty()
  id: string;
}
