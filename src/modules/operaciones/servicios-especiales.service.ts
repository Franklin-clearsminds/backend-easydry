import {
  Injectable,
  Optional,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { Alcance, resolverAlcance } from '../../common/permisos/alcance.js';
import {
  normalizarRol,
  rolDeUsuario,
} from '../../common/permisos/alias-roles.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import {
  QueryServicioEspecialDto,
  CreateServicioEspecialDto,
  IniciarServicioEspecialDto,
  CompletarServicioEspecialDto,
  PausarServicioEspecialDto,
  ReanudarServicioEspecialDto,
  ReasignarServicioEspecialDto,
  EditarServicioEspecialDto,
} from './dto/servicios-especiales.dto.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import {
  columnasSimples,
  combinarWhere,
  resolverCampoOrden,
  resolverOrden,
  resolverPaginacion,
  whereBusqueda,
} from '../../common/utils/data-grid.helpers.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ServiciosEspecialesArchivo } from './servicios-especiales-archivo.js';

/** Columnas por las que se puede ordenar la lista de servicios especiales (nombre público → campo de la base). */
const ORDEN_ESPECIALES = columnasSimples({
  fecha: 'createdAt',
  ot: 'ordenTrabajoOT',
  placa: 'placa',
  servicio: 'tipoServicio',
  agencia: 'agencia.nombre',
  region: 'region.nombre',
  operador: 'operador.name',
  estado: 'estado',
  precio: 'precio',
  tiempoPausa: 'tiempoPausaTotalSeg',
  tiempoEfectivo: 'tiempoEfectivoSeg',
});

@Injectable()
export class ServiciosEspecialesService {
  private readonly decisiones: DecisionesService;

  constructor(
    private prisma: PrismaService,
    decisiones?: DecisionesService,
    @Optional() private notifications?: NotificationsService,
    /** Suma al listado de servicios especiales lo que ya se archivó a Parquet. Sin él, el listado lee solo de la base. */
    @Optional() private historico?: HistoricoService,
  ) {
    this.decisiones = decisiones ?? new DecisionesService(prisma);
  }

  /**
   * ¿Puede este usuario ver el servicio especial? País: todos. Región: los de su región. Agencia: los de su agencia.
   * Un pulidor móvil (sin agencia, opera por región) solo ve los que tiene asignados.
   */
  private puedeVer(
    actor: any,
    item: {
      agenciaId?: string | null;
      regionId?: string | null;
      operadorId?: string | null;
      operadoresAsignados?: Array<{ operadorId: string }> | null;
      agencia?: { regionId?: string | null } | null;
    },
  ): boolean {
    const alcance: Alcance = resolverAlcance(actor);
    if (rolDeUsuario(actor) === 'PULIDOR') {
      return (
        item.operadorId === actor.id ||
        Boolean(
          item.operadoresAsignados?.some(
            (asignacion) => asignacion.operadorId === actor.id,
          ),
        )
      );
    }
    switch (alcance.tipo) {
      case 'GLOBAL':
        return true;
      case 'REGION':
        return (
          item.regionId === alcance.regionId ||
          item.agencia?.regionId === alcance.regionId
        );
      case 'AGENCIA':
        return item.agenciaId === alcance.agenciaId;
      case 'PROPIO':
        return item.operadorId === actor.id;
      default:
        return false;
    }
  }

  private asegurarPuedeVer(actor: any, item: any): void {
    if (actor && !this.puedeVer(actor, item)) {
      throw new ForbiddenException(
        'Este servicio especial no pertenece a tu alcance.',
      );
    }
  }

