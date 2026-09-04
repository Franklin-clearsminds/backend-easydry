import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateEnvaseDto, UpdateEnvaseDto, ListEnvasesDto } from './dto/envases.dto.js';
import { ListUnidadesDto, CreateUnidadDto, UpdateUnidadDto } from './dto/unidades.dto.js';
import { CreateInsumoDto, UpdateInsumoDto, ListInsumosDto } from './dto/insumos.dto.js';
import { ListStockDto, AjusteStockDto } from './dto/stock.dto.js';
import { RegistrarCompraDto, CrearDespachoDto, ConfirmarRecepcionDto, ListMovimientosDto } from './dto/movimientos.dto.js';
import { CrearAlertaDto, ListAlertasDto, AtenderAlertaDto } from './dto/alertas.dto.js';

@Injectable()
export class InventarioService {
  constructor(private prisma: PrismaService) {}

  // ============================================================
  //  TIPOS DE ENVASE
  // ============================================================

  async listEnvases(dto: ListEnvasesDto) {
    const where: any = {};
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.tipoEnvase.findMany({
      where,
      orderBy: { codigo: 'asc' },
      include: {
        _count: { select: { insumos: true } },
      },
    });
  }

  async createEnvase(dto: CreateEnvaseDto) {
    const exists = await this.prisma.tipoEnvase.findUnique({ where: { codigo: dto.codigo } });
    if (exists) throw new ConflictException(`Ya existe un envase con código "${dto.codigo}"`);
    return this.prisma.tipoEnvase.create({ data: { ...dto } });
  }

  async updateEnvase(dto: UpdateEnvaseDto) {
    const envase = await this.prisma.tipoEnvase.findUnique({ where: { id: dto.id } });
    if (!envase) throw new NotFoundException(`Tipo de envase con ID "${dto.id}" no encontrado`);
    const { id, ...data } = dto;
    return this.prisma.tipoEnvase.update({ where: { id }, data });
  }

  // ============================================================
  //  UNIDADES DE MEDIDA
  // ============================================================

  async listUnidades(dto: ListUnidadesDto) {
    const where: any = {};
    if (dto.tipo) where.tipo = dto.tipo;
    if (dto.estado !== undefined) where.estado = dto.estado;
    return this.prisma.unidadMedida.findMany({
      where,
      orderBy: { codigo: 'asc' },
      include: { _count: { select: { insumos: true } } },
    });
  }

  async createUnidad(dto: CreateUnidadDto) {
    const exists = await this.prisma.unidadMedida.findUnique({ where: { codigo: dto.codigo } });
    if (exists) throw new ConflictException(`Ya existe una unidad con código "${dto.codigo}"`);
    return this.prisma.unidadMedida.create({ data: { ...dto } });
  }

