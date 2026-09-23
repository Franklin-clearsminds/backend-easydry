import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateAgenciaDto,
  UpdateAgenciaDto,
  ListAgenciasDto,
  ToggleEstadoAgenciaDto,
} from './dto/agencias.dto.js';
import {
  CreateClienteDto,
  UpdateClienteDto,
  ListClientesDto,
  ToggleEstadoClienteDto,
  CreateMarcaDto,
  UpdateMarcaDto,
  ListMarcasDto,
  ToggleEstadoMarcaDto,
} from './dto/clientes.dto.js';
import {
  CreateRegionDto,
  UpdateRegionDto,
  ListRegionesDto,
  ToggleEstadoRegionDto,
} from './dto/regiones.dto.js';
import {
  CreateBahiaDto,
  UpdateBahiaDto,
  ListBahiasDto,
  ToggleActivaBahiaDto,
  AsignarOperadorBahiaDto,
  ListHistorialAsignacionesDto,
  DesasignarOperadorBahiaDto,
} from './dto/bahias.dto.js';
import bcrypt from 'bcryptjs';
import {
  AsignarUsuarioAgenciaDto,
  ListUsuariosAgenciaDto,
  ToggleEstadoUsuarioDto,
  UpdateUsuarioDto,
  CreateUsuarioDto,
  DeleteUsuarioDto,
  ListOperadoresDto,
  CreateOperadorDto,
  UpdateOperadorDto,
} from './dto/usuarios-agencia.dto.js';

@Injectable()
export class AgenciasService {
  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // 1. REGIONES (CRUD + TOGGLE)
  // =========================================================================

