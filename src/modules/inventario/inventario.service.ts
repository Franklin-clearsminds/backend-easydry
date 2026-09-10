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
import { ListKardexDto } from './dto/kardex.dto.js';
import { CreateTipoProductoDto, UpdateTipoProductoDto, ListTiposProductoDto } from './dto/tipo-producto.dto.js';
import { CreatePresentacionDto, UpdatePresentacionDto, ListPresentacionesDto } from './dto/presentaciones.dto.js';
import { ListTiposMovimientoDto, ListMotivosDto, CreateMotivoDto, UpdateMotivoDto } from './dto/movimiento-catalogo.dto.js';
import { RegistrarMovimientoOperativoDto, ListMovimientosGlobalesDto, ListStockBajoDto } from './dto/movimiento-operacion.dto.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';

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
  //  TIPOS DE PRODUCTO (Catálogo Dinámico)
  // ============================================================

  async listTiposProducto(dto: ListTiposProductoDto) {
    const where: any = {};
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.tipoProducto.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: {
        _count: { select: { insumos: true } },
      },
    });
  }

  async createTipoProducto(dto: CreateTipoProductoDto) {
    const exists = await this.prisma.tipoProducto.findFirst({
      where: {
        OR: [
          { codigo: dto.codigo },
          { nombre: { equals: dto.nombre, mode: 'insensitive' } },
        ],
      },
    });
    if (exists) {
      throw new ConflictException(`Ya existe un tipo de producto con código "${dto.codigo}" o nombre "${dto.nombre}"`);
    }
    return this.prisma.tipoProducto.create({ data: { ...dto } });
  }

  async updateTipoProducto(dto: UpdateTipoProductoDto) {
    const item = await this.prisma.tipoProducto.findUnique({ where: { id: dto.id } });
    if (!item) throw new NotFoundException(`Tipo de producto con ID "${dto.id}" no encontrado`);
    const { id, ...data } = dto;
    return this.prisma.tipoProducto.update({ where: { id }, data });
  }

  // ============================================================
  //  UNIDADES DE MEDIDA
  // ============================================================

  async listUnidades(dto: ListUnidadesDto) {
    const where: any = {};
    if (dto.tipo) where.tipo = dto.tipo;
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
        { simbolo: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.unidadMedida.findMany({
      where,
      orderBy: { codigo: 'asc' },
      include: { _count: { select: { insumos: true, presentaciones: true } } },
    });
  }

  async createUnidad(dto: CreateUnidadDto) {
    const exists = await this.prisma.unidadMedida.findUnique({ where: { codigo: dto.codigo } });
    if (exists) throw new ConflictException(`Ya existe una unidad con código "${dto.codigo}"`);
    const factor = dto.factorBase ?? dto.factorLitro ?? null;
    return this.prisma.unidadMedida.create({
      data: {
        codigo: dto.codigo,
        nombre: dto.nombre,
        simbolo: dto.simbolo,
        tipo: dto.tipo,
        factorBase: factor,
        estado: dto.estado ?? 1,
      },
    });
  }

  async updateUnidad(dto: UpdateUnidadDto) {
    const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.id } });
    if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.id}" no encontrada`);
    const { id, factorLitro, ...data } = dto;
    if (data.factorBase === undefined && factorLitro !== undefined) {
      data.factorBase = factorLitro;
    }
    return this.prisma.unidadMedida.update({ where: { id }, data });
  }

  // ============================================================
  //  INSUMOS (Catálogo Maestro)
  // ============================================================

  async listInsumos(dto: ListInsumosDto) {
    const where: any = {};
    if (dto.categoria) where.categoria = dto.categoria;
    if (dto.tipoProductoId) where.tipoProductoId = dto.tipoProductoId;
    if (dto.estado !== undefined) where.estado = dto.estado;
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
        tipoProducto: { select: { id: true, codigo: true, nombre: true } },
        unidadMedida: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
        presentaciones: {
          where: { estado: 1 },
          include: { unidad: { select: { id: true, codigo: true, simbolo: true, nombre: true } } },
        },
        _count: { select: { stocks: true, alertas: true, presentaciones: true } },
      },
    });
  }

  async detailInsumo(id: string) {
    const insumo = await this.prisma.insumo.findUnique({
      where: { id },
      include: {
        tipoProducto: true,
        unidadMedida: true,
        presentaciones: {
          include: { unidad: true },
          orderBy: { nombre: 'asc' },
        },
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

    const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.unidadMedidaId } });
    if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.unidadMedidaId}" no encontrada`);

    if (dto.tipoProductoId) {
      const tipoProd = await this.prisma.tipoProducto.findUnique({ where: { id: dto.tipoProductoId } });
      if (!tipoProd) throw new NotFoundException(`Tipo de producto con ID "${dto.tipoProductoId}" no encontrado`);
    }

    return this.prisma.insumo.create({
      data: { ...dto },
      include: {
        tipoProducto: true,
        unidadMedida: true,
      },
    });
  }

  async updateInsumo(dto: UpdateInsumoDto) {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: dto.id } });
    if (!insumo) throw new NotFoundException(`Insumo con ID "${dto.id}" no encontrado`);

    if (dto.unidadMedidaId) {
      const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.unidadMedidaId } });
      if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.unidadMedidaId}" no encontrada`);
    }
    if (dto.tipoProductoId) {
      const tipoProd = await this.prisma.tipoProducto.findUnique({ where: { id: dto.tipoProductoId } });
      if (!tipoProd) throw new NotFoundException(`Tipo de producto con ID "${dto.tipoProductoId}" no encontrado`);
    }

    const { id, ...data } = dto;
    return this.prisma.insumo.update({
      where: { id },
      data,
      include: {
        tipoProducto: true,
        unidadMedida: true,
      },
    });
  }

  // ============================================================
  //  STOCK — Consulta multi-ubicación + ajuste manual
  // ============================================================

  async listStock(dto: ListStockDto, usuarioId: string, rolNombre: string, agenciaIdUsuario?: string) {
    const where: any = {};

    const rolesGlobales = ['SUPER_ADMIN', 'ADMIN', 'COORD_BODEGA'];
    const rolesRegion = ['SUPERVISOR_REGIONAL'];
    const rolesAgencia = ['LIDER_AGENCIA', 'LIDER_OPERADOR', 'PULIDOR_FIJO'];
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

    const updated = await this.prisma.stockUbicacion.update({
      where: { id: dto.stockUbicacionId },
      data: { cantidadActual: cantidadNueva },
    });

    await this.prisma.kardexMovimiento.create({
      data: {
        insumoId: stock.insumoId,
        ubicacionId: stock.agenciaId || 'BODEGA_CENTRAL',
        tipoMovimiento: 'AJUSTE_MERMA',
        cantidad: cantidadNueva - cantidadAnterior,
        stockAnterior: cantidadAnterior,
        stockPosterior: cantidadNueva,
        referenciaId: guia,
        usuarioId,
      },
    });

    return updated;
  }


  async obtenerStockAgenciasResumen(dto: { agenciaId?: string; region?: string } = {}) {
    const whereAgencia: any = { estado: 1 };
    if (dto.agenciaId) whereAgencia.id = dto.agenciaId;
    if (dto.region) whereAgencia.region = dto.region;

    const [agencias, insumos, stocksUbicacion] = await Promise.all([
      this.prisma.agencia.findMany({
        where: whereAgencia,
        orderBy: { nombre: 'asc' },
        select: {
          id: true,
          codigo: true,
          nombre: true,
          region: true,
          direccion: true,
          numeroBahias: true,
        },
      }),
      this.prisma.insumo.findMany({
        where: { estado: 1 },
        include: {
          tipoProducto: { select: { id: true, nombre: true } },
          unidadMedida: { select: { id: true, simbolo: true, nombre: true } },
        },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.stockUbicacion.findMany({
        where: { tipoUbicacion: 'AGENCIA' },
      }),
    ]);

    const stockMap = new Map<string, number>();
    for (const s of stocksUbicacion) {
      if (s.agenciaId) {
        stockMap.set(`${s.agenciaId}_${s.insumoId}`, Number(s.cantidadActual));
      }
    }

    let agenciasEnAlerta = 0;
    let insumosCriticosTotal = 0;

    const agenciasData = agencias.map((ag) => {
      let alertaAgencia = false;
      let criticosAgencia = 0;

      const insumosAgencia = insumos.map((ins) => {
        const actual = stockMap.get(`${ag.id}_${ins.id}`) ?? 0;
        const minimo = Number(ins.stockMinimoAgencia) || 2;
        let estado: 'Óptimo' | 'Bajo' | 'Crítico' | 'Sin Stock' = 'Óptimo';

        if (actual <= 0) {
          estado = 'Sin Stock';
          alertaAgencia = true;
          criticosAgencia++;
          insumosCriticosTotal++;
        } else if (actual < minimo) {
          estado = 'Crítico';
          alertaAgencia = true;
          criticosAgencia++;
          insumosCriticosTotal++;
        } else if (actual <= minimo * 1.2) {
          estado = 'Bajo';
          alertaAgencia = true;
        }

        const deficit = actual < minimo ? minimo - actual : 0;

        return {
          insumoId: ins.id,
          codigoSKU: ins.codigoSKU,
          nombre: ins.nombre,
          tipoProducto: ins.tipoProducto?.nombre || 'General',
          unidad: ins.unidadMedida?.simbolo || 'u',
          stockActual: actual,
          stockMinimo: minimo,
          deficit,
          estado,
        };
      });

      if (alertaAgencia) agenciasEnAlerta++;

      return {
        agencia: ag,
        totalInsumos: insumosAgencia.length,
        insumosCriticos: criticosAgencia,
        tieneAlerta: alertaAgencia,
        insumos: insumosAgencia,
      };
    });

    return {
      totalAgencias: agencias.length,
      agenciasEnAlerta,
      insumosCriticosTotal,
      agencias: agenciasData,
    };
  }

  async obtenerStockBodegasResumen(dto: { bodegaId?: string } = {}) {
    const insumos = await this.prisma.insumo.findMany({
      where: { estado: 1 },
      include: {
        tipoProducto: { select: { id: true, nombre: true } },
        unidadMedida: { select: { id: true, simbolo: true, nombre: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    let totalBajoMinimo = 0;
    let stockTotalUnidades = 0;

    const insumosBodega = insumos.map((ins) => {
      const actual = Number(ins.stockActual) || 0;
      const cNeto = Number(ins.contenidoNeto) || 1;
      const minimo = Number(ins.stockMinimoBodega) || 10;
      const optimo = Number(ins.stockOptimoBodega) || 50;
      stockTotalUnidades += Math.round((actual / cNeto) * 100) / 100;

      let estado: 'Óptimo' | 'Bajo' | 'Crítico' | 'Agotado' = 'Óptimo';
      if (actual <= 0) {
        estado = 'Agotado';
        totalBajoMinimo++;
      } else if (actual < minimo) {
        estado = 'Crítico';
        totalBajoMinimo++;
      } else if (actual <= minimo * 1.2) {
        estado = 'Bajo';
        totalBajoMinimo++;
      }

      return {
        insumoId: ins.id,
        codigoSKU: ins.codigoSKU,
        nombre: ins.nombre,
        tipoProducto: ins.tipoProducto?.nombre || 'General',
        unidad: ins.unidadMedida?.simbolo || 'u',
        contenidoNeto: cNeto,
        stockActual: actual,
        stockMinimo: minimo,
        stockOptimo: optimo,
        estado,
      };
    });

    return {
      bodega: {
        id: 'bod_central',
        codigo: 'BOD-CENTRAL',
        nombre: 'Bodega Central Nacional',
        ciudad: 'Quito',
        region: 'Pichincha',
        esCentral: true,
        activa: true,
      },
      metricas: {
        totalInsumos: insumosBodega.length,
        stockTotalUnidades,
        insumosBajoMinimo: totalBajoMinimo,
        insumosOptimos: insumosBodega.length - totalBajoMinimo,
      },
      insumos: insumosBodega,
    };
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

    // Incrementar stock en BODEGA_CENTRAL y registrar Kardex
    for (const det of dto.detalles) {
      const existing = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      const stockAnt = existing ? Number(existing.cantidadActual) : 0;
      const stockPost = stockAnt + Number(det.cantidadEnviada);

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

      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId: det.insumoId,
          ubicacionId: 'BODEGA_CENTRAL',
          tipoMovimiento: 'COMPRA_INGRESO',
          cantidad: det.cantidadEnviada,
          stockAnterior: stockAnt,
          stockPosterior: stockPost,
          costoUnitario: det.costoUnitarioUSD,
          costoTotal: det.costoUnitarioUSD ? det.costoUnitarioUSD * det.cantidadEnviada : null,
          referenciaId: movimiento.numeroGuia,
          usuarioId,
        },
      });
    }

    return movimiento;
  }

  async crearDespacho(dto: CrearDespachoDto, usuarioId: string) {
    // Validar destino
    let destinoLabel = '';
    const targetAgenciaId = dto.sucursalDestinoId || dto.agenciaId;
    if (dto.tipo === 'DESPACHO_AGENCIA') {
      if (!targetAgenciaId)
        throw new BadRequestException('Debe especificar sucursalDestinoId o agenciaId para DESPACHO_AGENCIA');
      const agencia = await this.prisma.agencia.findUnique({ where: { id: targetAgenciaId } });
      if (!agencia) throw new NotFoundException(`Agencia con ID "${targetAgenciaId}" no encontrada`);
      destinoLabel = `Agencia ${agencia.nombre} [${agencia.id}]`;
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

    // Descontar stock de BODEGA_CENTRAL y registrar Kardex de salida
    for (const det of dto.detalles) {
      const stockBodega = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      const stockAnt = Number(stockBodega?.cantidadActual ?? 0);
      const stockPost = stockAnt - Number(det.cantidadEnviada);

      if (stockBodega) {
        await this.prisma.stockUbicacion.update({
          where: { id: stockBodega.id },
          data: { cantidadActual: { decrement: det.cantidadEnviada } },
        });
      }

      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId: det.insumoId,
          ubicacionId: 'BODEGA_CENTRAL',
          tipoMovimiento: 'DESPACHO_SALIDA',
          cantidad: -Number(det.cantidadEnviada),
          stockAnterior: stockAnt,
          stockPosterior: stockPost,
          referenciaId: movimiento.numeroGuia,
          usuarioId,
        },
      });
    }

    return movimiento;
  }

  async confirmarRecepcion(dto: ConfirmarRecepcionDto, usuarioId: string) {
    const movimiento = await this.prisma.movimientoInventario.findFirst({
      where: {
        OR: [{ id: dto.movimientoId }, { numeroGuia: dto.movimientoId }],
      },
      include: { detalles: true },
    });
    if (!movimiento) throw new NotFoundException(`Movimiento con ID/Guía "${dto.movimientoId}" no encontrado`);
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
      where: { id: movimiento.id },
      data: {
        estadoDespacho: nuevoEstado,
        fechaRecepcion: new Date(),
        usuarioRecibeId: usuarioId,
        observaciones: dto.observaciones
          ? `${movimiento.observaciones ?? ''} | RECEPCIÓN: ${dto.observaciones}`
          : movimiento.observaciones,
      },
    });

    // Si fue RECIBIDO: incrementar stock en destino y registrar Kardex de entrada
    if (dto.accion === 'RECIBIDO') {
      const detallesActualizados = await this.prisma.movimientoDetalle.findMany({
        where: { movimientoId: movimiento.id },
      });

      // Extraer ID de la agencia destino
      let targetAgenciaId = dto.agenciaId || dto.sucursalId;
      if (!targetAgenciaId && movimiento.destinoUbicacion.includes('[')) {
        const match = movimiento.destinoUbicacion.match(/\[(.*?)\]/);
        if (match && match[1]) targetAgenciaId = match[1];
      }
      if (!targetAgenciaId) {
        const receptor = await this.prisma.user.findUnique({ where: { id: usuarioId } });
        targetAgenciaId = receptor?.agenciaId || undefined;
      }

      for (const det of detallesActualizados) {
        const cantidad = Number(det.cantidadRecibida ?? det.cantidadEnviada);

        if (movimiento.tipo === 'DESPACHO_AGENCIA') {
          if (targetAgenciaId) {
            const stockAgencia = await this.prisma.stockUbicacion.findFirst({
              where: { insumoId: det.insumoId, tipoUbicacion: 'AGENCIA', agenciaId: targetAgenciaId },
            });
            const stockAnt = Number(stockAgencia?.cantidadActual ?? 0);
            const stockPost = stockAnt + cantidad;

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
                  agenciaId: targetAgenciaId,
                  cantidadActual: cantidad,
                },
              });
            }

            await this.prisma.kardexMovimiento.create({
              data: {
                insumoId: det.insumoId,
                ubicacionId: targetAgenciaId,
                tipoMovimiento: 'DESPACHO_ENTRADA',
                cantidad,
                stockAnterior: stockAnt,
                stockPosterior: stockPost,
                referenciaId: movimiento.numeroGuia,
                usuarioId,
              },
            });
          }
        } else if (movimiento.tipo === 'DESPACHO_PULIDOR') {
          const stockPulidor = await this.prisma.stockUbicacion.findFirst({
            where: { insumoId: det.insumoId, pulidorId: usuarioId, tipoUbicacion: { in: ['PULIDOR_MOVIL', 'PULIDOR_FIJO'] } },
          });
          const stockAnt = Number(stockPulidor?.cantidadActual ?? 0);
          const stockPost = stockAnt + cantidad;

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

          await this.prisma.kardexMovimiento.create({
            data: {
              insumoId: det.insumoId,
              ubicacionId: `PULIDOR_${usuarioId}`,
              tipoMovimiento: 'DESPACHO_ENTRADA',
              cantidad,
              stockAnterior: stockAnt,
              stockPosterior: stockPost,
              referenciaId: movimiento.numeroGuia,
              usuarioId,
            },
          });
        }
      }
    } else {
      // Si fue RECHAZADO: devolver stock a bodega central y registrar Kardex
      for (const det of movimiento.detalles) {
        const stockBodega = await this.prisma.stockUbicacion.findFirst({
          where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
        });
        const stockAnt = Number(stockBodega?.cantidadActual ?? 0);
        const stockPost = stockAnt + Number(det.cantidadEnviada);

        if (stockBodega) {
          await this.prisma.stockUbicacion.update({
            where: { id: stockBodega.id },
            data: { cantidadActual: { increment: Number(det.cantidadEnviada) } },
          });
        }

        await this.prisma.kardexMovimiento.create({
          data: {
            insumoId: det.insumoId,
            ubicacionId: 'BODEGA_CENTRAL',
            tipoMovimiento: 'DESPACHO_RECHAZADO',
            cantidad: Number(det.cantidadEnviada),
            stockAnterior: stockAnt,
            stockPosterior: stockPost,
            referenciaId: movimiento.numeroGuia,
            usuarioId,
          },
        });
      }
    }

    return { ok: true, numeroGuia: movimiento.numeroGuia, nuevoEstado };
  }

  async rechazarDespacho(dto: { movimientoId: string; motivo?: string }, usuarioId: string) {
    return this.confirmarRecepcion(
      {
        movimientoId: dto.movimientoId,
        accion: 'RECHAZADO',
        observaciones: dto.motivo || 'Despacho rechazado por el receptor en agencia',
      },
      usuarioId,
    );
  }

  async listDespachos(dto: ListMovimientosDto) {
    const filter = { ...dto };
    if (!filter.tipo) {
      // Por defecto listar ambos tipos de despachos
      return this.prisma.movimientoInventario.findMany({
        where: {
          tipo: { in: ['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR'] },
          ...(dto.estadoDespacho ? { estadoDespacho: dto.estadoDespacho as any } : {}),
          ...(dto.numeroGuia ? { numeroGuia: { contains: dto.numeroGuia, mode: 'insensitive' } } : {}),
        },
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
    return this.listMovimientos(filter);
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

  // ============================================================
  //  KARDEX — Auditoría Contable y Trazabilidad Transaccional
  // ============================================================

  async listKardex(dto: ListKardexDto) {
    const page = dto.page ? Number(dto.page) : 1;
    const pageSize = dto.pageSize ? Number(dto.pageSize) : 20;
    const skip = (page - 1) * pageSize;

    const where: any = {};
    if (dto.insumoId) where.insumoId = dto.insumoId;
    if (dto.ubicacionId) where.ubicacionId = dto.ubicacionId;
    if (dto.tipoMovimiento) where.tipoMovimiento = dto.tipoMovimiento;
    if (dto.fechaDesde || dto.fechaHasta) {
      where.fecha = {};
      if (dto.fechaDesde) where.fecha.gte = new Date(dto.fechaDesde);
      if (dto.fechaHasta) where.fecha.lte = new Date(dto.fechaHasta);
    }

    const sortField = dto.sortField && dto.sortField !== 'createdAt' ? dto.sortField : 'fecha';
    const sortOrder = dto.sortOrder || 'desc';

    const [items, total] = await Promise.all([
      this.prisma.kardexMovimiento.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortField]: sortOrder },
        include: {
          insumo: {
            select: {
              id: true,
              codigoSKU: true,
              nombre: true,
              categoria: true,
              unidadMedida: { select: { simbolo: true } },
            },
          },
          usuario: {
            select: { id: true, name: true, lastname: true, email: true },
          },
        },
      }),
      this.prisma.kardexMovimiento.count({ where }),
    ]);

    return buildDataGridResponse(items, total, page, pageSize);
  }

  // ============================================================
  //  PRESENTACIONES DEL PRODUCTO (Catálogo Dinámico por Insumo)
  // ============================================================

  async listPresentaciones(dto: ListPresentacionesDto) {
    const where: any = {};
    if (dto.insumoId) where.insumoId = dto.insumoId;
    if (dto.estado !== undefined) where.estado = dto.estado;

    return this.prisma.presentacionInsumo.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: {
        unidad: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
        insumo: { select: { id: true, codigoSKU: true, nombre: true } },
      },
    });
  }

  async createPresentacion(dto: CreatePresentacionDto) {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: dto.insumoId } });
    if (!insumo) throw new NotFoundException(`Insumo con ID "${dto.insumoId}" no encontrado`);

    const unidad = await this.prisma.unidadMedida.findUnique({ where: { id: dto.unidadId } });
    if (!unidad) throw new NotFoundException(`Unidad de medida con ID "${dto.unidadId}" no encontrada`);

    return this.prisma.presentacionInsumo.create({
      data: {
        insumoId: dto.insumoId,
        nombre: dto.nombre,
        unidadId: dto.unidadId,
        cantidad: dto.cantidad,
        factorAUnidadBase: dto.factorAUnidadBase,
        estado: dto.estado ?? 1,
      },
      include: {
        unidad: true,
      },
    });
  }

  async updatePresentacion(dto: UpdatePresentacionDto) {
    const pres = await this.prisma.presentacionInsumo.findUnique({ where: { id: dto.id } });
    if (!pres) throw new NotFoundException(`Presentación con ID "${dto.id}" no encontrada`);
    const { id, ...data } = dto;
    return this.prisma.presentacionInsumo.update({
      where: { id },
      data,
      include: { unidad: true },
    });
  }

  // ============================================================
  //  TIPOS Y MOTIVOS DE MOVIMIENTO DE INVENTARIO
  // ============================================================

  async listTiposMovimiento(dto: ListTiposMovimientoDto) {
    const where: any = {};
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.esEntrada !== undefined) where.esEntrada = dto.esEntrada;

    return this.prisma.tipoMovimientoInventario.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: {
        _count: { select: { motivos: true, movimientos: true } },
      },
    });
  }

  async listMotivos(dto: ListMotivosDto) {
    const where: any = {};
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.tipoMovimientoId) where.tipoMovimientoId = dto.tipoMovimientoId;
    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.motivoMovimientoInventario.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: {
        tipoMovimiento: { select: { id: true, codigo: true, nombre: true, esEntrada: true } },
      },
    });
  }

  async createMotivo(dto: CreateMotivoDto) {
    const exists = await this.prisma.motivoMovimientoInventario.findUnique({ where: { codigo: dto.codigo } });
    if (exists) throw new ConflictException(`Ya existe un motivo con código "${dto.codigo}"`);

    if (dto.tipoMovimientoId) {
      const tipo = await this.prisma.tipoMovimientoInventario.findUnique({ where: { id: dto.tipoMovimientoId } });
      if (!tipo) throw new NotFoundException('Tipo de movimiento no encontrado');
    }

    return this.prisma.motivoMovimientoInventario.create({
      data: { ...dto },
      include: { tipoMovimiento: true },
    });
  }

  async updateMotivo(dto: UpdateMotivoDto) {
    const motivo = await this.prisma.motivoMovimientoInventario.findUnique({ where: { id: dto.id } });
    if (!motivo) throw new NotFoundException(`Motivo con ID "${dto.id}" no encontrado`);
    const { id, ...data } = dto;
    return this.prisma.motivoMovimientoInventario.update({ where: { id }, data });
  }

  // ============================================================
  //  MOVIMIENTOS DE INVENTARIO (Kardex Atómico Transaccional)
  // ============================================================

  async registrarMovimientoGlobal(dto: RegistrarMovimientoOperativoDto, usuarioId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Obtener producto y validar
      const insumo = await tx.insumo.findUnique({
        where: { id: dto.insumoId },
        include: { unidadMedida: true },
      });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${dto.insumoId}" no encontrado`);

      // 2. Obtener tipo de movimiento
      const tipoMov = await tx.tipoMovimientoInventario.findUnique({
        where: { id: dto.tipoMovimientoId },
      });
      if (!tipoMov) throw new NotFoundException(`Tipo de movimiento con ID "${dto.tipoMovimientoId}" no encontrado`);

      // 3. Validar motivo si viene especificado
      if (dto.motivoId) {
        const motivo = await tx.motivoMovimientoInventario.findUnique({ where: { id: dto.motivoId } });
        if (!motivo) throw new NotFoundException(`Motivo con ID "${dto.motivoId}" no encontrado`);
      }

      // 4. Calcular cantidad real en unidad base
      let cantidadBase = Number(dto.cantidad);
      let presentacion: any = null;

      if (dto.presentacionId) {
        presentacion = await tx.presentacionInsumo.findUnique({
          where: { id: dto.presentacionId },
        });
        if (!presentacion || presentacion.insumoId !== insumo.id) {
          throw new BadRequestException('La presentación seleccionada no corresponde al producto');
        }
        cantidadBase = Number(dto.cantidad) * Number(presentacion.factorAUnidadBase);
      }

      // 5. Validar disponibilidad de stock para salidas / consumos
      const stockAnterior = Number(insumo.stockActual);
      let nuevoStock: number;
      let deltaBase: number;

      if (!tipoMov.esEntrada) {
        if (stockAnterior < cantidadBase) {
          const unidadSimbolo = insumo.unidadMedida?.simbolo || insumo.unidadMedida?.nombre || '';
          throw new BadRequestException(
            `Stock insuficiente. Disponible: ${stockAnterior} ${unidadSimbolo}. Intento de consumo: ${cantidadBase} ${unidadSimbolo}.`,
          );
        }
        nuevoStock = stockAnterior - cantidadBase;
        deltaBase = -cantidadBase;
      } else {
        nuevoStock = stockAnterior + cantidadBase;
        deltaBase = cantidadBase;
      }

      // 6. Generar comprobante único
      const numeroComprobante = `MOV-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

      // 7. Registrar en MovimientoInventarioGlobal
      const movGlobal = await tx.movimientoInventarioGlobal.create({
        data: {
          numeroComprobante,
          tipoMovimientoId: tipoMov.id,
          insumoId: insumo.id,
          cantidad: dto.cantidad,
          unidadId: dto.unidadId,
          cantidadBase: deltaBase,
          stockAnterior,
          stockNuevo: nuevoStock,
          presentacionId: dto.presentacionId || null,
          ubicacionId: dto.ubicacionId || null,
          responsableId: usuarioId || null,
          motivoId: dto.motivoId || null,
          referencia: dto.referencia || null,
          observaciones: dto.observaciones || null,
        },
        include: {
          insumo: { select: { id: true, codigoSKU: true, nombre: true } },
          tipoMovimiento: true,
          unidad: true,
          presentacion: true,
          motivo: true,
          responsable: { select: { id: true, name: true, lastname: true, email: true } },
        },
      });

      // 8. Registrar en KardexMovimiento para trazabilidad contable
      await tx.kardexMovimiento.create({
        data: {
          insumoId: insumo.id,
          ubicacionId: dto.ubicacionId || 'BODEGA_CENTRAL',
          tipoMovimiento: tipoMov.codigo,
          cantidad: deltaBase,
          stockAnterior,
          stockPosterior: nuevoStock,
          costoUnitario: insumo.costoUnitarioUSD,
          costoTotal: Number(insumo.costoUnitarioUSD) * (Math.abs(deltaBase) / (Number(insumo.contenidoNeto) || 1)),
          referenciaId: movGlobal.numeroComprobante,
          usuarioId: usuarioId || null,
        },
      });

      // 9. Actualizar stock actual en el catálogo del Insumo
      await tx.insumo.update({
        where: { id: insumo.id },
        data: { stockActual: nuevoStock },
      });

      // 10. Actualizar existencias en ubicación
      const ubicacionTarget = dto.ubicacionId ? 'AGENCIA' : 'BODEGA_CENTRAL';
      const stockUbic = await tx.stockUbicacion.findFirst({
        where: {
          insumoId: insumo.id,
          tipoUbicacion: ubicacionTarget,
          ...(dto.ubicacionId ? { agenciaId: dto.ubicacionId } : {}),
        },
      });

      if (stockUbic) {
        const cantUbic = Number(stockUbic.cantidadActual) + deltaBase;
        await tx.stockUbicacion.update({
          where: { id: stockUbic.id },
          data: { cantidadActual: Math.max(0, cantUbic) },
        });
      } else {
        await tx.stockUbicacion.create({
          data: {
            insumoId: insumo.id,
            tipoUbicacion: ubicacionTarget,
            agenciaId: dto.ubicacionId || null,
            cantidadActual: Math.max(0, nuevoStock),
            cantidadMinima: insumo.stockMinimoBodega,
          },
        });
      }

      return movGlobal;
    });
  }

  async listMovimientosGlobales(dto: ListMovimientosGlobalesDto) {
    const page = dto.page || 1;
    const pageSize = dto.pageSize || 20;
    const skip = (page - 1) * pageSize;
    const sortField = dto.sortField || 'fechaMovimiento';
    const sortOrder = dto.sortOrder || 'desc';

    const where: any = {};
    if (dto.insumoId) where.insumoId = dto.insumoId;
    if (dto.tipoMovimientoId) where.tipoMovimientoId = dto.tipoMovimientoId;
    if (dto.fechaDesde || dto.fechaHasta) {
      where.fechaMovimiento = {};
      if (dto.fechaDesde) where.fechaMovimiento.gte = new Date(dto.fechaDesde);
      if (dto.fechaHasta) where.fechaMovimiento.lte = new Date(dto.fechaHasta);
    }
    if (dto.search) {
      where.OR = [
        { numeroComprobante: { contains: dto.search, mode: 'insensitive' } },
        { referencia: { contains: dto.search, mode: 'insensitive' } },
        { insumo: { nombre: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.movimientoInventarioGlobal.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortField]: sortOrder },
        include: {
          insumo: {
            select: {
              id: true,
              codigoSKU: true,
              nombre: true,
              unidadMedida: { select: { simbolo: true, nombre: true } },
            },
          },
          tipoMovimiento: { select: { id: true, codigo: true, nombre: true, esEntrada: true } },
          unidad: { select: { id: true, simbolo: true, nombre: true } },
          presentacion: { select: { id: true, nombre: true, factorAUnidadBase: true } },
          motivo: { select: { id: true, nombre: true, codigo: true } },
          responsable: { select: { id: true, name: true, lastname: true, email: true } },
        },
      }),
      this.prisma.movimientoInventarioGlobal.count({ where }),
    ]);

    return buildDataGridResponse(items, total, page, pageSize);
  }

  async obtenerResumenDashboard() {
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

    const [
      totalProductos,
      productosStockBajo,
      movimientosMes,
      ultimosMovimientos,
    ] = await Promise.all([
      this.prisma.insumo.count({ where: { estado: 1 } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count FROM "Insumo" WHERE estado = 1 AND "stockActual" <= "stockMinimoBodega"
      `,
      this.prisma.movimientoInventarioGlobal.findMany({
        where: { fechaMovimiento: { gte: inicioMes } },
        include: { tipoMovimiento: true },
      }),
      this.prisma.movimientoInventarioGlobal.findMany({
        take: 8,
        orderBy: { fechaMovimiento: 'desc' },
        include: {
          insumo: { select: { id: true, nombre: true, codigoSKU: true, unidadMedida: true } },
          tipoMovimiento: true,
          presentacion: true,
          responsable: { select: { name: true, lastname: true } },
          motivo: true,
        },
      }),
    ]);

    const bajoStockCount = Number(productosStockBajo[0]?.count || 0);

    let totalEntradasMes = 0;
    let totalConsumosMes = 0;

    for (const mov of movimientosMes) {
      if (mov.tipoMovimiento?.esEntrada) {
        totalEntradasMes += Math.abs(Number(mov.cantidadBase));
      } else {
        totalConsumosMes += Math.abs(Number(mov.cantidadBase));
      }
    }

    return {
      totalProductos,
      productosStockBajo: bajoStockCount,
      entradasMes: totalEntradasMes,
      consumosMes: totalConsumosMes,
      totalMovimientosMes: movimientosMes.length,
      ultimosMovimientos,
    };
  }

  async listStockBajo(dto: ListStockBajoDto) {
    const page = dto.page || 1;
    const pageSize = dto.pageSize || 20;
    const skip = (page - 1) * pageSize;

    const where: any = {
      estado: 1,
    };
    if (dto.tipoProductoId) {
      where.tipoProductoId = dto.tipoProductoId;
    }
    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigoSKU: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    const insumos = await this.prisma.insumo.findMany({
      where,
      include: {
        tipoProducto: true,
        unidadMedida: true,
      },
      orderBy: { stockActual: 'asc' },
    });

    const bajoStockItems = insumos.filter((item) => Number(item.stockActual) <= Number(item.stockMinimoBodega));
    const paginatedItems = bajoStockItems.slice(skip, skip + pageSize);

    return buildDataGridResponse(paginatedItems, bajoStockItems.length, page, pageSize);
  }

  // ==============================================================
  // INSUMOS POR SERVICIOS DE AGENCIA (LÍDER OPERADOR) & CONSUMO
  // ==============================================================

  async obtenerInsumosServiciosAgencia(agenciaId: string) {
    if (!agenciaId) {
      throw new BadRequestException('Se requiere el ID de la agencia.');
    }

    let agencia = null;
    try {
      agencia = await this.prisma.agencia.findUnique({
        where: { id: agenciaId },
        include: {
          marca: true,
          regionRel: true,
        },
      });
    } catch {
      // Ignorar error de formato de ID
    }

    if (!agencia) {
      agencia = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { nombre: { contains: agenciaId, mode: 'insensitive' } },
            { codigo: { contains: agenciaId, mode: 'insensitive' } },
          ],
        },
        include: {
          marca: true,
          regionRel: true,
        },
      });
    }

    if (!agencia) {
      agencia = await this.prisma.agencia.findFirst({
        include: {
          marca: true,
          regionRel: true,
        },
      });
    }

    if (!agencia) {
      throw new NotFoundException(`No se encontró ninguna agencia registrada en el sistema.`);
    }

    // Obtener todos los servicios activos del catálogo con sus recetas
    const catalogo = await this.prisma.catalogoServicio.findMany({
      include: {
        recetas: {
          include: {
            insumo: {
              include: {
                unidadMedida: true,
                tipoProducto: true,
              },
            },
            unidadConsumo: true,
          },
        },
      },
      orderBy: { codigo: 'asc' },
    });

    // Mapear insumos únicos requeridos por las recetas de los servicios
    const insumosMap = new Map<string, {
      insumo: any;
      servicios: Array<{
        servicioId: number;
        codigo: string;
        nombre: string;
        categoria: string;
        cantidadUsada: number;
        unidad: string;
      }>;
      consumoMaximo: number;
    }>();

    for (const serv of catalogo) {
      for (const receta of serv.recetas) {
        const ins = receta.insumo;
        if (!ins) continue;

        const cantidadUsada = Number(receta.cantidadUsada);
        const unidadSimbolo = receta.unidadConsumo?.simbolo || ins.unidadMedida?.simbolo || 'u';

        if (!insumosMap.has(ins.id)) {
          insumosMap.set(ins.id, {
            insumo: ins,
            servicios: [],
            consumoMaximo: cantidadUsada,
          });
        }

        const record = insumosMap.get(ins.id)!;
        record.servicios.push({
          servicioId: serv.id,
          codigo: serv.codigo,
          nombre: serv.nombre,
          categoria: serv.categoria,
          cantidadUsada,
          unidad: unidadSimbolo,
        });

        if (cantidadUsada > record.consumoMaximo) {
          record.consumoMaximo = cantidadUsada;
        }
      }
    }

    // Consultar stock real de esta agencia
    const stocksAgencia = await this.prisma.stockUbicacion.findMany({
      where: {
        agenciaId,
        tipoUbicacion: 'AGENCIA',
      },
    });

    const stockPorInsumo = new Map<string, number>();
    for (const st of stocksAgencia) {
      stockPorInsumo.set(st.insumoId, Number(st.cantidadActual));
    }

    let insumosOptimos = 0;
    let insumosBajoMinimo = 0;
    let insumosAgotados = 0;
    const alertas: string[] = [];

    const insumosResultado = Array.from(insumosMap.values()).map(({ insumo, servicios, consumoMaximo }) => {
      const stockActual = stockPorInsumo.get(insumo.id) ?? 0;
      const stockMinimo = Number(insumo.stockMinimoAgencia ?? 2);
      const unidad = insumo.unidadMedida?.simbolo || 'u';

      let estado: 'OPTIMO' | 'BAJO' | 'CRITICO' | 'AGOTADO' = 'OPTIMO';
      let mensajeAlerta: string | null = null;

      if (stockActual <= 0) {
        estado = 'AGOTADO';
        insumosAgotados++;
        mensajeAlerta = `Agotado: No se pueden realizar ${servicios.map(s => s.nombre).join(', ')}`;
        alertas.push(`🔴 ${insumo.nombre}: AGOTADO (${stockActual} ${unidad}). Afecta ${servicios.length} servicios.`);
      } else if (stockActual <= stockMinimo) {
        estado = 'BAJO';
        insumosBajoMinimo++;
        mensajeAlerta = `Stock bajo mínimo (${stockActual.toFixed(2)} de ${stockMinimo} ${unidad}). Reabastecer pronto.`;
        alertas.push(`⚠️ ${insumo.nombre}: Stock bajo (${stockActual.toFixed(2)} ${unidad} restantes).`);
      } else {
        insumosOptimos++;
      }

      const serviciosEstimados = consumoMaximo > 0 ? Math.floor(stockActual / consumoMaximo) : 0;

      return {
        id: insumo.id,
        codigoSKU: insumo.codigoSKU,
        nombre: insumo.nombre,
        categoria: insumo.categoria,
        tipoProducto: insumo.tipoProducto?.nombre || 'General',
        unidadMedida: unidad,
        stockActual,
        stockMinimo,
        estado,
        mensajeAlerta,
        consumoMaximo,
        serviciosEstimados,
        serviciosAsociados: servicios,
      };
    });

    return {
      agencia: {
        id: agencia.id,
        codigo: agencia.codigo,
        nombre: agencia.nombre,
        region: agencia.region || agencia.regionRel?.nombre,
      },
      resumen: {
        totalInsumosRequeridos: insumosResultado.length,
        insumosOptimos,
        insumosBajoMinimo,
        insumosAgotados,
        totalAlertas: alertas.length,
        alertas,
      },
      insumos: insumosResultado,
    };
  }

  async consumirInsumosServicio(
    dto: {
      agenciaId: string;
      ordenTrabajo?: string;
      placa?: string;
      insumos: Array<{ insumoId?: string; codigoSKU?: string; cantidad: number }>;
      operador?: string;
    },
    usuarioId?: string,
  ) {
    const { agenciaId, ordenTrabajo = 'OT-GENERAL', placa = 'S/P', insumos, operador } = dto;
    if (!agenciaId) {
      throw new BadRequestException('Se requiere el ID de la agencia.');
    }

    let finalUsuarioId = usuarioId;
    if (!finalUsuarioId) {
      const defaultUser = await this.prisma.user.findFirst({ select: { id: true } });
      finalUsuarioId = defaultUser?.id || '';
    }

    let targetAgenciaId = agenciaId;
    try {
      const ag = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { id: agenciaId },
            { nombre: { contains: agenciaId, mode: 'insensitive' } },
            { codigo: { contains: agenciaId, mode: 'insensitive' } },
          ],
        },
      });
      if (ag) {
        targetAgenciaId = ag.id;
      }
    } catch {
      // Usar agenciaId directo
    }

    const alertasGeneradas: string[] = [];

    for (const item of insumos || []) {
      const cantidadADescontar = Number(item.cantidad || 0);
      if (cantidadADescontar <= 0) continue;

      let insumo = null;
      if (item.insumoId) {
        insumo = await this.prisma.insumo.findUnique({
          where: { id: item.insumoId },
          include: { unidadMedida: true },
        });
      } else if (item.codigoSKU) {
        insumo = await this.prisma.insumo.findUnique({
          where: { codigoSKU: item.codigoSKU },
          include: { unidadMedida: true },
        });
      }

      if (!insumo) continue;

      await this.prisma.$transaction(async (tx) => {
        let stock = await tx.stockUbicacion.findFirst({
          where: {
            insumoId: insumo.id,
            tipoUbicacion: 'AGENCIA',
            agenciaId: targetAgenciaId,
          },
        });

        if (!stock) {
          stock = await tx.stockUbicacion.create({
            data: {
              insumoId: insumo.id,
              tipoUbicacion: 'AGENCIA',
              agenciaId: targetAgenciaId,
              cantidadActual: 0,
              cantidadMinima: Number(insumo.stockMinimoAgencia ?? 2),
            },
          });
        }

        const stockAnterior = Number(stock.cantidadActual ?? 0);
        const stockPosterior = stockAnterior - cantidadADescontar;

        await tx.stockUbicacion.update({
          where: { id: stock.id },
          data: { cantidadActual: { decrement: cantidadADescontar } },
        });

        await tx.kardexMovimiento.create({
          data: {
            insumoId: insumo.id,
            ubicacionId: targetAgenciaId,
            tipoMovimiento: 'CONSUMO_SERVICIO',
            cantidad: -cantidadADescontar,
            stockAnterior,
            stockPosterior,
            costoUnitario: Number(insumo.costoUnitarioUSD ?? 0),
            costoTotal: Number((cantidadADescontar * Number(insumo.costoUnitarioUSD ?? 0)).toFixed(2)),
            referenciaId: ordenTrabajo || placa,
            usuarioId: finalUsuarioId || null,
          },
        });

        const stockMinimo = Number(insumo.stockMinimoAgencia ?? 2);
        if (stockPosterior <= 0 && finalUsuarioId) {
          alertasGeneradas.push(`🚨 ¡Insumo AGOTADO! ${insumo.nombre} en la agencia (quedan ${stockPosterior.toFixed(2)} ${insumo.unidadMedida?.simbolo || 'u'})`);
          await tx.alertaStock.create({
            data: {
              insumoId: insumo.id,
              nivel: 'CRITICO',
              agenciaId: targetAgenciaId,
              usuarioEmisorId: finalUsuarioId,
              mensaje: `Insumo ${insumo.nombre} agotado tras registrar OT ${ordenTrabajo} (${placa}). Saldo: ${stockPosterior.toFixed(2)}`,
              stockReportado: stockPosterior,
            },
          });
        } else if (stockPosterior <= stockMinimo && finalUsuarioId) {
          alertasGeneradas.push(`⚠️ Stock Bajo: ${insumo.nombre} en la agencia cayó a ${stockPosterior.toFixed(2)} ${insumo.unidadMedida?.simbolo || 'u'} (Mínimo: ${stockMinimo})`);
          await tx.alertaStock.create({
            data: {
              insumoId: insumo.id,
              nivel: 'BAJO',
              agenciaId: targetAgenciaId,
              usuarioEmisorId: finalUsuarioId,
              mensaje: `Insumo ${insumo.nombre} bajo mínimo tras registrar OT ${ordenTrabajo}. Saldo: ${stockPosterior.toFixed(2)}`,
              stockReportado: stockPosterior,
            },
          });
        }
      });
    }

    return {
      success: true,
      alertasGeneradas,
    };
  }
}
