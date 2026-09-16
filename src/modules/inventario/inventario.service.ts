import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
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
import { CreateBodegaDto, UpdateBodegaDto, ToggleActivaBodegaDto, DeleteBodegaDto } from './dto/bodegas.dto.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { randomUUID } from 'crypto';

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

  async listInsumos(dto: ListInsumosDto, user?: any) {
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

    // Filtrar estrictamente por los insumos de la sede (servicios asignados + insumos existentes en stock)
    const ROLES_SCOPED = ['LIDER', 'LIDER_AGENCIA', 'APROBADOR', 'LAVADOR'];
    const userRole = (
      user?.roleDetails?.namerol ||
      user?.role?.namerol ||
      (typeof user?.role === 'string' ? user.role : '') ||
      ''
    ).toString().toUpperCase();
    const isScopedRole = ROLES_SCOPED.some(r => userRole === r || userRole.includes(r));
    const targetAgenciaId = dto?.agenciaId || (isScopedRole ? (user?.agenciaId || user?.agencia?.id) : undefined);

    let agenciaTarget: any = null;
    if (targetAgenciaId) {
      agenciaTarget = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { id: targetAgenciaId },
            { nombre: { equals: targetAgenciaId, mode: 'insensitive' } },
          ],
        },
        select: { id: true, servicioIds: true, tieneServiciosEspeciales: true },
      });

      if (agenciaTarget) {
        const rawIds = Array.isArray(agenciaTarget.servicioIds) ? agenciaTarget.servicioIds : [];
        const sIds = rawIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n) && n > 0);

        const orSedeConditions: any[] = [
          { stocks: { some: { agenciaId: agenciaTarget.id, tipoUbicacion: 'AGENCIA' } } },
        ];
        if (sIds.length > 0) {
          orSedeConditions.push({ recetas: { some: { catalogoServicioId: { in: sIds } } } });
        }

        where.AND = [
          ...(where.AND || []),
          { OR: orSedeConditions },
        ];
      } else {
        where.id = { in: [] }; // Si la agencia no existe, no devolver registros erróneos
      }
    } else if (dto.soloDeServicios === true) {
      // Vista global: mostrar exclusivamente los insumos requeridos por los servicios del catálogo si se solicita explícitamente
      where.recetas = { some: {} };
    }

    const insumos = await this.prisma.insumo.findMany({
      where,
      orderBy: { codigoSKU: 'asc' },
      include: {
        tipoProducto: { select: { id: true, codigo: true, nombre: true } },
        unidadMedida: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
        presentaciones: {
          where: { estado: 1 },
          include: { unidad: { select: { id: true, codigo: true, simbolo: true, nombre: true } } },
        },
        recetas: {
          include: {
            catalogoServicio: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                categoria: true,
              },
            },
            unidadConsumo: { select: { id: true, simbolo: true, nombre: true } },
          },
        },
        stocks: agenciaTarget ? {
          where: {
            agenciaId: agenciaTarget.id,
            tipoUbicacion: 'AGENCIA',
          },
          include: {
            agencia: { select: { id: true, nombre: true } },
          },
        } : {
          include: {
            agencia: { select: { id: true, nombre: true } },
          },
        },
        _count: { select: { stocks: true, alertas: true, presentaciones: true } },
      },
    });

    if (agenciaTarget) {
      return insumos.map((ins: any) => {
        const stockSede = Array.isArray(ins.stocks) ? ins.stocks[0] : null;
        return {
          ...ins,
          stockActual: stockSede ? Number(stockSede.cantidadActual) : 0,
          stockMinimoAgencia: stockSede ? Number(stockSede.cantidadMinima) : Number(ins.stockMinimoAgencia ?? 2),
        };
      });
    }

    // Stock de productos = físico de UNA bodega (nunca el campo catálogo Insumo.stockActual)
    const isAsistenteBodega =
      userRole === 'ASISTENTE_BODEGA' ||
      (userRole.includes('ASISTENTE') && userRole.includes('BODEGA'));

    let bodegaStockId = '';
    if (isAsistenteBodega && user?.id) {
      // Asistente: SIEMPRE su bodega asignada (ignora dto.bodegaId del cliente)
      const u = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { bodegaId: true },
      });
      bodegaStockId = (u?.bodegaId || user?.bodegaId || '').toString().trim();
    } else {
      bodegaStockId = (dto.bodegaId || user?.bodegaId || '').toString().trim();
      if (!bodegaStockId) {
        const central: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "id" FROM "bodegas" WHERE "tipo" = 'CENTRAL' OR "esCentral" = true LIMIT 1`,
        );
        bodegaStockId = central[0]?.id || '';
      }
    }

    if (!bodegaStockId) {
      return insumos.map((ins: any) => ({
        ...ins,
        stockActual: 0,
        bodegaIdStock: null,
      }));
    }

    const stockRows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT "insumoId", COALESCE(SUM("cantidadActual"), 0)::float AS "cantidadActual"
       FROM "StockUbicacion"
       WHERE "bodegaId" = $1
       GROUP BY "insumoId"`,
      bodegaStockId,
    );
    const stockMap = new Map<string, number>();
    for (const s of stockRows) {
      stockMap.set(String(s.insumoId), Number(s.cantidadActual || 0));
    }

    return insumos.map((ins: any) => ({
      ...ins,
      stockActual: stockMap.has(ins.id) ? (stockMap.get(ins.id) as number) : 0,
      bodegaIdStock: bodegaStockId,
    }));
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

    if (dto.stockOptimoBodega < dto.stockMinimoBodega) {
      throw new BadRequestException('El stock óptimo de bodega debe ser mayor o igual al stock mínimo de bodega');
    }

    return this.prisma.insumo.create({
      data: {
        codigoSKU: dto.codigoSKU,
        nombre: dto.nombre,
        categoria: dto.categoria,
        descripcion: dto.descripcion,
        tipoProductoId: dto.tipoProductoId,
        unidadMedidaId: dto.unidadMedidaId,
        contenidoNeto: dto.contenidoNeto,
        stockMinimoBodega: dto.stockMinimoBodega,
        stockMinimoAgencia: dto.stockMinimoAgencia,
        stockOptimoBodega: dto.stockOptimoBodega,
        costoUnitarioUSD: dto.costoUnitarioUSD,
        proveedorPrincipal: dto.proveedorPrincipal,
        imagenUrl: dto.imagenUrl,
      },
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

    const minBod = dto.stockMinimoBodega !== undefined ? Number(dto.stockMinimoBodega) : Number(insumo.stockMinimoBodega);
    const optBod = dto.stockOptimoBodega !== undefined ? Number(dto.stockOptimoBodega) : Number(insumo.stockOptimoBodega ?? 0);
    if (dto.stockMinimoBodega !== undefined || dto.stockOptimoBodega !== undefined) {
      if (optBod > 0 && optBod < minBod) {
        throw new BadRequestException('El stock óptimo de bodega debe ser mayor o igual al stock mínimo de bodega');
      }
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

    let userRole = rolNombre ? rolNombre.toUpperCase() : '';
    let usuario: any = null;

    if (usuarioId) {
      usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true },
      });
      if (usuario?.role?.namerol) {
        userRole = usuario.role.namerol.toUpperCase();
      }
    }

    const isGlobal =
      userRole === 'SUPER_ADMIN' ||
      userRole === 'ADMIN' ||
      userRole === 'COORD_BODEGA' ||
      userRole === 'DISTRIBUIDOR' ||
      (userRole.includes('GESTOR') && userRole.includes('INVENTARIO')) ||
      (userRole.includes('GESTOR') && userRole.includes('BODEGA')) ||
      (userRole.includes('SUPER') && userRole.includes('ADMIN'));

    const isAsistente =
      userRole === 'ASISTENTE_BODEGA' ||
      (userRole.includes('ASISTENTE') && userRole.includes('BODEGA'));
    const isSupervisor = userRole.includes('SUPERVISOR');
    const isPulidorRole = userRole.includes('PULIDOR');
    const isAgencia = userRole.includes('LIDER') || (isPulidorRole && !!agenciaIdUsuario);
    const isPulidor = isPulidorRole && !agenciaIdUsuario;

    if (isGlobal) {
      // Super Admin, Admin y Coord Bodega ven todo sin restricciones territoriales
      if (dto.sucursalId) {
        where.agenciaId = dto.sucursalId;
      }
    } else if (isAsistente || isSupervisor) {
      // Asistente: región de su bodega; Supervisor: región asignada
      let userRegionId = usuario?.regionId;
      let userRegionName = usuario?.region?.nombre;
      if (isAsistente && usuarioId) {
        const uFull = await this.prisma.user.findUnique({
          where: { id: usuarioId },
          include: { bodega: { include: { region: true } }, region: true },
        });
        userRegionId = uFull?.bodega?.regionId || uFull?.regionId || userRegionId;
        userRegionName = uFull?.bodega?.region?.nombre || uFull?.region?.nombre || userRegionName;
      }
      let agenciasRegionIds: string[] = [];

      if (userRegionId || userRegionName) {
        const agenciasRegion = await this.prisma.agencia.findMany({
          where: {
            OR: [
              ...(userRegionId ? [{ regionId: userRegionId }] : []),
              ...(userRegionName ? [{ region: { contains: userRegionName, mode: 'insensitive' as const } }] : []),
            ],
          },
          select: { id: true },
        });
        agenciasRegionIds = agenciasRegion.map((s) => s.id);
      } else if (agenciaIdUsuario) {
        const miAgencia = await this.prisma.agencia.findUnique({ where: { id: agenciaIdUsuario } });
        if (miAgencia?.region) {
          const ags = await this.prisma.agencia.findMany({
            where: { region: miAgencia.region },
            select: { id: true },
          });
          agenciasRegionIds = ags.map((s) => s.id);
        }
      }

      if (dto.sucursalId) {
        if (agenciasRegionIds.length > 0 && !agenciasRegionIds.includes(dto.sucursalId)) {
          where.agenciaId = '__ACCESO_DENEGADO_OTRA_REGION__';
        } else {
          where.agenciaId = dto.sucursalId;
        }
      } else {
        where.agenciaId = { in: agenciasRegionIds };
      }
    } else if (isAgencia) {
      if (isPulidorRole && agenciaIdUsuario) {
        where.OR = [
          { agenciaId: agenciaIdUsuario },
          { pulidorId: usuarioId }
        ];
      } else {
        where.agenciaId = agenciaIdUsuario;
      }
    } else if (isPulidor) {
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


  async obtenerStockAgenciasResumen(dto: { agenciaId?: string; region?: string } = {}, usuarioId?: string) {
    const whereAgencia: any = { estado: 1 };

    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true },
      });
      const userRole = (usuario?.role?.namerol || '').toUpperCase();
      const isAsistente =
        userRole === 'ASISTENTE_BODEGA' ||
        (userRole.includes('ASISTENTE') && userRole.includes('BODEGA'));

      if (isAsistente && (usuario?.regionId || usuario?.region?.nombre)) {
        whereAgencia.OR = [
          ...(usuario.regionId ? [{ regionId: usuario.regionId }] : []),
          ...(usuario.region?.nombre ? [{ region: { contains: usuario.region.nombre, mode: 'insensitive' as const } }] : []),
        ];
      }
    }

    if (dto.agenciaId) whereAgencia.id = dto.agenciaId;
    if (dto.region && !whereAgencia.OR) whereAgencia.region = dto.region;

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
          servicioIds: true,
          tieneServiciosEspeciales: true,
        },
      }),
      this.prisma.insumo.findMany({
        where: { estado: 1 },
        include: {
          tipoProducto: { select: { id: true, nombre: true } },
          unidadMedida: { select: { id: true, simbolo: true, nombre: true } },
          recetas: {
            select: {
              catalogoServicioId: true,
            },
          },
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
        const key = `${s.agenciaId}_${s.insumoId}`;
        const prev = stockMap.get(key) ?? 0;
        stockMap.set(key, prev + Number(s.cantidadActual));
      }
    }

    let agenciasEnAlerta = 0;
    let insumosCriticosTotal = 0;

    const agenciasData = agencias.map((ag) => {
      let alertaAgencia = false;
      let criticosAgencia = 0;

      const rawIds = Array.isArray(ag.servicioIds) ? ag.servicioIds : [];
      const sIds = new Set(rawIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n) && n > 0));

      // Filtrar estrictamente: solo los insumos que esta agencia realmente utiliza o necesita:
      // 1. Requeridos por las recetas de los servicios asignados a la agencia
      // 2. O con existencias físicas ya registradas en la agencia (> 0)
      const insumosDeEstaAgencia = insumos.filter((ins) => {
        const actual = stockMap.get(`${ag.id}_${ins.id}`) ?? 0;
        const perteneceAServicios = ins.recetas?.some((r: any) => sIds.has(Number(r.catalogoServicioId)));
        return perteneceAServicios || actual > 0;
      });

      const insumosAgencia = insumosDeEstaAgencia.map((ins) => {
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
          requeridoPorServicios: ins.recetas?.some((r: any) => sIds.has(Number(r.catalogoServicioId))) || false,
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

  private bodegasTableInitialized = false;
  private bodegasInitPromise: Promise<void> | null = null;

  private async ensureBodegasTable(): Promise<void> {
    if (this.bodegasTableInitialized) return;
    if (this.bodegasInitPromise) return this.bodegasInitPromise;

    this.bodegasInitPromise = (async () => {
      try {
        await this.prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS "bodegas" (
            "id" TEXT PRIMARY KEY,
            "codigo" TEXT UNIQUE NOT NULL,
            "nombre" TEXT UNIQUE NOT NULL,
            "ciudad" TEXT,
            "direccion" TEXT,
            "telefono" TEXT,
            "esCentral" BOOLEAN DEFAULT false,
            "activa" BOOLEAN DEFAULT true,
            "regionId" TEXT NOT NULL,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);

        try {
          await this.prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "bodegas_regionId_idx" ON "bodegas"("regionId")
          `);
        } catch (_) {}

        try {
          await this.prisma.$executeRawUnsafe(`
            CREATE INDEX IF NOT EXISTS "bodegas_activa_idx" ON "bodegas"("activa")
          `);
        } catch (_) {}

        try {
          await this.prisma.$executeRawUnsafe(`
            ALTER TABLE "bodegas" ADD COLUMN IF NOT EXISTS "porcentajeAlerta" NUMERIC DEFAULT 20
          `);
        } catch (_) {}

        try {
          await this.prisma.$executeRawUnsafe(`
            DO $type$ BEGIN
              CREATE TYPE "TipoBodega" AS ENUM ('CENTRAL', 'REGIONAL');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $type$;
          `);
        } catch (_) {}

        try {
          await this.prisma.$executeRawUnsafe(`
            ALTER TABLE "bodegas" ADD COLUMN IF NOT EXISTS "tipo" "TipoBodega" NOT NULL DEFAULT 'REGIONAL'
          `);
        } catch (_) {}

        try {
          await this.prisma.$executeRawUnsafe(`
            UPDATE "bodegas" SET "tipo" = 'CENTRAL', "esCentral" = true
            WHERE "esCentral" = true OR "codigo" = 'BOD-CENTRAL'
          `);
        } catch (_) {}

        try {
          await this.prisma.$executeRawUnsafe(`
            ALTER TABLE "bodegas" ALTER COLUMN "regionId" DROP NOT NULL
          `);
        } catch (_) {}

        const countResult: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "bodegas"`);
        const count = Number(countResult[0]?.count || 0);

        if (count === 0) {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "bodegas" ("id", "codigo", "nombre", "ciudad", "regionId", "tipo", "esCentral", "activa", "porcentajeAlerta", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, NULL, 'CENTRAL'::"TipoBodega", true, true, $5, NOW(), NOW())
             ON CONFLICT ("codigo") DO NOTHING`,
            'bod_central',
            'BOD-CENTRAL',
            'Bodega Central Nacional',
            'Quito',
            20
          );

          const regiones = await this.prisma.region.findMany({ where: { estado: 1 }, orderBy: { nombre: 'asc' } });
          for (const reg of regiones) {
            const nom = reg.nombre.trim();
            const nomCap = nom.charAt(0).toUpperCase() + nom.slice(1);
            let ciudad = 'Quito';
            if (nom.toLowerCase().includes('costa') || nom.toLowerCase().includes('guayas')) ciudad = 'Guayaquil';
            else if (nom.toLowerCase().includes('austro') || nom.toLowerCase().includes('azuay')) ciudad = 'Cuenca';
            else if (nom.toLowerCase().includes('manab')) ciudad = 'Manta';

            const bodId = `bod_${reg.codigo.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
            const bodCod = `BOD-${reg.codigo.toUpperCase()}`;
            const bodNom = `Bodega Regional ${nomCap}`;

            await this.prisma.$executeRawUnsafe(
              `INSERT INTO "bodegas" ("id", "codigo", "nombre", "ciudad", "regionId", "tipo", "esCentral", "activa", "porcentajeAlerta", "createdAt", "updatedAt")
               VALUES ($1, $2, $3, $4, $5, 'REGIONAL'::"TipoBodega", false, true, $6, NOW(), NOW())
               ON CONFLICT ("codigo") DO NOTHING`,
              bodId,
              bodCod,
              bodNom,
              ciudad,
              reg.id,
              20
            );
          }
        }
        this.bodegasTableInitialized = true;
      } catch (e) {
        console.error('Error ensuring bodegas table in PostgreSQL:', e);
      } finally {
        this.bodegasInitPromise = null;
      }
    })();

    return this.bodegasInitPromise;
  }

  async listBodegas(usuarioId?: string) {
    await this.ensureBodegasTable();

    const bodegasRows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT b."id", b."codigo", b."nombre", b."ciudad", b."direccion", b."telefono",
             b."tipo", b."esCentral", b."activa", b."regionId", b."porcentajeAlerta", b."createdAt", b."updatedAt",
             r."nombre" as "regionNombre", r."codigo" as "regionCodigo"
      FROM "bodegas" b
      LEFT JOIN "Region" r ON b."regionId" = r."id"
      ORDER BY CASE WHEN b."tipo" = 'CENTRAL' OR b."esCentral" = true THEN 0 ELSE 1 END, b."nombre" ASC
    `);

    let filteredRows = bodegasRows;
    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true, bodega: true },
      });
      const userRole = (usuario?.role?.namerol || '').toUpperCase();
      const isAsistente =
        userRole === 'ASISTENTE_BODEGA' ||
        (userRole.includes('ASISTENTE') && userRole.includes('BODEGA'));

      if (isAsistente) {
        // Solo la bodega asignada al asistente (no toda la región ni Central)
        if (usuario?.bodegaId) {
          filteredRows = bodegasRows.filter((row) => row.id === usuario.bodegaId);
        } else {
          filteredRows = [];
        }
      }
    }

    return filteredRows.map((row) => ({
      id: row.id,
      codigo: row.codigo,
      nombre: row.nombre,
      ciudad: row.ciudad || 'Quito',
      direccion: row.direccion || '',
      telefono: row.telefono || '',
      region: row.regionNombre || 'Nacional',
      regionId: row.regionId,
      regionCodigo: row.regionCodigo || '',
      tipo: row.tipo || (row.esCentral ? 'CENTRAL' : 'REGIONAL'),
      esCentral: !!row.esCentral || row.tipo === 'CENTRAL',
      activa: !!row.activa,
      porcentajeAlerta: Number(row.porcentajeAlerta || 20),
      fechaCreacion: row.createdAt ? new Date(row.createdAt).toISOString().split('T')[0] : '2026-01-01',
    }));
  }

  async crearBodega(dto: CreateBodegaDto) {
    await this.ensureBodegasTable();

    if (!dto.nombre || !dto.nombre.trim()) {
      throw new BadRequestException('El nombre de la bodega es requerido');
    }

    const tipo = (dto.tipo || 'REGIONAL').toUpperCase() as 'CENTRAL' | 'REGIONAL';
    if (tipo !== 'CENTRAL' && tipo !== 'REGIONAL') {
      throw new BadRequestException('tipo debe ser CENTRAL o REGIONAL');
    }

    let regionFound: { id: string; nombre: string } | null = null;
    if (tipo === 'REGIONAL') {
      if (!dto.regionId || !dto.regionId.trim()) {
        throw new BadRequestException('Las bodegas REGIONALES deben estar vinculadas a una región');
      }
      regionFound = await this.prisma.region.findFirst({
        where: {
          OR: [
            { id: dto.regionId },
            { nombre: { equals: dto.regionId, mode: 'insensitive' } },
            { codigo: { equals: dto.regionId, mode: 'insensitive' } },
          ],
        },
      });
      if (!regionFound) {
        throw new BadRequestException(`La región especificada "${dto.regionId}" no existe en la base de datos`);
      }
    } else {
      const existentesCentral: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "id", "nombre" FROM "bodegas" WHERE "tipo" = 'CENTRAL' AND "activa" = true LIMIT 1`,
      );
      if (existentesCentral.length > 0) {
        throw new ConflictException(
          `Ya existe la Bodega Central Nacional ("${existentesCentral[0].nombre}"). Solo se permite una bodega CENTRAL.`,
        );
      }
    }

    const nombreNorm = dto.nombre.trim();
    const codigoNorm = (dto.codigo?.trim() || `BOD-${nombreNorm.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 15)}`);

    const existing: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT "id" FROM "bodegas" WHERE "codigo" = $1 OR "nombre" = $2`,
      codigoNorm,
      nombreNorm
    );

    if (existing.length > 0) {
      throw new ConflictException(`Ya existe una bodega con el nombre "${nombreNorm}" o código "${codigoNorm}"`);
    }

    const newId = `bod_${randomUUID().slice(0, 8)}`;
    const ciudad = dto.ciudad?.trim() || regionFound?.nombre || 'Nacional';
    const pct = dto.porcentajeAlerta !== undefined ? Number(dto.porcentajeAlerta) : 20;
    const esCentral = tipo === 'CENTRAL';

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "bodegas" ("id", "codigo", "nombre", "ciudad", "direccion", "telefono", "regionId", "tipo", "esCentral", "activa", "porcentajeAlerta", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::"TipoBodega", $9, true, $10, NOW(), NOW())`,
      newId,
      codigoNorm,
      nombreNorm,
      ciudad,
      dto.direccion?.trim() || '',
      dto.telefono?.trim() || '',
      regionFound?.id || null,
      tipo,
      esCentral,
      pct
    );

    return {
      id: newId,
      codigo: codigoNorm,
      nombre: nombreNorm,
      ciudad,
      direccion: dto.direccion?.trim() || '',
      telefono: dto.telefono?.trim() || '',
      region: regionFound?.nombre || 'Nacional',
      regionId: regionFound?.id || null,
      tipo,
      esCentral,
      activa: true,
      porcentajeAlerta: pct,
      fechaCreacion: new Date().toISOString().split('T')[0],
      message: tipo === 'CENTRAL'
        ? `Bodega Central Nacional "${nombreNorm}" creada exitosamente`
        : `Bodega "${nombreNorm}" creada exitosamente vinculada a la región "${regionFound?.nombre}"`,
    };
  }

  async actualizarBodega(dto: UpdateBodegaDto) {
    await this.ensureBodegasTable();

    const existing: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM "bodegas" WHERE "id" = $1`,
      dto.id
    );

    if (!existing || existing.length === 0) {
      throw new NotFoundException(`Bodega con ID "${dto.id}" no encontrada`);
    }

    const current = existing[0];
    let regionIdToSet = current.regionId;

    if (dto.regionId && dto.regionId !== current.regionId) {
      const regionFound = await this.prisma.region.findFirst({
        where: {
          OR: [
            { id: dto.regionId },
            { nombre: { equals: dto.regionId, mode: 'insensitive' } },
            { codigo: { equals: dto.regionId, mode: 'insensitive' } },
          ],
        },
      });
      if (!regionFound) {
        throw new BadRequestException(`La región "${dto.regionId}" no existe`);
      }
      regionIdToSet = regionFound.id;
    }

    const nombreToSet = dto.nombre?.trim() || current.nombre;
    const codigoToSet = dto.codigo?.trim() || current.codigo;
    const ciudadToSet = dto.ciudad !== undefined ? dto.ciudad?.trim() : current.ciudad;
    const direccionToSet = dto.direccion !== undefined ? dto.direccion?.trim() : current.direccion;
    const telefonoToSet = dto.telefono !== undefined ? dto.telefono?.trim() : current.telefono;
    const activaToSet = dto.activa !== undefined ? !!dto.activa : !!current.activa;
    const porcentajeAlertaToSet = dto.porcentajeAlerta !== undefined ? Number(dto.porcentajeAlerta) : Number(current.porcentajeAlerta || 20);

    await this.prisma.$executeRawUnsafe(
      `UPDATE "bodegas"
       SET "nombre" = $1, "codigo" = $2, "ciudad" = $3, "direccion" = $4, "telefono" = $5,
           "regionId" = $6, "activa" = $7, "porcentajeAlerta" = $8, "updatedAt" = NOW()
       WHERE "id" = $9`,
      nombreToSet,
      codigoToSet,
      ciudadToSet,
      direccionToSet,
      telefonoToSet,
      regionIdToSet,
      activaToSet,
      porcentajeAlertaToSet,
      dto.id
    );

    return {
      id: dto.id,
      codigo: codigoToSet,
      nombre: nombreToSet,
      ciudad: ciudadToSet,
      direccion: direccionToSet,
      telefono: telefonoToSet,
      regionId: regionIdToSet,
      esCentral: !!current.esCentral,
      activa: activaToSet,
      porcentajeAlerta: porcentajeAlertaToSet,
      message: `Bodega "${nombreToSet}" actualizada correctamente`,
    };
  }

  async toggleActivaBodega(dto: ToggleActivaBodegaDto) {
    await this.ensureBodegasTable();

    const existing: any[] = await this.prisma.$queryRawUnsafe(`SELECT * FROM "bodegas" WHERE "id" = $1`, dto.id);
    if (!existing || existing.length === 0) {
      throw new NotFoundException(`Bodega con ID "${dto.id}" no encontrada`);
    }

    if (existing[0].esCentral) {
      throw new BadRequestException('La Bodega Central Nacional no puede ser desactivada');
    }

    const nuevoEstado = !existing[0].activa;
    await this.prisma.$executeRawUnsafe(`UPDATE "bodegas" SET "activa" = $1, "updatedAt" = NOW() WHERE "id" = $2`, nuevoEstado, dto.id);

    return {
      id: dto.id,
      activa: nuevoEstado,
      message: `Bodega "${existing[0].nombre}" ${nuevoEstado ? 'activada' : 'desactivada'} correctamente`,
    };
  }

  async eliminarBodega(dto: DeleteBodegaDto) {
    await this.ensureBodegasTable();

    const existing: any[] = await this.prisma.$queryRawUnsafe(`SELECT * FROM "bodegas" WHERE "id" = $1`, dto.id);
    if (!existing || existing.length === 0) {
      throw new NotFoundException(`Bodega con ID "${dto.id}" no encontrada`);
    }

    if (existing[0].esCentral) {
      throw new BadRequestException('La Bodega Central Nacional no puede ser eliminada');
    }

    await this.prisma.$executeRawUnsafe(`DELETE FROM "bodegas" WHERE "id" = $1`, dto.id);

    return {
      id: dto.id,
      message: `Bodega "${existing[0].nombre}" eliminada correctamente del sistema`,
    };
  }

  /**
   * Insumos requeridos por recetas de servicios que ofrecen las agencias de una región.
   * Solo aplica a bodegas REGIONALES (la Central no usa este filtro).
   */
  private async obtenerInsumosNecesariosRegion(regionId: string): Promise<Set<string>> {
    if (!regionId) return new Set();

    const agencias = await this.prisma.agencia.findMany({
      where: { estado: 1, regionId },
      select: { servicioIds: true },
    });

    const servicioIds = new Set<number>();
    for (const ag of agencias) {
      const raw = Array.isArray(ag.servicioIds) ? ag.servicioIds : [];
      for (const id of raw) {
        const n = Number(id);
        if (!Number.isNaN(n) && n > 0) servicioIds.add(n);
      }
    }

    if (servicioIds.size === 0) return new Set();

    const recetas = await this.prisma.recetaInsumo.findMany({
      where: { catalogoServicioId: { in: [...servicioIds] } },
      select: { insumoId: true },
      distinct: ['insumoId'],
    });

    return new Set(recetas.map((r) => r.insumoId));
  }

  async obtenerStockBodegasResumen(dto: { bodegaId?: string } = {}, usuarioId?: string) {
    const bodegas = await this.listBodegas(usuarioId);
    const requestedId = (dto?.bodegaId || '').toString().trim();

    let bodegaSeleccionada =
      requestedId
        ? bodegas.find((b) => String(b.id) === requestedId) || null
        : null;

    // Asistente: si pide una bodega que no es la suya (o Central), forzar la asignada
    if (usuarioId && !bodegaSeleccionada && bodegas.length === 1) {
      bodegaSeleccionada = bodegas[0];
    }

    // Solo si no pidieron bodega específica, usar la primera (central / única del asistente)
    if (!bodegaSeleccionada && !requestedId) {
      bodegaSeleccionada = bodegas[0] || null;
    }

    // Si pidieron una que no está en su lista (asistente), usar la permitida
    if (usuarioId && requestedId && !bodegaSeleccionada && bodegas.length > 0) {
      bodegaSeleccionada = bodegas[0];
    }

    if (!bodegaSeleccionada) {
      return {
        bodega: null,
        bodegas,
        metricas: {
          totalInsumos: 0,
          stockTotalUnidades: 0,
          insumosBajoMinimo: 0,
          insumosOptimos: 0,
          insumosNoNecesarios: 0,
          porcentajeAlertaConfigurado: 20,
        },
        insumos: [],
        mensaje: requestedId
          ? `No se encontró la bodega con id "${requestedId}"`
          : 'No hay bodegas registradas',
      };
    }

    const pctAlerta = Number(bodegaSeleccionada?.porcentajeAlerta || 20);
    const esCentral = !!bodegaSeleccionada.esCentral || bodegaSeleccionada.tipo === 'CENTRAL';

    const insumos = await this.prisma.insumo.findMany({
      where: { estado: 1 },
      include: {
        tipoProducto: { select: { id: true, nombre: true } },
        unidadMedida: { select: { id: true, simbolo: true, nombre: true } },
      },
      orderBy: { nombre: 'asc' },
    });

    // Stock físico SOLO de esta bodega (filtro estricto por bodegaId)
    const stocksBodega: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT "insumoId", COALESCE(SUM("cantidadActual"), 0)::float AS "cantidadActual"
       FROM "StockUbicacion"
       WHERE "bodegaId" = $1
       GROUP BY "insumoId"`,
      bodegaSeleccionada.id,
    );

    const stockByInsumo = new Map<string, number>();
    for (const s of stocksBodega) {
      stockByInsumo.set(String(s.insumoId), Number(s.cantidadActual || 0));
    }

    // Regional: solo alertan insumos usados por servicios de agencias de esa región
    const insumosNecesarios =
      !esCentral && bodegaSeleccionada.regionId
        ? await this.obtenerInsumosNecesariosRegion(String(bodegaSeleccionada.regionId))
        : null;

    let totalBajoMinimo = 0;
    let totalNoNecesarios = 0;
    let stockTotalUnidades = 0;

    const insumosBodega = insumos.map((ins) => {
      // Importante: si no hay fila de stock en ESTA bodega → 0 (no usar Insumo.stockActual)
      const actual = stockByInsumo.has(ins.id) ? (stockByInsumo.get(ins.id) as number) : 0;
      const cNeto = Number(ins.contenidoNeto) || 1;
      const minimo = Number(ins.stockMinimoBodega) || 10;
      const optimo = Number(ins.stockOptimoBodega) || 50;
      stockTotalUnidades += Math.round((actual / cNeto) * 100) / 100;

      const umbralAlerta = Math.round(minimo * (1 + pctAlerta / 100) * 100) / 100;

      const necesario =
        esCentral || !insumosNecesarios || insumosNecesarios.has(ins.id);

      let estado: 'Óptimo' | 'Bajo' | 'Crítico' | 'Agotado' | 'No necesario' = 'Óptimo';
      if (!necesario) {
        // Sin alerta: no cuenta para stock bajo aunque esté en 0
        estado = 'No necesario';
        totalNoNecesarios++;
      } else if (actual <= 0) {
        estado = 'Agotado';
        totalBajoMinimo++;
      } else if (actual <= minimo) {
        estado = 'Crítico';
        totalBajoMinimo++;
      } else if (actual <= umbralAlerta) {
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
        porcentajeAlerta: pctAlerta,
        umbralAlerta,
        estado,
        necesario,
        bodegaId: bodegaSeleccionada.id,
        bodegaNombre: bodegaSeleccionada.nombre,
      };
    });

    return {
      bodega: bodegaSeleccionada,
      bodegas,
      metricas: {
        totalInsumos: insumosBodega.length,
        stockTotalUnidades,
        insumosBajoMinimo: totalBajoMinimo,
        insumosOptimos: insumosBodega.filter((i) => i.estado === 'Óptimo').length,
        insumosNoNecesarios: totalNoNecesarios,
        porcentajeAlertaConfigurado: pctAlerta,
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

  private async ensureDespachoRutaColumns(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(`
        DO $e$ BEGIN
          ALTER TYPE "TipoMovimientoInv" ADD VALUE IF NOT EXISTS 'DESPACHO_BODEGA';
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $e$;
      `);
    } catch (_) {}
    const cols = [
      'origenBodegaId',
      'origenAgenciaId',
      'destinoBodegaId',
      'destinoAgenciaId',
      'destinoPulidorId',
    ];
    for (const col of cols) {
      try {
        await this.prisma.$executeRawUnsafe(
          `ALTER TABLE "MovimientoInventario" ADD COLUMN IF NOT EXISTS "${col}" TEXT`,
        );
      } catch (_) {}
    }
  }

  private async obtenerStockOrigen(
    insumoId: string,
    origen: { bodegaId?: string | null; agenciaId?: string | null },
  ) {
    if (origen.agenciaId) {
      return this.prisma.stockUbicacion.findFirst({
        where: { insumoId, tipoUbicacion: 'AGENCIA', agenciaId: origen.agenciaId },
      });
    }
    if (origen.bodegaId) {
      // Solo stock de ESA bodega (no mezclar central con regionales)
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "StockUbicacion"
         WHERE "insumoId" = $1 AND "bodegaId" = $2
         LIMIT 1`,
        insumoId,
        origen.bodegaId,
      );
      if (rows[0]) return rows[0];
      // Legacy: central sin bodegaId tipado
      const legacy: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT * FROM "StockUbicacion"
         WHERE "insumoId" = $1 AND "tipoUbicacion" = 'BODEGA_CENTRAL' AND "bodegaId" IS NULL
         LIMIT 1`,
        insumoId,
      );
      return legacy[0] || null;
    }
    return this.prisma.stockUbicacion.findFirst({
      where: { insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
    });
  }

  /** Convierte unidades físicas → cantidad en unidad base (ej. 10 und × 4 L = 40 L). */
  private unidadesABase(unidades: number, contenidoNeto: number | null | undefined): number {
    const u = Number(unidades) || 0;
    const c = Number(contenidoNeto) || 1;
    if (c <= 0) return u;
    return Math.round(u * c * 1000) / 1000;
  }

  /** Valida cantidad de despacho en unidades enteras completas. */
  private assertUnidadesCompletas(raw: any, nombreInsumo: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestException(
        `Cantidad inválida para "${nombreInsumo}": debe ser mayor a 0 (unidades completas).`,
      );
    }
    if (Math.abs(n - Math.round(n)) > 1e-9) {
      throw new BadRequestException(
        `Cantidad inválida para "${nombreInsumo}": solo se permiten unidades completas (enteros), no fracciones de volumen.`,
      );
    }
    return Math.round(n);
  }

  private async cantidadReservadaEnTransito(
    insumoId: string,
    origen: { bodegaId?: string | null; agenciaId?: string | null },
  ): Promise<number> {
    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(d."cantidadEnviada"), 0)::float AS reserved
         FROM "MovimientoDetalle" d
         INNER JOIN "MovimientoInventario" m ON m."id" = d."movimientoId"
         WHERE d."insumoId" = $1
           AND m."estadoDespacho" = 'EN_TRANSITO'
           AND (
             ($2::text IS NOT NULL AND m."origenBodegaId" = $2)
             OR ($3::text IS NOT NULL AND m."origenAgenciaId" = $3)
           )`,
        insumoId,
        origen.bodegaId || null,
        origen.agenciaId || null,
      );
      return Number(rows[0]?.reserved ?? 0);
    } catch {
      return 0;
    }
  }

  private async descontarStockOrigen(
    insumoId: string,
    cantidad: number,
    origen: { bodegaId?: string | null; agenciaId?: string | null },
    guia: string,
    usuarioId: string,
  ) {
    let stock = await this.obtenerStockOrigen(insumoId, origen);
    if (!stock) {
      throw new BadRequestException(`No hay stock registrado del insumo en el origen para despachar.`);
    }
    const disponible = Number(stock.cantidadActual ?? 0);
    if (disponible < cantidad) {
      throw new BadRequestException(
        `Stock insuficiente en origen: disponible ${disponible}, requerido ${cantidad}`,
      );
    }
    const stockPost = disponible - cantidad;
    await this.prisma.stockUbicacion.update({
      where: { id: stock.id },
      data: { cantidadActual: { decrement: cantidad } },
    });
    await this.prisma.kardexMovimiento.create({
      data: {
        insumoId,
        ubicacionId: origen.agenciaId || origen.bodegaId || 'BODEGA_CENTRAL',
        tipoMovimiento: 'DESPACHO_SALIDA',
        cantidad: -cantidad,
        stockAnterior: disponible,
        stockPosterior: stockPost,
        referenciaId: guia,
        usuarioId,
      },
    });
  }

  private async devolverStockOrigen(
    insumoId: string,
    cantidad: number,
    origen: { bodegaId?: string | null; agenciaId?: string | null },
    guia: string,
    usuarioId: string,
  ) {
    let stock = await this.obtenerStockOrigen(insumoId, origen);
    if (stock) {
      const ant = Number(stock.cantidadActual ?? 0);
      await this.prisma.stockUbicacion.update({
        where: { id: stock.id },
        data: { cantidadActual: { increment: cantidad } },
      });
      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId,
          ubicacionId: origen.agenciaId || origen.bodegaId || 'BODEGA_CENTRAL',
          tipoMovimiento: 'DESPACHO_RECHAZADO',
          cantidad,
          stockAnterior: ant,
          stockPosterior: ant + cantidad,
          referenciaId: guia,
          usuarioId,
        },
      });
      return;
    }
    // Crear fila si no existía
    if (origen.agenciaId) {
      await this.prisma.stockUbicacion.create({
        data: {
          insumoId,
          tipoUbicacion: 'AGENCIA',
          agenciaId: origen.agenciaId,
          cantidadActual: cantidad,
        },
      });
    } else if (origen.bodegaId) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "StockUbicacion" ("id", "insumoId", "tipoUbicacion", "bodegaId", "cantidadActual", "updatedAt")
         VALUES ($1, $2, 'BODEGA_CENTRAL', $3, $4, NOW())`,
        randomUUID(),
        insumoId,
        origen.bodegaId,
        cantidad,
      );
    }
  }

  private async sumarStockDestino(params: {
    insumoId: string;
    cantidad: number;
    destinoBodegaId?: string | null;
    destinoAgenciaId?: string | null;
    destinoPulidorId?: string | null;
    guia: string;
    usuarioId: string;
  }) {
    const { insumoId, cantidad, guia, usuarioId } = params;
    if (params.destinoAgenciaId) {
      let stock = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId, tipoUbicacion: 'AGENCIA', agenciaId: params.destinoAgenciaId },
      });
      const ant = Number(stock?.cantidadActual ?? 0);
      if (stock) {
        await this.prisma.stockUbicacion.update({
          where: { id: stock.id },
          data: { cantidadActual: { increment: cantidad } },
        });
      } else {
        const ins = await this.prisma.insumo.findUnique({ where: { id: insumoId } });
        await this.prisma.stockUbicacion.create({
          data: {
            insumoId,
            tipoUbicacion: 'AGENCIA',
            agenciaId: params.destinoAgenciaId,
            cantidadActual: cantidad,
            cantidadMinima: ins?.stockMinimoAgencia ?? 2,
          },
        });
      }
      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId,
          ubicacionId: params.destinoAgenciaId,
          tipoMovimiento: 'DESPACHO_ENTRADA',
          cantidad,
          stockAnterior: ant,
          stockPosterior: ant + cantidad,
          referenciaId: guia,
          usuarioId,
        },
      });
      return;
    }

    if (params.destinoBodegaId) {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "id", "cantidadActual" FROM "StockUbicacion"
         WHERE "insumoId" = $1 AND "bodegaId" = $2 LIMIT 1`,
        insumoId,
        params.destinoBodegaId,
      );
      const ant = Number(rows[0]?.cantidadActual ?? 0);
      if (rows[0]) {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "StockUbicacion" SET "cantidadActual" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
          ant + cantidad,
          rows[0].id,
        );
      } else {
        const ins = await this.prisma.insumo.findUnique({ where: { id: insumoId } });
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "StockUbicacion" ("id", "insumoId", "tipoUbicacion", "bodegaId", "cantidadActual", "cantidadMinima", "updatedAt")
           VALUES ($1, $2, 'BODEGA_CENTRAL', $3, $4, $5, NOW())`,
          randomUUID(),
          insumoId,
          params.destinoBodegaId,
          cantidad,
          Number(ins?.stockMinimoBodega || 0),
        );
      }
      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId,
          ubicacionId: params.destinoBodegaId,
          tipoMovimiento: 'DESPACHO_ENTRADA',
          cantidad,
          stockAnterior: ant,
          stockPosterior: ant + cantidad,
          referenciaId: guia,
          usuarioId,
        },
      });
      return;
    }

    if (params.destinoPulidorId) {
      const pulidor = await this.prisma.user.findUnique({ where: { id: params.destinoPulidorId } });
      const tipoUb: 'PULIDOR_FIJO' | 'PULIDOR_MOVIL' = pulidor?.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL';
      let stock = await this.prisma.stockUbicacion.findFirst({
        where: {
          insumoId,
          pulidorId: params.destinoPulidorId,
          tipoUbicacion: { in: ['PULIDOR_MOVIL', 'PULIDOR_FIJO'] },
        },
      });
      const ant = Number(stock?.cantidadActual ?? 0);
      if (stock) {
        await this.prisma.stockUbicacion.update({
          where: { id: stock.id },
          data: { cantidadActual: { increment: cantidad } },
        });
      } else {
        await this.prisma.stockUbicacion.create({
          data: {
            insumoId,
            tipoUbicacion: tipoUb,
            pulidorId: params.destinoPulidorId,
            agenciaId: pulidor?.agenciaId ?? null,
            cantidadActual: cantidad,
          },
        });
      }
      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId,
          ubicacionId: `PULIDOR_${params.destinoPulidorId}`,
          tipoMovimiento: 'DESPACHO_ENTRADA',
          cantidad,
          stockAnterior: ant,
          stockPosterior: ant + cantidad,
          referenciaId: guia,
          usuarioId,
        },
      });
    }
  }

  private async assertUsuarioPuedeConfirmarDespacho(movimiento: any, usuarioId: string) {
    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, bodega: true },
    });
    const role = (usuario?.role?.namerol || '').toUpperCase();
    const isSuperAdmin =
      role === 'SUPER_ADMIN' || (role.includes('SUPER') && role.includes('ADMIN'));

    if (role === 'ADMIN' && !isSuperAdmin) {
      throw new ForbiddenException(
        'Admin no puede confirmar recepción: solo supervisión.',
      );
    }

    const isLider = role === 'LIDER' || role === 'LIDER_AGENCIA' || role === 'LIDER_OPERADOR';
    const isAsistente =
      role === 'ASISTENTE_BODEGA' || (role.includes('ASISTENTE') && role.includes('BODEGA'));

    // Cargar FKs tipadas (pueden no venir en el modelo Prisma client)
    let destinoBodegaId = (movimiento as any).destinoBodegaId as string | null;
    let destinoAgenciaId = (movimiento as any).destinoAgenciaId as string | null;
    let destinoPulidorId = (movimiento as any).destinoPulidorId as string | null;
    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "destinoBodegaId", "destinoAgenciaId", "destinoPulidorId"
         FROM "MovimientoInventario" WHERE "id" = $1 LIMIT 1`,
        movimiento.id,
      );
      if (rows[0]) {
        destinoBodegaId = rows[0].destinoBodegaId || destinoBodegaId;
        destinoAgenciaId = rows[0].destinoAgenciaId || destinoAgenciaId;
        destinoPulidorId = rows[0].destinoPulidorId || destinoPulidorId;
      }
    } catch (_) {}

    // Legacy: parse agencia from label
    if (!destinoAgenciaId && movimiento.destinoUbicacion?.includes('[')) {
      const match = String(movimiento.destinoUbicacion).match(/\[(.*?)\]/);
      if (match?.[1]) {
        const ag = await this.prisma.agencia.findUnique({ where: { id: match[1].trim() } });
        if (ag) destinoAgenciaId = ag.id;
      }
    }
    if (!destinoPulidorId && movimiento.tipo === 'DESPACHO_PULIDOR') {
      destinoPulidorId = movimiento.usuarioRecibeId;
    }

    if (isSuperAdmin) {
      return { destinoBodegaId, destinoAgenciaId, destinoPulidorId };
    }

    // Agencia destino → solo el LÍDER de esa sede
    if (destinoAgenciaId) {
      if (!isLider || usuario?.agenciaId !== destinoAgenciaId) {
        throw new ForbiddenException('Solo el Líder de la sucursal destino puede confirmar este envío.');
      }
      return { destinoBodegaId, destinoAgenciaId, destinoPulidorId };
    }
    // Bodega destino → solo el ASISTENTE de esa bodega
    if (destinoBodegaId) {
      if (!isAsistente || usuario?.bodegaId !== destinoBodegaId) {
        throw new ForbiddenException(
          'Solo el Asistente de la bodega destino puede confirmar este envío.',
        );
      }
      return { destinoBodegaId, destinoAgenciaId, destinoPulidorId };
    }
    // Pulidor destino → solo ese pulidor (web o app)
    if (destinoPulidorId) {
      if (usuarioId !== destinoPulidorId) {
        throw new ForbiddenException('Solo el pulidor destino puede confirmar este envío.');
      }
      return { destinoBodegaId, destinoAgenciaId, destinoPulidorId };
    }

    throw new ForbiddenException('No se pudo determinar el destino del envío para validar la confirmación.');
  }

  async crearDespacho(dto: CrearDespachoDto, usuarioId: string) {
    await this.ensureDespachoRutaColumns();

    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: {
        role: true,
        region: true,
        agencia: { include: { regionRel: true } },
        bodega: { include: { region: true } },
      },
    });
    if (!usuario) throw new UnauthorizedException('Usuario no autenticado');

    const rol = (usuario.role?.namerol || '').toUpperCase();
    const isSuperAdmin = rol === 'SUPER_ADMIN' || (rol.includes('SUPER') && rol.includes('ADMIN'));
    const isAdmin = rol === 'ADMIN' && !isSuperAdmin;
    if (isAdmin) {
      throw new ForbiddenException('Admin no despacha insumos: solo supervisión.');
    }

    const isCoord =
      rol === 'COORD_BODEGA' ||
      rol === 'DISTRIBUIDOR' ||
      (rol.includes('COORD') && rol.includes('BODEGA'));
    const isAsistente =
      rol === 'ASISTENTE_BODEGA' || (rol.includes('ASISTENTE') && rol.includes('BODEGA'));
    const isLider = rol === 'LIDER' || rol === 'LIDER_AGENCIA' || rol === 'LIDER_OPERADOR';

    if (!isCoord && !isAsistente && !isLider && !isSuperAdmin) {
      throw new ForbiddenException('Tu rol no está autorizado para crear despachos.');
    }

    // Origen = donde está el usuario o selección de Super Admin
    let origenBodegaId: string | null = null;
    let origenAgenciaId: string | null = null;
    let origenLabel = dto.origenUbicacion || '';

    if (isLider) {
      origenAgenciaId = usuario.agenciaId || dto.origenAgenciaId || null;
      if (!origenAgenciaId) {
        throw new BadRequestException('El líder debe tener una sucursal asignada para despachar desde su stock.');
      }
      origenLabel = origenLabel || `Agencia ${usuario.agencia?.nombre || origenAgenciaId}`;
    } else if (isSuperAdmin) {
      origenBodegaId = dto.origenBodegaId || usuario.bodegaId || null;
      origenAgenciaId = dto.origenAgenciaId || usuario.agenciaId || null;
      if (!origenBodegaId && !origenAgenciaId) {
        const central: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "id", "nombre" FROM "bodegas" WHERE "tipo" = 'CENTRAL' OR "esCentral" = true LIMIT 1`,
        );
        if (central[0]) {
          origenBodegaId = central[0].id;
          origenLabel = origenLabel || `${central[0].nombre} (Central)`;
        } else {
          origenBodegaId = 'bod_central';
          origenLabel = origenLabel || 'Bodega Central';
        }
      }
      if (origenBodegaId && !origenLabel) {
        const bodRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "nombre", "tipo", "esCentral" FROM "bodegas" WHERE "id" = $1 LIMIT 1`,
          origenBodegaId,
        );
        origenLabel = bodRows[0]
          ? `${bodRows[0].nombre}${bodRows[0].esCentral || bodRows[0].tipo === 'CENTRAL' ? ' (Central)' : ' (Regional)'}`
          : origenBodegaId;
      } else if (origenAgenciaId && !origenLabel) {
        const ag = await this.prisma.agencia.findUnique({ where: { id: origenAgenciaId } });
        origenLabel = `Agencia ${ag?.nombre || origenAgenciaId}`;
      }
    } else {
      // Coord puede elegir bodega origen (UI); Asistente siempre su bodega asignada
      origenBodegaId = isCoord
        ? dto.origenBodegaId || usuario.bodegaId || null
        : usuario.bodegaId || dto.origenBodegaId || null;
      if (!origenBodegaId && isCoord) {
        const central: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "id", "nombre" FROM "bodegas" WHERE "tipo" = 'CENTRAL' OR "esCentral" = true LIMIT 1`,
        );
        if (central[0]) {
          origenBodegaId = central[0].id;
          origenLabel = origenLabel || `${central[0].nombre} (Central)`;
        }
      }
      if (!origenBodegaId) {
        throw new BadRequestException('Debes tener una bodega asignada para despachar desde tu stock.');
      }
      if (!origenLabel) {
        const bodRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "nombre", "tipo", "esCentral" FROM "bodegas" WHERE "id" = $1 LIMIT 1`,
          origenBodegaId,
        );
        origenLabel = bodRows[0]
          ? `${bodRows[0].nombre}${bodRows[0].esCentral || bodRows[0].tipo === 'CENTRAL' ? ' (Central)' : ' (Regional)'}`
          : origenBodegaId;
      }
    }

    const regionUsuario =
      usuario.bodega?.regionId ||
      usuario.agencia?.regionId ||
      usuario.regionId ||
      null;

    // Destino
    let tipo = dto.tipo;
    let destinoBodegaId: string | null = null;
    let destinoAgenciaId: string | null = null;
    let destinoPulidorId: string | null = dto.pulidorDestinoId || dto.destinoPulidorId || null;
    let destinoLabel = '';

    const rawDestinoAgencia = dto.sucursalDestinoId || dto.agenciaId || dto.agenciaDestinoId;
    const rawDestinoBodega = dto.destinoBodegaId;

    if (tipo === 'DESPACHO_PULIDOR' || destinoPulidorId) {
      tipo = 'DESPACHO_PULIDOR';
      if (!destinoPulidorId) throw new BadRequestException('Debe especificar pulidorDestinoId');
      const pulidor = await this.prisma.user.findUnique({
        where: { id: destinoPulidorId },
        include: { region: true, agencia: true, role: true },
      });
      if (!pulidor) throw new NotFoundException(`Pulidor "${destinoPulidorId}" no encontrado`);
      if (!isCoord && !isSuperAdmin && regionUsuario) {
        const regPulidor = pulidor.regionId || pulidor.agencia?.regionId;
        if (regPulidor && regPulidor !== regionUsuario) {
          throw new ForbiddenException('Solo puedes despachar a pulidores de tu región.');
        }
      }
      destinoLabel = `${pulidor.name} ${pulidor.lastname} (Pulidor)`;
    } else if (tipo === 'DESPACHO_BODEGA' || rawDestinoBodega) {
      if (isLider) {
        throw new ForbiddenException(
          'El Líder solo despacha a otras agencias o pulidores de su región (no a bodegas).',
        );
      }
      tipo = 'DESPACHO_BODEGA';
      const bodId = rawDestinoBodega || rawDestinoAgencia;
      if (!bodId) throw new BadRequestException('Debe especificar destinoBodegaId');
      const bodRows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT b.*, r."nombre" as "regionNombre" FROM "bodegas" b
         LEFT JOIN "Region" r ON b."regionId" = r."id"
         WHERE b."id" = $1 LIMIT 1`,
        bodId,
      );
      if (!bodRows[0]) throw new NotFoundException(`Bodega destino "${bodId}" no encontrada`);
      if (origenBodegaId && bodRows[0].id === origenBodegaId) {
        throw new BadRequestException('No puedes despachar hacia la misma bodega de origen.');
      }
      if (!isCoord && !isSuperAdmin && regionUsuario && bodRows[0].regionId && bodRows[0].regionId !== regionUsuario) {
        throw new ForbiddenException('Solo puedes despachar a bodegas de tu región.');
      }
      destinoBodegaId = bodRows[0].id;
      destinoLabel = `${bodRows[0].nombre}${bodRows[0].esCentral || bodRows[0].tipo === 'CENTRAL' ? ' (Central)' : ` (Regional · ${bodRows[0].regionNombre || ''})`}`;
    } else {
      // Por defecto DESPACHO_AGENCIA; si el ID es una bodega, tratar como DESPACHO_BODEGA
      if (rawDestinoAgencia) {
        const maybeBod: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT b.*, r."nombre" as "regionNombre" FROM "bodegas" b
           LEFT JOIN "Region" r ON b."regionId" = r."id"
           WHERE b."id" = $1 LIMIT 1`,
          rawDestinoAgencia,
        );
        if (maybeBod[0]) {
          if (isLider) {
            throw new ForbiddenException(
              'El Líder solo despacha a otras agencias o pulidores de su región (no a bodegas).',
            );
          }
          tipo = 'DESPACHO_BODEGA';
          if (origenBodegaId && maybeBod[0].id === origenBodegaId) {
            throw new BadRequestException('No puedes despachar hacia la misma bodega de origen.');
          }
          if (!isCoord && !isSuperAdmin && regionUsuario && maybeBod[0].regionId && maybeBod[0].regionId !== regionUsuario) {
            throw new ForbiddenException('Solo puedes despachar a bodegas de tu región.');
          }
          destinoBodegaId = maybeBod[0].id;
          destinoLabel = `${maybeBod[0].nombre}${maybeBod[0].esCentral || maybeBod[0].tipo === 'CENTRAL' ? ' (Central)' : ` (Regional · ${maybeBod[0].regionNombre || ''})`}`;
        }
      }

      if (tipo !== 'DESPACHO_BODEGA') {
        tipo = 'DESPACHO_AGENCIA';
        if (!rawDestinoAgencia) throw new BadRequestException('Debe especificar la agencia destino');
        const agencia = await this.prisma.agencia.findFirst({
          where: {
            OR: [
              { id: rawDestinoAgencia },
              { nombre: { equals: rawDestinoAgencia, mode: 'insensitive' } },
              { codigo: { equals: rawDestinoAgencia, mode: 'insensitive' } },
            ],
          },
        });
        if (!agencia) throw new NotFoundException(`Agencia "${rawDestinoAgencia}" no encontrada`);
        if (origenAgenciaId && agencia.id === origenAgenciaId) {
          throw new BadRequestException('No puedes despachar hacia tu misma sucursal.');
        }
        if (!isCoord && !isSuperAdmin && regionUsuario && agencia.regionId && agencia.regionId !== regionUsuario) {
          throw new ForbiddenException('Solo puedes despachar a sucursales de tu región.');
        }
        destinoAgenciaId = agencia.id;
        destinoLabel = `Agencia ${agencia.nombre} [${agencia.id}]`;
      }
    }

    // cantidadEnviada = unidades físicas completas; el stock se mueve en unidad base (volumen)
    const origenStock = { bodegaId: origenBodegaId, agenciaId: origenAgenciaId };
    const detallesNormalizados: { insumoId: string; unidades: number; cantidadBase: number }[] = [];
    for (const det of dto.detalles) {
      const insumo = await this.prisma.insumo.findUnique({
        where: { id: det.insumoId },
        include: { unidadMedida: { select: { simbolo: true } } },
      });
      if (!insumo) throw new NotFoundException(`Insumo "${det.insumoId}" no encontrado`);
      const unidades = this.assertUnidadesCompletas(det.cantidadEnviada, insumo.nombre);
      const cNeto = Number(insumo.contenidoNeto) || 1;
      const cantidadBase = this.unidadesABase(unidades, cNeto);
      const stock = await this.obtenerStockOrigen(det.insumoId, origenStock);
      const fisico = Number(stock?.cantidadActual ?? 0);
      const undDisponibles = cNeto > 0 ? Math.floor(fisico / cNeto + 1e-9) : Math.floor(fisico);
      if (undDisponibles < unidades) {
        const sim = insumo.unidadMedida?.simbolo || 'u';
        throw new BadRequestException(
          `Stock insuficiente de "${insumo.nombre}" en origen: disponible ${undDisponibles} und (${fisico} ${sim}), requerido ${unidades} und`,
        );
      }
      detallesNormalizados.push({ insumoId: det.insumoId, unidades, cantidadBase });
    }

    const guia = dto.numeroGuia ?? (await this._generarGuia('DESP'));
    const existing = await this.prisma.movimientoInventario.findUnique({ where: { numeroGuia: guia } });
    if (existing) throw new ConflictException(`Ya existe un movimiento con guía "${guia}"`);

    // Prisma client puede no incluir aún DESPACHO_BODEGA: crear con tipo compatible y actualizar por SQL
    const tipoPrisma = tipo === 'DESPACHO_BODEGA' ? 'DESPACHO_AGENCIA' : tipo;

    const movimiento = await this.prisma.movimientoInventario.create({
      data: {
        numeroGuia: guia,
        tipo: tipoPrisma as any,
        estadoDespacho: 'EN_TRANSITO',
        origenUbicacion: origenLabel,
        destinoUbicacion: destinoLabel,
        usuarioDespachaId: usuarioId,
        usuarioRecibeId: destinoPulidorId,
        observaciones: dto.observaciones,
        detalles: {
          create: detallesNormalizados.map((d) => ({
            insumoId: d.insumoId,
            cantidadEnviada: d.unidades,
          })),
        },
      },
      include: { detalles: true },
    });

    try {
      if (tipo === 'DESPACHO_BODEGA') {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "MovimientoInventario" SET "tipo" = 'DESPACHO_BODEGA'::"TipoMovimientoInv" WHERE "id" = $1`,
          movimiento.id,
        );
      }
      await this.prisma.$executeRawUnsafe(
        `UPDATE "MovimientoInventario"
         SET "origenBodegaId" = $1, "origenAgenciaId" = $2,
             "destinoBodegaId" = $3, "destinoAgenciaId" = $4, "destinoPulidorId" = $5
         WHERE "id" = $6`,
        origenBodegaId,
        origenAgenciaId,
        destinoBodegaId,
        destinoAgenciaId,
        destinoPulidorId,
        movimiento.id,
      );
    } catch (err: any) {
      // Sin ruta tipada no se puede confirmar/devolver: limpiar guía huérfana
      try {
        await this.prisma.movimientoDetalle.deleteMany({ where: { movimientoId: movimiento.id } });
        await this.prisma.movimientoInventario.delete({ where: { id: movimiento.id } });
      } catch (_) {}
      throw new BadRequestException(
        `No se pudo registrar la ruta del despacho: ${err?.message || 'error SQL'}`,
      );
    }

    // Reserva dura: descontar origen en unidad BASE (volumen). Destino solo suma al confirmar.
    const descontados: { insumoId: string; cantidad: number }[] = [];
    try {
      for (const det of detallesNormalizados) {
        await this.descontarStockOrigen(det.insumoId, det.cantidadBase, origenStock, guia, usuarioId);
        descontados.push({ insumoId: det.insumoId, cantidad: det.cantidadBase });
      }
    } catch (err) {
      for (const d of descontados.reverse()) {
        try {
          await this.devolverStockOrigen(d.insumoId, d.cantidad, origenStock, guia, usuarioId);
        } catch (_) {}
      }
      try {
        await this.prisma.movimientoDetalle.deleteMany({ where: { movimientoId: movimiento.id } });
        await this.prisma.movimientoInventario.delete({ where: { id: movimiento.id } });
      } catch (_) {}
      throw err;
    }

    return {
      ...movimiento,
      tipo,
      origenBodegaId,
      origenAgenciaId,
      destinoBodegaId,
      destinoAgenciaId,
      destinoPulidorId,
      puedeConfirmar: false,
      stockReservado: true,
      unidadDespacho: 'UNIDADES',
    };
  }

  async confirmarRecepcion(dto: ConfirmarRecepcionDto, usuarioId: string) {
    await this.ensureDespachoRutaColumns();

    // Cargar por SQL tipado: Prisma client puede no deserializar DESPACHO_BODEGA
    const headers: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT m."id", m."numeroGuia", m."tipo"::text AS "tipo", m."estadoDespacho"::text AS "estadoDespacho",
              m."origenUbicacion", m."destinoUbicacion", m."observaciones",
              m."usuarioDespachaId", m."usuarioRecibeId",
              m."origenBodegaId", m."origenAgenciaId", m."destinoBodegaId", m."destinoAgenciaId", m."destinoPulidorId"
       FROM "MovimientoInventario" m
       WHERE m."id" = $1 OR m."numeroGuia" = $1
       LIMIT 1`,
      dto.movimientoId,
    );
    if (!headers[0]) throw new NotFoundException(`Movimiento con ID/Guía "${dto.movimientoId}" no encontrado`);
    const header = headers[0];
    if (header.estadoDespacho !== 'EN_TRANSITO') {
      throw new BadRequestException(`El movimiento ya tiene estado "${header.estadoDespacho}" y no puede confirmarse`);
    }

    const detalles = await this.prisma.movimientoDetalle.findMany({
      where: { movimientoId: header.id },
    });
    const movimiento: any = { ...header, detalles };

    const destinos = await this.assertUsuarioPuedeConfirmarDespacho(movimiento, usuarioId);

    const motivoRechazo = (dto.motivo || dto.observaciones || '').toString().trim();
    if (dto.accion === 'RECHAZADO' && !motivoRechazo) {
      throw new BadRequestException('Debes escribir el motivo del rechazo.');
    }

    const nuevoEstado = dto.accion === 'RECIBIDO' ? 'RECIBIDO' : 'RECHAZADO';

    if (dto.cantidadesRecibidas?.length) {
      for (const cr of dto.cantidadesRecibidas) {
        const det = movimiento.detalles.find((d: any) => d.id === cr.detalleId);
        if (!det) throw new BadRequestException(`Detalle "${cr.detalleId}" no pertenece al movimiento`);
        const enviada = Number(det.cantidadEnviada);
        const recibida = Number(cr.cantidadRecibida);
        if (recibida < 0 || recibida > enviada) {
          throw new BadRequestException(`Cantidad recibida inválida: debe estar entre 0 y ${enviada} und`);
        }
        if (Math.abs(recibida - Math.round(recibida)) > 1e-9) {
          throw new BadRequestException('La cantidad recibida debe ser en unidades completas (enteros).');
        }
        await this.prisma.movimientoDetalle.update({
          where: { id: cr.detalleId },
          data: { cantidadRecibida: Math.round(recibida) },
        });
      }
    } else if (dto.accion === 'RECIBIDO') {
      for (const det of movimiento.detalles) {
        await this.prisma.movimientoDetalle.update({
          where: { id: det.id },
          data: { cantidadRecibida: det.cantidadEnviada },
        });
      }
    }

    // Recepción parcial: observación obligatoria
    if (dto.accion === 'RECIBIDO') {
      const detallesCheck = await this.prisma.movimientoDetalle.findMany({
        where: { movimientoId: movimiento.id },
      });
      const esParcial = detallesCheck.some(
        (d) => Number(d.cantidadRecibida ?? d.cantidadEnviada) < Number(d.cantidadEnviada),
      );
      if (esParcial && !(dto.observaciones || '').toString().trim()) {
        throw new BadRequestException(
          'Recepción parcial: debes ingresar una observación explicando la diferencia.',
        );
      }
    }

    const observacionesActualizadas =
      dto.accion === 'RECHAZADO'
        ? `${movimiento.observaciones ? movimiento.observaciones + ' ' : ''}| RECHAZO: ${motivoRechazo}`.trim()
        : dto.observaciones
          ? `${movimiento.observaciones ? movimiento.observaciones + ' ' : ''}| RECEPCIÓN: ${dto.observaciones}`.trim()
          : movimiento.observaciones;

    await this.prisma.$executeRawUnsafe(
      `UPDATE "MovimientoInventario"
       SET "estadoDespacho" = $1::"EstadoDespacho",
           "fechaRecepcion" = NOW(),
           "usuarioRecibeId" = $2,
           "observaciones" = $3
       WHERE "id" = $4`,
      nuevoEstado,
      usuarioId,
      observacionesActualizadas,
      movimiento.id,
    );

    // Origen tipado
    let origenBodegaId: string | null = null;
    let origenAgenciaId: string | null = null;
    try {
      const orows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "origenBodegaId", "origenAgenciaId" FROM "MovimientoInventario" WHERE "id" = $1 LIMIT 1`,
        movimiento.id,
      );
      origenBodegaId = orows[0]?.origenBodegaId || null;
      origenAgenciaId = orows[0]?.origenAgenciaId || null;
    } catch (_) {}

    const origenStockConfirm = { bodegaId: origenBodegaId, agenciaId: origenAgenciaId };

    // Guías: cantidadEnviada/recibida están en UNIDADES; el stock físico se mueve en unidad base.
    // El kardex DESPACHO_SALIDA guarda el monto base realmente reservado (sirve también para legacy).
    const baseReservadoKardex = async (insumoId: string): Promise<number> => {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "cantidad" FROM "KardexMovimiento"
         WHERE "insumoId" = $1 AND "referenciaId" = $2 AND "tipoMovimiento" = 'DESPACHO_SALIDA'
         ORDER BY "fecha" DESC
         LIMIT 1`,
        insumoId,
        movimiento.numeroGuia,
      );
      return Math.abs(Number(rows[0]?.cantidad ?? 0));
    };

    const yaReservadoFisico = async (insumoId: string): Promise<boolean> => {
      return (await baseReservadoKardex(insumoId)) > 0;
    };

    const toBase = async (insumoId: string, unidades: number): Promise<number> => {
      const ins = await this.prisma.insumo.findUnique({
        where: { id: insumoId },
        select: { contenidoNeto: true },
      });
      return this.unidadesABase(unidades, Number(ins?.contenidoNeto ?? 1));
    };

    if (dto.accion === 'RECIBIDO') {
      const detallesActualizados = await this.prisma.movimientoDetalle.findMany({
        where: { movimientoId: movimiento.id },
      });
      for (const det of detallesActualizados) {
        const enviadaUnd = Number(det.cantidadEnviada);
        const recibidaUnd = Number(det.cantidadRecibida ?? det.cantidadEnviada);
        const baseReservado = await baseReservadoKardex(det.insumoId);
        const reservadoAlCrear = baseReservado > 0;

        let baseRecibida = 0;
        let baseSobrante = 0;
        if (reservadoAlCrear && enviadaUnd > 0) {
          const ratio = recibidaUnd / enviadaUnd;
          baseRecibida = Math.round(baseReservado * ratio * 1000) / 1000;
          baseSobrante = Math.round((baseReservado - baseRecibida) * 1000) / 1000;
        } else {
          baseRecibida = await toBase(det.insumoId, recibidaUnd);
        }

        if (!reservadoAlCrear && baseRecibida > 0) {
          // Legacy sin reserva al crear: descontar base de lo recibido
          await this.descontarStockOrigen(
            det.insumoId,
            baseRecibida,
            origenStockConfirm,
            movimiento.numeroGuia,
            usuarioId,
          );
        } else if (reservadoAlCrear && baseSobrante > 0) {
          // Parcial: devolver al origen lo no recibido (en base)
          await this.devolverStockOrigen(
            det.insumoId,
            baseSobrante,
            origenStockConfirm,
            movimiento.numeroGuia,
            usuarioId,
          );
        }

        if (baseRecibida > 0) {
          await this.sumarStockDestino({
            insumoId: det.insumoId,
            cantidad: baseRecibida,
            destinoBodegaId: destinos.destinoBodegaId,
            destinoAgenciaId: destinos.destinoAgenciaId,
            destinoPulidorId: destinos.destinoPulidorId,
            guia: movimiento.numeroGuia,
            usuarioId,
          });
        }
      }
    } else {
      // Rechazo: devolver stock base reservado + alerta
      for (const det of movimiento.detalles) {
        const baseReservado = await baseReservadoKardex(det.insumoId);
        if (baseReservado > 0) {
          await this.devolverStockOrigen(
            det.insumoId,
            baseReservado,
            origenStockConfirm,
            movimiento.numeroGuia,
            usuarioId,
          );
        }
        try {
          await this.prisma.alertaStock.create({
            data: {
              insumoId: det.insumoId,
              nivel: 'CRITICO',
              usuarioEmisorId: usuarioId,
              agenciaId: destinos.destinoAgenciaId || origenAgenciaId || null,
              mensaje: `Incidencia envío ${movimiento.numeroGuia} RECHAZADO: ${motivoRechazo}`,
              stockReportado: det.cantidadEnviada,
            },
          });
        } catch (_) {}
      }
    }

    return { ok: true, numeroGuia: movimiento.numeroGuia, nuevoEstado };
  }

  async rechazarDespacho(
    dto: { movimientoId: string; motivo?: string; observaciones?: string; agenciaId?: string },
    usuarioId: string,
  ) {
    const motivoFinal = (dto.motivo || dto.observaciones || '').toString().trim();
    if (!motivoFinal) {
      throw new BadRequestException('Debes escribir el motivo del rechazo.');
    }
    return this.confirmarRecepcion(
      {
        movimientoId: dto.movimientoId,
        accion: 'RECHAZADO',
        motivo: motivoFinal,
        observaciones: motivoFinal,
        agenciaId: dto.agenciaId,
      },
      usuarioId,
    );
  }

  async listDespachos(dto: ListMovimientosDto, usuarioId?: string) {
    const targetAgencyFilter = dto.sucursalId || (dto as any).agenciaId || (dto as any).agenciaDestinoId;
    let agencySearchFilter: any = undefined;
    if (targetAgencyFilter) {
      const ag = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { id: targetAgencyFilter },
            { nombre: { contains: targetAgencyFilter, mode: 'insensitive' } },
            { codigo: { contains: targetAgencyFilter, mode: 'insensitive' } },
          ],
        },
      });
      const searchTerms = [targetAgencyFilter];
      if (ag) {
        searchTerms.push(ag.id);
        searchTerms.push(ag.nombre);
        if (ag.codigo) searchTerms.push(ag.codigo);
      }
      agencySearchFilter = {
        OR: searchTerms.map((term) => ({
          destinoUbicacion: { contains: term, mode: 'insensitive' },
        })),
      };
    }

    let regionalFilter: any = undefined;
    let isPulidorViewer = false;
    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true },
      });
      const rol = usuario?.role?.namerol?.toUpperCase() || '';
      isPulidorViewer = rol.includes('PULIDOR');
      const isAsistente = (rol.includes('ASISTENTE') && rol.includes('BODEGA')) || rol === 'ASISTENTE_BODEGA';
      if (usuario && isAsistente) {
        const conditions: any[] = [
          { usuarioDespachaId: usuario.id },
          { usuarioRecibeId: usuario.id },
        ];

        if (usuario.regionId || usuario.region?.nombre) {
          const agenciasRegion = await this.prisma.agencia.findMany({
            where: {
              OR: [
                ...(usuario.regionId ? [{ regionId: usuario.regionId }] : []),
                ...(usuario.region?.nombre ? [{ region: { contains: usuario.region.nombre, mode: 'insensitive' as const } }] : []),
              ],
            },
            select: { id: true, nombre: true },
          });
          const bodegasRegion = usuario.regionId
            ? ((await this.prisma.$queryRawUnsafe(
                `SELECT "id", "nombre", "codigo" FROM "bodegas" WHERE "regionId" = $1`,
                usuario.regionId,
              ).catch(() => [])) as any[])
            : [];

          const terms = [
            ...agenciasRegion.flatMap((a) => [a.id, a.nombre]),
            ...bodegasRegion.flatMap((b: any) => [b.id, b.nombre, b.codigo]),
            usuario.region?.nombre || '',
          ].filter(Boolean);

          for (const t of terms) {
            conditions.push({ destinoUbicacion: { contains: t, mode: 'insensitive' } });
            conditions.push({ origenUbicacion: { contains: t, mode: 'insensitive' } });
          }
        }

        regionalFilter = { OR: conditions };
      }
    }

    await this.ensureDespachoRutaColumns();

    // Listar por SQL (tipo::text) para no depender del enum generado de Prisma
    // (si falta DESPACHO_BODEGA en el client, findMany rompe y Envíos queda vacío).
    const estadoFilter = dto.estadoDespacho ? String(dto.estadoDespacho) : null;
    const guiaFilter = dto.numeroGuia ? `%${String(dto.numeroGuia)}%` : null;

    let idRows: any[] = [];
    try {
      idRows = await this.prisma.$queryRawUnsafe(
        `SELECT m."id", m."fechaDespacho"
         FROM "MovimientoInventario" m
         WHERE m."tipo"::text IN ('DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'DESPACHO_BODEGA')
           AND ($1::text IS NULL OR m."estadoDespacho"::text = $1)
           AND ($2::text IS NULL OR m."numeroGuia" ILIKE $2)
         ORDER BY m."fechaDespacho" DESC
         LIMIT 500`,
        estadoFilter,
        guiaFilter,
      );
    } catch (e) {
      // Fallback sin DESPACHO_BODEGA si el enum aún no existe en BD
      idRows = await this.prisma.$queryRawUnsafe(
        `SELECT m."id", m."fechaDespacho"
         FROM "MovimientoInventario" m
         WHERE m."tipo"::text IN ('DESPACHO_AGENCIA', 'DESPACHO_PULIDOR')
           AND ($1::text IS NULL OR m."estadoDespacho"::text = $1)
           AND ($2::text IS NULL OR m."numeroGuia" ILIKE $2)
         ORDER BY m."fechaDespacho" DESC
         LIMIT 500`,
        estadoFilter,
        guiaFilter,
      );
    }

    const allIds = idRows.map((r) => String(r.id));
    if (allIds.length === 0) return [];

    // Cabeceras vía SQL tipado como texto (evita crash del enum Prisma)
    const headerRows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT m."id", m."numeroGuia", m."tipo"::text AS "tipo", m."estadoDespacho"::text AS "estadoDespacho",
              m."origenUbicacion", m."destinoUbicacion", m."fechaDespacho", m."fechaRecepcion",
              m."observaciones", m."usuarioDespachaId", m."usuarioRecibeId", m."createdAt", m."updatedAt",
              m."origenBodegaId", m."origenAgenciaId", m."destinoBodegaId", m."destinoAgenciaId", m."destinoPulidorId"
       FROM "MovimientoInventario" m
       WHERE m."id" = ANY($1::text[])
       ORDER BY m."fechaDespacho" DESC`,
      allIds,
    );

    // Detalles + usuarios con Prisma (sin leer el enum problemático en findMany del movimiento)
    const detalles = await this.prisma.movimientoDetalle.findMany({
      where: { movimientoId: { in: allIds } },
      include: {
        insumo: {
          select: { id: true, codigoSKU: true, nombre: true, unidadMedida: true },
        },
      },
    });
    const userIds = [
      ...new Set(
        headerRows
          .flatMap((h) => [h.usuarioDespachaId, h.usuarioRecibeId])
          .filter(Boolean)
          .map(String),
      ),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, lastname: true },
        })
      : [];
    const userById = new Map(users.map((u) => [u.id, u]));
    const detallesByMov = new Map<string, any[]>();
    for (const d of detalles) {
      const arr = detallesByMov.get(d.movimientoId) || [];
      arr.push(d);
      detallesByMov.set(d.movimientoId, arr);
    }

    let movimientos: any[] = headerRows.map((h) => ({
      ...h,
      tipo: h.tipo,
      estadoDespacho: h.estadoDespacho,
      detalles: detallesByMov.get(String(h.id)) || [],
      usuarioDespacha: h.usuarioDespachaId ? userById.get(h.usuarioDespachaId) || null : null,
      usuarioRecibe: h.usuarioRecibeId ? userById.get(h.usuarioRecibeId) || null : null,
    }));

    // Filtros adicionales en memoria (agencia / región / pulidor)
    if (agencySearchFilter?.OR?.length) {
      const terms = agencySearchFilter.OR.map((o: any) =>
        String(o.destinoUbicacion?.contains || '').toLowerCase(),
      ).filter(Boolean);
      if (terms.length) {
        movimientos = movimientos.filter((m) =>
          terms.some((t: string) => String(m.destinoUbicacion || '').toLowerCase().includes(t)),
        );
      }
    }
    const targetPulidor = dto.pulidorId || (isPulidorViewer ? usuarioId : null);
    if (targetPulidor) {
      movimientos = movimientos.filter(
        (m) => String(m.usuarioRecibeId) === String(targetPulidor) || String(m.destinoPulidorId) === String(targetPulidor),
      );
    }
    if (regionalFilter?.OR?.length) {
      const viewerId = usuarioId;
      movimientos = movimientos.filter((m) => {
        if (viewerId && (m.usuarioDespachaId === viewerId || m.usuarioRecibeId === viewerId)) return true;
        const blob = `${m.destinoUbicacion || ''} ${m.origenUbicacion || ''}`.toLowerCase();
        return regionalFilter.OR.some((cond: any) => {
          const t = cond.destinoUbicacion?.contains || cond.origenUbicacion?.contains;
          return t ? blob.includes(String(t).toLowerCase()) : false;
        });
      });
    }

    // Enrich FKs + flag de confirmación para el usuario actual
    const fkById = new Map<string, any>();
    for (const h of headerRows) {
      fkById.set(String(h.id), h);
    }

    let viewer: any = null;
    if (usuarioId) {
      viewer = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true },
      });
    }
    const viewerRole = (viewer?.role?.namerol || '').toUpperCase();
    const viewerIsSuperAdmin =
      viewerRole === 'SUPER_ADMIN' ||
      (viewerRole.includes('SUPER') && viewerRole.includes('ADMIN'));
    const viewerIsAdmin = viewerRole === 'ADMIN' && !viewerIsSuperAdmin;

    return movimientos.map((m) => {
      const fk = fkById.get(m.id) || {};
      let motivoRechazo = '';
      if (m.observaciones && m.observaciones.includes('RECHAZO:')) {
        const parts = m.observaciones.split(/RECHAZO:\s*/i);
        if (parts.length > 1) motivoRechazo = parts[parts.length - 1].trim();
      }

      let destinoAgenciaId = fk.destinoAgenciaId || null;
      if (!destinoAgenciaId && m.destinoUbicacion?.includes('[')) {
        const match = String(m.destinoUbicacion).match(/\[(.*?)\]/);
        if (match?.[1]) destinoAgenciaId = match[1].trim();
      }

      const destinoBodegaId = fk.destinoBodegaId || null;
      const destinoPulidorId = fk.destinoPulidorId || (m.tipo === 'DESPACHO_PULIDOR' ? m.usuarioRecibeId : null);

      let puedeConfirmar = false;
      if (m.estadoDespacho === 'EN_TRANSITO' && viewer) {
        if (viewerIsSuperAdmin) {
          puedeConfirmar = true;
        } else if (!viewerIsAdmin) {
          const isLider =
            viewerRole === 'LIDER' ||
            viewerRole === 'LIDER_AGENCIA' ||
            viewerRole === 'LIDER_OPERADOR';
          const isAsistente =
            viewerRole === 'ASISTENTE_BODEGA' ||
            (viewerRole.includes('ASISTENTE') && viewerRole.includes('BODEGA'));
          if (destinoAgenciaId && isLider && viewer.agenciaId === destinoAgenciaId) {
            puedeConfirmar = true;
          } else if (destinoBodegaId && isAsistente && viewer.bodegaId === destinoBodegaId) {
            puedeConfirmar = true;
          } else if (destinoPulidorId && viewer.id === destinoPulidorId) {
            puedeConfirmar = true;
          }
        }
      }

      return {
        ...m,
        origenBodegaId: fk.origenBodegaId || null,
        origenAgenciaId: fk.origenAgenciaId || null,
        destinoBodegaId,
        destinoAgenciaId,
        destinoPulidorId,
        motivoRechazo: motivoRechazo || undefined,
        puedeConfirmar,
      };
    });
  }

  async obtenerDespachosPendientesAgencia(agenciaId: string) {
    if (!agenciaId) return [];

    let agencia = null;
    try {
      agencia = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { id: agenciaId },
            { nombre: { contains: agenciaId, mode: 'insensitive' } },
            { codigo: { contains: agenciaId, mode: 'insensitive' } },
          ],
        },
      });
    } catch {
      // Ignorar
    }

    const searchTerms: string[] = [agenciaId];
    if (agencia) {
      searchTerms.push(agencia.id);
      searchTerms.push(agencia.nombre);
      if (agencia.codigo) searchTerms.push(agencia.codigo);
    }

    const orConditions = searchTerms.map((term) => ({
      destinoUbicacion: { contains: term, mode: 'insensitive' as const },
    }));

    return this.prisma.movimientoInventario.findMany({
      where: {
        tipo: 'DESPACHO_AGENCIA',
        estadoDespacho: 'EN_TRANSITO',
        OR: orConditions,
      },
      orderBy: { fechaDespacho: 'desc' },
      include: {
        detalles: {
          include: {
            insumo: {
              select: {
                id: true,
                codigoSKU: true,
                nombre: true,
                unidadMedida: true,
              },
            },
          },
        },
        usuarioDespacha: { select: { id: true, name: true, lastname: true } },
      },
    });
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

  /**
   * Materializa necesidades de servicios ya asignados aunque nunca hayan
   * recibido stock: crea el slot en cero y una alerta pendiente.
   */
  private async sincronizarNecesidadesAsignadas(emisorId: string): Promise<void> {
    const [agencias, pulidores] = await Promise.all([
      this.prisma.agencia.findMany({
        where: { estado: 1 },
        select: { id: true, nombre: true, servicioIds: true },
      }),
      this.prisma.user.findMany({
        where: {
          estado: 1,
          role: { namerol: { in: ['PULIDOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL'] } },
        },
        select: {
          id: true,
          name: true,
          lastname: true,
          agenciaId: true,
          region: { select: { nombre: true } },
          agencia: { select: { nombre: true } },
          servicioIds: true,
        },
      }),
    ]);

    const ids = new Set<number>();
    for (const target of [...agencias, ...pulidores]) {
      const raw = Array.isArray(target.servicioIds) ? target.servicioIds : [];
      for (const id of raw) {
        const num = Number(id);
        if (!Number.isNaN(num) && num > 0) ids.add(num);
      }
    }
    if (ids.size === 0) return;

    const recetas = await this.prisma.recetaInsumo.findMany({
      where: { catalogoServicioId: { in: [...ids] } },
      include: {
        insumo: {
          select: { id: true, nombre: true, stockMinimoAgencia: true },
        },
        catalogoServicio: { select: { id: true, nombre: true } },
      },
    });

    const recetasPorServicio = new Map<number, typeof recetas>();
    for (const receta of recetas) {
      const list = recetasPorServicio.get(receta.catalogoServicioId) || [];
      list.push(receta);
      recetasPorServicio.set(receta.catalogoServicioId, list);
    }

    const sincronizarTarget = async (params: {
      servicioIds: unknown;
      agenciaId?: string | null;
      pulidorId?: string | null;
      tipoUbicacion: 'AGENCIA' | 'PULIDOR_FIJO' | 'PULIDOR_MOVIL';
      etiqueta: string;
    }) => {
      const raw = Array.isArray(params.servicioIds) ? params.servicioIds : [];
      const targetRecetas = raw.flatMap(
        (id) => recetasPorServicio.get(Number(id)) || [],
      );
      const porInsumo = new Map<string, typeof targetRecetas>();
      for (const receta of targetRecetas) {
        const list = porInsumo.get(receta.insumoId) || [];
        list.push(receta);
        porInsumo.set(receta.insumoId, list);
      }

      for (const [insumoId, recetasInsumo] of porInsumo) {
        const stock = await this.prisma.stockUbicacion.findFirst({
          where: params.pulidorId
            ? { pulidorId: params.pulidorId, insumoId }
            : {
                agenciaId: params.agenciaId || undefined,
                tipoUbicacion: 'AGENCIA',
                insumoId,
              },
          select: { id: true, cantidadActual: true },
        });

        let cantidadActual = Number(stock?.cantidadActual || 0);
        if (!stock) {
          const insumo = recetasInsumo[0]?.insumo;
          const created = await this.prisma.stockUbicacion.create({
            data: {
              insumoId,
              agenciaId: params.agenciaId || null,
              pulidorId: params.pulidorId || null,
              tipoUbicacion: params.tipoUbicacion,
              cantidadActual: 0,
              cantidadMinima: insumo?.stockMinimoAgencia ?? 1,
            },
            select: { cantidadActual: true },
          });
          cantidadActual = Number(created.cantidadActual);
        }

        if (cantidadActual > 0) continue;

        const alertaExistente = await this.prisma.alertaStock.findFirst({
          where: {
            insumoId,
            estado: 'PENDIENTE',
            ...(params.pulidorId
              ? { pulidorId: params.pulidorId }
              : { agenciaId: params.agenciaId || null, pulidorId: null }),
          },
          select: { id: true },
        });
        if (alertaExistente) continue;

        const nombresServicios = [
          ...new Set(recetasInsumo.map((r) => r.catalogoServicio.nombre)),
        ];
        await this.prisma.alertaStock.create({
          data: {
            insumoId,
            nivel: 'AGOTADO',
            estado: 'PENDIENTE',
            agenciaId: params.agenciaId || null,
            pulidorId: params.pulidorId || null,
            usuarioEmisorId: emisorId,
            stockReportado: 0,
            mensaje:
              `${params.etiqueta}: ${recetasInsumo[0]?.insumo.nombre || 'Insumo'} ` +
              `requerido por ${nombresServicios.join(', ')} sin stock. Despachar insumos.`,
          },
        });
      }
    };

    for (const agencia of agencias) {
      await sincronizarTarget({
        servicioIds: agencia.servicioIds,
        agenciaId: agencia.id,
        tipoUbicacion: 'AGENCIA',
        etiqueta: `Sede ${agencia.nombre}`,
      });
    }

    for (const pulidor of pulidores) {
      await sincronizarTarget({
        servicioIds: pulidor.servicioIds,
        agenciaId: pulidor.agenciaId,
        pulidorId: pulidor.id,
        tipoUbicacion: pulidor.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL',
        etiqueta: pulidor.agenciaId
          ? `Pulidor fijo ${pulidor.name} ${pulidor.lastname} (${pulidor.agencia?.nombre || 'sede'})`
          : `Pulidor móvil ${pulidor.name} ${pulidor.lastname} (${pulidor.region?.nombre || 'sin región'})`,
      });
    }
  }

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

  async listAlertas(dto: ListAlertasDto, usuarioId?: string) {
    const where: any = {};
    if (dto.nivel) where.nivel = dto.nivel;
    if (dto.estado) where.estado = dto.estado;
    const targetAgencia = (dto as any).agenciaId || dto.sucursalId;

    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true, bodega: true, agencia: true },
      });
      const userRole = (usuario?.role?.namerol || '').toUpperCase();
      const isAsistente =
        userRole === 'ASISTENTE_BODEGA' ||
        (userRole.includes('ASISTENTE') && userRole.includes('BODEGA'));
      const isLiderSede =
        userRole === 'LIDER' ||
        userRole === 'LIDER_AGENCIA' ||
        userRole === 'LIDER_OPERADOR' ||
        userRole.includes('LIDER') ||
        userRole === 'APROBADOR';
      const isSupervisorRegional =
        userRole.includes('SUPERVISOR') && !userRole.includes('NACIONAL');
      const isGlobalAlertViewer =
        userRole === 'SUPER_ADMIN' ||
        userRole === 'ADMIN' ||
        userRole === 'COORD_BODEGA' ||
        userRole === 'DISTRIBUIDOR';

      if (isGlobalAlertViewer || isAsistente || isSupervisorRegional) {
        await this.sincronizarNecesidadesAsignadas(usuarioId);
      }

      if (isGlobalAlertViewer) {
        // Nacional: todo (opcional filtro por sucursal del DTO)
        if (targetAgencia) where.agenciaId = targetAgencia;
      } else if (isAsistente || isSupervisorRegional) {
        // Región: alertas de agencias de la región + kits de pulidores de la región
        const regionId = usuario?.bodega?.regionId || usuario?.regionId;
        if (regionId) {
          const agenciasRegion = await this.prisma.agencia.findMany({
            where: { regionId },
            select: { id: true },
          });
          const agIds = agenciasRegion.map((a) => a.id);
          const pulidoresRegion = await this.prisma.user.findMany({
            where: {
              regionId,
              role: { namerol: { in: ['PULIDOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL'] } },
            },
            select: { id: true },
          });
          const pulIds = pulidoresRegion.map((p) => p.id);

          const orScope: any[] = [];
          if (targetAgencia) {
            if (agIds.includes(targetAgencia)) orScope.push({ agenciaId: targetAgencia });
          } else if (agIds.length > 0) {
            orScope.push({ agenciaId: { in: agIds } });
          }
          if (pulIds.length > 0) {
            orScope.push({ pulidorId: { in: pulIds } });
          }
          if (orScope.length > 0) {
            where.OR = orScope;
          } else {
            where.agenciaId = '__SIN_ALCANCE_REGION__';
          }
        } else {
          where.agenciaId = '__SIN_REGION__';
        }
      } else if (isLiderSede) {
        // Solo alertas de SU sede (nunca Bodega Central / otras agencias)
        const miAgencia = usuario?.agenciaId || targetAgencia;
        where.agenciaId = miAgencia || '__SIN_AGENCIA_LIDER__';
      } else if (targetAgencia) {
        where.agenciaId = targetAgencia;
      } else {
        // Rol no reconocido: no exponer alertas ajenas
        where.agenciaId = '__SIN_ALCANCE__';
      }
    } else if (targetAgencia) {
      where.agenciaId = targetAgencia;
    }

    return this.prisma.alertaStock.findMany({
      where,
      orderBy: [{ nivel: 'asc' }, { createdAt: 'desc' }],
      include: {
        insumo: { select: { codigoSKU: true, nombre: true, categoria: true } },
        agencia: { select: { codigo: true, nombre: true, region: true } },
        pulidor: { select: { id: true, name: true, lastname: true } },
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
    await this.ensureMovimientoGlobalRutaColumns();

    const where: any = {};
    if (dto.estado !== undefined) where.estado = dto.estado;
    if (dto.esEntrada !== undefined) where.esEntrada = dto.esEntrada;

    const items = await this.prisma.tipoMovimientoInventario.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: {
        _count: { select: { motivos: true, movimientos: true } },
      },
    });

    return items.map((t) => ({
      ...t,
      nombre: this.labelTipoMovimiento(t.codigo, t.nombre),
    }));
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

  private static readonly TIPO_MOVIMIENTO_LABELS: Record<string, string> = {
    ENTRY: 'Ingreso',
    CONSUMPTION: 'Consumo',
    POSITIVE_ADJUSTMENT: 'Ajuste (+)',
    NEGATIVE_ADJUSTMENT: 'Ajuste (−)',
    WASTE: 'Merma',
    RETURN: 'Devolución',
    TRANSFER: 'Envío / Transferencia',
  };

  private async ensureMovimientoGlobalRutaColumns(): Promise<void> {
    try {
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "origenUbicacion" TEXT`,
      );
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "destinoUbicacion" TEXT`,
      );
    } catch (_) {
      /* columnas ya existen o sin permisos — listado sigue enriqueciendo en memoria */
    }

    try {
      await this.prisma.$executeRawUnsafe(`
        UPDATE "TipoMovimientoInventario" SET "nombre" = CASE "codigo"
          WHEN 'ENTRY' THEN 'Ingreso'
          WHEN 'CONSUMPTION' THEN 'Consumo'
          WHEN 'POSITIVE_ADJUSTMENT' THEN 'Ajuste (+)'
          WHEN 'NEGATIVE_ADJUSTMENT' THEN 'Ajuste (−)'
          WHEN 'WASTE' THEN 'Merma'
          WHEN 'RETURN' THEN 'Devolución'
          WHEN 'TRANSFER' THEN 'Envío / Transferencia'
          ELSE "nombre"
        END
        WHERE "codigo" IN (
          'ENTRY','CONSUMPTION','POSITIVE_ADJUSTMENT','NEGATIVE_ADJUSTMENT','WASTE','RETURN','TRANSFER'
        )
      `);
    } catch (_) {}
  }

  private labelTipoMovimiento(codigo?: string | null, nombreFallback?: string | null): string {
    const code = (codigo || '').toUpperCase();
    return InventarioService.TIPO_MOVIMIENTO_LABELS[code] || nombreFallback || code || 'Movimiento';
  }

  private async resolverEtiquetaUbicacion(ubicacionId?: string | null): Promise<string | null> {
    const id = (ubicacionId || '').toString().trim();
    if (!id) return null;

    // Alias legacy usado en KardexMovimiento / StockUbicacion
    if (id === 'BODEGA_CENTRAL' || id === 'bod_central') {
      try {
        const central: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT b."nombre" FROM "bodegas" b
           WHERE b."tipo" = 'CENTRAL' OR b."esCentral" = true OR b."id" = 'bod_central' OR b."codigo" = 'BOD-CENTRAL'
           LIMIT 1`,
        );
        if (central.length > 0) return `${central[0].nombre} (Central)`;
      } catch (_) {}
      return 'Bodega Central Nacional (Central)';
    }

    try {
      const bodRows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT b."nombre", b."tipo", b."esCentral", r."nombre" as "regionNombre"
         FROM "bodegas" b
         LEFT JOIN "Region" r ON b."regionId" = r."id"
         WHERE b."id" = $1 LIMIT 1`,
        id,
      );
      if (bodRows.length > 0) {
        const b = bodRows[0];
        const esCentral = !!b.esCentral || b.tipo === 'CENTRAL';
        const sufijo = esCentral ? 'Central' : (b.regionNombre ? `Regional · ${b.regionNombre}` : 'Regional');
        return `${b.nombre} (${sufijo})`;
      }
    } catch (_) {}

    try {
      const ag = await this.prisma.agencia.findUnique({
        where: { id },
        select: { nombre: true, codigo: true },
      });
      if (ag) return `Agencia ${ag.nombre}${ag.codigo ? ` [${ag.codigo}]` : ''}`;
    } catch (_) {}

    return id;
  }

  private async obtenerEtiquetaBodegaCentral(): Promise<string> {
    try {
      const central: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT b."nombre" FROM "bodegas" b
         WHERE b."tipo" = 'CENTRAL' OR b."esCentral" = true OR b."id" = 'bod_central' OR b."codigo" = 'BOD-CENTRAL'
         LIMIT 1`,
      );
      if (central.length > 0) return `${central[0].nombre} (Central)`;
    } catch (_) {}
    return 'Bodega Central Nacional (Central)';
  }

  private async construirRutaMovimiento(params: {
    codigoTipo: string;
    ubicacionId?: string | null;
    origenExplicit?: string | null;
    destinoExplicit?: string | null;
  }): Promise<{ origen: string; destino: string }> {
    const codigo = (params.codigoTipo || '').toUpperCase();
    let ubicacionLabel = await this.resolverEtiquetaUbicacion(params.ubicacionId);

    // Ingresos/ajustes sin ubicación → por defecto Bodega Central (histórico)
    if (!ubicacionLabel && (codigo === 'ENTRY' || codigo === 'POSITIVE_ADJUSTMENT' || codigo === 'RETURN')) {
      ubicacionLabel = await this.obtenerEtiquetaBodegaCentral();
    }
    if (!ubicacionLabel) {
      ubicacionLabel = 'Ubicación no especificada';
    }

    const origenExp = (params.origenExplicit || '').toString().trim();
    const destinoExp = (params.destinoExplicit || '').toString().trim();

    switch (codigo) {
      case 'ENTRY':
      case 'POSITIVE_ADJUSTMENT':
        return {
          origen: origenExp || 'Proveedor / Compra externa',
          destino: destinoExp || ubicacionLabel,
        };
      case 'RETURN':
        return {
          origen: origenExp || ubicacionLabel,
          destino: destinoExp || 'Proveedor / Devolución',
        };
      case 'TRANSFER':
        return {
          origen: origenExp || 'Origen no especificado',
          destino: destinoExp || ubicacionLabel,
        };
      case 'CONSUMPTION':
        return {
          origen: origenExp || ubicacionLabel,
          destino: destinoExp || 'Consumo operativo',
        };
      case 'WASTE':
        return {
          origen: origenExp || ubicacionLabel,
          destino: destinoExp || 'Merma / baja',
        };
      case 'NEGATIVE_ADJUSTMENT':
        return {
          origen: origenExp || ubicacionLabel,
          destino: destinoExp || 'Ajuste de inventario',
        };
      default:
        return {
          origen: origenExp || ubicacionLabel,
          destino: destinoExp || ubicacionLabel,
        };
    }
  }

  async registrarMovimientoGlobal(dto: RegistrarMovimientoOperativoDto, usuarioId?: string) {
    await this.ensureMovimientoGlobalRutaColumns();

    // Normalizar bodega/ubicación destino
    const ubicacionDestino = (dto.ubicacionId || (dto as any).bodegaId || '').toString().trim() || undefined;
    const dtoNorm = { ...dto, ubicacionId: ubicacionDestino };

    return this.prisma.$transaction(async (tx) => {
      // 1. Obtener producto y validar
      const insumo = await tx.insumo.findUnique({
        where: { id: dtoNorm.insumoId },
        include: { unidadMedida: true },
      });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${dtoNorm.insumoId}" no encontrado`);

      // 2. Obtener tipo de movimiento
      const tipoMov = await tx.tipoMovimientoInventario.findUnique({
        where: { id: dtoNorm.tipoMovimientoId },
      });
      if (!tipoMov) throw new NotFoundException(`Tipo de movimiento con ID "${dtoNorm.tipoMovimientoId}" no encontrado`);

      // 3. Validar motivo si viene especificado
      if (dtoNorm.motivoId) {
        const motivo = await tx.motivoMovimientoInventario.findUnique({ where: { id: dtoNorm.motivoId } });
        if (!motivo) throw new NotFoundException(`Motivo con ID "${dtoNorm.motivoId}" no encontrado`);
      }

      // Unidad: usar la del DTO o fallback a la del insumo
      const unidadIdFinal = (dtoNorm.unidadId || insumo.unidadMedidaId || '').toString().trim();
      if (!unidadIdFinal) {
        throw new BadRequestException('unidadId es requerido y el insumo no tiene unidad de medida asociada');
      }
      const unidadExiste = await tx.unidadMedida.findUnique({ where: { id: unidadIdFinal } });
      if (!unidadExiste) {
        throw new NotFoundException(`Unidad de medida con ID "${unidadIdFinal}" no encontrada`);
      }

      // 4. Calcular cantidad real en unidad base
      let cantidadBase = Number(dtoNorm.cantidad);
      let presentacion: any = null;

      if (dtoNorm.presentacionId) {
        presentacion = await tx.presentacionInsumo.findUnique({
          where: { id: dtoNorm.presentacionId },
        });
        if (!presentacion || presentacion.insumoId !== insumo.id) {
          throw new BadRequestException('La presentación seleccionada no corresponde al producto');
        }
        cantidadBase = Number(dtoNorm.cantidad) * Number(presentacion.factorAUnidadBase);
      }

      // Resolver bodega destino (si ubicacionId apunta a una bodega)
      let bodegaTarget: { id: string; esCentral?: boolean; tipo?: string; nombre?: string } | null = null;
      if (dtoNorm.ubicacionId) {
        const bodRows: any[] = await tx.$queryRawUnsafe(
          `SELECT "id", "tipo", "esCentral", "nombre" FROM "bodegas" WHERE "id" = $1 LIMIT 1`,
          dtoNorm.ubicacionId,
        );
        if (bodRows.length > 0) bodegaTarget = bodRows[0];
      }

      const codigoTipo = (tipoMov.codigo || '').toUpperCase();
      const esIngresoCompra =
        tipoMov.esEntrada &&
        (codigoTipo === 'ENTRY' || codigoTipo === 'POSITIVE_ADJUSTMENT' || codigoTipo === 'RETURN');

      // Solo Bodega Central admite ingresos de compra/ajuste positivo.
      // Las regionales y agencias se abastecen por envíos (despacho + confirmación).
      if (esIngresoCompra) {
        const centralRows: any[] = await tx.$queryRawUnsafe(
          `SELECT "id", "tipo", "esCentral", "nombre" FROM "bodegas"
           WHERE "tipo" = 'CENTRAL' OR "esCentral" = true OR "id" = 'bod_central' OR "codigo" = 'BOD-CENTRAL'
           LIMIT 1`,
        );
        const central = centralRows[0] || null;
        if (!central) {
          throw new BadRequestException('No hay Bodega Central configurada para registrar ingresos.');
        }
        if (bodegaTarget && !(bodegaTarget.esCentral || bodegaTarget.tipo === 'CENTRAL')) {
          throw new BadRequestException(
            `Los ingresos solo se registran en Bodega Central. Para abastecer "${bodegaTarget.nombre || 'esta bodega'}" debes crear un envío desde Central.`,
          );
        }
        // Forzar siempre Central en ingresos
        bodegaTarget = central;
        dtoNorm.ubicacionId = central.id;
      } else if (!bodegaTarget) {
        const centralRows: any[] = await tx.$queryRawUnsafe(
          `SELECT "id", "tipo", "esCentral", "nombre" FROM "bodegas" WHERE "tipo" = 'CENTRAL' OR "esCentral" = true LIMIT 1`,
        );
        if (centralRows.length > 0 && !dtoNorm.ubicacionId) {
          bodegaTarget = centralRows[0];
          dtoNorm.ubicacionId = centralRows[0].id;
        } else if (dtoNorm.ubicacionId && !bodegaTarget) {
          // Enviaron un id que no es bodega → se trata como agencia más abajo
        }
      }

      // Stock de la ubicación (bodega específica) o del catálogo global
      let stockAnterior = Number(insumo.stockActual);
      if (bodegaTarget) {
        const esCentralBod = !!bodegaTarget.esCentral || bodegaTarget.tipo === 'CENTRAL';
        const stockRows: any[] = await tx.$queryRawUnsafe(
          esCentralBod
            ? `SELECT "id", "cantidadActual" FROM "StockUbicacion"
               WHERE "insumoId" = $1 AND ("bodegaId" = $2 OR ("tipoUbicacion" = 'BODEGA_CENTRAL' AND "bodegaId" IS NULL))
               ORDER BY CASE WHEN "bodegaId" = $2 THEN 0 ELSE 1 END
               LIMIT 1`
            : `SELECT "id", "cantidadActual" FROM "StockUbicacion"
               WHERE "insumoId" = $1 AND "bodegaId" = $2 LIMIT 1`,
          insumo.id,
          bodegaTarget.id,
        );
        stockAnterior = Number(stockRows[0]?.cantidadActual ?? 0);
      }

      // 5. Validar disponibilidad de stock para salidas / consumos
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

      const ruta = await this.construirRutaMovimiento({
        codigoTipo: tipoMov.codigo,
        ubicacionId: dtoNorm.ubicacionId || bodegaTarget?.id,
        origenExplicit: dtoNorm.origenUbicacion,
        destinoExplicit: dtoNorm.destinoUbicacion,
      });

      // 7. Registrar en MovimientoInventarioGlobal
      const movGlobal = await tx.movimientoInventarioGlobal.create({
        data: {
          numeroComprobante,
          tipoMovimientoId: tipoMov.id,
          insumoId: insumo.id,
          cantidad: dtoNorm.cantidad,
          unidadId: unidadIdFinal,
          cantidadBase: deltaBase,
          stockAnterior,
          stockNuevo: nuevoStock,
          presentacionId: dtoNorm.presentacionId || null,
          ubicacionId: dtoNorm.ubicacionId || bodegaTarget?.id || null,
          responsableId: usuarioId || null,
          motivoId: dtoNorm.motivoId || null,
          referencia: dtoNorm.referencia || null,
          observaciones: dtoNorm.observaciones || null,
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

      // Persistir ruta origen→destino (compatible si el client Prisma aún no regeneró)
      try {
        await tx.$executeRawUnsafe(
          `UPDATE "MovimientoInventarioGlobal"
           SET "origenUbicacion" = $1, "destinoUbicacion" = $2
           WHERE "id" = $3`,
          ruta.origen,
          ruta.destino,
          movGlobal.id,
        );
      } catch (_) {}

      // 8. Registrar en KardexMovimiento para trazabilidad contable
      const ubicacionKardex = dtoNorm.ubicacionId || bodegaTarget?.id || 'BODEGA_CENTRAL';
      await tx.kardexMovimiento.create({
        data: {
          insumoId: insumo.id,
          ubicacionId: ubicacionKardex,
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

      // 9. Actualizar stock global del catálogo (suma delta)
      const stockCatalogoNuevo = Math.max(0, Number(insumo.stockActual) + deltaBase);
      await tx.insumo.update({
        where: { id: insumo.id },
        data: { stockActual: stockCatalogoNuevo },
      });

      // 10. Actualizar existencias en la bodega / agencia destino
      if (bodegaTarget) {
        const esCentralBod = !!bodegaTarget.esCentral || bodegaTarget.tipo === 'CENTRAL';
        const existingRows: any[] = await tx.$queryRawUnsafe(
          esCentralBod
            ? `SELECT "id" FROM "StockUbicacion"
               WHERE "insumoId" = $1 AND ("bodegaId" = $2 OR ("tipoUbicacion" = 'BODEGA_CENTRAL' AND "bodegaId" IS NULL))
               ORDER BY CASE WHEN "bodegaId" = $2 THEN 0 ELSE 1 END LIMIT 1`
            : `SELECT "id" FROM "StockUbicacion" WHERE "insumoId" = $1 AND "bodegaId" = $2 LIMIT 1`,
          insumo.id,
          bodegaTarget.id,
        );

        if (existingRows.length > 0) {
          await tx.$executeRawUnsafe(
            `UPDATE "StockUbicacion"
             SET "cantidadActual" = $1, "bodegaId" = $2, "tipoUbicacion" = 'BODEGA_CENTRAL', "updatedAt" = NOW()
             WHERE "id" = $3`,
            Math.max(0, nuevoStock),
            bodegaTarget.id,
            existingRows[0].id,
          );
        } else {
          await tx.$executeRawUnsafe(
            `INSERT INTO "StockUbicacion" ("id", "insumoId", "tipoUbicacion", "bodegaId", "agenciaId", "cantidadActual", "cantidadMinima", "updatedAt")
             VALUES ($1, $2, 'BODEGA_CENTRAL', $3, NULL, $4, $5, NOW())`,
            randomUUID(),
            insumo.id,
            bodegaTarget.id,
            Math.max(0, nuevoStock),
            Number(insumo.stockMinimoBodega || 0),
          );
        }
      } else if (dtoNorm.ubicacionId) {
        // ubicacionId = agencia
        const stockUbic = await tx.stockUbicacion.findFirst({
          where: {
            insumoId: insumo.id,
            tipoUbicacion: 'AGENCIA',
            agenciaId: dtoNorm.ubicacionId,
          },
        });
        if (stockUbic) {
          const cantUbic = Number(stockUbic.cantidadActual) + deltaBase;
          await tx.stockUbicacion.update({
            where: { id: stockUbic.id },
            data: { cantidadActual: Math.max(0, cantUbic) },
          });
        } else if (deltaBase > 0) {
          await tx.stockUbicacion.create({
            data: {
              insumoId: insumo.id,
              tipoUbicacion: 'AGENCIA',
              agenciaId: dtoNorm.ubicacionId,
              cantidadActual: deltaBase,
              cantidadMinima: insumo.stockMinimoAgencia,
            },
          });
        }
      } else {
        // Sin ubicación: stock en bodega central por defecto
        const stockUbic = await tx.stockUbicacion.findFirst({
          where: {
            insumoId: insumo.id,
            tipoUbicacion: 'BODEGA_CENTRAL',
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
              tipoUbicacion: 'BODEGA_CENTRAL',
              cantidadActual: Math.max(0, stockCatalogoNuevo),
              cantidadMinima: insumo.stockMinimoBodega,
            },
          });
        }
      }

      return {
        ...movGlobal,
        origenUbicacion: ruta.origen,
        destinoUbicacion: ruta.destino,
        tipoMovimiento: {
          ...movGlobal.tipoMovimiento,
          nombre: this.labelTipoMovimiento(tipoMov.codigo, tipoMov.nombre),
        },
      };
    });
  }

  /**
   * Alcance de Kardex / movimientos globales por rol:
   * - SUPER_ADMIN / ADMIN → todo
   * - COORD_BODEGA → solo Bodega Central (incluye ubicacionId null / legacy)
   * - ASISTENTE_BODEGA → solo su bodega regional asignada
   */
  private async resolverFiltroUbicacionKardex(usuarioId?: string): Promise<{
    mode: 'ALL' | 'FILTER' | 'NONE';
    ubicacionIds?: string[];
    incluirSinUbicacion?: boolean;
  }> {
    if (!usuarioId) return { mode: 'ALL' };

    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, bodega: true },
    });
    const role = (usuario?.role?.namerol || '').toUpperCase();

    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      (role.includes('SUPER') && role.includes('ADMIN')) ||
      (role.includes('GESTOR') && (role.includes('INVENTARIO') || role.includes('BODEGA')));

    if (isAdmin) return { mode: 'ALL' };

    const isCoord =
      role === 'COORD_BODEGA' ||
      (role.includes('COORD') && role.includes('BODEGA'));

    if (isCoord) {
      const centralRows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "id" FROM "bodegas"
         WHERE "tipo" = 'CENTRAL' OR "esCentral" = true OR "id" = 'bod_central' OR "codigo" = 'BOD-CENTRAL'`,
      );
      const ids = [
        ...centralRows.map((r) => String(r.id)),
        'BODEGA_CENTRAL',
        'bod_central',
      ];
      return {
        mode: 'FILTER',
        ubicacionIds: [...new Set(ids)],
        incluirSinUbicacion: true,
      };
    }

    const isAsistente =
      role === 'ASISTENTE_BODEGA' ||
      (role.includes('ASISTENTE') && role.includes('BODEGA'));

    if (isAsistente) {
      const bodegaId = (usuario?.bodegaId || '').toString().trim();
      if (!bodegaId) return { mode: 'NONE' };
      return { mode: 'FILTER', ubicacionIds: [bodegaId], incluirSinUbicacion: false };
    }

    // Otros roles con bodega asignada → solo esa bodega
    if (usuario?.bodegaId) {
      return { mode: 'FILTER', ubicacionIds: [String(usuario.bodegaId)], incluirSinUbicacion: false };
    }

    return { mode: 'ALL' };
  }

  private aplicarFiltroUbicacionKardex(
    where: any,
    scope: { mode: 'ALL' | 'FILTER' | 'NONE'; ubicacionIds?: string[]; incluirSinUbicacion?: boolean },
  ): any {
    if (scope.mode === 'ALL') return where;
    if (scope.mode === 'NONE') {
      return { ...where, id: '__SIN_ACCESO_KARDEX__' };
    }

    const ids = scope.ubicacionIds || [];
    const ubicacionClause = scope.incluirSinUbicacion
      ? { OR: [{ ubicacionId: { in: ids } }, { ubicacionId: null }] }
      : { ubicacionId: { in: ids } };

    return {
      ...where,
      AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ubicacionClause],
    };
  }

  async listMovimientosGlobales(dto: ListMovimientosGlobalesDto, usuarioId?: string) {
    await this.ensureMovimientoGlobalRutaColumns();

    const page = dto.page || 1;
    const pageSize = dto.pageSize || 20;
    const skip = (page - 1) * pageSize;
    const sortField = dto.sortField || 'fechaMovimiento';
    const sortOrder = dto.sortOrder || 'desc';

    let where: any = {};
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

    const scope = await this.resolverFiltroUbicacionKardex(usuarioId);
    where = this.aplicarFiltroUbicacionKardex(where, scope);

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

    // Rutas persistidas (columnas nuevas) + fallback por tipo/ubicación
    const rutaById = new Map<string, { origen?: string | null; destino?: string | null }>();
    if (items.length > 0) {
      try {
        const ids = items.map((i) => i.id);
        const rutasRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT "id", "origenUbicacion", "destinoUbicacion"
           FROM "MovimientoInventarioGlobal"
           WHERE "id" = ANY($1::text[])`,
          ids,
        );
        for (const r of rutasRows) {
          rutaById.set(String(r.id), {
            origen: r.origenUbicacion,
            destino: r.destinoUbicacion,
          });
        }
      } catch (_) {}
    }

    const ubicacionIds = [...new Set(items.map((i) => i.ubicacionId).filter(Boolean) as string[])];
    const ubicacionLabelById = new Map<string, string>();
    await Promise.all(
      ubicacionIds.map(async (uid) => {
        const label = await this.resolverEtiquetaUbicacion(uid);
        if (label) ubicacionLabelById.set(uid, label);
      }),
    );

    const enriched = await Promise.all(
      items.map(async (item) => {
        const stored = rutaById.get(item.id);
        let origen = (stored?.origen || '').toString().trim();
        let destino = (stored?.destino || '').toString().trim();

        const destinoInvalido =
          !destino ||
          destino === 'Ubicación no especificada' ||
          destino === 'Sin ubicación';
        const origenInvalido = !origen;

        if (origenInvalido || destinoInvalido) {
          const ruta = await this.construirRutaMovimiento({
            codigoTipo: item.tipoMovimiento?.codigo || '',
            ubicacionId: item.ubicacionId,
            origenExplicit: origenInvalido ? null : origen,
            destinoExplicit: destinoInvalido ? null : destino,
          });
          // Preferir label cacheado si el helper re-resolvió la misma ubicación
          if (item.ubicacionId && ubicacionLabelById.has(item.ubicacionId)) {
            const ubLabel = ubicacionLabelById.get(item.ubicacionId)!;
            const codigo = (item.tipoMovimiento?.codigo || '').toUpperCase();
            if (origenInvalido) {
              origen =
                codigo === 'ENTRY' || codigo === 'POSITIVE_ADJUSTMENT'
                  ? ruta.origen
                  : ubLabel;
            }
            if (destinoInvalido) {
              destino =
                codigo === 'ENTRY' || codigo === 'POSITIVE_ADJUSTMENT' || codigo === 'TRANSFER'
                  ? ubLabel
                  : ruta.destino;
            }
          } else {
            if (origenInvalido) origen = ruta.origen;
            if (destinoInvalido) destino = ruta.destino;
          }
        }

        return {
          ...item,
          origenUbicacion: origen,
          destinoUbicacion: destino,
          tipoMovimiento: {
            ...item.tipoMovimiento,
            nombre: this.labelTipoMovimiento(item.tipoMovimiento?.codigo, item.tipoMovimiento?.nombre),
          },
        };
      }),
    );

    return buildDataGridResponse(enriched, total, page, pageSize);
  }

  async obtenerResumenDashboard(usuarioId?: string) {
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

    const scope = await this.resolverFiltroUbicacionKardex(usuarioId);
    const whereMovMes = this.aplicarFiltroUbicacionKardex(
      { fechaMovimiento: { gte: inicioMes } },
      scope,
    );
    const whereUltimos = this.aplicarFiltroUbicacionKardex({}, scope);

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
        where: whereMovMes,
        include: { tipoMovimiento: true },
      }),
      this.prisma.movimientoInventarioGlobal.findMany({
        where: whereUltimos,
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
      ultimosMovimientos: ultimosMovimientos.map((m) => ({
        ...m,
        tipoMovimiento: m.tipoMovimiento
          ? {
              ...m.tipoMovimiento,
              nombre: this.labelTipoMovimiento(m.tipoMovimiento.codigo, m.tipoMovimiento.nombre),
            }
          : m.tipoMovimiento,
      })),
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

  async obtenerInsumosServiciosAgencia(agenciaId: string, servicioIds?: number[]) {
    if (!agenciaId) {
      throw new BadRequestException('Se requiere el ID de la agencia.');
    }

    let agencia = null;
    try {
      agencia = await this.prisma.agencia.findUnique({
        where: { id: agenciaId },
        include: {
          cliente: true,
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
          cliente: true,
          regionRel: true,
        },
      });
    }

    if (!agencia) {
      agencia = await this.prisma.agencia.findFirst({
        include: {
          cliente: true,
          regionRel: true,
        },
      });
    }

    if (!agencia) {
      throw new NotFoundException(`No se encontró ninguna agencia registrada en el sistema.`);
    }

    // Si no se envían servicioIds explícitos, usar automáticamente los agencia.servicioIds de la BD
    const rawIds = (servicioIds && servicioIds.length > 0)
      ? servicioIds
      : (Array.isArray(agencia.servicioIds) ? agencia.servicioIds : []);
    const cleanServicioIds = rawIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n) && n > 0);

    // Obtener los servicios del catálogo con sus recetas para los servicios activos de la sede
    const catalogo = cleanServicioIds.length > 0
      ? await this.prisma.catalogoServicio.findMany({
          where: { id: { in: cleanServicioIds } },
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
        })
      : [];

    // Auto-inicialización de slots de stock para insumos requeridos por las recetas que falten en StockUbicacion
    const recetasInsumos = catalogo.flatMap((c) => c.recetas.map((r) => r.insumo).filter(Boolean));

    let stocksAgencia = await this.prisma.stockUbicacion.findMany({
      where: {
        agenciaId: agencia.id,
        tipoUbicacion: 'AGENCIA',
      },
      include: {
        insumo: {
          include: {
            unidadMedida: true,
            tipoProducto: true,
          },
        },
      },
    });

    const setStocksExistentes = new Set(stocksAgencia.map((s) => s.insumoId));
    let nuevosSlotsCreados = false;

    for (const ins of recetasInsumos) {
      if (!setStocksExistentes.has(ins.id)) {
        try {
          await this.prisma.stockUbicacion.create({
            data: {
              agenciaId: agencia.id,
              insumoId: ins.id,
              tipoUbicacion: 'AGENCIA',
              cantidadActual: 0,
              cantidadMinima: ins.stockMinimoAgencia ?? 2,
            },
          });
          setStocksExistentes.add(ins.id);
          nuevosSlotsCreados = true;
        } catch (e) {
          console.warn(`[StockUbicacion] Error al auto-inicializar stock para insumo ${ins.id}:`, e);
        }
      }
    }

    if (nuevosSlotsCreados) {
      stocksAgencia = await this.prisma.stockUbicacion.findMany({
        where: {
          agenciaId: agencia.id,
          tipoUbicacion: 'AGENCIA',
        },
        include: {
          insumo: {
            include: {
              unidadMedida: true,
              tipoProducto: true,
            },
          },
        },
      });
    }

    // Mapear insumos requeridos por las recetas de los servicios asignados
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

    // REGLA FUNDAMENTAL: Si un insumo existe en el stock de la sede (StockUbicacion) pero su servicio
    // fue desasignado o quitado, DEBE PERMANECER visible en la sede con su stock real y no borrarse.
    for (const st of stocksAgencia) {
      if (st.insumo && !insumosMap.has(st.insumoId)) {
        insumosMap.set(st.insumoId, {
          insumo: st.insumo,
          servicios: [],
          consumoMaximo: 0,
        });
      }
    }

    const stockPorInsumo = new Map<string, number>();
    const stockMinimoPorInsumo = new Map<string, number>();
    for (const st of stocksAgencia) {
      const prev = stockPorInsumo.get(st.insumoId) ?? 0;
      stockPorInsumo.set(st.insumoId, prev + Number(st.cantidadActual));
      stockMinimoPorInsumo.set(st.insumoId, Number(st.cantidadMinima ?? st.insumo?.stockMinimoAgencia ?? 2));
    }

    let insumosOptimos = 0;
    let insumosBajoMinimo = 0;
    let insumosAgotados = 0;
    let insumosNoNecesarios = 0;
    const alertas: string[] = [];

    const insumosResultado = Array.from(insumosMap.values()).map(({ insumo, servicios, consumoMaximo }) => {
      const stockActual = stockPorInsumo.get(insumo.id) ?? 0;
      const stockMinimo = stockMinimoPorInsumo.get(insumo.id) ?? Number(insumo.stockMinimoAgencia ?? 2);
      const unidad = insumo.unidadMedida?.simbolo || 'u';
      // Validación contra servicios de la sucursal: si ninguna receta lo usa → No necesario
      // (sigue visible si ya fue enviado / tiene stock en sede)
      const tieneServicios = servicios.length > 0;

      let estado: 'OPTIMO' | 'BAJO' | 'CRITICO' | 'AGOTADO' | 'NO_NECESARIO' = 'OPTIMO';
      let mensajeAlerta: string | null = null;

      if (!tieneServicios) {
        estado = 'NO_NECESARIO';
        insumosNoNecesarios++;
        mensajeAlerta =
          stockActual > 0
            ? `En sede, pero ningún servicio asignado a la sucursal lo requiere actualmente`
            : `Sin servicio asignado que lo requiera en esta sucursal`;
      } else if (stockActual <= 0) {
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

      const serviciosQueLoUsan = tieneServicios
        ? servicios.map(s => ({
            ...s,
            cantidadPorServicio: s.cantidadUsada,
          }))
        : [
            {
              servicioId: 0,
              codigo: 'SEDE',
              nombre: 'No requerido por servicios de la sede',
              categoria: 'GENERAL',
              cantidadUsada: 0,
              cantidadPorServicio: 0,
              unidad,
            },
          ];

      return {
        id: insumo.id,
        codigoSKU: insumo.codigoSKU,
        nombre: insumo.nombre,
        descripcion: insumo.descripcion || '',
        categoria: insumo.categoria,
        tipoProducto: insumo.tipoProducto?.nombre || 'General',
        tipoProductoObj: insumo.tipoProducto || null,
        unidadMedida: unidad,
        contenidoNeto: Number(insumo.contenidoNeto) || 1,
        stockActual,
        stockMinimo,
        stockMinimoAgencia: stockMinimo,
        stockMinimoBodega: Number(insumo.stockMinimoBodega ?? 0),
        stockOptimoBodega: Number(insumo.stockOptimoBodega ?? 0),
        activo: Number(insumo.estado) === 1,
        estado,
        mensajeAlerta,
        consumoMaximo,
        serviciosEstimados,
        capacidadServiciosRestantes: serviciosEstimados,
        serviciosAsociados: servicios,
        serviciosQueLoUsan,
        esInsumoEnSede: !tieneServicios,
        necesario: tieneServicios,
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
        totalInsumosRequeridos: insumosResultado.filter((i) => i.necesario).length,
        totalInsumosEnSede: insumosResultado.length,
        insumosOptimos,
        insumosBajoMinimo,
        insumosAgotados,
        insumosNoNecesarios,
        totalAlertas: alertas.length,
        alertas,
      },
      insumos: insumosResultado,
    };
  }

  /**
   * Insumos requeridos por los servicios asignados a un pulidor (móvil o fijo)
   * con stock real de su kit personal (StockUbicacion.pulidorId).
   */
  async obtenerInsumosServiciosPulidor(pulidorId: string, servicioIdsOverride?: number[]) {
    if (!pulidorId) {
      throw new BadRequestException('Se requiere el ID del pulidor.');
    }

    const pulidor = await this.prisma.user.findUnique({
      where: { id: pulidorId },
      include: {
        region: { select: { id: true, codigo: true, nombre: true } },
        agencia: { select: { id: true, codigo: true, nombre: true } },
        role: { select: { namerol: true } },
      },
    });

    if (!pulidor) {
      throw new NotFoundException(`Pulidor "${pulidorId}" no encontrado.`);
    }

    const rawIds = (servicioIdsOverride && servicioIdsOverride.length > 0)
      ? servicioIdsOverride
      : (Array.isArray(pulidor.servicioIds) ? pulidor.servicioIds as any[] : []);
    const cleanServicioIds = rawIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n) && n > 0);

    const catalogo = cleanServicioIds.length > 0
      ? await this.prisma.catalogoServicio.findMany({
          where: { id: { in: cleanServicioIds } },
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
        })
      : [];

    const tipoUb: 'PULIDOR_FIJO' | 'PULIDOR_MOVIL' = pulidor.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL';
    const recetasInsumos = catalogo.flatMap((c) => c.recetas.map((r) => r.insumo).filter(Boolean));

    let stocksPulidor = await this.prisma.stockUbicacion.findMany({
      where: { pulidorId: pulidor.id },
      include: {
        insumo: {
          include: {
            unidadMedida: true,
            tipoProducto: true,
          },
        },
      },
    });

    const setStocksExistentes = new Set(stocksPulidor.map((s) => s.insumoId));
    let nuevosSlots = false;
    for (const ins of recetasInsumos) {
      if (!setStocksExistentes.has(ins.id)) {
        try {
          await this.prisma.stockUbicacion.create({
            data: {
              pulidorId: pulidor.id,
              insumoId: ins.id,
              tipoUbicacion: tipoUb,
              cantidadActual: 0,
              cantidadMinima: ins.stockMinimoAgencia ?? 1,
            },
          });
          setStocksExistentes.add(ins.id);
          nuevosSlots = true;
        } catch (e) {
          console.warn(`[StockUbicacion] Error al auto-inicializar kit pulidor ${pulidor.id} / ${ins.id}:`, e);
        }
      }
    }

    if (nuevosSlots) {
      stocksPulidor = await this.prisma.stockUbicacion.findMany({
        where: { pulidorId: pulidor.id },
        include: {
          insumo: {
            include: {
              unidadMedida: true,
              tipoProducto: true,
            },
          },
        },
      });
    }

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
          insumosMap.set(ins.id, { insumo: ins, servicios: [], consumoMaximo: cantidadUsada });
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
        if (cantidadUsada > record.consumoMaximo) record.consumoMaximo = cantidadUsada;
      }
    }

    for (const st of stocksPulidor) {
      if (st.insumo && !insumosMap.has(st.insumoId)) {
        insumosMap.set(st.insumoId, {
          insumo: st.insumo,
          servicios: [],
          consumoMaximo: 0,
        });
      }
    }

    const stockPorInsumo = new Map<string, number>();
    const stockMinimoPorInsumo = new Map<string, number>();
    for (const st of stocksPulidor) {
      const prev = stockPorInsumo.get(st.insumoId) ?? 0;
      stockPorInsumo.set(st.insumoId, prev + Number(st.cantidadActual));
      stockMinimoPorInsumo.set(st.insumoId, Number(st.cantidadMinima ?? st.insumo?.stockMinimoAgencia ?? 1));
    }

    let insumosOptimos = 0;
    let insumosBajoMinimo = 0;
    let insumosAgotados = 0;
    let insumosNoNecesarios = 0;
    const alertas: string[] = [];

    const insumosResultado = Array.from(insumosMap.values()).map(({ insumo, servicios, consumoMaximo }) => {
      const stockActual = stockPorInsumo.get(insumo.id) ?? 0;
      const stockMinimo = stockMinimoPorInsumo.get(insumo.id) ?? Number(insumo.stockMinimoAgencia ?? 1);
      const unidad = insumo.unidadMedida?.simbolo || 'u';
      const tieneServicios = servicios.length > 0;

      let estado: 'OPTIMO' | 'BAJO' | 'CRITICO' | 'AGOTADO' | 'NO_NECESARIO' = 'OPTIMO';
      let mensajeAlerta: string | null = null;

      if (!tieneServicios) {
        estado = 'NO_NECESARIO';
        insumosNoNecesarios++;
        mensajeAlerta = stockActual > 0
          ? 'En kit, pero ningún servicio asignado al pulidor lo requiere'
          : 'Sin servicio asignado que lo requiera';
      } else if (stockActual <= 0) {
        estado = 'AGOTADO';
        insumosAgotados++;
        mensajeAlerta = `Agotado: no se pueden realizar ${servicios.map((s) => s.nombre).join(', ')}`;
        alertas.push(`🔴 ${insumo.nombre}: AGOTADO. Afecta ${servicios.length} servicio(s).`);
      } else if (stockActual <= stockMinimo) {
        estado = 'BAJO';
        insumosBajoMinimo++;
        mensajeAlerta = `Stock bajo mínimo (${stockActual.toFixed(2)} de ${stockMinimo} ${unidad}).`;
        alertas.push(`⚠️ ${insumo.nombre}: Stock bajo (${stockActual.toFixed(2)} ${unidad}).`);
      } else {
        insumosOptimos++;
      }

      const serviciosEstimados = consumoMaximo > 0 ? Math.floor(stockActual / consumoMaximo) : 0;
      const serviciosQueLoUsan = tieneServicios
        ? servicios.map((s) => ({ ...s, cantidadPorServicio: s.cantidadUsada }))
        : [{
            servicioId: 0,
            codigo: 'KIT',
            nombre: 'No requerido por servicios asignados',
            categoria: 'ESPECIAL',
            cantidadUsada: 0,
            cantidadPorServicio: 0,
            unidad,
          }];

      return {
        id: insumo.id,
        codigoSKU: insumo.codigoSKU,
        nombre: insumo.nombre,
        descripcion: insumo.descripcion || '',
        categoria: insumo.categoria,
        tipoProducto: insumo.tipoProducto?.nombre || 'General',
        tipoProductoObj: insumo.tipoProducto || null,
        unidadMedida: unidad,
        contenidoNeto: Number(insumo.contenidoNeto) || 1,
        stockActual,
        stockMinimo,
        stockMinimoAgencia: stockMinimo,
        stockMinimoBodega: Number(insumo.stockMinimoBodega ?? 0),
        stockOptimoBodega: Number(insumo.stockOptimoBodega ?? 0),
        activo: Number(insumo.estado) === 1,
        estado,
        mensajeAlerta,
        consumoMaximo,
        serviciosEstimados,
        capacidadServiciosRestantes: serviciosEstimados,
        serviciosAsociados: servicios,
        serviciosQueLoUsan,
        esInsumoEnSede: !tieneServicios,
        necesario: tieneServicios,
      };
    });

    return {
      pulidor: {
        id: pulidor.id,
        nombre: `${pulidor.name} ${pulidor.lastname}`.trim(),
        modalidad: tipoUb === 'PULIDOR_FIJO' ? 'FIJO' : 'MOVIL',
        region: pulidor.region?.nombre,
        agencia: pulidor.agencia?.nombre,
        servicioIds: cleanServicioIds,
        serviciosAsignados: catalogo.map((c) => ({
          id: c.id,
          codigo: c.codigo,
          nombre: c.nombre,
          categoria: c.categoria,
        })),
      },
      agencia: {
        id: pulidor.id,
        codigo: 'PULIDOR',
        nombre: tipoUb === 'PULIDOR_MOVIL'
          ? `Kit móvil · ${pulidor.region?.nombre || 'Sin región'}`
          : `Kit fijo · ${pulidor.agencia?.nombre || 'Sede'}`,
        region: pulidor.region?.nombre,
      },
      resumen: {
        totalInsumosRequeridos: insumosResultado.filter((i) => i.necesario).length,
        totalInsumosEnSede: insumosResultado.length,
        insumosOptimos,
        insumosBajoMinimo,
        insumosAgotados,
        insumosNoNecesarios,
        totalAlertas: alertas.length,
        alertas,
        sinServiciosAsignados: cleanServicioIds.length === 0,
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
