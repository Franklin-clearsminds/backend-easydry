import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CatalogosService {
  constructor(private prisma: PrismaService) {}

  async getServicios() {
    return this.prisma.catalogoServicio.findMany({
      orderBy: { codigo: 'asc' },
    });
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