  async listRegiones(dto: ListRegionesDto) {
    const where: any = {};

    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
        { descripcion: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    const regiones = await this.prisma.region.findMany({
      where,
      include: {
        usuarios: {
          select: {
            id: true,
            name: true,
            lastname: true,
            email: true,
            role: { select: { namerol: true } },
          },
        },
        _count: {
          select: {
            agencias: true,
            usuarios: true,
          },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return regiones.map((r) => {
      const supervisor = r.usuarios?.find((u) => u.role?.namerol === 'SUPERVISOR') || r.usuarios?.[0];
      return {
        ...r,
        responsable: supervisor ? `${supervisor.name} ${supervisor.lastname}`.trim() : '',
        supervisorId: supervisor?.id || null,
      };
    });
  }

  async createRegion(dto: CreateRegionDto) {
    const codigoExiste = await this.prisma.region.findUnique({
      where: { codigo: dto.codigo.trim().toUpperCase() },
    });
    if (codigoExiste) {
      throw new ConflictException(`Ya existe una región con el código "${dto.codigo}"`);
    }

    const nombreExiste = await this.prisma.region.findUnique({
      where: { nombre: dto.nombre.trim() },
    });
    if (nombreExiste) {
      throw new ConflictException(`Ya existe una región con el nombre "${dto.nombre}"`);
    }

    const created = await this.prisma.region.create({
      data: {
        codigo: dto.codigo.trim().toUpperCase(),
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion?.trim(),
        estado: dto.estado ?? 1,
      },
    });

    let responsableNombre = '';
    if (dto.supervisorId) {
      const sup = await this.prisma.user.findUnique({
        where: { id: dto.supervisorId },
      });
      if (sup) {
        await this.prisma.user.update({
          where: { id: dto.supervisorId },
          data: { regionId: created.id },
        });
        responsableNombre = `${sup.name} ${sup.lastname}`.trim();
      }
    }

    return {
      ...created,
      responsable: responsableNombre || dto.responsable || '',
      supervisorId: dto.supervisorId || null,
    };
  }

  async updateRegion(dto: UpdateRegionDto) {
    const region = await this.prisma.region.findUnique({ where: { id: dto.id } });
    if (!region) {
      throw new NotFoundException(`Región con ID "${dto.id}" no encontrada`);
    }

    if (dto.codigo && dto.codigo.trim().toUpperCase() !== region.codigo) {
      const codigoExiste = await this.prisma.region.findUnique({
        where: { codigo: dto.codigo.trim().toUpperCase() },
      });
      if (codigoExiste) {
        throw new ConflictException(`Ya existe otra región con el código "${dto.codigo}"`);
      }
    }

    if (dto.nombre && dto.nombre.trim() !== region.nombre) {
      const nombreExiste = await this.prisma.region.findUnique({
        where: { nombre: dto.nombre.trim() },
      });
      if (nombreExiste) {
        throw new ConflictException(`Ya existe otra región con el nombre "${dto.nombre}"`);
      }
    }

    const updated = await this.prisma.region.update({
      where: { id: dto.id },
      data: {
        ...(dto.codigo && { codigo: dto.codigo.trim().toUpperCase() }),
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion?.trim() }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
    });

    let responsableNombre = '';
    let finalSupervisorId = dto.supervisorId || null;

    if (dto.supervisorId !== undefined) {
      if (dto.supervisorId) {
        // Desvincular otros supervisores de esta región
        await this.prisma.user.updateMany({
          where: { regionId: region.id, role: { namerol: 'SUPERVISOR' }, id: { not: dto.supervisorId } },
          data: { regionId: null },
        });
        // Asignar el nuevo supervisor
        const sup = await this.prisma.user.update({
          where: { id: dto.supervisorId },
          data: { regionId: region.id },
        });
        responsableNombre = `${sup.name} ${sup.lastname}`.trim();
      } else {
        // Si se envió vacío, desvincular supervisores de la región
        await this.prisma.user.updateMany({
          where: { regionId: region.id, role: { namerol: 'SUPERVISOR' } },
          data: { regionId: null },
        });
        finalSupervisorId = null;
      }
    } else {
      // Mantener supervisor actual
      const sup = await this.prisma.user.findFirst({
        where: { regionId: region.id, role: { namerol: 'SUPERVISOR' } },
      });
      if (sup) {
        responsableNombre = `${sup.name} ${sup.lastname}`.trim();
        finalSupervisorId = sup.id;
      }
    }

    return {
      ...updated,
      responsable: responsableNombre || dto.responsable || '',
      supervisorId: finalSupervisorId,
    };
  }

  async toggleEstadoRegion(dto: ToggleEstadoRegionDto) {
    const region = await this.prisma.region.findUnique({ where: { id: dto.id } });
    if (!region) {
      throw new NotFoundException(`Región con ID "${dto.id}" no encontrada`);
    }

    const nuevoEstado = dto.estado !== undefined ? dto.estado : region.estado === 1 ? 0 : 1;

    return this.prisma.region.update({
      where: { id: dto.id },
      data: { estado: nuevoEstado },
    });
  }

  // =========================================================================
  // 2. CLIENTES (CRUD + ESTADO)
  // =========================================================================

  async listClientes(dto: ListClientesDto) {
    const where: any = {};

    if (dto.search) {
      where.nombre = { contains: dto.search, mode: 'insensitive' };
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    return this.prisma.cliente.findMany({
      where,
      include: {
        _count: {
          select: { agencias: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async createCliente(dto: CreateClienteDto) {
    const existing = await this.prisma.cliente.findUnique({
      where: { nombre: dto.nombre.trim() },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un cliente registrado con el nombre "${dto.nombre}"`);
    }

    return this.prisma.cliente.create({
      data: {
        nombre: dto.nombre.trim(),
        estado: dto.estado ?? 1,
      },
    });
  }

  async updateCliente(dto: UpdateClienteDto) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.id } });
    if (!cliente) {
      throw new NotFoundException(`Cliente con ID "${dto.id}" no encontrado`);
    }

    if (dto.nombre && dto.nombre.trim() !== cliente.nombre) {
      const existing = await this.prisma.cliente.findUnique({
        where: { nombre: dto.nombre.trim() },
      });
      if (existing) {
        throw new ConflictException(`Ya existe otro cliente con el nombre "${dto.nombre}"`);
      }
    }

    return this.prisma.cliente.update({
      where: { id: dto.id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
    });
  }

  async toggleEstadoCliente(dto: ToggleEstadoClienteDto) {
    const cliente = await this.prisma.cliente.findUnique({ where: { id: dto.id } });
    if (!cliente) {
      throw new NotFoundException(`Cliente con ID "${dto.id}" no encontrado`);
    }

    const nuevoEstado = dto.estado !== undefined ? dto.estado : cliente.estado === 1 ? 0 : 1;

    return this.prisma.cliente.update({
      where: { id: dto.id },
      data: { estado: nuevoEstado },
    });
  }

  // Aliases retrocompatibles para marcas
  async listMarcas(dto: any) { return this.listClientes(dto); }
  async createMarca(dto: any) { return this.createCliente(dto); }
  async updateMarca(dto: any) { return this.updateCliente(dto); }
  async toggleEstadoMarca(dto: any) { return this.toggleEstadoCliente(dto); }

  // =========================================================================
  // 3. AGENCIAS (CRUD + DETALLE + RESUMEN)
  // =========================================================================

  async listAgencias(dto: ListAgenciasDto, user: any) {
    const where: any = {};

    // Control de roles y visibilidad
    const rol = user.role?.namerol || user.roleDetails?.namerol || (typeof user.role === 'string' ? user.role : '');
    const rolesGlobales = ['SUPER_ADMIN', 'ADMIN', 'JEFE_COMERCIAL'];
    const rolesRegionales = ['SUPERVISOR', 'COORD_COMERCIAL'];

    if (!rolesGlobales.includes(rol)) {
      if (rolesRegionales.includes(rol)) {
        // Puede ver las agencias de su región asignada (regionId o region), más sus agenciasIds
        const orConditions: any[] = [];
        if (user.regionId) {
          orConditions.push({ regionId: user.regionId });
        }
        if (user.region?.nombre) {
          orConditions.push({ region: user.region.nombre });
        }
        const permitidas = [user.agenciaId, ...(user.agenciasIds || [])].filter(Boolean);
        if (permitidas.length > 0) {
          orConditions.push({ id: { in: permitidas } });
        }
        if (orConditions.length > 0) {
          where.AND = [{ OR: orConditions }];
        }
      } else {
        // Roles de agencia local: solo su agencia
        if (user.agenciaId) {
          where.id = user.agenciaId;
        }
      }
    }

    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { codigo: { contains: dto.search, mode: 'insensitive' } },
        { direccion: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    if (dto.regionId) {
      where.regionId = dto.regionId;
    }

    if (dto.region) {
      where.region = { contains: dto.region, mode: 'insensitive' };
    }

    const targetClienteId = dto.clienteId || dto.marcaId;
    if (targetClienteId) {
      where.clienteId = targetClienteId;
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    const list = await this.prisma.agencia.findMany({
      where,
      include: {
        cliente: { select: { id: true, nombre: true, estado: true } },
        regionRel: { select: { id: true, codigo: true, nombre: true, estado: true } },
        usuarios: {
          select: {
            id: true,
            name: true,
            lastname: true,
            estado: true,
            role: { select: { id: true, namerol: true } },
          },
        },
        _count: {
          select: {
            bahias: true,
            usuarios: true,
            solicitudesAprobacion: true,
            maquinarias: true,
          },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return list.map((a) => {
      const ger = a.usuarios?.find((u) => {
        const r = (u.role?.namerol || '').toUpperCase();
        return r === 'GERENTE' || r === 'APROBADOR' || r.includes('GERENTE') || r.includes('APROBADOR') || r === 'LIDER_AGENCIA';
      });
      const lider = a.usuarios?.find((u) => {
        const r = (u.role?.namerol || '').toUpperCase();
        return r === 'LIDER' || r.includes('LIDER') || r.includes('LÍDER');
      });
      return {
        ...a,
        responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
        gerenteId: ger?.id || null,
        gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
        liderOperador: lider ? `${lider.name} ${lider.lastname}`.trim() : 'Sin Asignar',
        liderOperadorId: lider?.id || null,
        liderOperadorNombre: lider ? `${lider.name} ${lider.lastname}`.trim() : null,
      };
    });
  }

  async detailAgencia(id: string) {
    const agencia = await this.prisma.agencia.findUnique({
      where: { id },
      include: {
        cliente: true,
        regionRel: true,
        bahias: {
          orderBy: { codigo: 'asc' },
        },
        usuarios: {
          select: {
            id: true,
            email: true,
            name: true,
            lastname: true,
            estado: true,
            role: { select: { id: true, namerol: true } },
          },
          orderBy: { name: 'asc' },
        },
        stocks: {
          where: { tipoUbicacion: 'AGENCIA' },
          include: {
            insumo: {
              select: {
                id: true,
                codigoSKU: true,
                nombre: true,
                categoria: true,
                stockMinimoAgencia: true,
                unidadMedida: { select: { simbolo: true } },
              },
            },
          },
          orderBy: { cantidadActual: 'asc' },
        },
        alertas: {
          where: { estado: { in: ['PENDIENTE', 'EN_PROCESO'] } },
          include: {
            insumo: { select: { codigoSKU: true, nombre: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!agencia) {
      throw new NotFoundException(`Agencia con ID "${id}" no encontrada`);
    }

    const ger = agencia.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'GERENTE' || r === 'APROBADOR' || r.includes('GERENTE') || r.includes('APROBADOR') || r === 'LIDER_AGENCIA';
    });
    const lider = agencia.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER' || r.includes('LIDER') || r.includes('LÍDER');
    });

    return {
      ...agencia,
      responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
      gerenteId: ger?.id || null,
      gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
      liderOperador: lider ? `${lider.name} ${lider.lastname}`.trim() : 'Sin Asignar',
      liderOperadorId: lider?.id || null,
      liderOperadorNombre: lider ? `${lider.name} ${lider.lastname}`.trim() : null,
    };
  }

  /**
   * Sincroniza los insumos requeridos por los servicios asignados a una agencia.
   * Inicializa los registros de StockUbicacion faltantes con cantidadActual = 0.
   * Los insumos preexistentes (con o sin existencias) NUNCA se eliminan ni modifican.
   */
  async sincronizarStockInsumosPorServicios(
    agenciaId: string,
    servicioIds: number[],
    emisorId?: string,
  ): Promise<void> {
    if (!agenciaId || !Array.isArray(servicioIds) || servicioIds.length === 0) return;

    try {
      const cleanIds = servicioIds.map(Number).filter((n) => !isNaN(n) && n > 0);
      if (cleanIds.length === 0) return;

      const recetas = await this.prisma.recetaInsumo.findMany({
        where: { catalogoServicioId: { in: cleanIds } },
        include: {
          insumo: {
            select: { id: true, nombre: true, codigoSKU: true, stockMinimoAgencia: true },
          },
          catalogoServicio: { select: { nombre: true, codigo: true } },
        },
      });

      if (recetas.length === 0) return;

      const insumoIds = Array.from(new Set(recetas.map((r) => r.insumoId).filter(Boolean)));

      const existentes = await this.prisma.stockUbicacion.findMany({
        where: {
          agenciaId,
          tipoUbicacion: 'AGENCIA',
          insumoId: { in: insumoIds },
        },
        select: { id: true, insumoId: true, cantidadActual: true },
      });

      const setExistentes = new Set(existentes.map((s) => s.insumoId));
      const stockPorInsumo = new Map(existentes.map((s) => [s.insumoId, Number(s.cantidadActual)]));

      for (const r of recetas) {
        if (!setExistentes.has(r.insumoId)) {
          await this.prisma.stockUbicacion.create({
            data: {
              agenciaId,
              insumoId: r.insumoId,
              tipoUbicacion: 'AGENCIA',
              cantidadActual: 0,
              cantidadMinima: r.insumo?.stockMinimoAgencia ?? 2,
            },
          }).catch((err) => console.warn(`[StockSync] Error al crear stock inicial para insumo ${r.insumoId}:`, err));
          setExistentes.add(r.insumoId);
          stockPorInsumo.set(r.insumoId, 0);
        }
      }

      const emisor = emisorId || (await this.resolverUsuarioSistemaId());
      if (!emisor) return;

      const agencia = await this.prisma.agencia.findUnique({
        where: { id: agenciaId },
        select: { nombre: true, codigo: true },
      });

      for (const insumoId of insumoIds) {
        const stock = stockPorInsumo.get(insumoId) ?? 0;
        if (stock > 0) continue;
        const rec = recetas.find((r) => r.insumoId === insumoId);
        const nombreIns = rec?.insumo?.nombre || insumoId;
        const servicios = [...new Set(
          recetas.filter((r) => r.insumoId === insumoId).map((r) => r.catalogoServicio?.nombre || r.catalogoServicio?.codigo).filter(Boolean),
        )];
        await this.ensureAlertaStockPendiente({
          insumoId,
          nivel: 'AGOTADO',
          agenciaId,
          pulidorId: null,
          emisorId: emisor,
          stockReportado: 0,
          mensaje:
            `Sede ${agencia?.nombre || agenciaId}: ${nombreIns} requerido por servicio(s) asignado(s)` +
            (servicios.length ? ` (${servicios.join(', ')})` : '') +
            ` sin stock. Despachar insumos.`,
        });
      }
    } catch (err) {
      console.warn('[StockSync] Error en sincronizarStockInsumosPorServicios:', err);
    }
  }

  /**
   * Crea slots de kit (0) + alertas AGOTADO al asignar servicios especiales a un pulidor.
   */
  async sincronizarStockPulidorPorServicios(
    pulidorId: string,
    servicioIds: number[],
    emisorId?: string,
  ): Promise<void> {
    if (!pulidorId || !Array.isArray(servicioIds) || servicioIds.length === 0) return;

    try {
      const cleanIds = servicioIds.map(Number).filter((n) => !isNaN(n) && n > 0);
      if (cleanIds.length === 0) return;

      const pulidor = await this.prisma.user.findUnique({
        where: { id: pulidorId },
        select: {
          id: true,
          name: true,
          lastname: true,
          agenciaId: true,
          regionId: true,
          region: { select: { nombre: true } },
          agencia: { select: { nombre: true } },
        },
      });
      if (!pulidor) return;

      const tipoUb: 'PULIDOR_FIJO' | 'PULIDOR_MOVIL' = pulidor.agenciaId ? 'PULIDOR_FIJO' : 'PULIDOR_MOVIL';

      const recetas = await this.prisma.recetaInsumo.findMany({
        where: { catalogoServicioId: { in: cleanIds } },
        include: {
          insumo: {
            select: { id: true, nombre: true, codigoSKU: true, stockMinimoAgencia: true },
          },
          catalogoServicio: { select: { nombre: true, codigo: true } },
        },
      });
      if (recetas.length === 0) return;

      const insumoIds = Array.from(new Set(recetas.map((r) => r.insumoId).filter(Boolean)));
      const existentes = await this.prisma.stockUbicacion.findMany({
        where: { pulidorId, insumoId: { in: insumoIds } },
        select: { insumoId: true, cantidadActual: true },
      });
      const setExistentes = new Set(existentes.map((s) => s.insumoId));
      const stockPorInsumo = new Map(existentes.map((s) => [s.insumoId, Number(s.cantidadActual)]));

      for (const r of recetas) {
        if (!setExistentes.has(r.insumoId)) {
          await this.prisma.stockUbicacion.create({
            data: {
              pulidorId,
              insumoId: r.insumoId,
              tipoUbicacion: tipoUb,
              cantidadActual: 0,
              cantidadMinima: r.insumo?.stockMinimoAgencia ?? 1,
              agenciaId: pulidor.agenciaId || null,
            },
          }).catch((err) => console.warn(`[StockSync] Error kit pulidor ${pulidorId}/${r.insumoId}:`, err));
          setExistentes.add(r.insumoId);
          stockPorInsumo.set(r.insumoId, 0);
        }
      }

      const emisor = emisorId || (await this.resolverUsuarioSistemaId());
      if (!emisor) return;

      const nombrePulidor = `${pulidor.name} ${pulidor.lastname || ''}`.trim();
      const contexto = pulidor.agenciaId
        ? `Pulidor fijo ${nombrePulidor} (${pulidor.agencia?.nombre || 'sede'})`
        : `Pulidor móvil ${nombrePulidor} (Región ${pulidor.region?.nombre || 'N/D'})`;

      for (const insumoId of insumoIds) {
        const stock = stockPorInsumo.get(insumoId) ?? 0;
        if (stock > 0) continue;
        const rec = recetas.find((r) => r.insumoId === insumoId);
        const nombreIns = rec?.insumo?.nombre || insumoId;
        const servicios = [...new Set(
          recetas.filter((r) => r.insumoId === insumoId).map((r) => r.catalogoServicio?.nombre || r.catalogoServicio?.codigo).filter(Boolean),
        )];
        await this.ensureAlertaStockPendiente({
          insumoId,
          nivel: 'AGOTADO',
          agenciaId: pulidor.agenciaId || null,
          pulidorId,
          emisorId: emisor,
          stockReportado: 0,
          mensaje:
            `${contexto}: ${nombreIns} requerido` +
            (servicios.length ? ` por ${servicios.join(', ')}` : '') +
            ` sin stock en kit. Despachar insumos al pulidor.`,
        });
      }
    } catch (err) {
      console.warn('[StockSync] Error en sincronizarStockPulidorPorServicios:', err);
    }
  }

  private async resolverUsuarioSistemaId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({
      where: { role: { namerol: { in: ['SUPER_ADMIN', 'ADMIN', 'COORD_BODEGA'] } }, estado: 1 },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return admin?.id || null;
  }

  private async ensureAlertaStockPendiente(params: {
    insumoId: string;
    nivel: 'BAJO' | 'CRITICO' | 'AGOTADO';
    agenciaId?: string | null;
    pulidorId?: string | null;
    emisorId: string;
    stockReportado: number;
    mensaje: string;
  }): Promise<void> {
    const where: any = {
      insumoId: params.insumoId,
      estado: 'PENDIENTE',
      nivel: params.nivel,
    };
    if (params.pulidorId) {
      where.pulidorId = params.pulidorId;
    } else if (params.agenciaId) {
      where.agenciaId = params.agenciaId;
      where.pulidorId = null;
    } else {
      where.agenciaId = null;
      where.pulidorId = null;
    }

    const existing = await this.prisma.alertaStock.findFirst({ where, select: { id: true } });
    if (existing) return;

    await this.prisma.alertaStock.create({
      data: {
        insumoId: params.insumoId,
        nivel: params.nivel,
        estado: 'PENDIENTE',
        agenciaId: params.agenciaId || null,
        pulidorId: params.pulidorId || null,
        usuarioEmisorId: params.emisorId,
        mensaje: params.mensaje,
        stockReportado: params.stockReportado,
      },
    }).catch((err) => console.warn('[AlertaStock] No se pudo crear alerta:', err));
  }

  async createAgencia(dto: CreateAgenciaDto) {
    const slug = dto.nombre.replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase();
    let codigoGenerado = dto.codigo?.trim().toUpperCase();

    if (!codigoGenerado) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      codigoGenerado = `AGN-${slug}-${randomSuffix}`;
    }

    let intentos = 0;
    while (intentos < 5) {
      const existe = await this.prisma.agencia.findUnique({
        where: { codigo: codigoGenerado },
      });
      if (!existe) break;
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      codigoGenerado = `AGN-${slug}-${randomSuffix}`;
      intentos++;
    }

    const rawClienteId = dto.clienteId || dto.marcaId;
    let clienteIdFinal: string | null = null;
    if (rawClienteId && rawClienteId !== '0' && rawClienteId !== 'undefined') {
      const cliente = await this.prisma.cliente.findFirst({
        where: { OR: [{ id: rawClienteId }, { nombre: { equals: rawClienteId, mode: 'insensitive' } }] },
      });
      if (cliente) {
        clienteIdFinal = cliente.id;
      }
    }

    let regionNombre = dto.region?.trim() || 'General';
    let regionIdFinal: string | null = null;
    if (dto.regionId && dto.regionId !== '0' && dto.regionId !== 'undefined') {
      const region = await this.prisma.region.findFirst({
        where: { OR: [{ id: dto.regionId }, { nombre: { equals: dto.regionId, mode: 'insensitive' } }] },
      });
      if (region) {
        regionIdFinal = region.id;
        regionNombre = region.nombre;
      }
    }

    let finalServicioIds = Array.isArray(dto.servicioIds) ? dto.servicioIds.map(Number) : [];
    if (dto.tieneServiciosEspeciales) {
      const especiales = await this.prisma.catalogoServicio.findMany({
        where: { categoria: 'ESPECIAL' },
        select: { id: true },
      });
      finalServicioIds = Array.from(new Set([...finalServicioIds, ...especiales.map((s) => s.id)]));
    }

    const created = await this.prisma.agencia.create({
      data: {
        codigo: codigoGenerado,
        nombre: dto.nombre.trim(),
        region: regionNombre,
        regionId: regionIdFinal,
        direccion: dto.direccion?.trim() || '',
        telefono: dto.telefono?.trim() || '',
        email: dto.email?.trim().toLowerCase(),
        numeroBahias: dto.numeroBahias ?? 2,
        maxLavadoresPorBahia: dto.maxLavadoresPorBahia ?? 1,
        clienteId: clienteIdFinal,
        estado: dto.estado ?? 1,
        tieneServiciosEspeciales: dto.tieneServiciosEspeciales ?? false,
        tipoUbicacion: dto.tipoUbicacion || 'OPERATIVA',
        servicioIds: finalServicioIds,
        serviciosNombres: Array.isArray(dto.serviciosNombres) ? dto.serviciosNombres : [],
      },
      include: {
        cliente: true,
        regionRel: true,
        usuarios: {
          include: { role: true }
        },
        bahias: true,
      },
    });

    if (dto.gerenteId && dto.gerenteId !== '0' && dto.gerenteId !== 'undefined') {
      await this.prisma.user.update({
        where: { id: dto.gerenteId },
        data: { agenciaId: created.id },
      }).catch((e) => console.warn('No se pudo asignar gerente al crear agencia', e));
    }

    if (dto.liderOperadorId && dto.liderOperadorId !== '0' && dto.liderOperadorId !== 'undefined') {
      await this.prisma.user.update({
        where: { id: dto.liderOperadorId },
        data: { agenciaId: created.id },
      }).catch((e) => console.warn('No se pudo asignar líder operador al crear agencia', e));
    }

    // Auto-crear bahías si no existen
    const cantBahias = dto.numeroBahias ?? 2;
    for (let i = 1; i <= cantBahias; i++) {
      const numStr = String(i).padStart(2, '0');
      const codigoBahia = `${created.codigo}-B${numStr}`;
      await this.prisma.bahia.upsert({
        where: { codigo: codigoBahia },
        create: {
          codigo: codigoBahia,
          nombre: `Bahía ${numStr}`,
          agenciaId: created.id,
          activa: true,
        },
        update: {},
      });
    }

    const finalCreated = await this.prisma.agencia.findUnique({
      where: { id: created.id },
      include: {
        cliente: true,
        regionRel: true,
        usuarios: {
          select: {
            id: true,
            name: true,
            lastname: true,
            estado: true,
            role: { select: { id: true, namerol: true } },
          },
        },
        bahias: true,
      },
    });

    const ger = finalCreated?.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'GERENTE' || r === 'APROBADOR' || r.includes('GERENTE') || r.includes('APROBADOR') || r === 'LIDER_AGENCIA';
    });
    const lider = finalCreated?.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER' || r === 'LIDER_OPERADOR' || r.includes('LIDER') || r.includes('LÍDER');
    });

    const sIdsCreacion = Array.isArray(created.servicioIds) ? (created.servicioIds as number[]) : [];
    if (sIdsCreacion.length > 0) {
      await this.sincronizarStockInsumosPorServicios(created.id, sIdsCreacion);
    }

    return {
      ...finalCreated,
      responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
      gerenteId: ger?.id || null,
      gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
      liderOperador: lider ? `${lider.name} ${lider.lastname}`.trim() : 'Sin Asignar',
      liderOperadorId: lider?.id || null,
      liderOperadorNombre: lider ? `${lider.name} ${lider.lastname}`.trim() : null,
    };
  }

  async updateAgencia(dto: UpdateAgenciaDto) {
    const agencia = await this.prisma.agencia.findUnique({ where: { id: dto.id } });
    if (!agencia) {
      throw new NotFoundException(`Agencia con ID "${dto.id}" no encontrada`);
    }

    if (dto.codigo && dto.codigo.trim().toUpperCase() !== agencia.codigo) {
      const codigoExiste = await this.prisma.agencia.findUnique({
        where: { codigo: dto.codigo.trim().toUpperCase() },
      });
      if (codigoExiste && codigoExiste.id !== dto.id) {
        throw new ConflictException(`Ya existe otra agencia con el código "${dto.codigo}"`);
      }
    }

    const rawClienteId = dto.clienteId !== undefined ? dto.clienteId : dto.marcaId;
    let clienteIdFinal: string | null | undefined = undefined;
    if (rawClienteId !== undefined) {
      if (rawClienteId && rawClienteId !== '0' && rawClienteId !== 'undefined') {
        const cliente = await this.prisma.cliente.findFirst({
          where: { OR: [{ id: rawClienteId }, { nombre: { equals: rawClienteId, mode: 'insensitive' } }] },
        });
        clienteIdFinal = cliente ? cliente.id : null;
      } else {
        clienteIdFinal = null;
      }
    }

    let regionNombre = dto.region?.trim();
    let regionIdFinal: string | null | undefined = undefined;
    if (dto.regionId !== undefined) {
      if (dto.regionId && dto.regionId !== '0' && dto.regionId !== 'undefined') {
        const region = await this.prisma.region.findFirst({
          where: { OR: [{ id: dto.regionId }, { nombre: { equals: dto.regionId, mode: 'insensitive' } }] },
        });
        if (region) {
          regionIdFinal = region.id;
          if (!regionNombre) regionNombre = region.nombre;
        } else {
          regionIdFinal = null;
        }
      } else {
        regionIdFinal = null;
      }
    }

    const tieneEspeciales = dto.tieneServiciosEspeciales !== undefined
      ? dto.tieneServiciosEspeciales
      : (agencia as any).tieneServiciosEspeciales;

    let finalServicioIds: number[] | undefined = undefined;
    if (Array.isArray(dto.servicioIds)) {
      finalServicioIds = dto.servicioIds.map(Number);
    } else if (dto.tieneServiciosEspeciales !== undefined) {
      finalServicioIds = Array.isArray((agencia as any).servicioIds) ? (agencia as any).servicioIds.map(Number) : [];
    }

    let finalServiciosNombres: string[] | undefined = undefined;
    if (finalServicioIds !== undefined) {
      const especiales = await this.prisma.catalogoServicio.findMany({
        where: { categoria: 'ESPECIAL' },
        select: { id: true },
      });
      const especialIds = new Set(especiales.map((s) => s.id));

      if (tieneEspeciales) {
        finalServicioIds = Array.from(new Set([...finalServicioIds, ...especialIds]));
      } else {
        finalServicioIds = finalServicioIds.filter((id) => !especialIds.has(id));
      }

      const dbServicios = await this.prisma.catalogoServicio.findMany({
        where: { id: { in: finalServicioIds } },
        select: { nombre: true },
      });
      finalServiciosNombres = dbServicios.map((s) => s.nombre);
    }

    const updated = await this.prisma.agencia.update({
      where: { id: dto.id },
      data: {
        ...(dto.codigo && { codigo: dto.codigo.trim().toUpperCase() }),
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(regionNombre && { region: regionNombre }),
        ...(regionIdFinal !== undefined && { regionId: regionIdFinal }),
        ...(dto.direccion !== undefined && { direccion: dto.direccion?.trim() }),
        ...(dto.telefono !== undefined && { telefono: dto.telefono?.trim() }),
        ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() }),
        ...(dto.numeroBahias !== undefined && { numeroBahias: dto.numeroBahias }),
        ...(dto.maxLavadoresPorBahia !== undefined && { maxLavadoresPorBahia: dto.maxLavadoresPorBahia }),
        ...(clienteIdFinal !== undefined && { clienteId: clienteIdFinal }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(dto.tieneServiciosEspeciales !== undefined && { tieneServiciosEspeciales: dto.tieneServiciosEspeciales }),
        ...(dto.tipoUbicacion !== undefined && { tipoUbicacion: dto.tipoUbicacion }),
        ...(finalServicioIds !== undefined ? { servicioIds: finalServicioIds } : {}),
        ...(finalServiciosNombres !== undefined ? { serviciosNombres: finalServiciosNombres } : (Array.isArray(dto.serviciosNombres) ? { serviciosNombres: dto.serviciosNombres } : {})),
      },
      include: {
        cliente: true,
        regionRel: true,
        usuarios: {
          include: { role: true }
        },
        bahias: true,
      },
    });

    if (dto.gerenteId !== undefined) {
      if (dto.gerenteId && dto.gerenteId !== '0' && dto.gerenteId !== 'null' && dto.gerenteId !== 'undefined') {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['GERENTE', 'APROBADOR', 'LIDER_AGENCIA', 'LIDER'] } } },
          data: { agenciaId: null },
        });
        await this.prisma.user.update({
          where: { id: dto.gerenteId },
          data: { agenciaId: updated.id },
        }).catch((e) => console.warn('No se pudo asignar gerente en updateAgencia', e));
      } else {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['GERENTE', 'APROBADOR', 'LIDER_AGENCIA', 'LIDER'] } } },
          data: { agenciaId: null },
        });
      }
    }

    if (dto.liderOperadorId !== undefined) {
      if (dto.liderOperadorId && dto.liderOperadorId !== '0' && dto.liderOperadorId !== 'null' && dto.liderOperadorId !== 'undefined') {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['LIDER', 'LIDER_OPERADOR', 'LIDER_AGENCIA'] } } },
          data: { agenciaId: null },
        });
        await this.prisma.user.update({
          where: { id: dto.liderOperadorId },
          data: { agenciaId: updated.id },
        }).catch((e) => console.warn('No se pudo asignar líder operador en updateAgencia', e));
      } else {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['LIDER', 'LIDER_OPERADOR', 'LIDER_AGENCIA'] } } },
          data: { agenciaId: null },
        });
      }
    }

    if (dto.numeroBahias && dto.numeroBahias > 0) {
      for (let i = 1; i <= dto.numeroBahias; i++) {
        const numStr = String(i).padStart(2, '0');
        const codigoBahia = `${updated.codigo}-B${numStr}`;
        await this.prisma.bahia.upsert({
          where: { codigo: codigoBahia },
          create: {
            codigo: codigoBahia,
            nombre: `Bahía ${numStr}`,
            agenciaId: updated.id,
            activa: true,
          },
          update: {},
        });
      }
    }

    const finalAgencia = await this.prisma.agencia.findUnique({
      where: { id: updated.id },
      include: {
        cliente: true,
        regionRel: true,
        usuarios: {
          select: {
            id: true,
            name: true,
            lastname: true,
            estado: true,
            role: { select: { id: true, namerol: true } },
          },
        },
        bahias: true,
        _count: {
          select: {
            bahias: true,
            usuarios: true,
            solicitudesAprobacion: true,
            maquinarias: true,
          },
        },
      },
    });

    const ger = finalAgencia?.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'GERENTE' || r === 'APROBADOR' || r.includes('GERENTE') || r.includes('APROBADOR') || r === 'LIDER_AGENCIA';
    });
    const lider = finalAgencia?.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER' || r === 'LIDER_OPERADOR' || r.includes('LIDER') || r.includes('LÍDER');
    });

    const serviciosParaSincronizar = Array.isArray(finalServicioIds)
      ? finalServicioIds
      : (Array.isArray(updated.servicioIds) ? (updated.servicioIds as number[]) : []);
    if (serviciosParaSincronizar.length > 0) {
      await this.sincronizarStockInsumosPorServicios(updated.id, serviciosParaSincronizar);
    }

    return {
      ...finalAgencia,
      responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
      gerenteId: ger?.id || null,
      gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
      liderOperador: lider ? `${lider.name} ${lider.lastname}`.trim() : 'Sin Asignar',
      liderOperadorId: lider?.id || null,
      liderOperadorNombre: lider ? `${lider.name} ${lider.lastname}`.trim() : null,
    };
  }

  async toggleEstadoAgencia(dto: ToggleEstadoAgenciaDto) {
    const agencia = await this.prisma.agencia.findUnique({ where: { id: dto.id } });
    if (!agencia) {
      throw new NotFoundException(`Agencia con ID "${dto.id}" no encontrada`);
    }

    const nuevoEstado = dto.estado !== undefined ? dto.estado : agencia.estado === 1 ? 0 : 1;

    return this.prisma.agencia.update({
      where: { id: dto.id },
      data: { estado: nuevoEstado },
      include: { cliente: true, regionRel: true },
    });
  }

  async resumenAgencia(agenciaId?: string, user?: any) {
    const targetAgenciaId = agenciaId || user?.agenciaId;
    if (!targetAgenciaId) {
      throw new BadRequestException('Se requiere especificar un ID de agencia');
    }

    const agencia = await this.prisma.agencia.findUnique({
      where: { id: targetAgenciaId },
      include: {
        cliente: true,
        regionRel: true,
        bahias: true,
        usuarios: {
          include: { role: true },
        },
      },
    });

    if (!agencia) {
      throw new NotFoundException(`Agencia con ID "${targetAgenciaId}" no encontrada`);
    }

    // Servicios de hoy en las bahías de la agencia
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const bahiaIds = agencia.bahias.map((b) => b.id);
    const serviciosHoy = await this.prisma.servicioLavado.findMany({
      where: {
        bahiaId: { in: bahiaIds },
        createdAt: { gte: startOfDay },
      },
      select: {
        id: true,
        estado: true,
        placa: true,
        catalogo: { select: { nombre: true } },
      },
    });

    // Alertas de stock en la agencia
    const alertasPendientes = await this.prisma.alertaStock.count({
      where: {
        agenciaId: targetAgenciaId,
        estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
      },
    });

    // Desglose de personal
    const pulidores = agencia.usuarios.filter((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r.includes('PULIDOR');
    });
    const lideres = agencia.usuarios.filter((u) =>
      ['LIDER_AGENCIA', 'LIDER', 'APROBADOR'].includes(u.role?.namerol || ''),
    );

    return {
      agencia: {
        id: agencia.id,
        codigo: agencia.codigo,
        nombre: agencia.nombre,
        region: agencia.region,
        regionOficial: agencia.regionRel ? { id: agencia.regionRel.id, nombre: agencia.regionRel.nombre } : null,
        cliente: agencia.cliente?.nombre ?? 'Sin Cliente',
        marca: agencia.cliente?.nombre ?? 'Sin Cliente',
        estado: agencia.estado,
        numeroBahiasCapacidad: agencia.numeroBahias,
      },
      bahias: {
        total: agencia.bahias.length,
        activas: agencia.bahias.filter((b) => b.activa).length,
      },
      personal: {
        totalAsignado: agencia.usuarios.length,
        pulidores: pulidores.length,
        lideresBahia: lideres.length,
        otros: agencia.usuarios.length - pulidores.length - lideres.length,
      },
      operacionesHoy: {
        totalServicios: serviciosHoy.length,
        enEspera: serviciosHoy.filter((s) => s.estado === 'EN_ESPERA').length,
        enProceso: serviciosHoy.filter((s) => s.estado === 'EN_PROCESO').length,
        finalizados: serviciosHoy.filter((s) => s.estado === 'FINALIZADO').length,
      },
      alertasInventarioPendientes: alertasPendientes,
    };
  }

  // =========================================================================
  // 4. BAHÍAS (CRUD + TOGGLE ACTIVA)
  // =========================================================================

  async listBahias(dto: ListBahiasDto) {
    const where: any = {};
    if (dto.agenciaId) {
      where.agenciaId = dto.agenciaId;
    }
    if (dto.activa !== undefined) {
      where.activa = dto.activa;
    }

    return this.prisma.bahia.findMany({
      where,
      include: {
        agencia: {
          select: { id: true, codigo: true, nombre: true, region: true, maxLavadoresPorBahia: true },
        },
        operadorActual: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        operadores: {
          where: { activo: true },
          include: {
            operador: {
              select: { id: true, name: true, lastname: true, email: true },
            },
          },
        },
        _count: {
          select: { servicios: true },
        },
      },
      orderBy: { codigo: 'asc' },
    });
  }

  async createBahia(dto: CreateBahiaDto) {
    const agencia = await this.prisma.agencia.findUnique({ where: { id: dto.agenciaId } });
    if (!agencia) {
      throw new NotFoundException(`Agencia con ID "${dto.agenciaId}" no encontrada`);
    }

    const codigoExiste = await this.prisma.bahia.findUnique({
      where: { codigo: dto.codigo.trim().toUpperCase() },
    });
    if (codigoExiste) {
      throw new ConflictException(`Ya existe una bahía con el código "${dto.codigo}"`);
    }

    return this.prisma.bahia.create({
      data: {
        codigo: dto.codigo.trim().toUpperCase(),
        nombre: dto.nombre.trim(),
        agenciaId: dto.agenciaId,
        activa: dto.activa ?? true,
      },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });
  }

  async updateBahia(dto: UpdateBahiaDto) {
    const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.id } });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.id}" no encontrada`);
    }

    return this.prisma.bahia.update({
      where: { id: dto.id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.activa !== undefined && { activa: dto.activa }),
      },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });
  }

  async toggleActivaBahia(dto: ToggleActivaBahiaDto) {
    const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.id } });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.id}" no encontrada`);
    }

    const nuevaActiva = dto.activa !== undefined ? dto.activa : !bahia.activa;

    return this.prisma.bahia.update({
      where: { id: dto.id },
      data: { activa: nuevaActiva },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });
  }

  async asignarOperadorABahia(dto: AsignarOperadorBahiaDto, asignadoPorId: string) {
    const bahia = await this.prisma.bahia.findUnique({
      where: { id: dto.bahiaId },
      include: { operadorActual: true, agencia: true },
    });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.bahiaId}" no encontrada`);
    }

    const operadorNuevoId = dto.operadorId && dto.operadorId.trim() ? dto.operadorId.trim() : null;

    if (operadorNuevoId) {
      const operador = await this.prisma.user.findUnique({ where: { id: operadorNuevoId } });
      if (!operador) {
        throw new NotFoundException(`Operador con ID "${operadorNuevoId}" no encontrado`);
      }

      // Verificar que el operador no esté ya asignado a esta bahía
      const yaAsignado = await this.prisma.bahiaOperador.findUnique({
        where: { bahiaId_operadorId: { bahiaId: bahia.id, operadorId: operadorNuevoId } },
      });
      if (yaAsignado && yaAsignado.activo) {
        throw new ConflictException(`El operador ya está asignado a esta bahía`);
      }

      // Validar máximo de lavadores por bahía
      const maxLav = bahia.agencia?.maxLavadoresPorBahia ?? 1;
      const activosEnBahia = await this.prisma.bahiaOperador.count({
        where: { bahiaId: bahia.id, activo: true, operadorId: { not: operadorNuevoId } },
      });
      if (activosEnBahia >= maxLav) {
        throw new BadRequestException(`La bahía alcanzó el máximo de ${maxLav} lavador(es) simultáneos`);
      }

      // Si el operador estaba en OTRA bahía, desasignarlo de allí
      const asignacionAnterior = await this.prisma.bahiaOperador.findFirst({
        where: { operadorId: operadorNuevoId, activo: true, bahiaId: { not: bahia.id } },
        include: { bahia: { include: { agencia: true } } },
      });
      if (asignacionAnterior) {
        await this.prisma.bahiaOperador.update({
          where: { id: asignacionAnterior.id },
          data: { activo: false },
        });
        await this.prisma.historialAsignacionBahia.updateMany({
          where: { bahiaId: asignacionAnterior.bahiaId, operadorId: operadorNuevoId, fechaFin: null },
          data: { fechaFin: new Date() },
        });
        await this.prisma.bahia.update({
          where: { id: asignacionAnterior.bahiaId },
          data: { operadorActualId: null },
        });
      }
    }

    const now = new Date();

    // Si se desvincula el operador actual de esta bahía (operadorId = null)
    if (!operadorNuevoId && bahia.operadorActualId) {
      await this.prisma.historialAsignacionBahia.updateMany({
        where: { bahiaId: bahia.id, operadorId: bahia.operadorActualId, fechaFin: null },
        data: { fechaFin: now },
      });
      // Desactivar todas las asignaciones activas de esta bahía
      await this.prisma.bahiaOperador.updateMany({
        where: { bahiaId: bahia.id, activo: true },
        data: { activo: false },
      });
    }

    // Crear registro en BahiaOperador si se asigna un operador
    if (operadorNuevoId) {
      const motivoFinal = dto.notas || (
        `Asignación a ${bahia.nombre} (${bahia.agencia?.nombre || 'Agencia'})`
      );

      // Upsert en tabla intermedia
      await this.prisma.bahiaOperador.upsert({
        where: { bahiaId_operadorId: { bahiaId: bahia.id, operadorId: operadorNuevoId } },
        create: {
          bahiaId: bahia.id,
          operadorId: operadorNuevoId,
          activo: true,
          asignadoPorId,
        },
        update: { activo: true },
      });

      // Crear historial de asignación
      await this.prisma.historialAsignacionBahia.create({
        data: {
          bahiaId: bahia.id,
          operadorId: operadorNuevoId,
          fechaInicio: now,
          asignadoPorId,
          motivo: motivoFinal,
        },
      });
    }

    // Actualizar operadorActualId de la bahía (compatibilidad legacy)
    await this.prisma.bahia.update({
      where: { id: bahia.id },
      data: { operadorActualId: operadorNuevoId },
    });

    // Actualizar agencia del operador
    if (operadorNuevoId) {
      await this.prisma.user.update({
        where: { id: operadorNuevoId },
        data: { updatedAt: now, agenciaId: bahia.agenciaId },
      });
    }

    // Retornar bahía actualizada con operadores múltiples
    return this.prisma.bahia.findUnique({
      where: { id: bahia.id },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true, maxLavadoresPorBahia: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
        operadores: {
          where: { activo: true },
          include: {
            operador: { select: { id: true, name: true, lastname: true, email: true } },
          },
        },
      },
    });
  }

  async listarOperadoresDeBahia(bahiaId: string) {
    const bahia = await this.prisma.bahia.findUnique({ where: { id: bahiaId } });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${bahiaId}" no encontrada`);
    }
    return this.prisma.bahiaOperador.findMany({
      where: { bahiaId, activo: true },
      include: {
        operador: {
          select: { id: true, name: true, lastname: true, email: true },
        },
        asignadoPor: {
          select: { id: true, name: true, lastname: true },
        },
      },
      orderBy: { fechaAsignacion: 'asc' },
    });
  }

  async desasignarOperadorDeBahia(dto: DesasignarOperadorBahiaDto, desasignadoPorId: string) {
    const bahia = await this.prisma.bahia.findUnique({
      where: { id: dto.bahiaId },
      include: { agencia: true },
    });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.bahiaId}" no encontrada`);
    }

    const asignacion = await this.prisma.bahiaOperador.findUnique({
      where: { bahiaId_operadorId: { bahiaId: dto.bahiaId, operadorId: dto.operadorId } },
    });
    if (!asignacion || !asignacion.activo) {
      throw new NotFoundException(`El operador no está asignado activamente a esta bahía`);
    }

    const now = new Date();

    // Desactivar la asignación en tabla intermedia
    await this.prisma.bahiaOperador.update({
      where: { id: asignacion.id },
      data: { activo: false },
    });

    // Cerrar historial activo
    await this.prisma.historialAsignacionBahia.updateMany({
      where: { bahiaId: dto.bahiaId, operadorId: dto.operadorId, fechaFin: null },
      data: { fechaFin: now },
    });

    // Si era el operadorActual, buscar el siguiente o null
    if (bahia.operadorActualId === dto.operadorId) {
      const siguiente = await this.prisma.bahiaOperador.findFirst({
        where: { bahiaId: dto.bahiaId, activo: true, operadorId: { not: dto.operadorId } },
        orderBy: { fechaAsignacion: 'asc' },
      });
      await this.prisma.bahia.update({
        where: { id: dto.bahiaId },
        data: { operadorActualId: siguiente?.operadorId || null },
      });
    }

    return this.prisma.bahia.findUnique({
      where: { id: dto.bahiaId },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });
  }

