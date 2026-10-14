import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { secretoObligatorio } from '../../common/config/secretos.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { StorageService } from '../storage/storage.service.js';
import { modulosDeRol } from '../../common/permisos/modulos-navegacion.js';
import { JWT_ACCESS_DEFAULT, JWT_REFRESH_DEFAULT, JWT_SIGN_OPTIONS, JWT_VERIFY_OPTIONS } from './jwt.config.js';

/** Hash descartable (mismo costo que los reales) para comparar cuando el correo no existe. */
const HASH_SIN_USUARIO = bcrypt.hashSync(randomUUID(), 10);
const MAX_INTENTOS_FALLIDOS = 5;
const VENTANA_INTENTOS_MS = 15 * 60 * 1000;
/** Dos refresh simultáneos con el mismo token (p. ej. app móvil con varias peticiones) no son un robo: se tolera esta ventana. */
const GRACIA_REUSO_MS = 30 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private storageService: StorageService,
  ) {}

  /**
   * Qué puede hacer el rol en la app móvil: si puede entrar (permiso `sync.usar`) y qué pantallas ve ahí. Una pantalla
   * aparece en el celular solo si el módulo está marcado para la app Y el rol tiene su permiso (`modulosDeRol`).
   */
  private async infoApp(role: { namerol?: string | null; capacidades?: string[] | null } | null | undefined) {
    // Entra a la app quien sincroniza (sync.usar) o, sin operar, solo consulta los resultados de auditoría (líder, lavador, pulidor).
    const puedeUsarApp =
      role?.namerol === 'SUPER_ADMIN' ||
      !!role?.capacidades?.some((c) => c === 'sync.usar' || c === 'informes.ver' || c === 'inspecciones.ver');
    const pantallas = modulosDeRol(role);
    if (!puedeUsarApp || !pantallas.length) return { puedeUsarApp, pantallasApp: [] as string[] };
    const enApp = await this.prisma.moduloSistema.findMany({
      where: { codigo: { in: pantallas }, disponibleEnApp: true, estado: 1 },
      select: { codigo: true },
    });
    const marcadas = new Set(enApp.map((m) => m.codigo));
    return { puedeUsarApp, pantallasApp: pantallas.filter((p) => marcadas.has(p)) };
  }

  private async generateTokens(user: { id: string; email: string; roleId: string }, familyId: string = randomUUID()) {
    const accessSecret = secretoObligatorio(this.configService.get<string>('JWT_SECRET'), 'JWT_SECRET', 'EasyDrySecretKey2026*OfflineSync');
    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRATION') || JWT_ACCESS_DEFAULT;

    const refreshSecret = secretoObligatorio(this.configService.get<string>('JWT_REFRESH_SECRET'), 'JWT_REFRESH_SECRET', 'EasyDryRefreshSecretKey2026*OfflineSync');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION') || JWT_REFRESH_DEFAULT;

    const accessPayload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      type: 'access',
    };

    const refreshPayload = {
      sub: user.id,
      email: user.email,
      roleId: user.roleId,
      type: 'refresh',
    };

    const accessToken = this.jwtService.sign(accessPayload, {
      ...JWT_SIGN_OPTIONS,
      secret: accessSecret,
      expiresIn: accessExpiresIn as any,
    });
    return { accessToken, ...(await this.emitirRefresh(user, familyId, refreshSecret, refreshExpiresIn, refreshPayload)) };
  }

  private async emitirRefresh(
    user: { id: string },
    familyId: string,
    refreshSecret: string,
    refreshExpiresIn: string,
    refreshPayload: Record<string, unknown>,
  ) {
    const sesionId = randomUUID();
    const refreshToken = this.jwtService.sign(refreshPayload, {
      ...JWT_SIGN_OPTIONS,
      secret: refreshSecret,
      expiresIn: refreshExpiresIn as any,
      jwtid: sesionId,
    });

    const { exp } = this.jwtService.decode(refreshToken) as { exp: number };
    await this.prisma.refreshSession.create({
      data: { id: sesionId, userId: user.id, familyId, expiresAt: new Date(exp * 1000) },
    });

    return { refreshToken };
  }

  /** Solo el access token, sin tocar el refresh token (renovación dentro de la ventana de gracia). */
  private emitirAccessToken(user: { id: string; email: string; roleId: string }): string {
    const accessSecret = secretoObligatorio(this.configService.get<string>('JWT_SECRET'), 'JWT_SECRET', 'EasyDrySecretKey2026*OfflineSync');
    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRATION') || JWT_ACCESS_DEFAULT;
    return this.jwtService.sign(
      { sub: user.id, email: user.email, roleId: user.roleId, type: 'access' },
      { ...JWT_SIGN_OPTIONS, secret: accessSecret, expiresIn: accessExpiresIn as any },
    );
  }

  /**
   * Intentos fallidos por correo, guardados en la base: frenan la fuerza bruta aunque el atacante cambie de IP o de dispositivo,
   * y el contador sobrevive a reinicios y se comparte entre instancias del servidor.
   */
  private async verificarBloqueo(email: string): Promise<void> {
    const registro = await this.prisma.loginIntento.findUnique({ where: { email } });
    if (!registro || Date.now() - registro.desde.getTime() > VENTANA_INTENTOS_MS) return;
    if (registro.intentos >= MAX_INTENTOS_FALLIDOS) {
      throw new HttpException(
        'Demasiados intentos fallidos. Espere unos minutos antes de volver a intentarlo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async registrarFallo(email: string): Promise<void> {
    const ahora = new Date();
    const limite = new Date(ahora.getTime() - VENTANA_INTENTOS_MS);
    const sumado = await this.prisma.loginIntento.updateMany({
      where: { email, desde: { gte: limite } },
      data: { intentos: { increment: 1 } },
    });
    if (sumado.count === 0) {
      await this.prisma.loginIntento.upsert({
        where: { email },
        create: { email, intentos: 1, desde: ahora },
        update: { intentos: 1, desde: ahora },
      });
    }
  }

  /** Cierra todas las sesiones del usuario (cambio de contraseña) e invalida también los access tokens ya emitidos. */
  async revocarSesionesDeUsuario(userId: string): Promise<void> {
    const ahora = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: ahora } }),
      this.prisma.user.update({ where: { id: userId }, data: { sesionesRevocadasAt: ahora } }),
    ]);
  }

  /** Cierra la sesión (y toda su cadena de rotaciones) a la que pertenece este refresh token. Nunca falla: un token inválido ya no sirve. */
  async logout(token?: string): Promise<{ success: true }> {
    if (!token) return { success: true };
    try {
      const refreshSecret = secretoObligatorio(this.configService.get<string>('JWT_REFRESH_SECRET'), 'JWT_REFRESH_SECRET', 'EasyDryRefreshSecretKey2026*OfflineSync');
      const payload: any = this.jwtService.verify(token, { ...JWT_VERIFY_OPTIONS, secret: refreshSecret, ignoreExpiration: true });
      if (payload?.type !== 'refresh' || !payload.jti) return { success: true };
      const sesion = await this.prisma.refreshSession.findUnique({ where: { id: payload.jti } });
      if (sesion && sesion.userId === payload.sub) {
        await this.prisma.refreshSession.updateMany({
          where: { familyId: sesion.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch {
      // token inválido: no hay sesión que cerrar
    }
    return { success: true };
  }

  async login(loginDto: LoginDto) {
    const { password } = loginDto;
    const email = loginDto.email.toLowerCase().trim();
    await this.verificarBloqueo(email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        role: {
          select: { id: true, namerol: true, permisos: true, acciones: true, capacidades: true, ambito: true, estado: true },
        },
        agencia: {
          select: { id: true, codigo: true, nombre: true, region: true },
        },
        region: {
          select: { id: true, codigo: true, nombre: true },
        },
        bodega: {
          select: { id: true, codigo: true, nombre: true, regionId: true, tipo: true },
        },
      },
    });

    // Siempre se calcula un bcrypt, exista o no el correo: así el tiempo de respuesta no revela qué cuentas existen.
    const isMatch = await bcrypt.compare(password, user?.passwordHash ?? HASH_SIN_USUARIO);
    if (!user || !isMatch) {
      await this.registrarFallo(email);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    await this.prisma.loginIntento.deleteMany({ where: { email } });

    if (user.estado !== 1) {
      throw new UnauthorizedException('Usuario deshabilitado o inactivo. Contacte a su administrador.');
    }

    if (!user.role || user.role.estado === 0) {
      throw new UnauthorizedException('El rol asignado al usuario se encuentra deshabilitado.');
    }

    void Promise.all([
      this.prisma.refreshSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
      this.prisma.loginIntento.deleteMany({ where: { desde: { lt: new Date(Date.now() - VENTANA_INTENTOS_MS) } } }),
    ]).catch(() => undefined);
    const { accessToken, refreshToken } = await this.generateTokens(user);

    const bahiaAsignada = await this.prisma.bahiaOperador.findFirst({
      where: { operadorId: user.id, activo: true },
      include: { bahia: { select: { id: true, nombre: true } } },
      orderBy: { fechaAsignacion: 'desc' },
    });

    const rolLogin = (user.role?.namerol || '').toUpperCase();
    const esPulidorLogin = rolLogin.includes('PULIDOR') || rolLogin === 'OPERADOR_SERVICIOS_ESPECIALES';

    return {
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        lastname: user.lastname,
        nombre: `${user.name} ${user.lastname}`.trim(),
        roleId: user.roleId,
        role: user.role?.namerol,
        roleCode: user.role?.namerol,
        rolNombre: user.role?.namerol,
        /** Pantallas que ve el rol: salen de sus permisos (Role.capacidades) */
        permisos: modulosDeRol(user.role),
        modulos: modulosDeRol(user.role),
        ...(await this.infoApp(user.role)),
        /** Acciones granulares del rol (desde Role.acciones en BD) */
        acciones: user.role?.acciones ?? null,
        /** Permisos que el backend exige (Role.capacidades) y sobre qué datos actúa el rol (Role.ambito) */
        capacidades: user.role?.capacidades ?? [],
        ambito: user.role?.ambito ?? 'AGENCIA',
        agenciaId: user.agenciaId,
        agenciasIds: user.agenciasIds,
        agencia: user.agencia,
        sucursal: user.agencia?.nombre || user.bodega?.nombre,
        sucursalNombre: user.agencia?.nombre || user.bodega?.nombre,
        regionId: user.regionId,
        region: user.region,
        regionNombre: user.region?.nombre,
        bodegaId: user.bodegaId,
        bodega: user.bodega,
        bodegaNombre: user.bodega?.nombre,
        servicioIds: Array.isArray(user.servicioIds) ? user.servicioIds : [],
        bahiaId: bahiaAsignada?.bahiaId,
        bahiaNombre: bahiaAsignada?.bahia?.nombre,
        modalidadPulidor: esPulidorLogin ? (user.agenciaId ? 'FIJO' : 'MOVIL') : undefined,
        estado: user.estado,
        avatarUrl: this.versionedAvatar(user.avatarUrl, user.updatedAt),
        avatar: this.versionedAvatar(user.avatarUrl, user.updatedAt),
      },
    };
  }

  /**
   * `soloAcceso` (cliente web): si el token ya fue rotado hace instantes por otra pestaña, se entrega solo un access token nuevo y se
   * deja intacta la cookie (la pestaña que ganó la rotación ya la actualizó). Sin esto, dos pestañas renovando a la vez cerraban la sesión.
   */
  async refreshToken(token: string, soloAcceso = false) {
    if (!token) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const refreshSecret = secretoObligatorio(this.configService.get<string>('JWT_REFRESH_SECRET'), 'JWT_REFRESH_SECRET', 'EasyDryRefreshSecretKey2026*OfflineSync');

    let payload: any;
    try {
      payload = this.jwtService.verify(token, { ...JWT_VERIFY_OPTIONS, secret: refreshSecret });
    } catch (err: any) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    if (!payload || payload.type !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Tipo de token inválido para refresco');
    }

    const sesion = await this.prisma.refreshSession.findUnique({ where: { id: payload.jti } });
    if (!sesion || sesion.userId !== payload.sub) {
      throw new UnauthorizedException('Sesión no válida');
    }
    let rotadaHaceInstantes = false;
    if (sesion.revokedAt) {
      const dentroDeGracia = Date.now() - sesion.revokedAt.getTime() <= GRACIA_REUSO_MS;
      // Rotación reciente = la cadena sigue viva con una sesión sucesora. Una revocación por logout o cambio de contraseña no la deja.
      const sucesora = dentroDeGracia
        ? await this.prisma.refreshSession.findFirst({ where: { familyId: sesion.familyId, revokedAt: null }, select: { id: true } })
        : null;
      if (dentroDeGracia && sucesora && soloAcceso) {
        rotadaHaceInstantes = true;
      } else {
        // Un token ya rotado que vuelve a aparecer fuera de la ventana de gracia: se asume robo y se cierra toda la cadena.
        if (!dentroDeGracia) {
          await this.prisma.refreshSession.updateMany({
            where: { familyId: sesion.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
        throw new UnauthorizedException('Sesión no válida');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: {
          select: { id: true, namerol: true, permisos: true, acciones: true, capacidades: true, ambito: true, estado: true },
        },
        agencia: {
          select: { id: true, codigo: true, nombre: true, region: true },
        },
        region: {
          select: { id: true, codigo: true, nombre: true },
        },
        bodega: {
          select: { id: true, codigo: true, nombre: true, regionId: true, tipo: true },
        },
      },
    });

    if (!user || user.estado !== 1) {
      throw new UnauthorizedException('Sesión no válida o usuario inactivo');
    }

    if (!user.role || user.role.estado === 0) {
      throw new UnauthorizedException('El rol asignado al usuario se encuentra deshabilitado.');
    }

    let tokens: { accessToken: string; refreshToken: string };
    if (rotadaHaceInstantes) {
      tokens = { accessToken: this.emitirAccessToken(user), refreshToken: '' };
    } else {
      // Rotación: el token usado deja de valer. Si dos peticiones llegan a la vez, solo una gana la revocación.
      const revocada = await this.prisma.refreshSession.updateMany({
        where: { id: sesion.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revocada.count === 0) {
        // Otra petición acaba de rotar este mismo token (dos pestañas renovando a la vez). La web recibe solo acceso; el resto, 401.
        if (!soloAcceso) throw new UnauthorizedException('Sesión no válida');
        tokens = { accessToken: this.emitirAccessToken(user), refreshToken: '' };
      } else {
        tokens = await this.generateTokens(user, sesion.familyId);
      }
    }

    const bahiaAsignada = await this.prisma.bahiaOperador.findFirst({
      where: { operadorId: user.id, activo: true },
      include: { bahia: { select: { id: true, nombre: true } } },
      orderBy: { fechaAsignacion: 'desc' },
    });
    const rolRefresh = (user.role?.namerol || '').toUpperCase();
    const esPulidorLogin = rolRefresh.includes('PULIDOR') || rolRefresh === 'OPERADOR_SERVICIOS_ESPECIALES';

    return {
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        lastname: user.lastname,
        nombre: `${user.name} ${user.lastname}`.trim(),
        roleId: user.roleId,
        role: user.role?.namerol,
        roleCode: user.role?.namerol,
        rolNombre: user.role?.namerol,
        permisos: modulosDeRol(user.role),
        modulos: modulosDeRol(user.role),
        ...(await this.infoApp(user.role)),
        acciones: user.role?.acciones ?? null,
        /** Permisos que el backend exige (Role.capacidades) y sobre qué datos actúa el rol (Role.ambito) */
        capacidades: user.role?.capacidades ?? [],
        ambito: user.role?.ambito ?? 'AGENCIA',
        agenciaId: user.agenciaId,
        agenciasIds: user.agenciasIds,
        agencia: user.agencia,
        sucursal: user.agencia?.nombre || user.bodega?.nombre,
        sucursalNombre: user.agencia?.nombre || user.bodega?.nombre,
        regionId: user.regionId,
        region: user.region,
        regionNombre: user.region?.nombre,
        bodegaId: user.bodegaId,
        bodega: user.bodega,
        bodegaNombre: user.bodega?.nombre,
        servicioIds: Array.isArray(user.servicioIds) ? user.servicioIds : [],
        bahiaId: bahiaAsignada?.bahiaId,
        bahiaNombre: bahiaAsignada?.bahia?.nombre,
        modalidadPulidor: esPulidorLogin ? (user.agenciaId ? 'FIJO' : 'MOVIL') : undefined,
        estado: user.estado,
        avatarUrl: this.versionedAvatar(user.avatarUrl, user.updatedAt),
        avatar: this.versionedAvatar(user.avatarUrl, user.updatedAt),
      },
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        roleId: true,
        role: {
          select: { id: true, namerol: true, permisos: true, acciones: true, capacidades: true, ambito: true, estado: true },
        },
        agenciaId: true,
        agenciasIds: true,
        bodegaId: true,
        estado: true,
        agencia: {
          select: { id: true, codigo: true, nombre: true, region: true, direccion: true },
        },
        bodega: {
          select: { id: true, codigo: true, nombre: true, regionId: true, tipo: true },
        },
        regionId: true,
        region: {
          select: { id: true, codigo: true, nombre: true },
        },
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const { role, ...userWithoutRole } = user;

    return {
      ...userWithoutRole,
      nombre: `${user.name} ${user.lastname}`.trim(),
      role: role?.namerol,
      roleCode: role?.namerol,
      rolNombre: role?.namerol,
      sucursal: user.agencia?.nombre || user.bodega?.nombre,
      sucursalNombre: user.agencia?.nombre || user.bodega?.nombre,
      regionNombre: user.region?.nombre,
      bodegaId: user.bodegaId,
      bodegaNombre: user.bodega?.nombre,
      bodega: user.bodega,
      agencia: user.agencia,
      permisos: modulosDeRol(role),
      modulos: modulosDeRol(role),
      ...(await this.infoApp(role)),
      acciones: role?.acciones ?? null,
      capacidades: role?.capacidades ?? [],
      ambito: role?.ambito ?? 'AGENCIA',
      roleDetails: role,
      avatarUrl: this.versionedAvatar(user.avatarUrl, user.updatedAt),
      avatar: this.versionedAvatar(user.avatarUrl, user.updatedAt),
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    const data: { avatarUrl?: string | null; name?: string; lastname?: string; email?: string } = {};

    if (dto.avatarUrl !== undefined) {
      const avatarUrl = dto.avatarUrl.trim();
      if (!avatarUrl) {
        data.avatarUrl = null;
        await this.storageService.deleteUserProfileImages(userId);
      } else if (avatarUrl.startsWith('data:') || avatarUrl.startsWith('blob:')) {
        throw new BadRequestException('La foto de perfil debe subirse a S3. No se aceptan imágenes embebidas.');
      } else if (!this.isStoredAvatarUrl(avatarUrl)) {
        throw new BadRequestException('La URL de avatar no corresponde a un archivo de S3.');
      } else {
        data.avatarUrl = this.normalizeAvatarUrl(avatarUrl);
      }
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('El nombre no puede estar vacío.');
      data.name = name;
    }
    if (dto.lastname !== undefined) {
      data.lastname = dto.lastname.trim();
    }
    if (dto.email !== undefined) {
      const email = dto.email.trim().toLowerCase();
      if (email !== user.email) {
        const taken = await this.prisma.user.findFirst({
          where: { email, id: { not: userId } },
          select: { id: true },
        });
        if (taken) throw new BadRequestException('El correo ya está en uso.');
      }
      data.email = email;
    }

    await this.prisma.user.update({
      where: { id: userId },
      data,
    });

    return {
      success: true,
      user: await this.getMe(userId),
    };
  }

  private versionedAvatar(url?: string | null, updatedAt?: Date | null): string {
    if (!url) return '';
    const stamp = updatedAt instanceof Date && !isNaN(updatedAt.getTime()) ? updatedAt.getTime() : Date.now();
    return `${url}${url.includes('?') ? '&' : '?'}v=${stamp}`;
  }

  private isStoredAvatarUrl(value: string): boolean {
    if (value.includes('amazonaws.com/') || value.startsWith('usuarios/') || value.includes('/usuarios/')) {
      return true;
    }
    try {
      const parsed = new URL(value, 'http://localhost');
      const key = decodeURIComponent(parsed.searchParams.get('key') || '');
      return key.startsWith('usuarios/');
    } catch {
      return false;
    }
  }

  private normalizeAvatarUrl(value: string): string {
    try {
      const parsed = new URL(value, 'http://localhost');
      const key = decodeURIComponent(parsed.searchParams.get('key') || '');
      if (key.startsWith('usuarios/')) return key.split('?')[0];
    } catch {
      // keep original
    }
    return value.split('?')[0];
  }
}
