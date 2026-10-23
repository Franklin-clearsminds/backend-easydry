import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional, Logger } from '@nestjs/common';
import { validarLavadoresDeLaOT } from './lavadores-bahia.js';
import { validarAgregarServicioAOT } from './retoque.js';
import { tieneAlgunPermiso, tienePermiso } from '../../common/permisos/capacidades.js';
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
import { ListConsumosServicioDto } from './dto/consumos-servicio.dto.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import {
  columnasSimples,
  combinarWhere,
  resolverCampoOrden,
  resolverOrden,
  resolverPaginacion,
  whereBusqueda,
} from '../../common/utils/data-grid.helpers.js';
import { serializeServicioLavado } from '../../common/utils/servicio-serializer.util.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ServiciosArchivo } from './servicios-archivo.js';
import { ConsumosArchivo } from './consumos-archivo.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { Alcance, puedeSobreAgencia, resolverAlcance } from '../../common/permisos/alcance.js';
import { esLiderDeAgencia, ROLES_LIDER_AGENCIA, rolDeUsuario } from '../../common/permisos/alias-roles.js';

/** Datos del vehículo y del cliente que corrige «Editar OT» (valen para todos los servicios de la misma OT). */
const CAMPOS_EDITABLES_OT = ['placa', 'marca', 'modelo', 'color', 'cliente'] as const;
/** Finalizar una OT: solo «Finalizar OT» (registrar, editar, finalizar y anular son cuatro casillas distintas). */
const PERMISOS_FINALIZAR_OT = ['servicios.generales.finalizar'];

/** Columnas por las que se puede ordenar la lista de servicios (nombre público → campo de la base). */
const ORDEN_SERVICIOS = columnasSimples({
  fecha: 'horaIngreso',
  createdAt: 'createdAt',
  ot: 'ordenTrabajoOT',
  placa: 'placa',
  modelo: 'modelo',
  cliente: 'cliente',
  estado: 'estado',
  precio: 'precio',
  servicio: 'catalogo.nombre',
  operador: 'operador.name',
  agencia: 'bahia.agencia.nombre',
  bahia: 'bahia.nombre',
});

@Injectable()
export class OperacionesService {
  private readonly logger = new Logger(OperacionesService.name);

  private readonly decisiones: DecisionesService;

  constructor(
    private prisma: PrismaService,
    @Optional() private notifications?: NotificationsService,
    @Optional() decisiones?: DecisionesService,
    /** Suma al listado de servicios lo que ya se archivó a Parquet. Sin él, el listado lee solo de la base. */
    @Optional() private historico?: HistoricoService,
  ) {
    this.decisiones = decisiones ?? new DecisionesService(prisma);
  }

  /** Nombre visible de quien decide, tomado de la sesión. */
  private nombreDe(user: any): string {
    return [user?.name, user?.lastname].filter(Boolean).join(' ').trim() || user?.email || 'Usuario';
  }

  /** El servicio debe estar dentro del alcance del usuario (agencia, región o lo propio). */
  private asegurarAlcanceServicio(actor: any, servicio: any): void {
    if (!actor) return;
    const alcance: Alcance = resolverAlcance(actor);
    if (alcance.tipo === 'PROPIO') {
      if (
        servicio.operadorId === actor.id ||
        servicio.operadoresAsignados?.some((asignacion: any) => asignacion.operadorId === actor.id)
      ) return;
    } else if (puedeSobreAgencia(alcance, { id: servicio.bahia?.agencia?.id ?? servicio.bahia?.agenciaId, regionId: servicio.bahia?.agencia?.regionId })) {
      return;
    }
    throw new ForbiddenException('Este servicio no pertenece a tu alcance.');
  }

  // ============================================================
  //  SERVICIOS DE LAVADO
  // ============================================================

  async findAll(params?: {
    agenciaId?: string;
    sucursalId?: string;
    regionId?: string;
    estado?: string | ServiceStatus;
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortOrder?: 'asc' | 'desc';
    bahiaId?: string;
    operadorId?: string;
    servicioId?: number;
    clienteId?: string;
    agenciaNombre?: string;
    bahiaNombre?: string;
    operadorNombre?: string;
    clienteNombre?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    incluirResumen?: boolean;
  }, currentUser?: any) {
    const where: any = {
      deletedAt: null,
    };

    // 1. Alcance del usuario (regla única): país, región, agencia o lo propio. Sin usuario o sin dato de su ámbito no ve nada.
    //    Nunca se toma una agencia o región del cliente para ampliar el alcance: solo para acotar dentro de él.
    const alcance: Alcance = currentUser ? resolverAlcance(currentUser) : { tipo: 'NINGUNO' };
    let operadorPropioId: string | undefined;
    const pideAgencia = [params?.agenciaId, params?.sucursalId].find((v) => v && v !== 'Todas' && v !== 'TODAS');
    const pideRegion = params?.regionId && params.regionId !== 'Todas' && params.regionId !== 'TODAS' ? params.regionId : undefined;
    switch (alcance.tipo) {
      case 'GLOBAL':
        if (pideAgencia) where.bahia = { agenciaId: pideAgencia };
        else if (pideRegion) where.bahia = { agencia: { regionId: pideRegion } };
        break;
      case 'REGION':
        where.bahia = { agencia: { regionId: alcance.regionId, ...(pideAgencia ? { id: pideAgencia } : {}) } };
        break;
      case 'AGENCIA':
        where.bahia = { agenciaId: alcance.agenciaId };
        break;
      case 'PROPIO':
        operadorPropioId = currentUser.id;
        break;
      default:
        where.id = { in: [] };
    }

    // 2. Filtro por Estado Operativo
    if (params?.estado && params.estado !== 'Todos' && params.estado !== 'TODOS') {
      const st = String(params.estado).toUpperCase().trim();
      if (st === 'EN_PROCESO' || st === 'EN PROCESO') {
        where.estado = { in: [ServiceStatus.EN_ESPERA, ServiceStatus.EN_PROCESO] };
      } else if (st === 'POR_APROBAR' || st === 'POR APROBAR' || st === 'FALTAN DE APROBAR') {
        where.estado = ServiceStatus.FINALIZADO;
        where.aprobadoPor = null;
      } else if (st === 'APROBADO' || st === 'APROBADOS') {
        where.estado = ServiceStatus.APROBADO;
      } else if (st === 'FINALIZADO' || st === 'REALIZADO' || st === 'REALIZADOS') {
        where.estado = { in: [ServiceStatus.FINALIZADO, ServiceStatus.APROBADO] };
      } else if (st === 'RECHAZADO' || st === 'RECHAZADOS') {
        where.estado = ServiceStatus.RECHAZADO;
      } else if (st === 'CANCELADO' || st === 'CANCELADOS') {
        where.estado = ServiceStatus.CANCELADO;
      } else if (Object.values(ServiceStatus).includes(st as ServiceStatus)) {
        where.estado = st as ServiceStatus;
      }
    }

    // 3. Filtros adicionales: todos se resuelven en el servidor (antes la web los aplicaba sobre lo que ya había cargado)
    const extra: Record<string, unknown>[] = [];
    if (params?.bahiaId) {
      // Acepta varios ids separados por coma: las bahías se llaman igual en varias agencias ("Bahía 1").
      const ids = String(params.bahiaId).split(',').map((v) => v.trim()).filter(Boolean);
      if (ids.length === 1) extra.push({ bahiaId: ids[0] });
      else if (ids.length > 1) extra.push({ bahiaId: { in: ids } });
    }
    if (params?.servicioId !== undefined && params?.servicioId !== null && String(params.servicioId) !== '') {
      const catalogoId = Number(params.servicioId);
      if (Number.isInteger(catalogoId)) extra.push({ servicioCatalogoId: catalogoId });
    }
    if (params?.clienteId) extra.push({ bahia: { agencia: { clienteId: params.clienteId } } });
    // Filtros por nombre (exactos, sin distinguir mayúsculas); el alcance por rol de arriba se mantiene.
    const igual = (valor: string) => ({ equals: valor.trim(), mode: 'insensitive' as const });
    if (params?.agenciaNombre?.trim()) extra.push({ bahia: { agencia: { nombre: igual(params.agenciaNombre) } } });
    if (params?.bahiaNombre?.trim()) extra.push({ bahia: { nombre: igual(params.bahiaNombre) } });
    if (params?.clienteNombre?.trim()) extra.push({ bahia: { agencia: { cliente: { nombre: igual(params.clienteNombre) } } } });
    const operadorNombre = whereBusqueda(['operador.name', 'operador.lastname'], params?.operadorNombre);
    if (operadorNombre) extra.push(operadorNombre);
    // Un lavador ya está limitado a sus propios servicios: no puede pedir los de otro operador.
    const operadorFiltro = operadorPropioId || params?.operadorId;
    if (operadorFiltro) {
      extra.push({
        OR: [
          { operadorId: operadorFiltro },
          { operadoresAsignados: { some: { operadorId: operadorFiltro } } },
        ],
      });
    }

    // Una fecha sola (AAAA-MM-DD) es un día de Ecuador (UTC-5): «desde» abre a las 00:00 y «hasta» incluye todo ese día.
    const instanteEc = (valor: string | undefined, finDeDia: boolean): Date | null => {
      if (!valor) return null;
      return new Date(/^\d{4}-\d{2}-\d{2}$/.test(valor) ? `${valor}T${finDeDia ? '23:59:59.999' : '00:00:00.000'}-05:00` : valor);
    };
    const desde = instanteEc(params?.fechaDesde, false);
    const hasta = instanteEc(params?.fechaHasta, true);
    const rangoFechas = {
      ...(desde && !Number.isNaN(desde.getTime()) ? { gte: desde } : {}),
      ...(hasta && !Number.isNaN(hasta.getTime()) ? { lte: hasta } : {}),
    };
    if (Object.keys(rangoFechas).length) extra.push({ horaIngreso: rangoFechas });

    const busqueda = whereBusqueda(
      ['placa', 'modelo', 'marca', 'cliente', 'ordenTrabajoOT', 'catalogo.nombre', 'operador.name', 'operador.lastname'],
      params?.search,
    );

    // Estado aparte: el resumen por estado usa los mismos filtros pero sin el de estado.
    const { estado: estadoFiltrado, aprobadoPor: aprobadoPorFiltrado, ...whereSinEstado } = where;
    const whereBase = combinarWhere(whereSinEstado, ...extra, busqueda);
    const whereFinal = combinarWhere(
      whereBase,
      estadoFiltrado !== undefined || aprobadoPorFiltrado !== undefined
        ? {
            ...(estadoFiltrado !== undefined ? { estado: estadoFiltrado } : {}),
            ...(aprobadoPorFiltrado !== undefined ? { aprobadoPor: aprobadoPorFiltrado } : {}),
          }
        : undefined,
    );

    // 4. Paginación y orden. Un cliente antiguo que no envía tamaño de página recibe hasta 100 (antes, 20).
    const sinTamano = params?.pageSize === undefined || params?.pageSize === null;
    const { page, pageSize, skip, take } = resolverPaginacion(params ?? {}, sinTamano ? { defecto: 100 } : {});
    const orderBy = resolverOrden(params?.sortField, params?.sortOrder, ORDEN_SERVICIOS, { campo: 'fecha', dir: 'desc' });

    // Si el rango toca datos ya archivados, se suman a los de la base con el mismo alcance, filtros, búsqueda y orden. Si no, la
    // consulta es exactamente la de siempre.
    const { campo: campoOrden, dir: dirOrden } = resolverCampoOrden(params?.sortField, params?.sortOrder, ORDEN_SERVICIOS, { campo: 'fecha', dir: 'desc' });
    const serviciosArchivo = this.historico ? new ServiciosArchivo(this.prisma, this.historico) : null;
    const archivado = serviciosArchivo ? await serviciosArchivo.consultar({ params: params ?? {}, alcance, usuarioId: currentUser?.id, campo: campoOrden, dir: dirOrden, skip, take }) : null;

    const [itemsBase, totalBase] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: whereFinal,
        // Con archivo, la página se arma mezclando: de la base hacen falta las primeras `skip + take` filas.
        skip: archivado ? 0 : skip,
        take: archivado ? skip + take : take,
        orderBy: orderBy as any,
        include: {
          bahia: {
            include: {
              agencia: {
                select: { id: true, nombre: true, codigo: true, regionId: true },
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
          operadoresAsignados: {
            include: { operador: { select: { id: true, name: true, lastname: true, email: true } } },
          },
        },
      }),
      this.prisma.servicioLavado.count({ where: whereFinal }),
    ]);
    const items = archivado && serviciosArchivo ? serviciosArchivo.mezclar(itemsBase as any[], archivado.filas, campoOrden, dirOrden, skip, take) : itemsBase;
    const total = totalBase + (archivado?.total ?? 0);

