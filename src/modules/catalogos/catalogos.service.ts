import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateCatalogoServicioDto,
  UpdateCatalogoServicioDto,
  ListCatalogoServiciosDto,
} from './dto/servicios.dto.js';

@Injectable()
export class CatalogosService {
  constructor(private prisma: PrismaService) {}

  async listServicios(dto?: ListCatalogoServiciosDto) {
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

    return this.prisma.catalogoServicio.findMany({
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
        tiempoEstimadoMin: dto.tiempoEstimadoMin ?? 30,
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
        ...(dto.tiempoEstimadoMin !== undefined && { tiempoEstimadoMin: dto.tiempoEstimadoMin }),
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
        marca: { select: { id: true, nombre: true } },
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
