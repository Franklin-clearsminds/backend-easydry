import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { secretoObligatorio } from '../config/secretos.js';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/** Marca de lo que está cifrado en la base. Lo que no la lleva es un dato anterior, todavía sin cifrar. */
export const PREFIJO_EN_REPOSO = 'enc1:';

@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly algorithm = 'aes-256-cbc';
  private readonly key: Buffer;
  /** Clave propia para los datos guardados en la base: sale de la misma `ENCRYPTION_KEY`, pero no se comparte con el cifrado del tráfico. */
  private readonly claveEnReposo: Buffer;

  constructor(private configService: ConfigService) {
    const rawKey = secretoObligatorio(this.configService.get<string>('ENCRYPTION_KEY'), 'ENCRYPTION_KEY', 'EasyDrySecretKey2026*OfflineSync32B');
    // Asegurar clave exacta de 32 bytes (256 bits) usando SHA-256
    this.key = createHash('sha256').update(rawKey).digest();
    this.claveEnReposo = createHash('sha256').update(`datos-en-reposo-v1:${rawKey}`).digest();
  }

  /** ¿Este valor ya está cifrado con `protegerEnReposo`? */
  estaProtegido(valor: unknown): boolean {
    return typeof valor === 'string' && valor.startsWith(PREFIJO_EN_REPOSO);
  }

  /**
   * Cifra un dato para guardarlo en la base (AES-256-GCM): `enc1:` + base64(iv | etiqueta | cifrado). Cada vez sale distinto (IV nuevo) y si alguien
   * altera el valor guardado, al leerlo se detecta. Es idempotente: lo que ya está cifrado se devuelve igual.
   */
  protegerEnReposo(texto: string | null | undefined): string | null {
    if (texto === null || texto === undefined || texto === '') return null;
    if (this.estaProtegido(texto)) return texto;
    const iv = randomBytes(12);
    const cifrador = createCipheriv('aes-256-gcm', this.claveEnReposo, iv);
    const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
    return PREFIJO_EN_REPOSO + Buffer.concat([iv, cifrador.getAuthTag(), cifrado]).toString('base64');
  }

  /**
   * Devuelve el dato original. Un valor sin la marca `enc1:` (anterior al cifrado) se entrega tal cual para no romper lo que ya existía. Si el valor
   * está cifrado pero no se puede abrir (clave distinta o dato alterado), devuelve `null` y lo deja en el registro, en vez de romper toda la consulta.
   */
  revelarEnReposo(valor: string | null | undefined): string | null {
    if (valor === null || valor === undefined || valor === '') return null;
    if (!this.estaProtegido(valor)) return valor;
    try {
      const bruto = Buffer.from(valor.slice(PREFIJO_EN_REPOSO.length), 'base64');
      const iv = bruto.subarray(0, 12);
      const etiqueta = bruto.subarray(12, 28);
      const cifrado = bruto.subarray(28);
      const descifrador = createDecipheriv('aes-256-gcm', this.claveEnReposo, iv);
      descifrador.setAuthTag(etiqueta);
      return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
    } catch (err: any) {
      this.logger.error(`No se pudo abrir un dato cifrado en la base (¿cambió ENCRYPTION_KEY o se alteró el valor?): ${err.message}`);
      return null;
    }
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
