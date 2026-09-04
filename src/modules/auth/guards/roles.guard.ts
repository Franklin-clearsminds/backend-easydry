import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    const userRoleNamerol = user?.roleDetails?.namerol;
    const userRoleId = user?.roleId;

    if (!user || (!userRoleNamerol && !userRoleId)) {
      throw new ForbiddenException('Acceso denegado: Usuario sin rol asignado.');
    }

    // SUPER_ADMIN tiene acceso universal
    if (userRoleNamerol === 'SUPER_ADMIN') {
      return true;
    }

    const hasRole =
      (userRoleNamerol && requiredRoles.includes(userRoleNamerol)) ||
      (userRoleId && requiredRoles.includes(userRoleId));

    if (!hasRole) {
      throw new ForbiddenException(`Acceso denegado: Se requiere uno de los roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
