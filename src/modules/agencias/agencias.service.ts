import {
  Injectable,
  Optional,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateAgenciaDto,
  UpdateAgenciaDto,
  ListAgenciasDto,
  ToggleEstadoAgenciaDto,
} from './dto/agencias.dto.js';
import { ListPreciosAgenciaDto, SetPreciosAgenciaDto } from './dto/precios-agencia.dto.js';
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
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { listarOpciones } from '../../common/utils/opciones.js';
import {
  AgenciasOpcionesDto,
  BahiasOpcionesDto,
  ClientesOpcionesDto,
  OperadoresOpcionesDto,
  RegionesOpcionesDto,
  UsuariosOpcionesDto,
} from './dto/opciones.dto.js';
import {
  columnasSimples,
  combinarWhere,
  resolverOrden,
  resolverPaginacion,
  whereBusqueda,
} from '../../common/utils/data-grid.helpers.js';
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

import { Alcance, SIN_RESULTADOS, puedeSobreAgencia, resolverAlcance, whereAgencias, whereSobreAgencia } from '../../common/permisos/alcance.js';
import { esLiderDeAgencia, normalizarRol, rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { generarPasswordTemporal } from '../../common/utils/password-temporal.js';
import { exigirPasswordSegura } from '../../common/utils/password-politica.js';
@Injectable()
export class AgenciasService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Avisa al propio usuario afectado (rol, estado o agencia/región cambiados) y a admin/super admin. Nunca bloquea el flujo. */
  private async notificarCambioUsuario(usuarioId: string, titulo: string, mensaje: string): Promise<void> {
    if (!this.notifications) return;
    const admins = await this.notifications.resolverDestinatariosPorRol({ global: ['ADMIN', 'SUPER_ADMIN'] });
    const ids = [...new Set([usuarioId, ...admins])];
    void this.notifications.notificarUsuarios(
      ids,
      titulo,
      mensaje,
      { type: 'USUARIO_ACTUALIZADO', usuarioId },
      { tipo: 'USUARIO_ACTUALIZADO', entidadTipo: 'USUARIO', entidadId: usuarioId },
    );
  }

  // =========================================================================
  // ALCANCE (regla única: país, región, agencia o lo propio) y datos de contacto
  // =========================================================================

  private esAdmin(user: any): boolean {
    return ['SUPER_ADMIN', 'ADMIN'].includes(rolDeUsuario(user));
  }

  /** Correo y teléfono de otros usuarios: el administrador, o quien tenga la casilla «Ver correo y teléfono». */
  private veContacto(user: any): boolean {
    return this.esAdmin(user) || tienePermiso(user, 'datos.contacto.ver');
  }

  /** Cédula del personal: el administrador, o quien tenga la casilla «Ver cédula». */
  private veCedula(user: any): boolean {
    return this.esAdmin(user) || tienePermiso(user, 'datos.cedula.ver');
  }

  /** El usuario debe poder actuar sobre esa agencia (según su ámbito). */
  private asegurarAgencia(user: any, agencia: { id?: string | null; regionId?: string | null }): void {
    if (!puedeSobreAgencia(resolverAlcance(user), agencia)) {
      throw new ForbiddenException('Esta agencia no pertenece a tu alcance.');
    }
  }

  /** Carga la bahía con su agencia y valida que esté dentro del alcance del usuario. */
  private async bahiaEnAlcance(user: any, bahiaId: string) {
    // Llamadas internas (sin usuario) no se validan; la API siempre pasa el usuario.
    if (!user) return null;
    const bahia = await this.prisma.bahia.findUnique({ where: { id: bahiaId }, select: { id: true, agenciaId: true, agencia: { select: { id: true, regionId: true } } } });
    if (!bahia) throw new NotFoundException(`Bahía con ID "${bahiaId}" no encontrada`);
    this.asegurarAgencia(user, { id: bahia.agencia?.id ?? bahia.agenciaId, regionId: bahia.agencia?.regionId });
    return bahia;
  }

  /** Filtro sobre usuarios: los del país, de su región o de su agencia. Sin dato de su ámbito, ninguno. */
  private whereUsuariosPorAlcance(user: any): Record<string, unknown> {
    const a: Alcance = resolverAlcance(user);
    switch (a.tipo) {
      case 'GLOBAL':
        return {};
      case 'REGION':
        return { OR: [{ regionId: a.regionId }, { agencia: { regionId: a.regionId } }] };
      case 'AGENCIA':
        return { agenciaId: a.agenciaId };
      case 'PROPIO':
        return { id: a.userId };
      default:
        return SIN_RESULTADOS;
    }
  }

  /** Quien no tiene la casilla correspondiente no recibe el correo, el teléfono ni la cédula de otros usuarios: solo nombre, rol y estado. */
  private ocultarContacto<T>(resultado: T, user: any): T {
    const conContacto = this.veContacto(user);
    const conCedula = this.veCedula(user);
    if (conContacto && conCedula) return resultado;
    const limpiar = (fila: any) => {
      if (!fila || typeof fila !== 'object') return fila;
      const { email, telefono, phone, cedula, ...resto } = fila;
      return {
        ...resto,
        ...(conContacto ? { ...(email !== undefined ? { email } : {}), ...(telefono !== undefined ? { telefono } : {}), ...(phone !== undefined ? { phone } : {}) } : {}),
        ...(conCedula && cedula !== undefined ? { cedula } : {}),
      };
    };
    if (Array.isArray(resultado)) return resultado.map(limpiar) as unknown as T;
    const r: any = resultado;
    if (r && Array.isArray(r.items)) {
      const items = r.items.map(limpiar);
      return { ...r, items, ...(Array.isArray(r.data) ? { data: items } : {}) } as T;
    }
    return resultado;
  }

  /** Igual que ocultarContacto, pero para una bahía suelta: limpia operadorActual y operadores[].operador. */
  /**
   * Estado físico en tiempo real de una o varias bahías: solo informativo, nunca bloquea el
   * registro de un servicio (decisión de producto). `null` = disponible.
   */
  private async ocupacionDeBahias(bahiaIds: string[]): Promise<Map<string, { placa: string; ordenTrabajoOT: string | null }>> {
    const mapa = new Map<string, { placa: string; ordenTrabajoOT: string | null }>();
    const ids = Array.from(new Set(bahiaIds.filter(Boolean)));
    if (ids.length === 0) return mapa;
    const activos = await this.prisma.servicioLavado.findMany({
      where: { bahiaId: { in: ids }, estado: 'EN_PROCESO' as any, deletedAt: null },
      select: { bahiaId: true, placa: true, ordenTrabajoOT: true },
    });
    for (const s of activos) mapa.set(s.bahiaId, { placa: s.placa, ordenTrabajoOT: s.ordenTrabajoOT });
    return mapa;
  }

  /**
   * Resuelve el id de rol a partir de un nombre libre (usado por el importador de Excel y por
   * formularios que aún envían texto en vez del roleId exacto). Coincidencia difusa por
   * substring hacia los 14 roles oficiales; nunca resuelve a SUPER_ADMIN.
   * Compartido por `createUsuario` y `updateUsuario` (antes duplicado en ambos).
   */
  private async resolverRoleIdPorNombreLibre(rolNombre: string): Promise<string | undefined> {
    const norm = rolNombre.toUpperCase().trim();
    if (norm === 'SUPER_ADMIN' || (norm.includes('SUPER') && norm.includes('ADMIN'))) {
      throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
    }
    let code = norm;
    if (norm.includes('ADMIN')) code = 'ADMIN';
    else if (norm.includes('SUPERVISOR')) code = 'SUPERVISOR';
    else if (norm.includes('JEFE') && norm.includes('COMERCIAL')) code = 'JEFE_COMERCIAL';
    else if (norm.includes('COORD') && norm.includes('COMERCIAL')) code = 'COORD_COMERCIAL';
    else if (norm.includes('APROBADOR')) code = 'APROBADOR';
    else if (norm.includes('LIDER') || norm.includes('LÍDER')) code = 'LIDER';
    else if (norm.includes('ESPECIALES')) code = 'COORD_SERVICIOS_ESPECIALES';
    else if (norm.includes('PULIDOR')) code = 'PULIDOR';
    else if (norm.includes('MANTENIMIENTO')) code = 'COORD_MANTENIMIENTO';
    else if (norm.includes('TECNICO') || norm.includes('TÉCNICO')) code = 'TECNICO';
    else if (norm.includes('ASISTENTE')) code = 'ASISTENTE_BODEGA';
    else if (norm.includes('BODEGA') || norm.includes('INVENTARIO') || norm.includes('GESTOR')) code = 'COORD_BODEGA';
    else if (norm.includes('LAVADOR')) code = 'LAVADOR';

    const roleFound = await this.prisma.role.findFirst({
      where: {
        OR: [{ namerol: rolNombre }, { namerol: norm }, { namerol: code }],
      },
    });
    if (roleFound?.namerol === 'SUPER_ADMIN') {
      throw new ForbiddenException('No se puede asignar el rol SUPER_ADMIN desde la aplicación.');
    }
    return roleFound?.id;
  }

  /**
   * Cada agencia solo puede tener un pulidor fijo (decisión de producto). Se llama antes de crear o
   * editar un usuario PULIDOR con agencia asignada; rechaza si esa agencia ya tiene OTRO pulidor
   * fijo activo. `excluirUsuarioId` es el propio usuario cuando se está editando (para permitir
   * guardar sin cambios, o pasar de móvil a fijo de la misma agencia que ya tenía asignada).
   */
  private async assertAgenciaSinOtroFijo(agenciaId: string, excluirUsuarioId?: string): Promise<void> {
    const otroFijo = await this.prisma.user.findFirst({
      where: {
        agenciaId,
        estado: 1,
        role: { namerol: 'PULIDOR' },
        ...(excluirUsuarioId ? { id: { not: excluirUsuarioId } } : {}),
      },
      select: { id: true, name: true, lastname: true },
    });
    if (otroFijo) {
      const agencia = await this.prisma.agencia.findUnique({ where: { id: agenciaId }, select: { nombre: true } });
      throw new ConflictException(
        `La agencia "${agencia?.nombre || agenciaId}" ya tiene un pulidor fijo asignado (${otroFijo.name} ${otroFijo.lastname}). `
        + `Cada agencia solo puede tener uno: cambia primero a ese pulidor a otra agencia o a modalidad móvil.`,
      );
    }
  }

  private limpiarContactoBahia<T extends { operadorActual?: any; operadores?: any[] } | null>(bahia: T, user: any): T {
    if (!bahia || this.veContacto(user)) return bahia;
    const sinEmail = (u: any) => (u ? (({ email: _c, ...resto }: any) => resto)(u) : u);
    return {
      ...bahia,
      operadorActual: sinEmail(bahia.operadorActual),
      operadores: bahia.operadores?.map((bo: any) => ({ ...bo, operador: sinEmail(bo.operador) })),
    };
  }

  // =========================================================================
  // 1. REGIONES (CRUD + TOGGLE)
  // =========================================================================

  async listRegiones(dto: ListRegionesDto, user?: any) {
    const where = combinarWhere(
      dto.estado !== undefined ? { estado: dto.estado } : undefined,
      whereBusqueda(['nombre', 'codigo', 'descripcion'], dto.search),
    );
    return listarPaginable(dto, {
      where,
      columnas: {
        ...columnasSimples({ codigo: 'codigo', nombre: 'nombre', estado: 'estado', fecha: 'createdAt' }),
        agencias: (dir) => ({ agencias: { _count: dir } }),
        usuarios: (dir) => ({ usuarios: { _count: dir } }),
      },
      ordenHeredado: [{ nombre: 'asc' }],
      contar: (w) => this.prisma.region.count({ where: w }),
      mapear: (regiones: any[]) =>
        regiones.map((r) => {
          const supervisor = r.usuarios?.find((u: any) => u.role?.namerol === 'SUPERVISOR') || r.usuarios?.[0];
          // Quien no es admin nunca recibe el correo de otro usuario (D9).
          const usuarios = this.veContacto(user) ? r.usuarios : r.usuarios?.map(({ email: _correo, ...resto }: any) => resto);
          return {
            ...r,
            usuarios,
            responsable: supervisor ? `${supervisor.name} ${supervisor.lastname}`.trim() : '',
            supervisorId: supervisor?.id || null,
          };
        }),
      buscar: ({ where: w, orderBy, skip, take }) => this.prisma.region.findMany({
      where: w,
      orderBy,
      skip,
      take,
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
    }),
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
    const where = combinarWhere(
      dto.estado !== undefined ? { estado: dto.estado } : undefined,
      whereBusqueda(['nombre'], dto.search),
    );
    return listarPaginable(dto, {
      where,
      columnas: {
        ...columnasSimples({ nombre: 'nombre', estado: 'estado', fecha: 'createdAt' }),
        agencias: (dir) => ({ agencias: { _count: dir } }),
      },
      ordenHeredado: [{ nombre: 'asc' }],
      contar: (w) => this.prisma.cliente.count({ where: w }),
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.cliente.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: { _count: { select: { agencias: true } } },
        }),
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

  /** Qué agencias puede ver quien consulta: todas (rol global), las de su región (regional) o solo la suya. */
  private alcanceAgencias(user: any): any {
    return { ...whereAgencias(resolverAlcance(user)) };
  }

  async listAgencias(dto: ListAgenciasDto, user: any) {
    const where: any = this.alcanceAgencias(user);

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

    const regionNombre = dto.regionNombre?.trim();
    const clienteNombre = dto.clienteNombre?.trim();
    const filtros = combinarWhere(
      where,
      regionNombre ? { OR: [{ regionRel: { nombre: { equals: regionNombre, mode: 'insensitive' } } }, { region: { equals: regionNombre, mode: 'insensitive' } }] } : undefined,
      clienteNombre ? { cliente: { nombre: { equals: clienteNombre, mode: 'insensitive' } } } : undefined,
      whereBusqueda(['nombre', 'codigo', 'direccion', 'region', 'cliente.nombre'], dto.search),
    );
    return listarPaginable(dto, {
      where: filtros,
      columnas: {
        ...columnasSimples({ nombre: 'nombre', codigo: 'codigo', region: 'region', estado: 'estado', cliente: 'cliente.nombre', fecha: 'createdAt' }),
        bahias: (dir) => ({ bahias: { _count: dir } }),
        usuarios: (dir) => ({ usuarios: { _count: dir } }),
      },
      ordenHeredado: [{ nombre: 'asc' }],
      contar: (w) => this.prisma.agencia.count({ where: w }),
      mapear: (list: any[]) => this.enriquecerAgencias(list, dto.incluirProductividad !== false),
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.agencia.findMany({
          where: w,
          orderBy,
          skip,
          take,
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
        }),
    });
  }

  /** Productividad del mes, gerente y líder de cada agencia recibida (solo las de la página: una consulta de servicios por página). */
  private async enriquecerAgencias(list: any[], conProductividad = true) {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    const serviciosMes = conProductividad && list.length
      ? await this.prisma.servicioLavado.findMany({
          where: {
            deletedAt: null,
            horaIngreso: { gte: inicioMes },
            estado: { not: 'CANCELADO' },
            bahia: { agenciaId: { in: list.map((agencia: any) => agencia.id) } },
          },
          select: {
            estado: true,
            bahia: { select: { agenciaId: true } },
          },
        })
      : [];

    const productividadPorAgencia = new Map<string, { total: number; completados: number }>();
    serviciosMes.forEach((servicio: any) => {
      const agenciaId = servicio.bahia.agenciaId;
      const actual = productividadPorAgencia.get(agenciaId) || { total: 0, completados: 0 };
      actual.total += 1;
      if (servicio.estado === 'FINALIZADO' || servicio.estado === 'APROBADO') actual.completados += 1;
      productividadPorAgencia.set(agenciaId, actual);
    });

    return list.map((a: any) => {
      const ger = a.usuarios?.find((u: any) => {
        const r = (u.role?.namerol || '').toUpperCase();
        return r === 'APROBADOR' || r.includes('APROBADOR');
      });
      const lider = a.usuarios?.find((u: any) => {
        const r = (u.role?.namerol || '').toUpperCase();
        return r === 'LIDER' || r.includes('LIDER') || r.includes('LÍDER');
      });
      const metrica = productividadPorAgencia.get(a.id);
      return {
        ...a,
        productividad: metrica?.total
          ? Number(((metrica.completados / metrica.total) * 100).toFixed(1))
          : 0,
        responsable: ger ? `${ger.name} ${ger.lastname}`.trim() : 'Sin Asignar',
        gerenteId: ger?.id || null,
        gerenteNombre: ger ? `${ger.name} ${ger.lastname}`.trim() : null,
        liderOperador: lider ? `${lider.name} ${lider.lastname}`.trim() : 'Sin Asignar',
        liderOperadorId: lider?.id || null,
        liderOperadorNombre: lider ? `${lider.name} ${lider.lastname}`.trim() : null,
      };
    });
  }

  // =========================================================================
  // OPCIONES para desplegables con buscador y scroll infinito (livianas: { value, label, sublabel })
  // =========================================================================

  async listAgenciasOpciones(dto: AgenciasOpcionesDto, user: any) {
    return listarOpciones(dto, {
      where: combinarWhere(
        this.alcanceAgencias(user),
        dto.regionId ? { regionId: dto.regionId } : undefined,
        dto.clienteId ? { clienteId: dto.clienteId } : undefined,
        dto.estado !== undefined ? { estado: dto.estado } : undefined,
      ),
      camposBusqueda: ['nombre', 'codigo', 'region'],
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.agencia.findMany({ where, orderBy, skip, take, select: { id: true, nombre: true, codigo: true, region: true } }),
      contar: (where) => this.prisma.agencia.count({ where }),
      mapear: (a) => ({ value: a.id, label: a.nombre, sublabel: [a.codigo, a.region].filter(Boolean).join(' · ') || undefined }),
    });
  }

  async listRegionesOpciones(dto: RegionesOpcionesDto) {
    return listarOpciones(dto, {
      where: combinarWhere(dto.estado !== undefined ? { estado: dto.estado } : undefined),
      camposBusqueda: ['nombre', 'codigo'],
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.region.findMany({ where, orderBy, skip, take, select: { id: true, nombre: true, codigo: true, estado: true } }),
      contar: (where) => this.prisma.region.count({ where }),
      mapear: (r) => ({ value: r.id, label: r.nombre, sublabel: r.codigo || undefined, estado: r.estado }),
    });
  }

  async listClientesOpciones(dto: ClientesOpcionesDto) {
    return listarOpciones(dto, {
      where: combinarWhere(dto.estado !== undefined ? { estado: dto.estado } : undefined),
      camposBusqueda: ['nombre'],
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.cliente.findMany({ where, orderBy, skip, take, select: { id: true, nombre: true, estado: true } }),
      contar: (where) => this.prisma.cliente.count({ where }),
      mapear: (c) => ({ value: c.id, label: c.nombre, estado: c.estado }),
    });
  }

  async listBahiasOpciones(dto: BahiasOpcionesDto, user?: any) {
    return listarOpciones(dto, {
      where: combinarWhere(whereSobreAgencia(resolverAlcance(user)), dto.agenciaId ? { agenciaId: dto.agenciaId } : undefined, dto.activa !== undefined ? { activa: dto.activa } : undefined),
      camposBusqueda: ['codigo', 'nombre', 'agencia.nombre'],
      orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.bahia.findMany({ where, orderBy, skip, take, select: { id: true, codigo: true, nombre: true, agencia: { select: { nombre: true } } } }),
      contar: (where) => this.prisma.bahia.count({ where }),
      mapear: (b) => ({ value: b.id, label: b.nombre || b.codigo, sublabel: [b.codigo, b.agencia?.nombre].filter(Boolean).join(' · ') || undefined }),
    });
  }

  async listOperadoresOpciones(dto: OperadoresOpcionesDto, currentUser?: any) {
    return listarOpciones(dto, {
      where: this.whereOperadores(dto, currentUser),
      camposBusqueda: ['name', 'lastname', 'email', 'agencia.nombre'],
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.user.findMany({
          where,
          orderBy,
          skip,
          take,
          select: { id: true, name: true, lastname: true, agencia: { select: { nombre: true } } },
        }),
      contar: (where) => this.prisma.user.count({ where }),
      // El apellido de un operador puede llevar "(CI: …)": no se muestra en la etiqueta.
      mapear: (u) => ({
        value: u.id,
        label: `${u.name || ''} ${(u.lastname || '').replace(/\(CI:[^)]+\)/, '').replace(/CI:[^)]+/, '').trim()}`.trim() || u.id,
        sublabel: u.agencia?.nombre || undefined,
      }),
    });
  }

  async listUsuariosOpciones(dto: UsuariosOpcionesDto, user?: any) {
    const roles = (dto.rolNombre || '').split(',').map((r) => r.trim()).filter(Boolean);
    return listarOpciones(dto, {
      where: combinarWhere(
        { role: { namerol: { not: 'SUPER_ADMIN' } } }, // SUPER_ADMIN nunca se lista en directorios
        this.whereUsuariosPorAlcance(user),
        dto.agenciaId ? { agenciaId: dto.agenciaId } : undefined,
        roles.length ? { role: { namerol: { in: roles } } } : undefined,
        dto.regionId ? { OR: [{ regionId: dto.regionId }, { agencia: { regionId: dto.regionId } }] } : undefined,
        dto.estado !== undefined ? { estado: dto.estado } : undefined,
      ),
      camposBusqueda: ['name', 'lastname', 'email', 'role.namerol'],
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.user.findMany({
          where,
          orderBy,
          skip,
          take,
          select: { id: true, name: true, lastname: true, email: true, role: { select: { namerol: true } } },
        }),
      contar: (where) => this.prisma.user.count({ where }),
      mapear: (u) => ({
        value: u.id,
        label: `${u.name || ''} ${u.lastname || ''}`.trim() || (this.veContacto(user) ? u.email : u.id),
        sublabel: [u.role?.namerol, this.veContacto(user) ? u.email : undefined].filter(Boolean).join(' · ') || undefined,
      }),
    });
  }

  async detailAgencia(id: string, user: any) {
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
    this.asegurarAgencia(user, { id: agencia.id, regionId: agencia.regionId });

    const ger = agencia.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'APROBADOR' || r.includes('APROBADOR');
    });
    const lider = agencia.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER' || r.includes('LIDER') || r.includes('LÍDER');
    });

    return {
      ...agencia,
      usuarios: this.veContacto(user) ? agencia.usuarios : agencia.usuarios.map(({ email: _correo, ...resto }) => resto),
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
      return r === 'APROBADOR' || r.includes('APROBADOR');
    });
    const lider = finalCreated?.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER' || r.includes('LIDER') || r.includes('LÍDER');
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

  async updateAgencia(dto: UpdateAgenciaDto, user?: any) {
    if (user) {
      const actual = await this.prisma.agencia.findUnique({ where: { id: dto.id }, select: { id: true, regionId: true } });
      if (!actual) throw new NotFoundException(`Agencia con ID "${dto.id}" no encontrada`);
      this.asegurarAgencia(user, actual);
      const d: any = dto;
      if ((d.regionId !== undefined || d.clienteId !== undefined || d.marcaId !== undefined || d.region !== undefined) && !tienePermiso(user, 'agencias.crear')) {
        throw new ForbiddenException('Cambiar la región o el cliente de una agencia es solo para administradores.');
      }
      if ((d.numeroBahias !== undefined || d.maxLavadoresPorBahia !== undefined) && !tienePermiso(user, 'bahias.crear')) {
        throw new ForbiddenException('Cambiar la cantidad de bahías de una agencia es solo para administradores.');
      }
      if ((d.gerenteId !== undefined || d.liderOperadorId !== undefined) && !tienePermiso(user, 'usuarios.gestionar')) {
        throw new ForbiddenException('Asignar el aprobador o el líder de una agencia es solo para administradores.');
      }
      if (d.estado !== undefined && !tienePermiso(user, 'agencias.estado')) {
        throw new ForbiddenException('Activar o desactivar una agencia es solo para administradores.');
      }
    }
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
          where: { agenciaId: updated.id, role: { namerol: { in: ['APROBADOR'] } } },
          data: { agenciaId: null },
        });
        await this.prisma.user.update({
          where: { id: dto.gerenteId },
          data: { agenciaId: updated.id },
        }).catch((e) => console.warn('No se pudo asignar gerente en updateAgencia', e));
      } else {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['APROBADOR'] } } },
          data: { agenciaId: null },
        });
      }
    }

    if (dto.liderOperadorId !== undefined) {
      if (dto.liderOperadorId && dto.liderOperadorId !== '0' && dto.liderOperadorId !== 'null' && dto.liderOperadorId !== 'undefined') {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['LIDER'] } } },
          data: { agenciaId: null },
        });
        await this.prisma.user.update({
          where: { id: dto.liderOperadorId },
          data: { agenciaId: updated.id },
        }).catch((e) => console.warn('No se pudo asignar líder operador en updateAgencia', e));
      } else {
        await this.prisma.user.updateMany({
          where: { agenciaId: updated.id, role: { namerol: { in: ['LIDER'] } } },
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
      return r === 'APROBADOR' || r.includes('APROBADOR');
    });
    const lider = finalAgencia?.usuarios?.find((u) => {
      const r = (u.role?.namerol || '').toUpperCase();
      return r === 'LIDER' || r.includes('LIDER') || r.includes('LÍDER');
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

  // =========================================================================
  // PRECIOS POR AGENCIA (override de CatalogoServicio.precio, solo servicios GENERAL)
  // =========================================================================

  /**
   * Precio de cada servicio GENERAL activo de la agencia: el override propio si existe, o si no el
   * precio global del catálogo. Lo puede consultar cualquiera con `agencias.ver` dentro de su alcance;
   * solo ADMIN/SUPER_ADMIN (permiso `agencias.precios.gestionar`) pueden fijarlo (ver `setPreciosServicios`).
   */
  async listPreciosServicios(dto: ListPreciosAgenciaDto, user?: any) {
    const agencia = await this.prisma.agencia.findUnique({
      where: { id: dto.agenciaId },
      select: { id: true, nombre: true, regionId: true, servicioIds: true },
    });
    if (!agencia) throw new NotFoundException(`Agencia con ID "${dto.agenciaId}" no encontrada`);
    if (user) this.asegurarAgencia(user, agencia);

    const rawIds = Array.isArray(agencia.servicioIds) ? agencia.servicioIds : [];
    const ids = rawIds.map((id: any) => Number(id)).filter((n: number) => !Number.isNaN(n) && n > 0);

    const [servicios, overrides] = await Promise.all([
      this.prisma.catalogoServicio.findMany({
        where: { id: { in: ids }, categoria: 'GENERAL' },
        select: { id: true, codigo: true, nombre: true, precio: true, estado: true },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.precioAgenciaServicio.findMany({
        where: { agenciaId: agencia.id, catalogoServicioId: { in: ids } },
        select: { catalogoServicioId: true, precio: true },
      }),
    ]);
    const overridePorServicio = new Map(overrides.map((o) => [o.catalogoServicioId, Number(o.precio)]));

    return servicios.map((s) => {
      const precioAgencia = overridePorServicio.has(s.id) ? overridePorServicio.get(s.id)! : null;
      return {
        catalogoServicioId: s.id,
        codigo: s.codigo,
        nombre: s.nombre,
        estado: s.estado,
        precioCatalogo: Number(s.precio),
        precioAgencia,
        precioEfectivo: precioAgencia ?? Number(s.precio),
      };
    });
  }

  /** Fija el precio override de uno o varios servicios GENERAL para una agencia. Solo ADMIN/SUPER_ADMIN (gateado en el controlador). */
  async setPreciosServicios(dto: SetPreciosAgenciaDto, user?: any) {
    const agencia = await this.prisma.agencia.findUnique({
      where: { id: dto.agenciaId },
      select: { id: true, nombre: true, regionId: true, servicioIds: true },
    });
    if (!agencia) throw new NotFoundException(`Agencia con ID "${dto.agenciaId}" no encontrada`);
    if (user) this.asegurarAgencia(user, agencia);

    const rawIds = Array.isArray(agencia.servicioIds) ? agencia.servicioIds : [];
    const habilitados = new Set(rawIds.map((id: any) => Number(id)));

    const idsSolicitados = dto.precios.map((p) => Number(p.catalogoServicioId));
    const noHabilitados = idsSolicitados.filter((id) => !habilitados.has(id));
    if (noHabilitados.length > 0) {
      throw new BadRequestException(
        `Los servicios con ID ${noHabilitados.join(', ')} no están habilitados para la agencia "${agencia.nombre}".`,
      );
    }

    const servicios = await this.prisma.catalogoServicio.findMany({
      where: { id: { in: idsSolicitados } },
      select: { id: true, categoria: true },
    });
    const servicioPorId = new Map(servicios.map((s) => [s.id, s]));
    const invalidos = idsSolicitados.filter((id) => servicioPorId.get(id)?.categoria !== 'GENERAL');
    if (invalidos.length > 0) {
      throw new BadRequestException(
        `Los servicios con ID ${invalidos.join(', ')} no existen o no son servicios GENERALES: el precio por agencia solo aplica a servicios generales.`,
      );
    }

    await this.prisma.$transaction(
      dto.precios.map((p) =>
        this.prisma.precioAgenciaServicio.upsert({
          where: { agenciaId_catalogoServicioId: { agenciaId: dto.agenciaId, catalogoServicioId: Number(p.catalogoServicioId) } },
          create: { agenciaId: dto.agenciaId, catalogoServicioId: Number(p.catalogoServicioId), precio: p.precio },
          update: { precio: p.precio },
        }),
      ),
    );

    return this.listPreciosServicios({ agenciaId: dto.agenciaId }, user);
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
    this.asegurarAgencia(user, { id: agencia.id, regionId: agencia.regionId });

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
      ['LIDER', 'APROBADOR'].includes(u.role?.namerol || ''),
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

  async listBahias(dto: ListBahiasDto, user?: any) {
    const where = combinarWhere(
      whereSobreAgencia(resolverAlcance(user)),
      dto.agenciaId ? { agenciaId: dto.agenciaId } : undefined,
      dto.activa !== undefined ? { activa: dto.activa } : undefined,
      whereBusqueda(['codigo', 'nombre', 'agencia.nombre'], dto.search),
    );
    return listarPaginable(dto, {
      where,
      columnas: {
        ...columnasSimples({ codigo: 'codigo', nombre: 'nombre', activa: 'activa', agencia: 'agencia.nombre', fecha: 'createdAt' }),
        servicios: (dir) => ({ servicios: { _count: dir } }),
      },
      ordenHeredado: [{ codigo: 'asc' }],
      contar: (w) => this.prisma.bahia.count({ where: w }),
      mapear: async (bahias: any[]) => {
        const ocupacion = await this.ocupacionDeBahias(bahias.map((b) => b.id));
        return bahias.map((b) => ({ ...this.limpiarContactoBahia(b, user), ocupada: ocupacion.get(b.id) ?? null }));
      },
      buscar: ({ where: w, orderBy, skip, take }) => this.prisma.bahia.findMany({
      where: w,
      orderBy,
      skip,
      take,
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
    }),
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

  async updateBahia(dto: UpdateBahiaDto, user?: any) {
    const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.id } });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.id}" no encontrada`);
    }
    await this.bahiaEnAlcance(user, dto.id);

    const actualizada = await this.prisma.bahia.update({
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
    return this.limpiarContactoBahia(actualizada, user);
  }

  async toggleActivaBahia(dto: ToggleActivaBahiaDto, user?: any) {
    const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.id } });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.id}" no encontrada`);
    }
    await this.bahiaEnAlcance(user, dto.id);

    const nuevaActiva = dto.activa !== undefined ? dto.activa : !bahia.activa;

    const actualizada = await this.prisma.bahia.update({
      where: { id: dto.id },
      data: { activa: nuevaActiva },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });
    return this.limpiarContactoBahia(actualizada, user);
  }

  /** Solo el rol Lavador trabaja en bahía. */
  private esRolLavador(namerol?: string | null): boolean {
    const r = (namerol || '').trim().toUpperCase();
    return r === 'LAVADOR' || r.startsWith('LAVADOR ');
  }

  /** Quita al usuario de todas sus bahías activas y cierra su historial de asignación. */
  private async liberarBahiasDeOperador(operadorId: string): Promise<void> {
    const activas = await this.prisma.bahiaOperador.findMany({ where: { operadorId, activo: true }, select: { bahiaId: true } });
    if (activas.length === 0) return;
    const bahiaIds = activas.map((a) => a.bahiaId);
    await this.prisma.bahiaOperador.updateMany({ where: { operadorId, activo: true }, data: { activo: false } });
    await this.prisma.historialAsignacionBahia.updateMany({ where: { operadorId, fechaFin: null }, data: { fechaFin: new Date() } });
    await this.prisma.bahia.updateMany({ where: { id: { in: bahiaIds }, operadorActualId: operadorId }, data: { operadorActualId: null } });
  }

  async asignarOperadorABahia(dto: AsignarOperadorBahiaDto, asignadoPorId: string, user?: any) {
    await this.bahiaEnAlcance(user, dto.bahiaId);
    const bahia = await this.prisma.bahia.findUnique({
      where: { id: dto.bahiaId },
      include: { operadorActual: true, agencia: true },
    });
    if (!bahia) {
      throw new NotFoundException(`Bahía con ID "${dto.bahiaId}" no encontrada`);
    }

    const operadorNuevoId = dto.operadorId && dto.operadorId.trim() ? dto.operadorId.trim() : null;

    if (operadorNuevoId) {
      const operador = await this.prisma.user.findUnique({ where: { id: operadorNuevoId }, include: { role: { select: { namerol: true } } } });
      if (!operador) {
        throw new NotFoundException(`Operador con ID "${operadorNuevoId}" no encontrado`);
      }
      // Solo los lavadores trabajan en bahía; el resto de roles (pulidores, técnicos, líderes…) no se asignan a una.
      if (!this.esRolLavador(operador.role?.namerol)) {
        throw new BadRequestException(
          `Solo los lavadores se asignan a una bahía. "${operador.name}" tiene el rol ${operador.role?.namerol || 'sin rol'}.`,
        );
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
    const actualizada = await this.prisma.bahia.findUnique({
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
    return this.limpiarContactoBahia(actualizada, user);
  }

  async listarOperadoresDeBahia(bahiaId: string, user?: any) {
    await this.bahiaEnAlcance(user, bahiaId);
    const filas = await this.prisma.bahiaOperador.findMany({
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
    return this.veContacto(user) ? filas : filas.map((f: any) => ({ ...f, operador: f.operador ? (({ email: _c, ...o }: any) => o)(f.operador) : f.operador }));
  }

  async desasignarOperadorDeBahia(dto: DesasignarOperadorBahiaDto, desasignadoPorId: string, user?: any) {
    await this.bahiaEnAlcance(user, dto.bahiaId);
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

    const actualizada = await this.prisma.bahia.findUnique({
      where: { id: dto.bahiaId },
      include: {
        agencia: { select: { id: true, codigo: true, nombre: true } },
        operadorActual: { select: { id: true, name: true, lastname: true, email: true } },
      },
    });
    return this.limpiarContactoBahia(actualizada, user);
  }

  async obtenerHistorialAsignaciones(dto: ListHistorialAsignacionesDto, user?: any) {
    const where: any = {};
    const alcanceHistorial = whereSobreAgencia(resolverAlcance(user));
    if (Object.keys(alcanceHistorial).length) where.bahia = alcanceHistorial;
    if (dto.bahiaId) where.bahiaId = dto.bahiaId;
    if (dto.operadorId) where.operadorId = dto.operadorId;

    // Siempre paginado: 50 por defecto y 100 como máximo (antes no había máximo).
    const { page, pageSize, skip, take } = resolverPaginacion(dto, { defecto: 50 });
    const busqueda = whereBusqueda(['bahia.codigo', 'bahia.nombre', 'operador.name', 'operador.lastname'], dto.search);
    const filtros = combinarWhere(where, busqueda) as any;
    const orderBy = resolverOrden(
      dto.sortField,
      dto.sortOrder,
      columnasSimples({ fecha: 'fechaInicio', bahia: 'bahia.codigo', operador: 'operador.name' }),
      { campo: 'fecha', dir: 'desc' },
    );

    const [items, total] = await Promise.all([
      this.prisma.historialAsignacionBahia.findMany({
        where: filtros,
        skip,
        take,
        orderBy: orderBy as any,
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
      this.prisma.historialAsignacionBahia.count({ where: filtros }),
    ]);

    // Quien no es admin nunca recibe el correo de otro usuario (D9).
    const itemsFinal = this.veContacto(user)
      ? items
      : items.map(({ operador, asignadoPor, ...resto }: any) => ({
          ...resto,
          operador: operador ? (({ email: _c, ...o }: any) => o)(operador) : operador,
          asignadoPor: asignadoPor ? (({ email: _c, ...a }: any) => a)(asignadoPor) : asignadoPor,
        }));

    return buildDataGridResponse(itemsFinal, total, page, pageSize);
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

    if (dto.agenciasIds && dto.agenciasIds.length > 0) {
      throw new BadRequestException('Un usuario pertenece a una sola agencia: agenciasIds ya no se usa. Los roles regionales trabajan por región.');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: dto.usuarioId },
      data: {
        ...(dto.agenciaId !== undefined && { agenciaId: dto.agenciaId }),
        ...(dto.regionId !== undefined && { regionId: dto.regionId }),
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

    void this.notificarCambioUsuario(
      updatedUser.id,
      'Tu asignación cambió',
      `Ahora estás asignado a ${updatedUser.agencia?.nombre || 'sin agencia'}${updatedUser.region?.nombre ? ` (región ${updatedUser.region.nombre})` : ''}.`,
    );

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

    void this.notificarCambioUsuario(
      updatedUser.id,
      nuevoEstado === 1 ? 'Tu cuenta fue activada' : 'Tu cuenta fue desactivada',
      nuevoEstado === 1 ? 'Ya puedes volver a acceder a la plataforma.' : 'Ya no tienes acceso a la plataforma. Contacta a tu administrador si crees que es un error.',
    );

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

  async updateUsuario(dto: UpdateUsuarioDto, actor?: any) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.id }, include: { role: true } });
    if (!user) {
      throw new NotFoundException(`Usuario con ID "${dto.id}" no encontrado`);
    }

    if (user.role?.namerol === 'SUPER_ADMIN') {
      throw new ForbiddenException('El usuario Super Administrador es de sistema y no puede gestionarse desde la aplicación.');
    }

    // Las contraseñas las gestiona únicamente el Administrador o el Super Administrador: nadie cambia la suya.
    const nuevaPassword = dto.password?.trim();
    if (nuevaPassword) {
      exigirPasswordSegura(nuevaPassword, user.email);
      const rolActor = rolDeUsuario(actor);
      if (!this.esAdmin(actor)) {
        throw new ForbiddenException('Solo el Administrador o el Super Administrador pueden asignar contraseñas.');
      }
      if (actor?.id && String(actor.id) === String(user.id)) {
        throw new ForbiddenException('No puedes cambiar tu propia contraseña: la asigna otro administrador.');
      }
      if (user.role?.namerol === 'ADMIN' && rolActor !== 'SUPER_ADMIN') {
        throw new ForbiddenException('Solo el Super Administrador puede reiniciar la contraseña de un Administrador.');
      }
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
      roleIdToSet = await this.resolverRoleIdPorNombreLibre(dto.rolNombre);
    }

    let passwordHashToSet: string | undefined;
    if (dto.password && dto.password.trim()) {
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

    // Si se está cambiando el rol, manda el rol nuevo (no el que tenía el usuario).
    const rolEfectivo = roleIdToSet
      ? await this.prisma.role.findUnique({ where: { id: roleIdToSet }, select: { namerol: true, ambito: true } })
      : await this.prisma.role.findUnique({ where: { id: user.roleId }, select: { namerol: true, ambito: true } });
    const currentRoleName = rolEfectivo?.namerol || user.role?.namerol || dto.rolNombre || '';
    const userRoleCode = currentRoleName.toUpperCase();
    const ambitoRolUpdate = rolEfectivo?.ambito || '';
    const supervisorGestionaBackup =
      rolDeUsuario(actor) === 'SUPERVISOR' &&
      tienePermiso(actor, 'backup.gestionar');
    if (
      supervisorGestionaBackup &&
      (user.role?.namerol?.toUpperCase() !== 'BACKUP' ||
        userRoleCode !== 'BACKUP' ||
        !actor.regionId ||
        user.regionId !== actor.regionId)
    ) {
      throw new ForbiddenException(
        'El Supervisor solo puede gestionar usuarios Backup de su propia región.',
      );
    }
    const rolNormalizadoUpdate = normalizarRol(userRoleCode);
    if (
      ambitoRolUpdate === 'GLOBAL' ||
      rolNormalizadoUpdate === 'SUPER_ADMIN' ||
      rolNormalizadoUpdate === 'ADMIN' ||
      rolNormalizadoUpdate === 'COORD_BODEGA'
    ) {
      // Alcance nacional: sin agencia ni región fija. Solo Coord Bodega conserva bodega (opcional, central).
      agenciaIdToSet = null;
      regionIdToSet = null;
      if (rolNormalizadoUpdate !== 'COORD_BODEGA') bodegaIdToSet = null;
      else if (dto.bodegaId !== undefined) bodegaIdToSet = dto.bodegaId || null;
    } else if (rolNormalizadoUpdate === 'ASISTENTE_BODEGA') {
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
    } else if (userRoleCode === 'BACKUP') {
      agenciaIdToSet = agenciaIdToSet === undefined ? user.agenciaId : agenciaIdToSet;
      regionIdToSet = regionIdToSet === undefined ? user.regionId : regionIdToSet;
      bodegaIdToSet = null;
      if (ambitoRolUpdate === 'REGION') {
        agenciaIdToSet = null;
      } else if (ambitoRolUpdate !== 'AGENCIA') {
        throw new BadRequestException('El rol Backup debe tener ámbito de agencia o región.');
      }
      if (user.regionId && regionIdToSet && regionIdToSet !== user.regionId) {
        throw new BadRequestException('La región de un usuario Backup no se puede cambiar desde su asignación.');
      }
      regionIdToSet = user.regionId || regionIdToSet;
      if (agenciaIdToSet) {
        const agenciaBackup = await this.prisma.agencia.findUnique({
          where: { id: agenciaIdToSet },
          select: { regionId: true },
        });
        if (!agenciaBackup || !agenciaBackup.regionId) {
          throw new BadRequestException('La agencia asignada al Backup debe pertenecer a una región.');
        }
        if (regionIdToSet && agenciaBackup.regionId !== regionIdToSet) {
          throw new BadRequestException(
            'La agencia asignada al Backup debe pertenecer a su región.',
          );
        }
        regionIdToSet = agenciaBackup.regionId;
      }
      if (!regionIdToSet) {
        throw new BadRequestException('El usuario Backup debe tener una región asignada.');
      }
      if (supervisorGestionaBackup && regionIdToSet !== actor.regionId) {
        throw new ForbiddenException(
          'El Supervisor solo puede asignar agencias dentro de su propia región.',
        );
      }
    } else if (ambitoRolUpdate === 'REGION' || rolNormalizadoUpdate === 'SUPERVISOR') {
      // Ámbito regional (supervisor, técnico de maquinaria, coordinador de mantenimiento…): el ámbito es la región, no una agencia.
      agenciaIdToSet = null;
      bodegaIdToSet = null;
      if (!regionIdToSet) regionIdToSet = user.regionId;
      if (!regionIdToSet) {
        throw new BadRequestException('Este rol trabaja sobre su región: debe tener una región asignada.');
      }
    }

    // Un técnico (o coordinador de mantenimiento) con trabajo abierto no se puede mover de región sin
    // reasignarlo antes: si no, ese mantenimiento o incidente queda con un tecnicoId que ya nadie ve
    // (scopeMantenimientos/scopeIncidentes solo protegen la visibilidad de ÉL, no la del resto del equipo).
    const regionRealmenteCambia = regionIdToSet !== undefined && regionIdToSet !== user.regionId;
    if (regionRealmenteCambia && (user.role?.namerol === 'TECNICO' || user.role?.namerol === 'COORD_MANTENIMIENTO')) {
      const [mantenimientosAbiertos, incidentesAbiertos] = await Promise.all([
        this.prisma.mantenimientoMaquinaria.count({ where: { tecnicoId: user.id, estado: { in: ['PENDIENTE', 'EN_PROCESO'] } } }),
        this.prisma.incidenteTecnico.count({ where: { tecnicoAsignadoId: user.id, estado: { in: ['ABIERTO', 'EN_PROCESO'] } } }),
      ]);
      if (mantenimientosAbiertos + incidentesAbiertos > 0) {
        const partes: string[] = [];
        if (mantenimientosAbiertos) partes.push(`${mantenimientosAbiertos} mantenimiento${mantenimientosAbiertos === 1 ? '' : 's'}`);
        if (incidentesAbiertos) partes.push(`${incidentesAbiertos} incidente${incidentesAbiertos === 1 ? '' : 's'}`);
        throw new BadRequestException(
          `Este usuario tiene ${partes.join(' y ')} sin terminar en su región actual. Reasígnalos antes de cambiarlo de región.`,
        );
      }
    }

    const checkRolName = currentRoleName.toUpperCase();
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
      const agenciaFinalPulidor = agenciaIdToSet !== undefined ? agenciaIdToSet : user.agenciaId;
      if (agenciaFinalPulidor) {
        await this.assertAgenciaSinOtroFijo(agenciaFinalPulidor, user.id);
      }
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
        ...(passwordHashToSet !== undefined && { passwordHash: passwordHashToSet, sesionesRevocadasAt: new Date() }),
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

    // Cambió la contraseña: las sesiones abiertas con la anterior dejan de poder renovarse.
    if (passwordHashToSet !== undefined) {
      await this.prisma.refreshSession.updateMany({
        where: { userId: updatedUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    const sIdsUser = Array.isArray(updatedUser.servicioIds)
      ? (updatedUser.servicioIds as any[]).map(Number).filter((n) => !isNaN(n) && n > 0)
      : [];
    const rolUser = (updatedUser.role?.namerol || '').toUpperCase();
    if (sIdsUser.length > 0 && (rolUser.includes('PULIDOR') || !updatedUser.agenciaId)) {
      await this.sincronizarStockPulidorPorServicios(updatedUser.id, sIdsUser, dto.id);
    }

    const rolCambio = roleIdToSet !== undefined && roleIdToSet !== user.roleId;
    const agenciaCambio = agenciaIdToSet !== undefined && agenciaIdToSet !== user.agenciaId;
    // La bahía solo aplica a lavadores y pertenece a una agencia: si deja de ser lavador o se mueve de agencia, se libera.
    if (agenciaCambio || (rolCambio && !this.esRolLavador(updatedUser.role?.namerol))) {
      await this.liberarBahiasDeOperador(updatedUser.id);
    }
    const estadoCambio = dto.estado !== undefined && dto.estado !== user.estado;
    if (rolCambio || estadoCambio) {
      const partes: string[] = [];
      if (rolCambio) partes.push(`tu rol ahora es "${updatedUser.role?.namerol}"`);
      if (estadoCambio) partes.push(dto.estado === 1 ? 'tu cuenta fue activada' : 'tu cuenta fue desactivada');
      void this.notificarCambioUsuario(updatedUser.id, 'Tu cuenta fue actualizada', `${partes.join(' y ')}. Vuelve a iniciar sesión para que los cambios surtan efecto.`);
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

  async createUsuario(dto: CreateUsuarioDto, actor?: any) {
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
      roleIdToSet = await this.resolverRoleIdPorNombreLibre(dto.rolNombre);
    }

    // Si se pidió un rol (por id o por nombre) y no se pudo resolver, se rechaza: nunca se asigna un rol
    // arbitrario "el primero que no sea SUPER_ADMIN" (eso podía terminar dando ADMIN por accidente).
    if (!roleIdToSet && (dto.roleId || dto.rolNombre)) {
      throw new BadRequestException(`No se reconoce el rol "${dto.rolNombre || dto.roleId}".`);
    }
    // Sin rol pedido: el rol de menor privilegio (LAVADOR), nunca uno con más permisos.
    if (!roleIdToSet) {
      const rolPorDefecto = await this.prisma.role.findUnique({ where: { namerol: 'LAVADOR' } });
      if (rolPorDefecto) roleIdToSet = rolPorDefecto.id;
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

    // El rol real y su ámbito se leen de la BD: `dto.rolNombre` puede llegar con el nombre visible del rol.
    const rolAsignado = await this.prisma.role.findUnique({
      where: { id: roleIdToSet },
      select: { namerol: true, ambito: true },
    });
    const userRoleCode = (rolAsignado?.namerol || dto.rolNombre || '').toUpperCase();
    const ambitoRolCreate = rolAsignado?.ambito || '';
    const supervisorPuedeCrearBackup =
      rolDeUsuario(actor) === 'SUPERVISOR' &&
      tienePermiso(actor, 'backup.gestionar') &&
      userRoleCode === 'BACKUP';
    if (actor && !this.esAdmin(actor) && !supervisorPuedeCrearBackup) {
      throw new ForbiddenException(
        'Solo Admin, Super Admin o un Supervisor regional pueden crear usuarios Backup de su región.',
      );
    }
    if (
      supervisorPuedeCrearBackup &&
      (!actor.regionId || regionIdToSet !== actor.regionId)
    ) {
      throw new ForbiddenException(
        'El Supervisor solo puede crear usuarios Backup para su propia región.',
      );
    }
    const rolNormalizadoCreate = normalizarRol(userRoleCode);
    if (
      ambitoRolCreate === 'GLOBAL' ||
      rolNormalizadoCreate === 'SUPER_ADMIN' ||
      rolNormalizadoCreate === 'ADMIN' ||
      rolNormalizadoCreate === 'COORD_BODEGA'
    ) {
      // Alcance nacional: sin agencia ni región fija. Solo Coord Bodega conserva bodega (opcional, central).
      agenciaIdToSet = null;
      regionIdToSet = null;
      if (rolNormalizadoCreate !== 'COORD_BODEGA') bodegaIdToSet = null;
    } else if (rolNormalizadoCreate === 'ASISTENTE_BODEGA') {
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
    } else if (rolNormalizadoCreate === 'LIDER') {
      if (!agenciaIdToSet) {
        throw new BadRequestException('El Líder Operador debe tener una agencia asignada.');
      }
      bodegaIdToSet = null;
    } else if (userRoleCode === 'BACKUP') {
      bodegaIdToSet = null;
      if (!regionIdToSet) {
        throw new BadRequestException('El usuario Backup debe tener una región asignada.');
      }
      if (ambitoRolCreate === 'REGION') {
        agenciaIdToSet = null;
      } else if (ambitoRolCreate !== 'AGENCIA') {
        throw new BadRequestException('El rol Backup debe tener ámbito de agencia o región.');
      }
      if (dto.regionId) {
        const regionSolicitada = await this.prisma.region.findFirst({
          where: {
            OR: [
              { id: dto.regionId },
              { nombre: { equals: dto.regionId, mode: 'insensitive' } },
              { codigo: { equals: dto.regionId, mode: 'insensitive' } },
            ],
          },
          select: { id: true },
        });
        if (regionSolicitada && regionSolicitada.id !== regionIdToSet) {
          throw new BadRequestException(
            'La región del Backup debe coincidir con la región de su agencia asignada.',
          );
        }
      }
      if (agenciaIdToSet) {
        const agenciaBackup = await this.prisma.agencia.findUnique({
          where: { id: agenciaIdToSet },
          select: { regionId: true },
        });
        if (!agenciaBackup || agenciaBackup.regionId !== regionIdToSet) {
          throw new BadRequestException(
            'La agencia asignada al Backup debe pertenecer a su región.',
          );
        }
      }
    } else if (ambitoRolCreate === 'REGION' || rolNormalizadoCreate === 'SUPERVISOR') {
      // Ámbito regional (supervisor, técnico de maquinaria, coordinador de mantenimiento…): el ámbito es la región, no una agencia.
      agenciaIdToSet = null;
      bodegaIdToSet = null;
      if (!regionIdToSet) {
        throw new BadRequestException('Este rol trabaja sobre su región: debe tener una región asignada.');
      }
    }

    const passwordToHash = dto.password?.trim();
    if (!passwordToHash) {
      throw new BadRequestException('La contraseña es obligatoria para crear el usuario.');
    }
    exigirPasswordSegura(passwordToHash, dto.email);
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
      if (agenciaIdToSet) {
        await this.assertAgenciaSinOtroFijo(agenciaIdToSet);
      }
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

  /**
   * Lista de usuarios (nunca incluye SUPER_ADMIN).
   *  - MODO HEREDADO: si el cuerpo no trae `page` ni `pageSize` devuelve el ARREGLO PLANO completo, ordenado por nombre,
   *    exactamente como antes. Los selectores, filtros y la app móvil dependen de esto.
   *  - MODO PAGINADO: con `page` o `pageSize` devuelve {items, data, total, page, pageSize, totalPages, ...}
   *    con orden, búsqueda y filtros en el servidor.
   */
  async listUsuariosPorAgencia(dto: ListUsuariosAgenciaDto, user?: any) {
    const paginado = (dto?.page !== undefined && dto?.page !== null)
      || (dto?.pageSize !== undefined && dto?.pageSize !== null);
    if (paginado) return this.ocultarContacto(await this.listUsuariosPaginado(dto, user), user);

    const where: any = {
      // Usuario SUPER_ADMIN nunca se lista en directorios
      role: { namerol: { not: 'SUPER_ADMIN' } },
    };
    const alcanceUsuarios = this.whereUsuariosPorAlcance(user);
    if (Object.keys(alcanceUsuarios).length) where.AND = [alcanceUsuarios];

    if (dto.agenciaId) {
      where.agenciaId = dto.agenciaId;
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

    return this.ocultarContacto(await this.prisma.user.findMany({
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
    }), user);
  }

  /** Condiciones sobre el rol de cada segmento rápido (la pantalla los llama píldoras). */
  private static readonly SEGMENTOS_USUARIO: Record<string, string[]> = {
    lavadores: ['LAVADOR', 'PULIDOR'],
    supervisores: ['SUPERVISOR', 'COORD'],
    bodega: ['BODEGA', 'INVENTARIO'],
    admins: ['ADMIN', 'AUDITOR'],
  };

  private whereSegmentoUsuario(segmento?: string): Record<string, unknown> | undefined {
    if (!segmento || segmento === 'todos') return undefined;
    if (segmento === 'inactivos') return { estado: 0 };
    const palabras = AgenciasService.SEGMENTOS_USUARIO[segmento];
    if (!palabras) return undefined;
    return {
      OR: palabras.map((p) => ({ role: { namerol: { contains: p, mode: 'insensitive' } } })),
    };
  }

  private async listUsuariosPaginado(dto: ListUsuariosAgenciaDto, user?: any) {
    const { page, pageSize, skip, take } = resolverPaginacion(dto);

    const roles = (dto.rolNombre || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    // Filtros generales (todos menos el segmento rápido: el resumen cuenta cada segmento con estos).
    const filtros: Array<Record<string, unknown> | undefined> = [
      // SUPER_ADMIN nunca se lista en directorios
      { role: { namerol: { not: 'SUPER_ADMIN' } } },
      this.whereUsuariosPorAlcance(user),
      dto.agenciaId ? { agenciaId: dto.agenciaId } : undefined,
      roles.length ? { role: { namerol: { in: roles } } } : undefined,
      dto.rolId ? { role: { id: dto.rolId } } : undefined,
      dto.estado !== undefined && dto.estado !== null ? { estado: dto.estado } : undefined,
      dto.regionId
        ? { OR: [{ regionId: dto.regionId }, { agencia: { regionId: dto.regionId } }] }
        : undefined,
      dto.clienteId ? { agencia: { clienteId: dto.clienteId } } : undefined,
      whereBusqueda(['name', 'lastname', 'email', 'agencia.nombre', 'role.namerol', 'region.nombre'], dto.search),
    ];
    const whereBase = combinarWhere(...filtros);
    const whereFinal = combinarWhere(whereBase, this.whereSegmentoUsuario(dto.segmento));

    const orderBy = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_USUARIOS, { campo: 'creado', dir: 'desc' });

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where: whereFinal as any,
        select: SELECT_USUARIO_LISTA,
        orderBy: orderBy as any,
        skip,
        take,
      }),
      this.prisma.user.count({ where: whereFinal as any }),
    ]);

    const respuesta: Record<string, unknown> = { ...buildDataGridResponse(items, total, page, pageSize) };

    if (dto.incluirResumen) {
      const [todos, lavadores, supervisores, bodega, admins, inactivos] = await Promise.all([
        this.prisma.user.count({ where: whereBase as any }),
        ...['lavadores', 'supervisores', 'bodega', 'admins', 'inactivos'].map((seg) =>
          this.prisma.user.count({ where: combinarWhere(whereBase, this.whereSegmentoUsuario(seg)) as any }),
        ),
      ]);
      respuesta['resumen'] = { total: todos, lavadores, supervisores, bodega, admins, inactivos };
    }

    return respuesta;
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
    // Antes se leía `u.bahiasAsignadas` (la relación legacy 1:1 vía Bahia.operadorActualId): en
    // cuanto una bahía admite más de un lavador (maxLavadoresPorBahia > 1) y se asigna un segundo,
    // `asignarOperadorABahia` mueve ese campo legacy al recién llegado y el primer lavador deja de
    // tener CUALQUIER bahía en `bahiasAsignadas` — aunque su fila en BahiaOperador siga activa. Se
    // usa la relación real (BahiaOperador.activo=true) como fuente de verdad. Ver conversación con
    // el usuario del 2026-09-30.
    const asignacionActiva = u.bahiaOperadores && u.bahiaOperadores.length > 0 ? u.bahiaOperadores[0] : null;
    const bahiaActual = asignacionActiva?.bahia || null;

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

  /** Filtro de operadores: rol (lavador / pulidor), agencia (un líder solo la suya) y estado. */
  private whereOperadores(
    dto: { agenciaId?: string; estado?: number; rol?: string; categoriaRol?: string; bahiaNombre?: string; clienteNombre?: string },
    currentUser?: any,
  ): any {
    const rolUsuario = currentUser ? (currentUser?.role?.namerol || currentUser?.roleDetails?.namerol || (typeof currentUser?.role === 'string' ? currentUser.role : '')) : '';
    const isLider = esLiderDeAgencia(normalizarRol(rolUsuario));
    const isCoordEspeciales = !isLider && (rolUsuario === 'COORD_SERVICIOS_ESPECIALES' || dto.categoriaRol === 'PULIDOR' || dto.rol === 'PULIDOR');

    const rolesPulidor = ['PULIDOR', 'Pulidor'];
    const rolesLavador = ['LAVADOR', 'Lavador', 'Lavador de Bahía'];

    let targetRoles: string[] = ['LAVADOR', 'PULIDOR', 'TECNICO', 'Pulidor'];

    if (isLider) {
      // El líder ve a quien tiene asignado en su agencia: sus lavadores y su pulidor fijo (el móvil no tiene agencia).
      const pide = dto.rol || dto.categoriaRol;
      targetRoles = pide === 'LAVADOR' ? rolesLavador : pide === 'PULIDOR' ? rolesPulidor : [...rolesLavador, ...rolesPulidor];
    } else if (isCoordEspeciales) {
      targetRoles = rolesPulidor;
    } else if (dto.categoriaRol === 'LAVADOR' || dto.rol === 'LAVADOR') {
      targetRoles = rolesLavador;
    } else if (dto.rol) {
      targetRoles = [dto.rol];
    }

    // Filtro por un rol concreto (p. ej. PULIDOR_FIJO) dentro de lo que el usuario puede ver; LAVADOR y PULIDOR son las categorías de arriba.
    if (dto.rol && dto.rol !== 'LAVADOR' && dto.rol !== 'PULIDOR' && targetRoles.includes(dto.rol)) {
      targetRoles = [dto.rol];
    } else if (dto.rol && dto.rol !== 'LAVADOR' && dto.rol !== 'PULIDOR' && !targetRoles.includes(dto.rol)) {
      targetRoles = [];
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

    // Filtros por nombre de la pantalla de operadores (bahía asignada y cliente de la agencia).
    const extra: any[] = [];
    if (dto.bahiaNombre?.trim()) {
      extra.push({ bahiaOperadores: { some: { activo: true, bahia: { nombre: { contains: dto.bahiaNombre.trim(), mode: 'insensitive' } } } } });
    }
    if (dto.clienteNombre?.trim()) {
      extra.push({ agencia: { cliente: { nombre: { equals: dto.clienteNombre.trim(), mode: 'insensitive' } } } });
    }
    // El alcance del usuario manda sobre lo que pida el cliente.
    where.AND = [...extra, this.whereUsuariosPorAlcance(currentUser)];

    return where;
  }

  async listOperadores(dto: ListOperadoresDto, currentUser?: any) {
    const where = this.whereOperadores(dto, currentUser);
    return this.ocultarContacto(await listarPaginable(dto, {
      where: combinarWhere(where, whereBusqueda(['name', 'lastname', 'email', 'agencia.nombre'], dto.search)),
      columnas: columnasSimples({ nombre: 'name', agencia: 'agencia.nombre', rol: 'role.namerol', estado: 'estado', fecha: 'createdAt' }),
      ordenHeredado: [{ name: 'asc' }],
      contar: (w) => this.prisma.user.count({ where: w }),
      mapear: (users: any[]) => users.map((u) => this.mapUserToOperador(u)),
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.user.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: {
            role: true,
            agencia: true,
            bahiaOperadores: { where: { activo: true }, include: { bahia: { select: { id: true, nombre: true, codigo: true, updatedAt: true } } } },
            _count: { select: { serviciosAtendidos: true } },
          },
        }),
    }), currentUser);
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

    const passwordTemporal = generarPasswordTemporal();
    const passwordHash = await bcrypt.hash(passwordTemporal, 10);
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
        bahiaOperadores: { where: { activo: true }, include: { bahia: { select: { id: true, nombre: true, codigo: true, updatedAt: true } } } },
        _count: {
          select: { serviciosAtendidos: true }
        }
      }
    });

    // Si se especificó bahía, asignarlo inmediatamente a la bahía en BD (solo los lavadores van a bahía)
    if (this.esRolLavador(role.namerol) && dto.bahiaId && dto.bahiaId.trim() &&!dto.bahiaId.toLowerCase().includes('sin bahia') && !dto.bahiaId.toLowerCase().includes('sin bahía')) {
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
        bahiaOperadores: { where: { activo: true }, include: { bahia: { select: { id: true, nombre: true, codigo: true, updatedAt: true } } } },
        _count: {
          select: { serviciosAtendidos: true }
        }
      }
    });

    // La contraseña se entrega una sola vez, para que quien registra al operador se la comunique. Solo un administrador puede cambiarla después.
    return { ...this.mapUserToOperador(created), passwordTemporal };
  }

  async updateOperador(dto: UpdateOperadorDto, updaterId?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.id },
      include: { role: { select: { namerol: true } }, bahiaOperadores: { where: { activo: true }, include: { bahia: { select: { id: true, nombre: true, codigo: true, updatedAt: true } } } } }
    });
    if (!user) {
      throw new NotFoundException(`Operador con ID "${dto.id}" no encontrado`);
    }

    const dataToUpdate: any = {};
    let rolNombreFinal: string | undefined = user.role?.namerol;
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
        rolNombreFinal = role.namerol;
      }
    }

    await this.prisma.user.update({
      where: { id: dto.id },
      data: dataToUpdate
    });

    // Un rol distinto de lavador no trabaja en bahía: se le libera la que tuviera y no se le asigna otra.
    const trabajaEnBahia = this.esRolLavador(rolNombreFinal);
    if (!trabajaEnBahia || (dataToUpdate.agenciaId && dataToUpdate.agenciaId !== user.agenciaId)) {
      await this.liberarBahiasDeOperador(dto.id);
    }

    // Si se especificó bahía para cambiar o desvincular
    if (trabajaEnBahia && dto.bahiaId !== undefined) {
      const currentBahia = user.bahiaOperadores?.[0]?.bahia;
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
        bahiaOperadores: { where: { activo: true }, include: { bahia: { select: { id: true, nombre: true, codigo: true, updatedAt: true } } } },
        _count: { select: { serviciosAtendidos: true } }
      }
    });

    return this.mapUserToOperador(reloaded);
  }
}

/** Columnas por las que se puede ordenar la lista de usuarios (clave pública → campo de Prisma). */
const ORDEN_USUARIOS = columnasSimples({
  nombre: 'name',
  email: 'email',
  rol: 'role.namerol',
  agencia: 'agencia.nombre',
  region: 'region.nombre',
  estado: 'estado',
  creado: 'createdAt',
  fechaAsignacion: 'createdAt',
});

/** Campos que devuelve el listado paginado (los del modo heredado más la fecha de creación). */
const SELECT_USUARIO_LISTA = {
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
  createdAt: true,
  updatedAt: true,
};
