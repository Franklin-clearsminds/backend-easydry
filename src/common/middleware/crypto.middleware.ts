import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { CryptoService } from '../crypto/crypto.service.js';

@Injectable()
export class CryptoMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CryptoMiddleware.name);

  constructor(private readonly cryptoService: CryptoService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Ignorar rutas de utilidades de Swagger o crypto
    if (req.originalUrl.includes('/api/docs') || req.originalUrl.includes('/crypto/')) {
      return next();
    }

    if (req.body && typeof req.body === 'object') {
      // Caso 1: El body viene empaquetado en el sobre { "data": "iv:ciphertext" }
      if (typeof req.body.data === 'string' && req.body.data.includes(':')) {
        try {
          const decrypted = this.cryptoService.decrypt(req.body.data);
          req.body = decrypted;
          (req as any).wasEncrypted = true;
        } catch (err: any) {
          this.logger.warn(`Petición recibida con payload cifrado inválido: ${err.message}`);
          return res.status(400).json({
            statusCode: 400,
            message: 'Error al descifrar el cuerpo de la petición. Formato inválido.',
          });
        }
      } else if (req.headers['x-encrypted'] === 'true' && typeof (req.body as any) === 'string') {
        // Caso 2: Se envía texto plano cifrado directamente con header x-encrypted
        try {
          const decrypted = this.cryptoService.decrypt(req.body as any);
          req.body = decrypted;
          (req as any).wasEncrypted = true;
        } catch (err: any) {
          return res.status(400).json({
            statusCode: 400,
            message: 'Error al descifrar el cuerpo de la petición.',
          });
        }
      }
    }

    next();
  }
}
