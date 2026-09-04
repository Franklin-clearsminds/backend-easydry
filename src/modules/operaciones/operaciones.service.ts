import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateServicioDto } from './dto/create-servicio.dto.js';
import { UpdateServicioDto } from './dto/update-servicio.dto.js';
import { ServiceStatus } from '@prisma/client';
import {
  AsignarRecetaDto,
  ListRecetaDto,
  EliminarRecetaItemDto,
  SimularConsumoDto,
} from './dto/receta.dto.js';

@Injectable()
export class OperacionesService {
  constructor(private prisma: PrismaService) {}

  // ============================================================
  //  SERVICIOS DE LAVADO
  // ============================================================

  async findAll(params?: { agenciaId?: string; sucursalId?: string; estado?: ServiceStatus; search?: string }) {
    const where: any = {};

    const targetAgencia = params?.agenciaId || params?.sucursalId;
    if (targetAgencia) {
      where.bahia = { agenciaId: targetAgencia };
    }

    if (params?.estado) {
      where.estado = params.estado;
    }

    if (params?.search) {
      const q = params.search.trim().toUpperCase();
      where.OR = [
        { placa: { contains: q } },
        { modelo: { contains: q, mode: 'insensitive' } },
        { cliente: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.servicioLavado.findMany({
      where,
      include: {
        bahia: {
          include: {
            agencia: {
              select: { id: true, nombre: true, codigo: true },
            },
          },
        },
        catalogo: {
          include: {
            recetas: {
              include: {
                insumo: { select: { codigoSKU: true, nombre: true } },
                unidadConsumo: { select: { codigo: true, simbolo: true } },
              },
            },
          },
        },
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const servicio = await this.prisma.servicioLavado.findFirst({
      where: {
        OR: [{ id }, { clientUuid: id }],
      },
      include: {
        bahia: {
          include: { agencia: true },
        },
        catalogo: {
          include: {
            recetas: {
              include: {
                insumo: { select: { id: true, codigoSKU: true, nombre: true, categoria: true, stockMinimoAgencia: true } },
                unidadConsumo: { select: { codigo: true, simbolo: true, factorBase: true } },
              },
            },
          },
        },
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        consumos: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
      },
    });

    if (!servicio) {
      throw new NotFoundException(`Servicio de lavado con ID ${id} no encontrado`);
    }

    return servicio;
  }

  async create(createDto: CreateServicioDto, operadorId: string) {
    const clientUuid = createDto.clientUuid || randomUUID();
    const now = new Date();

    return this.prisma.servicioLavado.create({
      data: {
        clientUuid,
        placa: createDto.placa.toUpperCase().trim(),
        modelo: createDto.modelo.trim(),
        color: createDto.color?.trim(),
        cliente: createDto.cliente?.trim(),
        estado: createDto.estado || ServiceStatus.EN_ESPERA,
        bahiaId: createDto.bahiaId,
        servicioCatalogoId: createDto.servicioCatalogoId,
        operadorId,
        horaIngreso: now,
        horaInicio: createDto.estado === ServiceStatus.EN_PROCESO ? now : null,
        fotoIngresoUrl: createDto.fotoIngresoUrl,
        fotoSalidaUrl: createDto.fotoSalidaUrl,
        observaciones: createDto.observaciones,
        syncedAt: now,
      },
      include: {
        bahia: {
          include: { agencia: { select: { id: true, nombre: true, codigo: true } } },
        },
        catalogo: {
          include: {
            recetas: {
              include: {
                insumo: { select: { codigoSKU: true, nombre: true } },
                unidadConsumo: { select: { codigo: true, simbolo: true } },
              },
            },
          },
        },
      },
    });
  }

  async update(id: string, updateDto: UpdateServicioDto) {
    const servicio = await this.findOne(id);
    const data: any = { ...updateDto };
    delete data.id;

    if (updateDto.estado === ServiceStatus.FINALIZADO && !servicio.horaSalida) {
      data.horaSalida = new Date();
    }

    data.version = servicio.version + 1;

    // ──────────────────────────────────────────────────────────────────
    // HOOK: Al finalizar un servicio, descontar insumos de la receta
    // ──────────────────────────────────────────────────────────────────
    if (
      updateDto.estado === ServiceStatus.FINALIZADO &&
      servicio.estado !== ServiceStatus.FINALIZADO
    ) {
      await this._ejecutarConsumoInsumos(servicio);
    }

    return this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data,
      include: {
        bahia: {
          include: { agencia: { select: { id: true, nombre: true, codigo: true } } },
        },
        catalogo: true,
        consumos: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
      },
    });
  }

  // ============================================================
  //  LÓGICA INTERNA: CONSUMO DE INSUMOS AL FINALIZAR
  // ============================================================

  /**
   * Convierte la cantidad consumida a la unidad base del insumo.
   * Usa factorBase de la unidad de consumo en la receta.
   * Para UNITARIO (U, PAQ): no hay conversión, la cantidad se usa directo.
   */
  private _convertirAUnidadBase(cantidadUsada: number, factorBase: number | null): number {
    if (!factorBase || factorBase === 1) return cantidadUsada;
    return cantidadUsada * factorBase;
  }

  /**
   * Obtiene el stock de la agencia donde se realizó el servicio.
   * La ubicación se determina por la agencia de la bahía.
   */
  private async _getStockAgencia(insumoId: string, agenciaId: string) {
    return this.prisma.stockUbicacion.findFirst({
      where: {
        insumoId,
        tipoUbicacion: 'AGENCIA',
        agenciaId,
      },
    });
  }

  private async _ejecutarConsumoInsumos(servicio: any) {
    const agenciaId = servicio.bahia?.agencia?.id;
    if (!agenciaId) {
      throw new BadRequestException(
        'No se puede finalizar el servicio: la bahía no tiene agencia asignada.',
      );
    }

    const recetas = servicio.catalogo?.recetas ?? [];
    if (recetas.length === 0) return; // Sin receta → sin descuento (servicio sin insumos configurados)

    // ── 1. VALIDACIÓN PREVIA: verificar stock antes de descontar cualquier cosa ──
    const faltantes: string[] = [];
    for (const receta of recetas) {
      if (receta.esOpcional) continue; // Los opcionales no bloquean

      const cantidadBaseNecesaria = this._convertirAUnidadBase(
        Number(receta.cantidadUsada),
        receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null,
      );

      const stock = await this._getStockAgencia(receta.insumoId, agenciaId);
      const disponible = Number(stock?.cantidadActual ?? 0);

      if (disponible < cantidadBaseNecesaria) {
        faltantes.push(
          `"${receta.insumo.nombre}": necesario ${cantidadBaseNecesaria.toFixed(4)} ${receta.unidadConsumo?.simbolo ?? ''}, disponible ${disponible.toFixed(4)}`,
        );
      }
    }

    if (faltantes.length > 0) {
      throw new BadRequestException(
        `❌ Stock insuficiente en la agencia para finalizar el servicio. Insumos faltantes:\n` +
          faltantes.map((f) => `  • ${f}`).join('\n'),
      );
    }

    // ── 2. DESCUENTO: iterar receta y descontar ──
    for (const receta of recetas) {
      const cantidadEnBase = this._convertirAUnidadBase(
        Number(receta.cantidadUsada),
        receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null,
      );

      const stock = await this._getStockAgencia(receta.insumoId, agenciaId);
      const disponible = Number(stock?.cantidadActual ?? 0);

      // Para opcionales: descontar solo lo disponible (puede quedar en 0)
      const cantidadADescontar = receta.esOpcional
        ? Math.min(cantidadEnBase, disponible)
        : cantidadEnBase;

      if (cantidadADescontar <= 0) continue;

      // Descontar del stock de agencia
      if (stock) {
        await this.prisma.stockUbicacion.update({
          where: { id: stock.id },
          data: { cantidadActual: { decrement: cantidadADescontar } },
        });
      }

      // Registrar en historial de consumo
      await this.prisma.consumoServicio.create({
        data: {
          servicioId: servicio.id,
          insumoId: receta.insumoId,
          cantidadUsada: cantidadADescontar,
          stockUbicacionId: stock?.id ?? null,
          agenciaId,
        },
      });

      // ── 3. AUTO-ALERTA: si el stock baja del mínimo, generar alerta ──
      if (stock) {
        const nuevoStock = disponible - cantidadADescontar;
        const minimoAgencia = Number(receta.insumo?.stockMinimoAgencia ?? 0);
        if (nuevoStock <= minimoAgencia && nuevoStock >= 0) {
          // Verificar si ya hay una alerta activa para este insumo+agencia
          const alertaExistente = await this.prisma.alertaStock.findFirst({
            where: {
              insumoId: receta.insumoId,
              agenciaId,
              estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
            },
          });
          if (!alertaExistente) {
            await this.prisma.alertaStock.create({
              data: {
                insumoId: receta.insumoId,
                nivel: nuevoStock === 0 ? 'AGOTADO' : nuevoStock < minimoAgencia * 0.5 ? 'CRITICO' : 'BAJO',
                agenciaId,
                usuarioEmisorId: servicio.operadorId,
                mensaje: `Stock bajo generado automáticamente al finalizar servicio ${servicio.id}. Stock actual: ${nuevoStock.toFixed(3)}`,
                stockReportado: nuevoStock,
              },
            });
          }
        }
      }
    }
  }

  // ============================================================
  //  SIMULACIÓN: previsualizar consumo antes de finalizar
  // ============================================================

  async simularConsumo(dto: SimularConsumoDto) {
    const servicio: any = await this.findOne(dto.servicioId);
    const agenciaId = servicio.bahia?.agencia?.id;

    if (!agenciaId) {
      throw new BadRequestException('La bahía del servicio no tiene agencia asignada');
    }

    const recetas = (servicio.catalogo as any)?.recetas ?? [];
    const resultado: {
      insumo: string;
      codigoSKU: string;
      cantidadNecesaria: number;
      unidad: string;
      cantidadEnBase: number;
      stockActual: number;
      suficiente: boolean;
      esOpcional: boolean;
      stockDespues: number;
    }[] = [];

    for (const receta of recetas) {
      const cantidadEnBase = this._convertirAUnidadBase(
        Number(receta.cantidadUsada),
        receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null,
      );
      const stock = await this._getStockAgencia(receta.insumoId, agenciaId);
      const disponible = Number(stock?.cantidadActual ?? 0);

      resultado.push({
        insumo: receta.insumo.nombre,
        codigoSKU: receta.insumo.codigoSKU,
        cantidadNecesaria: Number(receta.cantidadUsada),
        unidad: receta.unidadConsumo?.simbolo ?? '?',
        cantidadEnBase,
        stockActual: disponible,
        suficiente: disponible >= cantidadEnBase,
        esOpcional: receta.esOpcional,
        stockDespues: Math.max(0, disponible - cantidadEnBase),
      });
    }

    const puedeFinalizar = resultado.every((r) => r.suficiente || r.esOpcional);

    return {
      servicioId: dto.servicioId,
      catalogoNombre: (servicio.catalogo as any)?.nombre ?? '',
      agenciaNombre: servicio.bahia?.agencia?.nombre ?? '',
      puedeFinalizar,
      detalles: resultado,
    };
  }

  // ============================================================
  //  RECETAS DE INSUMOS POR CATÁLOGO DE SERVICIO
  // ============================================================

  async asignarReceta(dto: AsignarRecetaDto) {
    // Verificar que el catálogo existe
    const catalogo = await this.prisma.catalogoServicio.findUnique({
      where: { id: dto.catalogoServicioId },
    });
    if (!catalogo) {
      throw new NotFoundException(`Catálogo de servicio con ID ${dto.catalogoServicioId} no encontrado`);
    }

    // Validar insumos y unidades
    for (const item of dto.items) {
      const insumo = await this.prisma.insumo.findUnique({ where: { id: item.insumoId } });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${item.insumoId}" no encontrado`);

      const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: item.unidadConsumoId } });
      if (!unidad) throw new NotFoundException(`Unidad con ID "${item.unidadConsumoId}" no encontrada`);
    }

    // Upsert cada línea de receta
    const resultados = [];
    for (const item of dto.items) {
      const existing = await this.prisma.recetaInsumo.findUnique({
        where: {
          catalogoServicioId_insumoId: {
            catalogoServicioId: dto.catalogoServicioId,
            insumoId: item.insumoId,
          },
        },
      });

      if (existing) {
        const updated = await this.prisma.recetaInsumo.update({
          where: { id: existing.id },
          data: {
            cantidadUsada: item.cantidadUsada,
            unidadConsumoId: item.unidadConsumoId,
            esOpcional: item.esOpcional ?? false,
            observacion: item.observacion,
          },
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
            unidadConsumo: { select: { codigo: true, simbolo: true } },
          },
        });
        resultados.push(updated);
      } else {
        const created = await this.prisma.recetaInsumo.create({
          data: {
            catalogoServicioId: dto.catalogoServicioId,
            insumoId: item.insumoId,
            cantidadUsada: item.cantidadUsada,
            unidadConsumoId: item.unidadConsumoId,
            esOpcional: item.esOpcional ?? false,
            observacion: item.observacion,
          },
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
            unidadConsumo: { select: { codigo: true, simbolo: true } },
          },
        });
        resultados.push(created);
      }
    }

