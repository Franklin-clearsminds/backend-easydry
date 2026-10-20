import { BadRequestException, ForbiddenException, Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service.js';
import { esLiderDeAgencia, rolDeUsuario } from './alias-roles.js';
import { resolverAlcance, puedeSobreAgencia } from './alcance.js';

export type ReglaDecision = 'TITULAR' | 'RESPALDO' | 'ADMIN';
/** Lo que queda en el registro: las reglas de decisión más «PERMISO» (la acción la hizo quien tiene la casilla, sin regla de aprobador). */
export type ReglaRegistro = ReglaDecision | 'PERMISO';
export type AccionDecision = 'APROBAR' | 'RECHAZAR' | 'ANULAR' | 'EDITAR_APROBADO' | 'CAMBIAR_SERVICIO' | 'REINTENTAR' | 'RESOLVER';
export type EntidadDecision = 'SERVICIO_LAVADO' | 'SERVICIO_ESPECIAL' | 'SOLICITUD' | 'SYNC_DLQ';

export interface AgenciaRef {
  id: string;
  regionId?: string | null;
}

const ROLES_ADMIN = ['SUPER_ADMIN', 'ADMIN'];
const MOTIVO_MIN = 5;

/**
 * Reglas de quién puede decidir sobre un servicio (aprobar, rechazar, anular) y registro de la decisión.
 *
 *  - Aprobar / rechazar: el APROBADOR de la agencia. Solo si la agencia NO tiene aprobador designado (usuario activo con rol
 *    APROBADOR asignado a ella) deciden, como respaldo, ADMIN y SUPER_ADMIN (cualquier agencia) y el SUPERVISOR (su región).
 *  - Anular: antes de la aprobación, el LIDER y el APROBADOR de la agencia y los administradores; ya aprobado, solo los
 *    administradores. Siempre con motivo.
 */
@Injectable()
export class DecisionesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Usuario activo con rol APROBADOR asignado a esa agencia. */
  async tieneAprobadorDesignado(agenciaId: string): Promise<boolean> {
    const n = await this.prisma.user.count({
      where: { agenciaId, estado: 1, role: { namerol: { in: ['APROBADOR'] }, estado: 1 } },
    });
    return n > 0;
  }

  /** De estas agencias, las que tienen un aprobador designado (una sola consulta). */
  async agenciasConAprobador(agenciaIds: string[]): Promise<Set<string>> {
    const ids = Array.from(new Set(agenciaIds.filter(Boolean)));
    if (!ids.length) return new Set();
    const filas = await this.prisma.user.findMany({
      where: { agenciaId: { in: ids }, estado: 1, role: { namerol: { in: ['APROBADOR'] }, estado: 1 } },
      select: { agenciaId: true },
    });
    return new Set(filas.map((f) => String(f.agenciaId)));
  }

  /**
   * Versión sin consultas de `reglaParaDecidir`, para marcar en un listado qué puede decidir el usuario:
   * el aprobador en su agencia; administradores y supervisor (su región) solo si la agencia no tiene aprobador.
   */
  puedeDecidirAhora(user: any, agencia: AgenciaRef, agenciaTieneAprobador: boolean): boolean {
    const rol = rolDeUsuario(user);
    if (rol === 'APROBADOR') return !!user?.agenciaId && user.agenciaId === agencia.id;
    if (agenciaTieneAprobador) return false;
    if (ROLES_ADMIN.includes(rol)) return true;
    return rol === 'SUPERVISOR' && puedeSobreAgencia(resolverAlcance(user), agencia);
  }

  /** Devuelve con qué regla puede decidir el usuario, o lanza 403 explicando por qué no puede. */
  async reglaParaDecidir(user: any, agencia: AgenciaRef): Promise<ReglaDecision> {
    const rol = rolDeUsuario(user);
    if (rol === 'APROBADOR') {
      if (user?.agenciaId && user.agenciaId === agencia.id) return 'TITULAR';
      throw new ForbiddenException('Solo puedes aprobar o rechazar servicios de tu agencia.');
    }

    const esAdmin = ROLES_ADMIN.includes(rol);
    const esSupervisor = rol === 'SUPERVISOR';
    if (!esAdmin && !esSupervisor) {
      throw new ForbiddenException('Tu rol no puede aprobar ni rechazar servicios.');
    }
    if (esSupervisor && !puedeSobreAgencia(resolverAlcance(user), agencia)) {
      throw new ForbiddenException('Esa agencia no pertenece a tu región.');
    }
    if (await this.tieneAprobadorDesignado(agencia.id)) {
      throw new ForbiddenException('Esta agencia tiene un aprobador designado: solo él puede aprobar o rechazar sus servicios.');
    }
    return 'RESPALDO';
  }

  /** Quién puede anular un servicio y con qué regla. `aprobado`: el servicio ya fue aprobado. */
  reglaParaAnular(user: any, agencia: AgenciaRef, aprobado: boolean): ReglaDecision {
    const rol = rolDeUsuario(user);
    if (ROLES_ADMIN.includes(rol)) return 'ADMIN';
    if (aprobado) {
      throw new ForbiddenException('Un servicio aprobado solo lo puede anular un administrador.');
    }
    if (esLiderDeAgencia(rol) || rol === 'APROBADOR') {
      if (user?.agenciaId && user.agenciaId === agencia.id) return 'TITULAR';
      throw new ForbiddenException('Solo puedes anular servicios de tu agencia.');
    }
    throw new ForbiddenException('Tu rol no puede anular servicios.');
  }

  /** Motivo obligatorio (mínimo unas palabras) para anular o corregir. */
  exigirMotivo(motivo: string | undefined | null, accion = 'esta acción'): string {
    const limpio = String(motivo ?? '').trim();
    if (limpio.length < MOTIVO_MIN) {
      throw new BadRequestException(`El motivo es obligatorio para ${accion} (mínimo ${MOTIVO_MIN} caracteres).`);
    }
    return limpio;
  }

  /** Un registro por cada entidad decidida en bloque (por ejemplo, el cierre masivo del día). */
  async registrarLote(datos: {
    entidad: EntidadDecision;
    entidadIds: string[];
    accion: AccionDecision;
    user: any;
    regla: ReglaDecision;
    motivo?: string | null;
    agenciaId?: string | null;
  }): Promise<void> {
    if (!datos.entidadIds.length) return;
    const nombre = [datos.user?.name, datos.user?.lastname].filter(Boolean).join(' ').trim() || datos.user?.email || 'Usuario';
    await this.prisma.auditoriaDecision.createMany({
      data: datos.entidadIds.map((entidadId) => ({
        entidad: datos.entidad,
        entidadId,
        accion: datos.accion,
        usuarioId: String(datos.user?.id),
        usuarioNombre: nombre,
        rol: rolDeUsuario(datos.user),
        regla: datos.regla,
        motivo: datos.motivo?.trim() || null,
        agenciaId: datos.agenciaId ?? null,
      })),
    });
  }

  async registrar(datos: {
    entidad: EntidadDecision;
    entidadId: string;
    accion: AccionDecision;
    user: any;
    regla: ReglaRegistro;
    motivo?: string | null;
    agenciaId?: string | null;
    detalle?: Record<string, unknown>;
  }): Promise<void> {
    const nombre = [datos.user?.name, datos.user?.lastname].filter(Boolean).join(' ').trim() || datos.user?.email || 'Usuario';
    await this.prisma.auditoriaDecision.create({
      data: {
        entidad: datos.entidad,
        entidadId: datos.entidadId,
        accion: datos.accion,
        usuarioId: String(datos.user?.id),
        usuarioNombre: nombre,
        rol: rolDeUsuario(datos.user),
        regla: datos.regla,
        motivo: datos.motivo?.trim() || null,
        agenciaId: datos.agenciaId ?? null,
        detalle: (datos.detalle ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}

@Global()
@Module({ providers: [DecisionesService], exports: [DecisionesService] })
export class PermisosModule {}
