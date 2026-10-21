import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CacheService } from '../../common/cache/cache.service.js';
import { CreateEnvaseDto, UpdateEnvaseDto, ListEnvasesDto } from './dto/envases.dto.js';
import { ListUnidadesDto, CreateUnidadDto, UpdateUnidadDto } from './dto/unidades.dto.js';
import { CreateInsumoDto, UpdateInsumoDto, ListInsumosDto, InsumosOpcionesDto } from './dto/insumos.dto.js';
import { ListStockDto, AjusteStockDto, ReajusteStockDto } from './dto/stock.dto.js';
import { RegistrarCompraDto, CrearDespachoDto, ConfirmarRecepcionDto, ListMovimientosDto, ListDespachosDto } from './dto/movimientos.dto.js';
import { CrearAlertaDto, ListAlertasDto, AtenderAlertaDto } from './dto/alertas.dto.js';
import { ListKardexDto } from './dto/kardex.dto.js';
import { StockResumenAgenciasDto, StockResumenPulidoresDto, StockResumenBodegasDto, InsumosServiciosDto } from './dto/stock-resumen.dto.js';
import { GRAVEDAD_NIVEL, cumpleNivel, nivelStock } from './stock-nivel.js';
import { CreateTipoProductoDto, UpdateTipoProductoDto, ListTiposProductoDto } from './dto/tipo-producto.dto.js';
import { CreatePresentacionDto, UpdatePresentacionDto, ListPresentacionesDto } from './dto/presentaciones.dto.js';
import { ListTiposMovimientoDto, ListMotivosDto, CreateMotivoDto, UpdateMotivoDto } from './dto/movimiento-catalogo.dto.js';
import { RegistrarMovimientoOperativoDto, ListMovimientosGlobalesDto, ListStockBajoDto } from './dto/movimiento-operacion.dto.js';
import { CreateBodegaDto, UpdateBodegaDto, ToggleActivaBodegaDto, DeleteBodegaDto } from './dto/bodegas.dto.js';
import { buildDataGridResponse, PaginacionOpcionalDto } from '../../common/dto/data-grid.dto.js';
import { listarPaginable, type ConfigListadoPaginable } from '../../common/utils/listado-paginable.js';
import { listarOpciones } from '../../common/utils/opciones.js';
import {
  PAGE_SIZE_MAX,
  columnasSimples,
  coincidePalabras,
  combinarWhere,
  esConsultaPaginada,
  normalizarTexto,
  ordenarFilas,
  paginarLista,
  type ColumnasFila,
  paginacionListado,
  patronContiene,
  rangoFechas,
  type OrdenColumnas,
  resolverCampoOrden,
  resolverOrden,
  resolverOrdenSql,
  resolverPaginacion,
  textoBusqueda,
  whereBusqueda,
} from '../../common/utils/data-grid.helpers.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ServiciosFederados } from '../archivado/servicios-federados.js';
import { KardexArchivo } from './kardex-archivo.js';
import { MovimientosGlobalesArchivo } from './movimientos-globales-archivo.js';
import { DespachosArchivo } from './despachos-archivo.js';

/** Orden permitido de los catálogos de configuración (paginados): nombre público → columna. `fecha` = creación. */
const ORDEN_TIPOS_PRODUCTO = columnasSimples({ codigo: 'codigo', nombre: 'nombre', estado: 'estado', fecha: 'createdAt' });
const ORDEN_UNIDADES = columnasSimples({
  codigo: 'codigo',
  nombre: 'nombre',
  simbolo: 'simbolo',
  tipo: 'tipo',
  factorBase: 'factorBase',
  estado: 'estado',
  fecha: 'createdAt',
});
const ORDEN_PRESENTACIONES = columnasSimples({
  nombre: 'nombre',
  cantidad: 'cantidad',
  factor: 'factorAUnidadBase',
  estado: 'estado',
  insumo: 'insumo.nombre',
  fecha: 'createdAt',
});

/** Orden permitido del catálogo de insumos paginado (el orden por `stock` y `alerta` se resuelve aparte). `fecha` = creación. */
const ORDEN_INSUMOS = columnasSimples({
  sku: 'codigoSKU',
  nombre: 'nombre',
  tipo: 'tipoProducto.nombre',
  contenido: 'contenidoNeto',
  stockMinimoBodega: 'stockMinimoBodega',
  stockOptimoBodega: 'stockOptimoBodega',
  stockMinimoAgencia: 'stockMinimoAgencia',
  stockOptimoAgencia: 'stockOptimoAgencia',
  estado: 'estado',
  fecha: 'createdAt',
});

/** Orden permitido de la bandeja de alertas (`fecha` = creación). */
const ORDEN_ALERTAS = columnasSimples({
  fecha: 'createdAt',
  nivel: 'nivel',
  estado: 'estado',
  insumo: 'insumo.nombre',
  agencia: 'agencia.nombre',
});

/** Orden permitido de `stock-bajo/list`: nombre público → expresión SQL fija (nunca texto del cliente). */
const ORDEN_STOCK_BAJO_SQL: Record<string, string> = {
  sku: 'i."codigoSKU"',
  nombre: 'i."nombre"',
  tipo: 'tp."nombre"',
  stock: 'i."stockActual"',
  minimo: 'i."stockMinimoBodega"',
  deficit: '(i."stockMinimoBodega" - i."stockActual")',
  fecha: 'i."createdAt"',
};

/** Peso de cada estado de salud de un insumo para ordenar por gravedad (0 = más grave). */
const GRAVEDAD_ESTADO_INSUMO: Record<string, number> = {
  'agotado': 0,
  'sin stock': 0,
  'critico': 1,
  'bajo': 2,
  'optimo': 3,
  'no necesario': 4,
};

/** Orden permitido de los insumos de una bodega, agencia o kit (ya calculados). */
const COLUMNAS_INSUMO_RESUMEN: ColumnasFila<any> = {
  sku: (i) => i.codigoSKU,
  nombre: (i) => i.nombre,
  tipo: (i) => i.tipoProducto,
  contenido: (i) => i.contenidoNeto,
  stock: (i) => i.stockActual,
  minimo: (i) => i.stockMinimo,
  optimo: (i) => i.stockOptimo,
  deficit: (i) => i.deficit,
  transito: (i) => i.enTransitoUnidades ?? 0,
  estado: (i) => GRAVEDAD_ESTADO_INSUMO[normalizarTexto(i.estado)] ?? 9,
};

/** Orden permitido de los insumos requeridos por servicios (agencia o kit de pulidor). */
const GRAVEDAD_ESTADO_SERVICIO: Record<string, number> = { agotado: 0, critico: 1, bajo: 1, optimo: 3, no_necesario: 4 };
const COLUMNAS_INSUMO_SERVICIO: ColumnasFila<any> = {
  sku: (i) => i.codigoSKU,
  nombre: (i) => i.nombre,
  tipo: (i) => i.tipoProducto,
  stock: (i) => i.stockActual,
  minimo: (i) => i.stockMinimo,
  estado: (i) => GRAVEDAD_ESTADO_SERVICIO[normalizarTexto(i.estado)] ?? 9,
  capacidad: (i) => i.serviciosEstimados,
  servicios: (i) => (i.serviciosAsociados ?? []).length,
};

/** Orden permitido de las fichas de agencia y de pulidor. */
const COLUMNAS_FICHA_AGENCIA: ColumnasFila<any> = {
  nombre: (a) => a.agencia.nombre,
  codigo: (a) => a.agencia.codigo,
  region: (a) => a.agencia.region,
  criticos: (a) => a.insumosCriticos,
  insumos: (a) => a.totalInsumos,
  alerta: (a) => a.tieneAlerta,
};
const COLUMNAS_FICHA_PULIDOR: ColumnasFila<any> = {
  nombre: (p) => p.nombre,
  tipo: (p) => p.tipoPulidor,
  region: (p) => p.regionNombre,
  sede: (p) => p.agenciaNombre,
  criticos: (p) => p.insumosCriticos,
  insumos: (p) => p.totalInsumos,
  alerta: (p) => p.tieneAlerta,
};