  async obtenerHistorialAsignaciones(dto: ListHistorialAsignacionesDto) {
    const where: any = {};
    if (dto.bahiaId) where.bahiaId = dto.bahiaId;
    if (dto.operadorId) where.operadorId = dto.operadorId;

    const page = dto.page ? Number(dto.page) : 1;
    const pageSize = dto.pageSize ? Number(dto.pageSize) : 50;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.historialAsignacionBahia.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { fechaInicio: 'desc' },
        include: {
          bahia: {
            select: { id: true, codigo: true, nombre: true, agencia: { select: { id: true, nombre: true } } },
          },
          operador: {
            select: { id: true, name: true, lastname: true, email: true },
          },
          asignadoPor: {
            select: { id: true, name: true, lastname: true, email: true },
          },
        },
      }),
      this.prisma.historialAsignacionBahia.count({ where }),
    ]);

    return {
      data: items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // =========================================================================
  // 5. ASIGNACIÓN DE USUARIOS A AGENCIAS Y REGIONES
  // =========================================================================

  async asignarUsuario(dto: AsignarUsuarioAgenciaDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.usuarioId } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${dto.usuarioId}" no encontrado`);
    }

    if (user.estado !== 1) {
      throw new BadRequestException('No se puede asignar un usuario inactivo. Debe activarlo primero.');
    }

    if (dto.agenciaId) {
      const agencia = await this.prisma.agencia.findUnique({ where: { id: dto.agenciaId } });
      if (!agencia) {
        throw new NotFoundException(`Agencia principal con ID "${dto.agenciaId}" no encontrada`);
      }
    }

    if (dto.regionId) {
      const region = await this.prisma.region.findUnique({ where: { id: dto.regionId } });
      if (!region) {
        throw new NotFoundException(`Región con ID "${dto.regionId}" no encontrada`);
      }
    }

    // Validar agenciasIds secundarias si vienen
    if (dto.agenciasIds && dto.agenciasIds.length > 0) {
      const validAgencias = await this.prisma.agencia.findMany({
        where: { id: { in: dto.agenciasIds } },
        select: { id: true },
      });
      if (validAgencias.length !== dto.agenciasIds.length) {
        throw new BadRequestException('Uno o más IDs de agencias secundarias no son válidos');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: dto.usuarioId },
      data: {
        ...(dto.agenciaId !== undefined && { agenciaId: dto.agenciaId }),
        ...(dto.regionId !== undefined && { regionId: dto.regionId }),
        ...(dto.agenciasIds && { agenciasIds: dto.agenciasIds }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        roleId: true,
        role: { select: { id: true, namerol: true } },
        agenciaId: true,
        agencia: { select: { id: true, codigo: true, nombre: true, region: true } },
        regionId: true,
        region: { select: { id: true, codigo: true, nombre: true } },
        agenciasIds: true,
        estado: true,
      },
    });

    return {
      message: `Usuario ${updatedUser.name} ${updatedUser.lastname} asignado correctamente`,
      user: updatedUser,
    };
  }

  async toggleEstadoUsuario(dto: ToggleEstadoUsuarioDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.usuarioId } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${dto.usuarioId}" no encontrado`);
    }

    const nuevoEstado = dto.estado !== undefined ? dto.estado : (user.estado === 1 ? 0 : 1);

    const updatedUser = await this.prisma.user.update({
      where: { id: dto.usuarioId },
      data: { estado: nuevoEstado },
      include: {
        role: true,
        agencia: true,
        region: true,
      },
    });

    return {
      message: `Usuario ${updatedUser.name} ${updatedUser.lastname} ${nuevoEstado === 1 ? 'activado' : 'desactivado'} correctamente`,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        lastname: updatedUser.lastname,
        email: updatedUser.email,
        estado: updatedUser.estado,
        role: updatedUser.role,
        agencia: updatedUser.agencia,
        region: updatedUser.region,
      },
    };
  }

  async updateUsuario(dto: UpdateUsuarioDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.id }, include: { role: true } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${dto.id}" no encontrado`);
    }

    if (user.role?.namerol === 'SUPER_ADMIN') {
      throw new ForbiddenException('El usuario Super Administrador es de sistema y no puede gestionarse desde la aplicación.');
    }

    let roleIdToSet: string | undefined = undefined;
    if (dto.roleId) {
      const roleExists = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
      if (roleExists) {
        if (roleExists.namerol === 'SUPER_ADMIN') {
          throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
        }
        roleIdToSet = roleExists.id;
      }
    }
    if (!roleIdToSet && dto.rolNombre) {
      const norm = dto.rolNombre.toUpperCase().trim();
      if (norm === 'SUPER_ADMIN' || (norm.includes('SUPER') && norm.includes('ADMIN'))) {
        throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
      }
      let code = norm;
      if (norm.includes('ADMIN')) code = 'ADMIN';
      else if (norm.includes('SUPERVISOR')) code = 'SUPERVISOR';
      else if (norm.includes('JEFE') && norm.includes('COMERCIAL')) code = 'JEFE_COMERCIAL';
      else if (norm.includes('COORD') && norm.includes('COMERCIAL')) code = 'COORD_COMERCIAL';
      else if (norm.includes('APROBADOR') || norm.includes('GERENTE')) code = 'APROBADOR';
      else if (norm.includes('LIDER') || norm.includes('LÍDER')) code = 'LIDER';
      else if (norm.includes('ESPECIALES')) code = 'COORD_SERVICIOS_ESPECIALES';
      else if (norm.includes('PULIDOR')) code = 'PULIDOR';
      else if (norm.includes('MANTENIMIENTO')) code = 'COORD_MANTENIMIENTO';
      else if (norm.includes('TECNICO') || norm.includes('TÉCNICO')) code = 'TECNICO';
      else if (norm.includes('ASISTENTE')) code = 'ASISTENTE_BODEGA';
      else if (norm.includes('BODEGA') || norm.includes('INVENTARIO') || norm.includes('DISTRIBUIDOR') || norm.includes('GESTOR')) code = 'COORD_BODEGA';
      else if (norm.includes('LAVADOR') || norm === 'OPERADOR') code = 'LAVADOR';

      const roleFound = await this.prisma.role.findFirst({
        where: {
          OR: [
            { namerol: dto.rolNombre },
            { namerol: dto.rolNombre.toUpperCase() },
            { namerol: code },
            { namerol: code === 'COORD_BODEGA' ? 'DISTRIBUIDOR' : code },
          ],
        },
      });
      if (roleFound?.namerol === 'SUPER_ADMIN') {
        throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
      }
      if (roleFound) roleIdToSet = roleFound.id;
    }

    let passwordHashToSet: string | undefined;
    if (dto.password && dto.password.trim().length >= 6) {
      passwordHashToSet = await bcrypt.hash(dto.password.trim(), 10);
    }

    let agenciaIdToSet: string | null | undefined = undefined;
    let regionIdToSet: string | null | undefined = undefined;
    let bodegaIdToSet: string | null | undefined = undefined;

    if (dto.agenciaId !== undefined) {
      if (!dto.agenciaId || dto.agenciaId === 'null' || dto.agenciaId === 'Sin asignar' || dto.agenciaId.toLowerCase().includes('sin sucursal')) {
        agenciaIdToSet = null;
        regionIdToSet = null;
      } else {
        const ag = await this.prisma.agencia.findFirst({
          where: { OR: [{ id: dto.agenciaId }, { nombre: dto.agenciaId }] },
        });
        if (ag) {
          agenciaIdToSet = ag.id;
          if (ag.regionId) regionIdToSet = ag.regionId;
        } else {
          agenciaIdToSet = dto.agenciaId;
        }
      }
    } else if (dto.agencia !== undefined) {
      if (!dto.agencia || dto.agencia === 'Sin asignar' || dto.agencia === 'EasyDry Corporativo' || dto.agencia.toLowerCase().includes('sin sucursal')) {
        agenciaIdToSet = null;
        regionIdToSet = null;
      } else {
        const ag = await this.prisma.agencia.findFirst({
          where: { OR: [{ nombre: dto.agencia }, { id: dto.agencia }] },
        });
        if (ag) {
          agenciaIdToSet = ag.id;
          if (ag.regionId) regionIdToSet = ag.regionId;
        } else {
          agenciaIdToSet = null;
        }
      }
    }

    if (!regionIdToSet && (dto.regionId || dto.agencia)) {
      if (dto.regionId) {
        const reg = await this.prisma.region.findFirst({
          where: {
            OR: [
              { id: dto.regionId },
              { nombre: { contains: dto.regionId, mode: 'insensitive' } },
              { codigo: { contains: dto.regionId, mode: 'insensitive' } },
            ],
          },
        });
        if (reg) regionIdToSet = reg.id;
      }
      if (!regionIdToSet && dto.agencia) {
        const searchWord = dto.agencia
          .replace(/bodega regional|bodega central|bodega/gi, '')
          .replace(/-.*/g, '')
          .trim();
        if (searchWord) {
          const reg = await this.prisma.region.findFirst({
            where: {
              OR: [
                { nombre: { contains: searchWord, mode: 'insensitive' } },
                { codigo: { contains: searchWord, mode: 'insensitive' } },
              ],
            },
          });
          if (reg) regionIdToSet = reg.id;
        }
      }
    }

    const currentRoleName = user.role?.namerol || dto.rolNombre || '';
    const userRoleCode = currentRoleName.toUpperCase();
    if (userRoleCode.includes('SUPER') && userRoleCode.includes('ADMIN')) {
      agenciaIdToSet = null;
      regionIdToSet = null;
      bodegaIdToSet = null;
    } else if (userRoleCode === 'ADMIN' || userRoleCode === 'ADMINISTRADOR') {
      agenciaIdToSet = null;
      regionIdToSet = null;
      bodegaIdToSet = null;
    } else if (
      userRoleCode === 'COORD_BODEGA' ||
      userRoleCode === 'DISTRIBUIDOR' ||
      (userRoleCode.includes('GESTOR') && userRoleCode.includes('INVENTARIO')) ||
      (userRoleCode.includes('GESTOR') && userRoleCode.includes('BODEGA'))
    ) {
      // Coord Bodega: acceso total nacional (sin agencia ni región fija)
      agenciaIdToSet = null;
      regionIdToSet = null;
      if (dto.bodegaId !== undefined) bodegaIdToSet = dto.bodegaId || null;
    } else if (userRoleCode.includes('SUPERVISOR')) {
      agenciaIdToSet = null;
      bodegaIdToSet = null;
      if (!regionIdToSet) {
        regionIdToSet = user.regionId;
      }
      if (!regionIdToSet) {
        throw new BadRequestException('El supervisor debe tener una región asignada.');
      }
    } else if (
      userRoleCode === 'ASISTENTE_BODEGA' ||
      (userRoleCode.includes('ASISTENTE') && userRoleCode.includes('BODEGA'))
    ) {
      // Asistente de Bodega: vinculado a bodega regional
      agenciaIdToSet = null;
      if (dto.bodegaId !== undefined) {
        bodegaIdToSet = dto.bodegaId || null;
      } else {
        bodegaIdToSet = user.bodegaId;
      }
      if (!bodegaIdToSet) {
        throw new BadRequestException('El Asistente de Bodega debe estar asignado a una bodega regional (bodegaId).');
      }
      const bod = await this.prisma.bodega.findUnique({ where: { id: bodegaIdToSet } });
      if (!bod || bod.tipo === 'CENTRAL' || bod.esCentral) {
        throw new BadRequestException('El Asistente de Bodega solo puede asignarse a bodegas de tipo REGIONAL.');
      }
      regionIdToSet = bod.regionId || regionIdToSet || user.regionId;
    }

    const checkRolName = (user.role?.namerol || dto.rolNombre || '').toUpperCase();
    let isPulidorRole = checkRolName.includes('PULIDOR');
    if (roleIdToSet) {
      const checkRoleObj = await this.prisma.role.findUnique({ where: { id: roleIdToSet } });
      if (checkRoleObj?.namerol.toUpperCase().includes('PULIDOR')) {
        isPulidorRole = true;
      }
    }

    let finalServicioIdsUsuario: number[] | undefined = undefined;
    if (isPulidorRole) {
      const especiales = await this.prisma.catalogoServicio.findMany({
        where: { categoria: 'ESPECIAL' },
        select: { id: true },
      });
      finalServicioIdsUsuario = especiales.map((s) => s.id);
    } else if (dto.servicioIds !== undefined) {
      finalServicioIdsUsuario = Array.isArray(dto.servicioIds)
        ? dto.servicioIds.map(Number).filter((n) => !isNaN(n) && n > 0)
        : [];
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: dto.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.lastname !== undefined && { lastname: dto.lastname }),
        ...(dto.email !== undefined && { email: dto.email.toLowerCase().trim() }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
        ...(roleIdToSet !== undefined && { roleId: roleIdToSet }),
        ...(agenciaIdToSet !== undefined && { agenciaId: agenciaIdToSet }),
        ...(regionIdToSet !== undefined && { regionId: regionIdToSet }),
        ...(bodegaIdToSet !== undefined && { bodegaId: bodegaIdToSet }),
        ...(passwordHashToSet !== undefined && { passwordHash: passwordHashToSet }),
        ...(finalServicioIdsUsuario !== undefined && {
          servicioIds: finalServicioIdsUsuario,
        }),
      },
      include: {
        role: true,
        agencia: true,
        region: true,
        bodega: true,
      },
    });

    const sIdsUser = Array.isArray(updatedUser.servicioIds)
      ? (updatedUser.servicioIds as any[]).map(Number).filter((n) => !isNaN(n) && n > 0)
      : [];
    const rolUser = (updatedUser.role?.namerol || '').toUpperCase();
    if (sIdsUser.length > 0 && (rolUser.includes('PULIDOR') || !updatedUser.agenciaId)) {
      await this.sincronizarStockPulidorPorServicios(updatedUser.id, sIdsUser, dto.id);
    }

    return {
      message: `Usuario ${updatedUser.name} ${updatedUser.lastname} actualizado correctamente`,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        lastname: updatedUser.lastname,
        email: updatedUser.email,
        estado: updatedUser.estado,
        role: updatedUser.role,
        agencia: updatedUser.agencia,
        region: updatedUser.region,
        bodega: updatedUser.bodega,
        servicioIds: Array.isArray(updatedUser.servicioIds) ? updatedUser.servicioIds : [],
      },
    };
  }

  async createUsuario(dto: CreateUsuarioDto) {
    const emailNorm = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: emailNorm } });
    if (existing) {
      throw new ConflictException(`Ya existe un usuario con el correo electrónico "${emailNorm}"`);
    }

    let roleIdToSet: string | undefined = undefined;
    if (dto.roleId) {
      const roleExists = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
      if (roleExists) {
        if (roleExists.namerol === 'SUPER_ADMIN') {
          throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
        }
        roleIdToSet = roleExists.id;
      }
    }
    if (!roleIdToSet && dto.rolNombre) {
      const norm = dto.rolNombre.toUpperCase().trim();
      if (norm === 'SUPER_ADMIN' || (norm.includes('SUPER') && norm.includes('ADMIN'))) {
        throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
      }
      let code = norm;
      if (norm.includes('ADMIN')) code = 'ADMIN';
      else if (norm.includes('SUPERVISOR')) code = 'SUPERVISOR';
      else if (norm.includes('JEFE') && norm.includes('COMERCIAL')) code = 'JEFE_COMERCIAL';
      else if (norm.includes('COORD') && norm.includes('COMERCIAL')) code = 'COORD_COMERCIAL';
      else if (norm.includes('APROBADOR') || norm.includes('GERENTE')) code = 'APROBADOR';
      else if (norm.includes('LIDER') || norm.includes('LÍDER')) code = 'LIDER';
      else if (norm.includes('ESPECIALES')) code = 'COORD_SERVICIOS_ESPECIALES';
      else if (norm.includes('PULIDOR')) code = 'PULIDOR';
      else if (norm.includes('MANTENIMIENTO')) code = 'COORD_MANTENIMIENTO';
      else if (norm.includes('TECNICO') || norm.includes('TÉCNICO')) code = 'TECNICO';
      else if (norm.includes('ASISTENTE')) code = 'ASISTENTE_BODEGA';
      else if (norm.includes('BODEGA') || norm.includes('INVENTARIO') || norm.includes('DISTRIBUIDOR') || norm.includes('GESTOR')) code = 'COORD_BODEGA';
      else if (norm.includes('LAVADOR') || norm === 'OPERADOR') code = 'LAVADOR';

      const roleFound = await this.prisma.role.findFirst({
        where: {
          OR: [
            { namerol: dto.rolNombre },
            { namerol: dto.rolNombre.toUpperCase() },
            { namerol: code },
            { namerol: code === 'COORD_BODEGA' ? 'DISTRIBUIDOR' : code },
          ],
        },
      });
      if (roleFound?.namerol === 'SUPER_ADMIN') {
        throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
      }
      if (roleFound) roleIdToSet = roleFound.id;
    }

    if (!roleIdToSet) {
      const fallbackRole = await this.prisma.role.findFirst({
        where: { namerol: { not: 'SUPER_ADMIN' } },
      });
      if (fallbackRole) roleIdToSet = fallbackRole.id;
    }

    if (!roleIdToSet) {
      throw new BadRequestException('No se encontró un rol válido para asignar al usuario');
    }

    // Agencia y región son 100% opcionales en la creación
    let agenciaIdToSet: string | null = null;
    let regionIdToSet: string | null = null;
    let bodegaIdToSet: string | null = null;
    if (dto.agenciaId && dto.agenciaId !== 'Sin asignar' && !dto.agenciaId.toLowerCase().includes('sin sucursal')) {
      const ag = await this.prisma.agencia.findFirst({
        where: { OR: [{ id: dto.agenciaId }, { nombre: dto.agenciaId }] },
      });
      if (ag) {
        agenciaIdToSet = ag.id;
        regionIdToSet = ag.regionId || null;
      } else {
        agenciaIdToSet = dto.agenciaId;
      }
    } else if (dto.agencia && dto.agencia !== 'EasyDry Corporativo' && !dto.agencia.toLowerCase().includes('sin asignar') && !dto.agencia.toLowerCase().includes('sin sucursal')) {
      const agenciaFound = await this.prisma.agencia.findFirst({
        where: { OR: [{ nombre: dto.agencia }, { id: dto.agencia }] },
      });
      if (agenciaFound) {
        agenciaIdToSet = agenciaFound.id;
        regionIdToSet = agenciaFound.regionId || null;
      }
    }

    if (!regionIdToSet && (dto.regionId || dto.agencia)) {
      if (dto.regionId) {
        const reg = await this.prisma.region.findFirst({
          where: {
            OR: [
              { id: dto.regionId },
              { nombre: { contains: dto.regionId, mode: 'insensitive' } },
              { codigo: { contains: dto.regionId, mode: 'insensitive' } },
            ],
          },
        });
        if (reg) regionIdToSet = reg.id;
      }
      if (!regionIdToSet && dto.agencia) {
        const searchWord = dto.agencia
          .replace(/bodega regional|bodega central|bodega/gi, '')
          .replace(/-.*/g, '')
          .trim();
        if (searchWord) {
          const reg = await this.prisma.region.findFirst({
            where: {
              OR: [
                { nombre: { contains: searchWord, mode: 'insensitive' } },
                { codigo: { contains: searchWord, mode: 'insensitive' } },
              ],
            },
          });
          if (reg) regionIdToSet = reg.id;
        }
      }
    }

    if (dto.bodegaId) {
      const bodega = await this.prisma.bodega.findUnique({ where: { id: dto.bodegaId } });
      if (!bodega) {
        throw new BadRequestException(`Bodega "${dto.bodegaId}" no encontrada`);
      }
      bodegaIdToSet = bodega.id;
      if (bodega.regionId) regionIdToSet = bodega.regionId;
    }

    const userRoleCode = (dto.rolNombre || '').toUpperCase();
    if (userRoleCode.includes('SUPER') && userRoleCode.includes('ADMIN')) {
      agenciaIdToSet = null;
      regionIdToSet = null;
      bodegaIdToSet = null;
    } else if (userRoleCode === 'ADMIN' || userRoleCode === 'ADMINISTRADOR') {
      agenciaIdToSet = null;
      regionIdToSet = null;
      bodegaIdToSet = null;
    } else if (
      userRoleCode === 'COORD_BODEGA' ||
      userRoleCode === 'DISTRIBUIDOR' ||
      (userRoleCode.includes('GESTOR') && userRoleCode.includes('INVENTARIO')) ||
      (userRoleCode.includes('GESTOR') && userRoleCode.includes('BODEGA'))
    ) {
      // Coord Bodega: alcance nacional sin agencia/región; bodega opcional (central)
      agenciaIdToSet = null;
      regionIdToSet = null;
    } else if (userRoleCode.includes('SUPERVISOR')) {
      agenciaIdToSet = null;
      bodegaIdToSet = null;
      if (!regionIdToSet) {
        throw new BadRequestException('El supervisor debe tener una región asignada.');
      }
    } else if (
      userRoleCode === 'ASISTENTE_BODEGA' ||
      (userRoleCode.includes('ASISTENTE') && userRoleCode.includes('BODEGA'))
    ) {
      agenciaIdToSet = null;
      if (!bodegaIdToSet) {
        throw new BadRequestException('El Asistente de Bodega debe estar asignado a una bodega regional (bodegaId).');
      }
      const bod = await this.prisma.bodega.findUnique({ where: { id: bodegaIdToSet } });
      if (!bod || bod.tipo === 'CENTRAL' || bod.esCentral) {
        throw new BadRequestException('El Asistente de Bodega solo puede asignarse a bodegas de tipo REGIONAL.');
      }
      regionIdToSet = bod.regionId || regionIdToSet;
      if (!regionIdToSet) {
        throw new BadRequestException('La bodega asignada al asistente debe tener región.');
      }
    } else if (userRoleCode === 'LIDER' || userRoleCode.includes('LIDER')) {
      if (!agenciaIdToSet) {
        throw new BadRequestException('El Líder Operador debe tener una agencia asignada.');
      }
      bodegaIdToSet = null;
    }

    const passwordToHash = dto.password?.trim();
    if (!passwordToHash) {
      throw new BadRequestException('La contraseña es obligatoria para crear el usuario.');
    }
    const passwordHash = await bcrypt.hash(passwordToHash, 10);

    let servicioIdsToSet = Array.isArray(dto.servicioIds)
      ? dto.servicioIds.map(Number).filter((n) => !isNaN(n) && n > 0)
      : [];

    let isPulidorCreate = (dto.rolNombre || '').toUpperCase().includes('PULIDOR');
    if (!isPulidorCreate && roleIdToSet) {
      const roleObj = await this.prisma.role.findUnique({ where: { id: roleIdToSet } });
      if (roleObj?.namerol.toUpperCase().includes('PULIDOR')) {
        isPulidorCreate = true;
      }
    }
    if (isPulidorCreate) {
      const especiales = await this.prisma.catalogoServicio.findMany({
        where: { categoria: 'ESPECIAL' },
        select: { id: true },
      });
      servicioIdsToSet = especiales.map((s) => s.id);
    }

    const newUser = await this.prisma.user.create({
      data: {
        name: dto.name,
        lastname: dto.lastname || '',
        email: emailNorm,
        passwordHash,
        roleId: roleIdToSet,
        agenciaId: agenciaIdToSet,
        regionId: regionIdToSet,
        bodegaId: bodegaIdToSet,
        servicioIds: servicioIdsToSet,
        estado: dto.estado !== undefined ? dto.estado : 1,
      },
      include: {
        role: true,
        agencia: true,
        region: true,
        bodega: true,
      },
    });

    if (servicioIdsToSet.length > 0) {
      const rolNuevo = (newUser.role?.namerol || dto.rolNombre || '').toUpperCase();
      if (rolNuevo.includes('PULIDOR') || !newUser.agenciaId) {
        await this.sincronizarStockPulidorPorServicios(newUser.id, servicioIdsToSet, newUser.id);
      }
    }

    return {
      message: `Usuario ${newUser.name} ${newUser.lastname} creado correctamente`,
      user: {
        id: newUser.id,
        name: newUser.name,
        lastname: newUser.lastname,
        email: newUser.email,
        estado: newUser.estado,
        role: newUser.role,
        agencia: newUser.agencia,
        region: newUser.region,
        bodega: newUser.bodega,
        bodegaId: newUser.bodegaId,
        servicioIds: Array.isArray(newUser.servicioIds) ? newUser.servicioIds : [],
      },
    };
  }

  async deleteUsuario(dto: DeleteUsuarioDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.id } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${dto.id}" no encontrado`);
    }

    try {
      await this.prisma.user.delete({ where: { id: dto.id } });
    } catch (e) {
      // Si el usuario tiene registros vinculados (auditorías, servicios históricos), desactivar y desvincular
      await this.prisma.user.update({
        where: { id: dto.id },
        data: {
          estado: 0,
          agenciaId: null,
          regionId: null,
          agenciasIds: [],
        },
      });
    }

    return {
      message: `Usuario ${user.name} ${user.lastname} eliminado correctamente`,
      id: dto.id,
    };
  }

  async listUsuariosPorAgencia(dto: ListUsuariosAgenciaDto, _userRole?: string) {
    const where: any = {
      // Usuario SUPER_ADMIN nunca se lista en directorios
      role: { namerol: { not: 'SUPER_ADMIN' } },
    };

    if (dto.agenciaId) {
      where.OR = [
        { agenciaId: dto.agenciaId },
        { agenciasIds: { has: dto.agenciaId } },
      ];
    }

    if (dto.rolNombre) {
      // Si piden explícitamente SUPER_ADMIN, no devolver nada
      if (dto.rolNombre.trim().toUpperCase() === 'SUPER_ADMIN') {
        return [];
      }
      where.role = { namerol: dto.rolNombre };
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        lastname: true,
        estado: true,
        role: { select: { id: true, namerol: true } },
        agenciaId: true,
        agencia: { select: { id: true, codigo: true, nombre: true } },
        regionId: true,
        region: { select: { id: true, codigo: true, nombre: true } },
        agenciasIds: true,
        servicioIds: true,
        bodegaId: true,
        bodega: { select: { id: true, codigo: true, nombre: true } },
        avatarUrl: true,
        updatedAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  // =========================================================================
  // 6. GESTIÓN OFICIAL DE OPERADORES DE BAHÍA (100% BASE DE DATOS)
  // =========================================================================

  private mapUserToOperador(u: any) {
    const rawLastname = u.lastname || '';
    const cedulaMatch = rawLastname.match(/CI:\s*([A-Za-z0-9]+)/) || (u.email || '').match(/op\.([A-Za-z0-9]+)@/);
    const cedula = cedulaMatch ? cedulaMatch[1] : (u.email ? u.email.split('@')[0].replace('op.', '') : 'N/A');
    const cleanLastname = rawLastname.replace(/\(CI:[^)]+\)/, '').replace(/CI:[^)]+/, '').trim();
    const fullName = `${u.name || ''} ${cleanLastname}`.trim();
    const bahiaActual = u.bahiasAsignadas && u.bahiasAsignadas.length > 0 ? u.bahiasAsignadas[0] : null;

    return {
      id: u.id,
      nombre: fullName || u.name,
      cedula: cedula,
      telefono: '',
      rol: u.role?.namerol || 'LAVADOR',
      sucursal: u.agencia?.nombre || 'Sin Agencia',
      sucursalId: u.agenciaId || u.agencia?.id || null,
      agenciaId: u.agenciaId || u.agencia?.id || null,
      bahia: bahiaActual ? (bahiaActual.nombre || bahiaActual.codigo || 'Bahía') : 'Sin asignar',
      bahiaNombre: bahiaActual ? (bahiaActual.nombre || bahiaActual.codigo || 'Bahía') : 'Sin asignar',
      bahiaId: bahiaActual ? bahiaActual.id : null,
      estado: u.estado === 1 ? 'Activo' : 'Inactivo',
      fechaIngreso: u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : 'N/A',
      fechaActualizacion: u.updatedAt ? new Date(u.updatedAt).toISOString().split('T')[0] : 'N/A',
      fechaCreacion: u.createdAt ? u.createdAt.toISOString() : null,
      fechaModificacion: u.updatedAt ? u.updatedAt.toISOString() : null,
      fechaAsignacion: bahiaActual?.updatedAt ? bahiaActual.updatedAt.toISOString().split('T')[0] : (u.createdAt ? u.createdAt.toISOString().split('T')[0] : ''),
      vehiculosAtendidos: u._count?.serviciosAtendidos || 0,
      serviciosRealizados: u._count?.serviciosAtendidos || 0,
      promedioDiario: 0,
      ranking: 1,
      email: u.email,
      avatar: u.avatarUrl ? `${u.avatarUrl}${u.avatarUrl.includes('?') ? '&' : '?'}v=${u.updatedAt ? new Date(u.updatedAt).getTime() : Date.now()}` : '',
      avatarUrl: u.avatarUrl ? `${u.avatarUrl}${u.avatarUrl.includes('?') ? '&' : '?'}v=${u.updatedAt ? new Date(u.updatedAt).getTime() : Date.now()}` : '',
    };
  }

  async listOperadores(dto: ListOperadoresDto, currentUser?: any) {
    const rolUsuario = currentUser ? (currentUser?.role?.namerol || currentUser?.roleDetails?.namerol || (typeof currentUser?.role === 'string' ? currentUser.role : '')) : '';
    const isCoordEspeciales = rolUsuario === 'COORD_SERVICIOS_ESPECIALES' || dto.categoriaRol === 'PULIDOR' || dto.rol === 'PULIDOR';
    const isLider = ['LIDER', 'LIDER_OPERADOR', 'LIDER_AGENCIA'].includes(rolUsuario);

    const rolesPulidor = ['PULIDOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL', 'Pulidor', 'Pulidor Móvil', 'Pulidor Fijo'];
    const rolesLavador = ['LAVADOR', 'Lavador', 'Lavador de Bahía', 'OPERADOR'];

    let targetRoles: string[] = ['LAVADOR', 'PULIDOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL', 'TECNICO', 'Pulidor', 'Pulidor Móvil', 'Pulidor Fijo'];

    if (isCoordEspeciales) {
      targetRoles = rolesPulidor;
    } else if (isLider || dto.categoriaRol === 'LAVADOR' || dto.rol === 'LAVADOR') {
      targetRoles = rolesLavador;
    } else if (dto.rol) {
      targetRoles = [dto.rol];
    }

    const where: any = {
      role: {
        namerol: { in: targetRoles }
      }
    };

    // Scoping por Agencia:
    // Si es Líder, SIEMPRE restringido a su propia agencia
    if (isLider && currentUser?.agenciaId) {
      where.agenciaId = currentUser.agenciaId;
    } else if (dto.agenciaId && dto.agenciaId !== 'Todas') {
      where.OR = [
        { agenciaId: dto.agenciaId },
        { agencia: { nombre: dto.agenciaId } }
      ];
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        role: true,
        agencia: true,
        bahiasAsignadas: true,
        _count: {
          select: { serviciosAtendidos: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return users.map(u => this.mapUserToOperador(u));
  }

  async createOperador(dto: CreateOperadorDto, creatorId?: string) {
    const agencia = await this.prisma.agencia.findFirst({
      where: {
        OR: [
          { id: dto.agenciaId },
          { nombre: dto.agenciaId }
        ]
      }
    });
    if (!agencia) {
      throw new NotFoundException(`Agencia "${dto.agenciaId}" no encontrada`);
    }

    const rolTarget = (dto.rol || 'LAVADOR').trim();
    let role = await this.prisma.role.findFirst({
      where: {
        namerol: rolTarget
      }
    });

    if (!role) {
      role = await this.prisma.role.findFirst({
        where: {
          namerol: rolTarget.toUpperCase().includes('PULIDOR') ? 'PULIDOR' : 'LAVADOR'
        }
      });
    }

    if (!role) {
      const isPulidorRole = rolTarget.toUpperCase().includes('PULIDOR');
      role = await this.prisma.role.create({
        data: {
          namerol: isPulidorRole ? 'PULIDOR' : 'LAVADOR',
          descripcion: isPulidorRole 
            ? 'Personal especialista en servicios especiales y pulido' 
            : 'Personal técnico y operativo de lavado y acabado en bahía',
          estado: 1,
          permisos: isPulidorRole ? ['servicios_especiales', 'insumos', 'sync'] : ['servicios', 'bahias', 'sync']
        }
      });
    }

    const cedulaClean = (dto.cedula || '').trim();
    const emailToUse = cedulaClean 
      ? `op.${cedulaClean}@easydry.internal`
      : `op.${Date.now().toString().slice(-6)}@easydry.internal`;

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: emailToUse },
          ...(cedulaClean ? [{ lastname: { contains: `CI: ${cedulaClean}` } }] : [])
        ]
      }
    });
    if (existing) {
      throw new ConflictException(`Ya existe un lavador registrado con esta identificación/cédula (${cedulaClean})`);
    }

    const passwordHash = await bcrypt.hash('Lavador123*', 10);
    const names = dto.nombre.trim().split(' ');
    const firstName = names[0] || 'Lavador';
    const lastNamePart = names.slice(1).join(' ');
    const finalLastName = cedulaClean 
      ? (lastNamePart ? `${lastNamePart} (CI: ${cedulaClean})` : `(CI: ${cedulaClean})`)
      : (lastNamePart || 'Técnico');

    const newUser = await this.prisma.user.create({
      data: {
        name: firstName,
        lastname: finalLastName,
        email: emailToUse,
        passwordHash,
        roleId: role.id,
        agenciaId: agencia.id,
        estado: dto.estado !== undefined ? dto.estado : 1,
      },
      include: {
        role: true,
        agencia: true,
        bahiasAsignadas: true,
        _count: {
          select: { serviciosAtendidos: true }
        }
      }
    });

    // Si se especificó bahía, asignarlo inmediatamente a la bahía en BD
    if (dto.bahiaId && dto.bahiaId.trim() && !dto.bahiaId.toLowerCase().includes('sin bahia') && !dto.bahiaId.toLowerCase().includes('sin bahía')) {
      const bahiaFound = await this.prisma.bahia.findFirst({
        where: {
          agenciaId: agencia.id,
          OR: [
            { id: dto.bahiaId },
            { nombre: dto.bahiaId }
          ]
        }
      });
      if (bahiaFound) {
        await this.asignarOperadorABahia(
          { bahiaId: bahiaFound.id, operadorId: newUser.id, notas: 'Asignación inicial al registrar operador' },
          creatorId || newUser.id
        );
      }
    }

    const created = await this.prisma.user.findUnique({
      where: { id: newUser.id },
      include: {
        role: true,
        agencia: true,
        bahiasAsignadas: true,
        _count: {
          select: { serviciosAtendidos: true }
        }
      }
    });

    return this.mapUserToOperador(created);
  }

  async updateOperador(dto: UpdateOperadorDto, updaterId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.id },
      include: { bahiasAsignadas: true }
    });
    if (!user) {
      throw new NotFoundException(`Operador con ID "${dto.id}" no encontrado`);
    }

    const dataToUpdate: any = {};
    if (dto.nombre) {
      const names = dto.nombre.trim().split(' ');
      dataToUpdate.name = names[0];
      const lastNamePart = names.slice(1).join(' ');
      const cedulaClean = dto.cedula?.trim();
      dataToUpdate.lastname = cedulaClean 
        ? (lastNamePart ? `${lastNamePart} (CI: ${cedulaClean})` : `(CI: ${cedulaClean})`)
        : (lastNamePart || 'Técnico');
    }
    if (dto.estado !== undefined) {
      dataToUpdate.estado = dto.estado;
    }
    if (dto.agenciaId) {
      const agencia = await this.prisma.agencia.findFirst({
        where: {
          OR: [{ id: dto.agenciaId }, { nombre: dto.agenciaId }]
        }
      });
      if (agencia) {
        dataToUpdate.agenciaId = agencia.id;
      }
    }
    if (dto.rol) {
      const rolTarget = dto.rol.trim();
      let role = await this.prisma.role.findFirst({
        where: { namerol: rolTarget }
      });
      if (!role) {
        role = await this.prisma.role.findFirst({
          where: {
            namerol: rolTarget.toUpperCase().includes('PULIDOR') ? 'PULIDOR' : 'LAVADOR'
          }
        });
      }
      if (role) {
        dataToUpdate.roleId = role.id;
      }
    }

    await this.prisma.user.update({
      where: { id: dto.id },
      data: dataToUpdate
    });

    // Si se especificó bahía para cambiar o desvincular
    if (dto.bahiaId !== undefined) {
      const currentBahia = user.bahiasAsignadas?.[0];
      const esSinBahia = !dto.bahiaId || dto.bahiaId.toLowerCase().includes('sin bahia') || dto.bahiaId.toLowerCase().includes('sin bahía');

      if (esSinBahia && currentBahia) {
        await this.asignarOperadorABahia({ bahiaId: currentBahia.id, operadorId: null }, updaterId || user.id);
      } else if (!esSinBahia) {
        const agenciaIdTarget = dataToUpdate.agenciaId || user.agenciaId;
        const bahiaTarget = await this.prisma.bahia.findFirst({
          where: {
            agenciaId: agenciaIdTarget || undefined,
            OR: [{ id: dto.bahiaId }, { nombre: dto.bahiaId }]
          }
        });
        if (bahiaTarget && (!currentBahia || currentBahia.id !== bahiaTarget.id)) {
          await this.asignarOperadorABahia({ bahiaId: bahiaTarget.id, operadorId: user.id }, updaterId || user.id);
        }
      }
    }

    const reloaded = await this.prisma.user.findUnique({
      where: { id: dto.id },
      include: {
        role: true,
        agencia: true,
        bahiasAsignadas: true,
        _count: { select: { serviciosAtendidos: true } }
      }
    });

    return this.mapUserToOperador(reloaded);
  }
}



