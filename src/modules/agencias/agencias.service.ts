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

    const list = await this.prisma.agencia.findMany({
      where,
      include: {
        marca: { select: { id: true, nombre: true, estado: true } },
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
        return r === 'LIDER_OPERADOR' || r.includes('LIDER_OPERADOR') || r.includes('LIDER') || r.includes('LÍDER');
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

    const ger = agencia.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'GERENTE' || r === 'APROBADOR' || r.includes('GERENTE') || r.includes('APROBADOR') || r === 'LIDER_AGENCIA';
    });
    const lider = agencia.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER_OPERADOR' || r.includes('LIDER_OPERADOR') || r.includes('LIDER') || r.includes('LÍDER');
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

    let marcaIdFinal: string | null = null;
    if (dto.marcaId && dto.marcaId !== '0' && dto.marcaId !== 'undefined') {
      const marca = await this.prisma.marca.findFirst({
        where: { OR: [{ id: dto.marcaId }, { nombre: { equals: dto.marcaId, mode: 'insensitive' } }] },
      });
      if (marca) {
        marcaIdFinal = marca.id;
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
        marcaId: marcaIdFinal,
        estado: dto.estado ?? 1,
      },
      include: {
        marca: true,
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
        marca: true,
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

    return {
      ...finalCreated,
      responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
      gerenteId: ger?.id || null,
      gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
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

    let marcaIdFinal: string | null | undefined = undefined;
    if (dto.marcaId !== undefined) {
      if (dto.marcaId && dto.marcaId !== '0' && dto.marcaId !== 'undefined') {
        const marca = await this.prisma.marca.findFirst({
          where: { OR: [{ id: dto.marcaId }, { nombre: { equals: dto.marcaId, mode: 'insensitive' } }] },
        });
        marcaIdFinal = marca ? marca.id : null;
      } else {
        marcaIdFinal = null;
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
        ...(marcaIdFinal !== undefined && { marcaId: marcaIdFinal }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
      include: {
        marca: true,
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
          where: { agenciaId: updated.id, role: { namerol: { in: ['GERENTE', 'APROBADOR', 'LIDER_AGENCIA', 'LIDER_OPERADOR'] } } },
          data: { agenciaId: null },
        });
        await this.prisma.user.update({
          where: { id: dto.gerenteId },
          data: { agenciaId: updated.id },
        }).catch((e) => console.warn('No se pudo asignar gerente en updateAgencia', e));
      } else {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['GERENTE', 'APROBADOR', 'LIDER_AGENCIA', 'LIDER_OPERADOR'] } } },
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
        marca: true,
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

    return {
      ...finalAgencia,
      responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
      gerenteId: ger?.id || null,
      gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
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
      ['LIDER_AGENCIA', 'LIDER_OPERADOR', 'APROBADOR'].includes(u.role?.namerol || ''),
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
    }

    const now = new Date();

    // 1. Si el operador ya estaba en OTRA bahía previamente, liberarla y cerrar su historial en ella
    let bahiaAnterior: any = null;
    if (operadorNuevoId) {
      bahiaAnterior = await this.prisma.bahia.findFirst({
        where: {
          operadorActualId: operadorNuevoId,
          id: { not: bahia.id },
        },
        include: { agencia: true },
      });

      if (bahiaAnterior) {
        // Cerrar historial activo en la bahía de origen
        await this.prisma.historialAsignacionBahia.updateMany({
          where: {
            bahiaId: bahiaAnterior.id,
            operadorId: operadorNuevoId,
            fechaFin: null,
          },
          data: {
            fechaFin: now,
          },
        });

        // Liberar la bahía de origen en base de datos
        await this.prisma.bahia.update({
          where: { id: bahiaAnterior.id },
          data: { operadorActualId: null },
        });
      }
    }

    // 2. Si la bahía destino tenía OTRO operador asignado previamente, cerrar su historial
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

    // 3. Si se desvincula el operador actual de esta bahía (operadorId = null)
    if (!operadorNuevoId && bahia.operadorActualId) {
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

    // 4. Si se asigna un nuevo operador o se cambia de bahía, abrir nuevo registro de historial con trazabilidad
    if (operadorNuevoId && bahia.operadorActualId !== operadorNuevoId) {
      const motivoFinal = dto.notas || (dto as any).motivo || (
        bahiaAnterior
          ? `Reasignación de ${bahiaAnterior.nombre} (${bahiaAnterior.agencia?.nombre || 'Agencia'}) a ${bahia.nombre} (${bahia.agencia?.nombre || 'Agencia'})`
          : `Asignación a ${bahia.nombre} (${bahia.agencia?.nombre || 'Agencia'})`
      );

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

    // 5. Actualizar la bahía destino con el nuevo operador
    const bahiaActualizada = await this.prisma.bahia.update({
      where: { id: bahia.id },
      data: {
        operadorActualId: operadorNuevoId,
      },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });

    // 6. Actualizar fecha de modificación del operador en la tabla User y asegurar pertenencia a la agencia
    if (operadorNuevoId) {
      await this.prisma.user.update({
        where: { id: operadorNuevoId },
        data: { 
          updatedAt: now,
          agenciaId: bahia.agenciaId,
        },
      });
    }

    return bahiaActualizada;
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
    const user = await this.prisma.user.findUnique({ where: { id: dto.id } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${dto.id}" no encontrado`);
    }

    let roleIdToSet = dto.roleId;
    if (!roleIdToSet && dto.rolNombre) {
      const roleFound = await this.prisma.role.findFirst({
        where: {
          OR: [
            { namerol: dto.rolNombre },
            { namerol: dto.rolNombre.toUpperCase() },
          ],
        },
      });
      if (roleFound) roleIdToSet = roleFound.id;
    }

    let passwordHashToSet: string | undefined;
    if (dto.password && dto.password.trim().length >= 6) {
      passwordHashToSet = await bcrypt.hash(dto.password.trim(), 10);
    }

    let agenciaIdToSet: string | null | undefined = undefined;
    let regionIdToSet: string | null | undefined = undefined;

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
        ...(passwordHashToSet !== undefined && { passwordHash: passwordHashToSet }),
      },
      include: {
        role: true,
        agencia: true,
        region: true,
      },
    });

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
      },
    };
  }

  async createUsuario(dto: CreateUsuarioDto) {
    const emailNorm = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email: emailNorm } });
    if (existing) {
      throw new ConflictException(`Ya existe un usuario con el correo electrónico "${emailNorm}"`);
    }

    let roleIdToSet = dto.roleId;
    if (!roleIdToSet && dto.rolNombre) {
      const norm = dto.rolNombre.toUpperCase().trim();
      let code = norm;
      if (norm.includes('SUPER') && norm.includes('ADMIN')) code = 'SUPER_ADMIN';
      else if (norm.includes('ADMIN')) code = 'ADMIN';
      else if (norm.includes('SUPERVISOR')) code = 'SUPERVISOR';
      else if (norm.includes('JEFE') && norm.includes('COMERCIAL')) code = 'JEFE_COMERCIAL';
      else if (norm.includes('COORD') && norm.includes('COMERCIAL')) code = 'COORD_COMERCIAL';
      else if (norm.includes('APROBADOR') || norm.includes('GERENTE')) code = 'APROBADOR';
      else if (norm.includes('LIDER') || norm.includes('LÍDER')) code = 'LIDER_OPERADOR';
      else if (norm.includes('ESPECIALES')) code = 'COORD_SERVICIOS_ESPECIALES';
      else if (norm.includes('PULIDOR') && norm.includes('FIJO')) code = 'PULIDOR_FIJO';
      else if (norm.includes('PULIDOR')) code = 'PULIDOR_MOVIL';
      else if (norm.includes('MANTENIMIENTO')) code = 'COORD_MANTENIMIENTO';
      else if (norm.includes('TECNICO') || norm.includes('TÉCNICO')) code = 'TECNICO';
      else if (norm.includes('ASISTENTE')) code = 'ASISTENTE_BODEGA';
      else if (norm.includes('BODEGA')) code = 'COORD_BODEGA';

      const roleFound = await this.prisma.role.findFirst({
        where: {
          OR: [
            { namerol: dto.rolNombre },
            { namerol: dto.rolNombre.toUpperCase() },
            { namerol: code },
          ],
        },
      });
      if (roleFound) roleIdToSet = roleFound.id;
    }

    if (!roleIdToSet) {
      const fallbackRole = await this.prisma.role.findFirst();
      if (fallbackRole) roleIdToSet = fallbackRole.id;
    }

    if (!roleIdToSet) {
      throw new BadRequestException('No se encontró un rol válido para asignar al usuario');
    }

    // Agencia y región son 100% opcionales en la creación
    let agenciaIdToSet: string | null = null;
    let regionIdToSet: string | null = null;
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

    const passwordToHash = dto.password?.trim() || 'Admin123*';
    const passwordHash = await bcrypt.hash(passwordToHash, 10);

    const newUser = await this.prisma.user.create({
      data: {
        name: dto.name,
        lastname: dto.lastname || '',
        email: emailNorm,
        passwordHash,
        roleId: roleIdToSet,
        agenciaId: agenciaIdToSet,
        regionId: regionIdToSet,
        estado: dto.estado !== undefined ? dto.estado : 1,
      },
      include: {
        role: true,
        agencia: true,
        region: true,
      },
    });

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

  async listUsuariosPorAgencia(dto: ListUsuariosAgenciaDto, userRole?: string) {
    const where: any = {};

    if (userRole && userRole !== 'SUPER_ADMIN') {
      where.role = { namerol: { not: 'SUPER_ADMIN' } };
    }

    if (dto.agenciaId) {
      where.OR = [
        { agenciaId: dto.agenciaId },
        { agenciasIds: { has: dto.agenciaId } },
      ];
    }

    if (dto.rolNombre) {
      where.role = { ...(where.role || {}), namerol: dto.rolNombre };
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
      rol: u.role?.namerol || 'OPERADOR',
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
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80'
    };
  }

  async listOperadores(dto: ListOperadoresDto) {
    const where: any = {
      role: {
        namerol: { in: ['OPERADOR', 'PULIDOR_FIJO', 'PULIDOR_MOVIL', 'TECNICO'] }
      }
    };

    if (dto.agenciaId && dto.agenciaId !== 'Todas') {
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

    let role = await this.prisma.role.findFirst({
      where: {
        OR: [
          { namerol: 'OPERADOR' },
          { namerol: dto.rol || 'OPERADOR' }
        ]
      }
    });
    if (!role) {
      role = await this.prisma.role.create({
        data: {
          namerol: 'OPERADOR',
          descripcion: 'Personal técnico y operativo de lavado y acabado en bahía',
          estado: 1,
          permisos: ['servicios', 'bahias', 'sync']
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
      throw new ConflictException(`Ya existe un operador registrado con esta identificación/cédula (${cedulaClean})`);
    }

    const passwordHash = await bcrypt.hash('Operador123*', 10);
    const names = dto.nombre.trim().split(' ');
    const firstName = names[0] || 'Operador';
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