  private _formatItem(item: any) {
    if (!item) return null;

    const formatSeconds = (totalSec: number | null | undefined): string => {
      if (totalSec === null || totalSec === undefined || totalSec <= 0)
        return '0 min';
      const m = Math.floor(totalSec / 60);
      const h = Math.floor(m / 60);
      const remM = m % 60;
      if (h > 0) return `${h}h ${remM}min`;
      return `${m}min`;
    };

    let tiempoPausaTotalActual = Number(item.tiempoPausaTotalSeg || 0);
    if (
      String(item.estado || '').toLowerCase() === 'pausado' &&
      item.fechaUltimaPausa
    ) {
      const segsPausaActual = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(item.fechaUltimaPausa).getTime()) / 1000,
        ),
      );
      tiempoPausaTotalActual += segsPausaActual;
    }

    let tiempoEfectivoCalculado =
      item.tiempoEfectivoSeg !== null && item.tiempoEfectivoSeg !== undefined
        ? Number(item.tiempoEfectivoSeg)
        : null;

    if (tiempoEfectivoCalculado === null && item.fechaInicio) {
      const hasta = item.fechaFin
        ? new Date(item.fechaFin).getTime()
        : Date.now();
      const brutoSeg = Math.max(
        0,
        Math.floor((hasta - new Date(item.fechaInicio).getTime()) / 1000),
      );
      tiempoEfectivoCalculado = Math.max(0, brutoSeg - tiempoPausaTotalActual);
    }

    // Tiempo total = tiempo pausado + tiempo efectivo (equivale a fin - inicio).
    const tiempoTotalCalculado =
      tiempoEfectivoCalculado === null
        ? null
        : tiempoEfectivoCalculado + tiempoPausaTotalActual;

    return {
      ...item,
      agenciaNombre:
        item.agencia?.nombre ||
        (item.region?.nombre
          ? `Zonal ${item.region.nombre}`
          : 'Servicio Móvil Zonal'),
      sucursalNombre:
        item.agencia?.nombre ||
        (item.region?.nombre
          ? `Zonal ${item.region.nombre}`
          : 'Servicio Móvil Zonal'),
      operadorNombre: item.operador
        ? `${item.operador.name} ${item.operador.lastname || ''}`.trim()
        : 'Sin asignar',
      regionNombre: item.region?.nombre || item.regionNombre || '',
      videoInicial: item.videoInicialUrl || null,
      videoFinal: item.videoFinalUrl || null,
      videoPausa: item.videoUltimaPausaUrl || null,
      videoReanudacion: item.videoUltimaReanudacionUrl || null,
      tiempoPausaTotalSeg: tiempoPausaTotalActual,
      tiempoPausaFormateado: formatSeconds(tiempoPausaTotalActual),
      tiempoEfectivoSeg: tiempoEfectivoCalculado,
      tiempoEfectivoFormateado: formatSeconds(tiempoEfectivoCalculado),
      tiempoTotalSeg: tiempoTotalCalculado,
      tiempoTotalFormateado: formatSeconds(tiempoTotalCalculado),
      creadoPorNombre: item.creadoPorNombre || null,
      historialPausas: Array.isArray(item.historialPausas)
        ? item.historialPausas
        : [],
      operadoresIds: Array.isArray(item.operadoresAsignados)
        ? item.operadoresAsignados.map(
            (asignacion: any) => asignacion.operadorId,
          )
        : item.operadorId
          ? [item.operadorId]
          : [],
      operadoresNombres: Array.isArray(item.operadoresAsignados)
        ? item.operadoresAsignados
            .map((asignacion: any) =>
              `${asignacion.operador?.name || ''} ${asignacion.operador?.lastname || ''}`.trim(),
            )
            .filter(Boolean)
        : item.operador
          ? [
              `${item.operador.name || ''} ${item.operador.lastname || ''}`.trim(),
            ]
          : [],
      ordenTrabajoOT: item.ordenTrabajoOT || item.codigoSE || item.id,
      codigoSE: item.codigoSE || item.ordenTrabajoOT || item.id,
      categoriaServicio: 'ESPECIAL',
      servicioNombre: item.tipoServicio,
      servicio: item.tipoServicio,
      cliente: item.clienteNombre || '',
      horaIngreso: item.horaIngreso || null,
      horaEstimada: item.horaEstimada || null,
      horaSalida: item.horaEstimada || null,
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

    // 1. Alcance del usuario (regla única): país, región, agencia o lo propio. Sin usuario o sin dato de su ámbito no ve nada.
    //    Lo que manda el cliente solo acota dentro del alcance, nunca lo amplía.
    const alcance: Alcance = currentUser
      ? resolverAlcance(currentUser)
      : { tipo: 'NINGUNO' };
    const neutro = (v?: string) =>
      v && v !== 'Todas' && v !== 'TODAS' ? v : undefined;
    const pideRegion = neutro(query.regionId);
    const pideAgencia = neutro(query.agenciaId) || neutro(query.sucursalId);
    if (rolDeUsuario(currentUser) === 'PULIDOR') {
      where.OR = [
        { operadorId: currentUser.id },
        { operadoresAsignados: { some: { operadorId: currentUser.id } } },
      ];
    } else
      switch (alcance.tipo) {
        case 'GLOBAL':
          if (pideRegion) where.regionId = pideRegion;
          if (pideAgencia) where.agenciaId = pideAgencia;
          break;
        case 'REGION':
          if (rolDeUsuario(currentUser) === 'PULIDOR') {
            where.OR = [
              { operadorId: currentUser.id },
              { operadoresAsignados: { some: { operadorId: currentUser.id } } },
            ];
          } else {
            where.OR = [
              { regionId: alcance.regionId },
              { agencia: { regionId: alcance.regionId } },
            ];
            if (pideAgencia) where.agenciaId = pideAgencia;
          }
          break;
        case 'AGENCIA':
          if (rolDeUsuario(currentUser) === 'PULIDOR') {
            where.OR = [
              { operadorId: currentUser.id },
              { operadoresAsignados: { some: { operadorId: currentUser.id } } },
            ];
          } else {
            where.agenciaId = alcance.agenciaId;
          }
          break;
        case 'PROPIO':
          where.OR = [
            { operadorId: currentUser.id },
            { operadoresAsignados: { some: { operadorId: currentUser.id } } },
          ];
          break;
        default:
          where.id = { in: [] };
      }

    if (
      query.operadorId &&
      !where.operadorId &&
      rolDeUsuario(currentUser) !== 'PULIDOR'
    ) {
      where.operadorId = query.operadorId;
    }

    if (query.estado && query.estado !== 'Todos' && query.estado !== 'TODOS') {
      const qEst = query.estado.trim();
      if (qEst.toLowerCase() === 'en proceso') {
        where.estado = {
          in: ['En Proceso', 'EN_PROCESO', 'Pendiente', 'PENDIENTE'],
        };
      } else if (
        qEst.toLowerCase() === 'completado' ||
        qEst.toLowerCase() === 'realizado'
      ) {
        where.estado = {
          in: ['Completado', 'FINALIZADO', 'COMPLETADO', 'Finalizado'],
        };
      } else {
        where.estado = { equals: qEst, mode: 'insensitive' };
      }
    }

    if (
      query.tipoServicio &&
      query.tipoServicio !== 'Todos' &&
      query.tipoServicio !== 'TODOS'
    ) {
      where.tipoServicio = {
        contains: query.tipoServicio,
        mode: 'insensitive',
      };
    }

    const busqueda = whereBusqueda(
      [
        'codigoSE',
        'ordenTrabajoOT',
        'placa',
        'modelo',
        'marca',
        'clienteNombre',
        'tipoServicio',
        'operador.name',
        'operador.lastname',
      ],
      query.search,
    );

    const desde = query.fechaDesde ? new Date(query.fechaDesde) : null;
    const hasta = query.fechaHasta ? new Date(query.fechaHasta) : null;
    const rangoFechas = {
      ...(desde && !Number.isNaN(desde.getTime()) ? { gte: desde } : {}),
      ...(hasta && !Number.isNaN(hasta.getTime()) ? { lte: hasta } : {}),
    };

    // El estado va aparte: el resumen por estado usa los mismos filtros pero sin el de estado.
    const { estado: estadoFiltrado, ...whereSinEstado } = where;
    const whereBase = combinarWhere(
      whereSinEstado,
      Object.keys(rangoFechas).length ? { createdAt: rangoFechas } : undefined,
      busqueda,
    );
    const whereFinal = combinarWhere(
      whereBase,
      estadoFiltrado !== undefined ? { estado: estadoFiltrado } : undefined,
    );

    // Un cliente antiguo que no envía tamaño de página recibe hasta 100 (antes, 50).
    const sinTamano = query.pageSize === undefined || query.pageSize === null;
    const { page, pageSize, skip, take } = resolverPaginacion(
      query,
      sinTamano ? { defecto: 100 } : {},
    );
    const orderBy = resolverOrden(
      query.sortField,
      query.sortOrder,
      ORDEN_ESPECIALES,
      { campo: 'fecha', dir: 'desc' },
    );

    // Si el listado toca datos ya archivados, se suman a los de la base con el mismo alcance, filtros, búsqueda y orden. Si no, la
    // consulta es exactamente la de siempre.
    const { campo: campoOrden, dir: dirOrden } = resolverCampoOrden(query.sortField, query.sortOrder, ORDEN_ESPECIALES, { campo: 'fecha', dir: 'desc' });
    const especialesArchivo = this.historico ? new ServiciosEspecialesArchivo(this.prisma, this.historico) : null;
    const quien = { id: currentUser?.id as string | undefined, esPulidor: rolDeUsuario(currentUser) === 'PULIDOR' };
    const archivado = especialesArchivo ? await especialesArchivo.consultar({ params: query, alcance, actor: quien, campo: campoOrden, dir: dirOrden, skip, take }) : null;

    const [itemsBase, totalBase] = await Promise.all([
      this.prisma.servicioEspecial.findMany({
        where: whereFinal,
        // Con archivo, la página se arma mezclando: de la base hacen falta las primeras `skip + take` filas.
        skip: archivado ? 0 : skip,
        take: archivado ? skip + take : take,
        orderBy: orderBy as any,
        include: {
          agencia: { select: { id: true, nombre: true, codigo: true } },
          operador: {
            select: {
              id: true,
              name: true,
              lastname: true,
              email: true,
              regionId: true,
            },
          },
          operadoresAsignados: {
            orderBy: { orden: 'asc' },
            include: {
              operador: { select: { id: true, name: true, lastname: true } },
            },
          },
          region: { select: { id: true, nombre: true, codigo: true } },
        },
      }),
      this.prisma.servicioEspecial.count({ where: whereFinal }),
    ]);
    const items = archivado && especialesArchivo ? especialesArchivo.mezclar(itemsBase as any[], archivado.filas, campoOrden, dirOrden, skip, take) : itemsBase;
    const total = totalBase + (archivado?.total ?? 0);

    const formatted = items.map((i) => this._formatItem(i));
    const respuesta: Record<string, unknown> = {
      ...buildDataGridResponse(formatted, total, page, pageSize),
    };

    if (query.incluirResumen) {
      const porEstado = await this.prisma.servicioEspecial.groupBy({
        by: ['estado'],
        where: whereBase as any,
        _count: { _all: true },
      });
      const conteo: Record<string, number> = {};
      let totalResumen = 0;
      for (const fila of porEstado) {
        conteo[fila.estado] = fila._count._all;
        totalResumen += fila._count._all;
      }
      // Lo archivado (completado o cancelado) también cuenta en el resumen.
      const porEstadoArchivado = especialesArchivo ? await especialesArchivo.resumen({ params: query, alcance, actor: quien }) : null;
      for (const [estado, n] of Object.entries(porEstadoArchivado ?? {})) {
        conteo[estado] = (conteo[estado] ?? 0) + n;
        totalResumen += n;
      }
      respuesta['resumen'] = { porEstado: conteo, total: totalResumen };
    }

    return respuesta;
  }

  async findOneRaw(id: string) {
    const item = await this.prisma.servicioEspecial.findFirst({
      where: {
        OR: [
          { id },
          { clientUuid: id },
          { codigoSE: { equals: id, mode: 'insensitive' } },
          { ordenTrabajoOT: { equals: id, mode: 'insensitive' } },
        ],
      },
      include: {
        agencia: true,
        operador: {
          select: {
            id: true,
            name: true,
            lastname: true,
            email: true,
            regionId: true,
          },
        },
        operadoresAsignados: {
          orderBy: { orden: 'asc' },
          include: {
            operador: { select: { id: true, name: true, lastname: true } },
          },
        },
        region: true,
      },
    });

    if (!item) {
      throw new NotFoundException(`Servicio especial ${id} no encontrado`);
    }

    return item;
  }

  /**
   * Para LEER un servicio especial: de la base y, si ya se archivó (más de 12 meses), del archivo. Las rutas que lo modifican siguen
   * usando `findOneRaw`, que solo mira la base: lo archivado es inmutable y para ellas "no existe".
   */
  private async leerServicio(id: string) {
    try {
      return await this.findOneRaw(id);
    } catch (e) {
      if (!(e instanceof NotFoundException) || !this.historico) throw e;
      const archivado = await new ServiciosEspecialesArchivo(this.prisma, this.historico).detalle(id);
      if (!archivado) throw e;
      return archivado as Awaited<ReturnType<ServiciosEspecialesService['findOneRaw']>>;
    }
  }

  async findOne(id: string, actor?: any) {
    const item = await this.leerServicio(id);
    this.asegurarPuedeVer(actor, item);
    return this._formatItem(item);
  }

  /** Quién anuló este servicio especial y por qué (del más reciente al más antiguo). */
  async historialDecisiones(id: string, actor: any) {
    const item = await this.leerServicio(id);
    this.asegurarPuedeVer(actor, item);
    return this.prisma.auditoriaDecision.findMany({
      where: { entidad: 'SERVICIO_ESPECIAL', entidadId: item.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async create(
    dto: CreateServicioEspecialDto,
    creatorId?: string,
    currentUser?: any,
  ) {
    // Quien crea lo deciden sus casillas, no el nombre del rol: «para mí» y «asignarla a otro pulidor» son independientes.
    const paraMi = tienePermiso(currentUser, 'servicios.especiales.crear');
    const paraOtro = tienePermiso(currentUser, 'servicios.especiales.asignar');
    if (!paraMi && !paraOtro) {
      throw new ForbiddenException(
        'Tu rol no puede crear órdenes de servicios especiales.',
      );
    }

    const clientUuid = dto.clientUuid || randomUUID();
    const rawOT = (dto.ordenTrabajoOT || dto.codigoSE || '')
      .trim()
      .toUpperCase();
    if (!rawOT) {
      throw new BadRequestException(
        'El número de Orden de Trabajo (OT) es obligatorio y debe ser ingresado por el usuario.',
      );
    }

    // La OT de servicios especiales tiene su propio espacio de numeración, independiente del de
    // servicios generales (lavado): el mismo número puede existir una vez en cada uno (decisión
    // de producto, ver PLAN-PERMISOS-Y-ROLES.md). Por eso aquí solo se valida contra otros
    // servicios especiales, nunca contra ServicioLavado.
    const duplicateEspecial = await this.prisma.servicioEspecial.findFirst({
      where: {
        codigoSE: { equals: rawOT, mode: 'insensitive' },
        deletedAt: null,
      },
    });
    if (duplicateEspecial) {
      throw new BadRequestException(
        `La Orden de Trabajo "${rawOT}" ya se encuentra registrada en el sistema. Ingrese un número de OT único.`,
      );
    }

    const codigoSE = rawOT;

    const vInfo = dto.vehiculoInfo || {};
    const placa = (vInfo.placa || (dto as any).placa || '')
      .toUpperCase()
      .trim();
    if (!placa) {
      throw new BadRequestException('La placa del vehículo es obligatoria.');
    }
    const marca = vInfo.marca || (dto as any).marca || null;
    const modelo = vInfo.modelo || (dto as any).modelo || null;
    const color = vInfo.color || (dto as any).color || null;
    const clienteNombre =
      vInfo.cliente || vInfo.clienteNombre || (dto as any).cliente || null;

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

    let finalAgenciaId = dto.agenciaId || null;

    if (dto.agenciaId) {
      finalAgenciaId = dto.agenciaId;
    }

    // El alcance del usuario manda: una agencia solo en su agencia; una región solo en agencias de su región.
    if (currentUser) {
      const alcance = resolverAlcance(currentUser);
      if (alcance.tipo === 'AGENCIA') {
        if (finalAgenciaId && finalAgenciaId !== alcance.agenciaId) {
          throw new ForbiddenException(
            'Solo puedes crear servicios especiales en tu agencia.',
          );
        }
        finalAgenciaId = alcance.agenciaId;
      } else if (alcance.tipo === 'REGION') {
        if (finalAgenciaId) {
          const agenciaSel = await this.prisma.agencia.findUnique({
            where: { id: finalAgenciaId },
            select: { regionId: true },
          });
          if (!agenciaSel || agenciaSel.regionId !== alcance.regionId) {
            throw new ForbiddenException(
              'Esa agencia no pertenece a tu región.',
            );
          }
        }
        finalRegionId = alcance.regionId;
      } else if (alcance.tipo !== 'GLOBAL') {
        throw new ForbiddenException(
          'Tu usuario no tiene agencia ni región asignada para crear servicios especiales.',
        );
      }
    }

    if (finalAgenciaId) {
      const agenciaAsignada = await this.prisma.agencia.findUnique({
        where: { id: finalAgenciaId },
        select: { regionId: true },
      });
      if (!agenciaAsignada) {
        throw new BadRequestException('La agencia seleccionada no existe.');
      }
      finalRegionId = agenciaAsignada.regionId;
    }

    let operadoresIds = [
      ...new Set(
        (dto.operadoresIds?.length
          ? dto.operadoresIds
          : dto.operadorId
            ? [dto.operadorId]
            : []
        )
          .map((id) => String(id).trim())
          .filter(Boolean),
      ),
    ];
    // Con solo «para mí» la OT queda a nombre del creador aunque no mande a nadie. Siempre debe haber un pulidor.
    const creadorId = creatorId || currentUser?.id;
    if (!operadoresIds.length && paraMi && !paraOtro && creadorId) operadoresIds = [String(creadorId)];
    operadoresIds = this.validarAsignacionAlCrear(operadoresIds, creadorId, paraMi, paraOtro, currentUser);
    if (finalAgenciaId) {
      const pulidorFijo = await this.prisma.user.findFirst({
        where: {
          estado: 1,
          agenciaId: finalAgenciaId,
          role: { namerol: 'PULIDOR' },
        },
        select: { id: true },
      });
      if (pulidorFijo) {
        operadoresIds = [
          pulidorFijo.id,
          ...operadoresIds.filter((id) => id !== pulidorFijo.id),
        ];
      }
    }

    if (!operadoresIds.length) {
      throw new BadRequestException(
        'Debe asignar al menos un pulidor para crear la orden de servicio especial.',
      );
    }
    const operadores = await this.prisma.user.findMany({
      where: {
        id: { in: operadoresIds },
        estado: 1,
        role: { namerol: 'PULIDOR' },
      },
      select: { id: true, regionId: true, agencia: { select: { regionId: true } } },
    });
    if (operadores.length !== operadoresIds.length) {
      throw new BadRequestException(
        'Todos los asignados deben ser pulidores activos.',
      );
    }
    // La región del pulidor es la suya o, si es fijo de una agencia, la de esa agencia. Debe ser la de la agencia donde se programa la OT.
    if (
      finalRegionId &&
      operadores.some((operador: any) => {
        const regionPulidor = operador.regionId || operador.agencia?.regionId || null;
        return regionPulidor !== finalRegionId;
      })
    ) {
      throw new BadRequestException(
        'Solo se pueden asignar servicios especiales a pulidores de la misma región de la agencia donde se programa la OT (un pulidor sin región no se puede asignar).',
      );
    }
    const operadorIdFinal = operadoresIds[0];

    // Validar existencias del kit en custodia del pulidor asignado (móvil o fijo)
    let recetaValidada: any[] | null = null;
    if (operadorIdFinal) {
      recetaValidada = await this.assertPulidorTieneInsumosParaOT(
        operadorIdFinal,
        dto.recetaInsumos,
        dto.tipoServicio,
        finalAgenciaId || undefined,
        currentUser?.id,
        'crear',
      );
    } else {
      recetaValidada = Array.isArray(dto.recetaInsumos)
        ? dto.recetaInsumos
        : null;
    }

    // Precio: el que la agencia tiene fijado para ese servicio especial (el catálogo no tiene precio base); se congela en la OT.
    let catalogoEspecial: { id: number; precio: any } | null = null;
    if (dto.servicioCatalogoId) {
      catalogoEspecial = await this.prisma.catalogoServicio.findUnique({
        where: { id: Number(dto.servicioCatalogoId) },
        select: { id: true, precio: true },
      });
    }
    if (!catalogoEspecial && dto.tipoServicio?.trim()) {
      const term = dto.tipoServicio.trim();
      catalogoEspecial = await this.prisma.catalogoServicio.findFirst({
        where: {
          categoria: 'ESPECIAL',
          OR: [
            { nombre: { equals: term, mode: 'insensitive' } },
            { codigo: { equals: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true, precio: true },
      });
    }

    let precioEspecial: number | null = catalogoEspecial ? Number(catalogoEspecial.precio) : null;
    if (catalogoEspecial && finalAgenciaId) {
      const delaAgencia = await this.prisma.precioAgenciaServicio.findUnique({
        where: { agenciaId_catalogoServicioId: { agenciaId: finalAgenciaId, catalogoServicioId: catalogoEspecial.id } },
        select: { precio: true },
      });
      if (delaAgencia) precioEspecial = Number(delaAgencia.precio);
    }

    const created = await this.prisma.servicioEspecial.create({
      data: {
        id: rawOT,
        clientUuid,
        codigoSE,
        ordenTrabajoOT: codigoSE,
        tipoServicio: dto.tipoServicio.trim(),
        servicioCatalogoId: catalogoEspecial?.id ?? null,
        precio: precioEspecial,
        placa,
        marca,
        modelo,
        color,
        clienteNombre,
        cliente: clienteNombre,
        agenciaId: finalAgenciaId,
        bahiaId: dto.bahiaId || null,
        regionId: finalRegionId,
        regionNombre: finalRegionNombre,
        operadorId: operadorIdFinal,
        operadoresAsignados: {
          create: operadoresIds.map((operadorId, orden) => ({
            operadorId,
            orden,
          })),
        },
        creadoPorId: creatorId || currentUser?.id || null,
        creadoPorNombre: currentUser
          ? `${currentUser.name || ''} ${currentUser.lastname || ''}`
              .replace(/(CI:[^)]*)/, '')
              .trim() || null
          : null,
        prioridad: dto.prioridad || 'Media',
        estado: 'Pendiente',
        horaIngreso: dto.horaIngreso || null,
        horaEstimada: dto.horaEstimada || null,
        videoInicialUrl: dto.videoInicialUrl || null,
        recetaInsumos: recetaValidada || dto.recetaInsumos || null,
        evidencias: dto.evidencias || null,
        observaciones: dto.observaciones || null,
      },
      include: {
        agencia: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadoresAsignados: {
          orderBy: { orden: 'asc' },
          include: {
            operador: { select: { id: true, name: true, lastname: true } },
          },
        },
        region: true,
      },
    });

    // Cada asignado recibe la OT; el primero permanece como único operador responsable.
    const destinatarios = operadoresIds.filter(
      (operadorId) => operadorId !== (creatorId || currentUser?.id),
    );
    if (destinatarios.length) {
      void this.notifications?.notificarUsuarios(
        destinatarios,
        'Nuevo servicio especial asignado',
        `${dto.tipoServicio.trim()} · placa ${placa} (OT ${codigoSE})`,
        { type: 'SERVICIO_ESPECIAL_ASIGNADO', servicioEspecialId: created.id },
        {
          tipo: 'SERVICIO_ESPECIAL_ASIGNADO',
          entidadTipo: 'SERVICIO_ESPECIAL',
          entidadId: created.id,
        },
      );
    }

    return this._formatItem(created);
  }

  /**
   * Reglas de a quién se le puede asignar una OT especial al crearla:
   *  - asignársela a uno mismo exige «Crear OT especial (para mí)» y ser pulidor; si se asigna a otros, el creador va primero y es el responsable;
   *  - asignarla solo a otros exige «…asignarla a otro pulidor» y no puede incluir al creador (para eso está «para mí»);
   *  - con alcance de agencia solo se puede asignar a uno mismo: no hay otros pulidores que elegir.
   */
  private validarAsignacionAlCrear(operadoresIds: string[], creadorId: string | undefined, paraMi: boolean, paraOtro: boolean, actor: any): string[] {
    const yo = creadorId ? String(creadorId) : '';
    const incluyeCreador = !!yo && operadoresIds.includes(yo);
    const otros = operadoresIds.filter((id) => id !== yo);
    if (incluyeCreador && !paraMi) {
      throw new ForbiddenException('Tu rol no puede crear órdenes especiales para sí mismo: usa «asignarla a otro pulidor».');
    }
    if (!incluyeCreador && operadoresIds.length > 0 && !paraOtro) {
      throw new ForbiddenException('Tu rol solo puede crear órdenes especiales para sí mismo.');
    }
    if (otros.length > 0 && actor && resolverAlcance(actor).tipo === 'AGENCIA') {
      throw new ForbiddenException('Con alcance de agencia solo puedes asignarte a ti mismo.');
    }
    // El creador que se la asigna a sí mismo es el responsable (va primero); los demás lo acompañan.
    return incluyeCreador ? [yo, ...otros] : operadoresIds;
  }

  /**
   * Corrige los datos del vehículo, el cliente, la prioridad y las observaciones de un servicio especial. Solo mientras no esté
   * completado ni cancelado; el pulidor, la receta y las evidencias no se tocan desde aquí (para eso están reasignar y ejecutar).
   */
  async editar(dto: EditarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);
    if (item.deletedAt) throw new BadRequestException('El servicio especial está anulado y no se puede modificar.');
    const estado = String(item.estado || '').toUpperCase();
    if (estado.includes('COMPLET') || estado.includes('FINAL') || estado.includes('CANCEL')) {
      throw new BadRequestException('No se puede editar un servicio especial completado o cancelado.');
    }
    this.asegurarPuedeVer(currentUser, item);

    const data: Record<string, any> = {};
    const texto = (v: string | undefined) => String(v ?? '').trim();
    if (dto.placa !== undefined) {
      const placa = texto(dto.placa).toUpperCase();
      if (!placa) throw new BadRequestException('La placa no puede quedar vacía.');
      data.placa = placa;
    }
    if (dto.modelo !== undefined) data.modelo = texto(dto.modelo) || null;
    if (dto.marca !== undefined) data.marca = texto(dto.marca) || null;
    if (dto.color !== undefined) data.color = texto(dto.color) || null;
    if (dto.cliente !== undefined) {
      data.cliente = texto(dto.cliente) || null;
      data.clienteNombre = data.cliente;
    }
    if (dto.prioridad !== undefined) data.prioridad = dto.prioridad;
    if (dto.observaciones !== undefined) data.observaciones = texto(dto.observaciones) || null;

    // Cambiar el servicio: como en las OT generales, se recalcula el precio y la receta. Los insumos de una OT especial se descuentan
    // del kit del pulidor responsable al finalizarla, así que aquí solo se comprueba que su kit alcance para el nuevo servicio.
    if (dto.servicioCatalogoId != null && Number(dto.servicioCatalogoId) !== Number(item.servicioCatalogoId)) {
      const catalogo = await this.prisma.catalogoServicio.findUnique({
        where: { id: Number(dto.servicioCatalogoId) },
        select: { id: true, nombre: true, categoria: true, estado: true, precio: true },
      });
      if (!catalogo) throw new BadRequestException('El servicio indicado no existe en el catálogo.');
      if (catalogo.estado === 'Inactivo') throw new BadRequestException(`El servicio "${catalogo.nombre}" está inactivo y no se puede usar.`);
      if (catalogo.categoria !== 'ESPECIAL') throw new BadRequestException('Solo se puede cambiar a otro servicio especial.');
      if (item.operadorId) {
        data.recetaInsumos = await this.assertPulidorTieneInsumosParaOT(
          item.operadorId,
          null,
          catalogo.nombre,
          item.agenciaId || undefined,
          currentUser?.id,
          'editar',
        );
      }
      let precio: number | null = catalogo.precio != null ? Number(catalogo.precio) : null;
      if (item.agenciaId) {
        const delaAgencia = await this.prisma.precioAgenciaServicio.findUnique({
          where: { agenciaId_catalogoServicioId: { agenciaId: item.agenciaId, catalogoServicioId: catalogo.id } },
          select: { precio: true },
        });
        if (delaAgencia) precio = Number(delaAgencia.precio);
      }
      data.servicioCatalogoId = catalogo.id;
      data.tipoServicio = catalogo.nombre;
      data.precio = precio;
    }
    if (Object.keys(data).length === 0) return this._formatItem(item);

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: { ...data, version: item.version + 1 },
      include: {
        agencia: true,
        operador: { select: { id: true, name: true, lastname: true, email: true } },
        operadoresAsignados: {
          orderBy: { orden: 'asc' },
          include: { operador: { select: { id: true, name: true, lastname: true } } },
        },
        region: true,
      },
    });
    return this._formatItem(updated);
  }

  async reasignar(dto: ReasignarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);
    const estado = String(item.estado || '').toUpperCase();
    if (
      estado.includes('COMPLET') ||
      estado.includes('FINAL') ||
      estado.includes('CANCEL')
    ) {
      throw new BadRequestException(
        'No se puede reasignar un servicio finalizado o cancelado.',
      );
    }

    this.asegurarPuedeVer(currentUser, item);
    // Reasignar va dentro de «Editar OT especial», pero solo con «asignarla a otro pulidor».
    if (currentUser && !tienePermiso(currentUser, 'servicios.especiales.asignar')) {
      throw new ForbiddenException('Tu rol no puede reasignar el pulidor: necesita «Crear OT especial y asignarla a otro pulidor».');
    }

    const normalizarOperadorId = (id: string | null | undefined) => {
      const raw = id == null ? '' : String(id).trim();
      return !raw || raw === '0' || raw.toLowerCase() === 'null' ? '' : raw;
    };
    let operadoresIds = [
      ...new Set(
        (dto.operadoresIds?.length ? dto.operadoresIds : [dto.operadorId || ''])
          .map(normalizarOperadorId)
          .filter(Boolean),
      ),
    ];

    if (!operadoresIds.length) {
      throw new BadRequestException('La OT especial siempre debe tener un pulidor asignado.');
    }
    if (currentUser && resolverAlcance(currentUser).tipo === 'AGENCIA' && operadoresIds.some((id) => id !== String(currentUser.id))) {
      throw new ForbiddenException('Con alcance de agencia solo puedes asignarte a ti mismo.');
    }

    // Un pulidor fijo debe permanecer como responsable principal; se pueden añadir otros asignados.
    if (item.agenciaId) {
      const pulidorFijo = await this.prisma.user.findFirst({
        where: {
          estado: 1,
          agenciaId: item.agenciaId,
          role: { namerol: 'PULIDOR' },
        },
        select: { id: true },
      });
      if (pulidorFijo && !operadoresIds.includes(pulidorFijo.id)) {
        throw new BadRequestException(
          'Esta agencia tiene un pulidor fijo asignado permanentemente: debe incluirse en la asignación.',
        );
      }
      if (pulidorFijo) {
        operadoresIds = [
          pulidorFijo.id,
          ...operadoresIds.filter((id) => id !== pulidorFijo.id),
        ];
      }
    }

    const operadores = operadoresIds.length
      ? await this.prisma.user.findMany({
          where: {
            id: { in: operadoresIds },
            estado: 1,
            role: { namerol: 'PULIDOR' },
          },
          select: {
            id: true,
            regionId: true,
            agencia: { select: { regionId: true } },
          },
        })
      : [];
    if (operadores.length !== operadoresIds.length) {
      const validos = new Set(operadores.map((o) => o.id));
      const invalidos = await this.prisma.user.findMany({
        where: { id: { in: operadoresIds.filter((id) => !validos.has(id)) } },
        select: { name: true, lastname: true },
      });
      const nombres = invalidos.map((u) => `${u.name || ''} ${u.lastname || ''}`.trim()).filter(Boolean).join(', ');
      throw new BadRequestException(
        `Todos los asignados deben ser pulidores activos${nombres ? `: ${nombres} no lo es` : ''}.`,
      );
    }
    const regionServicio = item.regionId || item.agencia?.regionId || null;
    if (
      regionServicio &&
      operadores.some((destino) => {
        const regionDestino =
          destino.regionId || destino.agencia?.regionId || null;
        return regionDestino !== regionServicio;
      })
    ) {
      throw new BadRequestException(
        'Solo se puede reasignar a pulidores de la misma región del servicio (un pulidor sin región no se puede asignar).',
      );
    }

    const operadorIdFinal = operadoresIds[0] || null;
    if (operadorIdFinal) {
      await this.assertPulidorTieneInsumosParaOT(
        operadorIdFinal,
        dto.recetaInsumos || item.recetaInsumos,
        dto.tipoServicio || item.tipoServicio,
        item.agenciaId || undefined,
        currentUser?.id,
        'reasignar',
      );
    }

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        operadorId: operadorIdFinal,
        operadoresAsignados: {
          deleteMany: {},
          ...(operadoresIds.length
            ? {
                create: operadoresIds.map((operadorId, orden) => ({
                  operadorId,
                  orden,
                })),
              }
            : {}),
        },
        version: item.version + 1,
      },
      include: {
        agencia: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadoresAsignados: {
          orderBy: { orden: 'asc' },
          include: {
            operador: { select: { id: true, name: true, lastname: true } },
          },
        },
        region: true,
      },
    });

    const destinatarios = operadoresIds.filter(
      (operadorId) => operadorId !== currentUser?.id,
    );
    if (destinatarios.length) {
      void this.notifications?.notificarUsuarios(
        destinatarios,
        'Servicio especial reasignado a ti',
        `${updated.tipoServicio} · placa ${updated.placa} (OT ${updated.ordenTrabajoOT || updated.id})`,
        { type: 'SERVICIO_ESPECIAL_ASIGNADO', servicioEspecialId: updated.id },
        {
          tipo: 'SERVICIO_ESPECIAL_ASIGNADO',
          entidadTipo: 'SERVICIO_ESPECIAL',
          entidadId: updated.id,
        },
      );
    }

    return this._formatItem(updated);
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
    contexto: 'crear' | 'reasignar' | 'editar' = 'crear',
  ): Promise<any[]> {
    const prefijo =
      contexto === 'reasignar'
        ? 'No se puede reasignar'
        : contexto === 'editar'
          ? 'No se puede cambiar el servicio'
          : 'No puede crear la OT';
    let items: any[] = Array.isArray(recetaInsumos) ? [...recetaInsumos] : [];

    if (items.length === 0 && tipoServicio?.trim()) {
      const term = tipoServicio.trim();
      const cat = await this.prisma.catalogoServicio.findFirst({
        where: {
          OR: [
            { nombre: { equals: term, mode: 'insensitive' } },
            { codigo: { equals: term, mode: 'insensitive' } },
            { nombre: { contains: term, mode: 'insensitive' } },
          ],
        },
        include: {
          recetas: {
            include: {
              insumo: { select: { id: true, nombre: true, codigoSKU: true } },
              unidadConsumo: { select: { simbolo: true, factorBase: true } },
            },
          },
        },
      });
      if (cat?.recetas?.length) {
        items = cat.recetas.map((r) => {
          const factor = r.unidadConsumo?.factorBase
            ? Number(r.unidadConsumo.factorBase)
            : 1;
          const cantidadBase = Number(r.cantidadUsada) * (factor || 1);
          return {
            productoId: r.insumoId,
            insumoId: r.insumoId,
            productoSKU: r.insumo?.codigoSKU,
            codigoSKU: r.insumo?.codigoSKU,
            productoNombre: r.insumo?.nombre,
            insumoNombre: r.insumo?.nombre,
            unidadMedida: r.unidadConsumo?.simbolo || 'u',
            cantidadSugerida: cantidadBase,
            cantidad: cantidadBase,
          };
        });
      }
    }

    const stocks = await this.prisma.stockUbicacion.findMany({
      where: { pulidorId: operadorId },
      include: {
        insumo: { select: { id: true, nombre: true, codigoSKU: true } },
      },
    });

    const stockPorInsumo = new Map<string, number>();
    for (const s of stocks) {
      stockPorInsumo.set(
        String(s.insumoId),
        (stockPorInsumo.get(String(s.insumoId)) || 0) +
          Number(s.cantidadActual),
      );
      if (s.insumo?.codigoSKU) {
        stockPorInsumo.set(
          String(s.insumo.codigoSKU).toLowerCase(),
          (stockPorInsumo.get(String(s.insumo.codigoSKU).toLowerCase()) || 0) +
            Number(s.cantidadActual),
        );
      }
    }

    const totalKit = stocks.reduce(
      (a, s) => a + Number(s.cantidadActual || 0),
      0,
    );
    if (totalKit <= 0) {
      throw new BadRequestException(
        `${prefijo}: el pulidor no tiene insumos en su kit. Solicite un despacho antes de asignarle el servicio.`,
      );
    }

    if (items.length === 0) {
      throw new BadRequestException(
        `${prefijo}: el servicio no tiene receta de insumos configurada o el kit no puede validarse.`,
      );
    }

    const resolveHave = (it: any): number => {
      const ids = [it.insumoId, it.productoId, it.id]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      for (const id of ids) {
        if (stockPorInsumo.has(id)) return stockPorInsumo.get(id) || 0;
        if (stockPorInsumo.has(id.toLowerCase()))
          return stockPorInsumo.get(id.toLowerCase()) || 0;
      }
      const sku = String(it.codigoSKU || it.productoSKU || it.sku || '')
        .trim()
        .toLowerCase();
      if (sku && stockPorInsumo.has(sku)) return stockPorInsumo.get(sku) || 0;
      const nombre = String(
        it.productoNombre || it.insumoNombre || it.nombre || '',
      )
        .trim()
        .toLowerCase();
      const match = stocks.find((s) => {
        const sSku = String(s.insumo?.codigoSKU || '')
          .trim()
          .toLowerCase();
        const sName = String(s.insumo?.nombre || '')
          .trim()
          .toLowerCase();
        return (sku && sSku === sku) || (nombre && sName === nombre);
      });
      return match ? Number(match.cantidadActual) : 0;
    };

    const faltantes: string[] = [];
    for (const it of items) {
      const need = Number(it.cantidadSugerida ?? it.cantidad ?? 0);
      if (need <= 0) continue;
      const have = resolveHave(it);
      if (have < need) {
        const label =
          it.productoNombre ||
          it.insumoNombre ||
          it.nombre ||
          it.codigoSKU ||
          it.productoId ||
          'Insumo';
        faltantes.push(`${label}: requiere ${need}, disponible ${have}`);
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
        console.warn(
          'No se pudo registrar alerta de stock para pulidor:',
          errAlerta,
        );
      }

      throw new BadRequestException(
        `${prefijo}: insumos insuficientes en el kit del pulidor. ${faltantes.join('; ')}`,
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
    if (
      item.estado.toUpperCase() === 'COMPLETADO' ||
      item.estado.toUpperCase() === 'FINALIZADO'
    ) {
      throw new BadRequestException(
        'El servicio especial ya ha sido finalizado.',
      );
    }

    if (
      String(item.estado || '').toLowerCase() === 'en proceso' &&
      dto.videoInicialUrl &&
      item.videoInicialUrl === dto.videoInicialUrl
    ) {
      return this._formatItem(item);
    }

    // Sin la evidencia de inicio (video del estado inicial del vehículo) no se puede iniciar el servicio.
    if (currentUser && !dto.videoInicialUrl && !item.videoInicialUrl) {
      throw new BadRequestException(
        'La evidencia de inicio (video del estado inicial del vehículo) es obligatoria para iniciar el servicio especial.',
      );
    }

    const rol = rolDeUsuario(currentUser);
    // Quién puede operar el servicio de cualquier pulidor (no solo el suyo) depende del permiso
    // 'especiales.reasignar' —el mismo que rige reasignarlo a otro—, no del nombre del rol: si se edita ese
    // permiso desde Roles y Permisos, este comportamiento cambia con él.
    const puedeActuarSobreCualquiera = tienePermiso(
      currentUser,
      'especiales.reasignar',
    );
    const isPulidor = rol === 'PULIDOR' && !puedeActuarSobreCualquiera;

    // Solo el pulidor asignado a esta OT o un Admin/SuperAdmin puede iniciarla
    if (isPulidor && item.operadorId && item.operadorId !== currentUser?.id) {
      throw new ForbiddenException(
        'Solo el pulidor asignado a esta orden de trabajo puede iniciar el servicio.',
      );
    }

    // El operadorId que manda el cliente solo se usa para asignar (cuando aún no hay uno) si el actor tiene
    // permiso de reasignar; si no, se queda con el que ya tenía el servicio o, si no tenía, con el propio actor.
    // Nunca se toma un id de un tercero como respaldo (D3).
    const operadorIdFinal =
      item.operadorId ??
      (puedeActuarSobreCualquiera && dto.operadorId
        ? dto.operadorId
        : currentUser?.id);

    const data: any = {
      estado: 'En Proceso',
      fechaInicio: item.fechaInicio || new Date(),
      operadorId: operadorIdFinal,
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
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadoresAsignados: {
          orderBy: { orden: 'asc' },
          include: {
            operador: { select: { id: true, name: true, lastname: true } },
          },
        },
        region: true,
      },
    });

    return this._formatItem(updated);
  }

  async pausar(dto: PausarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);

    const rol = rolDeUsuario(currentUser);
    // Quién puede operar el servicio de cualquier pulidor (no solo el suyo) depende del permiso
    // 'especiales.reasignar' —el mismo que rige reasignarlo a otro—, no del nombre del rol: si se edita ese
    // permiso desde Roles y Permisos, este comportamiento cambia con él.
    const puedeActuarSobreCualquiera = tienePermiso(
      currentUser,
      'especiales.reasignar',
    );
    const isPulidor = rol === 'PULIDOR' && !puedeActuarSobreCualquiera;

    if (isPulidor && item.operadorId && item.operadorId !== currentUser?.id) {
      throw new ForbiddenException(
        'Solo el pulidor asignado a esta orden de trabajo puede pausar el servicio.',
      );
    }

    // Solo se aceptan enlaces reales (S3). Una ruta local del dispositivo (file://) no sirve
    // a nadie más: el enlace correcto llega después, al confirmarse la subida del video.
    const videoPausaUrl = this._esUrlRemota(dto.videoPausaUrl)
      ? dto.videoPausaUrl
      : undefined;

    if (String(item.estado || '').toLowerCase() === 'pausado') {
      if (!videoPausaUrl || item.videoUltimaPausaUrl === videoPausaUrl) {
        return this._formatItem(item);
      }
      const historialActual: any[] = Array.isArray(item.historialPausas)
        ? [...item.historialPausas]
        : [];
      if (historialActual.length > 0) {
        const lastIdx = historialActual.length - 1;
        historialActual[lastIdx] = {
          ...historialActual[lastIdx],
          videoPausaUrl,
          motivo: dto.motivo || historialActual[lastIdx].motivo,
        };
      }
      const updated = await this.prisma.servicioEspecial.update({
        where: { id: item.id },
        data: {
          videoUltimaPausaUrl: videoPausaUrl,
          videoPausaUrl,
          motivoUltimaPausa: dto.motivo || item.motivoUltimaPausa,
          historialPausas: historialActual,
          version: item.version + 1,
        },
        include: {
          agencia: true,
          operador: {
            select: { id: true, name: true, lastname: true, email: true },
          },
          operadoresAsignados: {
            orderBy: { orden: 'asc' },
            include: {
              operador: { select: { id: true, name: true, lastname: true } },
            },
          },
          region: true,
        },
      });
      return this._formatItem(updated);
    }

    if (String(item.estado || '').toLowerCase() !== 'en proceso') {
      throw new BadRequestException(
        'Solo se pueden pausar servicios que se encuentren "En Proceso".',
      );
    }

    const fechaPausa = new Date();
    const pauseId = randomUUID();
    const historialActual: any[] = Array.isArray(item.historialPausas)
      ? [...item.historialPausas]
      : [];

    historialActual.push({
      id: pauseId,
      fechaInicio: fechaPausa.toISOString(),
      fechaFin: null,
      duracionSegundos: 0,
      motivo: dto.motivo,
      videoPausaUrl: videoPausaUrl ?? null,
      videoReanudacionUrl: null,
      usuarioId: currentUser?.id || null,
      usuarioNombre: currentUser?.name
        ? `${currentUser.name} ${currentUser.lastname || ''}`.trim()
        : null,
    });

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        estado: 'Pausado',
        fechaUltimaPausa: fechaPausa,
        motivoUltimaPausa: dto.motivo,
        // Una pausa nueva no hereda el video de la pausa anterior.
        videoUltimaPausaUrl: videoPausaUrl ?? null,
        videoPausaUrl: videoPausaUrl ?? null,
        historialPausas: historialActual,
        version: item.version + 1,
      },
      include: {
        agencia: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadoresAsignados: {
          orderBy: { orden: 'asc' },
          include: {
            operador: { select: { id: true, name: true, lastname: true } },
          },
        },
        region: true,
      },
    });

    return this._formatItem(updated);
  }

  async reanudar(dto: ReanudarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);

    const rol = rolDeUsuario(currentUser);
    // Quién puede operar el servicio de cualquier pulidor (no solo el suyo) depende del permiso
    // 'especiales.reasignar' —el mismo que rige reasignarlo a otro—, no del nombre del rol: si se edita ese
    // permiso desde Roles y Permisos, este comportamiento cambia con él.
    const puedeActuarSobreCualquiera = tienePermiso(
      currentUser,
      'especiales.reasignar',
    );
    const isPulidor = rol === 'PULIDOR' && !puedeActuarSobreCualquiera;

    if (isPulidor && item.operadorId && item.operadorId !== currentUser?.id) {
      throw new ForbiddenException(
        'Solo el pulidor asignado a esta orden de trabajo puede reanudar el servicio.',
      );
    }

    // Solo enlaces reales (S3): las rutas locales (file://) se ignoran, el enlace llega al confirmar la subida.
    const videoReanudarUrl = this._esUrlRemota(dto.videoReanudarUrl)
      ? dto.videoReanudarUrl
      : undefined;

    const estadoActual = String(item.estado || '').toLowerCase();
    if (estadoActual === 'en proceso') {
      if (
        !videoReanudarUrl ||
        item.videoUltimaReanudacionUrl === videoReanudarUrl
      ) {
        return this._formatItem(item);
      }
      // Ya estaba reanudado: el video se vincula al último ciclo del historial (antes solo
      // se actualizaban los campos sueltos y el historial conservaba la ruta local).
      const historialEnProceso: any[] = Array.isArray(item.historialPausas)
        ? [...item.historialPausas]
        : [];
      if (historialEnProceso.length > 0) {
        const lastIdx = historialEnProceso.length - 1;
        historialEnProceso[lastIdx] = {
          ...historialEnProceso[lastIdx],
          videoReanudacionUrl: videoReanudarUrl,
        };
      }
      const updated = await this.prisma.servicioEspecial.update({
        where: { id: item.id },
        data: {
          videoUltimaReanudacionUrl: videoReanudarUrl,
          videoReanudacionUrl: videoReanudarUrl,
          historialPausas: historialEnProceso,
          version: item.version + 1,
        },
        include: {
          agencia: true,
          operador: {
            select: { id: true, name: true, lastname: true, email: true },
          },
          operadoresAsignados: {
            orderBy: { orden: 'asc' },
            include: {
              operador: { select: { id: true, name: true, lastname: true } },
            },
          },
          region: true,
        },
      });
      return this._formatItem(updated);
    }

    if (estadoActual !== 'pausado') {
      throw new BadRequestException('El servicio no se encuentra pausado.');
    }

    const fechaReanudar = new Date();
    let duracionPausaSeg = 0;
    if (item.fechaUltimaPausa) {
      duracionPausaSeg = Math.max(
        0,
        Math.floor(
          (fechaReanudar.getTime() -
            new Date(item.fechaUltimaPausa).getTime()) /
            1000,
        ),
      );
    }
    const nuevoTiempoPausaTotalSeg =
      Number(item.tiempoPausaTotalSeg || 0) + duracionPausaSeg;

    const historialActual: any[] = Array.isArray(item.historialPausas)
      ? [...item.historialPausas]
      : [];
    if (historialActual.length > 0) {
      const lastIdx = historialActual.length - 1;
      historialActual[lastIdx] = {
        ...historialActual[lastIdx],
        fechaFin: fechaReanudar.toISOString(),
        duracionSegundos: duracionPausaSeg,
        videoReanudacionUrl: videoReanudarUrl ?? null,
        observacionesReanudar: dto.observaciones || null,
      };
    }

    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        estado: 'En Proceso',
        tiempoPausaTotalSeg: nuevoTiempoPausaTotalSeg,
        fechaUltimaPausa: null,
        // Un ciclo nuevo no hereda el video de reanudación del anterior.
        videoUltimaReanudacionUrl: videoReanudarUrl ?? null,
        videoReanudacionUrl: videoReanudarUrl ?? null,
        historialPausas: historialActual,
        version: item.version + 1,
      },
      include: {
        agencia: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        region: true,
      },
    });

    return this._formatItem(updated);
  }

  private _esUrlRemota(url?: string | null): boolean {
    return !!url && /^https?:\/\//i.test(String(url).trim());
  }

  /**
   * Vincula el video (ya subido a S3) de una pausa o de una reanudación al ciclo correcto del
   * historial. Lo usa la confirmación de subida de la app. Es idempotente y NUNCA cambia el estado
   * del servicio salvo que la pausa/reanudación aún no se hubiera registrado (caso sin conexión):
   * una confirmación tardía o repetida ya no vuelve a pausar, ni falla para siempre.
   */
  async adjuntarVideoCiclo(
    tipo: 'PAUSA' | 'REANUDACION',
    params: {
      id: string;
      url: string;
      motivo?: string;
      observaciones?: string;
      capturadoEn?: string;
    },
    currentUser?: any,
  ) {
    const item = await this.findOneRaw(params.id);
    const estado = String(item.estado || '').toLowerCase();

    // Pausa/reanudación aún no registrada en el servidor (se hizo sin conexión): flujo completo.
    if (tipo === 'PAUSA' && estado === 'pausado') {
      return this.pausar(
        {
          id: params.id,
          motivo: params.motivo || '',
          videoPausaUrl: params.url,
        } as any,
        currentUser,
      );
    }
    // También cuando ya está "en proceso": si la reanudación offline ya llegó por su propio
    // endpoint (sin conexión real, el cliente la aplica igual y la reintenta al reconectar) y el
    // video queda confirmando después, `reanudar()` ya sabe vincularlo al último ciclo del
    // historial (ver su rama `estadoActual === 'en proceso'`). Sin este caso, el video caía en el
    // flujo genérico de abajo, que puede no encontrar un ciclo pendiente (`idx === -1`) y responder
    // 200 sin vincular nada: el móvil interpreta eso como éxito y borra su única copia del archivo.
    if (
      tipo === 'REANUDACION' &&
      (estado === 'pausado' || estado === 'en proceso')
    ) {
      return this.reanudar(
        {
          id: params.id,
          videoReanudarUrl: params.url,
          observaciones: params.observaciones,
        } as any,
        currentUser,
      );
    }

    const campo = tipo === 'PAUSA' ? 'videoPausaUrl' : 'videoReanudacionUrl';
    const historial: any[] = Array.isArray(item.historialPausas)
      ? [...item.historialPausas]
      : [];

    // Ciclo más reciente que todavía no tiene un video real vinculado.
    let idx = -1;
    for (let i = historial.length - 1; i >= 0; i--) {
      if (!this._esUrlRemota(historial[i]?.[campo])) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      if (tipo === 'PAUSA' && estado === 'en proceso') {
        // ¿Es una pausa nueva hecha sin conexión, o una confirmación tardía de un ciclo ya cerrado?
        const ultimo = historial[historial.length - 1];
        const capturadoEn = params.capturadoEn
          ? new Date(params.capturadoEn)
          : null;
        const esNueva =
          historial.length === 0 ||
          (!!capturadoEn &&
            !Number.isNaN(capturadoEn.getTime()) &&
            !!ultimo?.fechaFin &&
            capturadoEn.getTime() > new Date(ultimo.fechaFin).getTime());
        if (esNueva) {
          return this.pausar(
            {
              id: params.id,
              motivo: params.motivo || '',
              videoPausaUrl: params.url,
            } as any,
            currentUser,
          );
        }
      }
      // Ya estaba vinculado (o no hay ciclo al que atarlo): no hay nada que hacer. Se deja registro
      // porque el móvil borra su copia local al recibir 200 — si esto no era realmente un duplicado,
      // el video se pierde sin aviso.
      console.warn(
        `[ServiciosEspeciales] adjuntarVideoCiclo(${tipo}) sin ciclo pendiente para ${item.codigoSE || item.id} (estado=${estado}); video no vinculado: ${params.url}`,
      );
      return this._formatItem(item);
    }

    historial[idx] = { ...historial[idx], [campo]: params.url };
    const esUltimo = idx === historial.length - 1;
    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        historialPausas: historial,
        ...(esUltimo && tipo === 'PAUSA'
          ? { videoUltimaPausaUrl: params.url, videoPausaUrl: params.url }
          : {}),
        ...(esUltimo && tipo === 'REANUDACION'
          ? {
              videoUltimaReanudacionUrl: params.url,
              videoReanudacionUrl: params.url,
            }
          : {}),
        version: item.version + 1,
      },
      include: {
        agencia: true,
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        region: true,
      },
    });
    return this._formatItem(updated);
  }

  async completar(dto: CompletarServicioEspecialDto, currentUser?: any) {
    const item = await this.findOneRaw(dto.id);

    const rol = rolDeUsuario(currentUser);
    // Quién puede operar el servicio de cualquier pulidor (no solo el suyo) depende del permiso
    // 'especiales.reasignar' —el mismo que rige reasignarlo a otro—, no del nombre del rol: si se edita ese
    // permiso desde Roles y Permisos, este comportamiento cambia con él.
    const puedeActuarSobreCualquiera = tienePermiso(
      currentUser,
      'especiales.reasignar',
    );
    const isPulidor = rol === 'PULIDOR' && !puedeActuarSobreCualquiera;

    // Solo el pulidor asignado a esta OT o un Admin/SuperAdmin puede completarla
    if (isPulidor && item.operadorId && item.operadorId !== currentUser?.id) {
      throw new ForbiddenException(
        'Solo el pulidor asignado a esta orden de trabajo puede finalizar el servicio.',
      );
    }

    if (String(item.estado || '').toLowerCase() === 'completado') {
      try {
        await this.descontarKitPulidorSiPendiente(item.id);
      } catch (error: any) {
        console.warn(
          `[ServiciosEspeciales] No se pudo descontar el kit del servicio ${item.codigoSE || item.id}: ${error?.message || error}`,
        );
      }
      const data: any = { version: item.version + 1 };
      if (dto.videoFinalUrl && dto.videoFinalUrl !== item.videoFinalUrl)
        data.videoFinalUrl = dto.videoFinalUrl;
      if (dto.observaciones) {
        data.observaciones = dto.observaciones;
        data.notasOperador = dto.observaciones;
      }
      if (Object.keys(data).length === 1) return this._formatItem(item);
      const already = await this.prisma.servicioEspecial.update({
        where: { id: item.id },
        data,
        include: {
          agencia: true,
          operador: {
            select: { id: true, name: true, lastname: true, email: true },
          },
          region: true,
        },
      });
      return this._formatItem(already);
    }

    const fechaFin = new Date();
    let tiempoPausaTotal = Number(item.tiempoPausaTotalSeg || 0);
    const historialActual: any[] = Array.isArray(item.historialPausas)
      ? [...item.historialPausas]
      : [];

    // Si estaba pausado al momento de completar, cerrar la pausa activa
    if (
      String(item.estado || '').toLowerCase() === 'pausado' &&
      item.fechaUltimaPausa
    ) {
      const duracionPausaActual = Math.max(
        0,
        Math.floor(
          (fechaFin.getTime() - new Date(item.fechaUltimaPausa).getTime()) /
            1000,
        ),
      );
      tiempoPausaTotal += duracionPausaActual;
      if (historialActual.length > 0) {
        const lastIdx = historialActual.length - 1;
        historialActual[lastIdx] = {
          ...historialActual[lastIdx],
          fechaFin: fechaFin.toISOString(),
          duracionSegundos: duracionPausaActual,
        };
      }
    }

    // Cálculo del tiempo efectivo de trabajo
    const fInicio = item.fechaInicio
      ? new Date(item.fechaInicio).getTime()
      : fechaFin.getTime();
    const tiempoBrutoSeg = Math.max(
      0,
      Math.floor((fechaFin.getTime() - fInicio) / 1000),
    );
    const tiempoEfectivoSeg = Math.max(0, tiempoBrutoSeg - tiempoPausaTotal);

    const data: any = {
      estado: 'Completado',
      fechaFin,
      tiempoPausaTotalSeg: tiempoPausaTotal,
      tiempoEfectivoSeg,
      fechaUltimaPausa: null,
      historialPausas: historialActual,
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
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        region: true,
      },
    });

    try {
      await this.descontarKitPulidorSiPendiente(item.id);
    } catch (error: any) {
      console.warn(
        `[ServiciosEspeciales] No se pudo descontar el kit del servicio ${item.codigoSE || item.id}: ${error?.message || error}`,
      );
    }

    void this.notificarCierreServicioEspecial(updated, 'completado');

    return this._formatItem(updated);
  }

  /** Avisa el cierre (completado o cancelado) de un servicio especial: admin/super admin, coordinador
   * de servicios especiales y el supervisor de la región del servicio. Nunca bloquea el flujo. */
  private async notificarCierreServicioEspecial(
    item: {
      id: string;
      tipoServicio: string;
      placa: string;
      ordenTrabajoOT?: string | null;
      regionId?: string | null;
    },
    estado: 'completado' | 'cancelado',
  ): Promise<void> {
    if (!this.notifications) return;
    const ids = await this.notifications.resolverDestinatariosPorRol({
      global: ['ADMIN', 'SUPER_ADMIN', 'COORD_SERVICIOS_ESPECIALES'],
      regionales: ['SUPERVISOR'],
      regionId: item.regionId,
    });
    if (!ids.length) return;
    void this.notifications.notificarUsuarios(
      ids,
      `Servicio especial ${estado}`,
      `${item.tipoServicio} · placa ${item.placa} (OT ${item.ordenTrabajoOT || item.id})`,
      { type: 'SERVICIO_ESPECIAL_CERRADO', servicioEspecialId: item.id },
      {
        tipo: 'SERVICIO_ESPECIAL_CERRADO',
        entidadTipo: 'SERVICIO_ESPECIAL',
        entidadId: item.id,
      },
    );
  }

  /**
   * Descuenta del kit del pulidor la receta de un servicio especial completado.
   * Idempotente: se ejecuta una sola vez por servicio aunque llegue por la API y por la cola offline.
   */
  async descontarKitPulidorSiPendiente(servicioId: string) {
    const item = await this.prisma.servicioEspecial.findUnique({
      where: { id: servicioId },
    });
    if (!item?.operadorId || !Array.isArray(item.recetaInsumos)) return;
    if (String(item.estado || '').toLowerCase() !== 'completado') return;

    const operadorId = item.operadorId;
    const referencia = item.codigoSE || item.id;
    const referencias = [item.codigoSE, item.id].filter(Boolean) as string[];
    const alertas: Array<{
      insumoId: string;
      nombre: string;
      nuevaCant: number;
      minimo: number;
    }> = [];

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`SE_KIT_${item.id}`}))`;

        const yaDescontado = await tx.kardexMovimiento.findFirst({
          where: {
            tipoMovimiento: 'CONSUMO_SERVICIO_ESPECIAL',
            referenciaId: { in: referencias },
          },
          select: { id: true },
        });
        if (yaDescontado) return;

        for (const ins of item.recetaInsumos as any[]) {
          if (!ins) continue;
          const cantidadDesc = Number(
            ins.cantidad ?? ins.cantidadSugerida ?? 0,
          );
          if (!Number.isFinite(cantidadDesc) || cantidadDesc <= 0) continue;

          // Resolución estricta por ID: la receta capturada al crear la OT siempre trae el
          // insumoId real (viene del catálogo). Evitamos el fallback por SKU/nombre porque
          // podía engancharse a un producto distinto si el SKU o el nombre se reutilizaban.
          const insumoId = String(ins.insumoId || ins.productoId || '').trim();
          if (!insumoId) {
            throw new BadRequestException(
              `No se pudo descontar el kit del pulidor: la línea de receta "${ins.insumoNombre || ins.productoNombre || ins.nombre || '(sin nombre)'}" no tiene un insumo identificado.`,
            );
          }

          const insumoDb = await tx.insumo.findUnique({
            where: { id: insumoId },
            include: { unidadMedida: { select: { simbolo: true } } },
          });
          if (!insumoDb) {
            throw new BadRequestException(
              `No se pudo descontar el kit del pulidor: el insumo "${insumoId}" de la receta ya no existe.`,
            );
          }

          const stockPulidor = await tx.stockUbicacion.findFirst({
            where: { insumoId: insumoDb.id, pulidorId: operadorId },
          });
          if (!stockPulidor) continue;

          const decremented = await tx.stockUbicacion.update({
            where: { id: stockPulidor.id },
            data: { cantidadActual: { decrement: cantidadDesc } },
          });
          const stockAnterior =
            Number(decremented.cantidadActual) + cantidadDesc;
          let nuevaCant = Number(decremented.cantidadActual);
          if (nuevaCant < 0) {
            await tx.stockUbicacion.update({
              where: { id: stockPulidor.id },
              data: { cantidadActual: 0 },
            });
            nuevaCant = 0;
          }

          const costoUnit = Number(insumoDb.costoUnitarioUSD || 0);
          await tx.kardexMovimiento.create({
            data: {
              insumoId: insumoDb.id,
              ubicacionId: `PULIDOR_${operadorId}`,
              tipoMovimiento: 'CONSUMO_SERVICIO_ESPECIAL',
              cantidad: -cantidadDesc,
              stockAnterior,
              stockPosterior: nuevaCant,
              costoUnitario: costoUnit,
              costoTotal: Number((costoUnit * cantidadDesc).toFixed(2)),
              referenciaId: referencia,
              usuarioId: operadorId,
            },
          });

          // Snapshot congelado: sobrevive a que el producto cambie de nombre/SKU
          // o a que la receta lo reemplace por otro más adelante.
          await tx.consumoServicioEspecial.create({
            data: {
              servicioEspecialId: item.id,
              insumoId: insumoDb.id,
              cantidadUsada: cantidadDesc,
              pulidorId: operadorId,
              insumoNombre: insumoDb.nombre,
              insumoSKU: insumoDb.codigoSKU,
              unidadSimbolo:
                insumoDb.unidadMedida?.simbolo ||
                String(ins.unidadMedida || ''),
            },
          });

          const minimo = Number(insumoDb.stockMinimoAgencia ?? 1);
          if (nuevaCant <= minimo) {
            alertas.push({
              insumoId: insumoDb.id,
              nombre: insumoDb.nombre,
              nuevaCant,
              minimo,
            });
          }
        }
      },
      { timeout: 20000 },
    );

    for (const alerta of alertas) {
      try {
        const alertaExistente = await this.prisma.alertaStock.findFirst({
          where: {
            insumoId: alerta.insumoId,
            usuarioEmisorId: operadorId,
            estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
          },
        });
        if (alertaExistente) continue;
        const nivel =
          alerta.nuevaCant === 0
            ? 'AGOTADO'
            : alerta.nuevaCant < alerta.minimo * 0.5
              ? 'CRITICO'
              : 'BAJO';
        await this.prisma.alertaStock.create({
          data: {
            insumoId: alerta.insumoId,
            nivel,
            agenciaId: item.agenciaId || null,
            usuarioEmisorId: operadorId,
            mensaje: `Stock bajo en kit del pulidor al finalizar servicio ${referencia}. Insumo: ${alerta.nombre}. Stock actual: ${alerta.nuevaCant.toFixed(2)}`,
            stockReportado: alerta.nuevaCant,
          },
        });
      } catch {
        // Alerta no bloqueante
      }
    }
  }

  /**
   * Anula un servicio especial (no se borra). Con `actor` (llamada desde la API) exige motivo, valida el alcance y deja registrado
   * quién, cuándo y por qué. Anulan el coordinador de servicios especiales y los administradores; el aprobador, los de su agencia.
   */
  async softDelete(id: string, motivo?: string, actor?: any) {
    const item = await this.findOneRaw(id);
    let motivoOk = motivo;
    let regla: 'TITULAR' | 'ADMIN' = 'ADMIN';
    if (actor) {
      if (item.deletedAt)
        throw new BadRequestException('El servicio especial ya está anulado.');
      motivoOk = this.decisiones.exigirMotivo(
        motivo,
        'anular un servicio especial',
      );
      this.asegurarPuedeVer(actor, item);
      regla = ['SUPER_ADMIN', 'ADMIN'].includes(rolDeUsuario(actor))
        ? 'ADMIN'
        : 'TITULAR';
    }
    const updated = await this.prisma.servicioEspecial.update({
      where: { id: item.id },
      data: {
        estado: 'Cancelado',
        deletedAt: new Date(),
        observaciones: motivoOk
          ? `${item.observaciones || ''} | [Anulado]: ${motivoOk}`.trim()
          : item.observaciones,
        version: item.version + 1,
      },
      include: {
        agencia: true,
        // Nunca `operador: true`: traería el usuario completo con su passwordHash a la respuesta.
        operador: { select: { id: true, name: true, lastname: true, email: true, regionId: true } },
        region: true,
      },
    });

    if (actor) {
      await this.decisiones.registrar({
        entidad: 'SERVICIO_ESPECIAL',
        entidadId: item.id,
        accion: 'ANULAR',
        user: actor,
        regla,
        motivo: motivoOk,
        agenciaId: item.agenciaId,
        detalle: { estadoAnterior: item.estado },
      });
      void this.notificarCierreServicioEspecial(updated, 'cancelado');
    }

    return this._formatItem(updated);
  }

  // =========================================================================
  // MÉTODOS AUXILIARES: PULIDORES Y STOCK ZONAL
  // =========================================================================

  async listarPulidoresPorRegion(
    regionId?: string,
    agenciaId?: string,
    actor?: any,
  ) {
    if (actor) {
      const alcance = resolverAlcance(actor);
      if (alcance.tipo === 'AGENCIA') {
        agenciaId = alcance.agenciaId;
        regionId = undefined;
      } else if (alcance.tipo === 'REGION') {
        regionId = alcance.regionId;
      } else if (alcance.tipo !== 'GLOBAL') {
        return [];
      }
    }
    const where: any = {
      estado: 1,
      role: {
        namerol: {
          in: [
            'PULIDOR',
            'Pulidor',
            'Pulidor Móvil',
            'Pulidor Fijo',
          ],
        },
      },
    };
    if (
      agenciaId &&
      String(agenciaId).trim() &&
      String(agenciaId).trim() !== 'null' &&
      String(agenciaId).trim() !== 'undefined'
    ) {
      where.agenciaId = String(agenciaId).trim();
    } else if (
      regionId &&
      String(regionId).trim() &&
      String(regionId).trim() !== 'null' &&
      String(regionId).trim() !== 'undefined'
    ) {
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
        agencia: {
          select: { id: true, nombre: true, regionId: true, codigo: true },
        },
        role: { select: { id: true, namerol: true } },
      },
      orderBy: { name: 'asc' },
    });

    return list.map((p) => {
      // Pulidor fijo: asignado a una sucursal / agencia en la base de datos (p.agenciaId != null)
      const esFijo = Boolean(p.agenciaId);
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

  async obtenerStockPulidor(pulidorId: string, actor?: any) {
    if (actor && pulidorId !== String(actor.id)) {
      if (rolDeUsuario(actor) === 'PULIDOR')
        throw new ForbiddenException(
          'Solo puedes ver el stock de tu propio kit.',
        );
      const pulidor = await this.prisma.user.findUnique({
        where: { id: pulidorId },
        select: {
          id: true,
          agenciaId: true,
          regionId: true,
          agencia: { select: { regionId: true } },
        },
      });
      const alcance = resolverAlcance(actor);
      const permitido =
        !!pulidor &&
        (alcance.tipo === 'GLOBAL' ||
          (alcance.tipo === 'REGION' &&
            (pulidor.regionId === alcance.regionId ||
              pulidor.agencia?.regionId === alcance.regionId)) ||
          (alcance.tipo === 'AGENCIA' &&
            pulidor.agenciaId === alcance.agenciaId));
      if (!permitido)
        throw new ForbiddenException('Ese pulidor no pertenece a tu alcance.');
    }
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
      estado:
        Number(s.cantidadActual) <= 0
          ? 'AGOTADO'
          : Number(s.cantidadActual) <= Number(s.cantidadMinima)
            ? 'BAJO'
            : 'OPTIMO',
    }));
  }
}
