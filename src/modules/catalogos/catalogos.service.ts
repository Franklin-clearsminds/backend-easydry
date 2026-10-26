import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CODIGOS_RETOQUE } from '../../common/utils/retoque-catalogo.js';
import { aUnidadDelInsumo } from '../../common/utils/costo-insumo.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FUNCION, funcionesDeRol } from '../../common/permisos/funciones.js';
import { columnasSimples, combinarWhere, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { listarOpciones } from '../../common/utils/opciones.js';
import {
  CreateCatalogoServicioDto,
  UpdateCatalogoServicioDto,
  ListCatalogoServiciosDto,
  ServiciosOpcionesDto,
} from './dto/servicios.dto.js';

type ContextoUsuario = { agenciaId?: string; namerol?: string; capacidades?: string[] };

@Injectable()
export class CatalogosService {
  constructor(private prisma: PrismaService) {}

  /**
   * Qué servicios puede ver quien consulta: filtra por categoría y, para roles de sede o si se pide una agencia, solo los
   * servicios de esa agencia (nunca el catálogo global). Devuelve también el contexto de la agencia y la búsqueda de texto.
   */
  private async alcanceServicios(dto?: { categoria?: string; search?: string; agenciaId?: string }, userCtx?: ContextoUsuario) {
    const where: any = {};
    if (dto?.categoria && dto.categoria !== 'TODOS') {
      // Admite varias categorías separadas por coma (p. ej. "GENERAL,ESPECIAL").
      const categorias = dto.categoria.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
      where.categoria = categorias.length > 1 ? { in: categorias } : categorias[0];
    }
    const busqueda = whereBusqueda(['nombre', 'codigo'], dto?.search);

    const funciones = funcionesDeRol(userCtx?.capacidades, userCtx?.namerol);
    // Líder (y quien actúa como él) y aprobador: su catálogo se acota a Agencia.servicioIds aunque no tengan sede (entonces no ven nada).
    const isScopedRole = funciones.has(FUNCION.LIDER_AGENCIA) || funciones.has(FUNCION.APROBADOR);
    // Regla única de alcance: quien no es administrador y tiene sede queda limitado a los servicios de su sede.
    const sinAlcance = funciones.has(FUNCION.ADMINISTRADOR);
    const acotadoPorSede = !sinAlcance && !!userCtx?.agenciaId;
    // Con sede (o rol de sede) manda SIEMPRE la agencia del usuario; la que mande el cliente solo cuenta para administradores.
    const efectiveAgenciaId = acotadoPorSede || isScopedRole ? userCtx?.agenciaId : dto?.agenciaId || userCtx?.agenciaId;

    let agenciaCtx: { tieneServiciosEspeciales: boolean; servicioIds: number[]; nombre?: string } | null = null;
    // Agencia cuyos precios se muestran: solo la propia de quien tiene sede (un admin filtrando por agencia no ve precios en el catálogo).
    let agenciaPrecioId: string | null = null;

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
        if (acotadoPorSede || isScopedRole) agenciaPrecioId = efectiveAgenciaId ?? null;

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
    return { where, busqueda, agenciaCtx, agenciaPrecioId };
  }

  async listServicios(dto?: ListCatalogoServiciosDto, userCtx?: ContextoUsuario) {
    const { where, busqueda, agenciaCtx, agenciaPrecioId } = await this.alcanceServicios(dto, userCtx);

    // Quien tiene sede ve el precio que su agencia tiene fijado para cada servicio (`precioAgencia`, null si no hay). El precio global
    // del catálogo es siempre 0 y no se muestra. Sin el permiso `precios.ver` el interceptor lo retira de la respuesta.
    const conPrecioAgencia = async (servicios: any[]) => {
      if (!agenciaPrecioId || servicios.length === 0) return servicios;
      const filas = await this.prisma.precioAgenciaServicio.findMany({
        where: { agenciaId: agenciaPrecioId, catalogoServicioId: { in: servicios.map((s) => s.id) } },
        select: { catalogoServicioId: true, precio: true },
      });
      const porServicio = new Map(filas.map((f) => [f.catalogoServicioId, Number(f.precio)]));
      return servicios.map((s) => ({ ...s, precioAgencia: porServicio.get(s.id) ?? null }));
    };

    // cantidadSugerida viaja en la unidad propia del insumo (la de sus existencias): es lo que descuenta el stock al registrar la OT.
    const conCantidadBase = (servicios: any[]) =>
      servicios.map((servicio) => ({
        ...servicio,
        recetas: servicio.recetas.map((receta: any) => {
          return {
            ...receta,
            productoSKU: receta.insumo?.codigoSKU,
            productoNombre: receta.insumo?.nombre,
            unidadMedida: receta.insumo?.unidadMedida?.simbolo || receta.unidadConsumo?.simbolo || 'u',
            cantidadSugerida: aUnidadDelInsumo(Number(receta.cantidadUsada), receta.unidadConsumo?.factorBase, receta.insumo?.unidadMedida?.factorBase),
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
      mapear: (servicios) => conPrecioAgencia(conCantidadBase(servicios)),
    });

    if (agenciaCtx) {
      return Array.isArray(resultado) ? { servicios: resultado, agencia: agenciaCtx } : { ...resultado, agencia: agenciaCtx };
    }
    return resultado;
  }

  /** Servicios para un desplegable con buscador: { value (id), label (nombre), sublabel (código · categoría) } paginado. */
  async listServiciosOpciones(dto: ServiciosOpcionesDto, userCtx?: ContextoUsuario) {
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
   * Siguiente código libre para un servicio nuevo: SER-### (generales) o ESP-### (especiales), con el mayor número
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

  /** Cada categoría tiene sus propias casillas: «catalogo.generales.*» o «catalogo.especiales.*». */
  private exigir(user: any, categoria: string, accion: 'crear' | 'editar' | 'estado') {
    if (!user) return;
    const grupo = String(categoria).toUpperCase() === 'ESPECIAL' ? 'especiales' : 'generales';
    if (!tienePermiso(user, `catalogo.${grupo}.${accion}`)) {
      throw new ForbiddenException(`Tu rol no puede ${accion === 'crear' ? 'crear' : accion === 'editar' ? 'editar' : 'activar o desactivar'} servicios ${grupo}.`);
    }
  }

  async createServicio(dto: CreateCatalogoServicioDto, user?: any) {
    this.exigir(user, dto.categoria, 'crear');
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
        precio: 0, // el precio lo fija «Fijar precios por agencia», nunca el formulario del catálogo
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

  async updateServicio(dto: UpdateCatalogoServicioDto, user?: any) {
    const existing = await this.prisma.catalogoServicio.findUnique({
      where: { id: dto.id },
    });
    if (!existing) {
      throw new NotFoundException(`Servicio de catálogo con ID ${dto.id} no encontrado`);
    }
    this.exigir(user, existing.categoria, 'editar');
    if (dto.categoria && dto.categoria.trim().toUpperCase() !== existing.categoria) this.exigir(user, dto.categoria, 'editar');
    if (CODIGOS_RETOQUE.includes(existing.codigo)) {
      const cambiaCodigo = !!dto.codigo && dto.codigo.trim().toUpperCase() !== existing.codigo;
      const cambiaCategoria = !!dto.categoria && dto.categoria.trim().toUpperCase() !== existing.categoria;
      if (cambiaCodigo || cambiaCategoria) {
        throw new BadRequestException('El servicio de retoque es parte de la configuración del sistema: no se puede cambiar su código ni su categoría.');
      }
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
        ...(dto.tiempoEstimadoMin !== undefined && {
          tiempoEstimadoMin: Math.max(1, Math.round(Number(dto.tiempoEstimadoMin) || 30)),
        }),
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

  async cambiarEstadoServicio(id: number, user?: any) {
    const existing = await this.prisma.catalogoServicio.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Servicio de catálogo con ID ${id} no encontrado`);
    }
    this.exigir(user, existing.categoria, 'estado');
    if (CODIGOS_RETOQUE.includes(existing.codigo) && existing.estado === 'Activo') {
      throw new BadRequestException('El servicio de retoque es parte de la configuración del sistema: no se puede desactivar.');
    }
    const estado = existing.estado === 'Activo' ? 'Inactivo' : 'Activo';
    return this.prisma.catalogoServicio.update({ where: { id }, data: { estado } });
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
