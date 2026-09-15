import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

export interface JwtPayload {
  sub: string;
  email: string;
  roleId?: string;
  type?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'EasyDrySecretKey2026*OfflineSync',
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Tipo de token inválido para autorización');
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
      },
    });

    if (!user || user.estado !== 1) {
      throw new UnauthorizedException('Sesión inválida o usuario inactivo');
    }

    if (!user.role || user.role.estado === 0) {
      throw new UnauthorizedException('El rol asignado al usuario se encuentra deshabilitado');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      lastname: user.lastname,
      nombre: `${user.name} ${user.lastname}`.trim(),
      roleId: user.roleId,
      role: user.role,
      permisos: user.role.permisos,
      roleDetails: user.role,
      agenciaId: user.agenciaId,
      agenciasIds: user.agenciasIds,
      agencia: user.agencia,
      regionId: user.regionId,
      region: user.region,
      estado: user.estado,
    };
  }
}
