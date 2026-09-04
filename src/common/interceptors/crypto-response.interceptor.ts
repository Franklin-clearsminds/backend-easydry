import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CryptoService } from '../crypto/crypto.service.js';

@Injectable()
export class CryptoResponseInterceptor implements NestInterceptor {
  constructor(private readonly cryptoService: CryptoService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();

    // No cifrar Swagger ni endpoints del módulo crypto
    if (req.originalUrl?.includes('/api/docs') || req.originalUrl?.includes('/crypto/')) {
      return next.handle();
    }

    const shouldEncrypt =
      (req as any).wasEncrypted === true ||
      req.headers['x-encrypted'] === 'true' ||
      req.headers['x-force-encrypted-response'] === 'true';

    return next.handle().pipe(
      map((data) => {
        if (!shouldEncrypt) {
          return data;
        }

        const encryptedData = this.cryptoService.encrypt(data);
        res.setHeader('x-encrypted', 'true');

        return {
          data: encryptedData,
        };
      }),
    );
  }
}
