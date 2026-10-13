import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { secretoObligatorio } from '../../common/config/secretos.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { modulosDeRol } from '../../common/permisos/modulos-navegacion.js';
import { JWT_VERIFY_OPTIONS } from './jwt.config.js';

export interface JwtPayload {
  sub: string;
  email: string;
  roleId?: string;
  type?: string;
  /** Segundos desde epoch en que se emitió el token */
  iat?: number;
}

/** ¿Se emitió el token antes de la última revocación de sesiones del usuario? (`iat` va en segundos: se compara sin fracciones). */
export function tokenRevocado(iat: number | undefined, revocadasAt: Date | null | undefined): boolean {
  if (!revocadasAt) return false;
  if (typeof iat !== 'number') return true;
  return iat < Math.floor(revocadasAt.getTime() / 1000);
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
      ...JWT_VERIFY_OPTIONS,
      secretOrKey: secretoObligatorio(configService.get<string>('JWT_SECRET'), 'JWT_SECRET', 'EasyDrySecretKey2026*OfflineSync'),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Tipo de token inválido para autorización');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: {
          select: { id: true, namerol: true, permisos: true, acciones: true, capacidades: true, ambito: true, esSistema: true, estado: true },
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
      throw new UnauthorizedException('Sesión inválida o usuario inactivo');
    }

    if (!user.role || user.role.estado === 0) {
      throw new UnauthorizedException('El rol asignado al usuario se encuentra deshabilitado');
    }

    // Cambió la contraseña después de emitir este token: ya no vale aunque no haya vencido.
    if (tokenRevocado(payload.iat, user.sesionesRevocadasAt)) {
      throw new UnauthorizedException('Sesión cerrada. Inicie sesión nuevamente');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      lastname: user.lastname,
      nombre: `${user.name} ${user.lastname}`.trim(),
      roleId: user.roleId,
      role: user.role,
      permisos: modulosDeRol(user.role),
      roleDetails: user.role,
      agenciaId: user.agenciaId,
      agenciasIds: user.agenciasIds,
      agencia: user.agencia,
      regionId: user.regionId,
      region: user.region,
      bodegaId: user.bodegaId,
      bodega: user.bodega,
      estado: user.estado,
    };
  }
}
