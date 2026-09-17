import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  private generateTokens(user: { id: string; email: string; roleId: string }) {
    const accessSecret = this.configService.get<string>('JWT_SECRET') || 'EasyDrySecretKey2026*OfflineSync';
    const accessExpiresIn = this.configService.get<string>('JWT_ACCESS_EXPIRATION') || '1h';

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'EasyDryRefreshSecretKey2026*OfflineSync';
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
          select: { id: true, namerol: true, permisos: true, acciones: true, estado: true },
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
        estado: user.estado,
      },
    };
  }

  async refreshToken(token: string) {
    if (!token) {
      throw new UnauthorizedException('Refresh token requerido');
    }

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'EasyDryRefreshSecretKey2026*OfflineSync';

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
          select: { id: true, namerol: true, permisos: true, acciones: true, estado: true },
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

    // Rotación de tokens: nuevo accessToken y nuevo refreshToken
    const tokens = this.generateTokens(user);

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
        estado: user.estado,
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
          select: { id: true, namerol: true, permisos: true, acciones: true, estado: true },
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
        createdAt: true,
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
      roleDetails: role,
    };
  }
}
