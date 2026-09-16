import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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

    // 1. Filtrado Estricto por Rol y Región (RBAC)
    if (currentUser) {
      const rol = (currentUser.role?.namerol || currentUser.roleDetails?.namerol || currentUser.role || '').toUpperCase();
      const isSuperAdminOrAdmin = rol === 'SUPER_ADMIN' || rol === 'ADMIN';
      const isSupervisor = rol === 'SUPERVISOR' || rol === 'GERENTE_REGIONAL' || rol.includes('SUPERVISOR') || rol.includes('REGIONAL');
      const isAprobador = rol === 'APROBADOR' || rol === 'GERENTE';
      const isPulidor = rol.includes('PULIDOR') || rol === 'PULIDOR_MOVIL' || rol === 'PULIDOR_FIJO';
      const isCoord = rol.includes('COORD_SERVICIOS_ESPECIALES') || (rol.includes('COORD') && rol.includes('ESPECIALES'));

      if (isSuperAdminOrAdmin) {
        // Super Admin y Admin: ven todo a nivel nacional sin restricciones forzadas
        if (query.regionId && query.regionId !== 'Todas' && query.regionId !== 'TODAS') {
          where.regionId = query.regionId;
        }
        const targetAgencia = query.agenciaId || query.sucursalId;
        if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
          where.agenciaId = targetAgencia;
        }
      } else if (isSupervisor) {
        // Gerente Regional / Supervisor: solo servicios de su región
        const regId = currentUser.regionId || query.regionId;
        if (regId && regId !== 'Todas' && regId !== 'TODAS') {
          where.OR = [
            { regionId: regId },
            { agencia: { regionId: regId } }
          ];
        }
        const targetAgencia = query.agenciaId || query.sucursalId;
        if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
          where.agenciaId = targetAgencia;
        }
      } else if (isAprobador) {
        // Aprobador: solo servicios de su sucursal / agencia asignada
        const targetAgencia = currentUser.agenciaId || query.agenciaId || query.sucursalId;
        if (targetAgencia) {
          where.agenciaId = targetAgencia;
        }
      } else if (isPulidor) {
        // Los servicios especiales solo le salen al pulidor al que se le asignó la OT
        where.operadorId = currentUser.id;
      } else if (isCoord && currentUser.regionId) {
        // El coordinador ve únicamente los servicios de su región asignada
        where.regionId = currentUser.regionId;
      }
    } else {
      if (query.regionId && query.regionId !== 'Todas' && query.regionId !== 'TODAS') {
        where.regionId = query.regionId;
      }
      const targetAgencia = query.agenciaId || query.sucursalId;
      if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
        where.agenciaId = targetAgencia;
      }
    }

    if (query.operadorId && !where.operadorId) {
      where.operadorId = query.operadorId;
    }

    if (query.estado && query.estado !== 'Todos' && query.estado !== 'TODOS') {
      const qEst = query.estado.trim();
      if (qEst.toLowerCase() === 'en proceso') {
        where.estado = { in: ['En Proceso', 'EN_PROCESO', 'Pendiente', 'PENDIENTE'] };
      } else if (qEst.toLowerCase() === 'completado' || qEst.toLowerCase() === 'realizado') {
        where.estado = { in: ['Completado', 'FINALIZADO', 'COMPLETADO', 'Finalizado'] };
      } else {
        where.estado = { equals: qEst, mode: 'insensitive' };
      }
    }

    if (query.tipoServicio && query.tipoServicio !== 'Todos' && query.tipoServicio !== 'TODOS') {
      where.tipoServicio = { contains: query.tipoServicio, mode: 'insensitive' };
    }

    if (query.search) {
      const q = query.search.trim();
      const searchConditions = [
        { codigoSE: { contains: q, mode: 'insensitive' } },
        { placa: { contains: q, mode: 'insensitive' } },
        { modelo: { contains: q, mode: 'insensitive' } },
        { clienteNombre: { contains: q, mode: 'insensitive' } },
        { observaciones: { contains: q, mode: 'insensitive' } },
      ];

      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
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

    const rolCreator = (currentUser?.role?.namerol || currentUser?.roleDetails?.namerol || currentUser?.role || '').toUpperCase();
    const isAdminCreator = rolCreator.includes('ADMIN') || rolCreator.includes('SUPER');
    const isCoord = (rolCreator.includes('COORD_SERVICIOS_ESPECIALES') || (rolCreator.includes('COORD') && rolCreator.includes('ESPECIALES'))) && !isAdminCreator;
    const isPulidorCreator = rolCreator.includes('PULIDOR') && !isAdminCreator;

    let finalAgenciaId = dto.agenciaId || null;

    // Validación de asignación de agencia
    if (isPulidorCreator) {
      if (currentUser?.agenciaId) {
        // Pulidor fijo en sede: restringido únicamente a su agencia
        finalAgenciaId = currentUser.agenciaId;
      } else {
        // Pulidor móvil: puede elegir cualquier agencia dentro de su región
        if (!finalAgenciaId) {
          throw new BadRequestException('Debe seleccionar la agencia en la cual se realizará el servicio especial.');
        }
        if (finalRegionId) {
          const agenciaSel = await this.prisma.agencia.findUnique({
            where: { id: finalAgenciaId },
            select: { id: true, regionId: true },
          });
          if (agenciaSel?.regionId && agenciaSel.regionId !== finalRegionId) {
            throw new BadRequestException('El pulidor móvil solo puede realizar servicios en agencias de su región asignada.');
          }
        }
      }
    } else if (dto.agenciaId) {
      finalAgenciaId = dto.agenciaId;
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

    let operadorIdFinal = dto.operadorId || null;
    if (!operadorIdFinal && isPulidorCreator) {
      operadorIdFinal = creatorId || currentUser?.id || null;
    }
    if (isCoord && !operadorIdFinal) {
      throw new BadRequestException('Debe asignar un pulidor móvil para crear la orden de servicio especial.');
    }

    // Admin y Super Admin NO tienen inventario propio ni agencia fija; no se valida stock
    let recetaValidada: any[] | null = null;
    if (isAdminCreator) {
      recetaValidada = Array.isArray(dto.recetaInsumos) ? dto.recetaInsumos : null;
    } else if (operadorIdFinal) {
      // Para pulidores u operadores asignados por coordinadores, se valida su kit en custodia
      recetaValidada = await this.assertPulidorTieneInsumosParaOT(
        operadorIdFinal,
        dto.recetaInsumos,
        dto.tipoServicio,
        finalAgenciaId || undefined,
        currentUser?.id,
      );
    } else {
      recetaValidada = Array.isArray(dto.recetaInsumos) ? dto.recetaInsumos : null;
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
        agenciaId: finalAgenciaId,
        regionId: finalRegionId,
        regionNombre: finalRegionNombre,
        operadorId: operadorIdFinal,
        prioridad: dto.prioridad || 'Media',
        estado: 'Pendiente',
        videoInicialUrl: dto.videoInicialUrl || null,
        recetaInsumos: recetaValidada || dto.recetaInsumos || null,
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

  /**
   * Impide crear OT especial si el kit del pulidor no cubre la receta del servicio
   * y emite alerta de stock bajo/agotado hacia la bodega de la región y bodega central.
   */
  private async assertPulidorTieneInsumosParaOT(
    operadorId: string,
    recetaInsumos: any,
    tipoServicio?: string,
    agenciaId?: string,
    emisorId?: string,
  ): Promise<any[]> {
    let items: any[] = Array.isArray(recetaInsumos) ? [...recetaInsumos] : [];

    if (items.length === 0 && tipoServicio?.trim()) {
      const cat = await this.prisma.catalogoServicio.findFirst({
        where: {
          OR: [
            { nombre: { equals: tipoServicio.trim(), mode: 'insensitive' } },
            { codigo: { equals: tipoServicio.trim(), mode: 'insensitive' } },
          ],
        },
        include: {
          recetas: {
            include: {
              insumo: { select: { id: true, nombre: true, codigoSKU: true } },
              unidadConsumo: { select: { simbolo: true } },
            },
          },
        },
      });
      if (cat?.recetas?.length) {
        items = cat.recetas.map((r) => ({
          productoId: r.insumoId,
          insumoId: r.insumoId,
          productoSKU: r.insumo?.codigoSKU,
          codigoSKU: r.insumo?.codigoSKU,
          productoNombre: r.insumo?.nombre,
          insumoNombre: r.insumo?.nombre,
          unidadMedida: r.unidadConsumo?.simbolo || 'u',
          cantidadSugerida: Number(r.cantidadUsada),
          cantidad: Number(r.cantidadUsada),
        }));
      }
    }

    const stocks = await this.prisma.stockUbicacion.findMany({
      where: { pulidorId: operadorId },
      include: { insumo: { select: { id: true, nombre: true, codigoSKU: true } } },
    });

    const stockPorInsumo = new Map<string, number>();
    for (const s of stocks) {
      stockPorInsumo.set(s.insumoId, (stockPorInsumo.get(s.insumoId) || 0) + Number(s.cantidadActual));
    }

    const totalKit = Array.from(stockPorInsumo.values()).reduce((a, b) => a + b, 0);
    if (totalKit <= 0) {
      throw new BadRequestException(
        'No puede crear la OT: el pulidor no tiene insumos en su kit. Solicite un despacho antes de registrar el servicio.',
      );
    }

    if (items.length === 0) {
      throw new BadRequestException(
        'No puede crear la OT: el servicio no tiene receta de insumos configurada o el kit no puede validarse.',
      );
    }

    const faltantes: string[] = [];
    for (const it of items) {
      const insumoId = String(it.insumoId || it.productoId || '').trim();
      const need = Number(it.cantidadSugerida ?? it.cantidad ?? 0);
      if (!insumoId || need <= 0) continue;

      let have = stockPorInsumo.get(insumoId);
      if (have === undefined) {
        const sku = String(it.codigoSKU || it.productoSKU || '').trim();
        const nombre = String(it.productoNombre || it.insumoNombre || it.nombre || '').trim().toLowerCase();
        const match = stocks.find(
          (s) =>
            (sku && s.insumo?.codigoSKU === sku) ||
            (nombre && s.insumo?.nombre?.toLowerCase() === nombre),
        );
        have = match ? Number(match.cantidadActual) : 0;
      }

      if ((have || 0) < need) {
        const label = it.productoNombre || it.insumoNombre || it.nombre || it.codigoSKU || insumoId;
        faltantes.push(`${label}: requiere ${need}, disponible ${have || 0}`);
      }
    }

    if (faltantes.length > 0) {
      // Disparar alertas de stock bajo/agotado hacia la bodega de la región y bodega central
      try {
        for (const it of items) {
          const insumoId = String(it.insumoId || it.productoId || '').trim();
          const need = Number(it.cantidadSugerida ?? it.cantidad ?? 0);
          if (!insumoId) continue;
          const have = stockPorInsumo.get(insumoId) || 0;
          if (have < need) {
            const nivelAlerta = have <= 0 ? 'AGOTADO' : 'CRITICO';
            const existe = await this.prisma.alertaStock.findFirst({
              where: {
                insumoId,
                pulidorId: operadorId,
                estado: 'PENDIENTE',
              },
            });
            if (!existe) {
              await this.prisma.alertaStock.create({
                data: {
                  insumoId,
                  nivel: nivelAlerta as any,
                  estado: 'PENDIENTE',
                  pulidorId: operadorId,
                  agenciaId: agenciaId || null,
                  usuarioEmisorId: emisorId || operadorId,
                  mensaje: `Stock insuficiente para Servicio Especial "${tipoServicio || 'Especial'}": requiere ${need}, kit tiene ${have}`,
                  stockReportado: have,
                },
              });
            }
          }
        }
      } catch (errAlerta) {
        console.warn('No se pudo registrar alerta de stock para pulidor:', errAlerta);
      }

      throw new BadRequestException(
        `No puede crear la OT: insumos insuficientes en el kit del pulidor. ${faltantes.join('; ')}`,
      );
    }

    return items.map((it) => ({
      ...it,
      cantidad: Number(it.cantidadSugerida ?? it.cantidad ?? 0),
      cantidadSugerida: Number(it.cantidadSugerida ?? it.cantidad ?? 0),
      insumoId: it.insumoId || it.productoId,
      codigoSKU: it.codigoSKU || it.productoSKU,
      insumoNombre: it.insumoNombre || it.productoNombre || it.nombre,
    }));
  }

  async iniciar(dto: IniciarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);
    if (item.estado.toUpperCase() === 'COMPLETADO' || item.estado.toUpperCase() === 'FINALIZADO') {
      throw new BadRequestException('El servicio especial ya ha sido finalizado.');
    }

    const rol = (currentUser?.role?.namerol || currentUser?.roleDetails?.namerol || currentUser?.role || '').toUpperCase();
    const isAdmin = rol.includes('ADMIN') || rol.includes('SUPER');
    const isPulidor = rol.includes('PULIDOR') && !isAdmin;

    // Solo el pulidor asignado a esta OT o un Admin/SuperAdmin puede iniciarla
    if (isPulidor && item.operadorId && item.operadorId !== currentUser?.id) {
      throw new ForbiddenException('Solo el pulidor asignado a esta orden de trabajo puede iniciar el servicio.');
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

  async completar(dto: CompletarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);

    const rol = (currentUser?.role?.namerol || currentUser?.roleDetails?.namerol || currentUser?.role || '').toUpperCase();
    const isAdmin = rol.includes('ADMIN') || rol.includes('SUPER');
    const isPulidor = rol.includes('PULIDOR') && !isAdmin;

    // Solo el pulidor asignado a esta OT o un Admin/SuperAdmin puede completarla
    if (isPulidor && item.operadorId && item.operadorId !== currentUser?.id) {
      throw new ForbiddenException('Solo el pulidor asignado a esta orden de trabajo puede finalizar el servicio.');
    }

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
        const cantidadDesc = Number(ins.cantidad ?? ins.cantidadSugerida ?? 0);
        if (cantidadDesc <= 0) continue;

        try {
          const insumoId = String(ins.insumoId || ins.productoId || '').trim();
          const sku = String(ins.codigoSKU || ins.productoSKU || '').trim();
          const nombre = String(ins.insumoNombre || ins.productoNombre || ins.nombre || '').trim();

          const orConditions: any[] = [];
          if (insumoId) orConditions.push({ id: insumoId });
          if (sku) orConditions.push({ codigoSKU: sku });
          if (nombre) orConditions.push({ nombre: { equals: nombre, mode: 'insensitive' } });

          if (orConditions.length === 0) continue;

          const insumoDb = await this.prisma.insumo.findFirst({
            where: { OR: orConditions },
          });

          if (insumoDb) {
            const stockPulidor = await this.prisma.stockUbicacion.findFirst({
              where: {
                insumoId: insumoDb.id,
                pulidorId: item.operadorId,
              },
            });

            if (stockPulidor) {
              const nuevaCant = Math.max(0, Number(stockPulidor.cantidadActual) - cantidadDesc);
              await this.prisma.stockUbicacion.update({
                where: { id: stockPulidor.id },
                data: { cantidadActual: nuevaCant },
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

  async listarPulidoresPorRegion(regionId?: string, agenciaId?: string) {
    const where: any = {
      estado: 1,
      role: {
        namerol: { in: ['PULIDOR', 'PULIDOR_MOVIL', 'PULIDOR_FIJO', 'Pulidor', 'Pulidor Móvil', 'Pulidor Fijo'] },
      },
    };
    if (agenciaId && String(agenciaId).trim() && String(agenciaId).trim() !== 'null' && String(agenciaId).trim() !== 'undefined') {
      where.agenciaId = String(agenciaId).trim();
    } else if (regionId && String(regionId).trim() && String(regionId).trim() !== 'null' && String(regionId).trim() !== 'undefined') {
      where.OR = [
        { regionId: String(regionId).trim() },
        { agencia: { regionId: String(regionId).trim() } },
      ];
    }
    const list = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        lastname: true,
        email: true,
        regionId: true,
        region: { select: { id: true, nombre: true } },
        agenciaId: true,
        agencia: { select: { id: true, nombre: true, regionId: true, codigo: true } },
        role: { select: { id: true, namerol: true } },
      },
      orderBy: { name: 'asc' },
    });

    return list.map((p) => {
      // Pulidor fijo: asignado a una sucursal / agencia en la base de datos (p.agenciaId != null)
      const esFijo = Boolean(p.agenciaId || p.role?.namerol === 'PULIDOR_FIJO');
      return {
        id: p.id,
        name: p.name,
        lastname: p.lastname,
        email: p.email,
        regionId: p.regionId || p.agencia?.regionId || null,
        region: p.region,
        agenciaId: p.agenciaId || null,
        agencia: p.agencia || null,
        role: p.role,
        modalidad: (esFijo ? 'FIJO' : 'MOVIL') as 'FIJO' | 'MOVIL',
      };
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
