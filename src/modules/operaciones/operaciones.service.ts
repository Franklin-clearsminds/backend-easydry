import { Injectable, NotFoundException, BadRequestException, Optional, Logger } from '@nestjs/common';
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
import { serializeServicioLavado } from '../../common/utils/servicio-serializer.util.js';

@Injectable()
export class OperacionesService {
  private readonly logger = new Logger(OperacionesService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private notifications?: NotificationsService,
  ) {}

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
  }, currentUser?: any) {
    const where: any = {
      deletedAt: null,
    };

    // 1. Scoping RBAC por rol del usuario
    if (currentUser) {
      const userRole = (currentUser.role?.namerol || currentUser.roleDetails?.namerol || currentUser.role || '').toUpperCase();
      const isSuperAdminOrAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';
      const isSupervisor = userRole === 'SUPERVISOR' || userRole === 'GERENTE_REGIONAL' || userRole.includes('SUPERVISOR') || userRole.includes('REGIONAL');
      const isAprobador = userRole === 'APROBADOR' || userRole === 'GERENTE';
      const isLider = userRole === 'LIDER' || userRole === 'LIDER_OPERADOR' || userRole === 'LIDER_AGENCIA';
      const isLavador = userRole === 'LAVADOR' || userRole === 'OPERADOR';

      if (isSuperAdminOrAdmin) {
        // Super Admin y Admin: acceso nacional irrestricto
        const targetAgencia = params?.agenciaId || params?.sucursalId;
        if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
          where.bahia = { agenciaId: targetAgencia };
        } else if (params?.regionId && params.regionId !== 'Todas' && params.regionId !== 'TODAS') {
          where.bahia = { agencia: { regionId: params.regionId } };
        }
      } else if (isSupervisor) {
        // Gerente Regional / Supervisor: solo operaciones de su región asignada
        const regionId = currentUser.regionId || params?.regionId;
        const targetAgencia = params?.agenciaId || params?.sucursalId;
        if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
          where.bahia = {
            agenciaId: targetAgencia,
            ...(regionId ? { agencia: { regionId } } : {}),
          };
        } else if (regionId) {
          where.bahia = { agencia: { regionId } };
        }
      } else if (isAprobador || isLider) {
        // Aprobador / Líder: únicamente de su sucursal / agencia asignada
        const targetAgencia = currentUser.agenciaId || params?.agenciaId || params?.sucursalId;
        if (targetAgencia) {
          where.bahia = { agenciaId: targetAgencia };
        }
      } else if (isLavador) {
        // Lavador: solo ve los servicios donde él fue el operador asignado
        where.operadorId = currentUser.id;
      } else {
        const targetAgencia = params?.agenciaId || params?.sucursalId;
        if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
          where.bahia = { agenciaId: targetAgencia };
        }
      }
    } else {
      const targetAgencia = params?.agenciaId || params?.sucursalId;
      if (targetAgencia && targetAgencia !== 'Todas' && targetAgencia !== 'TODAS') {
        where.bahia = { agenciaId: targetAgencia };
      }
      if (params?.regionId && params.regionId !== 'Todas' && params.regionId !== 'TODAS') {
        where.bahia = { agencia: { regionId: params.regionId } };
      }
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

    if (params?.search) {
      const q = params.search.trim().toUpperCase();
      where.OR = [
        { placa: { contains: q } },
        { modelo: { contains: q, mode: 'insensitive' } },
        { cliente: { contains: q, mode: 'insensitive' } },
      ];
    }

    const page = params?.page ? Number(params.page) : 1;
    const pageSize = params?.pageSize ? Number(params.pageSize) : 200;
    const skip = (page - 1) * pageSize;
    const sortField = params?.sortField || 'createdAt';
    const sortOrder = params?.sortOrder || 'desc';

    const [items, total] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortField]: sortOrder },
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
      }),
      this.prisma.servicioLavado.count({ where }),
    ]);

    return buildDataGridResponse(items.map(serializeServicioLavado), total, page, pageSize);
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

  async findOne(id: string) {
    const servicio = await this.findOneRaw(id);
    return serializeServicioLavado(servicio);
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
  private async _validarOTServicioGeneral(ordenTrabajoOT: string, placa: string, catalogoIds: number[]) {
    const normalizarPlaca = (value?: string | null) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const placaNueva = normalizarPlaca(placa);

    const otEspecial = await this.prisma.servicioEspecial.findFirst({
      where: { codigoSE: { equals: ordenTrabajoOT, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (otEspecial) {
      throw new BadRequestException(`La Orden de Trabajo "${ordenTrabajoOT}" ya está registrada como servicio especial. Ingrese otro número de OT.`);
    }

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

    const repetido = existentes.find((s) => catalogoIds.includes(Number(s.servicioCatalogoId)));
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
  async createMultiple(createDto: CreateServicioDto, operadorId: string) {
    const ids = Array.from(new Set(
      [...(createDto.servicioCatalogoIds || []), createDto.servicioCatalogoId]
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ));
    if (ids.length <= 1) {
      return this.create({ ...createDto, servicioCatalogoId: ids[0] ?? createDto.servicioCatalogoId }, operadorId);
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
      }, operadorId));
    }
    return creados;
  }

  async create(createDto: CreateServicioDto, operadorId: string) {
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

    const resolvedBahiaId = bahia.id;
    const agenciaId = bahia.agenciaId;

    // 2. Resolución de Operador: si la app indicó qué lavador realiza el servicio
    //    (createDto.operadorId), la OT se le atribuye a él -siempre que sea de la misma
    //    agencia que la bahía-. Si no se indicó, se atribuye a quien está autenticado.
    let validOperadorId = createDto.operadorId || operadorId;
    let user = validOperadorId ? await this.prisma.user.findUnique({ where: { id: validOperadorId } }) : null;
    if (!user) {
      throw new BadRequestException('No se encontró el operador autenticado para registrar el servicio.');
    }
    if (createDto.operadorId) {
      if (String(user.agenciaId || '') !== String(agenciaId || '')) {
        throw new BadRequestException('El lavador seleccionado no pertenece a la agencia de la bahía indicada.');
      }
      if (user.estado !== 1) {
        throw new BadRequestException('El lavador seleccionado está inactivo y no puede recibir nuevas OTs.');
      }
    }

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

    // 4. Control físico de Bahía: Impedir doble auto simultáneo en proceso en la misma bahía
    if (createDto.estado === ServiceStatus.EN_PROCESO) {
      const activoEnBahia = await this.prisma.servicioLavado.findFirst({
        where: {
          bahiaId: resolvedBahiaId,
          estado: ServiceStatus.EN_PROCESO,
          deletedAt: null,
        },
      });
      if (activoEnBahia && activoEnBahia.placa !== createDto.placa.toUpperCase().trim()) {
        throw new BadRequestException(
          `La bahía "${bahia.nombre}" ya se encuentra ocupada por el vehículo ${activoEnBahia.placa}. Espere a que finalice o seleccione otra bahía disponible.`,
        );
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
    let observacionGerenteAuto: string | undefined = undefined;
    let aprobadoPorAuto: string | undefined = undefined;
    let fechaAprobacionAuto: Date | undefined = undefined;

    // Si se crea directamente como FINALIZADO, verificar si la agencia cuenta con aprobador asignado
    if (estadoInicial === ServiceStatus.FINALIZADO) {
      let tieneAprobador = false;
      if (agenciaId) {
        const approver = await this.prisma.user.findFirst({
          where: {
            estado: 1,
            OR: [{ agenciaId }, { agenciasIds: { has: agenciaId } }],
            role: { namerol: { in: ['APROBADOR', 'GERENTE'] } },
          },
        });
        if (approver) tieneAprobador = true;
      }
      if (!tieneAprobador) {
        estadoInicial = ServiceStatus.APROBADO;
        observacionGerenteAuto = 'Aprobado automáticamente (Agencia sin aprobador asignado)';
        aprobadoPorAuto = 'Sistema (Auto-Aprobación)';
        fechaAprobacionAuto = now;
      }
    }

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
        observacionGerente: observacionGerenteAuto,
        aprobadoPor: aprobadoPorAuto,
        fechaAprobacion: fechaAprobacionAuto,
        bahiaId: resolvedBahiaId,
        servicioCatalogoId: resolvedCatalogoId,
        operadorId: validOperadorId,
        horaIngreso: now,
        horaInicio: createDto.estado === ServiceStatus.EN_PROCESO ? now : null,
        horaSalida: horaSalidaFinal,
        fotoIngresoUrl,
        videoInicialUrl: videoInicialHeredado,
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

  async update(id: string, updateDto: UpdateServicioDto, isOfflineSync: boolean = false) {
    const servicio = await this.findOneRaw(id);
    const data: any = { ...updateDto };
    delete data.id;
    data.version = { increment: 1 };

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

      // ──────────────────────────────────────────────────────────────
      // AUTO-APROBACIÓN PARA AGENCIAS SIN APROBADOR ASIGNADO
      // ──────────────────────────────────────────────────────────────
      const agenciaId = servicio.bahia?.agencia?.id || servicio.bahia?.agenciaId;
      let tieneAprobador = false;
      if (agenciaId) {
        const approver = await this.prisma.user.findFirst({
          where: {
            estado: 1,
            OR: [
              { agenciaId },
              { agenciasIds: { has: agenciaId } },
            ],
            role: {
              namerol: { in: ['APROBADOR', 'GERENTE'] },
            },
          },
        });
        if (approver) {
          tieneAprobador = true;
        }
      }

      if (!tieneAprobador) {
        data.estado = ServiceStatus.APROBADO;
        data.observacionGerente = 'Aprobado automáticamente (Agencia sin aprobador asignado)';
        data.aprobadoPor = 'Sistema (Auto-Aprobación)';
        data.fechaAprobacion = new Date();
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

    return serializeServicioLavado(updated);
  }

  async softDelete(id: string, motivo?: string, reponerInsumos: boolean = true) {
    const servicio = await this.findOneRaw(id);

    // Reversión de Insumos: Si el servicio estaba FINALIZADO y tenía consumos, reponer al inventario
    if (servicio.estado === ServiceStatus.FINALIZADO && reponerInsumos && servicio.consumos?.length > 0) {
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
        observaciones: motivo
          ? `${servicio.observaciones || ''} | [Eliminado/Anulado]: ${motivo}`.trim()
          : servicio.observaciones,
        version: servicio.version + 1,
      },
      include: {
        bahia: {
          include: { agencia: true },
        },
        catalogo: true,
        operador: true,
      },
    });

    return serializeServicioLavado(deleted);
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

  async asignarReceta(dto: AsignarRecetaDto, usuarioId?: string) {
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

    const [generales, especiales] = await Promise.all([
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

  async listRecetaHistorial(dto: ListRecetaDto) {
    return this.prisma.recetaInsumoHistorial.findMany({
      where: { catalogoServicioId: dto.catalogoServicioId },
      include: {
        usuario: { select: { id: true, name: true, lastname: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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

  async eliminarRecetaItem(dto: EliminarRecetaItemDto, usuarioId?: string) {
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

  async aprobarServicio(id: string, observacion?: string, gerenteNombre?: string) {
    const servicio = await this.findOneRaw(id);
    if (servicio.estado !== ServiceStatus.FINALIZADO) {
      throw new BadRequestException('Solo se pueden aprobar servicios que ya han sido finalizados.');
    }
    const updated = await this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data: {
        estado: ServiceStatus.APROBADO,
        observacionGerente: observacion || servicio.observacionGerente || 'Aprobado por gerencia',
        aprobadoPor: gerenteNombre || 'Gerencia Operativa',
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

    return serializeServicioLavado(updated);
  }

  async rechazarServicio(id: string, motivo: string, gerenteNombre?: string) {
    const servicio = await this.findOneRaw(id);
    if (servicio.estado !== ServiceStatus.FINALIZADO) {
      throw new BadRequestException('Solo se pueden rechazar servicios que ya han sido finalizados.');
    }
    const updated = await this.prisma.servicioLavado.update({
      where: { id: servicio.id },
      data: {
        estado: ServiceStatus.RECHAZADO,
        motivoRechazo: motivo,
        observacionGerente: motivo,
        aprobadoPor: gerenteNombre || 'Gerencia Operativa',
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

    return serializeServicioLavado(updated);
  }

  async aprobarTodosServicios(
    agenciaId?: string,
    sucursalId?: string,
    fecha?: string,
    gerenteNombre?: string,
    requiereFotoSalida: boolean = true,
  ) {
    const targetAgencia = agenciaId || sucursalId;
    const baseWhere: any = {
      estado: ServiceStatus.FINALIZADO,
      deletedAt: null,
    };

    if (targetAgencia) {
      baseWhere.bahia = { agenciaId: targetAgencia };
    }

    if (fecha) {
      const start = new Date(`${fecha}T00:00:00.000Z`);
      const end = new Date(`${fecha}T23:59:59.999Z`);
      baseWhere.createdAt = { gte: start, lte: end };
    }

    const whereParaAprobar: any = { ...baseWhere };
    let omitidosSinFotoCount = 0;

    if (requiereFotoSalida) {
      whereParaAprobar.fotoSalidaUrl = { not: null };

      // Contar cuántos servicios finalizados no cumplen con la foto de salida
      omitidosSinFotoCount = await this.prisma.servicioLavado.count({
        where: {
          ...baseWhere,
          fotoSalidaUrl: null,
        },
      });
    }

    const batchResult = await this.prisma.servicioLavado.updateMany({
      where: whereParaAprobar,
      data: {
        estado: ServiceStatus.APROBADO,
        observacionGerente: 'Aprobación masiva de cierre diario (Quality Gate)',
        aprobadoPor: gerenteNombre || 'Gerencia Operativa',
        fechaAprobacion: new Date(),
        version: { increment: 1 },
      },
    });

    return {
      ok: true,
      aprobadosCount: batchResult.count,
      omitidosSinFotoCount,
      mensaje: `Se aprobaron exitosamente ${batchResult.count} servicios de lavado.${
        omitidosSinFotoCount > 0
          ? ` Se omitieron ${omitidosSinFotoCount} servicios por no contar con evidencia fotográfica de salida obligatoria.`
          : ''
      }`,
    };
  }
}
