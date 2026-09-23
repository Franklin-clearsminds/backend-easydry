import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRetoDto, ListRetosDto } from './dto/retos.dto.js';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'ADMINISTRADOR']);
const CREATE_ROLES = new Set([...ADMIN_ROLES, 'GERENTE']);

@Injectable()
export class RetosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListRetosDto, user: any) {
    const role = this.roleCode(user);
    const where: any = {};

    if (dto.soloActivos !== false && !dto.incluirTodos) {
      where.estado = 'ACTIVO';
    }

    if (!ADMIN_ROLES.has(role)) {
      const visibility: any[] = [
        { AND: [{ regiones: { isEmpty: true } }, { sucursalesIds: { isEmpty: true } }] },
        { regiones: { has: 'Todas' } },
      ];
      const regionNombre = String(user?.region?.nombre || '').trim();
      const agenciaId = String(user?.agenciaId || '').trim();
      if (regionNombre) visibility.push({ regiones: { has: regionNombre } });
      if (agenciaId) visibility.push({ sucursalesIds: { has: agenciaId } });
      where.AND = [...(where.AND || []), { OR: visibility }];
    }

    return this.prisma.reto.findMany({
      where,
      orderBy: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(dto: CreateRetoDto, user: any) {
    if (!CREATE_ROLES.has(this.roleCode(user))) {
      throw new ForbiddenException('Tu rol no está autorizado para crear retos.');
    }
    const inicio = new Date(dto.fechaInicio);
    const fin = new Date(dto.fechaFin);
    if (fin < inicio) {
      throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio.');
    }

    return this.prisma.reto.create({
      data: {
        titulo: dto.titulo.trim(),
        descripcion: dto.descripcion?.trim() || null,
        premio: dto.premio?.trim() || null,
        fechaInicio: inicio,
        fechaFin: fin,
        regiones: this.cleanList(dto.regiones),
        marcas: this.cleanList(dto.marcas),
        sucursalesIds: this.cleanList(dto.sucursalesIds),
        estado: dto.estado || 'ACTIVO',
        criterios: this.cleanList(dto.criterios),
        creadoPorId: user?.id ? String(user.id) : null,
        creadorNombre: String(user?.nombre || `${user?.name || ''} ${user?.lastname || ''}`).trim() || null,
        creadorRol: this.roleCode(user) || null,
      },
    });
  }

  async delete(id: string, user: any) {
    const existing = await this.prisma.reto.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Reto no encontrado.');
    const isAdmin = ADMIN_ROLES.has(this.roleCode(user));
    const isOwner = existing.creadoPorId && String(existing.creadoPorId) === String(user?.id || '');
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('Solo el creador o un administrador puede eliminar este reto.');
    }
    await this.prisma.reto.delete({ where: { id } });
    return { success: true, id };
  }

  private roleCode(user: any): string {
    return String(user?.role?.namerol || user?.roleDetails?.namerol || user?.role || '').toUpperCase();
  }

  private cleanList(values?: string[]): string[] {
    return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
  }
}
