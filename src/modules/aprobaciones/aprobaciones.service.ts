import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolicitarAprobacionDto, DecidirAprobacionDto, ListAprobacionesDto } from './dto/aprobaciones.dto.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';

@Injectable()
export class AprobacionesService {
  private readonly logger = new Logger(AprobacionesService.name);

  private readonly decisiones: DecisionesService;

  constructor(private readonly prisma: PrismaService, decisiones?: DecisionesService) {
    this.decisiones = decisiones ?? new DecisionesService(prisma);
  }

  async list(dto: ListAprobacionesDto, user: any) {
    const page = dto.page ? Number(dto.page) : 1;
    const pageSize = dto.pageSize ? Number(dto.pageSize) : 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    // Alcance único: país, región o agencia. Además, cada usuario ve las solicitudes que hizo él. Sin dato de ámbito no ve más que las suyas.
    const alcance = resolverAlcance(user);
    const pide = dto.agenciaId && dto.agenciaId !== 'Todas' && dto.agenciaId !== 'TODAS' ? dto.agenciaId : undefined;
    const propias = { solicitanteId: String(user?.id) };
    if (alcance.tipo === 'GLOBAL') {
      if (pide) where.agenciaId = pide;
    } else if (alcance.tipo === 'REGION') {
      where.OR = [{ agencia: { regionId: alcance.regionId }, ...(pide ? { agenciaId: pide } : {}) }, propias];
    } else if (alcance.tipo === 'AGENCIA') {
      where.OR = [{ agenciaId: alcance.agenciaId }, propias];
    } else {
      Object.assign(where, propias);
    }

    if (dto.estado) where.estado = dto.estado;
    if (dto.tipo) where.tipo = dto.tipo;

    if (dto.search) {
      where.AND = [
        { OR: [
          { titulo: { contains: dto.search, mode: 'insensitive' } },
          { descripcion: { contains: dto.search, mode: 'insensitive' } },
        ] },
      ];
    }

    const sortField = dto.sortField || 'createdAt';
    const sortOrder = dto.sortOrder || 'desc';

    const [items, total] = await Promise.all([
      this.prisma.solicitudAprobacion.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortField]: sortOrder },
        include: {
          solicitante: { select: { id: true, name: true, email: true } },
          aprobador: { select: { id: true, name: true, email: true } },
          agencia: { select: { id: true, nombre: true, codigo: true } },
        },
      }),
      this.prisma.solicitudAprobacion.count({ where }),
    ]);

    return buildDataGridResponse(items, total, page, pageSize);
  }

  async solicitar(dto: SolicitarAprobacionDto, user: any) {
    const userId = String(user.id);
    const alcance = resolverAlcance(user);
    let agenciaId: string | undefined = dto.agenciaId || undefined;
    if (alcance.tipo === 'AGENCIA') {
      // Un usuario de agencia solo solicita para la suya.
      agenciaId = alcance.agenciaId;
    } else if (agenciaId && alcance.tipo === 'REGION') {
      const agencia = await this.prisma.agencia.findUnique({ where: { id: agenciaId }, select: { regionId: true } });
      if (!agencia || agencia.regionId !== alcance.regionId) throw new ForbiddenException('Esa agencia no pertenece a tu región.');
    } else if (alcance.tipo !== 'GLOBAL' && alcance.tipo !== 'REGION') {
      throw new ForbiddenException('Tu usuario no tiene una agencia asignada para hacer solicitudes.');
    }
    const solicitud = await this.prisma.solicitudAprobacion.create({
      data: {
        tipo: dto.tipo,
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        montoUSD: dto.montoUSD !== undefined ? dto.montoUSD : undefined,
        agenciaId,
        entidadRefId: dto.entidadRefId || undefined,
        solicitanteId: userId,
        estado: 'PENDIENTE',
      },
      include: {
        solicitante: { select: { id: true, name: true, email: true } },
        agencia: { select: { id: true, nombre: true } },
      },
    });

    return {
      success: true,
      data: solicitud,
    };
  }

  /** Carga la solicitud y valida que pueda decidirla quien lo intenta (regla de aprobador designado y respaldo). */
  private async prepararDecision(dto: DecidirAprobacionDto, actor: any) {
    const solicitud = await this.prisma.solicitudAprobacion.findUnique({
      where: { id: dto.solicitudId },
      include: { agencia: { select: { id: true, regionId: true } } },
    });
    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${dto.solicitudId} no encontrada`);
    }
    if (solicitud.estado !== 'PENDIENTE') {
      throw new BadRequestException(`La solicitud ya se encuentra en estado ${solicitud.estado}`);
    }
    if (solicitud.solicitanteId === String(actor.id)) {
      throw new ForbiddenException('No puedes decidir una solicitud que hiciste tú.');
    }
    let regla;
    if (solicitud.agencia) {
      regla = await this.decisiones.reglaParaDecidir(actor, { id: solicitud.agencia.id, regionId: solicitud.agencia.regionId });
    } else if (['SUPER_ADMIN', 'ADMIN'].includes(rolDeUsuario(actor))) {
      regla = 'ADMIN' as const;
    } else {
      throw new ForbiddenException('Esta solicitud no pertenece a una agencia: solo un administrador puede decidirla.');
    }
    return { solicitud, regla };
  }

  async aprobar(dto: DecidirAprobacionDto, actor: any) {
    const { solicitud, regla } = await this.prepararDecision(dto, actor);

    const updated = await this.prisma.solicitudAprobacion.update({
      where: { id: dto.solicitudId },
      data: {
        estado: 'APROBADO',
        aprobadorId: String(actor.id),
        fechaDecision: new Date(),
        descripcion: dto.notas ? `${solicitud.descripcion || ''} [Aprobado: ${dto.notas}]` : solicitud.descripcion,
      },
      include: {
        solicitante: { select: { id: true, name: true } },
        aprobador: { select: { id: true, name: true } },
      },
    });

    await this.decisiones.registrar({
      entidad: 'SOLICITUD',
      entidadId: solicitud.id,
      accion: 'APROBAR',
      user: actor,
      regla,
      motivo: dto.notas,
      agenciaId: solicitud.agenciaId,
      detalle: { tipo: solicitud.tipo },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async rechazar(dto: DecidirAprobacionDto, actor: any) {
    const motivo = this.decisiones.exigirMotivo(dto.motivoRechazo || dto.notas, 'rechazar una solicitud');
    const { solicitud, regla } = await this.prepararDecision(dto, actor);

    const updated = await this.prisma.solicitudAprobacion.update({
      where: { id: dto.solicitudId },
      data: {
        estado: 'RECHAZADO',
        aprobadorId: String(actor.id),
        fechaDecision: new Date(),
        motivoRechazo: motivo,
      },
      include: {
        solicitante: { select: { id: true, name: true } },
        aprobador: { select: { id: true, name: true } },
      },
    });

    await this.decisiones.registrar({
      entidad: 'SOLICITUD',
      entidadId: solicitud.id,
      accion: 'RECHAZAR',
      user: actor,
      regla,
      motivo,
      agenciaId: solicitud.agenciaId,
      detalle: { tipo: solicitud.tipo },
    });

    return {
      success: true,
      data: updated,
    };
  }
}