    return {
      catalogoServicioId: dto.catalogoServicioId,
      catalogoNombre: catalogo.nombre,
      categoria: catalogo.categoria,
      recetaActualizada: resultados,
    };
  }

  async listReceta(dto: ListRecetaDto) {
    const catalogo = await this.prisma.catalogoServicio.findUnique({
      where: { id: dto.catalogoServicioId },
      include: {
        recetas: {
          include: {
            insumo: {
              select: {
                id: true,
                codigoSKU: true,
                nombre: true,
                categoria: true,
                unidadMedida: { select: { codigo: true, simbolo: true } },
              },
            },
            unidadConsumo: { select: { id: true, codigo: true, nombre: true, simbolo: true, factorBase: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!catalogo) {
      throw new NotFoundException(`Catálogo de servicio con ID ${dto.catalogoServicioId} no encontrado`);
    }

    return catalogo;
  }

  async eliminarRecetaItem(dto: EliminarRecetaItemDto) {
    const receta = await this.prisma.recetaInsumo.findUnique({
      where: {
        catalogoServicioId_insumoId: {
          catalogoServicioId: dto.catalogoServicioId,
          insumoId: dto.insumoId,
        },
      },
    });

    if (!receta) {
      throw new NotFoundException(
        `No existe receta del insumo "${dto.insumoId}" en el catálogo ${dto.catalogoServicioId}`,
      );
    }

    await this.prisma.recetaInsumo.delete({ where: { id: receta.id } });
    return { ok: true, message: 'Insumo eliminado de la receta correctamente' };
  }
}
