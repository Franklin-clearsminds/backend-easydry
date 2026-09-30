import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { CryptoService } from './../src/common/crypto/crypto.service.js';
import { CryptoResponseInterceptor } from './../src/common/interceptors/crypto-response.interceptor.js';
import { DecryptValidationPipe } from './../src/common/pipes/decrypt-validation.pipe.js';

/**
 * Prueba de humo end-to-end: levanta la app real (mismo prefijo, pipes e interceptores que
 * `main.ts`) contra la base de datos configurada en DATABASE_URL y confirma que el gobierno de
 * acceso funciona de punta a punta. No depende de datos sembrados: solo verifica que el servidor
 * rechaza lo que debe rechazar y valida lo que debe validar.
 *
 * Reemplaza la plantilla de NestJS (`GET /` → "Hello World!"), que no aplicaba porque el
 * proyecto nunca tuvo un AppController.
 */
describe('EasyDry backend (e2e smoke)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    const cryptoService = app.get(CryptoService);
    app.useGlobalInterceptors(new CryptoResponseInterceptor(cryptoService));
    app.useGlobalPipes(new DecryptValidationPipe(cryptoService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza una petición a un endpoint protegido sin sesión (falla cerrado)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/agencias/usuarios/list')
      .send({});
    expect(res.status).toBe(401);
  });

  it('rechaza el login con credenciales inválidas sin exponer un error de servidor', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'no-existe@easydry.com', password: 'password-incorrecto' });
    expect(res.status).toBe(401);
  });

  it('valida el cuerpo de la petición antes de tocar la base de datos', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'no-es-un-correo', password: '123' });
    expect(res.status).toBe(400);
  });
});
