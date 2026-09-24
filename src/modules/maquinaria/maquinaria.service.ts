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
  EjecutarMantenimientoDto,
  ListMantenimientosDto,
  AsignarIncidenteDto,
  AsignarMantenimientoDto,
  TransferirMaquinariaDto,
  ListMovimientosMaquinariaDto,
} from './dto/maquinaria.dto.js';

@Injectable()
export class MaquinariaService {
  private readonly logger = new Logger(MaquinariaService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==============================================================
  // MAQUINARIA
  // ==============================================================

  private async ensureFichaTecnicaColumn(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "Maquinaria" ADD COLUMN IF NOT EXISTS "fichaTecnicaUrl" TEXT`,
      );
    } catch (_) {}
  }

  private async persistFichaTecnicaUrl(id: string, fichaTecnicaUrl?: string | null): Promise<void> {
    if (fichaTecnicaUrl === undefined) return;
    await this.prisma.$executeRaw`
      UPDATE "Maquinaria" SET "fichaTecnicaUrl" = ${fichaTecnicaUrl} WHERE "id" = ${id}
    `;
  }

  private async attachFichaTecnicaUrls<T extends { id: string; fichaTecnicaUrl?: string | null }>(items: T[]): Promise<T[]> {
    if (!items.length) return items;
    if (Object.prototype.hasOwnProperty.call(items[0], 'fichaTecnicaUrl')) return items;
    try {
      const rows = await this.prisma.$queryRaw<{ id: string; fichaTecnicaUrl: string | null }[]>`
        SELECT "id", "fichaTecnicaUrl" FROM "Maquinaria"
      `;
      const map = new Map(rows.map(row => [row.id, row.fichaTecnicaUrl]));
      for (const item of items) {
        item.fichaTecnicaUrl = map.get(item.id) || null;
      }
    } catch (_) {}
    return items;
  }

  async list(dto: ListMaquinariaDto) {
    await this.ensureFichaTecnicaColumn();
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
    await this.attachFichaTecnicaUrls(items);

    return {
      success: true,
      total,
      data: items,
    };
  }

  async create(dto: CreateMaquinariaDto) {
    await this.ensureFichaTecnicaColumn();
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
    await this.persistFichaTecnicaUrl(item.id, dto.fichaTecnicaUrl);
    (item as { fichaTecnicaUrl?: string }).fichaTecnicaUrl = dto.fichaTecnicaUrl;

    return {
      success: true,
      data: item,
    };
  }

  async update(dto: UpdateMaquinariaDto) {
    await this.ensureFichaTecnicaColumn();
    const existing = await this.prisma.maquinaria.findUnique({
      where: { id: dto.id },
    });
    if (!existing) {
      throw new NotFoundException(`Equipo con id ${dto.id} no encontrado`);
    }

    const { id, fichaTecnicaUrl, ...data } = dto;
    const updated = await this.prisma.maquinaria.update({
      where: { id },
      data,
      include: {
        agencia: { select: { id: true, nombre: true } },
        bahia: { select: { id: true, nombre: true } },
      },
    });
    await this.persistFichaTecnicaUrl(id, fichaTecnicaUrl);
    (updated as { fichaTecnicaUrl?: string }).fichaTecnicaUrl =
      fichaTecnicaUrl !== undefined ? fichaTecnicaUrl : (updated as { fichaTecnicaUrl?: string }).fichaTecnicaUrl;
    if (fichaTecnicaUrl === undefined) {
      await this.attachFichaTecnicaUrls([updated as { id: string; fichaTecnicaUrl?: string | null }]);
    }

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

    const evidencias = Array.isArray(dto.evidencias)
      ? dto.evidencias.filter((e) => e?.url).map((e) => ({
          tipo: e.tipo || 'FOTO_INCIDENTE',
          url: e.url,
          descripcion: e.descripcion || null,
        }))
      : [];
    if (dto.fotoEvidenciaUrl && !evidencias.some((e) => e.url === dto.fotoEvidenciaUrl)) {
      evidencias.unshift({ tipo: 'FOTO_INCIDENTE', url: dto.fotoEvidenciaUrl, descripcion: null });
    }

    const incidente = await this.prisma.incidenteTecnico.create({
      data: {
        maquinariaId: dto.maquinariaId,
        reportadoPorId: userId,
        titulo: dto.titulo,
        descripcion: dto.descripcion,
        gravedad,
        estado: 'ABIERTO',
        fotoEvidenciaUrl: dto.fotoEvidenciaUrl || evidencias[0]?.url,
        destinoTallerId: dto.destinoTallerId || undefined,
        evidencias: evidencias.length ? { create: evidencias } : undefined,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        reportadoPor: { select: { id: true, name: true, email: true } },
        evidencias: true,
        destinoTaller: { select: { id: true, nombre: true, tipoUbicacion: true } },
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
    const evidenciasCierre = Array.isArray(dto.evidencias)
      ? dto.evidencias.filter((e) => e?.url).map((e) => ({
          tipo: e.tipo || 'DOCUMENTO_INCIDENTE',
          url: e.url,
          descripcion: e.descripcion || dto.repuestosUtilizados || null,
        }))
      : [];

    const updated = await this.prisma.incidenteTecnico.update({
      where: { id: dto.incidenteId },
      data: {
        estado: nuevoEstado,
        solucion: dto.repuestosUtilizados
          ? `${dto.solucion}\nRepuestos: ${dto.repuestosUtilizados}`
          : dto.solucion,
        resueltoPorId: userId,
        fechaSolucion: new Date(),
        evidencias: evidenciasCierre.length ? { create: evidenciasCierre } : undefined,
      },
      include: {
        maquinaria: true,
        reportadoPor: { select: { id: true, name: true } },
        resueltoPor: { select: { id: true, name: true } },
        evidencias: true,
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
        tecnicoAsignado: { select: { id: true, name: true, lastname: true, email: true } },
        destinoTaller: { select: { id: true, nombre: true, tipoUbicacion: true } },
        evidencias: true,
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

  private async ensureFrecuenciaMantenimientoColumn(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "MantenimientoMaquinaria" ADD COLUMN IF NOT EXISTS "frecuenciaDias" INTEGER`,
      );
    } catch (_) {}
  }

  private addDays(base: Date, days: number): Date {
    const next = new Date(base);
    next.setDate(next.getDate() + days);
    return next;
  }

  private async persistFrecuenciaDias(id: string, frecuenciaDias?: number | null): Promise<void> {
    if (frecuenciaDias === undefined) return;
    await this.prisma.$executeRaw`
      UPDATE "MantenimientoMaquinaria" SET "frecuenciaDias" = ${frecuenciaDias} WHERE "id" = ${id}
    `;
  }

  async registrarMantenimiento(dto: RegistrarMantenimientoDto, userId: string) {
    await this.ensureFrecuenciaMantenimientoColumn();
    const maquinaria = await this.prisma.maquinaria.findUnique({
      where: { id: dto.maquinariaId },
    });
    if (!maquinaria) {
      throw new NotFoundException(`Equipo ${dto.maquinariaId} no encontrado`);
    }

    const evidenciasMant = Array.isArray(dto.evidencias)
      ? dto.evidencias.filter((e) => e?.url).map((e) => ({
          tipo: e.tipo || 'DOCUMENTO',
          url: e.url,
          descripcion: e.descripcion || null,
        }))
      : [];

    const fechaProgramada = dto.fechaProgramada ? new Date(dto.fechaProgramada) : new Date();
    const frecuenciaDias = dto.frecuenciaDias != null ? Number(dto.frecuenciaDias) : 0;
    const proximo = dto.proximoMantenimiento
      ? new Date(dto.proximoMantenimiento)
      : frecuenciaDias > 0
        ? this.addDays(fechaProgramada, frecuenciaDias)
        : undefined;

    const mantenimiento = await this.prisma.mantenimientoMaquinaria.create({
      data: {
        maquinariaId: dto.maquinariaId,
        tecnicoId: dto.tecnicoId || userId,
        tipo: dto.tipo || 'PREVENTIVO',
        estado: 'PENDIENTE',
        observaciones: dto.observaciones,
        repuestosUsados: dto.repuestosUsados || undefined,
        costoTotal: dto.costoTotal ? dto.costoTotal : undefined,
        fechaMantenimiento: fechaProgramada,
        proximoMantenimiento: proximo,
        evidencias: evidenciasMant.length ? { create: evidenciasMant } : undefined,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true, agencia: { select: { id: true, nombre: true } } } },
        tecnico: { select: { id: true, name: true, lastname: true } },
        evidencias: true,
      },
    });
    await this.persistFrecuenciaDias(mantenimiento.id, frecuenciaDias);
    (mantenimiento as { frecuenciaDias?: number }).frecuenciaDias = frecuenciaDias;

    return {
      success: true,
      data: mantenimiento,
    };
  }

  async ejecutarMantenimiento(dto: EjecutarMantenimientoDto, userId: string) {
    await this.ensureFrecuenciaMantenimientoColumn();
    const existing = await this.prisma.mantenimientoMaquinaria.findUnique({
      where: { id: dto.mantenimientoId },
    });
    if (!existing) {
      throw new NotFoundException(`Mantenimiento ${dto.mantenimientoId} no encontrado`);
    }

    const evidencias = Array.isArray(dto.evidencias)
      ? dto.evidencias.filter((e) => e?.url).map((e) => ({
          tipo: String(e.tipo || 'FOTO').toUpperCase(),
          url: e.url,
          descripcion: e.descripcion || null,
        }))
      : [];
    const tieneImagen = evidencias.some((e) =>
      e.tipo.includes('FOTO') || e.tipo.includes('IMAGEN') || e.tipo === 'IMAGE',
    );
    if (!tieneImagen) {
      throw new BadRequestException('Para ejecutar el mantenimiento debes adjuntar al menos una imagen.');
    }

    const fechaFin = dto.fechaFin ? new Date(dto.fechaFin) : new Date();
    let frecuenciaDias = Number((existing as { frecuenciaDias?: number }).frecuenciaDias || 0);
    if (!frecuenciaDias) {
      try {
        const rows = await this.prisma.$queryRaw<{ frecuenciaDias: number | null }[]>`
          SELECT "frecuenciaDias" FROM "MantenimientoMaquinaria" WHERE "id" = ${dto.mantenimientoId}
        `;
        frecuenciaDias = Number(rows[0]?.frecuenciaDias || 0);
      } catch (_) {}
    }
    const proximo = frecuenciaDias > 0 ? this.addDays(fechaFin, frecuenciaDias) : existing.proximoMantenimiento;

    const updated = await this.prisma.mantenimientoMaquinaria.update({
      where: { id: dto.mantenimientoId },
      data: {
        estado: 'FINALIZADO',
        observaciones: dto.observaciones || existing.observaciones,
        fechaMantenimiento: fechaFin,
        proximoMantenimiento: proximo || undefined,
        evidencias: evidencias.length ? { create: evidencias } : undefined,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true, agencia: { select: { id: true, nombre: true } } } },
        tecnico: { select: { id: true, name: true, lastname: true } },
        evidencias: true,
      },
    });

    if (frecuenciaDias > 0 && proximo) {
      const siguiente = await this.prisma.mantenimientoMaquinaria.create({
        data: {
          maquinariaId: existing.maquinariaId,
          tecnicoId: existing.tecnicoId || userId,
          tipo: existing.tipo,
          estado: 'PENDIENTE',
          observaciones: existing.observaciones,
          fechaMantenimiento: proximo,
          proximoMantenimiento: this.addDays(proximo, frecuenciaDias),
        },
      });
      await this.persistFrecuenciaDias(siguiente.id, frecuenciaDias);
    }

    (updated as { frecuenciaDias?: number }).frecuenciaDias = frecuenciaDias;
    return { success: true, data: updated };
  }

  async listMantenimientos(dto: ListMantenimientosDto) {
    await this.ensureFrecuenciaMantenimientoColumn();
    const where: any = {};
    if (dto.maquinariaId) where.maquinariaId = dto.maquinariaId;
    if (dto.tecnicoId) where.tecnicoId = dto.tecnicoId;
    if (dto.tipo) where.tipo = dto.tipo;

    const items = await this.prisma.mantenimientoMaquinaria.findMany({
      where,
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true, tipo: true, agencia: { select: { id: true, nombre: true } } } },
        tecnico: { select: { id: true, name: true, lastname: true } },
        evidencias: true,
      },
      orderBy: { fechaMantenimiento: 'desc' },
      take: 200,
    });

    if (items.length && !Object.prototype.hasOwnProperty.call(items[0], 'frecuenciaDias')) {
      try {
        const rows = await this.prisma.$queryRaw<{ id: string; frecuenciaDias: number | null }[]>`
          SELECT "id", "frecuenciaDias" FROM "MantenimientoMaquinaria"
        `;
        const map = new Map(rows.map(row => [row.id, row.frecuenciaDias]));
        for (const item of items) {
          (item as { frecuenciaDias?: number | null }).frecuenciaDias = map.get(item.id) ?? 0;
        }
      } catch (_) {}
    }

    return {
      success: true,
      total: items.length,
      data: items,
    };
  }

  async asignarIncidente(dto: AsignarIncidenteDto, userId: string) {
    const incidente = await this.prisma.incidenteTecnico.findUnique({
      where: { id: dto.incidenteId },
    });
    if (!incidente) {
      throw new NotFoundException(`Incidente ${dto.incidenteId} no encontrado`);
    }

    const tecnicoId = dto.tecnicoId || userId;
    if (dto.destinoTallerId) {
      const taller = await this.prisma.agencia.findUnique({ where: { id: dto.destinoTallerId } });
      if (!taller) throw new NotFoundException('Taller destino no encontrado');
    }

    const updated = await this.prisma.incidenteTecnico.update({
      where: { id: dto.incidenteId },
      data: {
        tecnicoAsignadoId: tecnicoId,
        fechaAsignacion: new Date(),
        estado: incidente.estado === 'ABIERTO' ? 'EN_PROCESO' : incidente.estado,
        destinoTallerId: dto.destinoTallerId || incidente.destinoTallerId,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        tecnicoAsignado: { select: { id: true, name: true, lastname: true } },
        destinoTaller: { select: { id: true, nombre: true, tipoUbicacion: true } },
      },
    });

    return { success: true, data: updated };
  }

  async asignarMantenimiento(dto: AsignarMantenimientoDto, userId: string) {
    const mantenimiento = await this.prisma.mantenimientoMaquinaria.findUnique({
      where: { id: dto.mantenimientoId },
    });
    if (!mantenimiento) {
      throw new NotFoundException(`Mantenimiento ${dto.mantenimientoId} no encontrado`);
    }

    const updated = await this.prisma.mantenimientoMaquinaria.update({
      where: { id: dto.mantenimientoId },
      data: {
        tecnicoId: dto.tecnicoId || userId,
        estado: mantenimiento.estado === 'PENDIENTE' ? 'EN_PROCESO' : mantenimiento.estado,
      },
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        tecnico: { select: { id: true, name: true, lastname: true } },
      },
    });

    return { success: true, data: updated };
  }

  async transferirMaquinaria(dto: TransferirMaquinariaDto, userId: string) {
    const maquina = await this.prisma.maquinaria.findUnique({
      where: { id: dto.maquinariaId },
      include: { agencia: { select: { id: true, nombre: true } }, bahia: { select: { id: true, nombre: true } } },
    });
    if (!maquina) {
      throw new NotFoundException(`Equipo ${dto.maquinariaId} no encontrado`);
    }

    const destino = await this.prisma.agencia.findUnique({
      where: { id: dto.destinoAgenciaId },
      select: { id: true, nombre: true, tipoUbicacion: true },
    });
    if (!destino) throw new NotFoundException('Agencia o taller destino no encontrado');

    if (dto.destinoBahiaId) {
      const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.destinoBahiaId } });
      if (!bahia || bahia.agenciaId !== dto.destinoAgenciaId) {
        throw new BadRequestException('La bahía no pertenece al destino indicado.');
      }
    }

    const movimiento = await this.prisma.movimientoMaquinaria.create({
      data: {
        maquinariaId: dto.maquinariaId,
        origenAgenciaId: maquina.agenciaId,
        destinoAgenciaId: dto.destinoAgenciaId,
        origenBahiaId: maquina.bahiaId,
        destinoBahiaId: dto.destinoBahiaId || null,
        motivo: dto.motivo,
        usuarioId: userId,
      },
    });

    const updated = await this.prisma.maquinaria.update({
      where: { id: dto.maquinariaId },
      data: {
        agenciaId: dto.destinoAgenciaId,
        bahiaId: dto.destinoBahiaId || null,
      },
      include: {
        agencia: { select: { id: true, nombre: true, tipoUbicacion: true } },
        bahia: { select: { id: true, nombre: true } },
      },
    });

    return { success: true, data: { maquinaria: updated, movimiento } };
  }

  async listMovimientos(dto: ListMovimientosMaquinariaDto) {
    const where: { maquinariaId?: string } = {};
    if (dto.maquinariaId) where.maquinariaId = dto.maquinariaId;

    const items = await this.prisma.movimientoMaquinaria.findMany({
      where,
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        origenAgencia: { select: { id: true, nombre: true, tipoUbicacion: true } },
        destinoAgencia: { select: { id: true, nombre: true, tipoUbicacion: true } },
        usuario: { select: { id: true, name: true, lastname: true } },
      },
      orderBy: { fecha: 'desc' },
      take: 200,
    });

    return { success: true, total: items.length, data: items };
  }

  async listTalleres() {
    const items = await this.prisma.agencia.findMany({
      where: { tipoUbicacion: { in: ['TALLER_NACIONAL', 'TALLER_REGIONAL'] }, estado: 1 },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        tipoUbicacion: true,
        region: true,
        regionId: true,
      },
      orderBy: [{ tipoUbicacion: 'asc' }, { nombre: 'asc' }],
    });
    return { success: true, data: items };
  }
}