/** Tipos de movimiento que son despachos (envíos). Se comparan como texto para no depender del enum generado. */
const TIPOS_DESPACHO = ['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'DESPACHO_BODEGA'];

/** Columnas por las que se puede ordenar `despachos/list`: nombre público → expresión SQL fija (nunca texto del cliente). */
const ORDEN_DESPACHOS_SQL: Record<string, string> = {
  fecha: 'm."fechaDespacho"',
  guia: 'm."numeroGuia"',
  estado: 'm."estadoDespacho"::text',
  origen: 'm."origenUbicacion"',
  destino: 'm."destinoUbicacion"',
  recepcion: 'm."fechaRecepcion"',
};

/** Quién consulta los despachos y a qué alcance tiene derecho, ya resuelto (ver `contextoDespachos`). */
interface ContextoDespachos {
  viewer: any;
  rol: string;
  esSuperAdmin: boolean;
  esAdmin: boolean;
  /** Agencia destino a la que se limita el listado (ids y patrones `ILIKE` ya escapados). */
  agencia: { ids: string[]; patrones: string[]; terminos: string[] } | null;
  pulidorId: string | null;
  /** Asistente de bodega: sus envíos, los de su bodega y los de su región. */
  regional: { usuarioId: string; bodegaId: string | null; patrones: string[]; terminos: string[] } | null;
  estado: string | null;
  guia: string | null;
  desde: Date | null;
  hasta: Date | null;
  palabras: string[];
}

/** Columnas por las que se puede ordenar el historial de movimientos (Kardex de la web). */
const ORDEN_MOVIMIENTOS_GLOBALES = columnasSimples({
  fecha: 'fechaMovimiento',
  fechaMovimiento: 'fechaMovimiento',
  createdAt: 'createdAt',
  comprobante: 'numeroComprobante',
  producto: 'insumo.nombre',
  sku: 'insumo.codigoSKU',
  tipo: 'tipoMovimiento.nombre',
  ruta: 'origenUbicacion',
  origen: 'origenUbicacion',
  destino: 'destinoUbicacion',
  cantidad: 'cantidad',
  cantidadBase: 'cantidadBase',
  stockAnterior: 'stockAnterior',
  stockNuevo: 'stockNuevo',
  responsable: 'responsable.name',
});

/** Columnas por las que se puede ordenar el Kardex contable (`kardex/list`). */
const ORDEN_KARDEX = columnasSimples({
  fecha: 'fecha',
  createdAt: 'fecha',
  insumo: 'insumo.nombre',
  sku: 'insumo.codigoSKU',
  ubicacion: 'ubicacionId',
  tipo: 'tipoMovimiento',
  tipoMovimiento: 'tipoMovimiento',
  cantidad: 'cantidad',
  stockAnterior: 'stockAnterior',
  stockPosterior: 'stockPosterior',
  costoUnitario: 'costoUnitario',
  costoTotal: 'costoTotal',
  usuario: 'usuario.name',
});

/** Fecha ISO válida o `null`. Un "YYYY-MM-DD" como límite superior incluye todo ese día. */
function fechaFiltro(valor: unknown, finDeDia = false): Date | null {
  if (!valor) return null;
  const texto = String(valor).trim();
  const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(texto);
  const d = new Date(soloDia && finDeDia ? `${texto}T23:59:59.999Z` : texto);
  return Number.isNaN(d.getTime()) ? null : d;
}
import { randomUUID } from 'crypto';

import { resolverAlcance } from '../../common/permisos/alcance.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { esLiderDeAgencia, normalizarRol, ROLES_LIDER_AGENCIA, rolDeUsuario } from '../../common/permisos/alias-roles.js';
@Injectable()
export class InventarioService {
  private readonly logger = new Logger(InventarioService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private notifications?: NotificationsService,
    /** Suma al listado de Kardex lo que ya se archivó a Parquet. Sin él, el listado lee solo de la base. */
    @Optional() private historico?: HistoricoService,
    /** Guarda unos segundos el resumen del dashboard (se recarga seguido). Sin él, cada visita lo recalcula. */
    @Optional() private cache?: CacheService,
  ) {}

  /** Destinatarios del aviso de "despacho en camino", según el tipo ya resuelto en `crearDespacho`. */
  private async resolverDestinatariosDespacho(params: {
    tipo: string;
    destinoPulidorId: string | null;
    destinoAgenciaId: string | null;
    destinoBodegaId: string | null;
  }): Promise<string[]> {
    if (params.tipo === 'DESPACHO_PULIDOR') {
      return params.destinoPulidorId ? [params.destinoPulidorId] : [];
    }
    if (params.tipo === 'DESPACHO_AGENCIA' && params.destinoAgenciaId) {
      const lideres = await this.prisma.user.findMany({
        where: { agenciaId: params.destinoAgenciaId, estado: 1, role: { namerol: { in: [...ROLES_LIDER_AGENCIA] } } },
        select: { id: true },
      });
      return lideres.map((u) => u.id);
    }
    if (params.tipo === 'DESPACHO_BODEGA' && params.destinoBodegaId) {
      const asistentes = await this.prisma.user.findMany({
        where: { bodegaId: params.destinoBodegaId, estado: 1, role: { namerol: 'ASISTENTE_BODEGA' } },
        select: { id: true },
      });
      return asistentes.map((u) => u.id);
    }
    return [];
  }

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

  /** Ver `listarPaginable` (common): modo heredado (arreglo, hasta 100) o página estándar. */
  private listarPaginable<T>(dto: PaginacionOpcionalDto, cfg: ConfigListadoPaginable<T>): Promise<any> {
    return listarPaginable(dto, cfg);
  }

  async listTiposProducto(dto: ListTiposProductoDto) {
    const where = combinarWhere(
      dto.estado !== undefined ? { estado: dto.estado } : undefined,
      whereBusqueda(['nombre', 'codigo', 'descripcion'], dto.search),
    );
    return this.listarPaginable(dto, {
      where,
      columnas: { ...ORDEN_TIPOS_PRODUCTO, insumos: (dir) => ({ insumos: { _count: dir } }) },
      ordenHeredado: [{ nombre: 'asc' }],
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.tipoProducto.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: { _count: { select: { insumos: true } } },
        }),
      contar: (w) => this.prisma.tipoProducto.count({ where: w }),
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
    const where = combinarWhere(
      dto.tipo ? { tipo: dto.tipo } : undefined,
      dto.estado !== undefined ? { estado: dto.estado } : undefined,
      whereBusqueda(['nombre', 'codigo', 'simbolo'], dto.search),
    );
    return this.listarPaginable(dto, {
      where,
      columnas: ORDEN_UNIDADES,
      ordenHeredado: [{ codigo: 'asc' }],
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.unidadMedida.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: { _count: { select: { insumos: true, presentaciones: true } } },
        }),
      contar: (w) => this.prisma.unidadMedida.count({ where: w }),
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

  /**
   * Catálogo de insumos con su stock en el contexto del usuario (una agencia, o una bodega).
   * Sin `page` ni `pageSize` responde un arreglo (hasta 100, con stocks, recetas y presentaciones, como siempre);
   * con alguno responde una página liviana con orden, búsqueda y filtros (tipo, estado, nivel de stock) en el servidor.
   */
  async listInsumos(dto: ListInsumosDto, user?: any) {
    const alcance = await this.alcanceInsumos(dto, user);
    if (esConsultaPaginada(dto)) return this.listInsumosPaginado(dto, alcance);
    return this.listInsumosHeredado(dto, alcance);
  }

  /**
   * Qué insumos y qué stock le corresponde ver a quien consulta:
   *  - roles de sede (líder, aprobador, lavador) o `agenciaId`: solo los insumos de esa agencia (con stock allí o en sus servicios);
   *  - `soloDeServicios`: solo los que tienen receta;
   *  - el resto: el stock físico de UNA bodega (la del asistente, la pedida o la Central).
   */
  private async alcanceInsumos(dto: ListInsumosDto, user?: any) {
    const ROLES_SCOPED = [...ROLES_LIDER_AGENCIA, 'APROBADOR', 'LAVADOR'];
    const userRole = normalizarRol(
      user?.roleDetails?.namerol ||
      user?.role?.namerol ||
      (typeof user?.role === 'string' ? user.role : '') ||
      '',
    );
    // Sede propia: por ámbito (agencia); los nombres de la lista siguen valiendo para los roles de sede ya conocidos.
    const isScopedRole =
      ROLES_SCOPED.some((r) => userRole === r || userRole.includes(r)) ||
      (!!user && resolverAlcance(user).tipo === 'AGENCIA' && !userRole.includes('PULIDOR'));
    // Igual que el asistente de bodega con su `bodegaId`: un rol de sede nunca amplía su alcance con
    // un `agenciaId` que mande el cliente — siempre es la suya, tomada del token.
    const targetAgenciaId = isScopedRole ? (user?.agenciaId || user?.agencia?.id) : dto?.agenciaId;

    let agenciaTarget: any = null;
    let scopeWhere: Record<string, unknown> = {};
    if (targetAgenciaId) {
      agenciaTarget = await this.prisma.agencia.findFirst({
        where: {
          OR: [{ id: targetAgenciaId }, { nombre: { equals: targetAgenciaId, mode: 'insensitive' } }],
        },
        select: { id: true, servicioIds: true, tieneServiciosEspeciales: true },
      });

      if (agenciaTarget) {
        const rawIds = Array.isArray(agenciaTarget.servicioIds) ? agenciaTarget.servicioIds : [];
        const sIds = rawIds.map((n: any) => Number(n)).filter((n: number) => !isNaN(n) && n > 0);
        const orSedeConditions: any[] = [{ stocks: { some: { agenciaId: agenciaTarget.id, tipoUbicacion: 'AGENCIA' } } }];
        if (sIds.length > 0) orSedeConditions.push({ recetas: { some: { catalogoServicioId: { in: sIds } } } });
        scopeWhere = { OR: orSedeConditions };
      } else {
        scopeWhere = { id: { in: [] } }; // Si la agencia no existe, no devolver registros erróneos
      }
    } else if (dto.soloDeServicios === true) {
      scopeWhere = { recetas: { some: {} } };
    }

    // Stock de productos = físico de UNA bodega (nunca el campo catálogo Insumo.stockActual)
    let bodegaStockId = '';
    if (!agenciaTarget) {
      // Quien tiene una bodega asignada y no actúa en todo el país: SIEMPRE su bodega, no la que pida el cliente.
      const isAsistenteBodega =
        userRole === 'ASISTENTE_BODEGA' ||
        (userRole.includes('ASISTENTE') && userRole.includes('BODEGA')) ||
        (!!user?.bodegaId && !!user && resolverAlcance(user).tipo !== 'GLOBAL');
      if (isAsistenteBodega && user?.id) {
        // Asistente: SIEMPRE su bodega asignada (ignora dto.bodegaId del cliente)
        const u = await this.prisma.user.findUnique({ where: { id: user.id }, select: { bodegaId: true } });
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
    }
    return { scopeWhere, agenciaTarget, bodegaStockId };
  }

  /** Stock (y mínimo de la sede) de cada insumo en el contexto: por agencia o por bodega. */
  private async stockPorInsumo(alcance: { agenciaTarget: any; bodegaStockId: string }): Promise<Map<string, { stock: number; minimo?: number }>> {
    const mapa = new Map<string, { stock: number; minimo?: number }>();
    if (alcance.agenciaTarget) {
      const filas = await this.prisma.stockUbicacion.findMany({
        where: { agenciaId: alcance.agenciaTarget.id, tipoUbicacion: 'AGENCIA' },
        select: { insumoId: true, cantidadActual: true, cantidadMinima: true },
      });
      for (const s of filas) mapa.set(s.insumoId, { stock: Number(s.cantidadActual), minimo: Number(s.cantidadMinima) });
    } else if (alcance.bodegaStockId) {
      const filas: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "insumoId", COALESCE(SUM("cantidadActual"), 0)::float AS "cantidadActual"
         FROM "StockUbicacion"
         WHERE "bodegaId" = $1
         GROUP BY "insumoId"`,
        alcance.bodegaStockId,
      );
      for (const s of filas) mapa.set(String(s.insumoId), { stock: Number(s.cantidadActual || 0) });
    }
    return mapa;
  }

  /** Modo heredado: todo lo de siempre (con stocks, recetas y presentaciones), ahora con tope de 100. */
  private async listInsumosHeredado(dto: ListInsumosDto, alcance: Awaited<ReturnType<InventarioService['alcanceInsumos']>>) {
    const base: Record<string, unknown> = {};
    if (dto.categoria) base.categoria = dto.categoria;
    if (dto.tipoProductoId) base.tipoProductoId = dto.tipoProductoId;
    if (dto.estado !== undefined) base.estado = dto.estado;
    if (dto.search) {
      base.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigoSKU: { contains: dto.search, mode: 'insensitive' } },
        { descripcion: { contains: dto.search, mode: 'insensitive' } },
      ];
    }
    const { agenciaTarget, bodegaStockId } = alcance;
    const where = combinarWhere(base, alcance.scopeWhere);

    const insumos = await this.prisma.insumo.findMany({
      where: where as any,
      orderBy: { codigoSKU: 'asc' },
      take: PAGE_SIZE_MAX,
      include: {
        tipoProducto: { select: { id: true, codigo: true, nombre: true } },
        unidadMedida: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
        presentaciones: {
          where: { estado: 1 },
          include: { unidad: { select: { id: true, codigo: true, simbolo: true, nombre: true } } },
        },
        recetas: {
          include: {
            catalogoServicio: { select: { id: true, codigo: true, nombre: true, categoria: true } },
            unidadConsumo: { select: { id: true, simbolo: true, nombre: true } },
          },
        },
        stocks: agenciaTarget
          ? {
              where: { agenciaId: agenciaTarget.id, tipoUbicacion: 'AGENCIA' },
              include: { agencia: { select: { id: true, nombre: true } } },
            }
          : { include: { agencia: { select: { id: true, nombre: true } } } },
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
    if (!bodegaStockId) {
      return insumos.map((ins: any) => ({ ...ins, stockActual: 0, bodegaIdStock: null }));
    }
    const stockMap = await this.stockPorInsumo(alcance);
    return insumos.map((ins: any) => ({
      ...ins,
      stockActual: stockMap.get(ins.id)?.stock ?? 0,
      bodegaIdStock: bodegaStockId,
    }));
  }

  /**
   * Modo paginado. Sin filtro ni orden por stock, la base de datos ordena y pagina. Con nivel de stock u orden por
   * stock/alerta se toman solo las columnas necesarias de los insumos del alcance (id, mínimos, óptimos), se filtra y
   * ordena con el stock del contexto y se piden los datos completos solo de la página.
   */
  private async listInsumosPaginado(dto: ListInsumosDto, alcance: Awaited<ReturnType<InventarioService['alcanceInsumos']>>) {
    const { page, pageSize, skip, take } = resolverPaginacion(dto);
    const { agenciaTarget, bodegaStockId } = alcance;

    const where = combinarWhere(
      dto.categoria ? { categoria: dto.categoria } : undefined,
      dto.tipoProductoId ? { tipoProductoId: dto.tipoProductoId } : undefined,
      dto.estado !== undefined ? { estado: dto.estado } : undefined,
      whereBusqueda(['nombre', 'codigoSKU', 'descripcion'], dto.search),
      alcance.scopeWhere,
    ) as any;

    const pedidoPorStock = dto.sortField === 'stock' || dto.sortField === 'alerta';
    const necesitaStock = !!dto.nivelStock || pedidoPorStock;
    const stockMap = agenciaTarget || bodegaStockId ? await this.stockPorInsumo(alcance) : new Map();

    // Datos livianos de la lista: sin stocks por ubicación, recetas ni presentaciones.
    const incluir = {
      tipoProducto: { select: { id: true, codigo: true, nombre: true } },
      unidadMedida: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
    };

    let filas: any[];
    let total: number;
    if (!necesitaStock) {
      const orderBy = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_INSUMOS, { campo: 'fecha', dir: 'desc' });
      [filas, total] = await Promise.all([
        this.prisma.insumo.findMany({ where, orderBy: orderBy as any, skip, take, include: incluir }),
        this.prisma.insumo.count({ where }),
      ]);
    } else {
      const candidatos = await this.prisma.insumo.findMany({
        where,
        select: { id: true, codigoSKU: true, createdAt: true, stockMinimoBodega: true, stockOptimoBodega: true },
      });
      const enriquecidos = candidatos.map((c) => {
        const stock = stockMap.get(c.id)?.stock ?? 0;
        return { id: c.id, sku: c.codigoSKU, fecha: c.createdAt.getTime(), stock, nivel: nivelStock(stock, c.stockMinimoBodega, c.stockOptimoBodega) };
      });
      const filtrados = dto.nivelStock ? enriquecidos.filter((e) => cumpleNivel(e.nivel, dto.nivelStock!)) : enriquecidos;

      const factor = dto.sortField && String(dto.sortOrder).toLowerCase() === 'asc' ? 1 : -1;
      const porStock = dto.sortField === 'stock';
      const porAlerta = dto.sortField === 'alerta';
      filtrados.sort((a, b) => {
        let cmp = 0;
        if (porStock) cmp = a.stock - b.stock;
        else if (porAlerta) cmp = GRAVEDAD_NIVEL[a.nivel] - GRAVEDAD_NIVEL[b.nivel] || a.stock - b.stock;
        else cmp = a.fecha - b.fecha; // sin orden de stock: lo más reciente primero (como el resto de listados)
        return cmp * factor || a.id.localeCompare(b.id) * factor;
      });
      total = filtrados.length;
      const ids = filtrados.slice(skip, skip + take).map((e) => e.id);
      const completos = ids.length
        ? await this.prisma.insumo.findMany({ where: { id: { in: ids } }, include: incluir })
        : [];
      const porId = new Map(completos.map((i) => [i.id, i]));
      filas = ids.map((id) => porId.get(id)).filter((i): i is NonNullable<typeof i> => !!i);
    }

    const items = filas.map((ins: any) => {
      const s = stockMap.get(ins.id);
      return agenciaTarget
        ? { ...ins, stockActual: s?.stock ?? 0, stockMinimoAgencia: s?.minimo ?? Number(ins.stockMinimoAgencia ?? 2) }
        : { ...ins, stockActual: s?.stock ?? 0, bodegaIdStock: bodegaStockId || null };
    });
    return buildDataGridResponse(items, total, page, pageSize);
  }

  /** Insumos para un desplegable con buscador: { value, label (nombre), sublabel (SKU · tipo) } paginado. Solo activos por defecto. */
  async listInsumosOpciones(dto: InsumosOpcionesDto, user?: any) {
    const alcance = await this.alcanceInsumos(dto as any, user);
    return listarOpciones(dto, {
      where: combinarWhere(
        alcance.scopeWhere,
        dto.tipoProductoId ? { tipoProductoId: dto.tipoProductoId } : undefined,
        dto.categoria ? { categoria: dto.categoria } : undefined,
        { estado: dto.estado ?? 1 },
      ),
      camposBusqueda: ['nombre', 'codigoSKU', 'descripcion'],
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.insumo.findMany({
          where,
          orderBy,
          skip,
          take,
          select: { id: true, codigoSKU: true, nombre: true, tipoProducto: { select: { nombre: true } } },
        }),
      contar: (where) => this.prisma.insumo.count({ where }),
      mapear: (i) => ({ value: i.id, label: i.nombre, sublabel: [i.codigoSKU, i.tipoProducto?.nombre].filter(Boolean).join(' · ') || undefined }),
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

    if (dto.stockOptimoBodega < dto.stockMinimoBodega) {
      throw new BadRequestException('El stock óptimo de bodega debe ser mayor o igual al stock mínimo de bodega');
    }
    if (dto.stockOptimoAgencia !== undefined && dto.stockOptimoAgencia < dto.stockMinimoAgencia) {
      throw new BadRequestException('El stock óptimo de agencia debe ser mayor o igual al stock mínimo de agencia');
    }

    return (this.prisma.insumo as any).create({
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
        stockOptimoAgencia: dto.stockOptimoAgencia ?? 5.0,
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
    const insumo: any = await this.prisma.insumo.findUnique({ where: { id: dto.id } });
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

    const minAge = dto.stockMinimoAgencia !== undefined ? Number(dto.stockMinimoAgencia) : Number(insumo.stockMinimoAgencia);
    const optAge = dto.stockOptimoAgencia !== undefined ? Number(dto.stockOptimoAgencia) : Number(insumo.stockOptimoAgencia ?? 0);
    if (dto.stockMinimoAgencia !== undefined || dto.stockOptimoAgencia !== undefined) {
      if (optAge > 0 && optAge < minAge) {
        throw new BadRequestException('El stock óptimo de agencia debe ser mayor o igual al stock mínimo de agencia');
      }
    }

    const { id, ...data } = dto;
    return (this.prisma.insumo as any).update({
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

    let usuario: any = null;
    if (usuarioId) {
      usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true, bodega: { include: { region: true } } },
      });
    }
    const agenciaDelUsuario = usuario?.agenciaId || agenciaIdUsuario;
    // Qué stock ve cada quien lo decide el ámbito de su rol (país, región, agencia o propio), no el nombre del rol.
    // Un pulidor móvil (sin agencia) solo ve su kit.
    const esPulidorMovil = rolDeUsuario(usuario) === 'PULIDOR' && !agenciaDelUsuario;
    const alcance = resolverAlcance(usuario);

    if (esPulidorMovil || alcance.tipo === 'PROPIO') {
      where.pulidorId = usuarioId;
    } else if (alcance.tipo === 'GLOBAL') {
      if (dto.sucursalId) where.agenciaId = dto.sucursalId;
    } else if (alcance.tipo === 'REGION') {
      const regionId = alcance.regionId;
      const regionNombre = usuario?.bodega?.region?.nombre || usuario?.region?.nombre;
      const agenciasRegion = await this.prisma.agencia.findMany({
        where: {
          OR: [
            { regionId },
            ...(regionNombre ? [{ region: { contains: regionNombre, mode: 'insensitive' as const } }] : []),
          ],
        },
        select: { id: true },
      });
      const agenciasRegionIds = agenciasRegion.map((a) => a.id);
      if (dto.sucursalId) {
        where.agenciaId = agenciasRegionIds.length > 0 && !agenciasRegionIds.includes(dto.sucursalId)
          ? '__ACCESO_DENEGADO_OTRA_REGION__'
          : dto.sucursalId;
      } else {
        where.agenciaId = { in: agenciasRegionIds };
      }
    } else if (alcance.tipo === 'AGENCIA') {
      if (rolDeUsuario(usuario) === 'PULIDOR') {
        where.OR = [{ agenciaId: alcance.agenciaId }, { pulidorId: usuarioId }];
      } else {
        where.agenciaId = alcance.agenciaId;
      }
    } else {
      where.id = '__SIN_ACCESO__'; // sin ámbito, región ni agencia: no ve stock
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

  /**
   * Agencia sobre la que puede actuar el usuario. Un usuario de agencia queda siempre en la suya (aunque el cliente mande otra);
   * quien actúa por región solo puede elegir agencias de su región; quien actúa en todo el país, cualquiera.
   */
  async agenciaEnAlcance(user: any, agenciaId?: string): Promise<string | undefined> {
    const a = resolverAlcance(user);
    switch (a.tipo) {
      case 'GLOBAL':
        return agenciaId || undefined;
      case 'AGENCIA':
        if (agenciaId && agenciaId !== a.agenciaId) throw new ForbiddenException('Esa agencia no pertenece a tu alcance.');
        return a.agenciaId;
      case 'REGION': {
        if (!agenciaId) return undefined;
        const agencia = await this.prisma.agencia.findUnique({ where: { id: agenciaId }, select: { regionId: true } });
        if (!agencia || agencia.regionId !== a.regionId) throw new ForbiddenException('Esa agencia no pertenece a tu región.');
        return agenciaId;
      }
      default:
        throw new ForbiddenException('Tu usuario no tiene una agencia ni una región asignada.');
    }
  }

  /** Pulidor cuyo kit puede consultar el usuario: el suyo, o el de un pulidor de su alcance. */
  async pulidorEnAlcance(user: any, pulidorId?: string): Promise<string | undefined> {
    const mio = String(user?.id);
    if (!pulidorId || pulidorId === mio) return rolDeUsuario(user) === 'PULIDOR' ? mio : pulidorId || undefined;
    if (rolDeUsuario(user) === 'PULIDOR') throw new ForbiddenException('Solo puedes ver el kit de insumos propio.');
    const p = await this.prisma.user.findUnique({
      where: { id: pulidorId },
      select: { agenciaId: true, regionId: true, agencia: { select: { regionId: true } } },
    });
    const a = resolverAlcance(user);
    const permitido =
      !!p &&
      (a.tipo === 'GLOBAL' ||
        (a.tipo === 'REGION' && (p.regionId === a.regionId || p.agencia?.regionId === a.regionId)) ||
        (a.tipo === 'AGENCIA' && p.agenciaId === a.agenciaId));
    if (!permitido) throw new ForbiddenException('Ese pulidor no pertenece a tu alcance.');
    return pulidorId;
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

  async reajustarStock(dto: ReajusteStockDto, currentUser?: any) {
    await this.ensureMovimientoGlobalRutaColumns();
    const usuarioId = currentUser?.id || currentUser?.sub;
    if (!usuarioId) {
      throw new UnauthorizedException('Debes iniciar sesión para reajustar stock.');
    }

    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, bodega: { select: { id: true, nombre: true, regionId: true } } },
    });
    // Quien reajusta lo decide su casilla (bodegas, agencias o kits de pulidores) y su ámbito, no el nombre del rol.
    const ambitoGlobal = resolverAlcance(currentUser).tipo === 'GLOBAL';
    const isAsistente = !ambitoGlobal;

    const cantidadContada = Number(dto.cantidadContada);
    if (!Number.isFinite(cantidadContada) || cantidadContada < 0) {
      throw new BadRequestException('La cantidad contada debe ser un número mayor o igual a 0.');
    }

    const motivoTexto = String(dto.motivoTexto || '').trim();
    if (motivoTexto.length < 10) {
      throw new BadRequestException('Escribe por qué se aumenta o disminuye el stock (mínimo 10 caracteres).');
    }

    const evidenciaUrl = String(dto.evidenciaUrl || '').trim();
    if (!evidenciaUrl || !/^https?:\/\//i.test(evidenciaUrl)) {
      throw new BadRequestException('La foto de evidencia del reajuste es obligatoria y debe estar en S3.');
    }

    const includeStock = {
      insumo: { include: { unidadMedida: true } },
      bodega: true,
      agencia: true,
      pulidor: { select: { id: true, name: true, lastname: true, email: true, agenciaId: true } },
    } as const;
    let stocks: any[] = [];

    if (dto.stockUbicacionId) {
      const one = await this.prisma.stockUbicacion.findUnique({
        where: { id: dto.stockUbicacionId },
        include: includeStock,
      });
      if (one) stocks = [one];
    }

    if (stocks.length === 0 && dto.insumoId && dto.bodegaId) {
      stocks = await this.prisma.stockUbicacion.findMany({
        where: { insumoId: dto.insumoId, bodegaId: dto.bodegaId },
        include: includeStock,
      });
    }
    if (stocks.length === 0 && dto.insumoId && dto.agenciaId) {
      stocks = await this.prisma.stockUbicacion.findMany({
        where: { insumoId: dto.insumoId, agenciaId: dto.agenciaId, tipoUbicacion: 'AGENCIA' },
        include: includeStock,
      });
    }
    if (stocks.length === 0 && dto.insumoId && dto.pulidorId) {
      stocks = await this.prisma.stockUbicacion.findMany({
        where: {
          insumoId: dto.insumoId,
          pulidorId: dto.pulidorId,
          tipoUbicacion: { in: ['PULIDOR_FIJO', 'PULIDOR_MOVIL'] },
        },
        include: includeStock,
      });
    }

    const stock = stocks[0] || null;
    const insumoId = stock?.insumoId || dto.insumoId;
    const bodegaId = stock?.bodegaId || dto.bodegaId || null;
    const agenciaId = stock?.agenciaId || dto.agenciaId || null;
    const pulidorId = stock?.pulidorId || dto.pulidorId || null;
    if (!insumoId || (!bodegaId && !agenciaId && !pulidorId)) {
      throw new BadRequestException('Indica el insumo y la ubicación (bodega, agencia o pulidor) a reajustar.');
    }
    if (!tienePermiso(currentUser, 'inventario.reajustar')) {
      throw new ForbiddenException('Tu rol no puede reajustar el stock.');
    }

    // Alcance del asistente: su bodega asignada, o agencias y pulidores de su región.
    if (isAsistente) {
      if (bodegaId) {
        if (!usuario?.bodegaId || usuario.bodegaId !== bodegaId) {
          throw new ForbiddenException('El asistente de bodega solo puede reajustar el stock de su bodega asignada.');
        }
      } else {
        const regionAsistente = usuario?.bodega?.regionId || usuario?.regionId || null;
        if (!regionAsistente) {
          throw new ForbiddenException('Tu usuario no tiene región asignada para reajustar agencias o pulidores.');
        }
        let regionDestino: string | null = null;
        if (agenciaId) {
          const ag = await this.prisma.agencia.findUnique({ where: { id: agenciaId }, select: { regionId: true } });
          regionDestino = ag?.regionId || null;
        } else if (pulidorId) {
          const pu = await this.prisma.user.findUnique({
            where: { id: pulidorId },
            select: { regionId: true, agencia: { select: { regionId: true } } },
          });
          regionDestino = pu?.regionId || pu?.agencia?.regionId || null;
        }
        if (!regionDestino || regionDestino !== regionAsistente) {
          throw new ForbiddenException('El asistente de bodega solo puede reajustar agencias y pulidores de su región.');
        }
      }
    }

    const [bodega, agencia, pulidor] = await Promise.all([
      bodegaId
        ? (stock?.bodega || this.prisma.bodega.findUnique({ where: { id: bodegaId } }))
        : Promise.resolve(null),
      agenciaId
        ? (stock?.agencia || this.prisma.agencia.findUnique({ where: { id: agenciaId }, select: { id: true, nombre: true, codigo: true } }))
        : Promise.resolve(null),
      pulidorId
        ? (stock?.pulidor || this.prisma.user.findUnique({
            where: { id: pulidorId },
            select: { id: true, name: true, lastname: true, email: true, agenciaId: true },
          }))
        : Promise.resolve(null),
    ]);

    if (bodegaId && !bodega) throw new NotFoundException(`Bodega ${bodegaId} no encontrada.`);
    if (agenciaId && !agencia) throw new NotFoundException(`Agencia ${agenciaId} no encontrada.`);
    if (pulidorId && !pulidor) throw new NotFoundException(`Pulidor ${pulidorId} no encontrado.`);

    const tipoUbicacion = pulidorId
      ? (pulidor?.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL')
      : agenciaId
        ? 'AGENCIA'
        : 'BODEGA_CENTRAL';
    const ubicacionId = String(bodegaId || agenciaId || pulidorId);
    const ubicacionNombre = bodega?.nombre
      || agencia?.nombre
      || `${pulidor?.name || ''} ${pulidor?.lastname || ''}`.trim()
      || pulidor?.email
      || 'Ubicación';

    const insumo = stock?.insumo || await this.prisma.insumo.findUnique({
      where: { id: insumoId },
      include: { unidadMedida: true },
    });
    if (!insumo) {
      throw new NotFoundException(`Insumo ${insumoId} no encontrado.`);
    }

    const stockAnterior = stocks.reduce((sum, row) => sum + Number(row.cantidadActual || 0), 0);
    const delta = Math.round((cantidadContada - stockAnterior) * 10000) / 10000;
    if (Math.abs(delta) < 0.0001) {
      throw new BadRequestException('La cantidad contada es igual al stock actual. No hay nada que reajustar.');
    }

    const motivoCorto = delta > 0 ? 'Aumento de inventario' : 'Disminución de inventario';
    const codigoTipo = delta > 0 ? 'POSITIVE_ADJUSTMENT' : 'NEGATIVE_ADJUSTMENT';
    let tipoMov = await this.prisma.tipoMovimientoInventario.findFirst({ where: { codigo: codigoTipo } });
    if (!tipoMov) {
      tipoMov = await this.prisma.tipoMovimientoInventario.create({
        data: {
          codigo: codigoTipo,
          nombre: delta > 0 ? 'Ajuste (+)' : 'Ajuste (−)',
          descripcion: 'Reajuste de stock por conteo físico',
          esEntrada: delta > 0,
          estado: 1,
        },
      });
    }

    const unidadId = insumo.unidadMedidaId;
    if (!unidadId) {
      throw new BadRequestException('El insumo no tiene unidad de medida configurada.');
    }
    const responsableNombre = `${usuario?.name || ''} ${usuario?.lastname || ''}`.trim() || usuario?.email || usuarioId;
    const observaciones = `[REAJUSTE] ${motivoCorto}. ${motivoTexto} | ${responsableNombre}`;
    const numeroComprobante = `AJU-${Date.now().toString().slice(-8)}-${Math.floor(Math.random() * 100)}`;

    const resultado = await this.prisma.$transaction(async (tx) => {
      let stockId = stock?.id;
      if (stockId) {
        await tx.stockUbicacion.update({
          where: { id: stockId },
          data: { cantidadActual: cantidadContada },
        });
        for (const extra of stocks.slice(1)) {
          await tx.stockUbicacion.update({
            where: { id: extra.id },
            data: { cantidadActual: 0 },
          });
        }
      } else {
        const created = await tx.stockUbicacion.create({
          data: {
            insumoId,
            tipoUbicacion,
            bodegaId: bodegaId || undefined,
            agenciaId: agenciaId || undefined,
            pulidorId: pulidorId || undefined,
            cantidadActual: cantidadContada,
            cantidadMinima: Number(
              tipoUbicacion === 'AGENCIA'
                ? (insumo.stockMinimoAgencia || 0)
                : (insumo.stockMinimoBodega || 0),
            ),
          },
        });
        stockId = created.id;
      }

      if (tipoUbicacion === 'BODEGA_CENTRAL') {
        const stockCatalogoNuevo = Math.max(0, Number(insumo.stockActual) + delta);
        await tx.insumo.update({
          where: { id: insumoId },
          data: { stockActual: stockCatalogoNuevo },
        });
      }

      const movGlobal = await tx.movimientoInventarioGlobal.create({
        data: {
          numeroComprobante,
          tipoMovimientoId: tipoMov.id,
          insumoId,
          cantidad: Math.abs(delta),
          unidadId,
          cantidadBase: delta,
          stockAnterior,
          stockNuevo: cantidadContada,
          ubicacionId,
          origenUbicacion: ubicacionNombre,
          destinoUbicacion: delta > 0 ? 'Reajuste (+)' : 'Reajuste (−)',
          responsableId: usuarioId,
          referencia: motivoCorto,
          observaciones,
          evidenciasUrls: [evidenciaUrl],
          stockUbicacionId: stockId,
          cantidadContada,
        },
        include: {
          insumo: { select: { id: true, codigoSKU: true, nombre: true } },
          tipoMovimiento: true,
          unidad: true,
          responsable: { select: { id: true, name: true, lastname: true, email: true } },
        },
      });

      await tx.kardexMovimiento.create({
        data: {
          insumoId,
          ubicacionId,
          tipoMovimiento: codigoTipo,
          cantidad: delta,
          stockAnterior,
          stockPosterior: cantidadContada,
          costoUnitario: insumo.costoUnitarioUSD,
          costoTotal: Number(insumo.costoUnitarioUSD || 0) * Math.abs(delta),
          referenciaId: numeroComprobante,
          usuarioId,
        },
      });

      return movGlobal;
    });

    return {
      ...resultado,
      bodega: bodega ? { id: bodega.id, nombre: bodega.nombre } : null,
      agencia: agencia ? { id: agencia.id, nombre: agencia.nombre } : null,
      pulidor: pulidor
        ? { id: pulidor.id, nombre: `${pulidor.name || ''} ${pulidor.lastname || ''}`.trim() || pulidor.email }
        : null,
      ubicacion: { id: ubicacionId, nombre: ubicacionNombre, tipo: tipoUbicacion },
      motivo: motivoCorto,
      motivoTexto,
      evidenciaUrl,
      realizadoPor: responsableNombre,
      realizadoEn: resultado.fechaMovimiento || resultado.createdAt,
    };
  }


  /**
   * Resumen de stock por agencia. Sin page/pageSize: la respuesta de siempre (hasta 100 fichas, cada una con todos sus
   * insumos). Con page/pageSize: fichas paginadas sin insumos (con `metricas` de toda la red) o, con `agenciaId`, la ficha y
   * una página de sus insumos. Ver StockResumenAgenciasDto.
   */
  async obtenerStockAgenciasResumen(dto: StockResumenAgenciasDto = {}, usuarioId?: string) {
    const calc = await this.calcularStockAgencias(dto, usuarioId);
    const metricas = {
      totalAgencias: calc.agencias.length,
      agenciasEnAlerta: calc.agenciasEnAlerta,
      insumosCriticosTotal: calc.insumosCriticosTotal,
    };
    if (!esConsultaPaginada(dto)) {
      return { ...metricas, agencias: calc.agenciasData.slice(0, PAGE_SIZE_MAX) };
    }
    const pag = resolverPaginacion(dto);
    const sinInsumos = ({ insumos: _omitidos, ...ficha }: any) => ficha;

    if (dto.agenciaId) {
      const ficha = calc.agenciasData.find((a) => a.agencia.id === dto.agenciaId) ?? null;
      const { items, total } = this.paginarInsumosResumen(dto, ficha?.insumos ?? [], pag);
      return { ...buildDataGridResponse(items, total, pag.page, pag.pageSize), agencia: ficha ? sinInsumos(ficha) : null, metricas };
    }

    // "Otras agencias": se quita la propia salvo que sea la única (así la pantalla nunca queda vacía por eso).
    const sinPropia = dto.excluirAgenciaId
      ? calc.agenciasData.filter((a) => String(a.agencia.id) !== String(dto.excluirAgenciaId))
      : calc.agenciasData;
    const base = sinPropia.length > 0 ? sinPropia : calc.agenciasData;
    const filtradas = base.filter(
      (a) =>
        (!dto.estadoUbicacion || (dto.estadoUbicacion === 'alerta') === a.tieneAlerta) &&
        coincidePalabras(dto.search, [a.agencia.nombre, a.agencia.codigo, a.agencia.region, ...a.insumos.flatMap((i) => [i.nombre, i.codigoSKU])]),
    );
    const ordenadas = ordenarFilas(filtradas, dto.sortField, dto.sortOrder, COLUMNAS_FICHA_AGENCIA, { campo: 'nombre', dir: 'asc' }, (a) => a.agencia.id);
    const items = paginarLista(ordenadas, pag).map(sinInsumos);
    return { ...buildDataGridResponse(items, filtradas.length, pag.page, pag.pageSize), metricas };
  }

  private async calcularStockAgencias(dto: { agenciaId?: string; region?: string }, usuarioId?: string) {
    const whereAgencia: any = { estado: 1 };

    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: {
          role: true,
          region: true,
          bodega: { select: { regionId: true } },
          agencia: { select: { regionId: true, region: true } },
        },
      });
      if (usuario) {
        const rol = rolDeUsuario(usuario);
        const alc = resolverAlcance(usuario);
        if (alc.tipo === 'REGION') {
          whereAgencia.regionId = alc.regionId;
        } else if (esLiderDeAgencia(rol) && usuario.agencia?.regionId) {
          // El líder puede consultar agencias de su región para seleccionar destinos de despacho.
          whereAgencia.regionId = usuario.agencia.regionId;
        } else if (alc.tipo === 'AGENCIA') {
          whereAgencia.id = alc.agenciaId;
        } else if (alc.tipo !== 'GLOBAL') {
          whereAgencia.id = { in: [] };
        }
      } else {
        whereAgencia.id = { in: [] };
      }
    }

    const filtrosCliente: Record<string, unknown>[] = [];
    if (dto.agenciaId) filtrosCliente.push({ id: dto.agenciaId });
    if (dto.region) filtrosCliente.push({ region: dto.region });
    if (filtrosCliente.length) whereAgencia.AND = filtrosCliente;

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

    const enTransito = await this.enTransitoPorDestino('agencia');

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
        return perteneceAServicios || actual > 0 || enTransito.has(`${ag.id}_${ins.id}`);
      });

      const insumosAgencia = insumosDeEstaAgencia.map((ins) => {
        const actual = stockMap.get(`${ag.id}_${ins.id}`) ?? 0;
        const transito = enTransito.get(`${ag.id}_${ins.id}`);
        const cNeto = Number(ins.contenidoNeto) || 1;
        const isLiquidOrPowder = ins.unidadMedida?.simbolo === 'ml' || ins.unidadMedida?.simbolo === 'g';
        const rawMinimo = Number(ins.stockMinimoAgencia) || 2;
        const minimo = isLiquidOrPowder && cNeto > 1 && rawMinimo < cNeto
          ? rawMinimo * cNeto
          : rawMinimo;
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
          contenidoNeto: cNeto,
          stockActual: actual,
          stockUnidades: Math.round((actual / cNeto) * 100) / 100,
          stockMinimo: minimo,
          deficit,
          estado,
          enTransitoUnidades: transito?.unidades ?? 0,
          enTransitoDespachos: transito?.despachos ?? 0,
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

    return { agencias, agenciasData, agenciasEnAlerta, insumosCriticosTotal };
  }

  /** Filtro por estado y búsqueda, orden y página sobre los insumos ya calculados de una ubicación (bodega, agencia o kit). */
  private paginarInsumosResumen(
    dto: { search?: string; estado?: string; sortField?: string; sortOrder?: string },
    insumos: any[],
    pag: { skip: number; take: number },
  ): { items: any[]; total: number } {
    const estado = dto.estado ? normalizarTexto(dto.estado) : null;
    const filtrados = insumos.filter(
      (i) => (!estado || normalizarTexto(i.estado) === estado) && coincidePalabras(dto.search, [i.codigoSKU, i.nombre, i.tipoProducto]),
    );
    const ordenados = ordenarFilas(filtrados, dto.sortField, dto.sortOrder, COLUMNAS_INSUMO_RESUMEN, { campo: 'nombre', dir: 'asc' }, (i) => i.insumoId);
    return { items: paginarLista(ordenados, pag), total: filtrados.length };
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
      // Con una bodega asignada y sin alcance nacional, solo se ve esa bodega.
      const isAsistente =
        userRole === 'ASISTENTE_BODEGA' ||
        (userRole.includes('ASISTENTE') && userRole.includes('BODEGA')) ||
        (!!usuario?.bodegaId && resolverAlcance(usuario).tipo !== 'GLOBAL');

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

    // No se elimina una bodega que aún guarda insumos: quedarían registros de stock sin bodega.
    const conStock = await this.prisma.stockUbicacion.findMany({
      where: { bodegaId: dto.id, cantidadActual: { gt: 0 } },
      select: { insumo: { select: { nombre: true } } },
      take: 5,
    });
    if (conStock.length > 0) {
      const total = await this.prisma.stockUbicacion.count({ where: { bodegaId: dto.id, cantidadActual: { gt: 0 } } });
      const ejemplos = conStock.map((r) => r.insumo?.nombre).filter(Boolean).join(', ');
      throw new BadRequestException(
        `No se puede eliminar la bodega "${existing[0].nombre}": todavía tiene stock de ${total} insumo(s) (${ejemplos}${total > conStock.length ? ', …' : ''}). Despáchalo o reajústalo a cero antes de eliminarla.`,
      );
    }

    // Sin stock: sus filas en cero se retiran junto con la bodega (no deben quedar huérfanas).
    await this.prisma.$transaction([
      this.prisma.stockUbicacion.deleteMany({ where: { bodegaId: dto.id } }),
      this.prisma.$executeRawUnsafe(`DELETE FROM "bodegas" WHERE "id" = $1`, dto.id),
    ]);

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

  /**
   * Insumos de una bodega con su estado. Sin page/pageSize: la respuesta de siempre (hasta 100 insumos). Con page/pageSize:
   * una página con búsqueda, filtro por estado y orden en el servidor; `metricas` cuenta TODOS los insumos de la bodega.
   */
  async obtenerStockBodegasResumen(dto: StockResumenBodegasDto = {}, usuarioId?: string) {
    const r: any = await this.calcularStockBodega(dto, usuarioId);
    if (!esConsultaPaginada(dto)) return { ...r, insumos: (r.insumos as any[]).slice(0, PAGE_SIZE_MAX) };
    const pag = resolverPaginacion(dto);
    const { items, total } = this.paginarInsumosResumen(dto, r.insumos, pag);
    return { ...r, ...buildDataGridResponse(items, total, pag.page, pag.pageSize), insumos: items };
  }

  private async calcularStockBodega(dto: { bodegaId?: string }, usuarioId?: string) {
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
      const isLiquidOrPowder = ins.unidadMedida?.simbolo === 'ml' || ins.unidadMedida?.simbolo === 'g';
      const rawMinimo = Number(ins.stockMinimoBodega) || 10;
      const minimo = isLiquidOrPowder && cNeto > 1 && rawMinimo < cNeto
        ? rawMinimo * cNeto
        : rawMinimo;
      const rawOptimo = Number(ins.stockOptimoBodega) || 50;
      const optimo = isLiquidOrPowder && cNeto > 1 && rawOptimo < cNeto
        ? rawOptimo * cNeto
        : rawOptimo;
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

  /**
   * Resumen de stock por kit de pulidor. Mismo esquema que `obtenerStockAgenciasResumen`: sin page/pageSize la respuesta de
   * siempre (hasta 100 kits con todos sus insumos); con page/pageSize, fichas paginadas o, con `pulidorId`, una página de
   * los insumos de ese kit. Ver StockResumenPulidoresDto.
   */
  async obtenerStockPulidoresResumen(dto: StockResumenPulidoresDto = {}, usuarioId?: string) {
    const calc = await this.calcularStockPulidores(dto, usuarioId);
    const metricas = {
      totalPulidores: calc.pulidoresData.length,
      pulidoresEnAlerta: calc.pulidoresEnAlerta,
      insumosCriticosTotal: calc.insumosCriticosTotal,
    };
    if (!esConsultaPaginada(dto)) {
      return { ...metricas, pulidores: calc.pulidoresData.slice(0, PAGE_SIZE_MAX) };
    }
    const pag = resolverPaginacion(dto);
    const sinInsumos = ({ insumos: _omitidos, ...ficha }: any) => ficha;

    if (dto.pulidorId) {
      const ficha = calc.pulidoresData.find((p) => p.id === dto.pulidorId) ?? null;
      const { items, total } = this.paginarInsumosResumen(dto, ficha?.insumos ?? [], pag);
      return { ...buildDataGridResponse(items, total, pag.page, pag.pageSize), pulidor: ficha ? sinInsumos(ficha) : null, metricas };
    }

    const filtrados = calc.pulidoresData.filter(
      (p) =>
        (!dto.tipoPulidor || p.tipoPulidor === dto.tipoPulidor) &&
        (!dto.estadoUbicacion || (dto.estadoUbicacion === 'alerta') === p.tieneAlerta) &&
        coincidePalabras(dto.search, [p.nombre, p.email, p.regionNombre, p.agenciaNombre, ...p.insumos.flatMap((i) => [i.nombre, i.codigoSKU])]),
    );
    const ordenados = ordenarFilas(filtrados, dto.sortField, dto.sortOrder, COLUMNAS_FICHA_PULIDOR, { campo: 'nombre', dir: 'asc' }, (p) => p.id);
    const items = paginarLista(ordenados, pag).map(sinInsumos);
    return { ...buildDataGridResponse(items, filtrados.length, pag.page, pag.pageSize), metricas };
  }

  private async calcularStockPulidores(dto: { pulidorId?: string; regionId?: string }, usuarioId?: string) {
    const wherePulidor: any = {
      role: { namerol: { in: ['PULIDOR'] } },
      estado: 1,
    };

    if (usuarioId) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: usuarioId },
        include: { role: true, region: true, bodega: { select: { regionId: true } } },
      });
      if (!usuario) {
        wherePulidor.id = { in: [] };
      } else if (rolDeUsuario(usuario) === 'PULIDOR') {
        wherePulidor.id = usuarioId;
      } else {
        const alcance = resolverAlcance(usuario);
        switch (alcance.tipo) {
          case 'GLOBAL':
            break;
          case 'REGION':
            wherePulidor.OR = [
              { regionId: alcance.regionId },
              { agencia: { regionId: alcance.regionId } },
            ];
            break;
          case 'AGENCIA':
            wherePulidor.agenciaId = alcance.agenciaId;
            break;
          case 'PROPIO':
            wherePulidor.id = alcance.userId;
            break;
          default:
            wherePulidor.id = { in: [] };
        }
      }
    }

    const filtrosCliente: Record<string, unknown>[] = [];
    if (dto.pulidorId) filtrosCliente.push({ id: dto.pulidorId });
    if (dto.regionId) {
      filtrosCliente.push({
        OR: [{ regionId: dto.regionId }, { agencia: { regionId: dto.regionId } }],
      });
    }
    if (filtrosCliente.length) wherePulidor.AND = filtrosCliente;

    const [pulidores, insumos, stocksUbicacion, recetasEspeciales] = await Promise.all([
      this.prisma.user.findMany({
        where: wherePulidor,
        orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
        select: {
          id: true,
          name: true,
          lastname: true,
          email: true,
          role: { select: { namerol: true } },
          regionId: true,
          region: { select: { id: true, nombre: true } },
          agenciaId: true,
          agencia: { select: { id: true, nombre: true } },
          servicioIds: true,
        },
      }),
      this.prisma.insumo.findMany({
        where: { estado: 1 },
        include: {
          tipoProducto: { select: { id: true, nombre: true } },
          unidadMedida: { select: { id: true, simbolo: true, nombre: true } },
          recetas: { select: { catalogoServicioId: true } },
        },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.stockUbicacion.findMany({
        where: {
          OR: [
            { tipoUbicacion: { in: ['PULIDOR_MOVIL', 'PULIDOR_FIJO'] } },
            { pulidorId: { not: null } },
          ],
        },
      }),
      this.prisma.recetaInsumo.findMany({
        where: { catalogoServicio: { categoria: 'ESPECIAL' } },
        select: { insumoId: true },
      }),
    ]);

    const insumoIdsEspeciales = new Set(recetasEspeciales.map((r) => r.insumoId));

    const stockMap = new Map<string, number>();
    for (const s of stocksUbicacion) {
      if (s.pulidorId) {
        const key = `${s.pulidorId}_${s.insumoId}`;
        const prev = stockMap.get(key) ?? 0;
        stockMap.set(key, prev + Number(s.cantidadActual));
      }
    }

    const enTransito = await this.enTransitoPorDestino('pulidor');

    let pulidoresEnAlerta = 0;
    let insumosCriticosTotal = 0;

    const pulidoresData = pulidores.map((pul) => {
      let alertaPulidor = false;
      let criticosPulidor = 0;

      // Todo pulidor (fijo o móvil) maneja todos los servicios especiales y requiere sus insumos
      const insumosDelPulidor = insumos.filter((ins) => {
        const actual = stockMap.get(`${pul.id}_${ins.id}`) ?? 0;
        const esInsumoEspecial = insumoIdsEspeciales.has(ins.id);
        return esInsumoEspecial || actual > 0 || enTransito.has(`${pul.id}_${ins.id}`);
      });

      const insumosList = (insumosDelPulidor.length > 0 ? insumosDelPulidor : insumos.slice(0, 10)).map((ins) => {
        const actual = stockMap.get(`${pul.id}_${ins.id}`) ?? 0;
        const cNeto = Number(ins.contenidoNeto) || 1;
        const unidadesActuales = Math.floor(actual / cNeto + 1e-9);
        const transito = enTransito.get(`${pul.id}_${ins.id}`);
        const isLiquidOrPowder = ins.unidadMedida?.simbolo === 'ml' || ins.unidadMedida?.simbolo === 'g';
        const rawMinimo = Number(ins.stockMinimoAgencia) || 1;
        const minimo = isLiquidOrPowder && cNeto > 1 && rawMinimo < cNeto
          ? rawMinimo * cNeto
          : rawMinimo;
        let estado: 'Óptimo' | 'Bajo' | 'Crítico' | 'Sin Stock' = 'Óptimo';

        if (actual <= 0) {
          estado = 'Sin Stock';
          alertaPulidor = true;
          criticosPulidor++;
          insumosCriticosTotal++;
        } else if (actual < minimo) {
          estado = 'Crítico';
          alertaPulidor = true;
          criticosPulidor++;
          insumosCriticosTotal++;
        } else if (actual <= minimo * 1.2) {
          estado = 'Bajo';
          alertaPulidor = true;
        }

        const deficit = actual < minimo ? minimo - actual : 0;

        return {
          insumoId: ins.id,
          id: ins.id,
          sku: ins.codigoSKU,
          codigoSKU: ins.codigoSKU,
          nombre: ins.nombre,
          categoria: ins.categoria || ins.tipoProducto?.nombre || 'Insumo',
          tipoProducto: ins.tipoProducto?.nombre || (ins.categoria === 'QUIMICOS_LAVADO' ? 'Líquido' : (ins.categoria === 'CONSUMIBLE' ? 'Consumible' : 'Químico')),
          unidad: ins.unidadMedida?.simbolo || 'und',
          contenidoNeto: cNeto,
          stockActual: actual,
          stockUnidades: unidadesActuales,
          stockMinimo: minimo,
          stockMinimoUnidades: Math.floor(minimo / cNeto + 1e-9) || 1,
          deficit,
          estado,
          enTransitoUnidades: transito?.unidades ?? 0,
          enTransitoDespachos: transito?.despachos ?? 0,
        };
      });

      if (alertaPulidor) pulidoresEnAlerta++;

      const esFijo = !!pul.agenciaId;

      return {
        id: pul.id,
        nombre: `${pul.name || ''} ${pul.lastname || ''}`.trim() || pul.email,
        email: pul.email,
        telefono: null,
        rol: pul.role?.namerol || 'PULIDOR',
        tipoPulidor: esFijo ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL',
        tipoLabel: esFijo ? `Pulidor Fijo (${pul.agencia?.nombre || 'Sucursal'})` : `Pulidor Móvil (${pul.region?.nombre || 'Ruta'})`,
        regionId: pul.regionId,
        regionNombre: pul.region?.nombre || 'Sin Región',
        agenciaId: pul.agenciaId,
        agenciaNombre: pul.agencia?.nombre || (esFijo ? 'Sucursal' : 'Móvil / En Ruta'),
        tieneAlerta: alertaPulidor,
        insumosCriticos: criticosPulidor,
        totalInsumos: insumosList.length,
        insumos: insumosList,
      };
    });

    return { pulidoresData, pulidoresEnAlerta, insumosCriticosTotal };
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

    // Validar que todos los insumos existan y guardar su contenido neto (envase → unidad base), igual que en despachos.
    const insumosPorId = new Map<string, { contenidoNeto: unknown }>();
    for (const det of dto.detalles) {
      const insumo = await this.prisma.insumo.findUnique({ where: { id: det.insumoId } });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${det.insumoId}" no encontrado`);
      insumosPorId.set(det.insumoId, insumo);
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

    // Incrementar stock en BODEGA_CENTRAL y registrar Kardex. `cantidadEnviada` llega en envases/unidades físicas
    // (igual que un despacho): se convierte a unidad base con `contenidoNeto` antes de tocar stock y kardex.
    for (const det of dto.detalles) {
      const cNeto = Number(insumosPorId.get(det.insumoId)?.contenidoNeto) || 1;
      const cantidadBase = this.unidadesABase(Number(det.cantidadEnviada), cNeto);

      const existing = await this.prisma.stockUbicacion.findFirst({
        where: { insumoId: det.insumoId, tipoUbicacion: 'BODEGA_CENTRAL' },
      });
      const stockAnt = existing ? Number(existing.cantidadActual) : 0;
      const stockPost = stockAnt + cantidadBase;

      if (existing) {
        await this.prisma.stockUbicacion.update({
          where: { id: existing.id },
          data: { cantidadActual: { increment: cantidadBase } },
        });
      } else {
        await this.prisma.stockUbicacion.create({
          data: {
            insumoId: det.insumoId,
            tipoUbicacion: 'BODEGA_CENTRAL',
            cantidadActual: cantidadBase,
          },
        });
      }

      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId: det.insumoId,
          ubicacionId: 'BODEGA_CENTRAL',
          tipoMovimiento: 'COMPRA_INGRESO',
          cantidad: cantidadBase,
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

  /**
   * Unidades despachadas que siguen en camino (EN_TRANSITO o PENDIENTE de confirmar) hacia cada agencia o kit de pulidor,
   * por insumo. Clave: `${destinoId}_${insumoId}`. Un despacho a un pulidor cuenta solo para su kit, no para la agencia.
   */
  private async enTransitoPorDestino(tipo: 'agencia' | 'pulidor'): Promise<Map<string, { unidades: number; despachos: number }>> {
    const mapa = new Map<string, { unidades: number; despachos: number }>();
    const columna = tipo === 'agencia' ? 'destinoAgenciaId' : 'destinoPulidorId';
    const soloAgencia = tipo === 'agencia' ? `AND m."destinoPulidorId" IS NULL` : '';
    try {
      const rows: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT m."${columna}" AS destino, d."insumoId" AS "insumoId",
                COALESCE(SUM(d."cantidadEnviada"), 0)::float AS unidades,
                COUNT(DISTINCT m."id")::int AS despachos
         FROM "MovimientoDetalle" d
         INNER JOIN "MovimientoInventario" m ON m."id" = d."movimientoId"
         WHERE m."estadoDespacho" IN ('EN_TRANSITO', 'PENDIENTE')
           AND m."${columna}" IS NOT NULL ${soloAgencia}
         GROUP BY m."${columna}", d."insumoId"`,
      );
      for (const r of rows) mapa.set(`${r.destino}_${r.insumoId}`, { unidades: Number(r.unidades) || 0, despachos: Number(r.despachos) || 0 });
    } catch {
      // Sin la marca de tránsito la tabla sigue siendo útil.
    }
    return mapa;
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

  /**
   * Al recibir un despacho que deja el stock por encima del mínimo, resuelve las alertas abiertas de ese insumo en ese
   * destino (también las ya marcadas como DESPACHADO, que esperaban justo esta recepción). Pasar del stock máximo no
   * importa: es referencial. Un fallo aquí no debe deshacer la recepción, pero se registra.
   */
  private async resolverAlertasReabastecidas(where: Prisma.AlertaStockWhereInput, guia: string, stockActual: number) {
    try {
      const abiertas = await this.prisma.alertaStock.findMany({
        where: { ...where, estado: { in: ['PENDIENTE', 'EN_PROCESO', 'DESPACHADO'] } },
        select: { id: true, mensaje: true },
      });
      const nota = `Reabastecido mediante despacho guía ${guia}. Stock actual: ${stockActual}`;
      const ahora = new Date();
      for (const a of abiertas) {
        await this.prisma.alertaStock.update({
          where: { id: a.id },
          data: { estado: 'RESUELTO', fechaAtencion: ahora, mensaje: a.mensaje ? `${a.mensaje} | ${nota}` : nota },
        });
      }
    } catch (err) {
      this.logger.warn(`No se pudieron resolver las alertas del despacho ${guia}: ${(err as Error).message}`);
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

      // Auto-resolver las alertas de la agencia (no las del kit de un pulidor fijo de esa sede) si supera el mínimo
      const ins = await this.prisma.insumo.findUnique({ where: { id: insumoId }, select: { stockMinimoAgencia: true } });
      const nuevoStockAg = ant + cantidad;
      if (nuevoStockAg > Number(ins?.stockMinimoAgencia ?? 2)) {
        await this.resolverAlertasReabastecidas({ insumoId, agenciaId: params.destinoAgenciaId, pulidorId: null }, guia, nuevoStockAg);
      }
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

      // Auto-resolver alertas del pulidor
      const insP = await this.prisma.insumo.findUnique({ where: { id: insumoId }, select: { stockMinimoAgencia: true } });
      const nuevoStockP = ant + cantidad;
      if (nuevoStockP > Number(insP?.stockMinimoAgencia ?? 1)) {
        await this.resolverAlertasReabastecidas({ insumoId, pulidorId: params.destinoPulidorId }, guia, nuevoStockP);
      }
    }
  }

  private async assertUsuarioPuedeConfirmarDespacho(movimiento: any, usuarioId: string) {
    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, bodega: true },
    });
    // Backup opera como líder de la agencia a la que está asignado: se normaliza el alias antes de comparar.
    const role = normalizarRol(usuario?.role?.namerol);
    const isSuperAdmin =
      role === 'SUPER_ADMIN' || (role.includes('SUPER') && role.includes('ADMIN'));

    if (role === 'ADMIN' && !isSuperAdmin) {
      throw new ForbiddenException(
        'Admin no puede confirmar recepción: solo supervisión.',
      );
    }

    const isLider = esLiderDeAgencia(role);
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

    // El destino decide quién recibe: quien pertenece a esa agencia o a esa bodega, o el propio pulidor.
    // El permiso (confirmar o rechazar) lo exige el controlador; aquí solo se valida que el envío sea suyo.
    if (destinoAgenciaId) {
      if (usuario?.agenciaId !== destinoAgenciaId) {
        throw new ForbiddenException('Solo quien pertenece a la sucursal destino puede recibir o rechazar este envío.');
      }
      return { destinoBodegaId, destinoAgenciaId, destinoPulidorId };
    }
    if (destinoBodegaId) {
      if (usuario?.bodegaId !== destinoBodegaId) {
        throw new ForbiddenException('Solo quien pertenece a la bodega destino puede recibir o rechazar este envío.');
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

    const rol = normalizarRol(usuario.role?.namerol);
    const isSuperAdmin = rol === 'SUPER_ADMIN' || (rol.includes('SUPER') && rol.includes('ADMIN'));
    const isAdmin = rol === 'ADMIN';
    const isDirector = isSuperAdmin || isAdmin;

    // Cómo despacha cada quien lo decide su ámbito (país, región con bodega, agencia), no solo el nombre del rol:
    // un rol personalizado con la casilla de despachar se comporta como el rol oficial de su mismo ámbito.
    const alcanceDespacha = resolverAlcance(usuario);
    const nombreCoord = rol === 'COORD_BODEGA' || (rol.includes('COORD') && rol.includes('BODEGA'));
    const nombreAsistente = rol === 'ASISTENTE_BODEGA' || (rol.includes('ASISTENTE') && rol.includes('BODEGA'));
    const isLider = esLiderDeAgencia(rol) || (alcanceDespacha.tipo === 'AGENCIA' && !!usuario.agenciaId && !nombreCoord && !nombreAsistente && !isDirector);
    const isAsistente = !isLider && (nombreAsistente || (!!usuario.bodegaId && alcanceDespacha.tipo !== 'GLOBAL'));
    const isCoord = !isLider && !isAsistente && !isDirector && (nombreCoord || alcanceDespacha.tipo === 'GLOBAL');

    if (!isCoord && !isAsistente && !isLider && !isDirector) {
      throw new ForbiddenException('Tu rol no está autorizado para crear despachos.');
    }

    // Origen = donde está el usuario o selección de Admin / Super Admin
    let origenBodegaId: string | null = null;
    let origenAgenciaId: string | null = null;
    let origenLabel = dto.origenUbicacion || '';

    if (isLider) {
      origenAgenciaId = usuario.agenciaId || null; // nunca la que mande el cliente
      if (!origenAgenciaId) {
        throw new BadRequestException('El líder debe tener una sucursal asignada para despachar desde su stock.');
      }
      origenLabel = origenLabel || `Agencia ${usuario.agencia?.nombre || origenAgenciaId}`;
    } else if (isDirector) {
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
    if (!isCoord && !isDirector && !regionUsuario) {
      throw new ForbiddenException('Tu usuario no tiene una región definida: no puede despachar.');
    }

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
      if (!isCoord && !isDirector && regionUsuario) {
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
      if (!isCoord && !isDirector && regionUsuario && bodRows[0].regionId && bodRows[0].regionId !== regionUsuario) {
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
          if (!isCoord && !isDirector && regionUsuario && maybeBod[0].regionId && maybeBod[0].regionId !== regionUsuario) {
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
        if (!isCoord && !isDirector && regionUsuario && agencia.regionId && agencia.regionId !== regionUsuario) {
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

    if (this.notifications) {
      void this.resolverDestinatariosDespacho({ tipo, destinoPulidorId, destinoAgenciaId, destinoBodegaId }).then((ids) => {
        if (ids.length) {
          void this.notifications!.notificarUsuarios(
            ids,
            'Nuevo despacho en camino',
            `Guía ${guia}: ${destinoLabel}`,
            { movimientoId: movimiento.id },
            { tipo: 'DESPACHO_PENDIENTE', entidadTipo: 'MOVIMIENTO_INVENTARIO', entidadId: movimiento.id },
          );
        }
      });
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
    const evidenciasEnvio = this.validarEvidenciasEnvio(dto.evidencias);

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

    await this.guardarEvidenciasEnvio(movimiento.id, null, nuevoEstado === 'RECHAZADO' ? 'RECHAZO' : 'RECEPCION', evidenciasEnvio, usuarioId);

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

    let hayFaltantes = false;
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
          // Parcial: lo no recibido queda retenido como faltante hasta que la bodega de origen decida (devolverlo o darlo de baja).
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "FaltanteDespacho" ("id", "movimientoId", "numeroGuia", "insumoId", "cantidadUnd", "cantidadBase",
                                             "origenBodegaId", "origenAgenciaId", "motivoRecepcion")
             VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9)`,
            randomUUID(),
            movimiento.id,
            movimiento.numeroGuia,
            det.insumoId,
            Math.max(0, enviadaUnd - recibidaUnd),
            baseSobrante,
            origenBodegaId,
            origenAgenciaId,
            (dto.observaciones || '').toString().trim() || null,
          );
          hayFaltantes = true;
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
      // Rechazo: lo reservado NO vuelve solo al origen. Queda retenido hasta que la bodega de origen decida (devolverlo o darlo de baja).
      for (const det of movimiento.detalles) {
        const baseReservado = await baseReservadoKardex(det.insumoId);
        if (baseReservado > 0) {
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO "FaltanteDespacho" ("id", "movimientoId", "numeroGuia", "insumoId", "cantidadUnd", "cantidadBase",
                                             "origenBodegaId", "origenAgenciaId", "motivoRecepcion")
             VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9)`,
            randomUUID(),
            movimiento.id,
            movimiento.numeroGuia,
            det.insumoId,
            Number(det.cantidadEnviada),
            baseReservado,
            origenBodegaId,
            origenAgenciaId,
            `Rechazado: ${motivoRechazo}`,
          );
          hayFaltantes = true;
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

    const rechazoConStockRetenido = nuevoEstado === 'RECHAZADO' && hayFaltantes;
    if (this.notifications && movimiento.usuarioDespachaId && !rechazoConStockRetenido) {
      void this.notificarConfirmacionDespacho(movimiento, nuevoEstado, origenAgenciaId, origenBodegaId, motivoRechazo);
    }
    if (hayFaltantes) {
      // Un solo aviso: dice qué pasó (recepción incompleta o rechazo) y que hay que decidir qué hacer con el producto.
      void this.notificarFaltantesDespacho(
        movimiento,
        origenAgenciaId,
        origenBodegaId,
        nuevoEstado === 'RECHAZADO' ? motivoRechazo : (dto.observaciones || '').toString().trim(),
        nuevoEstado === 'RECHAZADO',
      );
    }

    return { ok: true, numeroGuia: movimiento.numeroGuia, nuevoEstado, faltantes: hayFaltantes };
  }

  /** Avisa a la bodega de origen que una recepción parcial dejó producto por resolver (devolver al stock o dar de baja). */
  private async notificarFaltantesDespacho(
    movimiento: { id: string; numeroGuia: string; usuarioDespachaId: string | null },
    origenAgenciaId: string | null,
    origenBodegaId: string | null,
    observacion: string,
    rechazado = false,
  ): Promise<void> {
    if (!this.notifications) return;
    let regionOrigenId: string | null = null;
    if (origenAgenciaId) {
      const ag = await this.prisma.agencia.findUnique({ where: { id: origenAgenciaId }, select: { regionId: true } });
      regionOrigenId = ag?.regionId || null;
    } else if (origenBodegaId) {
      const bod = await this.prisma.bodega.findUnique({ where: { id: origenBodegaId }, select: { regionId: true } });
      regionOrigenId = bod?.regionId || null;
    }
    const porRol = await this.notifications.resolverDestinatariosPorRol({
      global: ['ADMIN', 'SUPER_ADMIN', 'COORD_BODEGA'],
      regionales: ['ASISTENTE_BODEGA', 'SUPERVISOR'],
      regionId: regionOrigenId,
    });
    const ids = [...new Set([movimiento.usuarioDespachaId, ...porRol].filter(Boolean))] as string[];
    void this.notifications.notificarUsuarios(
      ids,
      rechazado ? 'Envío rechazado: decide qué hacer con el producto' : 'Faltante en un envío por resolver',
      rechazado
        ? `La guía ${movimiento.numeroGuia} fue rechazada${observacion ? `: ${observacion}` : ''}. El producto quedó retenido: decide si regresa al stock o se da de baja.`
        : `La guía ${movimiento.numeroGuia} se recibió incompleta${observacion ? `: ${observacion}` : ''}. Decide qué hacer con lo que no llegó: devolverlo al stock o darlo de baja.`,
      { type: 'DESPACHO_FALTANTE', movimientoId: movimiento.id },
      { tipo: 'DESPACHO_FALTANTE', entidadTipo: 'MOVIMIENTO_INVENTARIO', entidadId: movimiento.id },
    );
  }

  /** Fotos opcionales de un envío: hasta 5, ya subidas con el tipo FOTO_ENVIO (carpeta inventario/envios/{guía}/…). */
  private validarEvidenciasEnvio(urls?: string[]): string[] {
    const lista = (Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter(Boolean);
    if (lista.length > 5) throw new BadRequestException('Puedes adjuntar hasta 5 fotos.');
    for (const u of lista) {
      if (!/^https?:\/\//i.test(u) || !u.includes('/inventario/envios/')) {
        throw new BadRequestException('Las fotos de evidencia deben subirse desde la pantalla de Envíos.');
      }
    }
    return lista;
  }

  private async guardarEvidenciasEnvio(movimientoId: string, faltanteId: string | null, etapa: 'RECEPCION' | 'RECHAZO' | 'RESOLUCION', urls: string[], usuarioId: string) {
    for (const url of urls) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "EnvioEvidencia" ("id", "movimientoId", "faltanteId", "etapa", "url", "usuarioId") VALUES ($1, $2, $3, $4, $5, $6)`,
        randomUUID(), movimientoId, faltanteId, etapa, url, usuarioId,
      );
    }
  }

  /** Alcance de quien resuelve: faltantes cuyo origen está en su país, región o agencia. */
  private condicionAlcanceFaltantes(user: any, params: unknown[]): string {
    const a = resolverAlcance(user);
    if (a.tipo === 'GLOBAL') return 'TRUE';
    if (a.tipo === 'REGION') {
      params.push(a.regionId);
      return `COALESCE(b."regionId", ag."regionId") = $${params.length}`;
    }
    if (a.tipo === 'AGENCIA') {
      params.push(a.agenciaId);
      return `f."origenAgenciaId" = $${params.length}`;
    }
    return 'FALSE';
  }

  async listFaltantesDespacho(dto: { estado?: string }, user: any) {
    const resuelto = dto?.estado === 'RESUELTO';
    const params: unknown[] = [resuelto ? 'RESUELTO' : 'PENDIENTE'];
    const alcance = this.condicionAlcanceFaltantes(user, params);
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT f."id", f."movimientoId", f."numeroGuia", f."insumoId", f."cantidadUnd", f."motivoRecepcion", f."estado",
              f."resolucion", f."observacionResolucion", f."resueltoEn", f."createdAt",
              i."nombre" AS "insumoNombre", i."codigoSKU" AS "insumoSku",
              COALESCE(b."nombre", ag."nombre") AS "origenNombre",
              TRIM(CONCAT(u."name", ' ', u."lastname")) AS "resueltoPorNombre"
       FROM "FaltanteDespacho" f
       JOIN "Insumo" i ON i."id" = f."insumoId"
       LEFT JOIN "bodegas" b ON b."id" = f."origenBodegaId"
       LEFT JOIN "Agencia" ag ON ag."id" = f."origenAgenciaId"
       LEFT JOIN "User" u ON u."id" = f."resueltoPorId"
       WHERE f."estado" = $1 AND ${alcance}
       ORDER BY ${resuelto ? 'f."resueltoEn"' : 'f."createdAt"'} DESC
       LIMIT 200`,
      ...params,
    );
    const evid: any[] = rows.length
      ? await this.prisma.$queryRawUnsafe(
          `SELECT "movimientoId", "faltanteId", "etapa", "url" FROM "EnvioEvidencia" WHERE "movimientoId" = ANY($1::text[]) ORDER BY "createdAt"`,
          rows.map((r) => r.movimientoId),
        )
      : [];
    return rows.map((r) => ({
      ...r,
      cantidadUnd: Number(r.cantidadUnd),
      evidenciasRecepcion: evid.filter((e) => e.movimientoId === r.movimientoId && !e.faltanteId).map((e) => e.url),
      evidenciasResolucion: evid.filter((e) => e.faltanteId === r.id).map((e) => e.url),
    }));
  }

  /**
   * Decide qué pasa con lo que no llegó: ENTREGADO confirma que sí llegó al destino y se lo suma; DEVOLVER lo regresa al stock
   * del origen (nunca salió); BAJA lo registra como merma (dañado o perdido). Todo queda en el kardex.
   */
  async resolverFaltanteDespacho(dto: { id: string; resolucion: 'ENTREGADO' | 'DEVOLVER' | 'BAJA'; observacion?: string; evidencias?: string[] }, user: any) {
    if (dto.resolucion !== 'ENTREGADO' && dto.resolucion !== 'DEVOLVER' && dto.resolucion !== 'BAJA') {
      throw new BadRequestException('La resolución debe ser ENTREGADO, DEVOLVER o BAJA.');
    }
    const observacion = String(dto.observacion || '').trim();
    if (observacion.length < 10) {
      throw new BadRequestException('Explica qué pasó con el producto (mínimo 10 caracteres).');
    }
    const evidenciasResolucion = this.validarEvidenciasEnvio(dto.evidencias);
    const params: unknown[] = [dto.id];
    const alcance = this.condicionAlcanceFaltantes(user, params);
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT f.* FROM "FaltanteDespacho" f
       LEFT JOIN "bodegas" b ON b."id" = f."origenBodegaId"
       LEFT JOIN "Agencia" ag ON ag."id" = f."origenAgenciaId"
       WHERE f."id" = $1 AND ${alcance}
       LIMIT 1`,
      ...params,
    );
    const f = rows[0];
    if (!f) throw new NotFoundException('Faltante no encontrado o fuera de tu alcance.');
    if (f.estado !== 'PENDIENTE') throw new BadRequestException('Este faltante ya fue resuelto.');

    // Se marca primero (solo si sigue pendiente) para que dos clics seguidos no devuelvan el stock dos veces.
    const marcado = await this.prisma.$executeRawUnsafe(
      `UPDATE "FaltanteDespacho"
       SET "estado" = 'RESUELTO', "resolucion" = $2, "observacionResolucion" = $3, "resueltoPorId" = $4, "resueltoEn" = NOW()
       WHERE "id" = $1 AND "estado" = 'PENDIENTE'`,
      f.id,
      dto.resolucion,
      observacion,
      user.id,
    );
    if (!marcado) throw new BadRequestException('Este faltante ya fue resuelto.');

    const base = Number(f.cantidadBase);
    const origen = { bodegaId: f.origenBodegaId, agenciaId: f.origenAgenciaId };
    if (dto.resolucion === 'ENTREGADO') {
      // Sí llegó: el producto ya salió del origen al despachar, solo falta sumarlo al destino y corregir lo recibido de la guía.
      const mov: any[] = await this.prisma.$queryRawUnsafe(
        `SELECT "destinoBodegaId", "destinoAgenciaId", "destinoPulidorId" FROM "MovimientoInventario" WHERE "id" = $1 LIMIT 1`,
        f.movimientoId,
      );
      const destino = mov[0] || {};
      await this.sumarStockDestino({
        insumoId: f.insumoId,
        cantidad: base,
        destinoBodegaId: destino.destinoBodegaId,
        destinoAgenciaId: destino.destinoAgenciaId,
        destinoPulidorId: destino.destinoPulidorId,
        guia: f.numeroGuia,
        usuarioId: user.id,
      });
      await this.prisma.$executeRawUnsafe(
        `UPDATE "MovimientoDetalle" SET "cantidadRecibida" = LEAST("cantidadEnviada", COALESCE("cantidadRecibida", 0) + $3::numeric)
         WHERE "movimientoId" = $1 AND "insumoId" = $2`,
        f.movimientoId,
        f.insumoId,
        Number(f.cantidadUnd),
      );
    } else if (dto.resolucion === 'DEVOLVER') {
      await this.devolverStockOrigen(f.insumoId, base, origen, f.numeroGuia, user.id);
    } else {
      const stock = await this.obtenerStockOrigen(f.insumoId, origen);
      const actual = Number(stock?.cantidadActual ?? 0);
      await this.prisma.kardexMovimiento.create({
        data: {
          insumoId: f.insumoId,
          ubicacionId: origen.agenciaId || origen.bodegaId || 'BODEGA_CENTRAL',
          tipoMovimiento: 'AJUSTE_MERMA',
          cantidad: -base,
          // El producto ya salió del stock al despachar: la baja no mueve el saldo, solo deja constancia de dónde terminó.
          stockAnterior: actual,
          stockPosterior: actual,
          referenciaId: f.numeroGuia,
          usuarioId: user.id,
        },
      });
    }
    await this.guardarEvidenciasEnvio(f.movimientoId, f.id, 'RESOLUCION', evidenciasResolucion, user.id);

    // Si ya no queda nada pendiente de esa guía, la alerta crítica de incidencia deja de mostrarse.
    const pendientes: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS "n" FROM "FaltanteDespacho" WHERE "movimientoId" = $1 AND "estado" = 'PENDIENTE'`,
      f.movimientoId,
    );
    if (!Number(pendientes[0]?.n)) {
      await this.prisma.alertaStock.updateMany({
        where: { mensaje: { startsWith: `Incidencia envío ${f.numeroGuia}` }, estado: { not: 'RESUELTO' } },
        data: { estado: 'RESUELTO', fechaAtencion: new Date() },
      });
    }
    return { ok: true, resolucion: dto.resolucion };
  }

  /** Faltantes y fotos de cada guía (pendientes y resueltos): el envío se pinta como desconforme y ofrece «Resolver». */
  private async faltantesPorMovimiento(ids: string[]): Promise<Map<string, { faltantes: any[]; evidencias: any[] }>> {
    const porMov = new Map<string, { faltantes: any[]; evidencias: any[] }>();
    if (!ids.length) return porMov;
    const [faltantes, evidencias] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT f."id", f."movimientoId", f."insumoId", f."cantidadUnd", f."estado", f."resolucion", f."observacionResolucion",
                f."motivoRecepcion", f."resueltoEn", TRIM(CONCAT(u."name", ' ', u."lastname")) AS "resueltoPorNombre"
         FROM "FaltanteDespacho" f LEFT JOIN "User" u ON u."id" = f."resueltoPorId"
         WHERE f."movimientoId" = ANY($1::text[]) ORDER BY f."createdAt"`,
        ids,
      ),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT "movimientoId", "faltanteId", "etapa", "url" FROM "EnvioEvidencia" WHERE "movimientoId" = ANY($1::text[]) ORDER BY "createdAt"`,
        ids,
      ),
    ]);
    for (const id of ids) porMov.set(id, { faltantes: [], evidencias: [] });
    for (const r of faltantes) porMov.get(r.movimientoId)?.faltantes.push({ ...r, cantidadUnd: Number(r.cantidadUnd) });
    for (const e of evidencias) porMov.get(e.movimientoId)?.evidencias.push(e);
    return porMov;
  }

  /** Avisa a quien despachó, admin/super admin, coordinador de bodega (nacional), asistente de bodega
   * y supervisor (de la región de origen) que el despacho fue recibido o rechazado. Nunca bloquea el flujo. */
  private async notificarConfirmacionDespacho(
    movimiento: { id: string; numeroGuia: string; usuarioDespachaId: string | null },
    nuevoEstado: 'RECIBIDO' | 'RECHAZADO',
    origenAgenciaId: string | null,
    origenBodegaId: string | null,
    motivoRechazo: string,
  ): Promise<void> {
    if (!this.notifications) return;
    let regionOrigenId: string | null = null;
    if (origenAgenciaId) {
      const ag = await this.prisma.agencia.findUnique({ where: { id: origenAgenciaId }, select: { regionId: true } });
      regionOrigenId = ag?.regionId || null;
    } else if (origenBodegaId) {
      const bod = await this.prisma.bodega.findUnique({ where: { id: origenBodegaId }, select: { regionId: true } });
      regionOrigenId = bod?.regionId || null;
    }
    const porRol = await this.notifications.resolverDestinatariosPorRol({
      global: ['ADMIN', 'SUPER_ADMIN', 'COORD_BODEGA'],
      regionales: ['ASISTENTE_BODEGA', 'SUPERVISOR'],
      regionId: regionOrigenId,
    });
    const ids = [...new Set([movimiento.usuarioDespachaId, ...porRol].filter(Boolean))] as string[];
    const verbo = nuevoEstado === 'RECIBIDO' ? 'recibido' : 'rechazado';
    void this.notifications.notificarUsuarios(
      ids,
      `Despacho ${verbo}`,
      nuevoEstado === 'RECHAZADO'
        ? `Guía ${movimiento.numeroGuia} fue rechazada: ${motivoRechazo}`
        : `Guía ${movimiento.numeroGuia} fue recibida.`,
      { type: 'DESPACHO_CONFIRMADO', movimientoId: movimiento.id },
      { tipo: 'DESPACHO_CONFIRMADO', entidadTipo: 'MOVIMIENTO_INVENTARIO', entidadId: movimiento.id },
    );
  }

  async rechazarDespacho(
    dto: { movimientoId: string; motivo?: string; observaciones?: string; agenciaId?: string; evidencias?: string[] },
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
        evidencias: dto.evidencias,
      },
      usuarioId,
    );
  }

  /**
   * Despachos (envíos) con paginación, orden, búsqueda y filtros en el servidor.
   *
   * - Sin `page` ni `pageSize` (clientes antiguos, como la app móvil): arreglo con hasta 100 despachos.
   * - Con alguno de los dos: `{ items, total, page, pageSize, totalPages, hasNextPage, hasPrevPage }` y, si se pide
   *   `incluirResumen`, `resumen` con los contadores por estado (con los mismos filtros menos el de estado).
   *
   * Todo va por SQL con el tipo casteado a texto para no depender del enum generado de Prisma. El alcance por rol
   * (pulidor, líder de agencia, asistente de bodega) se aplica aquí y no se puede saltar desde el cliente.
   */
  async listDespachos(dto: ListDespachosDto, usuarioId?: string): Promise<any> {
    const paginado = (dto.page !== undefined && dto.page !== null) || (dto.pageSize !== undefined && dto.pageSize !== null);
    const r = await this.consultarDespachos(dto, usuarioId);
    if (!paginado) return r.items;
    const respuesta = buildDataGridResponse(r.items, r.total, r.page, r.pageSize);
    return r.resumen ? { ...respuesta, resumen: r.resumen } : respuesta;
  }

  /** Igual que `listDespachos` pero siempre un arreglo (hasta 100): para los usos internos. */
  private async listarDespachosPlano(dto: ListDespachosDto, usuarioId?: string): Promise<any[]> {
    return (await this.consultarDespachos(dto, usuarioId)).items;
  }

  private async consultarDespachos(dto: ListDespachosDto, usuarioId?: string) {
    // Sin tamaño de página (cliente antiguo) se devuelven hasta 100 (antes 500); pedir más de 100 se recorta.
    const sinTamano = dto.pageSize === undefined || dto.pageSize === null;
    const { page, pageSize, skip, take } = resolverPaginacion(dto, sinTamano ? { defecto: PAGE_SIZE_MAX } : {});

    await this.ensureDespachoRutaColumns();
    const ctx = await this.contextoDespachos(dto, usuarioId);

    const filtro = this.whereDespachos(ctx);
    const orden = resolverOrdenSql(dto.sortField, dto.sortOrder, ORDEN_DESPACHOS_SQL, { campo: 'fecha', dir: 'desc' }, 'm."id"');
    const nLimite = filtro.params.length + 1;

    // Si el listado toca despachos ya archivados (más de 12 meses, en estado final), se suman a los de la base con el mismo alcance,
    // filtros, búsqueda y orden. Si no, la consulta es exactamente la de siempre.
    const pedida = dto.sortField && Object.prototype.hasOwnProperty.call(ORDEN_DESPACHOS_SQL, dto.sortField) ? dto.sortField : null;
    const campoOrden = pedida ?? 'fecha';
    const dirOrden: 'asc' | 'desc' = pedida ? (String(dto.sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc') : 'desc';
    const despachosArchivo = this.historico ? new DespachosArchivo(this.prisma, this.historico) : null;
    const archivado = despachosArchivo ? await despachosArchivo.consultar({ ctx, campo: campoOrden, dir: dirOrden, skip, take }) : null;

    const [filasBase, conteo, resumenBase] = await Promise.all([
      this.prisma.$queryRawUnsafe(
        `SELECT m."id", m."numeroGuia", m."tipo"::text AS "tipo", m."estadoDespacho"::text AS "estadoDespacho",
                m."origenUbicacion", m."destinoUbicacion", m."fechaDespacho", m."fechaRecepcion",
                m."observaciones", m."usuarioDespachaId", m."usuarioRecibeId", m."createdAt", m."updatedAt",
                m."origenBodegaId", m."origenAgenciaId", m."destinoBodegaId", m."destinoAgenciaId", m."destinoPulidorId"
         FROM "MovimientoInventario" m
         WHERE ${filtro.sql}
         ORDER BY ${orden}
         LIMIT $${nLimite} OFFSET $${nLimite + 1}`,
        ...filtro.params,
        // Con archivo, la página se arma mezclando: de la base hacen falta las primeras `skip + take` filas.
        archivado ? skip + take : take,
        archivado ? 0 : skip,
      ) as Promise<any[]>,
      this.prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS "total" FROM "MovimientoInventario" m WHERE ${filtro.sql}`,
        ...filtro.params,
      ) as Promise<any[]>,
      dto.incluirResumen ? this.resumenDespachos(ctx) : Promise.resolve(undefined),
    ]);

    const total = Number(conteo?.[0]?.total ?? 0) + (archivado?.total ?? 0);
    const filas = archivado && despachosArchivo ? despachosArchivo.mezclar(filasBase, archivado.filas, campoOrden, dirOrden, skip, take) : filasBase;
    const idsArchivados = new Set((archivado?.filas ?? []).map((f) => String(f.id)));
    const detallesArchivados = archivado && despachosArchivo ? await despachosArchivo.detallesDe(filas.filter((f) => idsArchivados.has(String(f.id))), ctx) : [];
    const items = await this.armarDespachos(filas, ctx, detallesArchivados);

    // Las tarjetas de la pantalla también cuentan lo archivado.
    let resumen = resumenBase;
    const porEstadoArchivado = resumenBase && despachosArchivo ? await despachosArchivo.resumen(ctx) : null;
    if (resumenBase && porEstadoArchivado) {
      resumen = {
        enTransito: resumenBase.enTransito + (porEstadoArchivado['EN_TRANSITO'] ?? 0) + (porEstadoArchivado['PENDIENTE'] ?? 0),
        recibidos: resumenBase.recibidos + (porEstadoArchivado['RECIBIDO'] ?? 0),
        rechazados: resumenBase.rechazados + (porEstadoArchivado['RECHAZADO'] ?? 0),
        total: resumenBase.total + Object.values(porEstadoArchivado).reduce((a, b) => a + b, 0),
      };
    }
    return { items, total, page, pageSize, resumen };
  }

  /** Contadores por estado con todos los filtros vigentes salvo el de estado (para las tarjetas de la pantalla). */
  private async resumenDespachos(ctx: ContextoDespachos) {
    const filtro = this.whereDespachos(ctx, true);
    const filas: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT m."estadoDespacho"::text AS "estado", COUNT(*)::int AS "total"
       FROM "MovimientoInventario" m WHERE ${filtro.sql} GROUP BY 1`,
      ...filtro.params,
    );
    const por = new Map(filas.map((f) => [String(f.estado), Number(f.total)]));
    const enTransito = (por.get('EN_TRANSITO') ?? 0) + (por.get('PENDIENTE') ?? 0);
    const recibidos = por.get('RECIBIDO') ?? 0;
    const rechazados = por.get('RECHAZADO') ?? 0;
    const total = [...por.values()].reduce((a, b) => a + b, 0);
    return { enTransito, recibidos, rechazados, total };
  }

  /** Resuelve, con pocas consultas, quién mira y a qué alcance tiene derecho; el resto del listado es SQL sin más consultas. */
  private async contextoDespachos(dto: ListDespachosDto, usuarioId?: string): Promise<ContextoDespachos> {
    const viewer: any = usuarioId
      ? await this.prisma.user.findUnique({ where: { id: usuarioId }, include: { role: true, region: true, bodega: true } })
      : null;
    const rol = normalizarRol(viewer?.role?.namerol);
    const esSuperAdmin = rol === 'SUPER_ADMIN' || (rol.includes('SUPER') && rol.includes('ADMIN'));
    const esAdmin = rol === 'ADMIN' && !esSuperAdmin;
    // Qué despachos ve cada quien lo decide el ámbito de su rol: propio (kit), agencia o región; país ve todo.
    const alc = viewer ? resolverAlcance(viewer) : { tipo: 'NINGUNO' as const };
    const esPulidor = rol.includes('PULIDOR') || alc.tipo === 'PROPIO';
    const esAsistente = !esPulidor && alc.tipo === 'REGION';
    const esLider = !esPulidor && alc.tipo === 'AGENCIA' && !!viewer?.agenciaId;
    const regionPropia: string | undefined = alc.tipo === 'REGION' ? alc.regionId : viewer?.regionId || undefined;

    // Agencia destino: un líder solo ve la suya (aunque el cliente pida otra); los demás pueden filtrar por la que elijan.
    const filtroAgencia = esLider
      ? String(viewer.agenciaId)
      : (dto.sucursalId || dto.agenciaId || dto.agenciaDestinoId || '').trim();
    let agencia: ContextoDespachos['agencia'] = null;
    if (filtroAgencia) {
      const ag = await this.prisma.agencia.findFirst({
        where: {
          OR: [
            { id: filtroAgencia },
            { nombre: { contains: filtroAgencia, mode: 'insensitive' } },
            { codigo: { contains: filtroAgencia, mode: 'insensitive' } },
          ],
        },
      });
      const terminos = [filtroAgencia, ag?.id, ag?.nombre, ag?.codigo].filter((t): t is string => !!t);
      agencia = {
        ids: [...new Set([filtroAgencia, ...(ag ? [ag.id] : [])])],
        patrones: [...new Set(terminos)].map(patronContiene),
        terminos: [...new Set(terminos)],
      };
    }

    // Un pulidor solo ve lo que se le envió a él; el filtro `pulidorId` de otros roles se respeta.
    const pulidorId = esPulidor ? (usuarioId ?? null) : (dto.pulidorId || null);

    let regional: ContextoDespachos['regional'] = null;
    if (viewer && esAsistente) {
      const terminos: string[] = [];
      if (regionPropia || viewer.region?.nombre) {
        const agenciasRegion = await this.prisma.agencia.findMany({
          where: {
            OR: [
              ...(regionPropia ? [{ regionId: regionPropia }] : []),
              ...(viewer.region?.nombre ? [{ region: { contains: viewer.region.nombre, mode: 'insensitive' as const } }] : []),
            ],
          },
          select: { id: true, nombre: true },
        });
        const bodegasRegion = regionPropia
          ? ((await this.prisma
              .$queryRawUnsafe(`SELECT "id", "nombre", "codigo" FROM "bodegas" WHERE "regionId" = $1`, regionPropia)
              .catch(() => [])) as any[])
          : [];
        terminos.push(
          ...agenciasRegion.flatMap((a) => [a.id, a.nombre]),
          ...bodegasRegion.flatMap((b: any) => [b.id, b.nombre, b.codigo]),
          viewer.region?.nombre || '',
        );
      }
      regional = {
        usuarioId: viewer.id,
        bodegaId: viewer.bodegaId || null,
        patrones: [...new Set(terminos.filter(Boolean))].map(patronContiene),
        terminos: [...new Set(terminos.filter(Boolean))],
      };
    }

    const desde = rangoFechas(dto.fechaDesde, dto.fechaHasta);
    const texto = textoBusqueda(dto.search);
    return {
      viewer,
      rol,
      esSuperAdmin,
      esAdmin,
      agencia,
      pulidorId,
      regional,
      estado: dto.estadoDespacho ? String(dto.estadoDespacho).trim().toUpperCase() : null,
      guia: dto.numeroGuia ? String(dto.numeroGuia).trim() : null,
      desde: desde?.gte ?? null,
      hasta: desde?.lte ?? null,
      palabras: texto ? texto.split(' ').slice(0, 5) : [],
    };
  }

  /** `WHERE` de los despachos con parámetros enlazados (nada del cliente se concatena al SQL). */
  private whereDespachos(ctx: ContextoDespachos, sinEstado = false): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const p = (valor: unknown): string => {
      params.push(valor);
      return `$${params.length}`;
    };
    const cond: string[] = [`m."tipo"::text = ANY(${p(TIPOS_DESPACHO)}::text[])`];

    if (!sinEstado && ctx.estado) cond.push(`m."estadoDespacho"::text = ${p(ctx.estado)}`);
    if (ctx.guia) cond.push(`m."numeroGuia" ILIKE ${p(patronContiene(ctx.guia))}`);
    // `fechaDespacho` es un timestamp sin zona guardado en UTC: se compara con el mismo instante en UTC.
    if (ctx.desde) cond.push(`m."fechaDespacho" >= ${p(ctx.desde.toISOString())}::text::timestamp`);
    if (ctx.hasta) cond.push(`m."fechaDespacho" <= ${p(ctx.hasta.toISOString())}::text::timestamp`);

    if (ctx.agencia) {
      const ids = p(ctx.agencia.ids);
      const patrones = p(ctx.agencia.patrones);
      // También los despachos que SALEN de la agencia (p. ej. un traslado entre agencias), no solo los que llegan.
      cond.push(
        `(m."destinoAgenciaId" = ANY(${ids}::text[]) OR m."destinoUbicacion" ILIKE ANY(${patrones}::text[])
          OR m."origenAgenciaId" = ANY(${ids}::text[]) OR m."origenUbicacion" ILIKE ANY(${patrones}::text[]))`,
      );
    }
    if (ctx.pulidorId) {
      const id = p(ctx.pulidorId);
      cond.push(`(m."usuarioRecibeId" = ${id} OR m."destinoPulidorId" = ${id})`);
    }
    if (ctx.regional) {
      const yo = p(ctx.regional.usuarioId);
      const partes = [`m."usuarioDespachaId" = ${yo}`, `m."usuarioRecibeId" = ${yo}`];
      if (ctx.regional.bodegaId) {
        const bodega = p(ctx.regional.bodegaId);
        partes.push(`m."destinoBodegaId" = ${bodega}`, `m."origenBodegaId" = ${bodega}`);
      }
      if (ctx.regional.patrones.length) {
        const patrones = p(ctx.regional.patrones);
        partes.push(`m."destinoUbicacion" ILIKE ANY(${patrones}::text[])`, `m."origenUbicacion" ILIKE ANY(${patrones}::text[])`);
      }
      cond.push(`(${partes.join(' OR ')})`);
    }

    // Cada palabra debe aparecer en la guía, el origen, el destino, algún responsable o algún insumo del envío.
    for (const palabra of ctx.palabras) {
      const n = p(patronContiene(palabra));
      cond.push(
        `(m."numeroGuia" ILIKE ${n} OR m."destinoUbicacion" ILIKE ${n} OR m."origenUbicacion" ILIKE ${n}
          OR EXISTS (SELECT 1 FROM "User" u WHERE u."id" IN (m."usuarioDespachaId", m."usuarioRecibeId")
                     AND (u."name" ILIKE ${n} OR u."lastname" ILIKE ${n}))
          OR EXISTS (SELECT 1 FROM "MovimientoDetalle" d JOIN "Insumo" i ON i."id" = d."insumoId"
                     WHERE d."movimientoId" = m."id" AND (i."nombre" ILIKE ${n} OR i."codigoSKU" ILIKE ${n})))`,
      );
    }

    return { sql: cond.join('\n           AND '), params };
  }

  /** Agrega detalles, responsables y datos derivados a las filas de la página (3 consultas en total, sin importar el tamaño). */
  private async armarDespachos(filas: any[], ctx: ContextoDespachos, detallesArchivados: any[] = []): Promise<any[]> {
    if (!filas.length) return [];
    const ids = filas.map((h) => String(h.id));
    const userIds = [
      ...new Set(filas.flatMap((h) => [h.usuarioDespachaId, h.usuarioRecibeId]).filter(Boolean).map(String)),
    ];
    const [detalles, users, faltantesPorMov] = await Promise.all([
      this.prisma.movimientoDetalle.findMany({
        where: { movimientoId: { in: ids } },
        include: { insumo: { select: { id: true, codigoSKU: true, nombre: true, unidadMedida: true } } },
      }),
      userIds.length
        ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, lastname: true } })
        : Promise.resolve([]),
      this.faltantesPorMovimiento(ids),
    ]);
    const userPorId = new Map(users.map((u) => [u.id, u]));
    const detallesPorMov = new Map<string, any[]>();
    // El detalle no guarda cuándo se creó, así que su orden original se pierde al archivar: se ordena igual para los dos orígenes
    // (por producto y luego por id) y el despacho se ve igual antes y después de archivarse.
    for (const d of [...detalles, ...detallesArchivados].sort((a, b) => String(a.insumo?.nombre ?? '').localeCompare(String(b.insumo?.nombre ?? ''), 'es') || String(a.id).localeCompare(String(b.id)))) {
      const arr = detallesPorMov.get(d.movimientoId) || [];
      arr.push(d);
      detallesPorMov.set(d.movimientoId, arr);
    }

    const { viewer, rol, esSuperAdmin, esAdmin } = ctx;
    return filas.map((h) => {
      let motivoRechazo = '';
      if (h.observaciones && h.observaciones.includes('RECHAZO:')) {
        const partes = h.observaciones.split(/RECHAZO:\s*/i);
        if (partes.length > 1) motivoRechazo = partes[partes.length - 1].trim();
      }

      let destinoAgenciaId = h.destinoAgenciaId || null;
      if (!destinoAgenciaId && h.destinoUbicacion?.includes('[')) {
        const match = String(h.destinoUbicacion).match(/\[(.*?)\]/);
        if (match?.[1]) destinoAgenciaId = match[1].trim();
      }
      const destinoBodegaId = h.destinoBodegaId || null;
      const destinoPulidorId = h.destinoPulidorId || (h.tipo === 'DESPACHO_PULIDOR' ? h.usuarioRecibeId : null);

      let puedeConfirmar = false;
      if (h.estadoDespacho === 'EN_TRANSITO' && viewer) {
        if (esSuperAdmin) {
          puedeConfirmar = true;
        } else if (!esAdmin) {
          if (destinoAgenciaId && viewer.agenciaId === destinoAgenciaId) puedeConfirmar = true;
          else if (destinoBodegaId && viewer.bodegaId === destinoBodegaId) puedeConfirmar = true;
          else if (destinoPulidorId && viewer.id === destinoPulidorId) puedeConfirmar = true;
        }
      }

      return {
        ...h,
        detalles: detallesPorMov.get(String(h.id)) || [],
        usuarioDespacha: h.usuarioDespachaId ? userPorId.get(h.usuarioDespachaId) || null : null,
        usuarioRecibe: h.usuarioRecibeId ? userPorId.get(h.usuarioRecibeId) || null : null,
        origenBodegaId: h.origenBodegaId || null,
        origenAgenciaId: h.origenAgenciaId || null,
        destinoBodegaId,
        destinoAgenciaId,
        destinoPulidorId,
        motivoRechazo: motivoRechazo || undefined,
        puedeConfirmar,
        faltantes: faltantesPorMov.get(String(h.id))?.faltantes || [],
        evidencias: faltantesPorMov.get(String(h.id))?.evidencias || [],
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

    const orConditions: any[] = [
      { destinoAgenciaId: agenciaId },
      ...(agencia ? [{ destinoAgenciaId: agencia.id }] : []),
      ...searchTerms.map((term) => ({
        destinoUbicacion: { contains: term, mode: 'insensitive' as const },
      })),
    ];

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
        usuarioRecibe: { select: { id: true, name: true, lastname: true } },
      },
    });
  }

  async obtenerDespachosPendientes(usuarioId?: string) {
    if (!usuarioId) {
      return this.listarDespachosPlano({ estadoDespacho: 'EN_TRANSITO' });
    }
    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, region: true, bodega: true, agencia: true },
    });
    const todos = await this.listarDespachosPlano({ estadoDespacho: 'EN_TRANSITO' }, usuarioId);

    // Alcance nacional: todos. El resto: lo que va dirigido a su pulidor, su bodega o su agencia, y lo que puede confirmar.
    if (usuario && resolverAlcance(usuario).tipo === 'GLOBAL') return todos;
    return todos.filter((d: any) =>
      d.puedeConfirmar ||
      (usuario?.id && (String(d.destinoPulidorId) === String(usuario.id) || String(d.usuarioRecibeId) === String(usuario.id))) ||
      (usuario?.bodegaId && String(d.destinoBodegaId) === String(usuario.bodegaId)) ||
      (usuario?.agenciaId && String(d.destinoAgenciaId) === String(usuario.agenciaId)),
    );
  }

  async listMovimientos(dto: ListMovimientosDto, user?: any) {
    const where: any = {};
    const a = resolverAlcance(user);
    const mio = user?.id ? String(user.id) : undefined;
    if (a.tipo === 'AGENCIA') {
      where.OR = [{ origenAgenciaId: a.agenciaId }, { destinoAgenciaId: a.agenciaId }, ...(mio ? [{ destinoPulidorId: mio }] : [])];
    } else if (a.tipo === 'REGION') {
      const [agencias, bodegas] = await Promise.all([
        this.prisma.agencia.findMany({ where: { regionId: a.regionId }, select: { id: true } }),
        this.prisma.bodega.findMany({ where: { regionId: a.regionId }, select: { id: true } }),
      ]);
      const ag = agencias.map((x) => x.id);
      const bo = bodegas.map((x) => x.id);
      where.OR = [
        { origenAgenciaId: { in: ag } }, { destinoAgenciaId: { in: ag } },
        { origenBodegaId: { in: bo } }, { destinoBodegaId: { in: bo } },
        ...(mio ? [{ destinoPulidorId: mio }] : []),
      ];
    } else if (a.tipo !== 'GLOBAL') {
      where.destinoPulidorId = mio ?? '__ninguno__';
    }
    if (dto.tipo) where.tipo = dto.tipo;
    if (dto.estadoDespacho) where.estadoDespacho = dto.estadoDespacho;
    if (dto.numeroGuia) where.numeroGuia = { contains: dto.numeroGuia, mode: 'insensitive' };
    if (dto.fechaDesde || dto.fechaHasta) {
      where.fechaDespacho = {};
      if (dto.fechaDesde) where.fechaDespacho.gte = new Date(dto.fechaDesde);
      if (dto.fechaHasta) where.fechaDespacho.lte = new Date(dto.fechaHasta);
    }

    // Base y archivo (los despachos de más de 12 meses ya cerrados están en Parquet).
    return new ServiciosFederados(this.prisma, this.historico).findMany('movimientoInventario', {
      where,
      take: PAGE_SIZE_MAX,
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
          role: { namerol: { in: ['PULIDOR'] } },
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
            estado: { not: 'RESUELTO' },
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

  /**
   * Crea la alerta en el alcance del usuario: LIDER/ADMIN/SUPER_ADMIN la emiten para una agencia; el PULIDOR (fijo o
   * móvil, con o sin agencia asignada) la emite siempre para su propio kit, sin exigirle agencia ni región.
   */
  async crearAlerta(dto: CrearAlertaDto, user: any) {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: dto.insumoId } });
    if (!insumo) throw new NotFoundException(`Insumo con ID "${dto.insumoId}" no encontrado`);

    let agenciaId: string | undefined;
    let pulidorId: string | undefined;
    if (rolDeUsuario(user) === 'PULIDOR') {
      pulidorId = String(user.id);
      const a = resolverAlcance(user);
      agenciaId = a.tipo === 'AGENCIA' ? a.agenciaId : undefined;
    } else {
      agenciaId = await this.agenciaEnAlcance(user, (dto as any).agenciaId || dto.sucursalId);
    }

    return this.prisma.alertaStock.create({
      data: {
        insumoId: dto.insumoId,
        nivel: dto.nivel,
        agenciaId,
        pulidorId,
        usuarioEmisorId: String(user.id),
        mensaje: dto.mensaje,
        stockReportado: dto.stockReportado,
      },
      include: {
        insumo: { select: { codigoSKU: true, nombre: true } },
        agencia: { select: { codigo: true, nombre: true } },
        pulidor: { select: { id: true, name: true, lastname: true } },
        usuarioEmisor: { select: { name: true, lastname: true } },
      },
    });
  }

  /** Última vez que se sincronizaron las necesidades sin stock (memoria del proceso; evita repetir un trabajo pesado). */
  private ultimaSincronizacionAlertas = 0;
  private static readonly INTERVALO_SINCRONIZACION_ALERTAS_MS = 2 * 60 * 1000;

  /**
   * Quién consulta las alertas y qué le corresponde ver. `where` es solo el ALCANCE (agencia/región/kits); los filtros
   * de nivel, estado y búsqueda se combinan aparte. `sincroniza` indica si el rol es de los que ven alertas de varias sedes
   * (y por tanto se benefician de generar las de "insumo requerido sin stock").
   */
  /**
   * Qué alertas ve el usuario. Lo decide el ÁMBITO configurado en su rol (Nacional, Región, Agencia o Propio), no el nombre del rol:
   * un rol propio creado desde «Roles y Permisos» se comporta igual que uno de fábrica con el mismo ámbito.
   * Nunca se usa como respaldo una agencia que mande el cliente: para ámbito de agencia o región manda la del usuario.
   */
  private async alcanceAlertas(dto: ListAlertasDto, usuarioId?: string): Promise<{ where: Record<string, unknown>; sincroniza: boolean }> {
    const where: Record<string, unknown> = {};
    const targetAgencia = dto.agenciaId || dto.sucursalId;

    // Sin usuario (llamadas internas): solo el filtro explícito.
    if (!usuarioId) {
      if (targetAgencia) where.agenciaId = targetAgencia;
      return { where, sincroniza: false };
    }

    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, region: true, bodega: true, agencia: true },
    });
    const alcance = resolverAlcance(usuario);
    // La sincronización de alertas de insumos sin stock recorre varias sedes: solo la inicia quien ve varias.
    const sincroniza = alcance.tipo === 'GLOBAL' || alcance.tipo === 'REGION';

    switch (alcance.tipo) {
      case 'GLOBAL':
        // Nacional: todo (con filtro opcional por agencia).
        if (targetAgencia) where.agenciaId = targetAgencia;
        break;
      case 'REGION': {
        // Alertas de las agencias de la región y de los kits de los pulidores de la región.
        const agIds = (await this.prisma.agencia.findMany({ where: { regionId: alcance.regionId }, select: { id: true } })).map((a) => a.id);
        const pulIds = (
          await this.prisma.user.findMany({ where: { regionId: alcance.regionId, role: { namerol: { in: ['PULIDOR'] } } }, select: { id: true } })
        ).map((p) => p.id);
        const orScope: any[] = [];
        if (targetAgencia) {
          if (agIds.includes(targetAgencia)) orScope.push({ agenciaId: targetAgencia });
        } else if (agIds.length > 0) {
          orScope.push({ agenciaId: { in: agIds } });
        }
        if (pulIds.length > 0) orScope.push({ pulidorId: { in: pulIds } });
        if (orScope.length > 0) where.OR = orScope;
        else where.agenciaId = '__SIN_ALCANCE_REGION__';
        break;
      }
      case 'AGENCIA':
        where.agenciaId = alcance.agenciaId;
        break;
      case 'PROPIO':
        // Solo lo suyo: las alertas de su propio kit.
        where.pulidorId = alcance.userId;
        break;
      default:
        // Le falta el dato de su ámbito (agencia o región): no ve alertas ajenas.
        where.agenciaId = '__SIN_ALCANCE__';
    }
    return { where, sincroniza };
  }

  /**
   * Genera las alertas de "insumo requerido por un servicio asignado y sin stock" para todas las sedes y kits.
   * Es un trabajo de escritura (crea filas de stock en cero y alertas), por eso NO se hace al listar en modo paginado:
   * la web lo pide aparte. Solo lo ejecutan los roles que ven alertas de varias sedes y, salvo `forzar`, como máximo
   * una vez cada 2 minutos.
   */
  async sincronizarAlertas(usuarioId: string, forzar = false): Promise<{ sincronizado: boolean }> {
    const { sincroniza } = await this.alcanceAlertas({} as ListAlertasDto, usuarioId);
    if (!sincroniza) return { sincronizado: false };
    const ahora = Date.now();
    if (!forzar && ahora - this.ultimaSincronizacionAlertas < InventarioService.INTERVALO_SINCRONIZACION_ALERTAS_MS) {
      return { sincronizado: false };
    }
    this.ultimaSincronizacionAlertas = ahora; // se marca al empezar para que dos peticiones seguidas no dupliquen el trabajo
    await this.sincronizarNecesidadesAsignadas(usuarioId);
    return { sincronizado: true };
  }

  /**
   * Bandeja de alertas. Sin `page` ni `pageSize` responde un arreglo (hasta 100) y, como siempre, sincroniza antes las
   * necesidades sin stock (ahora como máximo cada 2 minutos). Con alguno responde una página con orden, búsqueda y
   * filtros en el servidor y NO escribe nada en la base.
   */
  async listAlertas(dto: ListAlertasDto, usuarioId?: string) {
    const paginado = esConsultaPaginada(dto);
    const { where: alcance, sincroniza } = await this.alcanceAlertas(dto, usuarioId);

    const incluir = {
      insumo: { select: { codigoSKU: true, nombre: true, categoria: true } },
      agencia: { select: { codigo: true, nombre: true, region: true } },
      pulidor: { select: { id: true, name: true, lastname: true } },
      usuarioEmisor: { select: { name: true, lastname: true } },
    };
    const filtros = (sinEstadoNiNivel = false) => combinarWhere(
      !sinEstadoNiNivel && dto.nivel ? { nivel: dto.nivel } : undefined,
      !sinEstadoNiNivel && dto.grupoNivel ? { nivel: { in: dto.grupoNivel === 'CRITICO' ? ['CRITICO', 'AGOTADO'] : ['BAJO'] } } : undefined,
      !sinEstadoNiNivel && dto.estado ? { estado: dto.estado } : undefined,
      !sinEstadoNiNivel && dto.soloActivas ? { estado: { not: 'RESUELTO' } } : undefined,
      !sinEstadoNiNivel && dto.pulidorId ? { pulidorId: dto.pulidorId } : undefined,
    );

    if (!paginado) {
      if (sincroniza && usuarioId) await this.sincronizarAlertas(usuarioId);
      return this.prisma.alertaStock.findMany({
        where: combinarWhere(alcance, filtros()) as any,
        orderBy: [{ nivel: 'asc' }, { createdAt: 'desc' }],
        take: PAGE_SIZE_MAX,
        include: incluir,
      });
    }

    const { page, pageSize, skip, take } = resolverPaginacion(dto);
    const busqueda = whereBusqueda(
      ['insumo.nombre', 'insumo.codigoSKU', 'agencia.nombre', 'agencia.codigo', 'agencia.region', 'pulidor.name', 'pulidor.lastname', 'mensaje'],
      dto.search,
    );
    const where = combinarWhere(alcance, filtros(), busqueda) as any;
    const orderBy = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_ALERTAS, { campo: 'fecha', dir: 'desc' });

    const [items, total, resumen] = await Promise.all([
      this.prisma.alertaStock.findMany({ where, orderBy: orderBy as any, skip, take, include: incluir }),
      this.prisma.alertaStock.count({ where }),
      dto.incluirResumen
        ? this.resumenAlertas(combinarWhere(alcance, busqueda) as any)
        : Promise.resolve(undefined),
    ]);
    const respuesta = buildDataGridResponse(items, total, page, pageSize);
    return resumen ? { ...respuesta, resumen } : respuesta;
  }

  /** Contadores de la bandeja con el alcance y la búsqueda vigentes (sin los filtros de nivel ni de estado). */
  private async resumenAlertas(where: any) {
    const [total, resueltas, criticas] = await Promise.all([
      this.prisma.alertaStock.count({ where }),
      this.prisma.alertaStock.count({ where: combinarWhere(where, { estado: 'RESUELTO' }) as any }),
      this.prisma.alertaStock.count({
        where: combinarWhere(where, { estado: { not: 'RESUELTO' }, nivel: { in: ['CRITICO', 'AGOTADO'] } }) as any,
      }),
    ]);
    return { total, resueltas, activas: total - resueltas, criticas };
  }

  async atenderAlerta(dto: AtenderAlertaDto, user?: any) {
    const alerta = await this.prisma.alertaStock.findUnique({ where: { id: dto.id } });
    if (!alerta) throw new NotFoundException(`Alerta con ID "${dto.id}" no encontrada`);
    if (user) {
      const a = resolverAlcance(user);
      if (a.tipo === 'AGENCIA' || (alerta.agenciaId && a.tipo === 'REGION')) {
        await this.agenciaEnAlcance(user, alerta.agenciaId || undefined);
      } else if (a.tipo !== 'GLOBAL' && a.tipo !== 'REGION') {
        throw new ForbiddenException('Tu usuario no tiene alcance para atender alertas.');
      }
    }

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

  async listKardex(dto: ListKardexDto, usuarioId?: string) {
    // Un cliente que no envía tamaño de página recibe hasta 100 filas (antes 20); pedir más de 100 se recorta.
    const sinTamano = dto.pageSize === undefined || dto.pageSize === null;
    const { page, pageSize, skip, take } = resolverPaginacion(dto, sinTamano ? { defecto: 100 } : {});

    const extra: Record<string, unknown> = {};
    if (dto.insumoId) extra.insumoId = dto.insumoId;
    if (dto.ubicacionId) extra.ubicacionId = dto.ubicacionId;
    if (dto.tipoMovimiento) extra.tipoMovimiento = dto.tipoMovimiento;
    const desde = fechaFiltro(dto.fechaDesde);
    const hasta = fechaFiltro(dto.fechaHasta, true);
    if (desde || hasta) extra.fecha = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };

    const busqueda = whereBusqueda(
      ['insumo.nombre', 'insumo.codigoSKU', 'tipoMovimiento', 'referenciaId', 'ubicacionId', 'usuario.name', 'usuario.lastname'],
      dto.search,
    );
    // Mismo alcance por ubicación que `movimientos/globales` (ver `resolverFiltroUbicacionKardex`): un asistente de
    // bodega no ve el Kardex de otras bodegas. El campo "quién lo registró" aquí es `usuarioId` (no `responsableId`).
    const scope = await this.resolverFiltroUbicacionKardex(usuarioId);
    const where = this.aplicarFiltroUbicacionKardex(combinarWhere(extra, busqueda) as any, scope, 'usuarioId');
    const orderBy = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_KARDEX, { campo: 'fecha', dir: 'desc' });

    // Si el rango toca datos ya archivados, se suman a los de la base con el mismo filtro, búsqueda, alcance y orden. Si no, la
    // consulta es exactamente la de siempre.
    const { campo: campoOrden, dir: dirOrden } = resolverCampoOrden(dto.sortField, dto.sortOrder, ORDEN_KARDEX, { campo: 'fecha', dir: 'desc' });
    const kardexArchivo = this.historico ? new KardexArchivo(this.prisma, this.historico) : null;
    const archivado = kardexArchivo ? await kardexArchivo.consultar({ dto, alcance: scope, desde, hasta, campo: campoOrden, dir: dirOrden, skip, take }) : null;

    const [itemsBase, totalBase] = await Promise.all([
      this.prisma.kardexMovimiento.findMany({
        where: where as any,
        // Con archivo, la página se arma mezclando: de la base hacen falta las primeras `skip + take` filas.
        skip: archivado ? 0 : skip,
        take: archivado ? skip + take : take,
        orderBy: orderBy as any,
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
      this.prisma.kardexMovimiento.count({ where: where as any }),
    ]);
    const items = archivado && kardexArchivo ? kardexArchivo.mezclar(itemsBase as any[], archivado.filas, campoOrden, dirOrden, skip, take) : itemsBase;
    const total = totalBase + (archivado?.total ?? 0);

    // El id de la ubicación no le dice nada a la app: se expone también su nombre (agencia o bodega).
    const nombresPorId = await this.resolverEtiquetasUbicacion(items.map((i: any) => i.ubicacionId));
    const itemsConUbicacion = items.map((i: any) => ({ ...i, ubicacionNombre: nombresPorId.get(i.ubicacionId) ?? null }));

    return buildDataGridResponse(itemsConUbicacion, total, page, pageSize);
  }

  // ============================================================
  //  PRESENTACIONES DEL PRODUCTO (Catálogo Dinámico por Insumo)
  // ============================================================

  async listPresentaciones(dto: ListPresentacionesDto) {
    const where = combinarWhere(
      dto.insumoId ? { insumoId: dto.insumoId } : undefined,
      dto.estado !== undefined ? { estado: dto.estado } : undefined,
      whereBusqueda(['nombre', 'insumo.nombre', 'insumo.codigoSKU'], dto.search),
    );
    return this.listarPaginable(dto, {
      where,
      columnas: ORDEN_PRESENTACIONES,
      ordenHeredado: [{ nombre: 'asc' }],
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.presentacionInsumo.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: {
            unidad: { select: { id: true, codigo: true, nombre: true, simbolo: true } },
            insumo: { select: { id: true, codigoSKU: true, nombre: true } },
          },
        }),
      contar: (w) => this.prisma.presentacionInsumo.count({ where: w }),
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
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "evidenciasUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`,
      );
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "stockUbicacionId" TEXT`,
      );
      await this.prisma.$executeRawUnsafe(
        `ALTER TABLE "MovimientoInventarioGlobal" ADD COLUMN IF NOT EXISTS "cantidadContada" DECIMAL(12,4)`,
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
    return (await this.resolverEtiquetasUbicacion([id])).get(id) ?? null;
  }

  /**
   * Igual que `resolverEtiquetaUbicacion` pero para muchos ids a la vez: 1-2 consultas en lote en vez de hasta 3
   * por id (bodegas, luego agencias). Pensado para listas paginadas (kardex, movimientos) donde antes se resolvía
   * cada fila por separado y multiplicaba los viajes a la base de datos.
   */
  private async resolverEtiquetasUbicacion(ubicacionIds: (string | null | undefined)[]): Promise<Map<string, string | null>> {
    const idsUnicos = [...new Set(ubicacionIds.map((v) => (v || '').toString().trim()).filter(Boolean))];
    const resultado = new Map<string, string | null>();
    if (idsUnicos.length === 0) return resultado;

    // Alias legacy usado en KardexMovimiento / StockUbicacion
    const aliasCentral = idsUnicos.filter((id) => id === 'BODEGA_CENTRAL' || id === 'bod_central');
    const resto = idsUnicos.filter((id) => id !== 'BODEGA_CENTRAL' && id !== 'bod_central');

    if (aliasCentral.length > 0) {
      let etiqueta = 'Bodega Central Nacional (Central)';
      try {
        const central: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT b."nombre" FROM "bodegas" b
           WHERE b."tipo" = 'CENTRAL' OR b."esCentral" = true OR b."id" = 'bod_central' OR b."codigo" = 'BOD-CENTRAL'
           LIMIT 1`,
        );
        if (central.length > 0) etiqueta = `${central[0].nombre} (Central)`;
      } catch (_) {}
      for (const id of aliasCentral) resultado.set(id, etiqueta);
    }

    if (resto.length > 0) {
      try {
        const bodRows: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT b."id", b."nombre", b."tipo", b."esCentral", r."nombre" as "regionNombre"
           FROM "bodegas" b
           LEFT JOIN "Region" r ON b."regionId" = r."id"
           WHERE b."id" = ANY($1::text[])`,
          resto,
        );
        for (const b of bodRows) {
          const esCentral = !!b.esCentral || b.tipo === 'CENTRAL';
          const sufijo = esCentral ? 'Central' : (b.regionNombre ? `Regional · ${b.regionNombre}` : 'Regional');
          resultado.set(String(b.id), `${b.nombre} (${sufijo})`);
        }
      } catch (_) {}

      const faltantes = resto.filter((id) => !resultado.has(id));
      if (faltantes.length > 0) {
        try {
          const agencias = await this.prisma.agencia.findMany({
            where: { id: { in: faltantes } },
            select: { id: true, nombre: true, codigo: true },
          });
          for (const ag of agencias) resultado.set(ag.id, `Agencia ${ag.nombre}${ag.codigo ? ` [${ag.codigo}]` : ''}`);
        } catch (_) {}
      }

      for (const id of resto) if (!resultado.has(id)) resultado.set(id, id);
    }

    return resultado;
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
          evidenciasUrls: Array.isArray(dtoNorm.evidenciasUrls)
            ? dtoNorm.evidenciasUrls.map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u))
            : [],
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
    /** Además del alcance por ubicación, ve los movimientos que él mismo registró (p. ej. reajustes de agencias o pulidores). */
    responsableId?: string;
  }> {
    if (!usuarioId) return { mode: 'ALL' };

    const usuario = await this.prisma.user.findUnique({
      where: { id: usuarioId },
      include: { role: true, bodega: true },
    });
    const role = normalizarRol(usuario?.role?.namerol);

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
        responsableId: usuarioId,
      };
    }

    const isAsistente =
      role === 'ASISTENTE_BODEGA' ||
      (role.includes('ASISTENTE') && role.includes('BODEGA'));

    if (isAsistente) {
      const bodegaId = (usuario?.bodegaId || '').toString().trim();
      if (!bodegaId) return { mode: 'NONE' };
      return { mode: 'FILTER', ubicacionIds: [bodegaId], incluirSinUbicacion: false, responsableId: usuarioId };
    }

    // Otros roles con bodega asignada → solo esa bodega
    if (usuario?.bodegaId) {
      return { mode: 'FILTER', ubicacionIds: [String(usuario.bodegaId)], incluirSinUbicacion: false };
    }

    // El resto, según el ámbito de su rol: país ve todo; región, sus agencias y bodegas; agencia, la suya; propio, solo lo que registró.
    const alcance = resolverAlcance(usuario);
    if (alcance.tipo === 'GLOBAL') return { mode: 'ALL' };
    if (alcance.tipo === 'REGION') {
      const [agencias, bodegas] = await Promise.all([
        this.prisma.agencia.findMany({ where: { regionId: alcance.regionId }, select: { id: true } }),
        this.prisma.bodega.findMany({ where: { regionId: alcance.regionId }, select: { id: true } }),
      ]);
      return { mode: 'FILTER', ubicacionIds: [...agencias.map((x) => x.id), ...bodegas.map((x) => x.id)], incluirSinUbicacion: false, responsableId: usuarioId };
    }
    if (alcance.tipo === 'AGENCIA') {
      return { mode: 'FILTER', ubicacionIds: [alcance.agenciaId], incluirSinUbicacion: false, responsableId: usuarioId };
    }
    return { mode: 'FILTER', ubicacionIds: [], incluirSinUbicacion: false, responsableId: usuarioId };
  }

  /** `campoResponsable` es el nombre del campo "quién lo registró" en la tabla (`responsableId` en movimientos globales, `usuarioId` en el Kardex). */
  private aplicarFiltroUbicacionKardex(
    where: any,
    scope: { mode: 'ALL' | 'FILTER' | 'NONE'; ubicacionIds?: string[]; incluirSinUbicacion?: boolean; responsableId?: string },
    campoResponsable: string = 'responsableId',
  ): any {
    if (scope.mode === 'ALL') return where;
    if (scope.mode === 'NONE') {
      return { ...where, id: '__SIN_ACCESO_KARDEX__' };
    }

    const ids = scope.ubicacionIds || [];
    const alternativas: any[] = [{ ubicacionId: { in: ids } }];
    if (scope.incluirSinUbicacion) alternativas.push({ ubicacionId: null });
    if (scope.responsableId) alternativas.push({ [campoResponsable]: scope.responsableId });
    const ubicacionClause = { OR: alternativas };

    return {
      ...where,
      AND: [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), ubicacionClause],
    };
  }

  async listMovimientosGlobales(dto: ListMovimientosGlobalesDto, usuarioId?: string) {
    await this.ensureMovimientoGlobalRutaColumns();

    // Un cliente que no envía tamaño de página recibe hasta 100 filas (antes 20); pedir más de 100 se recorta.
    const sinTamano = dto.pageSize === undefined || dto.pageSize === null;
    const { page, pageSize, skip, take } = resolverPaginacion(dto, sinTamano ? { defecto: 100 } : {});
    const orderBy = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_MOVIMIENTOS_GLOBALES, { campo: 'fecha', dir: 'desc' });

    const extra: Record<string, unknown> = {};
    if (dto.insumoId) extra.insumoId = dto.insumoId;
    if (dto.ubicacionId) extra.ubicacionId = dto.ubicacionId;
    const desde = fechaFiltro(dto.fechaDesde);
    const hasta = fechaFiltro(dto.fechaHasta, true);
    if (desde || hasta) extra.fechaMovimiento = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };

    const busqueda = whereBusqueda(
      [
        'numeroComprobante',
        'referencia',
        'observaciones',
        'origenUbicacion',
        'destinoUbicacion',
        'insumo.nombre',
        'insumo.codigoSKU',
        'tipoMovimiento.nombre',
        'motivo.nombre',
        'responsable.name',
        'responsable.lastname',
      ],
      dto.search,
    );

    // El alcance por ubicación según el rol se aplica igual que antes; el tipo va aparte para el resumen por tipo.
    const scope = await this.resolverFiltroUbicacionKardex(usuarioId);
    const whereSinTipo = this.aplicarFiltroUbicacionKardex(combinarWhere(extra, busqueda) as any, scope);
    const where: any = dto.tipoMovimientoId
      ? combinarWhere(whereSinTipo, { tipoMovimientoId: dto.tipoMovimientoId })
      : whereSinTipo;

    // Si el rango toca datos ya archivados, se suman a los de la base con el mismo alcance, filtros, búsqueda y orden. Si no, la
    // consulta es exactamente la de siempre.
    const { campo: campoOrden, dir: dirOrden } = resolverCampoOrden(dto.sortField, dto.sortOrder, ORDEN_MOVIMIENTOS_GLOBALES, { campo: 'fecha', dir: 'desc' });
    const globalesArchivo = this.historico ? new MovimientosGlobalesArchivo(this.prisma, this.historico) : null;
    const archivado = globalesArchivo ? await globalesArchivo.consultar({ dto, alcance: scope, desde, hasta, campo: campoOrden, dir: dirOrden, skip, take }) : null;

    const [itemsBase, totalBase] = await Promise.all([
      this.prisma.movimientoInventarioGlobal.findMany({
        where,
        // Con archivo, la página se arma mezclando: de la base hacen falta las primeras `skip + take` filas.
        skip: archivado ? 0 : skip,
        take: archivado ? skip + take : take,
        orderBy: orderBy as any,
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
    const items = archivado && globalesArchivo ? globalesArchivo.mezclar(itemsBase as any[], archivado.filas, campoOrden, dirOrden, skip, take) : itemsBase;
    const total = totalBase + (archivado?.total ?? 0);

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
      // Las filas archivadas ya no están en la base: su ruta guardada viene en la propia fila.
      for (const i of items as any[]) {
        if (!rutaById.has(i.id)) rutaById.set(i.id, { origen: i.origenUbicacion, destino: i.destinoUbicacion });
      }
    }

    const ubicacionLabelById = new Map<string, string>(
      [...(await this.resolverEtiquetasUbicacion(items.map((i) => i.ubicacionId)))].filter(
        (par): par is [string, string] => par[1] != null,
      ),
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

    const respuesta: Record<string, unknown> = { ...buildDataGridResponse(enriched, total, page, pageSize) };

    if (dto.incluirResumen) {
      const porTipoRows = await this.prisma.movimientoInventarioGlobal.groupBy({
        by: ['tipoMovimientoId'],
        where: whereSinTipo as any,
        _count: { _all: true },
      });
      const porTipo: Record<string, number> = {};
      let totalResumen = 0;
      for (const fila of porTipoRows) {
        porTipo[fila.tipoMovimientoId] = fila._count._all;
        totalResumen += fila._count._all;
      }
      // Lo archivado también cuenta en el resumen.
      const porTipoArchivado = globalesArchivo ? await globalesArchivo.resumen({ dto, alcance: scope, desde, hasta }) : null;
      for (const [tipo, n] of Object.entries(porTipoArchivado ?? {})) {
        porTipo[tipo] = (porTipo[tipo] ?? 0) + n;
        totalResumen += n;
      }
      respuesta['resumen'] = { porTipo, total: totalResumen };
    }

    return respuesta;
  }

  async obtenerResumenDashboard(usuarioId?: string) {
    if (!this.cache) return this.calcularResumenDashboard(usuarioId);
    return this.cache.obtenerOCalcular(`inventario:dashboard-resumen:${usuarioId ?? 'global'}`, 45, () => this.calcularResumenDashboard(usuarioId));
  }

  private async calcularResumenDashboard(usuarioId?: string) {
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

  /**
   * Insumos activos con stock por debajo (o igual) al mínimo de bodega. El filtro y el conteo se hacen en la base de datos
   * (antes se traían todos los insumos y se cortaba en memoria). Sin page/pageSize: primera página de 100.
   */
  async listStockBajo(dto: ListStockBajoDto) {
    const { page, pageSize, skip, take } = resolverPaginacion(dto, { defecto: PAGE_SIZE_MAX });

    const params: unknown[] = [];
    const p = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    const cond: string[] = [`i."estado" = 1`, `i."stockActual" <= i."stockMinimoBodega"`];
    if (dto.tipoProductoId) cond.push(`i."tipoProductoId" = ${p(dto.tipoProductoId)}`);
    const texto = textoBusqueda(dto.search);
    for (const palabra of texto ? texto.split(' ').slice(0, 5) : []) {
      const n = p(patronContiene(palabra));
      cond.push(`(i."nombre" ILIKE ${n} OR i."codigoSKU" ILIKE ${n} OR i."descripcion" ILIKE ${n})`);
    }
    const desde = `FROM "Insumo" i LEFT JOIN "TipoProducto" tp ON tp."id" = i."tipoProductoId" WHERE ${cond.join(' AND ')}`;
    const orden = resolverOrdenSql(dto.sortField, dto.sortOrder, ORDEN_STOCK_BAJO_SQL, { campo: 'stock', dir: 'asc' }, 'i."id"');
    const nLimite = params.length + 1;

    const [filas, conteo] = await Promise.all([
      this.prisma.$queryRawUnsafe(
        `SELECT i."id" ${desde} ORDER BY ${orden} LIMIT $${nLimite} OFFSET $${nLimite + 1}`,
        ...params,
        take,
        skip,
      ) as Promise<any[]>,
      this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS "total" ${desde}`, ...params) as Promise<any[]>,
    ]);

    const ids = filas.map((f) => String(f.id));
    const completos = ids.length
      ? await this.prisma.insumo.findMany({
          where: { id: { in: ids } },
          include: { tipoProducto: true, unidadMedida: true },
        })
      : [];
    const porId = new Map(completos.map((i) => [i.id, i]));
    const items = ids.map((id) => porId.get(id)).filter((i): i is NonNullable<typeof i> => !!i);

    return buildDataGridResponse(items, Number(conteo?.[0]?.total ?? 0), page, pageSize);
  }

  // ==============================================================
  // INSUMOS POR SERVICIOS DE AGENCIA (LÍDER OPERADOR) & CONSUMO
  // ==============================================================

  async obtenerInsumosServiciosAgencia(agenciaId: string, servicioIds?: number[], paginacion?: InsumosServiciosDto) {
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
      const cNeto = Number(insumo.contenidoNeto) || 1;
      const isLiquidOrPowder = insumo.unidadMedida?.simbolo === 'ml' || insumo.unidadMedida?.simbolo === 'g';
      let rawStockMin = stockMinimoPorInsumo.get(insumo.id) ?? Number(insumo.stockMinimoAgencia ?? 2);
      const stockMinimo = isLiquidOrPowder && cNeto > 1 && rawStockMin < cNeto
        ? rawStockMin * cNeto
        : rawStockMin;
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
        alertas.push(`${insumo.nombre}: AGOTADO (${stockActual} ${unidad}). Afecta ${servicios.length} servicios.`);
      } else if (stockActual <= stockMinimo) {
        estado = 'BAJO';
        insumosBajoMinimo++;
        mensajeAlerta = `Stock bajo mínimo (${stockActual.toFixed(2)} de ${stockMinimo} ${unidad}). Reabastecer pronto.`;
        alertas.push(`${insumo.nombre}: Stock bajo (${stockActual.toFixed(2)} ${unidad} restantes).`);
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
        stockOptimoAgencia: Number((insumo as any).stockOptimoAgencia ?? 5),
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

    return this.paginarInsumosServicios({
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
    }, paginacion);
  }

  /**
   * Página (o tope de 100 en modo heredado) de los insumos ya calculados de una agencia o un kit. El resumen y el resto de la
   * respuesta no cambian: cuentan todos los insumos aunque la página sea una parte.
   */
  private paginarInsumosServicios<T extends { insumos: any[] }>(respuesta: T, dto?: InsumosServiciosDto): T {
    if (!dto || !esConsultaPaginada(dto)) return { ...respuesta, insumos: respuesta.insumos.slice(0, PAGE_SIZE_MAX) };
    const pag = resolverPaginacion(dto);
    const estado = dto.estado ? normalizarTexto(dto.estado) : null;
    const filtrados = respuesta.insumos.filter(
      (i) =>
        (!estado || normalizarTexto(i.estado) === estado) &&
        coincidePalabras(dto.search, [i.codigoSKU, i.nombre, i.tipoProducto, ...(i.serviciosAsociados ?? []).map((s: any) => s.nombre)]),
    );
    const ordenados = ordenarFilas(filtrados, dto.sortField, dto.sortOrder, COLUMNAS_INSUMO_SERVICIO, { campo: 'nombre', dir: 'asc' }, (i) => i.id);
    const items = paginarLista(ordenados, pag);
    return { ...respuesta, ...buildDataGridResponse(items, filtrados.length, pag.page, pag.pageSize), insumos: items };
  }

  /**
   * Insumos requeridos por los servicios asignados a un pulidor (móvil o fijo)
   * con stock real de su kit personal (StockUbicacion.pulidorId).
   */
  async obtenerInsumosServiciosPulidor(pulidorId: string, servicioIdsOverride?: number[], paginacion?: InsumosServiciosDto) {
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
        alertas.push(`${insumo.nombre}: AGOTADO. Afecta ${servicios.length} servicio(s).`);
      } else if (stockActual <= stockMinimo) {
        estado = 'BAJO';
        insumosBajoMinimo++;
        mensajeAlerta = `Stock bajo mínimo (${stockActual.toFixed(2)} de ${stockMinimo} ${unidad}).`;
        alertas.push(`${insumo.nombre}: Stock bajo (${stockActual.toFixed(2)} ${unidad}).`);
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
        stockOptimoAgencia: Number((insumo as any).stockOptimoAgencia ?? 5),
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

    return this.paginarInsumosServicios({
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
    }, paginacion);
  }
}
