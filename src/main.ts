import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { networkInterfaces } from 'node:os';
import helmet from 'helmet';
import { origenPermitido } from './common/config/cors.js';
import { secretoObligatorio, verificarSecretosDistintos } from './common/config/secretos.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import { AppModule } from './app.module.js';
import { CacheService } from './common/cache/cache.service.js';
import { RedisIoAdapter } from './common/cache/redis-io.adapter.js';
import { CryptoService } from './common/crypto/crypto.service.js';
import { CryptoResponseInterceptor } from './common/interceptors/crypto-response.interceptor.js';
import { DecryptValidationPipe } from './common/pipes/decrypt-validation.pipe.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Secretos de firma y de cifrado: en producción deben existir, ser largos y distintos entre sí.
  verificarSecretosDistintos({
    JWT_SECRET: secretoObligatorio(process.env.JWT_SECRET, 'JWT_SECRET', 'EasyDrySecretKey2026*OfflineSync'),
    JWT_REFRESH_SECRET: secretoObligatorio(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET', 'EasyDryRefreshSecretKey2026*OfflineSync'),
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  });

  // Detrás de un balanceador (AWS ALB, nginx) define TRUST_PROXY=1 para que `req.ip` sea la IP real del cliente.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);

  // API de solo JSON: sin CSP (Swagger la rompería); el resto de cabeceras de seguridad sí.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  // CORS solo para los orígenes de CORS_ORIGIN (web). La app móvil no manda `Origin` y no se ve afectada.
  app.enableCors({
    origin: (origin, callback) => callback(null, origenPermitido(origin)),
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Client',
      'X-Skip-Auth-Refresh',
      'x-skip-auth-refresh',
      'x-device-id',
      'X-Request-Id',
      'x-request-id',
      'x-encrypted',
      'x-force-encrypted-response',
      'X-Silent-Fallback',
      'x-silent-fallback',
      'x-silent',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: ['x-encrypted'],
  });

  // Asegurar parser express.json previo a nuestro middleware
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Prefijo global de API
  app.setGlobalPrefix('api/v1');

  // Servicio de cifrado
  const cryptoService = app.get(CryptoService);

  // Middleware global para detectar peticiones cifradas y desempaquetarlas
  app.use((req: any, res: any, next: any) => {
    // Ignorar Swagger y utilidades de cifrado
    if (
      req.originalUrl?.includes('/api/docs')
      || req.originalUrl?.includes('/crypto/')
      || req.originalUrl?.includes('/storage/upload')
    ) {
      return next();
    }

    if (req.body && typeof req.body === 'object') {
      if (typeof req.body.data === 'string' && req.body.data.includes(':')) {
        try {
          const decrypted = cryptoService.decrypt(req.body.data);
          req.body = decrypted;
          req.wasEncrypted = true;
        } catch (err: any) {
          return res.status(400).json({
            statusCode: 400,
            message: 'Error al descifrar el cuerpo de la petición. Formato inválido o clave incorrecta.',
          });
        }
      }
    }
    next();
  });

  // Interceptor global para cifrado automático de respuestas
  app.useGlobalInterceptors(new CryptoResponseInterceptor(cryptoService));

  // Validación declarativa estricta con soporte de descifrado
  app.useGlobalPipes(new DecryptValidationPipe(cryptoService));

  // Swagger expone todos los endpoints: en producción queda apagado salvo que se active a propósito con SWAGGER_ENABLED=true.
  const swaggerActivo = process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true';
  if (swaggerActivo) {
    const config = new DocumentBuilder()
      .setTitle('EasyDry Enterprise API')
      .setDescription(
        [
          'Backend central Node.js / NestJS con PostgreSQL. Todas las rutas cuelgan de `/api/v1`.',
          '',
          '**Convenciones**',
          '- Casi todas las operaciones son `POST` con los parámetros en el cuerpo JSON (así no quedan en la URL). Las únicas excepciones son `GET /storage/presigned-url` y `GET /storage/file`.',
          '- Autenticación: `Authorization: Bearer <accessToken>` (botón *Authorize*). Rutas públicas: `auth/login`, `auth/refresh`, `auth/logout`, `sync/ping` y `GET /storage/file`.',
          '- Navegador web: enviar `X-Client: web`; el refresh token viaja en una cookie HttpOnly y no en el cuerpo. La app móvil lo recibe y lo envía en el cuerpo.',
          '- Cifrado opcional (AES-256-CBC): un cuerpo `{ "data": "<iv>:<cifrado>" }` se descifra solo, y la respuesta vuelve cifrada (`{ "data": ... }` con cabecera `x-encrypted: true`). También se puede pedir la respuesta cifrada con `x-encrypted: true` o `x-force-encrypted-response: true`. Sin esas marcas, el cuerpo va en claro. `storage/upload` (multipart) no se cifra.',
          '- Errores de validación: `400` con `message` (lista de campos). Sin sesión: `401`. Sin permiso: `403`. Límite de peticiones excedido: `429`.',
          '- Los permisos exigidos por cada ruta se aplican en el servidor según el rol del usuario.',
        ].join('\n'),
      )
      .setVersion('2.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);

    // Errores que cualquier ruta puede devolver (guard de sesión/permisos, validación y límite de peticiones):
    // se añaden a cada operación que no los documente, para no repetirlos en los ~260 controladores.
    const erroresComunes: Record<string, string> = {
      '400': 'Datos inválidos: `message` lista los campos que fallaron la validación',
      '401': 'Sin sesión o token vencido',
      '403': 'El rol del usuario no tiene el permiso requerido o el recurso está fuera de su alcance',
      '429': 'Demasiadas peticiones: espera antes de reintentar',
    };
    for (const rutas of Object.values(document.paths ?? {})) {
      for (const operacion of Object.values(rutas) as any[]) {
        if (!operacion?.responses) continue;
        const protegida = Array.isArray(operacion.security) && operacion.security.length > 0;
        const conCuerpo = !!operacion.requestBody || (operacion.parameters ?? []).length > 0;
        for (const [codigo, descripcion] of Object.entries(erroresComunes)) {
          if (operacion.responses[codigo]) continue;
          if ((codigo === '401' || codigo === '403') && !protegida) continue;
          if (codigo === '400' && !conCuerpo) continue;
          operacion.responses[codigo] = { description: descripcion };
        }
      }
    }
    SwaggerModule.setup('api/docs', app, document);
  }

  // Varias instancias: los avisos en tiempo real (sockets) se reparten entre todas por Redis.
  const adaptadorSockets = new RedisIoAdapter(app, app.get(CacheService));
  if (adaptadorSockets.conectar()) {
    app.useWebSocketAdapter(adaptadorSockets);
    logger.log('Sockets repartidos entre instancias con Redis');
  }

  // En producción, sin CORS_ORIGIN ningún navegador puede llamar a la API: se avisa en el arranque en vez de fallar en silencio.
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN?.trim()) {
    logger.warn('CORS_ORIGIN vacío en producción: el panel web no podrá llamar a la API. Defínelo con el dominio exacto del panel.');
  }

  // Redis es parte del despliegue: sin él la caché, el límite de peticiones y los sockets quedan en la memoria de cada instancia.
  if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL?.trim()) {
    logger.warn('REDIS_URL vacío en producción: el sistema funciona, pero sin caché compartida ni límite de peticiones común. Defínelo con la URL interna del Redis de Render.');
  }

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');

  logger.log(`Servidor EasyDry backend ejecutándose en: http://localhost:${port}/api/v1`);
  const ipLan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
  if (ipLan) logger.log(`Acceso LAN (app Expo): http://${ipLan}:${port}/api/v1`);
  if (swaggerActivo) logger.log(`Documentación Swagger interactiva disponible en: http://localhost:${port}/api/docs`);
}
bootstrap();
