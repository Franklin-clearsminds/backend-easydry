import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRoleDto } from './dto/create-role.dto.js';
import { UpdateRoleDto } from './dto/update-role.dto.js';
import { QueryRolesDto } from './dto/query-roles.dto.js';
import { formatDateTime } from '../../common/utils/date-formatter.util.js';
import { columnasSimples, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { AMBITOS, CATALOGO_PERMISOS, ROL_SUPER_ADMIN, esAmbito, esCodigoPermiso } from '../../common/permisos/catalogo-permisos.js';
import { normalizarRol, rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { ambitoDeUsuario, tienePermiso } from '../../common/permisos/capacidades.js';
import { accionesLegacy } from '../../common/permisos/acciones-legacy.js';

/** Qué tan amplio es un ámbito: un rol no puede darle a otro más alcance del que él mismo tiene. */
const AMPLITUD: Record<string, number> = { GLOBAL: 3, REGION: 2, AGENCIA: 1, PROPIO: 0 };

const NOMBRE_VALIDO = /^[A-Z][A-Z0-9_]{2,39}$/;

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  /** Catálogo de módulos de navegación (tabla modulos_sistema) y de permisos que exige el backend. */
  async getAvailablePermissions() {
    const modulos = await this.prisma.moduloSistema.findMany({
      where: { estado: 1 },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    const catalogo = modulos.map((m) => ({
      id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      descripcion: m.descripcion || '',
      icono: m.icono || undefined,
      rutaPrincipal: m.rutaPrincipal || undefined,
      grupo: m.grupo,
      orden: m.orden,
    }));

    return {
      total: catalogo.length,
      codigos: catalogo.map((c) => c.codigo),
      catalogo,
      /** Permisos que el backend exige en cada endpoint, agrupados para la pantalla de roles. */
      capacidades: CATALOGO_PERMISOS.map((p) => ({ codigo: p.codigo, grupo: p.grupo, nombre: p.nombre, descripcion: p.descripcion })),
      ambitos: [...AMBITOS],
    };
  }

  /** Listado de módulos del sistema (misma fuente que permisos) */
  async listModulos(soloActivos = true) {
    const where = soloActivos ? { estado: 1 } : {};
    const modulos = await this.prisma.moduloSistema.findMany({
      where,
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    return modulos.map((m) => ({
      id: m.id,
      codigo: m.codigo,
      nombre: m.nombre,
      descripcion: m.descripcion || '',
      icono: m.icono || 'circle',
      rutaPrincipal: m.rutaPrincipal || `/${m.codigo}`,
      grupo: m.grupo,
      orden: m.orden,
      estado: m.estado,
    }));
  }

  private mapRoleResponse(role: any) {
    return {
      id: role.id,
      namerol: role.namerol,
      descripcion: role.descripcion || '',
      estado: role.estado,
      permisos: Array.isArray(role.permisos) ? role.permisos : [],
      capacidades: Array.isArray(role.capacidades) ? role.capacidades : [],
      ambito: role.ambito ?? 'AGENCIA',
      esSistema: !!role.esSistema,
      acciones: role.acciones ?? null,
      fechaCreacion: formatDateTime(role.fechaCreacion),
      fechaModificacion: formatDateTime(role.fechaModificacion),
      usuariosCount: role._count?.users ?? role.users?.length ?? 0,
    };
  }

  async findAll(query?: QueryRolesDto, _userRole?: string) {
    const and: any[] = [{ namerol: { not: ROL_SUPER_ADMIN } }];

    if (query?.estado !== undefined) {
      and.push({ estado: Number(query.estado) });
    }

    if (query?.namerol) {
      and.push({ namerol: { contains: query.namerol.trim(), mode: 'insensitive' } });
    }

    const busqueda = whereBusqueda(['namerol', 'descripcion'], query?.search);
    if (busqueda) and.push(busqueda);

    return listarPaginable(query ?? {}, {
      where: { AND: and },
      columnas: {
        ...columnasSimples({ namerol: 'namerol', estado: 'estado', fecha: 'fechaCreacion' }),
        usuarios: (dir) => ({ users: { _count: dir } }),
      },
      ordenHeredado: [{ namerol: 'asc' }],
      buscar: ({ where, orderBy, skip, take }) =>
        this.prisma.role.findMany({ where, orderBy, skip, take, include: { _count: { select: { users: true } } } }),
      contar: (where) => this.prisma.role.count({ where }),
      mapear: (roles) => roles.map((r) => this.mapRoleResponse(r)),
    });
  }

  async findOne(idOrNamerol: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        OR: [
          { id: idOrNamerol },
          { namerol: idOrNamerol.trim() },
        ],
      },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Rol con ID o namerol '${idOrNamerol}' no encontrado`);
    }

    return this.mapRoleResponse(role);
  }

  // ---------------------------------------------------------------------------
  // Validaciones compartidas
  // ---------------------------------------------------------------------------

  private async validarModulos(codigos: string[]): Promise<string[]> {
    const unicos = Array.from(new Set(codigos));
    if (!unicos.length) return [];
    const existentes = await this.prisma.moduloSistema.findMany({ where: { codigo: { in: unicos } }, select: { codigo: true } });
    const validos = new Set(existentes.map((m) => m.codigo));
    const desconocidos = unicos.filter((c) => !validos.has(c));
    if (desconocidos.length) throw new BadRequestException(`Módulos desconocidos: ${desconocidos.join(', ')}`);
    return unicos;
  }

  private validarCapacidades(codigos: string[]): string[] {
    const unicos = Array.from(new Set(codigos));
    const desconocidos = unicos.filter((c) => !esCodigoPermiso(c));
    if (desconocidos.length) throw new BadRequestException(`Permisos desconocidos: ${desconocidos.join(', ')}`);
    return unicos;
  }

  /** Nadie puede darle a un rol permisos o alcance que él mismo no tiene (el SUPER_ADMIN puede todo). */
  private asegurarNoEscalar(actor: any, capacidades: string[] | undefined, ambito: string | undefined): void {
    if (rolDeUsuario(actor) === ROL_SUPER_ADMIN) return;
    const faltantes = (capacidades ?? []).filter((c) => !tienePermiso(actor, c));
    if (faltantes.length) {
      throw new ForbiddenException(`No puedes otorgar permisos que tu rol no tiene: ${faltantes.join(', ')}`);
    }
    if (ambito && (AMPLITUD[ambito] ?? 0) > (AMPLITUD[ambitoDeUsuario(actor)] ?? 0)) {
      throw new ForbiddenException('No puedes otorgar un ámbito más amplio que el de tu propio rol.');
    }
  }

  /** Un rol que no es SUPER_ADMIN no puede editar el suyo ni uno con permisos que él no tiene. */
  private asegurarPuedeGestionar(actor: any, role: { id: string; capacidades?: string[] | null }): void {
    if (rolDeUsuario(actor) === ROL_SUPER_ADMIN) return;
    if (actor?.roleId && actor.roleId === role.id) {
      throw new ForbiddenException('No puedes modificar tu propio rol.');
    }
    const faltantes = (role.capacidades ?? []).filter((c) => !tienePermiso(actor, c));
    if (faltantes.length) {
      throw new ForbiddenException('No puedes gestionar un rol con permisos que tu rol no tiene.');
    }
  }

  private nombreValido(bruto: string): string {
    const nombre = String(bruto ?? '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!NOMBRE_VALIDO.test(nombre)) {
      throw new BadRequestException('El nombre del rol debe tener de 3 a 40 caracteres: letras, números y guion bajo, empezando por letra.');
    }
    if (nombre === ROL_SUPER_ADMIN) {
      throw new ForbiddenException('El rol SUPER_ADMIN es un rol de sistema reservado.');
    }
    if (normalizarRol(nombre) !== nombre) {
      throw new BadRequestException(`El nombre '${nombre}' es un alias antiguo de '${normalizarRol(nombre)}'; usa otro nombre.`);
    }
    return nombre;
  }

  // ---------------------------------------------------------------------------
  // Alta, edición y baja
  // ---------------------------------------------------------------------------

  async create(createDto: CreateRoleDto, actor: any) {
    const namerol = this.nombreValido(createDto.namerol);

    const existing = await this.prisma.role.findUnique({ where: { namerol } });
    if (existing) {
      throw new ConflictException(`El rol con namerol '${namerol}' ya existe`);
    }

    const capacidades = this.validarCapacidades(createDto.capacidades ?? []);
    const ambito = createDto.ambito ?? 'AGENCIA';
    if (!esAmbito(ambito)) throw new BadRequestException('Ámbito inválido.');
    this.asegurarNoEscalar(actor, capacidades, ambito);
    const permisos = await this.validarModulos(createDto.permisos ?? []);

    const newRole = await this.prisma.role.create({
      data: {
        namerol,
        descripcion: createDto.descripcion?.trim() || null,
        estado: createDto.estado !== undefined ? Number(createDto.estado) : 1,
        permisos,
        capacidades,
        ambito,
        acciones: accionesLegacy(capacidades, ambito) as unknown as Prisma.InputJsonValue,
        esSistema: false,
      },
    });

    return this.mapRoleResponse(newRole);
  }

  async update(updateDto: UpdateRoleDto, actor: any) {
    const { id, namerol, descripcion, estado, permisos, capacidades, ambito } = updateDto;

    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Rol con ID '${id}' no encontrado`);
    }
    if (role.namerol === ROL_SUPER_ADMIN) {
      throw new ForbiddenException('El rol SUPER_ADMIN es inmutable por diseño del sistema; no se pueden modificar sus permisos, estado ni configuración.');
    }
    this.asegurarPuedeGestionar(actor, role);

    const dataToUpdate: any = {};

    if (namerol) {
      const nuevo = this.nombreValido(namerol);
      if (nuevo !== role.namerol) {
        if (role.esSistema) {
          throw new ForbiddenException('El nombre de un rol oficial no se puede cambiar: el sistema lo usa internamente.');
        }
        const duplicate = await this.prisma.role.findUnique({ where: { namerol: nuevo } });
        if (duplicate) {
          throw new ConflictException(`Ya existe otro rol con el namerol '${nuevo}'`);
        }
        dataToUpdate.namerol = nuevo;
      }
    }

    if (descripcion !== undefined) {
      dataToUpdate.descripcion = descripcion?.trim() || null;
    }

    if (estado !== undefined) {
      dataToUpdate.estado = Number(estado);
    }

    if (permisos !== undefined) {
      dataToUpdate.permisos = await this.validarModulos(permisos);
    }

    let capacidadesNuevas: string[] | undefined;
    if (capacidades !== undefined) {
      capacidadesNuevas = this.validarCapacidades(capacidades);
      dataToUpdate.capacidades = capacidadesNuevas;
    }
    if (ambito !== undefined) {
      if (!esAmbito(ambito)) throw new BadRequestException('Ámbito inválido.');
      dataToUpdate.ambito = ambito;
    }
    // Solo se validan como "otorgados" los permisos que el rol no tenía antes.
    const nuevos = capacidadesNuevas?.filter((c) => !(role.capacidades ?? []).includes(c));
    this.asegurarNoEscalar(actor, nuevos, ambito !== undefined && ambito !== role.ambito ? ambito : undefined);

    if (dataToUpdate.capacidades !== undefined || dataToUpdate.ambito !== undefined) {
      dataToUpdate.acciones = accionesLegacy(
        dataToUpdate.capacidades ?? role.capacidades ?? [],
        dataToUpdate.ambito ?? role.ambito ?? 'AGENCIA',
      ) as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.role.update({
      where: { id },
      data: dataToUpdate,
      include: { _count: { select: { users: true } } },
    });

    return this.mapRoleResponse(updated);
  }

  async delete(id: string, actor: any) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });

    if (!role) {
      throw new NotFoundException(`Rol con ID '${id}' no encontrado`);
    }
    if (role.namerol === ROL_SUPER_ADMIN) {
      throw new ForbiddenException('El rol SUPER_ADMIN no puede ser eliminado por diseño del sistema.');
    }
    if (role.esSistema) {
      throw new ForbiddenException('Los roles oficiales no se pueden eliminar; si no se usan, desactívalos.');
    }
    this.asegurarPuedeGestionar(actor, role);
    if (role._count.users > 0) {
      throw new ConflictException(`El rol '${role.namerol}' tiene ${role._count.users} usuario(s) asignado(s). Reasígnalos o desactiva el rol antes de eliminarlo.`);
    }

    await this.prisma.role.delete({ where: { id } });

    return {
      success: true,
      message: `Rol '${role.namerol}' eliminado exitosamente`,
      id,
    };
  }
}
