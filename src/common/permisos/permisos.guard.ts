import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { PERMISO_KEY, PUBLICO_KEY, SOLO_AUTENTICADO_KEY } from './permisos.decorators.js';
import { tieneAlgunPermiso } from './capacidades.js';

const jwt = AuthGuard('jwt');

/**
 * Guard global: valida la sesión (JWT) y exige el permiso que declara cada endpoint con `@Permiso(...)`.
 * Falla cerrado: un endpoint sin `@Permiso`, `@SoloAutenticado` ni `@Publico` se rechaza.
 */
@Injectable()
export class PermisosGuard extends jwt implements CanActivate {
  private readonly logger = new Logger(PermisosGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const destinos = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO_KEY, destinos)) return true;

    await super.canActivate(context);
    const user = context.switchToHttp().getRequest().user;

    if (this.reflector.getAllAndOverride<boolean>(SOLO_AUTENTICADO_KEY, destinos)) return true;

    const codigos = this.reflector.getAllAndOverride<string[]>(PERMISO_KEY, destinos);
    if (!codigos?.length) {
      const req = context.switchToHttp().getRequest();
      this.logger.error(`Endpoint sin permiso declarado: ${req.method} ${req.url}`);
      throw new ForbiddenException('Este recurso no tiene un permiso configurado.');
    }
    if (!tieneAlgunPermiso(user, codigos)) {
      throw new ForbiddenException('Tu rol no tiene permiso para esta acción.');
    }
    return true;
  }
}
