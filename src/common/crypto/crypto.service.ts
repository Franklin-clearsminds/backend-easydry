import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-cbc';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const rawKey = this.configService.get<string>('ENCRYPTION_KEY') || 'EasyDrySecretKey2026*OfflineSync32B';
    // Asegurar clave exacta de 32 bytes (256 bits) usando SHA-256
    this.key = createHash('sha256').update(rawKey).digest();
  }

  /**
   * Cifra cualquier objeto o texto en formato "iv_hex:ciphertext_hex"
   */
  encrypt(data: any): string {
    try {
      const textToEncrypt = typeof data === 'string' ? data : JSON.stringify(data);
      const iv = randomBytes(16);
      const cipher = createCipheriv(this.algorithm, this.key, iv);

      let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      return `${iv.toString('hex')}:${encrypted}`;
    } catch (err: any) {
      this.logger.error(`Error al cifrar datos: ${err.message}`);
      throw new BadRequestException('Error al cifrar la respuesta');
    }
  }

  /**
   * Descifra una cadena en formato "iv_hex:ciphertext_hex" y la convierte en objeto o texto
   */
  decrypt(encryptedPayload: string): any {
    try {
      if (!encryptedPayload || !encryptedPayload.includes(':')) {
        throw new Error('Formato cifrado inválido. Se espera "iv:ciphertext"');
      }

      const [ivHex, ciphertextHex] = encryptedPayload.split(':');
      const iv = Buffer.from(ivHex, 'hex');

      if (iv.length !== 16) {
        throw new Error('Vector de inicialización (IV) inválido');
      }

      const decipher = createDecipheriv(this.algorithm, this.key, iv);
      let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    } catch (err: any) {
      this.logger.error(`Fallo de descifrado: ${err.message}`);
      throw new BadRequestException('Carga útil cifrada inválida o corrupta');
    }
  }
}
