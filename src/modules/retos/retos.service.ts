import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRetoDto, ListRetosDto } from './dto/retos.dto.js';
import { columnasSimples, combinarWhere, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

@Injectable()
export class RetosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListRetosDto, user: any) {
    const role = this.roleCode(user);
    const where: any = {};

    if (dto.vigencia) {
      // Con `vigencia` (pantalla de retos) se ignoran los indicadores antiguos.
      if (dto.vigencia === 'ACTIVOS') {
        where.estado = 'ACTIVO';
      } else if (dto.vigencia === 'VENCIDOS') {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        where.fechaFin = { lt: hoy };
      }
    } else if (dto.soloActivos !== false && !dto.incluirTodos) {
      where.estado = 'ACTIVO';
    }

    // Quien actúa en todo el país (administradores, jefe comercial) ve todos los retos; el resto, los de su región o agencia.
    if (resolverAlcance(user).tipo !== 'GLOBAL') {
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

    const filtros = combinarWhere(where, whereBusqueda(['titulo', 'descripcion', 'premio'], dto.search));
    return listarPaginable(dto, {
      where: filtros,
      columnas: columnasSimples({ titulo: 'titulo', inicio: 'fechaInicio', fin: 'fechaFin', estado: 'estado', fecha: 'fechaInicio' }),
      ordenHeredado: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }],
      buscar: ({ where: w, orderBy, skip, take }) => this.prisma.reto.findMany({ where: w, orderBy, skip, take }),
      contar: (w) => this.prisma.reto.count({ where: w }),
    });
  }

  async create(dto: CreateRetoDto, user: any) {
    // El permiso «retos.crear» ya se exigió en el controlador. Quien no actúa en todo el país (coordinador comercial) solo crea
    // retos para su propia región y para agencias de esa región.
    const alcance = resolverAlcance(user);
    const regiones = this.cleanList(dto.regiones);
    const sucursalesIds = this.cleanList(dto.sucursalesIds);
    if (alcance.tipo !== 'GLOBAL') {
      if (alcance.tipo !== 'REGION') {
        throw new ForbiddenException('Tu usuario no tiene una región asignada para crear retos.');
      }
      const miRegion = String(user?.region?.nombre || '').trim();
      if (!miRegion) throw new ForbiddenException('Tu usuario no tiene una región asignada para crear retos.');
      if (regiones.length === 0 || regiones.some((r) => r.toLowerCase() !== miRegion.toLowerCase())) {
        throw new ForbiddenException(`Solo puedes crear retos para tu región (${miRegion}).`);
      }
      if (sucursalesIds.length) {
        const propias = await this.prisma.agencia.count({ where: { id: { in: sucursalesIds }, regionId: alcance.regionId } });
        if (propias !== sucursalesIds.length) throw new ForbiddenException('Algunas agencias no pertenecen a tu región.');
      }
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
        regiones,
        marcas: this.cleanList(dto.marcas),
        sucursalesIds,
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
    return rolDeUsuario(user);
  }

  private cleanList(values?: string[]): string[] {
    return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
  }
}
