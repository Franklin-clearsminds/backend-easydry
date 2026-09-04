import { ValidationPipe, ArgumentMetadata, Injectable, BadRequestException } from '@nestjs/common';
import { CryptoService } from '../crypto/crypto.service.js';

@Injectable()
export class DecryptValidationPipe extends ValidationPipe {
  constructor(private readonly cryptoService: CryptoService) {
    super({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    });
  }

  async transform(value: any, metadata: ArgumentMetadata) {
    // Si aún viene envuelto en { data: "iv:cipher" }, descifrarlo
    if (metadata.type === 'body' && value && typeof value === 'object') {
      // Ignorar si el DTO explícitamente pide el campo data (como DecryptRequestDto)
      if (metadata.metatype?.name !== 'DecryptRequestDto') {
        if (typeof value.data === 'string' && value.data.includes(':')) {
          try {
            value = this.cryptoService.decrypt(value.data);
          } catch (err: any) {
            throw new BadRequestException('Error al descifrar el cuerpo de la petición.');
          }
        }
      }
    }

    return super.transform(value, metadata);
  }
}
