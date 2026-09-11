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
      agenciaNombre: item.agencia?.nombre || (item.region?.nombre ? `Zonal ${item.region.nombre}` : 'Servicio Móvil Zonal'),
      sucursalNombre: item.agencia?.nombre || (item.region?.nombre ? `Zonal ${item.region.nombre}` : 'Servicio Móvil Zonal'),
      operadorNombre: item.operador ? `${item.operador.name} ${item.operador.lastname || ''}`.trim() : 'Sin asignar',
      regionNombre: item.region?.nombre || item.regionNombre || '',
      videoInicial: item.videoInicialUrl || null,
      videoFinal: item.videoFinalUrl || null,
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

  async findAll(query: QueryServicioEspecialDto, currentUser?: any) {
    const where: any = { deletedAt: null };

    // 1. Filtrado Estricto por Rol y Región
    if (currentUser) {
      const rol = (currentUser.role?.namerol || currentUser.role || '').toUpperCase();
      const isPulidor = rol.includes('PULIDOR') || rol === 'PULIDOR_MOVIL' || rol === 'PULIDOR_FIJO';
      const isCoord = rol.includes('COORD_SERVICIOS_ESPECIALES') || (rol.includes('COORD') && rol.includes('ESPECIALES'));

      if (isPulidor) {
        // El pulidor ve únicamente los servicios asignados a él
        where.operadorId = currentUser.id;
      } else if (isCoord && currentUser.regionId) {
        // El coordinador ve únicamente los servicios de su región asignada
        where.regionId = currentUser.regionId;
      }
    }

    if (query.operadorId) {
      where.operadorId = query.operadorId;
    }

    if (query.regionId) {
      where.regionId = query.regionId;
    }

    const targetAgencia = query.agenciaId || query.sucursalId;
    if (targetAgencia) {
      where.agenciaId = targetAgencia;
    }

    if (query.estado && query.estado !== 'Todos') {
      where.estado = { equals: query.estado, mode: 'insensitive' };
    }

    if (query.tipoServicio && query.tipoServicio !== 'Todos') {
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
          operador: { select: { id: true, name: true, lastname: true, email: true, regionId: true } },
          region: { select: { id: true, nombre: true, codigo: true } },
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
        operador: { select: { id: true, name: true, lastname: true, email: true, regionId: true } },
        region: true,
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

  async create(dto: CreateServicioEspecialDto, creatorId?: string, currentUser?: any) {
    const clientUuid = dto.clientUuid || randomUUID();
    const codigoSE = dto.codigoSE || `SE-${Date.now().toString().slice(-6)}`;

    const vInfo = dto.vehiculoInfo || {};
    const placa = (vInfo.placa || (dto as any).placa || 'ABC-0000').toUpperCase().trim();
    const marca = vInfo.marca || (dto as any).marca || null;
    const modelo = vInfo.modelo || (dto as any).modelo || null;
    const color = vInfo.color || (dto as any).color || null;
    const clienteNombre = vInfo.cliente || vInfo.clienteNombre || (dto as any).cliente || null;

    let finalRegionId = dto.regionId || currentUser?.regionId || null;
    let finalRegionNombre = dto.regionNombre || null;

    if (!finalRegionId && currentUser?.id) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { regionId: true, region: { select: { nombre: true } } },
      });
      if (dbUser?.regionId) {
        finalRegionId = dbUser.regionId;
        finalRegionNombre = dbUser.region?.nombre || null;
      }
    }

    // Validar asignación de operador: Si el creador es Coordinador, el operador debe ser de su misma región
    if (dto.operadorId && finalRegionId) {
      const operadorAsignado = await this.prisma.user.findUnique({
        where: { id: dto.operadorId },
        select: { id: true, name: true, regionId: true },
      });
      if (operadorAsignado && operadorAsignado.regionId && operadorAsignado.regionId !== finalRegionId) {
        throw new BadRequestException('Solo se pueden asignar servicios especiales a pulidores de su misma región.');
      }
    }

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
        agenciaId: dto.agenciaId || null,
        regionId: finalRegionId,
        regionNombre: finalRegionNombre,
        operadorId: dto.operadorId || creatorId || null,
        prioridad: dto.prioridad || 'Media',
        estado: 'Pendiente',
        videoInicialUrl: dto.videoInicialUrl || null,
        recetaInsumos: dto.recetaInsumos || null,
        evidencias: dto.evidencias || null,
        observaciones: dto.observaciones || null,
      },
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
        region: true,
      },
    });

    return this._formatItem(created);
  }

  async iniciar(dto: IniciarServicioEspecialDto) {
    const item = await this.findOneRaw(dto.id);
    if (item.estado.toUpperCase() === 'COMPLETADO' || item.estado.toUpperCase() === 'FINALIZADO') {
      throw new BadRequestException('El servicio especial ya ha sido finalizado.');
    }

    const data: any = {
      estado: 'En Proceso',
      fechaInicio: item.fechaInicio || new Date(),
      operadorId: dto.operadorId || item.operadorId,
      version: item.version + 1,
    };

    if (dto.videoInicialUrl) {
      data.videoInicialUrl = dto.videoInicialUrl;
    }

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data,
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
        region: true,
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

    if (dto.videoFinalUrl) {
      data.videoFinalUrl = dto.videoFinalUrl;
    }
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
        region: true,
      },
    });

    // Descuento automático de químicos del stock en custodia del Pulidor
    if (item.operadorId && item.recetaInsumos && Array.isArray(item.recetaInsumos)) {
      for (const ins of (item.recetaInsumos as any[])) {
        if (!ins) continue;
        const cantidadDesc = Number(ins.cantidad || 0);
        if (cantidadDesc <= 0) continue;

        try {
          const insumoDb = await this.prisma.insumo.findFirst({
            where: {
              OR: [
                { id: ins.insumoId || '' },
                { nombre: { equals: ins.insumoNombre || ins.nombre || '', mode: 'insensitive' } },
                { codigoSKU: ins.codigoSKU || '' },
              ],
            },
          });

          if (insumoDb) {
            const stockPulidor = await this.prisma.stockUbicacion.findFirst({
              where: {
                insumoId: insumoDb.id,
                pulidorId: item.operadorId,
              },
            });

            if (stockPulidor) {
              await this.prisma.stockUbicacion.update({
                where: { id: stockPulidor.id },
                data: { cantidadActual: { decrement: cantidadDesc } },
              });
            }
          }
        } catch {
          // Descuento no bloqueante
        }
      }
    }

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
        region: true,
      },
    });

    return this._formatItem(updated);
  }

  // =========================================================================
  // MÉTODOS AUXILIARES: PULIDORES Y STOCK ZONAL
  // =========================================================================

  async listarPulidoresPorRegion(regionId: string) {
    return this.prisma.user.findMany({
      where: {
        estado: 1,
        regionId,
        role: {
          namerol: { in: ['PULIDOR_MOVIL', 'PULIDOR_FIJO', 'Pulidor Móvil', 'Pulidor Fijo'] },
        },
      },
      select: {
        id: true,
        name: true,
        lastname: true,
        email: true,
        regionId: true,
        region: { select: { id: true, nombre: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async obtenerStockPulidor(pulidorId: string) {
    const stocks = await this.prisma.stockUbicacion.findMany({
      where: {
        pulidorId,
      },
      include: {
        insumo: {
          select: {
            id: true,
            codigoSKU: true,
            nombre: true,
            categoria: true,
            unidadMedida: { select: { simbolo: true, nombre: true } },
          },
        },
      },
      orderBy: { insumo: { nombre: 'asc' } },
    });

    return stocks.map((s) => ({
      id: s.id,
      insumoId: s.insumoId,
      nombre: s.insumo.nombre,
      codigoSKU: s.insumo.codigoSKU,
      categoria: s.insumo.categoria,
      cantidadActual: Number(s.cantidadActual),
      cantidadMinima: Number(s.cantidadMinima),
      unidadMedida: s.insumo.unidadMedida?.simbolo || 'u',
      estado: Number(s.cantidadActual) <= 0 ? 'AGOTADO' : (Number(s.cantidadActual) <= Number(s.cantidadMinima) ? 'BAJO' : 'OPTIMO'),
    }));
  }
}
