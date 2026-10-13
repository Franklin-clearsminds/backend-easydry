import { Controller, Post, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { CLIENT_HEADER, CLIENT_WEB, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './jwt.config.js';

import { Publico, SoloAutenticado } from '../../common/permisos/permisos.decorators.js';

/** Peticiones por minuto y por IP. `AUTH_RATE_LIMIT` solo se usa en las pruebas automáticas, que inician sesión decenas de veces. */
const LIMITE_LOGIN = Number(process.env.AUTH_RATE_LIMIT) || 10;
const LIMITE_REFRESH = Number(process.env.AUTH_RATE_LIMIT) || 20;

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Publico()
  @Throttle({ default: { limit: LIMITE_LOGIN, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Iniciar sesión (Web y Móvil)' })
  @ApiResponse({ status: 200, description: 'Sesión iniciada exitosamente con accessToken y refreshToken' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(@Body() loginDto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.entregarSesion(await this.authService.login(loginDto), req, res);
  }

  @Publico()
  @Throttle({ default: { limit: LIMITE_REFRESH, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar tokens de sesión con Refresh Token (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Nuevos tokens generados con éxito' })
  @ApiResponse({ status: 401, description: 'Refresh token inválido, expirado o usuario inactivo' })
  async refresh(@Body() refreshDto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.esWeb(req) ? this.leerCookie(req, REFRESH_COOKIE) : refreshDto?.refreshToken;
    try {
      return this.entregarSesion(await this.authService.refreshToken(token ?? ''), req, res);
    } catch (err) {
      if (this.esWeb(req)) this.borrarCookie(res);
      throw err;
    }
  }

  @Publico()
  @Throttle({ default: { limit: LIMITE_REFRESH, ttl: 60_000 } })
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar sesión: revoca el refresh token' })
  async logout(@Body() body: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.esWeb(req) ? this.leerCookie(req, REFRESH_COOKIE) : body?.refreshToken;
    this.borrarCookie(res);
    return this.authService.logout(token);
  }

  @SoloAutenticado()
  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener perfil del usuario autenticado (POST Seguro)' })
  @ApiResponse({ status: 200, description: 'Datos del usuario e información de sucursal' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @SoloAutenticado()
  @Post('profile')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar perfil del usuario autenticado (avatar S3 y datos básicos)' })
  @ApiResponse({ status: 200, description: 'Perfil actualizado' })
  async updateProfile(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(userId, dto);
  }

  private esWeb(req: Request): boolean {
    return String(req.headers[CLIENT_HEADER] ?? '').toLowerCase() === CLIENT_WEB;
  }

  private leerCookie(req: Request, nombre: string): string | undefined {
    const crudo = req.headers.cookie;
    if (!crudo) return undefined;
    for (const par of crudo.split(';')) {
      const [clave, ...resto] = par.trim().split('=');
      if (clave === nombre) {
        try {
          return decodeURIComponent(resto.join('='));
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }

  private opcionesCookie() {
    const enProduccion = process.env.NODE_ENV === 'production';
    const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase() as 'lax' | 'strict' | 'none';
    return {
      httpOnly: true,
      // SameSite=None exige Secure; en producción siempre va por HTTPS.
      secure: enProduccion || sameSite === 'none',
      sameSite,
      path: REFRESH_COOKIE_PATH,
    };
  }

  private borrarCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.opcionesCookie());
  }

  /**
   * El navegador recibe el refresh token solo en una cookie HttpOnly (un XSS no puede leerlo ni copiarlo); la app móvil, que no
   * tiene cookies ni XSS, lo sigue recibiendo en el cuerpo y lo guarda en el dispositivo.
   */
  private entregarSesion<T extends { refreshToken: string }>(sesion: T, req: Request, res: Response): T {
    if (!this.esWeb(req)) return sesion;
    let maxAge: number | undefined;
    try {
      const exp = JSON.parse(Buffer.from(sesion.refreshToken.split('.')[1], 'base64url').toString()).exp;
      maxAge = typeof exp === 'number' ? Math.max(exp * 1000 - Date.now(), 0) : undefined;
    } catch {
      maxAge = undefined;
    }
    res.cookie(REFRESH_COOKIE, sesion.refreshToken, { ...this.opcionesCookie(), maxAge });
    return { ...sesion, refreshToken: '' };
  }
}
