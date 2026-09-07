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
  CreateMarcaDto,
  UpdateMarcaDto,
  ListMarcasDto,
  ToggleEstadoMarcaDto,
} from './dto/marcas.dto.js';
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
} from './dto/bahias.dto.js';
import {
  AsignarUsuarioAgenciaDto,
  ListUsuariosAgenciaDto,
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

    return this.prisma.region.findMany({
      where,
      include: {
        _count: {
          select: {
            agencias: true,
            usuarios: true,
          },
        },
      },
      orderBy: { nombre: 'asc' },
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

    return this.prisma.region.create({
      data: {
        codigo: dto.codigo.trim().toUpperCase(),
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion?.trim(),
        estado: dto.estado ?? 1,
      },
    });
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

    return this.prisma.region.update({
      where: { id: dto.id },
      data: {
        ...(dto.codigo && { codigo: dto.codigo.trim().toUpperCase() }),
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion?.trim() }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
    });
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
  // 2. MARCAS (CRUD + TOGGLE)
  // =========================================================================

  async listMarcas(dto: ListMarcasDto) {
    const where: any = {};

    if (dto.search) {
      where.nombre = { contains: dto.search, mode: 'insensitive' };
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    return this.prisma.marca.findMany({
      where,
      include: {
        _count: {
          select: { agencias: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async createMarca(dto: CreateMarcaDto) {
    const existing = await this.prisma.marca.findUnique({
      where: { nombre: dto.nombre.trim() },
    });
    if (existing) {
      throw new ConflictException(`Ya existe una marca registrada con el nombre "${dto.nombre}"`);
    }

    return this.prisma.marca.create({
      data: {
        nombre: dto.nombre.trim(),
        estado: dto.estado ?? 1,
      },
    });
  }

  async updateMarca(dto: UpdateMarcaDto) {
    const marca = await this.prisma.marca.findUnique({ where: { id: dto.id } });
    if (!marca) {
      throw new NotFoundException(`Marca con ID "${dto.id}" no encontrada`);
    }

    if (dto.nombre && dto.nombre.trim() !== marca.nombre) {
      const existing = await this.prisma.marca.findUnique({
        where: { nombre: dto.nombre.trim() },
      });
      if (existing) {
        throw new ConflictException(`Ya existe otra marca con el nombre "${dto.nombre}"`);
      }
    }

    return this.prisma.marca.update({
      where: { id: dto.id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
    });
  }

  async toggleEstadoMarca(dto: ToggleEstadoMarcaDto) {
    const marca = await this.prisma.marca.findUnique({ where: { id: dto.id } });
    if (!marca) {
      throw new NotFoundException(`Marca con ID "${dto.id}" no encontrada`);
    }

    const nuevoEstado = dto.estado !== undefined ? dto.estado : marca.estado === 1 ? 0 : 1;

    return this.prisma.marca.update({
      where: { id: dto.id },
      data: { estado: nuevoEstado },
    });
  }

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

    if (dto.marcaId) {
      where.marcaId = dto.marcaId;
    }

    if (dto.estado !== undefined) {
      where.estado = dto.estado;
    }

    return this.prisma.agencia.findMany({
      where,
      include: {
        marca: { select: { id: true, nombre: true, estado: true } },
        regionRel: { select: { id: true, codigo: true, nombre: true, estado: true } },
        _count: {
          select: {
            bahias: true,
            usuarios: true,
          },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async detailAgencia(id: string) {
    const agencia = await this.prisma.agencia.findUnique({
      where: { id },
      include: {
        marca: true,
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

    return agencia;
  }

  async createAgencia(dto: CreateAgenciaDto) {
    const codigoExiste = await this.prisma.agencia.findUnique({
      where: { codigo: dto.codigo.trim().toUpperCase() },
    });
    if (codigoExiste) {
      throw new ConflictException(`Ya existe una agencia con el código "${dto.codigo}"`);
    }

    if (dto.marcaId) {
      const marca = await this.prisma.marca.findUnique({ where: { id: dto.marcaId } });
      if (!marca) {
        throw new NotFoundException(`Marca con ID "${dto.marcaId}" no existe`);
      }
    }

    let regionNombre = dto.region?.trim();
    if (dto.regionId) {
      const region = await this.prisma.region.findUnique({ where: { id: dto.regionId } });
      if (!region) {
        throw new NotFoundException(`Región con ID "${dto.regionId}" no encontrada`);
      }
      if (!regionNombre) regionNombre = region.nombre;
    }

    return this.prisma.agencia.create({
      data: {
        codigo: dto.codigo.trim().toUpperCase(),
        nombre: dto.nombre.trim(),
        region: regionNombre,
        regionId: dto.regionId,
        direccion: dto.direccion?.trim(),
        telefono: dto.telefono?.trim(),
        email: dto.email?.trim().toLowerCase(),
        numeroBahias: dto.numeroBahias ?? 2,
        marcaId: dto.marcaId,
        estado: dto.estado ?? 1,
      },
      include: {
        marca: true,
        regionRel: true,
      },
    });
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
      if (codigoExiste) {
        throw new ConflictException(`Ya existe otra agencia con el código "${dto.codigo}"`);
      }
    }

    if (dto.marcaId) {
      const marca = await this.prisma.marca.findUnique({ where: { id: dto.marcaId } });
      if (!marca) {
        throw new NotFoundException(`Marca con ID "${dto.marcaId}" no existe`);
      }
    }

    let regionNombre = dto.region?.trim();
    if (dto.regionId) {
      const region = await this.prisma.region.findUnique({ where: { id: dto.regionId } });
      if (!region) {
        throw new NotFoundException(`Región con ID "${dto.regionId}" no encontrada`);
      }
      if (!regionNombre) regionNombre = region.nombre;
    }

    return this.prisma.agencia.update({
      where: { id: dto.id },
      data: {
        ...(dto.codigo && { codigo: dto.codigo.trim().toUpperCase() }),
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(regionNombre && { region: regionNombre }),
        ...(dto.regionId !== undefined && { regionId: dto.regionId }),
        ...(dto.direccion !== undefined && { direccion: dto.direccion?.trim() }),
        ...(dto.telefono !== undefined && { telefono: dto.telefono?.trim() }),
        ...(dto.email !== undefined && { email: dto.email?.trim().toLowerCase() }),
        ...(dto.numeroBahias !== undefined && { numeroBahias: dto.numeroBahias }),
        ...(dto.marcaId !== undefined && { marcaId: dto.marcaId }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
      include: {
        marca: true,
        regionRel: true,
      },
    });
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
      include: { marca: true, regionRel: true },
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
        marca: true,
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
    const pulidores = agencia.usuarios.filter((u) =>
      ['PULIDOR_FIJO', 'PULIDOR_MOVIL'].includes(u.role?.namerol || ''),
    );
    const lideres = agencia.usuarios.filter((u) =>
      ['LIDER_AGENCIA', 'APROBADOR'].includes(u.role?.namerol || ''),
    );

    return {
      agencia: {
        id: agencia.id,
        codigo: agencia.codigo,
        nombre: agencia.nombre,
        region: agencia.region,
        regionOficial: agencia.regionRel ? { id: agencia.regionRel.id, nombre: agencia.regionRel.nombre } : null,
        marca: agencia.marca?.nombre ?? 'Sin Marca',
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
          select: { id: true, codigo: true, nombre: true, region: true },
        },
        operadorActual: {
          select: { id: true, name: true, lastname: true, email: true },
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
      include: { operadorActual: true },
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
    }

    const now = new Date();

    // Si había un operador previo asignado y está cambiando, cerrar el historial previo
    if (bahia.operadorActualId && bahia.operadorActualId !== operadorNuevoId) {
      await this.prisma.historialAsignacionBahia.updateMany({
        where: {
          bahiaId: bahia.id,
          operadorId: bahia.operadorActualId,
          fechaFin: null,
        },
        data: {
          fechaFin: now,
        },
      });
    }

    // Si se asigna un nuevo operador, abrir nuevo registro de historial
    if (operadorNuevoId && bahia.operadorActualId !== operadorNuevoId) {
      await this.prisma.historialAsignacionBahia.create({
        data: {
          bahiaId: bahia.id,
          operadorId: operadorNuevoId,
          fechaInicio: now,
          asignadoPorId,
          motivo: dto.notas || (dto as any).motivo || null,
        },
      });
    }

    // Actualizar bahía
    return this.prisma.bahia.update({
      where: { id: bahia.id },
      data: {
        operadorActualId: operadorNuevoId,
      },
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

  async listUsuariosPorAgencia(dto: ListUsuariosAgenciaDto) {
    const where: any = {};

    if (dto.agenciaId) {
      where.OR = [
        { agenciaId: dto.agenciaId },
        { agenciasIds: { has: dto.agenciaId } },
      ];
    }

    if (dto.rolNombre) {
      where.role = { namerol: dto.rolNombre };
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
      },
      orderBy: { name: 'asc' },
    });
  }
}