    // A cada servicio finalizado se le marca si quien consulta puede decidirlo ahora (aprobar o rechazar) y si su agencia tiene
    // aprobador designado: así la pantalla de aprobaciones muestra solo acciones que el servidor aceptaría.
    let serializados: any[] = items.map(serializeServicioLavado);
    const finalizados = items.filter((s: any) => s.estado === ServiceStatus.FINALIZADO && !s.deletedAt);
    if (finalizados.length && currentUser) {
      const conAprobador = await this.decisiones.agenciasConAprobador(finalizados.map((s: any) => s.bahia?.agencia?.id));
      serializados = serializados.map((s, i) => {
        const bruto: any = items[i];
        if (bruto.estado !== ServiceStatus.FINALIZADO || bruto.deletedAt) return s;
        const agencia = bruto.bahia?.agencia;
        const tiene = conAprobador.has(String(agencia?.id));
        return {
          ...s,
          agenciaSinAprobador: !tiene,
          puedeDecidir: this.decisiones.puedeDecidirAhora(currentUser, { id: agencia?.id, regionId: agencia?.regionId }, tiene),
        };
      });
    }
    const respuesta: Record<string, unknown> = { ...buildDataGridResponse(serializados, total, page, pageSize) };

    if (params?.incluirResumen) {
      const [porEstado, porAprobar] = await Promise.all([
        this.prisma.servicioLavado.groupBy({ by: ['estado'], where: whereBase, _count: { _all: true } }),
        this.prisma.servicioLavado.count({
          where: combinarWhere(whereBase, { estado: ServiceStatus.FINALIZADO, aprobadoPor: null }),
        }),
      ]);
      const conteo: Record<string, number> = {};
      let totalResumen = 0;
      for (const fila of porEstado) {
        conteo[fila.estado] = fila._count._all;
        totalResumen += fila._count._all;
      }
      // Lo archivado (decidido: aprobado, rechazado o cancelado) también cuenta en el resumen.
      const porEstadoArchivado = serviciosArchivo ? await serviciosArchivo.resumen({ params: params ?? {}, alcance, usuarioId: currentUser?.id }) : null;
      for (const [estado, n] of Object.entries(porEstadoArchivado ?? {})) {
        conteo[estado] = (conteo[estado] ?? 0) + n;
        totalResumen += n;
      }
      respuesta['resumen'] = { porEstado: conteo, porAprobar, total: totalResumen };
    }

