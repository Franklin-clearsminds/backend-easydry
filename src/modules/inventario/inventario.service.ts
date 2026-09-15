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
    const userRole = (user?.roleDetails?.namerol || user?.role || '').toUpperCase();
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

    return insumos;
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
        const uRegId = usuario?.bodega?.regionId || usuario?.regionId;
        const uRegName = (usuario?.bodega as any)?.region?.nombre || (usuario?.region?.nombre || '').toLowerCase();
        filteredRows = bodegasRows.filter(
          (row) =>
            (usuario?.bodegaId && row.id === usuario.bodegaId) ||
            (uRegId && row.regionId === uRegId) ||
            (uRegName && row.regionNombre && String(row.regionNombre).toLowerCase().includes(String(uRegName).toLowerCase()))
        );
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

  async obtenerStockBodegasResumen(dto: { bodegaId?: string } = {}) {
    const bodegas = await this.listBodegas();
    const bodegaSeleccionada = (dto.bodegaId ? bodegas.find((b) => b.id === dto.bodegaId) : null) || bodegas[0];
    const pctAlerta = Number(bodegaSeleccionada?.porcentajeAlerta || 20);

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

      // Umbral configurable en % en relación al stock mínimo ingresado
      const umbralAlerta = Math.round(minimo * (1 + pctAlerta / 100) * 100) / 100;

      let estado: 'Óptimo' | 'Bajo' | 'Crítico' | 'Agotado' = 'Óptimo';
      if (actual <= 0) {
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
      };
    });

    return {
      bodega: bodegaSeleccionada,
      bodegas,
      metricas: {
        totalInsumos: insumosBodega.length,
        stockTotalUnidades,
        insumosBajoMinimo: totalBajoMinimo,
        insumosOptimos: insumosBodega.length - totalBajoMinimo,
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

  async crearDespacho(dto: CrearDespachoDto, usuarioId: string) {
    // Validar destino
    let destinoLabel = '';
    const targetAgenciaId = dto.sucursalDestinoId || dto.agenciaId || dto.agenciaDestinoId || (dto as any).agenciaDestinoId;
    if (dto.tipo === 'DESPACHO_AGENCIA') {
      if (!targetAgenciaId)
        throw new BadRequestException('Debe especificar sucursalDestinoId o agenciaId para DESPACHO_AGENCIA');

      const agencia = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { id: targetAgenciaId },
            { nombre: { equals: targetAgenciaId, mode: 'insensitive' } },
            { codigo: { equals: targetAgenciaId, mode: 'insensitive' } },
          ],
        },
      });
      if (!agencia) throw new NotFoundException(`Agencia "${targetAgenciaId}" no encontrada`);
      destinoLabel = `Agencia ${agencia.nombre} [${agencia.id}]`;

      // Reglas de despacho por rol:
      // - COORD_BODEGA / ADMIN / SUPER_ADMIN: cualquier destino
      // - ASISTENTE_BODEGA: solo agencias de la región de su bodega asignada
      // - LIDER: solo otras agencias de su misma región
      if (usuarioId) {
        const usuario = await this.prisma.user.findUnique({
          where: { id: usuarioId },
          include: {
            role: true,
            region: true,
            agencia: true,
            bodega: { include: { region: true } },
          },
        });
        const rolUsuario = usuario?.role?.namerol?.toUpperCase() || '';
        const isCoordBodega =
          rolUsuario === 'COORD_BODEGA' ||
          rolUsuario === 'DISTRIBUIDOR' ||
          rolUsuario === 'SUPER_ADMIN' ||
          rolUsuario === 'ADMIN';
        const isAsistente =
          rolUsuario === 'ASISTENTE_BODEGA' ||
          (rolUsuario.includes('ASISTENTE') && rolUsuario.includes('BODEGA'));
        const isLider = rolUsuario === 'LIDER' || rolUsuario === 'LIDER_AGENCIA' || rolUsuario === 'LIDER_OPERADOR';

        if (isAsistente) {
          const regionPermitida =
            usuario?.bodega?.regionId ||
            usuario?.regionId ||
            null;
          if (!regionPermitida) {
            throw new ForbiddenException(
              'Como Asistente de Bodega debes estar asignado a una bodega regional para despachar.',
            );
          }
          if (agencia.regionId && agencia.regionId !== regionPermitida) {
            throw new ForbiddenException(
              `Acceso denegado: solo puedes despachar a agencias de la región de tu bodega (${usuario?.bodega?.region?.nombre || usuario?.region?.nombre || 'asignada'}).`,
            );
          }
        } else if (isLider) {
          const regionLider = usuario?.agencia?.regionId || usuario?.regionId;
          if (!regionLider) {
            throw new ForbiddenException('El Líder Operador debe tener agencia/región para despachar.');
          }
          if (agencia.id === usuario?.agenciaId) {
            throw new BadRequestException('No puedes despachar hacia tu misma agencia de origen.');
          }
          if (agencia.regionId && agencia.regionId !== regionLider) {
            throw new ForbiddenException(
              'Como Líder Operador solo puedes despachar a otras agencias de tu misma región.',
            );
          }
        } else if (!isCoordBodega && rolUsuario && !rolUsuario.includes('SUPERVISOR')) {
          // Otros roles no despachan (salvo que ya pasaron validaciones anteriores)
        }
      }
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

      let stockBodega = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });

      // Si no existe el registro en StockUbicacion de BODEGA_CENTRAL, inicializarlo con el stockActual del insumo
      if (!stockBodega) {
        const stockInicial = Math.max(Number(insumo.stockActual) || 0, Number(det.cantidadEnviada) || 0);
        stockBodega = await this.prisma.stockUbicacion.create({
          data: {
            insumoId: det.insumoId,
            tipoUbicacion: 'BODEGA_CENTRAL',
            cantidadActual: stockInicial,
          },
        });
      }

      const disponible = Number(stockBodega?.cantidadActual ?? 0);
      if (disponible < det.cantidadEnviada) {
        const stockGlobal = Number(insumo.stockActual) || 0;
        if (stockGlobal >= det.cantidadEnviada) {
          stockBodega = await this.prisma.stockUbicacion.update({
            where: { id: stockBodega.id },
            data: { cantidadActual: stockGlobal },
          });
        } else {
          throw new BadRequestException(
            `Stock insuficiente en bodega para "${insumo.nombre}": disponible ${disponible}, requerido ${det.cantidadEnviada}`,
          );
        }
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
      let stockBodega = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      if (!stockBodega) {
        stockBodega = await this.prisma.stockUbicacion.create({
          data: {
            insumoId: det.insumoId,
            tipoUbicacion: 'BODEGA_CENTRAL',
            cantidadActual: 0,
          },
        });
      }
      const stockAnt = Number(stockBodega?.cantidadActual ?? 0);
      const stockPost = stockAnt - Number(det.cantidadEnviada);

      await this.prisma.stockUbicacion.update({
        where: { id: stockBodega.id },
        data: { cantidadActual: { decrement: det.cantidadEnviada } },
      });

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

    const observacionesActualizadas = dto.observaciones
      ? (dto.accion === 'RECHAZADO'
          ? `${movimiento.observaciones ? movimiento.observaciones + ' ' : ''}| RECHAZO: ${dto.observaciones}`.trim()
          : `${movimiento.observaciones ? movimiento.observaciones + ' ' : ''}| RECEPCIÓN: ${dto.observaciones}`.trim())
      : movimiento.observaciones;

    await this.prisma.movimientoInventario.update({
      where: { id: movimiento.id },
      data: {
        estadoDespacho: nuevoEstado,
        fechaRecepcion: new Date(),
        usuarioRecibeId: usuarioId || movimiento.usuarioRecibeId,
        observaciones: observacionesActualizadas,
      },
    });

    // Si fue RECIBIDO: incrementar stock en destino y registrar Kardex de entrada
    if (dto.accion === 'RECIBIDO') {
      const detallesActualizados = await this.prisma.movimientoDetalle.findMany({
        where: { movimientoId: movimiento.id },
      });

      // Extraer ID de la agencia destino de forma robusta
      let targetAgenciaId: string | undefined = undefined;

      // 1. Extraer ID del corchete en destinoUbicacion: "Agencia EasyDry Quito Norte [UUID]"
      if (movimiento.destinoUbicacion && movimiento.destinoUbicacion.includes('[')) {
        const match = movimiento.destinoUbicacion.match(/\[(.*?)\]/);
        if (match && match[1]) {
          const candidate = match[1].trim();
          const ag = await this.prisma.agencia.findUnique({ where: { id: candidate } });
          if (ag) targetAgenciaId = ag.id;
        }
      }

      // 2. Si no se resolvió, probar dto.agenciaId o dto.sucursalId validando existencia
      if (!targetAgenciaId && (dto.agenciaId || dto.sucursalId)) {
        const rawAg = (dto.agenciaId || dto.sucursalId)!.trim();
        const ag = await this.prisma.agencia.findFirst({
          where: {
            OR: [
              { id: rawAg },
              { nombre: { equals: rawAg, mode: 'insensitive' } },
              { codigo: { equals: rawAg, mode: 'insensitive' } },
            ],
          },
        });
        if (ag) targetAgenciaId = ag.id;
      }

      // 3. Probar nombre de destinoUbicacion
      if (!targetAgenciaId && movimiento.destinoUbicacion) {
        const cleanName = movimiento.destinoUbicacion
          .replace(/^Agencia\s+/i, '')
          .replace(/\[.*?\]/g, '')
          .trim();
        if (cleanName) {
          const ag = await this.prisma.agencia.findFirst({
            where: {
              OR: [
                { nombre: { contains: cleanName, mode: 'insensitive' } },
                { codigo: { contains: cleanName, mode: 'insensitive' } },
              ],
            },
          });
          if (ag) targetAgenciaId = ag.id;
        }
      }

      // 4. Si aún no, agencia del receptor
      if (!targetAgenciaId && usuarioId) {
        const receptor = await this.prisma.user.findUnique({ where: { id: usuarioId } });
        if (receptor?.agenciaId) targetAgenciaId = receptor.agenciaId;
      }

      for (const det of detallesActualizados) {
        const cantidad = Number(det.cantidadRecibida ?? det.cantidadEnviada);

        if (movimiento.tipo === 'DESPACHO_AGENCIA') {
          if (targetAgenciaId) {
            // Deduplicar registros previos en StockUbicacion si existieren
            const existingStocks = await this.prisma.stockUbicacion.findMany({
              where: { insumoId: det.insumoId, tipoUbicacion: 'AGENCIA', agenciaId: targetAgenciaId },
              orderBy: { updatedAt: 'desc' },
            });

            let stockAgencia = existingStocks[0] || null;
            if (existingStocks.length > 1) {
              let sumaExtra = 0;
              for (let i = 1; i < existingStocks.length; i++) {
                sumaExtra += Number(existingStocks[i].cantidadActual);
                await this.prisma.stockUbicacion.delete({ where: { id: existingStocks[i].id } });
              }
              if (sumaExtra > 0) {
                stockAgencia = await this.prisma.stockUbicacion.update({
                  where: { id: stockAgencia.id },
                  data: { cantidadActual: { increment: sumaExtra } },
                });
              }
            }

            const stockAnt = Number(stockAgencia?.cantidadActual ?? 0);
            const stockPost = stockAnt + cantidad;

            if (stockAgencia) {
              await this.prisma.stockUbicacion.update({
                where: { id: stockAgencia.id },
                data: { cantidadActual: { increment: cantidad } },
              });
            } else {
              const insInfo = await this.prisma.insumo.findUnique({ where: { id: det.insumoId } });
              stockAgencia = await this.prisma.stockUbicacion.create({
                data: {
                  insumoId: det.insumoId,
                  tipoUbicacion: 'AGENCIA',
                  agenciaId: targetAgenciaId,
                  cantidadActual: cantidad,
                  cantidadMinima: insInfo?.stockMinimoAgencia ?? 2,
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
          const userDest = await this.prisma.user.findUnique({ where: { id: usuarioId } });
          const tipoUb: 'PULIDOR_FIJO' | 'PULIDOR_MOVIL' = userDest?.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL';
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
                tipoUbicacion: tipoUb,
                pulidorId: usuarioId,
                agenciaId: userDest?.agenciaId ?? null,
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
      // Si fue RECHAZADO: devolver stock a bodega central, registrar Kardex y emitir alerta
      let emisorId = usuarioId;
      if (!emisorId) {
        const defaultUser = await this.prisma.user.findFirst({ select: { id: true } });
        emisorId = defaultUser?.id || '';
      }

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
            usuarioId: emisorId || null,
          },
        });

        if (emisorId) {
          try {
            await this.prisma.alertaStock.create({
              data: {
                insumoId: det.insumoId,
                nivel: 'CRITICO',
                usuarioEmisorId: emisorId,
                mensaje: `🚨 Despacho ${movimiento.numeroGuia} RECHAZADO por sede: ${dto.observaciones || 'Mercadería no recibida'}`,
              },
            });
          } catch {
            // Ignorar error al registrar alerta
          }
        }
      }
    }

    return { ok: true, numeroGuia: movimiento.numeroGuia, nuevoEstado };
  }

  async rechazarDespacho(
    dto: { movimientoId: string; motivo?: string; observaciones?: string; agenciaId?: string },
    usuarioId: string,
  ) {
    const motivoFinal = dto.motivo || dto.observaciones || 'Despacho rechazado por el receptor en agencia (No recibido / Incompleto)';
    return this.confirmarRecepcion(
      {
        movimientoId: dto.movimientoId,
        accion: 'RECHAZADO',
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
    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true },
      });
      const rol = usuario?.role?.namerol?.toUpperCase() || '';
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

    const where: any = {
      tipo: { in: ['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR'] },
      ...(dto.estadoDespacho ? { estadoDespacho: dto.estadoDespacho as any } : {}),
      ...(dto.numeroGuia ? { numeroGuia: { contains: dto.numeroGuia, mode: 'insensitive' } } : {}),
      ...(agencySearchFilter || {}),
      ...(regionalFilter ? { AND: [regionalFilter] } : {}),
      ...(dto.pulidorId ? { usuarioRecibeId: dto.pulidorId } : {}),
    };

    const movimientos = await this.prisma.movimientoInventario.findMany({
      where,
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
        usuarioRecibe: { select: { id: true, name: true, lastname: true } },
      },
    });

    return movimientos.map((m) => {
      let motivoRechazo = '';
      if (m.observaciones && m.observaciones.includes('RECHAZO:')) {
        const parts = m.observaciones.split(/RECHAZO:\s*/i);
        if (parts.length > 1) {
          motivoRechazo = parts[parts.length - 1].trim();
        }
      }
      return {
        ...m,
        motivoRechazo: motivoRechazo || undefined,
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
        include: { role: true, region: true, bodega: true },
      });
      const userRole = (usuario?.role?.namerol || '').toUpperCase();
      const isAsistente =
        userRole === 'ASISTENTE_BODEGA' ||
        (userRole.includes('ASISTENTE') && userRole.includes('BODEGA'));
      const isGlobalAlertViewer =
        userRole === 'SUPER_ADMIN' ||
        userRole === 'ADMIN' ||
        userRole === 'COORD_BODEGA' ||
        userRole === 'DISTRIBUIDOR' ||
        userRole.includes('SUPERVISOR');

      if (isAsistente) {
        const regionId = usuario?.bodega?.regionId || usuario?.regionId;
        if (regionId) {
          const agenciasRegion = await this.prisma.agencia.findMany({
            where: { regionId },
            select: { id: true },
          });
          const agIds = agenciasRegion.map((a) => a.id);
          if (targetAgencia) {
            where.agenciaId = agIds.includes(targetAgencia) ? targetAgencia : '__ACCESO_DENEGADO__';
          } else {
            where.agenciaId = { in: agIds };
          }
        } else {
          where.agenciaId = '__SIN_REGION_ASISTENTE__';
        }
      } else if (isGlobalAlertViewer) {
        if (targetAgencia) where.agenciaId = targetAgencia;
      } else if (targetAgencia) {
        where.agenciaId = targetAgencia;
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
    const alertas: string[] = [];

    const insumosResultado = Array.from(insumosMap.values()).map(({ insumo, servicios, consumoMaximo }) => {
      const stockActual = stockPorInsumo.get(insumo.id) ?? 0;
      const stockMinimo = stockMinimoPorInsumo.get(insumo.id) ?? Number(insumo.stockMinimoAgencia ?? 2);
      const unidad = insumo.unidadMedida?.simbolo || 'u';
      const tieneServicios = servicios.length > 0;

      let estado: 'OPTIMO' | 'BAJO' | 'CRITICO' | 'AGOTADO' = 'OPTIMO';
      let mensajeAlerta: string | null = null;

      if (stockActual <= 0) {
        estado = 'AGOTADO';
        insumosAgotados++;
        if (tieneServicios) {
          mensajeAlerta = `Agotado: No se pueden realizar ${servicios.map(s => s.nombre).join(', ')}`;
          alertas.push(`🔴 ${insumo.nombre}: AGOTADO (${stockActual} ${unidad}). Afecta ${servicios.length} servicios.`);
        } else {
          mensajeAlerta = `Sin existencias en sede (Servicio no asignado actualmente)`;
        }
      } else if (stockActual <= stockMinimo) {
        estado = 'BAJO';
        insumosBajoMinimo++;
        if (tieneServicios) {
          mensajeAlerta = `Stock bajo mínimo (${stockActual.toFixed(2)} de ${stockMinimo} ${unidad}). Reabastecer pronto.`;
          alertas.push(`⚠️ ${insumo.nombre}: Stock bajo (${stockActual.toFixed(2)} ${unidad} restantes).`);
        } else {
          mensajeAlerta = `Insumo en sede bajo nivel mínimo (${stockActual.toFixed(2)} ${unidad})`;
        }
      } else {
        insumosOptimos++;
        if (!tieneServicios) {
          mensajeAlerta = `Insumo disponible en sede (Servicio no asignado actualmente)`;
        }
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
              nombre: 'Insumo en Sede (Sin servicio activo)',
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
        categoria: insumo.categoria,
        tipoProducto: insumo.tipoProducto?.nombre || 'General',
        unidadMedida: unidad,
        stockActual,
        stockMinimo,
        estado,
        mensajeAlerta,
        consumoMaximo,
        serviciosEstimados,
        capacidadServiciosRestantes: serviciosEstimados,
        serviciosAsociados: servicios,
        serviciosQueLoUsan,
        esInsumoEnSede: !tieneServicios,
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