  async updateUnidad(dto: UpdateUnidadDto) {
    const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.id } });
    if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.id}" no encontrada`);
    const { id, ...data } = dto;
    return this.prisma.unidadMedida.update({ where: { id }, data });
  }

  // ============================================================
  //  INSUMOS (Catálogo Maestro)
  // ============================================================

  async listInsumos(dto: ListInsumosDto) {
    const where: any = {};
    if (dto.categoria) where.categoria = dto.categoria;
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.tipoEnvaseId) where.tipoEnvaseId = dto.tipoEnvaseId;
    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigoSKU: { contains: dto.search, mode: 'insensitive' } },
        { descripcion: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.insumo.findMany({
      where,
      orderBy: { codigoSKU: 'asc' },
      include: {
        tipoEnvase: { select: { id: true, codigo: true, nombre: true, capacidad: true, unidadBase: true } },
        unidadMedida: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
        _count: { select: { stocks: true, alertas: true } },
      },
    });
  }

  async detailInsumo(id: string) {
    const insumo = await this.prisma.insumo.findUnique({
      where: { id },
      include: {
        tipoEnvase: true,
        unidadMedida: true,
        stocks: {
          include: {
            agencia: { select: { id: true, codigo: true, nombre: true, region: true } },
            pulidor: { select: { id: true, name: true, lastname: true } },
          },
        },
        alertas: {
          where: { estado: { not: 'RESUELTO' } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });
    if (!insumo) throw new NotFoundException(`Insumo con ID "${id}" no encontrado`);
    return insumo;
  }

  async createInsumo(dto: CreateInsumoDto) {
    const exists = await this.prisma.insumo.findUnique({ where: { codigoSKU: dto.codigoSKU } });
    if (exists) throw new ConflictException(`Ya existe un insumo con SKU "${dto.codigoSKU}"`);

    const envase = await this.prisma.tipoEnvase.findUnique({ where: { id: dto.tipoEnvaseId } });
    if (!envase) throw new NotFoundException(`Tipo de envase con ID "${dto.tipoEnvaseId}" no encontrado`);

    const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.unidadMedidaId } });
    if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.unidadMedidaId}" no encontrada`);

    return this.prisma.insumo.create({ data: { ...dto } });
  }

  async updateInsumo(dto: UpdateInsumoDto) {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: dto.id } });
    if (!insumo) throw new NotFoundException(`Insumo con ID "${dto.id}" no encontrado`);

    if (dto.tipoEnvaseId) {
      const envase = await this.prisma.tipoEnvase.findUnique({ where: { id: dto.tipoEnvaseId } });
      if (!envase) throw new NotFoundException(`Tipo de envase con ID "${dto.tipoEnvaseId}" no encontrado`);
    }
    if (dto.unidadMedidaId) {
      const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.unidadMedidaId } });
      if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.unidadMedidaId}" no encontrada`);
    }
    const { id, ...data } = dto;
    return this.prisma.insumo.update({ where: { id }, data });
  }

  // ============================================================
  //  STOCK — Consulta multi-ubicación + ajuste manual
  // ============================================================

  async listStock(dto: ListStockDto, usuarioId: string, rolNombre: string, agenciaIdUsuario?: string) {
    const where: any = {};

    const rolesGlobales = ['SUPER_ADMIN', 'ADMIN', 'COORD_BODEGA'];
    const rolesRegion = ['SUPERVISOR_REGIONAL'];
    const rolesAgencia = ['LIDER_AGENCIA', 'PULIDOR_FIJO'];
    const rolesPulidor = ['PULIDOR_MOVIL'];

    if (rolesGlobales.includes(rolNombre)) {
      // Ve todo sin restricciones
    } else if (rolesRegion.includes(rolNombre)) {
      if (dto.sucursalId) {
        where.agenciaId = dto.sucursalId;
      } else if (agenciaIdUsuario) {
        const miAgencia = await this.prisma.agencia.findUnique({ where: { id: agenciaIdUsuario } });
        if (miAgencia) {
          const agenciasRegion = await this.prisma.agencia.findMany({
            where: { region: miAgencia.region },
            select: { id: true },
          });
          where.agenciaId = { in: agenciasRegion.map((s) => s.id) };
        }
      }
    } else if (rolesAgencia.includes(rolNombre)) {
      where.agenciaId = agenciaIdUsuario;
    } else if (rolesPulidor.includes(rolNombre)) {
      where.pulidorId = usuarioId;
    }

    if (dto.tipoUbicacion) where.tipoUbicacion = dto.tipoUbicacion;
    if (dto.insumoId) where.insumoId = dto.insumoId;

    const stocks = await this.prisma.stockUbicacion.findMany({
      where,
      include: {
        insumo: {
          select: {
            id: true,
            codigoSKU: true,
            nombre: true,
            categoria: true,
            stockMinimoBodega: true,
            stockMinimoAgencia: true,
            tipoEnvase: { select: { codigo: true, nombre: true, unidadBase: true } },
            unidadMedida: { select: { simbolo: true } },
          },
        },
        agencia: { select: { id: true, codigo: true, nombre: true, region: true } },
        pulidor: { select: { id: true, name: true, lastname: true } },
      },
      orderBy: [{ tipoUbicacion: 'asc' }, { insumoId: 'asc' }],
    });

    return stocks.map((s) => {
      const minimo =
        s.tipoUbicacion === 'BODEGA_CENTRAL'
          ? Number(s.insumo.stockMinimoBodega)
          : Number(s.insumo.stockMinimoAgencia);
      const actual = Number(s.cantidadActual);
      return {
        ...s,
        bajoMinimo: actual <= minimo,
        porcentajeStock: minimo > 0 ? Math.round((actual / minimo) * 100) : null,
      };
    }).filter((s) => (dto.bajominimo ? s.bajoMinimo : true));
  }

  async ajusteStock(dto: AjusteStockDto, usuarioId: string) {
    const stock = await this.prisma.stockUbicacion.findUnique({ where: { id: dto.stockUbicacionId } });
    if (!stock) throw new NotFoundException(`Registro de stock con ID "${dto.stockUbicacionId}" no encontrado`);

    const cantidadAnterior = Number(stock.cantidadActual);
    const cantidadNueva = dto.cantidadNueva;

    // Registrar movimiento de ajuste
    const guia = `AJUST-${Date.now()}`;
    await this.prisma.movimientoInventario.create({
      data: {
        numeroGuia: guia,
        tipo: 'AJUSTE_MERMA',
        estadoDespacho: 'RECIBIDO',
        origenUbicacion: stock.agenciaId ? `Agencia ID:${stock.agenciaId}` : `Pulidor ID:${stock.pulidorId ?? 'BODEGA'}`,
        destinoUbicacion: 'Ajuste Interno',
        usuarioDespachaId: usuarioId,
        observaciones: `[AJUSTE] ${dto.razon} | Anterior: ${cantidadAnterior} → Nuevo: ${cantidadNueva}`,
        detalles: {
          create: [{
            insumoId: stock.insumoId,
            cantidadEnviada: Math.abs(cantidadNueva - cantidadAnterior),
            cantidadRecibida: cantidadNueva,
          }],
        },
      },
    });

    return this.prisma.stockUbicacion.update({
      where: { id: dto.stockUbicacionId },
      data: { cantidadActual: cantidadNueva },
    });
  }

  // ============================================================
  //  MOVIMIENTOS — Compras, Despachos, Recepción
  // ============================================================

  private async _generarGuia(prefijo: string): Promise<string> {
    const anio = new Date().getFullYear();
    const count = await this.prisma.movimientoInventario.count({
      where: { numeroGuia: { startsWith: `${prefijo}-${anio}` } },
    });
    return `${prefijo}-${anio}-${String(count + 1).padStart(4, '0')}`;
  }

  async registrarCompra(dto: RegistrarCompraDto, usuarioId: string) {
    const guia = dto.numeroGuia ?? (await this._generarGuia('ING'));
    const existing = await this.prisma.movimientoInventario.findUnique({ where: { numeroGuia: guia } });
    if (existing) throw new ConflictException(`Ya existe un movimiento con guía "${guia}"`);

    // Validar que todos los insumos existan
    for (const det of dto.detalles) {
      const insumo = await this.prisma.insumo.findUnique({ where: { id: det.insumoId } });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${det.insumoId}" no encontrado`);
    }

    const movimiento = await this.prisma.movimientoInventario.create({
      data: {
        numeroGuia: guia,
        tipo: 'COMPRA_PROVEEDOR',
        estadoDespacho: 'RECIBIDO',
        origenUbicacion: dto.proveedorNombre,
        destinoUbicacion: dto.origenUbicacion ?? 'Bodega Central',
        usuarioDespachaId: usuarioId,
        fechaRecepcion: new Date(),
        observaciones: dto.observaciones,
        detalles: {
          create: dto.detalles.map((d) => ({
            insumoId: d.insumoId,
            cantidadEnviada: d.cantidadEnviada,
            cantidadRecibida: d.cantidadEnviada,
            costoUnitarioUSD: d.costoUnitarioUSD,
            subtotalUSD: d.costoUnitarioUSD ? d.costoUnitarioUSD * d.cantidadEnviada : null,
          })),
        },
      },
      include: { detalles: true },
    });

    // Incrementar stock en BODEGA_CENTRAL
    for (const det of dto.detalles) {
      const existing = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      if (existing) {
        await this.prisma.stockUbicacion.update({
          where: { id: existing.id },
          data: { cantidadActual: { increment: det.cantidadEnviada } },
        });
      } else {
        await this.prisma.stockUbicacion.create({
          data: {
            insumoId: det.insumoId,
            tipoUbicacion: 'BODEGA_CENTRAL',
            cantidadActual: det.cantidadEnviada,
          },
        });
      }
    }

    return movimiento;
  }

  async crearDespacho(dto: CrearDespachoDto, usuarioId: string) {
    // Validar destino
    let destinoLabel = '';
    if (dto.tipo === 'DESPACHO_AGENCIA') {
      if (!dto.sucursalDestinoId)
        throw new BadRequestException('Debe especificar sucursalDestinoId para DESPACHO_AGENCIA');
      const agencia = await this.prisma.agencia.findUnique({ where: { id: dto.sucursalDestinoId } });
      if (!agencia) throw new NotFoundException(`Agencia con ID "${dto.sucursalDestinoId}" no encontrada`);
      destinoLabel = `Agencia ${agencia.nombre}`;
    } else {
      if (!dto.pulidorDestinoId)
        throw new BadRequestException('Debe especificar pulidorDestinoId para DESPACHO_PULIDOR');
      const pulidor = await this.prisma.user.findUnique({ where: { id: dto.pulidorDestinoId } });
      if (!pulidor) throw new NotFoundException(`Pulidor con ID "${dto.pulidorDestinoId}" no encontrado`);
      destinoLabel = `${pulidor.name} ${pulidor.lastname} (Pulidor)`;
    }

    // Verificar stock disponible en bodega para cada insumo
    for (const det of dto.detalles) {
      const insumo = await this.prisma.insumo.findUnique({ where: { id: det.insumoId } });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${det.insumoId}" no encontrado`);

      const stockBodega = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      const disponible = Number(stockBodega?.cantidadActual ?? 0);
      if (disponible < det.cantidadEnviada) {
        throw new BadRequestException(
          `Stock insuficiente en bodega para "${insumo.nombre}": disponible ${disponible}, requerido ${det.cantidadEnviada}`,
        );
      }
    }

    const guia = dto.numeroGuia ?? (await this._generarGuia('DESP'));
    const existing = await this.prisma.movimientoInventario.findUnique({ where: { numeroGuia: guia } });
    if (existing) throw new ConflictException(`Ya existe un movimiento con guía "${guia}"`);

    const movimiento = await this.prisma.movimientoInventario.create({
      data: {
        numeroGuia: guia,
        tipo: dto.tipo,
        estadoDespacho: 'EN_TRANSITO',
        origenUbicacion: dto.origenUbicacion ?? 'Bodega Central',
        destinoUbicacion: destinoLabel,
        usuarioDespachaId: usuarioId,
        usuarioRecibeId: dto.pulidorDestinoId ?? null,
        observaciones: dto.observaciones,
        detalles: {
          create: dto.detalles.map((d) => ({
            insumoId: d.insumoId,
            cantidadEnviada: d.cantidadEnviada,
          })),
        },
      },
      include: { detalles: true },
    });

    // Descontar stock de BODEGA_CENTRAL
    for (const det of dto.detalles) {
      const stockBodega = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      if (stockBodega) {
        await this.prisma.stockUbicacion.update({
          where: { id: stockBodega.id },
          data: { cantidadActual: { decrement: det.cantidadEnviada } },
        });
      }
    }

    return movimiento;
  }

  async confirmarRecepcion(dto: ConfirmarRecepcionDto, usuarioId: string) {
    const movimiento = await this.prisma.movimientoInventario.findUnique({
      where: { id: dto.movimientoId },
      include: { detalles: true },
    });
    if (!movimiento) throw new NotFoundException(`Movimiento con ID "${dto.movimientoId}" no encontrado`);
    if (movimiento.estadoDespacho !== 'EN_TRANSITO') {
      throw new BadRequestException(`El movimiento ya tiene estado "${movimiento.estadoDespacho}" y no puede confirmarse`);
    }

    const nuevoEstado = dto.accion === 'RECIBIDO' ? 'RECIBIDO' : 'RECHAZADO';

    // Actualizar cantidades recibidas si se proveen
    if (dto.cantidadesRecibidas?.length) {
      for (const cr of dto.cantidadesRecibidas) {
        await this.prisma.movimientoDetalle.update({
          where: { id: cr.detalleId },
          data: { cantidadRecibida: cr.cantidadRecibida },
        });
      }
    } else if (dto.accion === 'RECIBIDO') {
      // Si no se proveen cantidades, se asume recepción completa
      for (const det of movimiento.detalles) {
        await this.prisma.movimientoDetalle.update({
          where: { id: det.id },
          data: { cantidadRecibida: det.cantidadEnviada },
        });
      }
    }

    await this.prisma.movimientoInventario.update({
      where: { id: dto.movimientoId },
      data: {
        estadoDespacho: nuevoEstado,
        fechaRecepcion: new Date(),
        usuarioRecibeId: usuarioId,
        observaciones: dto.observaciones
          ? `${movimiento.observaciones ?? ''} | RECEPCIÓN: ${dto.observaciones}`
          : movimiento.observaciones,
      },
    });

    // Si fue RECIBIDO: incrementar stock en destino
    if (dto.accion === 'RECIBIDO') {
      const detallesActualizados = await this.prisma.movimientoDetalle.findMany({
        where: { movimientoId: dto.movimientoId },
      });
      for (const det of detallesActualizados) {
        const cantidad = Number(det.cantidadRecibida ?? det.cantidadEnviada);

        if (movimiento.tipo === 'DESPACHO_AGENCIA') {
          // Obtener el ID de la sucursal destino desde el label (buscamos por nombre)
          // Mejor: guardamos en el movimiento la sucursal destino. Por ahora buscamos por usuarioRecibe
          // Solución: buscar stock de agencia del usuario receptor
          const receptor = await this.prisma.user.findUnique({ where: { id: usuarioId } });
          if (receptor?.agenciaId) {
            const stockAgencia = await this.prisma.stockUbicacion.findFirst({
              where: { insumoId: det.insumoId, tipoUbicacion: 'AGENCIA', agenciaId: receptor.agenciaId },
            });
            if (stockAgencia) {
              await this.prisma.stockUbicacion.update({
                where: { id: stockAgencia.id },
                data: { cantidadActual: { increment: cantidad } },
              });
            } else {
              await this.prisma.stockUbicacion.create({
                data: {
                  insumoId: det.insumoId,
                  tipoUbicacion: 'AGENCIA',
                  agenciaId: receptor.agenciaId,
                  cantidadActual: cantidad,
                },
              });
            }
          }
        } else if (movimiento.tipo === 'DESPACHO_PULIDOR') {
          const stockPulidor = await this.prisma.stockUbicacion.findFirst({
            where: { insumoId: det.insumoId, pulidorId: usuarioId, tipoUbicacion: { in: ['PULIDOR_MOVIL', 'PULIDOR_FIJO'] } },
          });
          if (stockPulidor) {
            await this.prisma.stockUbicacion.update({
              where: { id: stockPulidor.id },
              data: { cantidadActual: { increment: cantidad } },
            });
          } else {
            await this.prisma.stockUbicacion.create({
              data: {
                insumoId: det.insumoId,
                tipoUbicacion: 'PULIDOR_MOVIL',
                pulidorId: usuarioId,
                cantidadActual: cantidad,
              },
            });
          }
        }
      }
    } else {
      // Si fue RECHAZADO: devolver stock a bodega central
      for (const det of movimiento.detalles) {
        const stockBodega = await this.prisma.stockUbicacion.findFirst({
          where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
        });
        if (stockBodega) {
          await this.prisma.stockUbicacion.update({
            where: { id: stockBodega.id },
            data: { cantidadActual: { increment: Number(det.cantidadEnviada) } },
          });
        }
      }
    }

    return { ok: true, numeroGuia: movimiento.numeroGuia, nuevoEstado };
  }

  async listMovimientos(dto: ListMovimientosDto) {
    const where: any = {};
    if (dto.tipo) where.tipo = dto.tipo;
    if (dto.estadoDespacho) where.estadoDespacho = dto.estadoDespacho;
    if (dto.numeroGuia) where.numeroGuia = { contains: dto.numeroGuia, mode: 'insensitive' };
    if (dto.fechaDesde || dto.fechaHasta) {
      where.fechaDespacho = {};
      if (dto.fechaDesde) where.fechaDespacho.gte = new Date(dto.fechaDesde);
      if (dto.fechaHasta) where.fechaDespacho.lte = new Date(dto.fechaHasta);
    }

    return this.prisma.movimientoInventario.findMany({
      where,
      orderBy: { fechaDespacho: 'desc' },
      include: {
        detalles: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
        usuarioDespacha: { select: { id: true, name: true, lastname: true } },
        usuarioRecibe: { select: { id: true, name: true, lastname: true } },
      },
    });
  }

  // ============================================================
  //  ALERTAS DE STOCK
  // ============================================================

  async crearAlerta(dto: CrearAlertaDto, usuarioId: string) {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: dto.insumoId } });
    if (!insumo) throw new NotFoundException(`Insumo con ID "${dto.insumoId}" no encontrado`);

    return this.prisma.alertaStock.create({
      data: {
        insumoId: dto.insumoId,
        nivel: dto.nivel,
        agenciaId: (dto as any).agenciaId || dto.sucursalId,
        usuarioEmisorId: usuarioId,
        mensaje: dto.mensaje,
        stockReportado: dto.stockReportado,
      },
      include: {
        insumo: { select: { codigoSKU: true, nombre: true } },
        agencia: { select: { codigo: true, nombre: true } },
        usuarioEmisor: { select: { name: true, lastname: true } },
      },
    });
  }

  async listAlertas(dto: ListAlertasDto) {
    const where: any = {};
    if (dto.nivel) where.nivel = dto.nivel;
    if (dto.estado) where.estado = dto.estado;
    const targetAgencia = (dto as any).agenciaId || dto.sucursalId;
    if (targetAgencia) where.agenciaId = targetAgencia;
    return this.prisma.alertaStock.findMany({
      where,
      orderBy: [{ nivel: 'asc' }, { createdAt: 'desc' }],
      include: {
        insumo: { select: { codigoSKU: true, nombre: true, categoria: true } },
        agencia: { select: { codigo: true, nombre: true, region: true } },
        usuarioEmisor: { select: { name: true, lastname: true } },
      },
    });
  }

  async atenderAlerta(dto: AtenderAlertaDto) {
    const alerta = await this.prisma.alertaStock.findUnique({ where: { id: dto.id } });
    if (!alerta) throw new NotFoundException(`Alerta con ID "${dto.id}" no encontrada`);

    const estadosValidos = ['EN_PROCESO', 'DESPACHADO', 'RESUELTO'];
    if (!estadosValidos.includes(dto.estado)) {
      throw new BadRequestException(`Estado inválido "${dto.estado}". Válidos: ${estadosValidos.join(', ')}`);
    }

    return this.prisma.alertaStock.update({
      where: { id: dto.id },
      data: {
        estado: dto.estado as any,
        mensaje: dto.observacion ? `${alerta.mensaje ?? ''} | ${dto.observacion}` : alerta.mensaje,
        fechaAtencion: dto.estado === 'RESUELTO' ? new Date() : alerta.fechaAtencion,
      },
    });
  }

  // ============================================================
  //  RESUMEN EJECUTIVO DE STOCK (dashboard)
  // ============================================================

  async resumenStock(agenciaId?: string, pulidorId?: string) {
    const whereBodega: any = { tipoUbicacion: 'BODEGA_CENTRAL' };
    const whereAgencia: any = { tipoUbicacion: 'AGENCIA' };
    const wherePulidor: any = { tipoUbicacion: { in: ['PULIDOR_MOVIL', 'PULIDOR_FIJO'] } };

    if (agenciaId) whereAgencia.agenciaId = agenciaId;
    if (pulidorId) wherePulidor.pulidorId = pulidorId;

    const [totalInsumos, stocksBodega, stocksAgencia, stocksPulidor, alertasPendientes] = await Promise.all([
      this.prisma.insumo.count({ where: { estado: 1 } }),
      this.prisma.stockUbicacion.findMany({
        where: whereBodega,
        include: { insumo: { select: { nombre: true, stockMinimoBodega: true } } },
      }),
      this.prisma.stockUbicacion.findMany({
        where: whereAgencia,
        include: {
          insumo: { select: { nombre: true, stockMinimoAgencia: true } },
          agencia: { select: { nombre: true, region: true } },
        },
      }),
      this.prisma.stockUbicacion.findMany({
        where: wherePulidor,
        include: {
          insumo: { select: { nombre: true } },
          pulidor: { select: { name: true, lastname: true } },
        },
      }),
      this.prisma.alertaStock.count({ where: { estado: 'PENDIENTE' } }),
    ]);

    const bajoMinimoBodega = stocksBodega.filter(
      (s) => Number(s.cantidadActual) <= Number(s.insumo.stockMinimoBodega),
    ).length;
    const bajoMinimoAgencia = stocksAgencia.filter(
      (s) => Number(s.cantidadActual) <= Number(s.insumo.stockMinimoAgencia),
    ).length;

    return {
      totalInsumosCatalogo: totalInsumos,
      alertasPendientes,
      bodegaCentral: {
        totalRegistros: stocksBodega.length,
        bajoMinimo: bajoMinimoBodega,
      },
      agencias: {
        totalRegistros: stocksAgencia.length,
        bajoMinimo: bajoMinimoAgencia,
      },
      pulidores: {
        totalRegistros: stocksPulidor.length,
      },
    };
  }
}
