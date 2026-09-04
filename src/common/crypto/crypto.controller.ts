import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString } from 'class-validator';
import { CryptoService } from './crypto.service.js';

export class EncryptRequestDto {
  @ApiProperty({ example: { email: 'superadmin@easydry.com', password: 'Admin123*' }, description: 'Cualquier objeto JSON a cifrar' })
  @IsDefined({ message: 'El campo payload es requerido' })
  payload: any;
}

export class DecryptRequestDto {
  @ApiProperty({ example: 'a1b2c3d4e5f6...:987654321...', description: 'Cadena cifrada en formato "iv:ciphertext"' })
  @IsString({ message: 'El campo data debe ser una cadena' })
  @IsNotEmpty({ message: 'El campo data no debe estar vacío' })
  data: string;
}

@ApiTags('Utilidades de Cifrado')
@Controller('crypto')
export class CryptoController {
  constructor(private readonly cryptoService: CryptoService) {}

  @Post('encrypt')
  @ApiOperation({ summary: 'Herramienta de desarrollo: Cifrar payload JSON a formato AES-256-CBC' })
  @ApiResponse({ status: 200, description: 'Cadena cifrada en campo "data"' })
  encrypt(@Body() body: EncryptRequestDto) {
    const encrypted = this.cryptoService.encrypt(body.payload ?? body);
    return { data: encrypted };
  }

  @Post('decrypt')
  @ApiOperation({ summary: 'Herramienta de desarrollo: Descifrar cadena AES-256-CBC a JSON legible' })
  @ApiResponse({ status: 200, description: 'Objeto descifrado' })
  decrypt(@Body() body: DecryptRequestDto) {
    const decrypted = this.cryptoService.decrypt(body.data);
    return { decrypted };
  }
}
