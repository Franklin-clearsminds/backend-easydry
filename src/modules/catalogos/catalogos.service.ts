import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizarRol } from '../../common/permisos/alias-roles.js';
import { columnasSimples, combinarWhere, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { listarOpciones } from '../../common/utils/opciones.js';
import {
  CreateCatalogoServicioDto,
  UpdateCatalogoServicioDto,
  ListCatalogoServiciosDto,
  ServiciosOpcionesDto,
} from './dto/servicios.dto.js';

// Roles cuyo catálogo se acota a Agencia.servicioIds aunque no tengan sede (entonces no ven nada)
const ROLES_SCOPED = ['LIDER', 'APROBADOR'];
// Estos roles ven todo el catálogo: no se atan a región, agencia ni marca.
const ROLES_SIN_ALCANCE = ['SUPER_ADMIN', 'ADMIN'];

@Injectable()
export class CatalogosService {
  constructor(private prisma: PrismaService) {}

  /**
   * Qué servicios puede ver quien consulta: filtra por categoría y, para roles de sede o si se pide una agencia, solo los
   * servicios de esa agencia (nunca el catálogo global). Devuelve también el contexto de la agencia y la búsqueda de texto.
   */
  private async alcanceServicios(dto?: { categoria?: string; search?: string; agenciaId?: string }, userCtx?: { agenciaId?: string; namerol?: string }) {
    const where: any = {};
    if (dto?.categoria && dto.categoria !== 'TODOS') {
      // Admite varias categorías separadas por coma (p. ej. "ESPECIAL,EXTRA" para la pestaña de especiales).
      const categorias = dto.categoria.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
      where.categoria = categorias.length > 1 ? { in: categorias } : categorias[0];
    }
    const busqueda = whereBusqueda(['nombre', 'codigo'], dto?.search);

    const namerol = normalizarRol(userCtx?.namerol);
    const isScopedRole = ROLES_SCOPED.includes(namerol);
    // Regla única de alcance: quien no es Admin ni Súper Admin y tiene sede queda limitado a los servicios de su sede.
    const sinAlcance = ROLES_SIN_ALCANCE.includes(namerol);
    const acotadoPorSede = !sinAlcance && !!userCtx?.agenciaId;
    // Con sede (o rol de sede) manda SIEMPRE la agencia del usuario; la que mande el cliente solo cuenta para administradores.
    const efectiveAgenciaId = acotadoPorSede || isScopedRole ? userCtx?.agenciaId : dto?.agenciaId || userCtx?.agenciaId;

    let agenciaCtx: { tieneServiciosEspeciales: boolean; servicioIds: number[]; nombre?: string } | null = null;

    // Usuario con sede (no admin) O admin filtrando por agencia → solo servicios de esa agencia
    if (efectiveAgenciaId && (acotadoPorSede || isScopedRole || !!dto?.agenciaId)) {
      const agencia = await this.prisma.agencia.findUnique({
        where: { id: efectiveAgenciaId },
        select: {
          nombre: true,
          tieneServiciosEspeciales: true,
          servicioIds: true,
          serviciosNombres: true,
        },
      });

      if (agencia) {
        const rawIds = Array.isArray(agencia.servicioIds) ? agencia.servicioIds : [];
        const ids = rawIds.map((id: any) => Number(id)).filter((n: number) => !isNaN(n) && n > 0);
        const nombres = (Array.isArray(agencia.serviciosNombres) ? agencia.serviciosNombres : [])
          .map((n: any) => String(n ?? '').trim())
          .filter(Boolean);

        agenciaCtx = {
          tieneServiciosEspeciales: agencia.tieneServiciosEspeciales ?? false,
          servicioIds: ids,
          nombre: agencia.nombre,
        };

        // Por id o por nombre (la sede guarda ambos). Sin ninguno → vacío (nunca catálogo global).
        const porAgencia = [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...nombres.map((n: string) => ({ nombre: { equals: n, mode: 'insensitive' } })),
        ];
        if (porAgencia.length) where.AND = [{ OR: porAgencia }];
        else where.id = { in: [-1] };

        if (!agencia.tieneServiciosEspeciales) {
          where.categoria = 'GENERAL';
        }
      } else if (isScopedRole) {
        where.id = { in: [-1] };
        agenciaCtx = { tieneServiciosEspeciales: false, servicioIds: [] };
      }
    } else if ((isScopedRole || acotadoPorSede) && !efectiveAgenciaId) {
      where.id = { in: [-1] };
      agenciaCtx = { tieneServiciosEspeciales: false, servicioIds: [] };
    }
    return { where, busqueda, agenciaCtx };
  }

  async listServicios(dto?: ListCatalogoServiciosDto, userCtx?: { agenciaId?: string; namerol?: string }) {
    const { where, busqueda, agenciaCtx } = await this.alcanceServicios(dto, userCtx);

    // cantidadSugerida viaja en la unidad base del insumo: es lo que descuenta el stock al registrar la OT.
    const conCantidadBase = (servicios: any[]) =>
      servicios.map((servicio) => ({
        ...servicio,
        recetas: servicio.recetas.map((receta: any) => {
          const factor = receta.unidadConsumo?.factorBase ? Number(receta.unidadConsumo.factorBase) : 1;
          return {
            ...receta,
            productoSKU: receta.insumo?.codigoSKU,
            productoNombre: receta.insumo?.nombre,
            unidadMedida: receta.insumo?.unidadMedida?.simbolo || receta.unidadConsumo?.simbolo || 'u',
            cantidadSugerida: Number(receta.cantidadUsada) * (factor || 1),
          };
        }),
      }));

    // Sin page/pageSize: como siempre (arreglo, u objeto {servicios, agencia} para roles acotados), con tope de 100.
    // Con alguno: página estándar (y `agencia` cuando el rol está acotado a una sede).
    const resultado = await listarPaginable(dto ?? {}, {
      where: combinarWhere(where, busqueda),
      columnas: columnasSimples({ codigo: 'codigo', nombre: 'nombre', categoria: 'categoria', precio: 'precio', tiempo: 'tiempoEstimadoMin', fecha: 'id' }),
      ordenHeredado: [{ codigo: 'asc' }],
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.catalogoServicio.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: {
            recetas: { include: { insumo: { include: { unidadMedida: true } }, unidadConsumo: true } },
            _count: { select: { servicios: true } },
          },
        }),
      contar: (w) => this.prisma.catalogoServicio.count({ where: w }),
      mapear: conCantidadBase,
    });

    if (agenciaCtx) {
      return Array.isArray(resultado) ? { servicios: resultado, agencia: agenciaCtx } : { ...resultado, agencia: agenciaCtx };
    }
    return resultado;
  }

  /** Servicios para un desplegable con buscador: { value (id), label (nombre), sublabel (código · categoría) } paginado. */
  async listServiciosOpciones(dto: ServiciosOpcionesDto, userCtx?: { agenciaId?: string; namerol?: string }) {
    const { where } = await this.alcanceServicios(dto, userCtx);
    return listarOpciones(dto, {
      where,
      camposBusqueda: ['nombre', 'codigo'],
      orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.catalogoServicio.findMany({ where: w, orderBy, skip, take, select: { id: true, codigo: true, nombre: true, categoria: true } }),
      contar: (w) => this.prisma.catalogoServicio.count({ where: w }),
      mapear: (s) => ({ value: String(s.id), label: s.nombre, sublabel: [s.codigo, s.categoria].filter(Boolean).join(' · ') || undefined }),
    });
  }

  /**
   * Siguiente código libre para un servicio nuevo: SER-### (generales) o ESP-### (especiales y extras), con el mayor número
   * existente + 1 y ceros a la izquierda. El alta sigue rechazando códigos duplicados.
   */
  async siguienteCodigo(categoria?: string) {
    const prefijo = String(categoria || 'GENERAL').trim().toUpperCase() === 'GENERAL' ? 'SER' : 'ESP';
    const existentes = await this.prisma.catalogoServicio.findMany({
      where: { codigo: { startsWith: `${prefijo}-` } },
      select: { codigo: true },
    });
    const mayor = existentes.reduce((max, s) => {
      const n = Number(/^[A-Z]+-(\d+)$/.exec(s.codigo)?.[1]);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return { codigo: `${prefijo}-${String(mayor + 1).padStart(3, '0')}` };
  }

  async createServicio(dto: CreateCatalogoServicioDto) {
    const codigoUpper = dto.codigo.trim().toUpperCase();
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { codigo: codigoUpper },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un servicio con el código "${codigoUpper}"`);
    }

    return this.prisma.catalogoServicio.create({
      data: {
        codigo: codigoUpper,
        nombre: dto.nombre.trim(),
        categoria: dto.categoria.trim().toUpperCase(),
        descripcion: dto.descripcion?.trim() || null,
        precio: dto.precio ?? 0,
        tiempoEstimadoMin: Number(dto.tiempoEstimadoMin) > 0 ? Math.round(Number(dto.tiempoEstimadoMin)) : 30,
        estado: dto.estado === 'Inactivo' ? 'Inactivo' : 'Activo',
      },
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

  async updateServicio(dto: UpdateCatalogoServicioDto) {
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { id: dto.id },
    });
    if (!existing) {
      throw new NotFoundException(`Servicio de catálogo con ID ${dto.id} no encontrado`);
    }

    if (dto.codigo && dto.codigo.trim().toUpperCase() !== existing.codigo) {
      const codigoUpper = dto.codigo.trim().toUpperCase();
      const duplicate = await this.prisma.catalogoServicio.findUnique({
        where: { codigo: codigoUpper },
      });
      if (duplicate) {
        throw new ConflictException(`Ya existe otro servicio con el código "${codigoUpper}"`);
      }
    }

    return this.prisma.catalogoServicio.update({
      where: { id: dto.id },
      data: {
        ...(dto.codigo && { codigo: dto.codigo.trim().toUpperCase() }),
        ...(dto.nombre && { nombre: dto.nombre.trim() }),
        ...(dto.categoria && { categoria: dto.categoria.trim().toUpperCase() }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion?.trim() || null }),
        ...(dto.precio !== undefined && { precio: dto.precio }),
        ...(dto.tiempoEstimadoMin !== undefined && {
          tiempoEstimadoMin: Math.max(1, Math.round(Number(dto.tiempoEstimadoMin) || 30)),
        }),
        ...(dto.estado !== undefined && { estado: dto.estado }),
      },
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

  async deleteServicio(id: number) {
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { id },
      include: { _count: { select: { servicios: true } } },
    });
    if (!existing) {
      throw new NotFoundException(`Servicio de catálogo con ID ${id} no encontrado`);
    }

    if (existing._count.servicios > 0) {
      throw new ConflictException(
        `No se puede eliminar el servicio "${existing.nombre}" porque tiene ${existing._count.servicios} órdenes de lavado asociadas`,
      );
    }

    await this.prisma.catalogoServicio.delete({
      where: { id },
    });

    return { success: true, message: `Servicio "${existing.nombre}" eliminado correctamente` };
  }

  async getAgencias() {
    return this.prisma.agencia.findMany({
      where: { estado: 1 },
      include: {
        bahias: {
          where: { activa: true },
          select: { id: true, codigo: true, nombre: true },
        },
        cliente: { select: { id: true, nombre: true } },
      },
      orderBy: { codigo: 'asc' },
    });
  }

  async getBahias(agenciaId?: string) {
    const where: any = { activa: true };
    if (agenciaId) {
      where.agenciaId = agenciaId;
    }
    return this.prisma.bahia.findMany({
      where,
      include: {
        agencia: {
          select: { id: true, codigo: true, nombre: true },
        },
      },
      orderBy: { codigo: 'asc' },
    });
  }
}
