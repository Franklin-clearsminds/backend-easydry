import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import { AppModule } from './app.module.js';
import { CryptoService } from './common/crypto/crypto.service.js';
import { CryptoResponseInterceptor } from './common/interceptors/crypto-response.interceptor.js';
import { DecryptValidationPipe } from './common/pipes/decrypt-validation.pipe.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Habilitar CORS para Angular 19 y React Native Expo
  app.enableCors({
    origin: true,
    methods: 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
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

  // Configuración de Swagger OpenAPI
  const config = new DocumentBuilder()
    .setTitle('EasyDry Enterprise API (100% POST & Body Encrypted)')
    .setDescription('Backend central Node.js / NestJS con PostgreSQL, arquitectura 100% POST y cifrado simétrico AES-256-CBC en el cuerpo')
    .setVersion('2.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Servidor EasyDry backend ejecutándose en: http://localhost:${port}/api/v1`);
  logger.log(`Acceso LAN (app Expo): http://192.168.100.6:${port}/api/v1`);
  logger.log(`Documentación Swagger interactiva disponible en: http://localhost:${port}/api/docs`);
}
bootstrap();
