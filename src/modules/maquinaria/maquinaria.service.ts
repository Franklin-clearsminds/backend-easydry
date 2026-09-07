import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateMaquinariaDto,
  UpdateMaquinariaDto,
  ListMaquinariaDto,
  ReportarIncidenteDto,
  ResolverIncidenteDto,
  ListIncidentesDto,
  RegistrarMantenimientoDto,
  ListMantenimientosDto,
} from './dto/maquinaria.dto.js';

@Injectable()
export class MaquinariaService {
  private readonly logger = new Logger(MaquinariaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==============================================================
  // MAQUINARIA
  // ==============================================================

  async list(dto: ListMaquinariaDto) {
    const where: any = {};

    if (dto.agenciaId) where.agenciaId = dto.agenciaId;
    if (dto.bahiaId) where.bahiaId = dto.bahiaId;
    if (dto.tipo) where.tipo = dto.tipo;
    if (dto.estadoOperativo) where.estadoOperativo = dto.estadoOperativo;

    if (dto.search) {
      where.OR = [
        { codigo: { contains: dto.search, mode: 'insensitive' } },
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { marca: { contains: dto.search, mode: 'insensitive' } },
        { modelo: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.maquinaria.findMany({
        where,
        include: {
          agencia: { select: { id: true, nombre: true, codigo: true } },
          bahia: { select: { id: true, nombre: true, codigo: true } },
          _count: {
            select: {
              incidentes: { where: { estado: { not: 'RESUELTO' } } },
              mantenimientos: true,
            },
          },
        },
        orderBy: { codigo: 'asc' },
      }),
      this.prisma.maquinaria.count({ where }),
    ]);

    return {
      success: true,
      total,
      data: items,
    };
  }

  async create(dto: CreateMaquinariaDto) {
    const existing = await this.prisma.maquinaria.findUnique({
      where: { codigo: dto.codigo },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un equipo con el código ${dto.codigo}`);
    }

    const item = await this.prisma.maquinaria.create({
      data: {
        codigo: dto.codigo,
        nombre: dto.nombre,
        tipo: dto.tipo,
        marca: dto.marca,
        modelo: dto.modelo,
        serie: dto.serie,
        estadoOperativo: dto.estadoOperativo || 'OPERATIVA',
        fotoUrl: dto.fotoUrl,
        horasUso: dto.horasUso ?? 0,
        agenciaId: dto.agenciaId || undefined,
        bahiaId: dto.bahiaId || undefined,
      },
      include: {
        agencia: { select: { id: true, nombre: true } },
        bahia: { select: { id: true, nombre: true } },
      },
    });

    return {
      success: true,
      data: item,
    };
  }

  async update(dto: UpdateMaquinariaDto) {
    const existing = await this.prisma.maquinaria.findUnique({
      where: { id: dto.id },
    });
    if (!existing) {
      throw new NotFoundException(`Equipo con id ${dto.id} no encontrado`);
    }

    const { id, ...data } = dto;
    const updated = await this.prisma.maquinaria.update({
      where: { id },
      data,
      include: {
        agencia: { select: { id: true, nombre: true } },
        bahia: { select: { id: true, nombre: true } },
      },
    });

    return {
      success: true,
      data: updated,
    };
  }

  // ==============================================================
  // INCIDENTES TÉCNICOS
  // ==============================================================

  async reportarIncidente(dto: ReportarIncidenteDto, userId: string) {
    const maquinaria = await this.prisma.maquinaria.findUnique({
      where: { id: dto.maquinariaId },
    });
    if (!maquinaria) {
      throw new NotFoundException(`Equipo ${dto.maquinariaId} no encontrado`);
    }

    const gravedad = dto.gravedad || 'MEDIA';

    // Si la gravedad es ALTA o CRITICA, se marca la máquina automáticamente como EN_MANTENIMIENTO
    if (gravedad === 'ALTA' || gravedad === 'CRITICA') {
      await this.prisma.maquinaria.update({
        where: { id: dto.maquinariaId },
        data: { estadoOperativo: 'EN_MANTENIMIENTO' },
      });
    }

    const incidente = await this.prisma.incidenteTecnico.create({
      data: {
        maquinariaId: dto.maquinariaId,
        reportadoPorId: userId,
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        gravedad,
        estado: 'ABIERTO',
        fotoEvidenciaUrl: dto.fotoEvidenciaUrl,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        reportadoPor: { select: { id: true, name: true, email: true } },
      },
    });

    return {
      success: true,
      data: incidente,
    };
  }

  async resolverIncidente(dto: ResolverIncidenteDto, userId: string) {
    const incidente = await this.prisma.incidenteTecnico.findUnique({
      where: { id: dto.incidenteId },
      include: { maquinaria: true },
    });
    if (!incidente) {
      throw new NotFoundException(`Incidente ${dto.incidenteId} no encontrado`);
    }

    const nuevoEstado = dto.estado || 'RESUELTO';

    const updated = await this.prisma.incidenteTecnico.update({
      where: { id: dto.incidenteId },
      data: {
        estado: nuevoEstado,
        solucion: dto.solucion,
        resueltoPorId: userId,
        fechaSolucion: new Date(),
      },
      include: {
        maquinaria: true,
        reportadoPor: { select: { id: true, name: true } },
        resueltoPor: { select: { id: true, name: true } },
      },
    });

    // Verificar si quedan otros incidentes abiertos de alta o crítica gravedad
    const incidentesAbiertos = await this.prisma.incidenteTecnico.count({
      where: {
        maquinariaId: incidente.maquinariaId,
        estado: { notIn: ['RESUELTO', 'CANCELADO'] },
        gravedad: { in: ['ALTA', 'CRITICA'] },
      },
    });

    if (incidentesAbiertos === 0 && incidente.maquinaria.estadoOperativo === 'EN_MANTENIMIENTO') {
      await this.prisma.maquinaria.update({
        where: { id: incidente.maquinariaId },
        data: { estadoOperativo: 'OPERATIVA' },
      });
    }

    return {
      success: true,
      data: updated,
    };
  }

  async listIncidentes(dto: ListIncidentesDto) {
    const where: any = {};

    if (dto.maquinariaId) where.maquinariaId = dto.maquinariaId;
    if (dto.estado) where.estado = dto.estado;
    if (dto.gravedad) where.gravedad = dto.gravedad;
    if (dto.agenciaId) {
      where.maquinaria = { agenciaId: dto.agenciaId };
    }

    const items = await this.prisma.incidenteTecnico.findMany({
      where,
      include: {
        maquinaria: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            tipo: true,
            agencia: { select: { id: true, nombre: true } },
          },
        },
        reportadoPor: { select: { id: true, name: true, email: true } },
        resueltoPor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      success: true,
      total: items.length,
      data: items,
    };
  }

  // ==============================================================
  // MANTENIMIENTOS TÉCNICOS
  // ==============================================================

  async registrarMantenimiento(dto: RegistrarMantenimientoDto, userId: string) {
    const maquinaria = await this.prisma.maquinaria.findUnique({
      where: { id: dto.maquinariaId },
    });
    if (!maquinaria) {
      throw new NotFoundException(`Equipo ${dto.maquinariaId} no encontrado`);
    }

    const mantenimiento = await this.prisma.mantenimientoMaquinaria.create({
      data: {
        maquinariaId: dto.maquinariaId,
        tecnicoId: userId,
        tipo: dto.tipo || 'PREVENTIVO',
        estado: 'FINALIZADO',
        observaciones: dto.observaciones,
        repuestosUsados: dto.repuestosUsados || undefined,
        costoTotal: dto.costoTotal ? dto.costoTotal : undefined,
        proximoMantenimiento: dto.proximoMantenimiento ? new Date(dto.proximoMantenimiento) : undefined,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        tecnico: { select: { id: true, name: true } },
      },
    });

    return {
      success: true,
      data: mantenimiento,
    };
  }

  async listMantenimientos(dto: ListMantenimientosDto) {
    const where: any = {};
    if (dto.maquinariaId) where.maquinariaId = dto.maquinariaId;
    if (dto.tecnicoId) where.tecnicoId = dto.tecnicoId;
    if (dto.tipo) where.tipo = dto.tipo;

    const items = await this.prisma.mantenimientoMaquinaria.findMany({
      where,
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true, tipo: true } },
        tecnico: { select: { id: true, name: true } },
      },
      orderBy: { fechaMantenimiento: 'desc' },
      take: 200,
    });

    return {
      success: true,
      total: items.length,
      data: items,
    };
  }
}
