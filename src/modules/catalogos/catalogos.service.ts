import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateCatalogoServicioDto,
  UpdateCatalogoServicioDto,
  ListCatalogoServiciosDto,
} from './dto/servicios.dto.js';

// Roles cuyo catálogo se acota a Agencia.servicioIds
const ROLES_SCOPED = ['LIDER', 'LIDER_AGENCIA', 'LIDER_OPERADOR', 'APROBADOR'];

@Injectable()
export class CatalogosService {
  constructor(private prisma: PrismaService) {}

  async listServicios(dto?: ListCatalogoServiciosDto, userCtx?: { agenciaId?: string; namerol?: string }) {
    const where: any = {};
    if (dto?.categoria && dto.categoria !== 'TODOS') {
      where.categoria = dto.categoria.trim().toUpperCase();
    }
    if (dto?.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const efectiveAgenciaId = dto?.agenciaId || userCtx?.agenciaId;
    const namerol = (userCtx?.namerol || '').toUpperCase();
    const isScopedRole = ROLES_SCOPED.includes(namerol) || namerol.includes('LIDER');

    let agenciaCtx: { tieneServiciosEspeciales: boolean; servicioIds: number[] } | null = null;

    // Rol de sede O admin filtrando por agencia → solo servicios de la lista de esa agencia
    if (efectiveAgenciaId && (isScopedRole || !!dto?.agenciaId)) {
      const agencia = await this.prisma.agencia.findUnique({
        where: { id: efectiveAgenciaId },
        select: {
          tieneServiciosEspeciales: true,
          servicioIds: true,
          serviciosNombres: true,
        },
      });

      if (agencia) {
        const rawIds = Array.isArray(agencia.servicioIds) ? agencia.servicioIds : [];
        const ids = rawIds.map((id: any) => Number(id)).filter((n: number) => !isNaN(n) && n > 0);

        agenciaCtx = {
          tieneServiciosEspeciales: agencia.tieneServiciosEspeciales ?? false,
          servicioIds: ids,
        };

        // Sin IDs → vacío (nunca catálogo global)
        where.id = { in: ids.length > 0 ? ids : [-1] };

        if (!agencia.tieneServiciosEspeciales) {
          where.categoria = 'GENERAL';
        }
      } else if (isScopedRole) {
        where.id = { in: [-1] };
        agenciaCtx = { tieneServiciosEspeciales: false, servicioIds: [] };
      }
    } else if (isScopedRole && !efectiveAgenciaId) {
      where.id = { in: [-1] };
      agenciaCtx = { tieneServiciosEspeciales: false, servicioIds: [] };
    }

    const servicios = await this.prisma.catalogoServicio.findMany({
      where,
      include: {
        recetas: {
          include: {
            insumo: {
              include: {
                unidadMedida: true,
              },
            },
            unidadConsumo: true,
          },
        },
        _count: {
          select: { servicios: true },
        },
      },
      orderBy: { codigo: 'asc' },
    });

    // cantidadSugerida viaja en la unidad base del insumo: es lo que descuenta el stock al registrar la OT.
    const conCantidadBase = servicios.map((servicio) => ({
      ...servicio,
      recetas: servicio.recetas.map((receta) => {
        const factor = receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : 1;
        return {
          ...receta,
          productoSKU: receta.insumo?.codigoSKU,
          productoNombre: receta.insumo?.nombre,
          unidadMedida: receta.insumo?.unidadMedida?.simbolo || receta.unidadConsumo?.simbolo || 'u',
          cantidadSugerida: Number(receta.cantidadUsada) * (factor || 1),
        };
      }),
    }));

    if (agenciaCtx) {
      return {
        servicios: conCantidadBase,
        agencia: agenciaCtx,
      };
    }

    return conCantidadBase;
  }

  async createServicio(dto: CreateCatalogoServicioDto) {
    const codigoUpper = dto.codigo.trim().toUpperCase();
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { codigo: codigoUpper },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un servicio con el código "${codigoUpper}"`);
    }

    return this.prisma.catalogoServicio.create({
      data: {
        codigo: codigoUpper,
        nombre: dto.nombre.trim(),
        categoria: dto.categoria.trim().toUpperCase(),
        descripcion: dto.descripcion?.trim() || null,
        precio: dto.precio ?? 0,
        tiempoEstimadoMin: Number(dto.tiempoEstimadoMin) > 0 ? Math.round(Number(dto.tiempoEstimadoMin)) : 30,
      },
      include: {
        recetas: {
          include: {
            insumo: true,
            unidadConsumo: true,
          },
        },
      },
    });
  }

  async updateServicio(dto: UpdateCatalogoServicioDto) {
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { id: dto.id },
    });
    if (!existing) {
      throw new NotFoundException(`Servicio de catálogo con ID ${dto.id} no encontrado`);
    }

    if (dto.codigo && dto.codigo.trim().toUpperCase() !== existing.codigo) {
      const codigoUpper = dto.codigo.trim().toUpperCase();
      const duplicate = await this.prisma.catalogoServicio.findUnique({
        where: { codigo: codigoUpper },
      });
      if (duplicate) {
        throw new ConflictException(`Ya existe otro servicio con el código "${codigoUpper}"`);
      }
    }

    return this.prisma.catalogoServicio.update({
      where: { id: dto.id },
      data: {
        ...(dto.codigo && { codigo: dto.codigo.trim().toUpperCase() }),
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.categoria && { categoria: dto.categoria.trim().toUpperCase() }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion?.trim() || null }),
        ...(dto.precio !== undefined && { precio: dto.precio }),
        ...(dto.tiempoEstimadoMin !== undefined && {
          tiempoEstimadoMin: Math.max(1, Math.round(Number(dto.tiempoEstimadoMin) || 30)),
        }),
      },
      include: {
        recetas: {
          include: {
            insumo: true,
            unidadConsumo: true,
          },
        },
      },
    });
  }

  async deleteServicio(id: number) {
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { id },
      include: { _count: { select: { servicios: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Servicio de catálogo con ID ${id} no encontrado`);
    }

    if (existing._count.servicios > 0) {
      throw new ConflictException(
        `No se puede eliminar el servicio "${existing.nombre}" porque tiene ${existing._count.servicios} órdenes de lavado asociadas`,
      );
    }

    await this.prisma.catalogoServicio.delete({
      where: { id },
    });

    return { success: true, message: `Servicio "${existing.nombre}" eliminado correctamente` };
  }

  async getAgencias() {
    return this.prisma.agencia.findMany({
      where: { estado: 1 },
      include: {
        bahias: {
          where: { activa: true },
          select: { id: true, codigo: true, nombre: true },
        },
        cliente: { select: { id: true, nombre: true } },
      },
      orderBy: { codigo: 'asc' },
    });
  }

  async getBahias(agenciaId?: string) {
    const where: any = { activa: true };
    if (agenciaId) {
      where.agenciaId = agenciaId;
    }
    return this.prisma.bahia.findMany({
      where,
      include: {
        agencia: {
          select: { id: true, codigo: true, nombre: true },
        },
      },
      orderBy: { codigo: 'asc' },
    });
  }
}