    return respuesta;
  }

  async findOneRaw(id: string) {
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
                insumo: {
                  select: {
                    id: true, codigoSKU: true, nombre: true, categoria: true, stockMinimoAgencia: true, costoUnitarioUSD: true,
                    unidadMedida: { select: { simbolo: true } },
                  },
                },
                unidadConsumo: { select: { codigo: true, simbolo: true, factorBase: true } },
              },
            },
          },
        },
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadoresAsignados: {
          include: { operador: { select: { id: true, name: true, lastname: true, email: true } } },
        },
        consumos: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
        evidencias: {
          orderBy: { tomadaEn: 'asc' },
        },
      },
    });

    if (!servicio) {
      throw new NotFoundException(`Servicio de lavado con ID ${id} no encontrado`);
    }

    return servicio;
  }

  /**
   * Para LEER un servicio: de la base y, si ya se archivó (más de 12 meses), del archivo. Las rutas que lo modifican siguen usando
   * `findOneRaw`, que solo mira la base: lo archivado es inmutable y para ellas "no existe".
   */
  private async leerServicio(id: string) {
    try {
      return await this.findOneRaw(id);
    } catch (e) {
      if (!(e instanceof NotFoundException) || !this.historico) throw e;
      const archivado = await new ServiciosArchivo(this.prisma, this.historico).detalle(id);
      if (!archivado) throw e;
      return archivado as Awaited<ReturnType<OperacionesService['findOneRaw']>>;
    }
  }

  async findOne(id: string, actor?: any) {
    const servicio = await this.leerServicio(id);
    this.asegurarAlcanceServicio(actor, servicio);
    return serializeServicioLavado(servicio);
  }

  /** Quién aprobó, rechazó, anuló o corrigió este servicio, con qué regla y por qué (del más reciente al más antiguo). */
  async historialDecisiones(id: string, actor: any) {
    const servicio = await this.leerServicio(id);
    this.asegurarAlcanceServicio(actor, servicio);
    return this.prisma.auditoriaDecision.findMany({
      where: { entidad: 'SERVICIO_LAVADO', entidadId: servicio.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async consumirInsumosSiPendiente(servicioId: string, isOfflineSync = false) {
    const servicio = await this.findOneRaw(servicioId);
    if (servicio.consumos && servicio.consumos.length > 0) return;
    await this._ejecutarConsumoInsumos(servicio, isOfflineSync);
  }

  /**
   * Una OT general puede tener varios servicios (una fila por servicio) siempre que sea
   * el mismo vehículo y no se repita un servicio ya registrado en esa OT.
   */
  /** Misma validación para quien registra directo y para la sincronización de la app (con la hora del teléfono). */
  async validarServicioDeOT(ordenTrabajoOT: string, placa: string, catalogoIds: number[], ahora: Date = new Date()) {
    await this._validarOTServicioGeneral(ordenTrabajoOT, placa, catalogoIds, ahora);
  }

  private async _validarOTServicioGeneral(ordenTrabajoOT: string, placa: string, catalogoIds: number[], ahora: Date = new Date()) {
    // La OT de servicios generales (lavado) y la OT de servicios especiales viven en espacios de
    // numeración independientes: el mismo número puede existir una vez como lavado y otra vez
    // como especial (decisión de producto, ver PLAN-PERMISOS-Y-ROLES.md). Por eso aquí solo se
    // valida contra otros servicios generales, nunca contra ServicioEspecial.
    const normalizarPlaca = (value?: string | null) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const placaNueva = normalizarPlaca(placa);

    const existentes = await this.prisma.servicioLavado.findMany({
      where: {
        ordenTrabajoOT: { equals: ordenTrabajoOT, mode: 'insensitive' },
        deletedAt: null,
        estado: { not: ServiceStatus.CANCELADO },
      },
      select: { placa: true, servicioCatalogoId: true, catalogo: { select: { nombre: true } } },
    });
    if (existentes.length === 0) return;

    const otroVehiculo = existentes.find((s) => normalizarPlaca(s.placa) !== placaNueva);
    if (otroVehiculo) {
      throw new BadRequestException(
        `La Orden de Trabajo "${ordenTrabajoOT}" pertenece al vehículo ${otroVehiculo.placa}. Solo se pueden agregar servicios del mismo vehículo.`,
      );
    }

    // OT ya finalizada: solo un retoque y dentro de los 2 días siguientes.
    await validarAgregarServicioAOT(this.prisma, { ordenTrabajoOT, catalogoIds, ahora });

    // Un retoque se puede repetir en la misma OT; cualquier otro servicio no.
    const retoques = new Set(
      (await this.prisma.catalogoServicio.findMany({ where: { id: { in: catalogoIds }, esRetoque: true }, select: { id: true } })).map((c) => c.id),
    );
    const repetido = existentes.find((s) => catalogoIds.includes(Number(s.servicioCatalogoId)) && !retoques.has(Number(s.servicioCatalogoId)));
    if (repetido) {
      throw new BadRequestException(
        `El servicio "${repetido.catalogo?.nombre || repetido.servicioCatalogoId}" ya está registrado en la OT "${ordenTrabajoOT}".`,
      );
    }
  }

  /**
   * Crea una o varias filas de servicio general para la misma OT y vehículo.
   * Con varios servicios valida primero el stock combinado para no dejar la OT a medias.
   */
  async createMultiple(createDto: CreateServicioDto, operadorId: string, actor?: any) {
    const ids = Array.from(new Set(
      [...(createDto.servicioCatalogoIds || []), createDto.servicioCatalogoId]
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ));
    if (ids.length <= 1) {
      return this.create({ ...createDto, servicioCatalogoId: ids[0] ?? createDto.servicioCatalogoId }, operadorId, actor);
    }

    const ordenTrabajoOT = createDto.ordenTrabajoOT?.trim().toUpperCase();
    if (!ordenTrabajoOT) {
      throw new BadRequestException('El número de Orden de Trabajo (OT) es obligatorio y debe ser ingresado por el usuario.');
    }
    await this._validarOTServicioGeneral(ordenTrabajoOT, createDto.placa, ids);

    const bahia = await this.prisma.bahia.findFirst({
      where: { OR: [{ id: createDto.bahiaId }, { nombre: { equals: createDto.bahiaId, mode: 'insensitive' } }] },
      select: { agenciaId: true },
    });
    const catalogos = await this.prisma.catalogoServicio.findMany({
      where: { id: { in: ids } },
      include: { recetas: { include: { insumo: true, unidadConsumo: true } } },
    });
    const faltantesCatalogo = ids.filter((id) => !catalogos.some((c) => c.id === id));
    if (faltantesCatalogo.length > 0) {
      throw new BadRequestException(`Servicios no encontrados en el catálogo: ${faltantesCatalogo.join(', ')}.`);
    }
    if (catalogos.some((c) => c.categoria !== 'GENERAL')) {
      throw new BadRequestException('Solo se pueden registrar varios servicios en la misma OT para servicios generales.');
    }
    const inactivo = catalogos.find((c) => c.estado === 'Inactivo');
    if (inactivo) {
      throw new BadRequestException(`El servicio "${inactivo.nombre}" está inactivo y no se puede usar en una nueva OT.`);
    }

    if (bahia?.agenciaId) {
      const requerido = new Map<string, { nombre: string; simbolo: string; cantidad: number }>();
      for (const catalogo of catalogos) {
        for (const receta of catalogo.recetas) {
          if (receta.esOpcional) continue;
          const cantidad = this._convertirAUnidadBase(
            Number(receta.cantidadUsada),
            receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null,
          );
          const prev = requerido.get(receta.insumoId);
          requerido.set(receta.insumoId, {
            nombre: receta.insumo.nombre,
            simbolo: receta.unidadConsumo?.simbolo || 'und',
            cantidad: (prev?.cantidad || 0) + cantidad,
          });
        }
      }
      const faltantes: string[] = [];
      for (const [insumoId, req] of requerido) {
        const stock = await this._getStockAgencia(insumoId, bahia.agenciaId);
        const disponible = Number(stock?.cantidadActual ?? 0);
        if (disponible < req.cantidad) {
          faltantes.push(`"${req.nombre}": disponible ${disponible.toFixed(2)} ${req.simbolo}, requerido ${req.cantidad.toFixed(2)} ${req.simbolo}`);
        }
      }
      if (faltantes.length > 0) {
        throw new BadRequestException(
          `No se pueden iniciar los servicios: Stock insuficiente en la agencia para los insumos obligatorios:\n` +
            faltantes.map((f) => `  • ${f}`).join('\n') +
            `\nPor favor solicite suministros a Bodega Central antes de crear la OT.`,
        );
      }
    }

    const baseUuid = createDto.clientUuid || randomUUID();
    const creados: any[] = [];
    for (let i = 0; i < ids.length; i++) {
      creados.push(await this.create({
        ...createDto,
        ordenTrabajoOT,
        servicioCatalogoId: ids[i],
        servicioCatalogoIds: undefined,
        clientUuid: i === 0 ? baseUuid : `${baseUuid}-${i + 1}`,
      }, operadorId, actor));
    }
    return creados;
  }

  async create(createDto: CreateServicioDto, operadorId: string, actor?: any) {
    // Registrar una OT nueva y agregar un servicio a una OT que ya existe son dos botones con dos permisos: el servidor mira cuál es.
    if (actor) {
      const ot = createDto.ordenTrabajoOT?.trim().toUpperCase();
      const yaExiste = ot
        ? !!(await this.prisma.servicioLavado.findFirst({
            where: { ordenTrabajoOT: { equals: ot, mode: 'insensitive' }, deletedAt: null, estado: { not: ServiceStatus.CANCELADO } },
            select: { id: true },
          }))
        : false;
      if (yaExiste && !tieneAlgunPermiso(actor, ['servicios.generales.agregar'])) {
        throw new ForbiddenException('Tu rol no puede agregar servicios a una OT que ya existe.');
      }
      if (!yaExiste && !tieneAlgunPermiso(actor, ['servicios.generales.crear'])) {
        throw new ForbiddenException('Tu rol no puede registrar órdenes de servicio nuevas.');
      }
    }
    const clientUuid = createDto.clientUuid || randomUUID();
    const now = new Date();

    // 1. Resolución Defensiva de Bahía (Soporta UUID, nombre de bahía o fallback a bahía activa)
    let bahia: any = null;
    if (createDto.bahiaId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(createDto.bahiaId);
      if (isUuid) {
        bahia = await this.prisma.bahia.findUnique({
          where: { id: createDto.bahiaId },
          include: { agencia: true },
        });
      }
      if (!bahia) {
        const busquedaNombre = createDto.bahiaId.replace(/\(.*?\)/g, '').trim();
        if (busquedaNombre) {
          bahia = await this.prisma.bahia.findFirst({
            where: {
              nombre: { contains: busquedaNombre, mode: 'insensitive' },
            },
            include: { agencia: true },
          });
        }
      }
    }
    if (!bahia) {
      throw new BadRequestException('Debe indicar una bahía válida de la agencia para registrar el servicio.');
    }

    if (actor && !puedeSobreAgencia(resolverAlcance(actor), { id: bahia.agenciaId, regionId: bahia.agencia?.regionId })) {
      throw new ForbiddenException('La bahía indicada no pertenece a tu alcance.');
    }
    const resolvedBahiaId = bahia.id;
    const agenciaId = bahia.agenciaId;

    // 2. Resolución de lavadores asignados a la OT. operadorId conserva el responsable principal
    // para compatibilidad con clientes antiguos; operadorIds registra al equipo de la bahía.
    const operadorIdsSolicitados = [...new Set((createDto.operadorIds || []).filter(Boolean))];
    if (operadorIdsSolicitados.length === 0 && createDto.operadorId) {
      operadorIdsSolicitados.push(createDto.operadorId);
    }
    const validOperadorId = operadorIdsSolicitados[0] || operadorId;
    let user = validOperadorId ? await this.prisma.user.findUnique({ where: { id: validOperadorId } }) : null;
    if (!user) {
      throw new BadRequestException('No se encontró el operador autenticado para registrar el servicio.');
    }
    if (operadorIdsSolicitados.length > 0) {
      if (createDto.operadorIds?.length) {
        // Varios lavadores: la agencia fija el máximo, y si la bahía tiene asignados solo se elige entre ellos.
        await validarLavadoresDeLaOT(this.prisma, { bahiaId: resolvedBahiaId, agenciaId, operadorIds: operadorIdsSolicitados });
      } else {
        const usuariosSeleccionados = await this.prisma.user.findMany({
          where: { id: { in: operadorIdsSolicitados } },
          select: { id: true, agenciaId: true, estado: true },
        });
        if (usuariosSeleccionados.length !== operadorIdsSolicitados.length) {
          throw new BadRequestException('Uno o más lavadores seleccionados ya no existen.');
        }
        if (usuariosSeleccionados.some((op) => String(op.agenciaId || '') !== String(agenciaId || ''))) {
          throw new BadRequestException('Todos los lavadores seleccionados deben pertenecer a la agencia de la bahía.');
        }
        if (usuariosSeleccionados.some((op) => op.estado !== 1)) {
          throw new BadRequestException('Uno o más lavadores seleccionados están inactivos.');
        }
      }
    }
    const operadoresAsignadosIds = operadorIdsSolicitados.length > 0 ? operadorIdsSolicitados : [validOperadorId];

    // 3. Resolución Defensiva de Catálogo de Servicio y sus Recetas
    let catalogo: any = null;
    if (createDto.servicioCatalogoId) {
      catalogo = await this.prisma.catalogoServicio.findUnique({
        where: { id: Number(createDto.servicioCatalogoId) },
        include: {
          recetas: {
            include: {
              insumo: true,
              unidadConsumo: true,
            },
          },
        },
      });
    }
    if (!catalogo) {
      throw new BadRequestException('Debe indicar un servicio válido del catálogo asignado a la agencia.');
    }
    if (catalogo.estado === 'Inactivo') {
      throw new BadRequestException(`El servicio "${catalogo.nombre}" está inactivo y no se puede usar en una nueva OT.`);
    }
    // El líder (y Backup, que tiene sus mismos permisos) solo registra servicios generales; los especiales los gestiona su coordinación.
    if (esLiderDeAgencia(rolDeUsuario(actor)) && catalogo.categoria !== 'GENERAL') {
      throw new ForbiddenException('Tu rol solo puede registrar servicios generales.');
    }
    const resolvedCatalogoId = catalogo.id;

    // Validar que el servicio esté en la lista de la agencia (Agencia.servicioIds)
    if (agenciaId) {
      const agenciaOt = await this.prisma.agencia.findUnique({
        where: { id: agenciaId },
        select: { id: true, nombre: true, servicioIds: true },
      });
      if (agenciaOt) {
        const rawIds = Array.isArray(agenciaOt.servicioIds) ? agenciaOt.servicioIds : [];
        const ids = rawIds.map((id: any) => Number(id)).filter((n: number) => !Number.isNaN(n) && n > 0);
        if (ids.length === 0) {
          throw new BadRequestException(
            `La agencia "${agenciaOt.nombre}" no tiene servicios asignados. Configúralos en Sucursales.`,
          );
        }
        if (!ids.includes(Number(resolvedCatalogoId))) {
          throw new BadRequestException(
            `El servicio "${catalogo.nombre}" no está en la lista de servicios de la agencia "${agenciaOt.nombre}".`,
          );
        }
      }
    }

    // Precio efectivo de este servicio para esta agencia (override si lo fijó un admin, si no el precio
    // global del catálogo), congelado en la OT: cambios posteriores al precio no la afectan.
    let precioResuelto: number | null = catalogo.precio != null ? Number(catalogo.precio) : null;
    if (agenciaId) {
      const overridePrecio = await this.prisma.precioAgenciaServicio.findUnique({
        where: { agenciaId_catalogoServicioId: { agenciaId, catalogoServicioId: resolvedCatalogoId } },
        select: { precio: true },
      });
      if (overridePrecio) precioResuelto = Number(overridePrecio.precio);
    }

    // 4. Estado físico de la bahía: se informa, pero ya no bloquea el registro (decisión de
    // producto). El estado real en tiempo real lo entrega `bahias/list` / `bahias/opciones`
    // (campo `ocupada`) para que la pantalla lo muestre antes de crear el servicio.
    let advertenciaBahiaOcupada: string | undefined;
    if (createDto.estado === ServiceStatus.EN_PROCESO) {
      const activoEnBahia = await this.prisma.servicioLavado.findFirst({
        where: {
          bahiaId: resolvedBahiaId,
          estado: ServiceStatus.EN_PROCESO,
          deletedAt: null,
        },
      });
      if (activoEnBahia && activoEnBahia.placa !== createDto.placa.toUpperCase().trim()) {
        advertenciaBahiaOcupada = `[ALERTA: la bahía "${bahia.nombre}" ya tenía en proceso al vehículo ${activoEnBahia.placa} (OT ${activoEnBahia.ordenTrabajoOT || '—'}) al registrar esta OT]`;
      }
    }

    // 5. VALIDACIÓN ESTRICTA DE STOCK ANTES DE CREAR EL SERVICIO
    // "solo no me debe permitir si no tengo stock de uno de los suministros necesarios para el servicio"
    const recetas = catalogo.recetas ?? [];
    if (agenciaId && recetas.length > 0) {
      const faltantes: string[] = [];
      for (const receta of recetas) {
        if (receta.esOpcional) continue;

        const cantidadBaseNecesaria = this._convertirAUnidadBase(
          Number(receta.cantidadUsada),
          receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null,
        );

        const stock = await this._getStockAgencia(receta.insumoId, agenciaId);
        const disponible = Number(stock?.cantidadActual ?? 0);

        if (disponible < cantidadBaseNecesaria) {
          const simbolo = receta.unidadConsumo?.simbolo || 'und';
          faltantes.push(
            `"${receta.insumo.nombre}": disponible ${disponible.toFixed(2)} ${simbolo}, requerido ${cantidadBaseNecesaria.toFixed(2)} ${simbolo}`,
          );
        }
      }

      if (faltantes.length > 0) {
        throw new BadRequestException(
          `No se puede iniciar el servicio: Stock insuficiente en la agencia para los insumos obligatorios:\n` +
            faltantes.map((f) => `  • ${f}`).join('\n') +
            `\nPor favor solicite suministros a Bodega Central antes de crear el servicio.`,
        );
      }
    }

    // 6. Advertencia de Maquinaria Averiada o Fuera de Servicio
    let observacionesFinales = createDto.observaciones;
    if (advertenciaBahiaOcupada) {
      observacionesFinales = observacionesFinales
        ? `${observacionesFinales} | ${advertenciaBahiaOcupada}`
        : advertenciaBahiaOcupada;
    }
    const maquinaAveriada = await this.prisma.maquinaria.findFirst({
      where: {
        bahiaId: resolvedBahiaId,
        estadoOperativo: { in: ['FUERA_DE_SERVICIO', 'DE_BAJA'] },
      },
    });
    if (maquinaAveriada) {
      const advertencia = `[ALERTA TÉCNICA: Maquinaria ${maquinaAveriada.codigo} (${maquinaAveriada.nombre}) en estado ${maquinaAveriada.estadoOperativo}]`;
      observacionesFinales = observacionesFinales
        ? `${observacionesFinales} | ${advertencia}`
        : advertencia;
    }

    // 7. Registro seguro del servicio de lavado en base de datos
    let estadoInicial = createDto.estado || ServiceStatus.EN_ESPERA;
    // Un servicio finalizado siempre queda pendiente de aprobación: lo decide el aprobador designado de la agencia o,
    // si no tiene, un administrador o el supervisor de su región. No hay auto-aprobación.

    // Hora salida estimada desde CatalogoServicio.tiempoEstimadoMin (BD)
    const minsEstimados = Math.max(1, Number(catalogo.tiempoEstimadoMin) || 30);
    const horaSalidaEstimada = new Date(now.getTime() + minsEstimados * 60_000);
    const horaSalidaFinal =
      estadoInicial === ServiceStatus.FINALIZADO || estadoInicial === ServiceStatus.APROBADO
        ? now
        : horaSalidaEstimada;

    // Validar y resolver el número de OT asignado al servicio (obligatorio y único)
    let ordenTrabajoOT = createDto.ordenTrabajoOT?.trim().toUpperCase();
    if (!ordenTrabajoOT && createDto.fotoIngresoUrl) {
      const match = createDto.fotoIngresoUrl.match(/\/servicios\/(?:generales|especiales)\/([^/]+)\//i);
      if (match && match[1] && match[1] !== 'sin-orden') {
        ordenTrabajoOT = match[1].toUpperCase();
      }
    }

    if (!ordenTrabajoOT) {
      throw new BadRequestException('El número de Orden de Trabajo (OT) es obligatorio y debe ser ingresado por el usuario.');
    }

    await this._validarOTServicioGeneral(ordenTrabajoOT, createDto.placa, [resolvedCatalogoId]);

    // La evidencia de ingreso es del vehículo: un servicio agregado a una OT existente la hereda.
    let fotoIngresoUrl = createDto.fotoIngresoUrl || undefined;
    let videoInicialHeredado: string | undefined;
    if (!fotoIngresoUrl) {
      const hermana = await this.prisma.servicioLavado.findFirst({
        where: {
          ordenTrabajoOT: { equals: ordenTrabajoOT, mode: 'insensitive' },
          deletedAt: null,
          OR: [{ fotoIngresoUrl: { not: null } }, { videoInicialUrl: { not: null } }],
        },
        select: { fotoIngresoUrl: true, videoInicialUrl: true },
        orderBy: { createdAt: 'asc' },
      });
      fotoIngresoUrl = hermana?.fotoIngresoUrl || undefined;
      videoInicialHeredado = hermana?.videoInicialUrl || undefined;
    }
    // Sin evidencia de ingreso no se inicia la OT: registrarla es iniciarla. Un servicio agregado a una OT que ya la tiene la hereda.
    // (La sincronización de la app no pasa por aquí con `actor`: su evidencia llega por su propio flujo.)
    const videoInicialDto = createDto.videoInicialUrl?.trim() || undefined;
    if (actor && !fotoIngresoUrl && !videoInicialHeredado && !videoInicialDto) {
      throw new BadRequestException('La evidencia de ingreso (foto o video del vehículo) es obligatoria para registrar e iniciar la OT.');
    }

    const created = await (this.prisma.servicioLavado as any).create({
      data: {
        clientUuid,
        ordenTrabajoOT,
        placa: createDto.placa.toUpperCase().trim(),
        marca: createDto.marca?.trim() || null,
        modelo: createDto.modelo.trim(),
        color: createDto.color?.trim(),
        cliente: createDto.cliente?.trim(),
        estado: estadoInicial,
        bahiaId: resolvedBahiaId,
        servicioCatalogoId: resolvedCatalogoId,
        precio: precioResuelto,
        operadorId: validOperadorId,
        operadoresAsignados: {
          create: operadoresAsignadosIds.map((id) => ({ operadorId: id })),
        },
        horaIngreso: now,
        horaInicio: createDto.estado === ServiceStatus.EN_PROCESO ? now : null,
        horaSalida: horaSalidaFinal,
        fotoIngresoUrl,
        videoInicialUrl: videoInicialDto ?? videoInicialHeredado,
        fotoSalidaUrl: createDto.fotoSalidaUrl,
        observaciones: observacionesFinales,
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
                insumo: {
                  select: {
                    id: true, codigoSKU: true, nombre: true, costoUnitarioUSD: true,
                    unidadMedida: { select: { simbolo: true } },
                  },
                },
                unidadConsumo: { select: { id: true, codigo: true, simbolo: true, factorBase: true } },
              },
            },
          },
        },
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadoresAsignados: {
          include: { operador: { select: { id: true, name: true, lastname: true, email: true } } },
        },
      },
    });

    // 8. Descuento atómico de stock e inserción de Kardex
    await this._ejecutarConsumoInsumos(created, false);

    // 9. Persistir registro en tabla EvidenciaServicio si se adjuntó vídeo o foto de ingreso
    if (fotoIngresoUrl || videoInicialHeredado) {
      await this.prisma.evidenciaServicio.create({
        data: {
          servicioId: created.id,
          tipo: 'VIDEO_INGRESO',
          url: (fotoIngresoUrl || videoInicialHeredado) as string,
          descripcion: 'Vídeo / Foto de Ingreso del Vehículo',
        },
      }).catch((err) => {
        this.logger.warn(`No se pudo registrar EvidenciaServicio en create: ${err?.message}`);
      });
    }

    const finalCreated = await this.findOneRaw(created.id);
    return serializeServicioLavado(finalCreated);
  }

  /**
   * Cada cambio de una OT tiene su casilla: corregir los datos del vehículo y del cliente exige «Editar OT»; cambiar el estado o
   * subir la evidencia (iniciar y finalizar) exige «Finalizar OT»; las observaciones
   * las puede cambiar quien edita o quien finaliza. Solo se exige lo que de verdad cambia (el formulario puede mandar todos los campos).
   */
  private exigirPermisosDeActualizacion(actor: any, servicio: any, dto: UpdateServicioDto): void {
    const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
    const editaDatos =
      CAMPOS_EDITABLES_OT.some((c) => dto[c] !== undefined && norm(dto[c]) !== norm(servicio[c])) ||
      (dto.servicioCatalogoId !== undefined && Number(dto.servicioCatalogoId) !== Number(servicio.servicioCatalogoId));
    const finaliza = (dto.estado !== undefined && dto.estado !== servicio.estado) || dto.fotoSalidaUrl !== undefined || dto.fotoIngresoUrl !== undefined;
    const cambiaObservaciones = dto.observaciones !== undefined && String(dto.observaciones ?? '') !== String(servicio.observaciones ?? '');

    if (editaDatos && !tienePermiso(actor, 'servicios.generales.editar')) {
      throw new ForbiddenException('Tu rol no puede editar los datos de una orden de trabajo.');
    }
    if (finaliza && !tieneAlgunPermiso(actor, PERMISOS_FINALIZAR_OT)) {
      throw new ForbiddenException('Tu rol no puede finalizar órdenes de trabajo.');
    }
    if (cambiaObservaciones && !tieneAlgunPermiso(actor, [...PERMISOS_FINALIZAR_OT, 'servicios.generales.editar'])) {
      throw new ForbiddenException('Tu rol no puede cambiar las observaciones de una orden de trabajo.');
    }
  }

  /**
   * Cambia el servicio de una OT que aún no se finaliza. Como los insumos se descuentan al registrarla, se devuelven los del servicio
   * anterior (con kardex) y, al terminar la actualización, se descuentan los del nuevo. Antes de tocar nada se comprueba que el stock
   * alcance para el nuevo contando lo que se va a devolver; si no alcanza, no se cambia nada. Devuelve el precio nuevo (el de la
   * agencia si lo tiene fijado, si no el del catálogo), que reemplaza al congelado.
   */
  private async cambiarServicioDeOT(servicio: any, nuevoId: number, actor: any): Promise<number | null> {
    if (servicio.estado !== ServiceStatus.EN_ESPERA && servicio.estado !== ServiceStatus.EN_PROCESO) {
      throw new BadRequestException('Solo se puede cambiar el servicio mientras la OT está en espera o en proceso.');
    }
    const agencia = servicio.bahia?.agencia;
    if (!agencia?.id) throw new BadRequestException('La bahía de la OT no tiene agencia asignada.');

    const catalogo = await this.prisma.catalogoServicio.findUnique({
      where: { id: nuevoId },
      include: { recetas: { include: { insumo: true, unidadConsumo: true } } },
    });
    if (!catalogo) throw new BadRequestException('El servicio indicado no existe en el catálogo.');
    if (catalogo.estado === 'Inactivo') throw new BadRequestException(`El servicio "${catalogo.nombre}" está inactivo y no se puede usar.`);
    if (catalogo.categoria !== 'GENERAL') throw new BadRequestException('Solo se puede cambiar a otro servicio general.');

    const permitidos = (Array.isArray(agencia.servicioIds) ? agencia.servicioIds : []).map((id: any) => Number(id)).filter((n: number) => n > 0);
    if (!permitidos.includes(nuevoId)) {
      throw new BadRequestException(`El servicio "${catalogo.nombre}" no está en la lista de servicios de la agencia "${agencia.nombre}".`);
    }
    if (servicio.ordenTrabajoOT) await this._validarOTServicioGeneral(servicio.ordenTrabajoOT, servicio.placa, [nuevoId]);

    // Stock: lo disponible más lo que se va a devolver del servicio anterior.
    const devuelto = new Map<string, number>();
    for (const c of servicio.consumos ?? []) {
      if (Number(c.cantidadUsada) > 0 && c.stockUbicacionId) devuelto.set(c.insumoId, (devuelto.get(c.insumoId) ?? 0) + Number(c.cantidadUsada));
    }
    const faltantes: string[] = [];
    for (const receta of catalogo.recetas) {
      if (receta.esOpcional) continue;
      const necesario = this._convertirAUnidadBase(Number(receta.cantidadUsada), receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null);
      const stock = await this._getStockAgencia(receta.insumoId, agencia.id);
      const disponible = Number(stock?.cantidadActual ?? 0) + (devuelto.get(receta.insumoId) ?? 0);
      if (disponible < necesario) {
        faltantes.push(`"${receta.insumo.nombre}": necesario ${necesario.toFixed(4)} ${receta.unidadConsumo?.simbolo ?? ''}, disponible ${disponible.toFixed(4)}`);
      }
    }
    if (faltantes.length > 0) {
      throw new BadRequestException(
        `No se puede cambiar el servicio: stock insuficiente en la agencia para los insumos obligatorios del nuevo servicio:\n` +
          faltantes.map((f) => `  • ${f}`).join('\n'),
      );
    }

    let precio: number | null = catalogo.precio != null ? Number(catalogo.precio) : null;
    const override = await this.prisma.precioAgenciaServicio.findUnique({
      where: { agenciaId_catalogoServicioId: { agenciaId: agencia.id, catalogoServicioId: nuevoId } },
      select: { precio: true },
    });
    if (override) precio = Number(override.precio);

    await this.prisma.$transaction(async (tx) => {
      for (const c of servicio.consumos ?? []) {
        const cantidad = Number(c.cantidadUsada);
        if (cantidad <= 0 || !c.stockUbicacionId) continue;
        const stock = await tx.stockUbicacion.findUnique({ where: { id: c.stockUbicacionId } });
        const antes = Number(stock?.cantidadActual ?? 0);
        await tx.stockUbicacion.update({ where: { id: c.stockUbicacionId }, data: { cantidadActual: { increment: cantidad } } });
        await tx.kardexMovimiento.create({
          data: {
            insumoId: c.insumoId,
            ubicacionId: agencia.id,
            tipoMovimiento: 'EDICION_SERVICIO_REVERSA',
            cantidad,
            stockAnterior: antes,
            stockPosterior: antes + cantidad,
            costoUnitario: 0,
            costoTotal: 0,
            referenciaId: servicio.id,
            usuarioId: servicio.operadorId,
          },
        });
      }
      await tx.consumoServicio.deleteMany({ where: { servicioId: servicio.id } });
      await tx.servicioLavado.update({
        where: { id: servicio.id },
        data: { servicioCatalogoId: nuevoId, precio, version: { increment: 1 } },
      });
    });
    return precio;
  }

  async update(id: string, updateDto: UpdateServicioDto, isOfflineSync: boolean = false, actor?: any) {
    const servicio = await this.findOneRaw(id);
    const data: any = { ...updateDto };
    delete data.id;
    delete data.motivoCorreccion;
    delete data.servicioCatalogoId;
    // Cambiar el servicio solo lo hace quien llama a la API con «Editar OT»; la sincronización de la app no lo usa.
    const nuevoServicioId =
      actor && updateDto.servicioCatalogoId !== undefined && Number(updateDto.servicioCatalogoId) !== Number(servicio.servicioCatalogoId)
        ? Number(updateDto.servicioCatalogoId)
        : null;
    const servicioAnteriorId = servicio.servicioCatalogoId;
    const precioAnterior = servicio.precio != null ? Number(servicio.precio) : null;

    let motivoCorreccion: string | undefined;
    if (actor) {
      this.asegurarAlcanceServicio(actor, servicio);
      if (servicio.deletedAt) throw new BadRequestException('El servicio está anulado y no se puede modificar.');
      // Aprobar, rechazar y anular tienen sus propias acciones (con regla y registro): no se cuelan por aquí.
      if (updateDto.estado && ([ServiceStatus.APROBADO, ServiceStatus.RECHAZADO, ServiceStatus.CANCELADO] as ServiceStatus[]).includes(updateDto.estado)) {
        throw new BadRequestException('Para aprobar, rechazar o anular usa la acción correspondiente.');
      }
      this.exigirPermisosDeActualizacion(actor, servicio, updateDto);
      if (servicio.estado === ServiceStatus.APROBADO) {
        if (!['SUPER_ADMIN', 'ADMIN'].includes(rolDeUsuario(actor))) {
          throw new ForbiddenException('Un servicio aprobado solo lo puede editar un administrador.');
        }
        motivoCorreccion = this.decisiones.exigirMotivo(updateDto.motivoCorreccion, 'corregir un servicio aprobado');
      }
      // La web ya exige el vídeo/foto de salida antes de finalizar (confirmarFinalizarServicio); se
      // repite acá para que nadie finalice sin evidencia llamando al endpoint directo. No aplica al
      // offline sync (su propio flujo lo maneja más abajo) ni si ya estaba finalizado (reintentos).
      if (
        !isOfflineSync &&
        updateDto.estado === ServiceStatus.FINALIZADO &&
        servicio.estado !== ServiceStatus.FINALIZADO &&
        !(data.fotoSalidaUrl ?? servicio.fotoSalidaUrl)
      ) {
        throw new BadRequestException('La evidencia de salida (foto o vídeo) es obligatoria para finalizar el servicio.');
      }
    }
    let precioNuevo: number | null = null;
    if (nuevoServicioId !== null) {
      precioNuevo = await this.cambiarServicioDeOT(servicio, nuevoServicioId, actor);
    }

    data.version = { increment: 1 };

    // Datos del vehículo y del cliente (casilla «Editar OT»): se normalizan y, abajo, se aplican a toda la OT.
    const datosVehiculo: Record<string, string | null> = {};
    for (const campo of CAMPOS_EDITABLES_OT) {
      if (updateDto[campo] === undefined) continue;
      const limpio = String(updateDto[campo] ?? '').trim();
      if ((campo === 'placa' || campo === 'modelo') && !limpio) {
        throw new BadRequestException(`El campo ${campo === 'placa' ? 'placa' : 'modelo'} no puede quedar vacío.`);
      }
      const valor = campo === 'placa' ? limpio.toUpperCase() : limpio;
      datosVehiculo[campo] = campo === 'marca' || campo === 'color' || campo === 'cliente' ? valor || null : valor;
      data[campo] = datosVehiculo[campo];
    }

    if (updateDto.estado === ServiceStatus.FINALIZADO) {
      // Al finalizar, horaSalida pasa a ser la real (antes era estimada por tiempoEstimadoMin)
      data.horaSalida = new Date();
    }

    // ──────────────────────────────────────────────────────────────────
    // MÁQUINA DE ESTADOS IRREVERSIBLE (Anti Out-of-Order Delivery)
    // ──────────────────────────────────────────────────────────────────
    if (updateDto.estado && updateDto.estado !== servicio.estado) {
      // 1. Si ya está APROBADO, no puede retroceder a ningún estado previo
      if (servicio.estado === ServiceStatus.APROBADO) {
        if (([ServiceStatus.EN_ESPERA, ServiceStatus.EN_PROCESO, ServiceStatus.FINALIZADO] as ServiceStatus[]).includes(updateDto.estado)) {
          if (isOfflineSync) {
            delete data.estado;
          } else {
            throw new BadRequestException('El servicio ya fue APROBADO por Gerencia y no puede retroceder de estado.');
          }
        }
      }

      // 2. Si ya está FINALIZADO, no puede retroceder a EN_ESPERA ni EN_PROCESO
      if (servicio.estado === ServiceStatus.FINALIZADO) {
        if (([ServiceStatus.EN_ESPERA, ServiceStatus.EN_PROCESO] as ServiceStatus[]).includes(updateDto.estado)) {
          if (isOfflineSync) {
            delete data.estado;
          } else {
            throw new BadRequestException('El servicio ya fue FINALIZADO y no puede retroceder a En Espera o En Proceso.');
          }
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────
    // HOOK: Al finalizar un servicio, descontar insumos de la receta (si no fueron descontados al registrar)
    // ──────────────────────────────────────────────────────────────────
    if (
      data.estado === ServiceStatus.FINALIZADO &&
      servicio.estado !== ServiceStatus.FINALIZADO
    ) {
      if (!servicio.consumos || servicio.consumos.length === 0) {
        await this._ejecutarConsumoInsumos(servicio, isOfflineSync);
      }

    }

    const updated = await this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data,
      include: {
        bahia: {
          include: { agencia: { select: { id: true, nombre: true, codigo: true } } },
        },
        catalogo: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        consumos: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
        evidencias: {
          orderBy: { tomadaEn: 'asc' },
        },
      },
    });

    if (nuevoServicioId !== null) {
      // Los insumos del servicio nuevo se descuentan ahora (los del anterior ya se devolvieron): igual que al registrar la OT.
      await this._ejecutarConsumoInsumos(await this.findOneRaw(servicio.id), false);
      await this.decisiones.registrar({
        entidad: 'SERVICIO_LAVADO',
        entidadId: servicio.id,
        accion: 'CAMBIAR_SERVICIO',
        user: actor,
        regla: 'PERMISO',
        agenciaId: servicio.bahia?.agencia?.id ?? null,
        detalle: { servicioAnteriorId, servicioNuevoId: nuevoServicioId, precioAnterior, precioNuevo },
      });
    }

    // Una OT puede tener varios servicios del mismo vehículo: los datos del vehículo y del cliente se corrigen en todos
    // (menos en los ya aprobados, que solo se tocan desde su propia corrección con motivo).
    if (Object.keys(datosVehiculo).length > 0 && servicio.ordenTrabajoOT) {
      await this.prisma.servicioLavado.updateMany({
        where: {
          id: { not: servicio.id },
          ordenTrabajoOT: { equals: servicio.ordenTrabajoOT, mode: 'insensitive' },
          deletedAt: null,
          estado: { not: ServiceStatus.APROBADO },
        },
        data: { ...datosVehiculo, version: { increment: 1 } } as any,
      });
    }

    if (actor && motivoCorreccion) {
      await this.decisiones.registrar({
        entidad: 'SERVICIO_LAVADO',
        entidadId: servicio.id,
        accion: 'EDITAR_APROBADO',
        user: actor,
        regla: 'ADMIN',
        motivo: motivoCorreccion,
        agenciaId: servicio.bahia?.agencia?.id ?? null,
        detalle: { cambios: Object.keys(data).filter((k) => k !== 'version') },
      });
    }

    // Persistir en EvidenciaServicio si se envió vídeo o foto de salida/ingreso
    if (updateDto.fotoSalidaUrl) {
      const yaExisteSalida = updated.evidencias?.some((e) => e.url === updateDto.fotoSalidaUrl);
      if (!yaExisteSalida) {
        await this.prisma.evidenciaServicio.create({
          data: {
            servicioId: updated.id,
            tipo: 'VIDEO_SALIDA',
            url: updateDto.fotoSalidaUrl,
            descripcion: 'Vídeo / Foto de Salida y Acabado del Vehículo',
          },
        }).catch((err) => {
          this.logger.warn(`No se pudo registrar EvidenciaServicio de salida: ${err?.message}`);
        });
      }
    }
    if (updateDto.fotoIngresoUrl) {
      const yaExisteIngreso = updated.evidencias?.some((e) => e.url === updateDto.fotoIngresoUrl);
      if (!yaExisteIngreso) {
        await this.prisma.evidenciaServicio.create({
          data: {
            servicioId: updated.id,
            tipo: 'VIDEO_INGRESO',
            url: updateDto.fotoIngresoUrl,
            descripcion: 'Vídeo / Foto de Ingreso del Vehículo',
          },
        }).catch((err) => {
          this.logger.warn(`No se pudo registrar EvidenciaServicio de ingreso: ${err?.message}`);
        });
      }
    }

    if (nuevoServicioId !== null) return serializeServicioLavado(await this.findOneRaw(servicio.id));
    return serializeServicioLavado(updated);
  }

  /**
   * Anula un servicio (no se borra: queda con deletedAt para la sincronización y con quién, cuándo y por qué).
   * Con `actor` (llamada desde la API) exige motivo y aplica la regla: antes de aprobar, el líder y el aprobador de la agencia y los
   * administradores; ya aprobado, solo los administradores.
   */
  async softDelete(id: string, motivo?: string, reponerInsumos: boolean = true, actor?: any) {
    const servicio = await this.findOneRaw(id);

    let regla: 'TITULAR' | 'RESPALDO' | 'ADMIN' | undefined;
    let motivoAnulacion = motivo;
    if (actor) {
      this.asegurarAlcanceServicio(actor, servicio);
      if (servicio.deletedAt) throw new BadRequestException('El servicio ya está anulado.');
      motivoAnulacion = this.decisiones.exigirMotivo(motivo, 'anular un servicio');
      regla = this.decisiones.reglaParaAnular(
        actor,
        { id: servicio.bahia.agencia.id, regionId: servicio.bahia.agencia.regionId },
        servicio.estado === ServiceStatus.APROBADO,
      );
    }

    // Reversión de Insumos: los insumos se descuentan al REGISTRAR la OT, así que cualquier OT con consumos (en espera, en proceso,
    // finalizada o aprobada) los devuelve al anularse; una OT ya anulada no los devuelve dos veces.
    const consumioInsumos = !servicio.deletedAt;
    if (consumioInsumos && reponerInsumos && servicio.consumos?.length > 0) {
      const agenciaId = servicio.bahia?.agencia?.id;
      for (const c of servicio.consumos) {
        const cantidadRevertir = Number(c.cantidadUsada);
        const stockUbicacionId = c.stockUbicacionId;
        if (cantidadRevertir <= 0 || !stockUbicacionId) continue;

        await this.prisma.$transaction(async (tx) => {
          const stock = await tx.stockUbicacion.findUnique({
            where: { id: stockUbicacionId },
          });
          const stockAnterior = Number(stock?.cantidadActual ?? 0);
          const stockPosterior = stockAnterior + cantidadRevertir;

          await tx.stockUbicacion.update({
            where: { id: stockUbicacionId },
            data: { cantidadActual: { increment: cantidadRevertir } },
          });

          await tx.kardexMovimiento.create({
            data: {
              insumoId: c.insumoId,
              ubicacionId: agenciaId || stock?.agenciaId || 'agencia',
              tipoMovimiento: 'ANULACION_SERVICIO_REVERSA',
              cantidad: cantidadRevertir,
              stockAnterior,
              stockPosterior,
              costoUnitario: 0,
              costoTotal: 0,
              referenciaId: servicio.id,
              usuarioId: servicio.operadorId,
            },
          });
        });
      }
    }

    const deleted = await this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data: {
        deletedAt: new Date(),
        estado: ServiceStatus.CANCELADO,
        observaciones: motivoAnulacion
          ? `${servicio.observaciones || ''} | [Eliminado/Anulado]: ${motivoAnulacion}`.trim()
          : servicio.observaciones,
        ...(actor ? { anuladoPorId: String(actor.id), anuladoEn: new Date(), motivoAnulacion } : {}),
        version: servicio.version + 1,
      },
      include: {
        bahia: {
          include: { agencia: true },
        },
        catalogo: true,
        // Nunca `operador: true`: traería el usuario completo con su passwordHash a la respuesta.
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
      },
    });

    if (actor && regla) {
      await this.decisiones.registrar({
        entidad: 'SERVICIO_LAVADO',
        entidadId: servicio.id,
        accion: 'ANULAR',
        user: actor,
        regla,
        motivo: motivoAnulacion,
        agenciaId: servicio.bahia.agencia.id,
        detalle: { estadoAnterior: servicio.estado, insumosRepuestos: consumioInsumos && reponerInsumos },
      });
      await this.notificarDecisionServicio(servicio, servicio.bahia.agencia, 'ANULADO');
    }

    return serializeServicioLavado(deleted);
  }

  /**
   * Avisa que se decidió un servicio general (aprobar, rechazar o anular): al operador que lo ejecutó,
   * al líder de esa agencia, al supervisor de su región y a admin/super admin. Nunca bloquea el flujo.
   */
  private async notificarDecisionServicio(
    servicio: { id: string; placa: string; ordenTrabajoOT?: string | null; operadorId?: string | null },
    agencia: { id: string; regionId?: string | null },
    decision: 'APROBADO' | 'RECHAZADO' | 'ANULADO',
  ): Promise<void> {
    if (!this.notifications) return;
    const [lideres, porRol] = await Promise.all([
      this.prisma.user.findMany({ where: { estado: 1, agenciaId: agencia.id, role: { namerol: { in: [...ROLES_LIDER_AGENCIA] } } }, select: { id: true } }),
      this.notifications.resolverDestinatariosPorRol({
        global: ['ADMIN', 'SUPER_ADMIN'],
        regionales: ['SUPERVISOR'],
        regionId: agencia.regionId,
      }),
    ]);
    const ids = [servicio.operadorId, ...lideres.map((l) => l.id), ...porRol].filter(Boolean) as string[];
    const verbo = decision === 'APROBADO' ? 'aprobado' : decision === 'RECHAZADO' ? 'rechazado' : 'anulado';
    void this.notifications.notificarUsuarios(
      ids,
      `Servicio ${verbo}`,
      `El servicio de la placa ${servicio.placa} (OT ${servicio.ordenTrabajoOT || servicio.id}) fue ${verbo}.`,
      { type: 'SERVICIO_DECIDIDO', servicioId: servicio.id },
      { tipo: 'SERVICIO_DECIDIDO', entidadTipo: 'SERVICIO_LAVADO', entidadId: servicio.id },
    );
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

  private async _ejecutarConsumoInsumos(servicio: any, isOfflineSync: boolean = false) {
    const agenciaId = servicio.bahia?.agencia?.id;
    if (!agenciaId) {
      throw new BadRequestException(
        'No se puede finalizar el servicio: la bahía no tiene agencia asignada.',
      );
    }

    const recetas = servicio.catalogo?.recetas ?? [];
    if (recetas.length === 0) return; // Sin receta → sin descuento (servicio sin insumos configurados)

    // ── 1. VALIDACIÓN PREVIA (Sólo aplica a operaciones online en vivo) ──
    // En sincronización offline rige la "No-Block Policy": el auto ya fue lavado en el mundo real,
    // por lo que el stock físico manda sobre el balance virtual y no se bloquea la orden.
    if (!isOfflineSync) {
      const faltantes: string[] = [];
      for (const receta of recetas) {
        if (receta.esOpcional) continue;

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
          `Stock insuficiente en la agencia para finalizar el servicio. Insumos faltantes:\n` +
            faltantes.map((f) => `  • ${f}`).join('\n'),
        );
      }
    }

    // ── 2. DESCUENTO Y KARDEX ATÓMICO SERIALIZADO ──
    for (const receta of recetas) {
      const cantidadEnBase = this._convertirAUnidadBase(
        Number(receta.cantidadUsada),
        receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : null,
      );

      let nuevoStockCalculado = 0;

      await this.prisma.$transaction(async (tx) => {
        let stock = await tx.stockUbicacion.findFirst({
          where: {
            insumoId: receta.insumoId,
            tipoUbicacion: 'AGENCIA',
            agenciaId,
          },
        });

        if (!stock) {
          stock = await tx.stockUbicacion.create({
            data: {
              insumoId: receta.insumoId,
              tipoUbicacion: 'AGENCIA',
              agenciaId,
              cantidadActual: 0,
            },
          });
        }

        const disponible = Number(stock.cantidadActual ?? 0);
        const cantidadADescontar =
          receta.esOpcional && !isOfflineSync ? Math.min(cantidadEnBase, disponible) : cantidadEnBase;

        if (cantidadADescontar <= 0) return;

        const nuevoStock = disponible - cantidadADescontar;
        nuevoStockCalculado = nuevoStock;
        const costoUnit = Number(receta.insumo?.costoUnitarioUSD ?? 0);
        const costoTotal = Number((cantidadADescontar * costoUnit).toFixed(2));
        const tipoMovimiento =
          nuevoStock < 0 || isOfflineSync ? 'CONSUMO_SERVICIO_OFFLINE' : 'CONSUMO_SERVICIO';

        await tx.stockUbicacion.update({
          where: { id: stock.id },
          data: { cantidadActual: { decrement: cantidadADescontar } },
        });

        await tx.kardexMovimiento.create({
          data: {
            insumoId: receta.insumoId,
            ubicacionId: agenciaId,
            tipoMovimiento,
            cantidad: -cantidadADescontar,
            stockAnterior: disponible,
            stockPosterior: nuevoStock,
            costoUnitario: costoUnit,
            costoTotal,
            referenciaId: servicio.id,
            usuarioId: servicio.operadorId,
          },
        });

        await tx.consumoServicio.create({
          data: {
            servicioId: servicio.id,
            insumoId: receta.insumoId,
            cantidadUsada: cantidadADescontar,
            stockUbicacionId: stock.id,
            agenciaId,
            // Snapshot congelado: el producto pudo cambiar de nombre/SKU, o la receta
            // pudo reemplazarlo por otro, después de este consumo. Esto no cambia.
            insumoNombre: receta.insumo?.nombre || '',
            insumoSKU: receta.insumo?.codigoSKU || '',
            unidadSimbolo: receta.insumo?.unidadMedida?.simbolo || receta.unidadConsumo?.simbolo || '',
          },
        });
      });

      // ── 3. ALERTAS DE SOBREGIRO O STOCK MÍNIMO ──
      if (nuevoStockCalculado < 0) {
        // Sobregiro por sincronización offline
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
              nivel: 'CRITICO',
              agenciaId,
              usuarioEmisorId: servicio.operadorId,
              mensaje: `Sobregiro por sincronización concurrente: Stock físico menor a cero en Agencia ${agenciaId}. Insumo ${receta.insumo?.nombre || receta.insumoId}: ${nuevoStockCalculado.toFixed(3)}`,
              stockReportado: nuevoStockCalculado,
            },
          });

          if (this.notifications) {
            await this.notifications.notificarAlertaStock({
              insumoNombre: receta.insumo?.nombre || 'Insumo Químico',
              nivel: 'CRITICO',
              agenciaId,
              entidadId: receta.insumoId,
            });
          }
        }
      } else {
        const minimoAgencia = Number(receta.insumo?.stockMinimoAgencia ?? 0);
        if (nuevoStockCalculado <= minimoAgencia) {
          const alertaExistente = await this.prisma.alertaStock.findFirst({
            where: {
              insumoId: receta.insumoId,
              agenciaId,
              estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
            },
          });
          if (!alertaExistente) {
            const nivel = nuevoStockCalculado === 0 ? 'AGOTADO' : nuevoStockCalculado < minimoAgencia * 0.5 ? 'CRITICO' : 'BAJO';
            await this.prisma.alertaStock.create({
              data: {
                insumoId: receta.insumoId,
                nivel,
                agenciaId,
                usuarioEmisorId: servicio.operadorId,
                mensaje: `Stock bajo generado automáticamente al finalizar servicio ${servicio.id}. Stock actual: ${nuevoStockCalculado.toFixed(3)}`,
                stockReportado: nuevoStockCalculado,
              },
            });

            if (nivel === 'CRITICO' || nivel === 'AGOTADO') {
              await this.notifications?.notificarAlertaStock({
                insumoNombre: receta.insumo?.nombre || 'Insumo Químico',
                nivel,
                agenciaId,
                entidadId: receta.insumoId,
              });
            }
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

  /** Las recetas se rigen por la categoría del servicio: «catalogo.generales.recetas.*» o «catalogo.especiales.recetas.*». */
  private async exigirRecetaDe(actor: any, catalogoServicioId: number, accion: 'ver' | 'editar' | 'historial') {
    if (!actor) return;
    const servicio = await this.prisma.catalogoServicio.findUnique({ where: { id: catalogoServicioId }, select: { categoria: true } });
    if (!servicio) return; // el método que sigue responde el 404
    const grupo = String(servicio.categoria).toUpperCase() === 'ESPECIAL' ? 'especiales' : 'generales';
    if (!tienePermiso(actor, `catalogo.${grupo}.recetas.${accion}`)) {
      throw new ForbiddenException(`Tu rol no tiene permiso para ${accion === 'ver' ? 'ver' : accion === 'editar' ? 'editar' : 'ver el historial de'} recetas de servicios ${grupo}.`);
    }
  }

  async asignarReceta(dto: AsignarRecetaDto, usuarioId?: string, actor?: any) {
    await this.exigirRecetaDe(actor, dto.catalogoServicioId, 'editar');
    // Verificar que el catálogo existe
    const catalogo = await this.prisma.catalogoServicio.findUnique({
      where: { id: dto.catalogoServicioId },
    });
    if (!catalogo) {
      throw new NotFoundException(`Catálogo de servicio con ID ${dto.catalogoServicioId} no encontrado`);
    }

    // Estado ANTES del cambio, para poder registrar el historial (qué salió, qué cambió).
    const recetaAnterior = await this.prisma.recetaInsumo.findMany({
      where: { catalogoServicioId: dto.catalogoServicioId },
      include: {
        insumo: { select: { nombre: true, codigoSKU: true } },
        unidadConsumo: { select: { simbolo: true } },
      },
    });
    const anteriorPorInsumo = new Map(recetaAnterior.map((r) => [r.insumoId, r]));
    const loteId = randomUUID();
    const historial: any[] = [];

    if (!dto.items || dto.items.length === 0) {
      for (const anterior of recetaAnterior) {
        historial.push(this._historialRecetaEntry(dto.catalogoServicioId, loteId, 'ELIMINADO', anterior.insumoId, anterior.insumo.nombre, anterior.insumo.codigoSKU, anterior.unidadConsumo.simbolo, Number(anterior.cantidadUsada), null, usuarioId));
      }
      await this.prisma.$transaction([
        ...(historial.length > 0 ? [this.prisma.recetaInsumoHistorial.createMany({ data: historial })] : []),
        this.prisma.recetaInsumo.deleteMany({ where: { catalogoServicioId: dto.catalogoServicioId } }),
      ]);
      return {
        catalogoServicioId: dto.catalogoServicioId,
        catalogoNombre: catalogo.nombre,
        categoria: catalogo.categoria,
        recetaActualizada: [],
      };
    }

    // Validar insumos y resolver unidades con fallback robusto
    const insumosPorId = new Map<string, any>();
    for (const item of dto.items) {
      const insumo = await this.prisma.insumo.findUnique({ where: { id: item.insumoId } });
      if (!insumo) throw new NotFoundException(`Insumo con ID "${item.insumoId}" no encontrado`);

      let unidad: any = null;
      if (item.unidadConsumoId && item.unidadConsumoId !== 'und_default' && item.unidadConsumoId.trim().length > 0) {
        unidad = await this.prisma.unidadMedida.findUnique({ where: { id: item.unidadConsumoId } });
      }

      if (!unidad && insumo.unidadMedidaId) {
        unidad = await this.prisma.unidadMedida.findUnique({ where: { id: insumo.unidadMedidaId } });
      }

      if (!unidad) {
        throw new NotFoundException(`No se encontró una unidad de medida para el insumo "${insumo.nombre}". Asigne la unidad en el catálogo.`);
      }

      item.unidadConsumoId = unidad.id;
      insumosPorId.set(item.insumoId, { insumo, unidad });
    }

    // Líneas que salen de la receta (estaban antes, no vienen en el nuevo guardado)
    const incomingInsumoIds = new Set(dto.items.map((i) => i.insumoId));
    for (const anterior of recetaAnterior) {
      if (!incomingInsumoIds.has(anterior.insumoId)) {
        historial.push(this._historialRecetaEntry(dto.catalogoServicioId, loteId, 'ELIMINADO', anterior.insumoId, anterior.insumo.nombre, anterior.insumo.codigoSKU, anterior.unidadConsumo.simbolo, Number(anterior.cantidadUsada), null, usuarioId));
      }
    }
    await this.prisma.recetaInsumo.deleteMany({
      where: {
        catalogoServicioId: dto.catalogoServicioId,
        insumoId: { notIn: Array.from(incomingInsumoIds) },
      },
    });

    // Upsert cada línea de receta
    const resultados = [];
    for (const item of dto.items) {
      const { insumo, unidad } = insumosPorId.get(item.insumoId)!;
      const existing = anteriorPorInsumo.get(item.insumoId);

      if (existing) {
        const cambioCantidad = Number(existing.cantidadUsada) !== Number(item.cantidadUsada);
        const cambioUnidad = existing.unidadConsumoId !== item.unidadConsumoId;
        if (cambioCantidad || cambioUnidad) {
          historial.push(this._historialRecetaEntry(dto.catalogoServicioId, loteId, 'MODIFICADO', item.insumoId, insumo.nombre, insumo.codigoSKU, unidad.simbolo, Number(existing.cantidadUsada), Number(item.cantidadUsada), usuarioId));
        }
        const updated = await this.prisma.recetaInsumo.update({
          where: { id: existing.id },
          data: {
            cantidadUsada: item.cantidadUsada,
            unidadConsumoId: item.unidadConsumoId!,
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
        historial.push(this._historialRecetaEntry(dto.catalogoServicioId, loteId, 'AGREGADO', item.insumoId, insumo.nombre, insumo.codigoSKU, unidad.simbolo, null, Number(item.cantidadUsada), usuarioId));
        const created = await this.prisma.recetaInsumo.create({
          data: {
            catalogoServicioId: dto.catalogoServicioId,
            insumoId: item.insumoId,
            cantidadUsada: item.cantidadUsada,
            unidadConsumoId: item.unidadConsumoId!,
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

    if (historial.length > 0) {
      await this.prisma.recetaInsumoHistorial.createMany({ data: historial });
    }

    return {
      catalogoServicioId: dto.catalogoServicioId,
      catalogoNombre: catalogo.nombre,
      categoria: catalogo.categoria,
      recetaActualizada: resultados,
    };
  }

  private _historialRecetaEntry(
    catalogoServicioId: number,
    loteId: string,
    tipoCambio: 'AGREGADO' | 'MODIFICADO' | 'ELIMINADO',
    insumoId: string,
    insumoNombre: string,
    insumoSKU: string,
    unidadSimbolo: string,
    cantidadAnterior: number | null,
    cantidadNueva: number | null,
    usuarioId?: string,
  ) {
    return {
      catalogoServicioId,
      loteId,
      tipoCambio,
      insumoId,
      insumoNombre,
      insumoSKU,
      unidadSimbolo,
      cantidadAnterior,
      cantidadNueva,
      usuarioId: usuarioId || null,
    };
  }

  /**
   * Libro de consumo por OT: una fila por OT con los insumos que descontó, tanto de
   * lavado general (agencia) como de servicios especiales (kit del pulidor).
   * Los insumos salen del snapshot congelado al momento del consumo.
   */
  async listConsumosPorServicio(dto: ListConsumosServicioDto) {
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    const tipo = dto.tipo ?? 'TODOS';
    const busqueda = dto.busqueda?.trim();
    // Tope de líneas a agrupar en memoria; el filtro por fechas mantiene el volumen acotado.
    const LIMITE_LINEAS = 5000;

    const createdAt: any = {};
    if (dto.fechaDesde) createdAt.gte = new Date(`${dto.fechaDesde}T00:00:00`);
    if (dto.fechaHasta) createdAt.lte = new Date(`${dto.fechaHasta}T23:59:59.999`);
    const rango = Object.keys(createdAt).length > 0 ? { createdAt } : {};

    const insumoSelect = {
      select: { nombre: true, codigoSKU: true, unidadMedida: { select: { simbolo: true } } },
    };
    const operadorSelect = { select: { name: true, lastname: true } };
    const nombreOperador = (u?: { name?: string | null; lastname?: string | null } | null) =>
      u ? `${u.name || ''} ${u.lastname || ''}`.replace(/\(CI:[^)]*\)/, '').trim() : '';

    const whereGeneral: any = { ...rango };
    if (dto.agenciaId) whereGeneral.agenciaId = dto.agenciaId;
    if (busqueda) {
      whereGeneral.OR = [
        { insumoNombre: { contains: busqueda, mode: 'insensitive' } },
        { insumo: { nombre: { contains: busqueda, mode: 'insensitive' } } },
        { servicio: { ordenTrabajoOT: { contains: busqueda, mode: 'insensitive' } } },
        { servicio: { placa: { contains: busqueda, mode: 'insensitive' } } },
        { servicio: { catalogo: { nombre: { contains: busqueda, mode: 'insensitive' } } } },
      ];
    }

    const whereEspecial: any = { ...rango };
    if (dto.agenciaId) whereEspecial.servicioEspecial = { agenciaId: dto.agenciaId };
    if (busqueda) {
      whereEspecial.OR = [
        { insumoNombre: { contains: busqueda, mode: 'insensitive' } },
        { insumo: { nombre: { contains: busqueda, mode: 'insensitive' } } },
        { servicioEspecial: { codigoSE: { contains: busqueda, mode: 'insensitive' } } },
        { servicioEspecial: { ordenTrabajoOT: { contains: busqueda, mode: 'insensitive' } } },
        { servicioEspecial: { placa: { contains: busqueda, mode: 'insensitive' } } },
        { servicioEspecial: { tipoServicio: { contains: busqueda, mode: 'insensitive' } } },
      ];
    }

    const [generalesDb, especialesDb] = await Promise.all([
      tipo === 'ESPECIAL' ? [] : this.prisma.consumoServicio.findMany({
        where: whereGeneral,
        orderBy: { createdAt: 'desc' },
        take: LIMITE_LINEAS,
        include: {
          insumo: insumoSelect,
          servicio: {
            select: {
              id: true,
              ordenTrabajoOT: true,
              placa: true,
              catalogo: { select: { nombre: true } },
              bahia: { select: { agencia: { select: { nombre: true } } } },
              operador: operadorSelect,
            },
          },
        },
      }),
      tipo === 'GENERAL' ? [] : this.prisma.consumoServicioEspecial.findMany({
        where: whereEspecial,
        orderBy: { createdAt: 'desc' },
        take: LIMITE_LINEAS,
        include: {
          insumo: insumoSelect,
          servicioEspecial: {
            select: {
              id: true,
              codigoSE: true,
              ordenTrabajoOT: true,
              tipoServicio: true,
              placa: true,
              agencia: { select: { nombre: true } },
              operador: operadorSelect,
            },
          },
        },
      }),
    ]);

    // Lo archivado en Parquet se suma por debajo: la base va primero y el archivo completa lo más antiguo.
    const consumosArchivo = this.historico ? new ConsumosArchivo(this.prisma, this.historico) : null;
    const params = { agenciaId: dto.agenciaId, busqueda, fechaDesde: dto.fechaDesde, fechaHasta: dto.fechaHasta };
    const [generalesArchivo, especialesArchivo] = await Promise.all([
      tipo === 'ESPECIAL' || !consumosArchivo ? [] : consumosArchivo.generales(params, LIMITE_LINEAS),
      tipo === 'GENERAL' || !consumosArchivo ? [] : consumosArchivo.especiales(params, LIMITE_LINEAS),
    ]);
    const masNuevasPrimero = (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime();
    const generales: any[] = [...generalesDb, ...generalesArchivo].sort(masNuevasPrimero).slice(0, LIMITE_LINEAS);
    const especiales: any[] = [...especialesDb, ...especialesArchivo].sort(masNuevasPrimero).slice(0, LIMITE_LINEAS);

    type ItemConsumo = {
      servicioNombre: string;
      insumoNombre: string;
      insumoSKU: string;
      cantidad: number;
      unidadSimbolo: string;
      fecha: Date;
    };
    type GrupoOT = {
      key: string;
      origen: 'GENERAL' | 'ESPECIAL';
      codigoOT: string;
      placa: string;
      agenciaNombre: string;
      responsable: string;
      fecha: Date;
      servicios: string[];
      items: ItemConsumo[];
    };
    const grupos = new Map<string, GrupoOT>();

    const agregar = (
      key: string,
      base: Omit<GrupoOT, 'key' | 'fecha' | 'servicios' | 'items'>,
      item: ItemConsumo,
    ) => {
      let g = grupos.get(key);
      if (!g) {
        g = { key, ...base, fecha: item.fecha, servicios: [], items: [] };
        grupos.set(key, g);
      }
      if (item.fecha > g.fecha) g.fecha = item.fecha;
      if (!g.servicios.includes(item.servicioNombre)) g.servicios.push(item.servicioNombre);
      g.items.push(item);
    };

    for (const c of generales) {
      const ot = (c.servicio?.ordenTrabajoOT || '').trim().toUpperCase();
      const placa = c.servicio?.placa || '';
      // Una OT general puede tener varios servicios (una fila por servicio): comparten OT y placa.
      const key = ot ? `G|${ot}|${placa.toUpperCase()}` : `G|${c.servicio?.id || c.servicioId}`;
      agregar(
        key,
        {
          origen: 'GENERAL',
          codigoOT: c.servicio?.ordenTrabajoOT || '',
          placa,
          agenciaNombre: c.servicio?.bahia?.agencia?.nombre || '',
          responsable: nombreOperador(c.servicio?.operador),
        },
        {
          servicioNombre: c.servicio?.catalogo?.nombre || 'Servicio',
          insumoNombre: c.insumoNombre || c.insumo?.nombre || 'Insumo',
          insumoSKU: c.insumoSKU || c.insumo?.codigoSKU || '',
          cantidad: Number(c.cantidadUsada),
          unidadSimbolo: c.unidadSimbolo || c.insumo?.unidadMedida?.simbolo || '',
          fecha: c.createdAt,
        },
      );
    }

    for (const c of especiales) {
      const se = c.servicioEspecial;
      agregar(
        `E|${se?.id || c.servicioEspecialId}`,
        {
          origen: 'ESPECIAL',
          codigoOT: se?.ordenTrabajoOT || se?.codigoSE || '',
          placa: se?.placa || '',
          agenciaNombre: se?.agencia?.nombre || 'Pulidor móvil',
          responsable: nombreOperador(se?.operador),
        },
        {
          servicioNombre: se?.tipoServicio || 'Servicio especial',
          insumoNombre: c.insumoNombre || c.insumo?.nombre || 'Insumo',
          insumoSKU: c.insumoSKU || c.insumo?.codigoSKU || '',
          cantidad: Number(c.cantidadUsada),
          unidadSimbolo: c.unidadSimbolo || c.insumo?.unidadMedida?.simbolo || '',
          fecha: c.createdAt,
        },
      );
    }

    const todos = Array.from(grupos.values()).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
    const inicio = (page - 1) * pageSize;
    return {
      data: todos.slice(inicio, inicio + pageSize),
      total: todos.length,
      page,
      pageSize,
    };
  }

  async listRecetaHistorial(dto: ListRecetaDto, actor?: any) {
    await this.exigirRecetaDe(actor, dto.catalogoServicioId, 'historial');
    return this.prisma.recetaInsumoHistorial.findMany({
      where: { catalogoServicioId: dto.catalogoServicioId },
      include: {
        usuario: { select: { id: true, name: true, lastname: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listReceta(dto: ListRecetaDto, actor?: any) {
    await this.exigirRecetaDe(actor, dto.catalogoServicioId, 'ver');
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

  async eliminarRecetaItem(dto: EliminarRecetaItemDto, usuarioId?: string, actor?: any) {
    await this.exigirRecetaDe(actor, dto.catalogoServicioId, 'editar');
    const receta = await this.prisma.recetaInsumo.findUnique({
      where: {
        catalogoServicioId_insumoId: {
          catalogoServicioId: dto.catalogoServicioId,
          insumoId: dto.insumoId,
        },
      },
      include: {
        insumo: { select: { nombre: true, codigoSKU: true } },
        unidadConsumo: { select: { simbolo: true } },
      },
    });

    if (!receta) {
      throw new NotFoundException(
        `No existe receta del insumo "${dto.insumoId}" en el catálogo ${dto.catalogoServicioId}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.recetaInsumoHistorial.create({
        data: this._historialRecetaEntry(
          dto.catalogoServicioId,
          randomUUID(),
          'ELIMINADO',
          receta.insumoId,
          receta.insumo.nombre,
          receta.insumo.codigoSKU,
          receta.unidadConsumo.simbolo,
          Number(receta.cantidadUsada),
          null,
          usuarioId,
        ),
      }),
      this.prisma.recetaInsumo.delete({ where: { id: receta.id } }),
    ]);
    return { ok: true, message: 'Insumo eliminado de la receta correctamente' };
  }

  // ============================================================
  //  APROBACIONES Y CIERRE DIARIO GERENCIAL
  // ============================================================

  /** Aprobar: el aprobador designado de la agencia o, si no tiene, un administrador o el supervisor de su región. */
  async aprobarServicio(id: string, observacion: string | undefined, actor: any) {
    const servicio = await this.findOneRaw(id);
    if (servicio.deletedAt) throw new BadRequestException('El servicio está anulado.');
    if (servicio.estado !== ServiceStatus.FINALIZADO) {
      throw new BadRequestException('Solo se pueden aprobar servicios que ya han sido finalizados.');
    }
    const agencia = servicio.bahia.agencia;
    const regla = await this.decisiones.reglaParaDecidir(actor, { id: agencia.id, regionId: agencia.regionId });
    const updated = await this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data: {
        estado: ServiceStatus.APROBADO,
        observacionGerente: observacion || servicio.observacionGerente || 'Aprobado',
        aprobadoPor: this.nombreDe(actor),
        decididoPorId: String(actor.id),
        reglaDecision: regla,
        fechaAprobacion: new Date(),
        version: servicio.version + 1,
      },
      include: {
        bahia: {
          include: { agencia: { select: { id: true, nombre: true, codigo: true } } },
        },
        catalogo: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        consumos: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
        evidencias: {
          orderBy: { tomadaEn: 'asc' },
        },
      },
    });

    await this.decisiones.registrar({
      entidad: 'SERVICIO_LAVADO',
      entidadId: servicio.id,
      accion: 'APROBAR',
      user: actor,
      regla,
      motivo: observacion,
      agenciaId: agencia.id,
    });

    await this.notificarDecisionServicio(servicio, agencia, 'APROBADO');

    return serializeServicioLavado(updated);
  }

  /** Rechazar: mismas reglas que aprobar; el motivo es obligatorio. */
  async rechazarServicio(id: string, motivo: string, actor: any) {
    const servicio = await this.findOneRaw(id);
    if (servicio.deletedAt) throw new BadRequestException('El servicio está anulado.');
    if (servicio.estado !== ServiceStatus.FINALIZADO) {
      throw new BadRequestException('Solo se pueden rechazar servicios que ya han sido finalizados.');
    }
    const motivoOk = this.decisiones.exigirMotivo(motivo, 'rechazar un servicio');
    const agencia = servicio.bahia.agencia;
    const regla = await this.decisiones.reglaParaDecidir(actor, { id: agencia.id, regionId: agencia.regionId });
    const updated = await this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data: {
        estado: ServiceStatus.RECHAZADO,
        motivoRechazo: motivoOk,
        observacionGerente: motivoOk,
        aprobadoPor: this.nombreDe(actor),
        decididoPorId: String(actor.id),
        reglaDecision: regla,
        fechaAprobacion: new Date(),
        version: servicio.version + 1,
      },
      include: {
        bahia: {
          include: { agencia: { select: { id: true, nombre: true, codigo: true } } },
        },
        catalogo: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        consumos: {
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
        },
        evidencias: {
          orderBy: { tomadaEn: 'asc' },
        },
      },
    });

    await this.decisiones.registrar({
      entidad: 'SERVICIO_LAVADO',
      entidadId: servicio.id,
      accion: 'RECHAZAR',
      user: actor,
      regla,
      motivo: motivoOk,
      agenciaId: agencia.id,
    });

    await this.notificarDecisionServicio(servicio, agencia, 'RECHAZADO');

    return serializeServicioLavado(updated);
  }
}
