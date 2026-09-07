import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  QueryServicioEspecialDto,
  CreateServicioEspecialDto,
  IniciarServicioEspecialDto,
  CompletarServicioEspecialDto,
} from './dto/servicios-especiales.dto.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';

@Injectable()
export class ServiciosEspecialesService {
  constructor(private prisma: PrismaService) {}

  private _formatItem(item: any) {
    if (!item) return null;
    return {
      ...item,
      agenciaNombre: item.agencia?.nombre || '',
      sucursalNombre: item.agencia?.nombre || '',
      operadorNombre: item.operador ? `${item.operador.name} ${item.operador.lastname || ''}`.trim() : 'Sin asignar',
      cliente: item.clienteNombre || '',
      vehiculoInfo: {
        placa: item.placa || '',
        marca: item.marca || '',
        modelo: item.modelo || '',
        color: item.color || '',
        cliente: item.clienteNombre || '',
      },
    };
  }

  async findAll(query: QueryServicioEspecialDto) {
    const where: any = { deletedAt: null };

    const targetAgencia = query.agenciaId || query.sucursalId;
    if (targetAgencia) {
      where.agenciaId = targetAgencia;
    }

    if (query.estado) {
      where.estado = { equals: query.estado, mode: 'insensitive' };
    }

    if (query.tipoServicio) {
      where.tipoServicio = { contains: query.tipoServicio, mode: 'insensitive' };
    }

    if (query.search) {
      const q = query.search.trim();
      where.OR = [
        { codigoSE: { contains: q, mode: 'insensitive' } },
        { placa: { contains: q, mode: 'insensitive' } },
        { modelo: { contains: q, mode: 'insensitive' } },
        { clienteNombre: { contains: q, mode: 'insensitive' } },
        { observaciones: { contains: q, mode: 'insensitive' } },
      ];
    }

    const page = query.page ? Number(query.page) : 1;
    const pageSize = query.pageSize ? Number(query.pageSize) : 50;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.servicioEspecial.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          agencia: { select: { id: true, nombre: true, codigo: true } },
          operador: { select: { id: true, name: true, lastname: true, email: true } },
        },
      }),
      this.prisma.servicioEspecial.count({ where }),
    ]);

    const formatted = items.map((i) => this._formatItem(i));
    return buildDataGridResponse(formatted, total, page, pageSize);
  }

  async findOneRaw(id: string) {
    const item = await this.prisma.servicioEspecial.findFirst({
      where: {
        OR: [{ id }, { clientUuid: id }, { codigoSE: id }],
      },
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });

    if (!item) {
      throw new NotFoundException(`Servicio especial ${id} no encontrado`);
    }

    return item;
  }

  async findOne(id: string) {
    const item = await this.findOneRaw(id);
    return this._formatItem(item);
  }

  async create(dto: CreateServicioEspecialDto, creatorId?: string) {
    const clientUuid = dto.clientUuid || randomUUID();
    const codigoSE = dto.codigoSE || `SE-${Date.now().toString().slice(-6)}`;

    const vInfo = dto.vehiculoInfo || {};
    const placa = (vInfo.placa || (dto as any).placa || 'ABC-0000').toUpperCase().trim();
    const marca = vInfo.marca || (dto as any).marca || null;
    const modelo = vInfo.modelo || (dto as any).modelo || null;
    const color = vInfo.color || (dto as any).color || null;
    const clienteNombre = vInfo.cliente || vInfo.clienteNombre || (dto as any).cliente || null;

    const created = await this.prisma.servicioEspecial.create({
      data: {
        clientUuid,
        codigoSE,
        tipoServicio: dto.tipoServicio.trim(),
        placa,
        marca,
        modelo,
        color,
        clienteNombre,
        agenciaId: dto.agenciaId,
        operadorId: dto.operadorId || creatorId || null,
        prioridad: dto.prioridad || 'Media',
        estado: 'Pendiente',
        recetaInsumos: dto.recetaInsumos || null,
        evidencias: dto.evidencias || null,
        observaciones: dto.observaciones || null,
      },
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });

    return this._formatItem(created);
  }

  async iniciar(dto: IniciarServicioEspecialDto) {
    const item = await this.findOneRaw(dto.id);
    if (item.estado.toUpperCase() === 'COMPLETADO' || item.estado.toUpperCase() === 'FINALIZADO') {
      throw new BadRequestException('El servicio especial ya ha sido finalizado.');
    }

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        estado: 'En Proceso',
        fechaInicio: item.fechaInicio || new Date(),
        operadorId: dto.operadorId || item.operadorId,
        version: item.version + 1,
      },
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });

    return this._formatItem(updated);
  }

  async completar(dto: CompletarServicioEspecialDto) {
    const item = await this.findOneRaw(dto.id);

    const data: any = {
      estado: 'Completado',
      fechaFin: new Date(),
      version: item.version + 1,
    };

    if (dto.evidencias) {
      data.evidencias = dto.evidencias;
    }
    if (dto.calificacionCalidad !== undefined) {
      data.calificacionCalidad = dto.calificacionCalidad;
    }
    if (dto.observaciones) {
      data.observaciones = dto.observaciones;
      data.notasOperador = dto.observaciones;
    }

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data,
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });

    return this._formatItem(updated);
  }

  async softDelete(id: string, motivo?: string) {
    const item = await this.findOneRaw(id);
    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        estado: 'Cancelado',
        deletedAt: new Date(),
        observaciones: motivo
          ? `${item.observaciones || ''} | [Cancelado]: ${motivo}`.trim()
          : item.observaciones,
        version: item.version + 1,
      },
      include: {
        agencia: true,
        operador: true,
      },
    });

    return this._formatItem(updated);
  }
}
