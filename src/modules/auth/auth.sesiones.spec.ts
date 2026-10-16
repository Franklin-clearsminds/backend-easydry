import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: rotación, reutilización y revocación de refresh tokens.
 * Usa un usuario activo cualquiera del seed y borra al final las sesiones que creó.
 */
describe('sesiones de refresh token (base real)', () => {
  let env: Entorno;
  let service: AuthService;
  let usuario: { id: string; email: string; roleId: string };
  const jwt = new JwtService({});

  const emitir = async () => (service as any).generateTokens(usuario) as Promise<{ accessToken: string; refreshToken: string }>;
  const jtiDe = (token: string) => (jwt.decode(token) as { jti: string }).jti;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AuthService(env.prisma as never, jwt, new ConfigService(), undefined as never);
    usuario = await env.prisma.user.findFirstOrThrow({
      where: { estado: 1, role: { estado: 1 } },
      select: { id: true, email: true, roleId: true },
    });
  });

  afterAll(async () => {
    await env.prisma.refreshSession.deleteMany({ where: { userId: usuario.id } });
    await env.prisma.loginIntento.deleteMany({ where: { email: { endsWith: '@no-existe.test' } } });
    await env.cerrar();
  });

  it('cada refresh entrega un token nuevo y deja inservible el anterior', async () => {
    const { refreshToken: primero } = await emitir();
    const { refreshToken: segundo } = await service.refreshToken(primero);
    expect(segundo).not.toBe(primero);
    expect(jtiDe(segundo)).not.toBe(jtiDe(primero));

    const original = await env.prisma.refreshSession.findUniqueOrThrow({ where: { id: jtiDe(primero) } });
    expect(original.revokedAt).not.toBeNull();
  });

  it('reutilizar un token ya rotado (fuera de la ventana de gracia) cierra toda la cadena', async () => {
    const { refreshToken: primero } = await emitir();
    const { refreshToken: segundo } = await service.refreshToken(primero);
    // El token viejo se "robó": su revocación ocurrió hace más de la ventana de gracia.
    await env.prisma.refreshSession.update({ where: { id: jtiDe(primero) }, data: { revokedAt: new Date(Date.now() - 60_000) } });

    await expect(service.refreshToken(primero)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshToken(segundo)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('dentro de la ventana de gracia se rechaza el token viejo pero no se cierra la sesión legítima', async () => {
    const { refreshToken: primero } = await emitir();
    const { refreshToken: segundo } = await service.refreshToken(primero);

    await expect(service.refreshToken(primero)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshToken(segundo)).resolves.toHaveProperty('refreshToken');
  });

  it('web: dos pestañas renovando a la vez no cierran la sesión (el token viejo recibe solo un access token)', async () => {
    const { refreshToken: primero } = await emitir();
    const { refreshToken: segundo } = await service.refreshToken(primero, true);

    // La otra pestaña llega con el token que acaba de rotarse: recibe acceso, no refresh token, y no se revoca nada.
    const tardia: any = await service.refreshToken(primero, true);
    expect(tardia.success).toBe(true);
    expect(tardia.accessToken).toBeTruthy();
    expect(tardia.refreshToken).toBe('');
    // La cadena sigue viva: el refresh token ganador sigue sirviendo.
    await expect(service.refreshToken(segundo, true)).resolves.toHaveProperty('refreshToken');
  });

  it('web: dos renovaciones exactamente simultáneas con el mismo token funcionan las dos y solo una rota', async () => {
    const { refreshToken } = await emitir();

    const [a, b]: any[] = await Promise.all([service.refreshToken(refreshToken, true), service.refreshToken(refreshToken, true)]);

    expect(a.accessToken).toBeTruthy();
    expect(b.accessToken).toBeTruthy();
    // Exactamente una ganó la rotación y trae el refresh token nuevo; la otra solo recibe acceso.
    expect([a.refreshToken, b.refreshToken].filter(Boolean)).toHaveLength(1);
  });

  it('móvil: la renovación simultánea con el mismo token sigue rechazando a la segunda', async () => {
    const { refreshToken } = await emitir();

    const resultados = await Promise.allSettled([service.refreshToken(refreshToken), service.refreshToken(refreshToken)]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('web: tras un logout el token no renueva ni siquiera dentro de la ventana de gracia', async () => {
    const { refreshToken: primero } = await emitir();
    const { refreshToken: segundo } = await service.refreshToken(primero, true);
    await service.logout(segundo);

    await expect(service.refreshToken(primero, true)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshToken(segundo, true)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('logout revoca la sesión: el token ya no renueva', async () => {
    const { refreshToken } = await emitir();
    await service.logout(refreshToken);
    await expect(service.refreshToken(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cambiar la contraseña revoca todas las sesiones del usuario', async () => {
    const { refreshToken: a } = await emitir();
    const { refreshToken: b } = await emitir();
    await service.revocarSesionesDeUsuario(usuario.id);
    await expect(service.refreshToken(a)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.refreshToken(b)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un token firmado sin emisor/audiencia del sistema no se acepta', async () => {
    const falso = jwt.sign(
      { sub: usuario.id, email: usuario.email, roleId: usuario.roleId, type: 'refresh' },
      { secret: 'EasyDryRefreshSecretKey2026*OfflineSync', expiresIn: '1h', jwtid: 'cualquiera' },
    );
    await expect(service.refreshToken(falso)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('un access token no sirve como refresh token', async () => {
    const { accessToken } = await emitir();
    await expect(service.refreshToken(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('tras 5 contraseñas incorrectas el correo queda bloqueado temporalmente', async () => {
    const correo = `bloqueo-${Date.now()}@no-existe.test`;
    for (let i = 0; i < 5; i++) {
      await expect(service.login({ email: correo, password: 'incorrecta' })).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(service.login({ email: correo, password: 'incorrecta' })).rejects.toMatchObject({ status: 429 });
  });
});
