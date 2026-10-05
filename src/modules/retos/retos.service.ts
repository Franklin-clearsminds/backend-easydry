import { BadRequestException, ForbiddenException, Injectable, Optional, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CerrarRetoDto, CreateRetoDto, ListRetosDto } from './dto/retos.dto.js';
import { columnasSimples, combinarWhere, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

@Injectable()
export class RetosService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

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

  async cerrar(dto: CerrarRetoDto, user: any) {
    const existing = await this.prisma.reto.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('Reto no encontrado.');
    const isAdmin = ADMIN_ROLES.has(this.roleCode(user));
    const isOwner = existing.creadoPorId && String(existing.creadoPorId) === String(user?.id || '');
    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('Solo el creador o un administrador puede cerrar este reto.');
    }
    if (existing.estado === 'FINALIZADO') {
      throw new BadRequestException('Este reto ya fue cerrado.');
    }
    const cerrado = await this.prisma.reto.update({
      where: { id: dto.id },
      data: {
        estado: 'FINALIZADO',
        ganadorNombre: dto.ganadorNombre?.trim() || null,
        resultado: dto.resultado?.trim() || null,
        cerradoPorId: user?.id ? String(user.id) : null,
        cerradoEn: new Date(),
      },
    });
    void this.notificarCierreReto(cerrado);
    return cerrado;
  }

  /** Avisa el cierre de un reto: admin/super admin, jefe comercial (nacional) y el coordinador
   * comercial + supervisor de las regiones del reto (o de todo el país si no tenía región). */
  private async notificarCierreReto(reto: { id: string; titulo: string; ganadorNombre: string | null; regiones: string[] }): Promise<void> {
    if (!this.notifications) return;
    const nacional = reto.regiones.length === 0 || reto.regiones.some((r) => r.trim().toLowerCase() === 'todas');
    let regionIds: string[] | 'TODAS' = 'TODAS';
    if (!nacional) {
      const regiones = await this.prisma.region.findMany({ where: { nombre: { in: reto.regiones } }, select: { id: true } });
      regionIds = regiones.map((r) => r.id);
    }
    const ids = await this.notifications.resolverDestinatariosPorRol({
      global: ['ADMIN', 'SUPER_ADMIN', 'JEFE_COMERCIAL'],
      regionales: ['COORD_COMERCIAL', 'SUPERVISOR'],
      regionId: regionIds,
    });
    if (!ids.length) return;
    void this.notifications.notificarUsuarios(
      ids,
      'Reto cerrado',
      reto.ganadorNombre ? `"${reto.titulo}" cerró. Ganador: ${reto.ganadorNombre}.` : `"${reto.titulo}" cerró.`,
      { type: 'RETO_CERRADO', retoId: reto.id },
      { tipo: 'RETO_CERRADO', entidadTipo: 'RETO', entidadId: reto.id },
    );
  }

  private roleCode(user: any): string {
    return rolDeUsuario(user);
  }

  private cleanList(values?: string[]): string[] {
    return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
  }
}
