import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { secretoObligatorio } from '../../common/config/secretos.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private storageService: StorageService,
  ) {}

  private generateTokens(user: { id: string; email: string; roleId: string }) {
    const accessSecret = secretoObligatorio(this.configService.get<string>('JWT_SECRET'), 'JWT_SECRET', 'EasyDrySecretKey2026*OfflineSync');
    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '1h';

    const refreshSecret = secretoObligatorio(this.configService.get<string>('JWT_REFRESH_SECRET'), 'JWT_REFRESH_SECRET', 'EasyDryRefreshSecretKey2026*OfflineSync');
    const refreshExpiresIn = this.configService.get<string>('JWT_REFRESH_EXPIRATION') || '15d';

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
      secret: accessSecret,
      expiresIn: accessExpiresIn as any,
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn as any,
    });

    return { accessToken, refreshToken };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
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

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (user.estado !== 1) {
      throw new UnauthorizedException('Usuario deshabilitado o inactivo. Contacte a su administrador.');
    }

    if (!user.role || user.role.estado === 0) {
      throw new UnauthorizedException('El rol asignado al usuario se encuentra deshabilitado.');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { accessToken, refreshToken } = this.generateTokens(user);

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
        /** Códigos de módulos permitidos (desde Role.permisos en BD) */
        permisos: user.role?.permisos ?? [],
        modulos: user.role?.permisos ?? [],
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

  async refreshToken(token: string) {
    if (!token) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const refreshSecret = secretoObligatorio(this.configService.get<string>('JWT_REFRESH_SECRET'), 'JWT_REFRESH_SECRET', 'EasyDryRefreshSecretKey2026*OfflineSync');

    let payload: any;
    try {
      payload = this.jwtService.verify(token, { secret: refreshSecret });
    } catch (err: any) {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }

    if (!payload || payload.type !== 'refresh') {
      throw new UnauthorizedException('Tipo de token inválido para refresco');
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

    const tokens = this.generateTokens(user);

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
        permisos: user.role?.permisos ?? [],
        modulos: user.role?.permisos ?? [],
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
      permisos: role?.permisos ?? [],
      modulos: role?.permisos ?? [],
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
