import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SolicitarAprobacionDto, DecidirAprobacionDto, ListAprobacionesDto } from './dto/aprobaciones.dto.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';

@Injectable()
export class AprobacionesService {
  private readonly logger = new Logger(AprobacionesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListAprobacionesDto, user: any) {
    const page = dto.page ? Number(dto.page) : 1;
    const pageSize = dto.pageSize ? Number(dto.pageSize) : 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};

    // Scoping por rol:
    const userRole = (user?.role?.namerol || user?.roleDetails?.namerol || user?.role || '').toUpperCase();
    const isSuperAdminOrAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
    const isSupervisor = userRole === 'SUPERVISOR' || userRole === 'GERENTE_REGIONAL' || userRole.includes('SUPERVISOR') || userRole.includes('REGIONAL');
    const isAprobador = userRole === 'APROBADOR' || userRole === 'LIDER_AGENCIA' || userRole === 'LIDER' || userRole === 'GERENTE';

    if (isSuperAdminOrAdmin) {
      if (dto.agenciaId && dto.agenciaId !== 'Todas' && dto.agenciaId !== 'TODAS') {
        where.agenciaId = dto.agenciaId;
      }
    } else if (isSupervisor) {
      if (user?.regionId) {
        where.agencia = { regionId: user.regionId };
      }
      if (dto.agenciaId && dto.agenciaId !== 'Todas' && dto.agenciaId !== 'TODAS') {
        where.agenciaId = dto.agenciaId;
      }
    } else if (isAprobador) {
      if (user?.agenciaId) {
        where.agenciaId = user.agenciaId;
      }
    } else if (dto.agenciaId && dto.agenciaId !== 'Todas' && dto.agenciaId !== 'TODAS') {
      where.agenciaId = dto.agenciaId;
    }

    if (dto.estado) where.estado = dto.estado;
    if (dto.tipo) where.tipo = dto.tipo;

    if (dto.search) {
      where.OR = [
        { titulo: { contains: dto.search, mode: 'insensitive' } },
        { descripcion: { contains: dto.search, mode: 'insensitive' } },
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

  async solicitar(dto: SolicitarAprobacionDto, userId: string) {
    const solicitud = await this.prisma.solicitudAprobacion.create({
      data: {
        tipo: dto.tipo,
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        montoUSD: dto.montoUSD !== undefined ? dto.montoUSD : undefined,
        agenciaId: dto.agenciaId || undefined,
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

  async aprobar(dto: DecidirAprobacionDto, userId: string) {
    const solicitud = await this.prisma.solicitudAprobacion.findUnique({
      where: { id: dto.solicitudId },
    });

    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${dto.solicitudId} no encontrada`);
    }

    if (solicitud.estado !== 'PENDIENTE') {
      throw new BadRequestException(`La solicitud ya se encuentra en estado ${solicitud.estado}`);
    }

    const updated = await this.prisma.solicitudAprobacion.update({
      where: { id: dto.solicitudId },
      data: {
        estado: 'APROBADO',
        aprobadorId: userId,
        fechaDecision: new Date(),
        descripcion: dto.notas ? `${solicitud.descripcion || ''} [Aprobado: ${dto.notas}]` : solicitud.descripcion,
      },
      include: {
        solicitante: { select: { id: true, name: true } },
        aprobador: { select: { id: true, name: true } },
      },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async rechazar(dto: DecidirAprobacionDto, userId: string) {
    const solicitud = await this.prisma.solicitudAprobacion.findUnique({
      where: { id: dto.solicitudId },
    });

    if (!solicitud) {
      throw new NotFoundException(`Solicitud ${dto.solicitudId} no encontrada`);
    }

    if (solicitud.estado !== 'PENDIENTE') {
      throw new BadRequestException(`La solicitud ya se encuentra en estado ${solicitud.estado}`);
    }

    const updated = await this.prisma.solicitudAprobacion.update({
      where: { id: dto.solicitudId },
      data: {
        estado: 'RECHAZADO',
        aprobadorId: userId,
        fechaDecision: new Date(),
        motivoRechazo: dto.motivoRechazo || dto.notas || 'Rechazado sin motivo detallado',
      },
      include: {
        solicitante: { select: { id: true, name: true } },
        aprobador: { select: { id: true, name: true } },
      },
    });

    return {
      success: true,
      data: updated,
    };
  }
}
