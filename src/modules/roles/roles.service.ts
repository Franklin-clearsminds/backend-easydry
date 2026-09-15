import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { QueryRolesDto } from './dto/query-roles.dto.js';
import { formatDateTime } from '../../common/utils/date-formatter.util.js';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo de módulos/permisos desde la tabla modulos_sistema */
  async getAvailablePermissions() {
    const modulos = await this.prisma.moduloSistema.findMany({
      where: { estado: 1 },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    const catalogo = modulos.map((m) => ({
      id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      descripcion: m.descripcion || '',
      icono: m.icono || undefined,
      rutaPrincipal: m.rutaPrincipal || undefined,
      grupo: m.grupo,
      orden: m.orden,
    }));

    return {
      total: catalogo.length,
      codigos: catalogo.map((c) => c.codigo),
      catalogo,
    };
  }

  /** Listado de módulos del sistema (misma fuente que permisos) */
  async listModulos(soloActivos = true) {
    const where = soloActivos ? { estado: 1 } : {};
    const modulos = await this.prisma.moduloSistema.findMany({
      where,
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    return modulos.map((m) => ({
      id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      descripcion: m.descripcion || '',
      icono: m.icono || 'circle',
      rutaPrincipal: m.rutaPrincipal || `/${m.codigo}`,
      grupo: m.grupo,
      orden: m.orden,
      estado: m.estado,
    }));
  }

  private mapRoleResponse(role: any) {
    return {
      id: role.id,
      namerol: role.namerol,
      descripcion: role.descripcion || '',
      estado: role.estado,
      permisos: Array.isArray(role.permisos) ? role.permisos : [],
      acciones: role.acciones ?? null,
      fechaCreacion: formatDateTime(role.fechaCreacion),
      fechaModificacion: formatDateTime(role.fechaModificacion),
      usuariosCount: role._count?.users ?? role.users?.length ?? 0,
    };
  }

  async findAll(query?: QueryRolesDto, userRole?: string) {
    const where: any = {};

    if (userRole && userRole !== 'SUPER_ADMIN') {
      where.namerol = { not: 'SUPER_ADMIN' };
    }

    if (query?.estado !== undefined) {
      where.estado = Number(query.estado);
    }

    if (query?.namerol) {
      where.namerol = { contains: query.namerol.trim(), mode: 'insensitive', ...(userRole && userRole !== 'SUPER_ADMIN' ? { not: 'SUPER_ADMIN' } : {}) };
    }

    if (query?.search) {
      const q = query.search.trim();
      where.OR = [
        { namerol: { contains: q, mode: 'insensitive' } },
        { descripcion: { contains: q, mode: 'insensitive' } },
      ];
      if (userRole && userRole !== 'SUPER_ADMIN') {
        where.AND = [{ namerol: { not: 'SUPER_ADMIN' } }];
      }
    }

    const roles = await this.prisma.role.findMany({
      where,
      include: {
        _count: {
          select: { users: true },
        },
      },
      orderBy: { namerol: 'asc' },
    });

    return roles.map((r) => this.mapRoleResponse(r));
  }

  async findOne(idOrNamerol: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        OR: [
          { id: idOrNamerol },
          { namerol: idOrNamerol.trim() },
        ],
      },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Rol con ID o namerol '${idOrNamerol}' no encontrado`);
    }

    return this.mapRoleResponse(role);
  }

  async create(createDto: CreateRoleDto) {
    const namerolNormalized = createDto.namerol.trim().toUpperCase();

    const existing = await this.prisma.role.findUnique({
      where: { namerol: namerolNormalized },
    });

    if (existing) {
      throw new ConflictException(`El rol con namerol '${namerolNormalized}' ya existe`);
    }

    const newRole = await this.prisma.role.create({
      data: {
        namerol: namerolNormalized,
        descripcion: createDto.descripcion?.trim() || null,
        estado: createDto.estado !== undefined ? Number(createDto.estado) : 1,
        permisos: createDto.permisos ?? [],
      },
    });

    return this.mapRoleResponse(newRole);
  }

  async update(updateDto: UpdateRoleDto) {
    const { id, namerol, descripcion, estado, permisos } = updateDto;

    const role = await this.prisma.role.findUnique({
      where: { id },
    });

    if (!role) {
      throw new NotFoundException(`Rol con ID '${id}' no encontrado`);
    }

    if (role.namerol === 'SUPER_ADMIN') {
      throw new ForbiddenException('El rol SUPER_ADMIN es inmutable por diseño del sistema; no se pueden modificar sus permisos, estado ni configuración.');
    }

    const dataToUpdate: any = {};

    if (namerol) {
      const namerolNormalized = namerol.trim().toUpperCase();
      if (namerolNormalized !== role.namerol) {
        const duplicate = await this.prisma.role.findUnique({
          where: { namerol: namerolNormalized },
        });
        if (duplicate) {
          throw new ConflictException(`Ya existe otro rol con el namerol '${namerolNormalized}'`);
        }
        dataToUpdate.namerol = namerolNormalized;
      }
    }

    if (descripcion !== undefined) {
      dataToUpdate.descripcion = descripcion?.trim() || null;
    }

    if (estado !== undefined) {
      dataToUpdate.estado = Number(estado);
    }

    if (permisos !== undefined) {
      dataToUpdate.permisos = permisos;
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: dataToUpdate,
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    return this.mapRoleResponse(updated);
  }

  async delete(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
    });

    if (!role) {
      throw new NotFoundException(`Rol con ID '${id}' no encontrado`);
    }

    if (role.namerol === 'SUPER_ADMIN') {
      throw new ForbiddenException('El rol SUPER_ADMIN no puede ser eliminado por diseño del sistema.');
    }

    try {
      await this.prisma.role.delete({
        where: { id },
      });
    } catch {
      await this.prisma.role.update({
        where: { id },
        data: { estado: 0 },
      });
    }

    return {
      success: true,
      message: `Rol '${role.namerol}' eliminado exitosamente`,
      id,
    };
  }
}

