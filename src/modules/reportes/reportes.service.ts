import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolverAlcance, whereAgencias, type Alcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { tienePermiso, tieneAlgunPermiso } from '../../common/permisos/capacidades.js';
import {
  REPORTES,
  SEMAFOROS_5S,
  UBICACIONES_STOCK,
  columnasVisibles,
  reportePorId,
  type ColumnaDef,
  type FilaReporte,
  type ReporteDef,
  type TotalReporte,
} from './reportes.definiciones.js';
import { dividirRango, fechaEcuador, finDeDia, horaEcuador, inicioDeDia, resolverRango, type BloquePeriodo, type DivisionPeriodo, type RangoResuelto } from './reportes.periodos.js';
import type { GenerarReporteDto, RegistrarExportacionDto } from './dto/reportes.dto.js';

/** Desde cuántas filas la pantalla avisa antes de exportar (no es un tope: se puede exportar igual). */
export const UMBRALES_ADVERTENCIA = { PDF: 2000, EXCEL: 20000 } as const;

const ROLES_BITACORA = ['ADMIN', 'SUPER_ADMIN'];

interface AgenciaFila {
  id: string;
  codigo: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  numeroBahias: number;
  estado: number;
  tieneServiciosEspeciales: boolean;
  servicioIds: unknown;
  regionId: string | null;
  regionNombre: string;
  clienteNombre: string;
  responsable: string;
}

interface GrupoInfo {
  clave: string;
  titulo: string;
  tipo: 'AGENCIA' | 'BODEGA' | 'PULIDOR' | 'GENERAL';
  region: string;
  cliente: string;
  agencia: string;
  responsable: string;
}

interface Bruta {
  grupo: string;
  /** `YYYY-MM-DD` (Ecuador); solo en reportes por periodo. */
  fecha?: string;
  fila: FilaReporte;
}

interface Ctx {
  user: any;
  dto: GenerarReporteDto;
  def: ReporteDef;
  alcance: Alcance;
  agencias: AgenciaFila[];
  ids: string[];
  regionIds: string[];
  verPrecios: boolean;
  rango: RangoResuelto | null;
  gte: Date;
  lt: Date;
  grupos: Map<string, GrupoInfo>;
  /** Con filtros de agencia o cliente solo se listan agencias; sin ellos se suman bodegas y pulidores móviles. */
  incluyeBodegas: boolean;
}

const nombreDe = (u?: { name?: string | null; lastname?: string | null } | null): string => (u ? `${u.name ?? ''} ${u.lastname ?? ''}`.trim() : '');
const titulo = (s?: string | null): string => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1).toLowerCase().replace(/_/g, ' ')}` : '');
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const dinero = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
const unicos = (xs: (string | null | undefined)[]): string[] => [...new Set(xs.filter((x): x is string => !!x))];

const NIVELES: Record<string, string> = { BAJO: 'Bajo', CRITICO: 'Crítico', AGOTADO: 'Agotado' };
const SEMAFORO_ETIQUETA: Record<string, string> = { VERDE: 'Verde', AMARILLO: 'Amarillo', ROJO: 'Rojo' };
const ESTADO_MAQUINA: Record<string, string> = { OPERATIVA: 'Operativa', EN_MANTENIMIENTO: 'En mantenimiento', DE_BAJA: 'De baja' };
const FORMATOS_5S: Record<string, string> = { LISTA_20: 'Lista de 20 criterios', PUNTOS_25: 'Puntos de 25 criterios', SI_NO_50: 'Cuestionario SI/NO' };
const MOVIMIENTOS_KARDEX: Record<string, string> = {
  CONSUMO_SERVICIO: 'Consumo en servicio',
  COMPRA_INGRESO: 'Compra (ingreso)',
  DESPACHO_SALIDA: 'Despacho (salida)',
  DESPACHO_ENTRADA: 'Despacho (entrada)',
  AJUSTE_MERMA: 'Ajuste / merma',
};

/** SI si el servicio se realizó, NO si no se realizó, vacío mientras sigue en curso. */
const marcaServicioGeneral = (estado: string): string => (estado === 'FINALIZADO' || estado === 'APROBADO' ? 'SI' : estado === 'CANCELADO' || estado === 'RECHAZADO' ? 'NO' : '');
const marcaServicioEspecial = (estado: string): string => (estado === 'Completado' ? 'SI' : estado === 'Cancelado' ? 'NO' : '');
/** Aprobación gerencial de un servicio general: SI aprobado, NO rechazado, vacío si aún no se decide. */
const aprobacionGeneral = (estado: string): string => (estado === 'APROBADO' ? 'SI' : estado === 'RECHAZADO' ? 'NO' : '');

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------------------------------------------------
  // Permisos
  // ---------------------------------------------------------------------------------------------------------------------

  /** Un reporte se ve solo si el rol tiene activo el módulo al que pertenece (y, si hace falta, los precios). */
  private puedeVer(def: ReporteDef, user: any): boolean {
    if (!tieneAlgunPermiso(user, def.permisos)) return false;
    return (def.permisosTodos ?? []).every((p) => tienePermiso(user, p));
  }

  private definicionAccesible(id: string, user: any): ReporteDef {
    const def = reportePorId(id);
    if (!def) throw new NotFoundException('El reporte no existe.');
    if (!this.puedeVer(def, user)) throw new ForbiddenException('Tu rol no tiene activo el módulo de este reporte.');
    return def;
  }

  /** Reportes que el usuario puede sacar, con sus columnas y filtros (sin las funciones de totales). */
  catalogo(user: any) {
    const verPrecios = tienePermiso(user, 'precios.ver');
    return REPORTES.filter((r) => this.puedeVer(r, user)).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      modulo: r.modulo,
      descripcion: r.descripcion,
      periodo: r.periodo,
      agrupar: r.agrupar,
      plantilla: r.plantilla,
      extras: r.extras,
      estados: r.estados ?? [],
      ubicaciones: r.extras.includes('ubicacion') ? UBICACIONES_STOCK : [],
      semaforos: r.extras.includes('semaforo') ? SEMAFOROS_5S : [],
      columnas: columnasVisibles(r, verPrecios),
    }));
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Opciones de los filtros (siempre dentro del alcance del usuario)
  // ---------------------------------------------------------------------------------------------------------------------

  async opciones(user: any) {
    const alcance = resolverAlcance(user);
    const agencias = await this.prisma.agencia.findMany({
      where: whereAgencias(alcance) as any,
      select: { id: true, codigo: true, nombre: true, estado: true, regionId: true, clienteId: true },
      orderBy: { nombre: 'asc' },
    });
    const regionIds = unicos(agencias.map((a) => a.regionId));
    const clienteIds = unicos(agencias.map((a) => a.clienteId));
    const ids = agencias.map((a) => a.id);

    const [regiones, clientes] = await Promise.all([
      regionIds.length ? this.prisma.region.findMany({ where: { id: { in: regionIds } }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }) : [],
      clienteIds.length ? this.prisma.cliente.findMany({ where: { id: { in: clienteIds } }, select: { id: true, nombre: true }, orderBy: { nombre: 'asc' } }) : [],
    ]);

    const verInsumos = tienePermiso(user, 'inventario.ver');
    const verServicios = tienePermiso(user, 'servicios.ver');
    const [productos, lavadores] = await Promise.all([
      verInsumos ? this.prisma.insumo.findMany({ where: { estado: 1 }, select: { id: true, codigoSKU: true, nombre: true }, orderBy: { nombre: 'asc' } }) : [],
      verServicios && ids.length
        ? this.prisma.user.findMany({
            where: { agenciaId: { in: ids }, role: { namerol: { in: ['LAVADOR', 'LIDER', 'BACKUP'] } } },
            select: { id: true, name: true, lastname: true, agenciaId: true },
            orderBy: { name: 'asc' },
          })
        : [],
    ]);

    return {
      regiones,
      clientes,
      agencias: agencias.map((a) => ({ id: a.id, codigo: a.codigo, nombre: a.nombre, activa: a.estado === 1, regionId: a.regionId, clienteId: a.clienteId })),
      productos: productos.map((p) => ({ id: p.id, nombre: `${p.nombre} (${p.codigoSKU})` })),
      lavadores: lavadores.map((l) => ({ id: l.id, nombre: nombreDe(l), agenciaId: l.agenciaId })),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Generación
  // ---------------------------------------------------------------------------------------------------------------------

  async generar(dto: GenerarReporteDto, user: any) {
    const def = this.definicionAccesible(dto.reporteId, user);
    this.validarFiltros(def, dto);

    let rango: RangoResuelto | null = null;
    if (def.periodo) {
      if (!dto.periodo) throw new BadRequestException('Elige el periodo del reporte.');
      try {
        rango = resolverRango(dto.periodo);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }

    const alcance = resolverAlcance(user);
    const agencias = await this.agenciasDelFiltro(alcance, dto);
    const verPrecios = tienePermiso(user, 'precios.ver');
    const regionIds = unicos(agencias.map((a) => a.regionId));

    const grupos = new Map<string, GrupoInfo>();
    for (const a of agencias) {
      grupos.set(a.id, { clave: a.id, titulo: a.nombre, tipo: 'AGENCIA', region: a.regionNombre, cliente: a.clienteNombre, agencia: a.nombre, responsable: a.responsable });
    }

    const ctx: Ctx = {
      user,
      dto,
      def,
      alcance,
      agencias,
      ids: agencias.map((a) => a.id),
      regionIds,
      verPrecios,
      rango,
      gte: rango ? inicioDeDia(rango.desde) : new Date(0),
      lt: rango ? finDeDia(rango.hasta) : new Date(0),
      grupos,
      incluyeBodegas: !dto.agenciaIds?.length && !dto.clienteId,
    };

    const brutas = ctx.ids.length || def.id === 'insumos-inventario' ? await this.consultar(ctx) : [];
    const columnas = columnasVisibles(def, verPrecios);
    const { grupos: salida, totales, totalFilas, division } = this.armar(ctx, brutas, columnas);

    return {
      reporte: { id: def.id, nombre: def.nombre, modulo: def.modulo, plantilla: def.plantilla, periodo: def.periodo, agrupar: def.agrupar },
      generadoEn: new Date().toISOString(),
      generadoPor: nombreDe(user),
      filtros: this.etiquetasDeFiltros(ctx, rango, division),
      columnas,
      grupos: salida,
      totales,
      totalFilas,
      umbrales: UMBRALES_ADVERTENCIA,
    };
  }

  private validarFiltros(def: ReporteDef, dto: GenerarReporteDto): void {
    if (dto.estado && def.estados && !def.estados.some((e) => e.valor === dto.estado)) throw new BadRequestException('El estado elegido no es válido para este reporte.');
    if (def.id === 'kardex' && !dto.productoId) throw new BadRequestException('Elige el producto del kardex.');
  }

  private async agenciasDelFiltro(alcance: Alcance, dto: GenerarReporteDto): Promise<AgenciaFila[]> {
    // El alcance del usuario siempre manda: un id de fuera de él simplemente no devuelve nada.
    const condiciones: Record<string, unknown>[] = [whereAgencias(alcance)];
    if (dto.regionId) condiciones.push({ regionId: dto.regionId });
    if (dto.clienteId) condiciones.push({ clienteId: dto.clienteId });
    if (dto.agenciaIds?.length) condiciones.push({ id: { in: dto.agenciaIds } });

    const filas = await this.prisma.agencia.findMany({
      where: { AND: condiciones } as any,
      include: {
        regionRel: { select: { nombre: true } },
        cliente: { select: { nombre: true } },
        usuarios: { where: { role: { namerol: 'APROBADOR' } }, select: { name: true, lastname: true }, take: 1 },
      },
      orderBy: { nombre: 'asc' },
    });
    return filas.map((a: any) => ({
      id: a.id,
      codigo: a.codigo,
      nombre: a.nombre,
      direccion: a.direccion,
      telefono: a.telefono,
      numeroBahias: a.numeroBahias,
      estado: a.estado,
      tieneServiciosEspeciales: a.tieneServiciosEspeciales,
      servicioIds: a.servicioIds,
      regionId: a.regionId,
      regionNombre: a.regionRel?.nombre ?? a.region ?? '',
      clienteNombre: a.cliente?.nombre ?? '',
      responsable: nombreDe(a.usuarios?.[0]) || 'Sin asignar',
    }));
  }

  private consultar(ctx: Ctx): Promise<Bruta[]> {
    switch (ctx.def.id) {
      case 'agencias-listado': return this.agenciasListado(ctx);
      case 'lavadores-listado': return this.lavadoresListado(ctx);
      case 'servicios-generales': return this.serviciosGenerales(ctx);
      case 'servicios-especiales': return this.serviciosEspeciales(ctx);
      case 'catalogo-precios': return this.catalogoPrecios(ctx);
      case 'maquinaria-asignada': return this.maquinariaAsignada(ctx);
      case 'incidentes': return this.incidentes(ctx);
      case 'mantenimientos': return this.mantenimientos(ctx);
      case 'insumos-inventario': return this.insumosInventario(ctx);
      case 'stock-ubicacion': return this.stockUbicacion(ctx);
      case 'alertas-stock': return this.alertasStock(ctx);
      case 'kardex': return this.kardex(ctx);
      case 'informes-inspeccion': return this.informes(ctx);
      case 'auditorias-5s': return this.auditorias5s(ctx);
      default: throw new NotFoundException('El reporte no existe.');
    }
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Armado: agencia, luego periodo y luego filas, con totales en cada nivel
  // ---------------------------------------------------------------------------------------------------------------------

  private armar(ctx: Ctx, brutas: Bruta[], columnas: ColumnaDef[]) {
    const { def } = ctx;
    const conPrecios = (t: TotalReporte[]) => (ctx.verPrecios ? t : t.filter((x) => x.tipo !== 'dinero'));
    const totalizar = (filas: FilaReporte[]) => conPrecios(def.totales(filas));
    const visibles = new Set(columnas.map((c) => c.clave));
    const limpiar = (f: FilaReporte): FilaReporte => Object.fromEntries(Object.entries(f).filter(([k]) => visibles.has(k)));

    const porGrupo = new Map<string, Bruta[]>();
    for (const b of brutas) {
      const clave = def.agrupar === 'UNICO' ? 'unico' : b.grupo;
      if (!porGrupo.has(clave)) porGrupo.set(clave, []);
      porGrupo.get(clave)!.push(b);
    }

    let bloquesDef: BloquePeriodo[] = [];
    let division: DivisionPeriodo | null = null;
    if (def.periodo && ctx.rango) {
      const r = dividirRango(ctx.rango);
      bloquesDef = r.bloques;
      division = r.division;
    }

    const claves = [...porGrupo.keys()].sort((a, b) => (ctx.grupos.get(a)?.titulo ?? '').localeCompare(ctx.grupos.get(b)?.titulo ?? '', 'es'));
    const grupos = claves.map((clave) => {
      const info: GrupoInfo = def.agrupar === 'UNICO' ? { clave: 'unico', titulo: def.nombre, tipo: 'GENERAL', region: '', cliente: '', agencia: '', responsable: '' } : (ctx.grupos.get(clave) ?? { clave, titulo: clave, tipo: 'GENERAL', region: '', cliente: '', agencia: '', responsable: '' });
      const filasGrupo = porGrupo.get(clave)!;

      const bloques = (def.periodo ? bloquesDef : [{ clave: 'todo', etiqueta: '', desde: '', hasta: '' }])
        .map((bl) => {
          const propias = def.periodo ? filasGrupo.filter((b) => !!b.fecha && b.fecha >= bl.desde && b.fecha <= bl.hasta) : filasGrupo;
          const filas = propias.map((b, i) => ({ ...b.fila, ord: i + 1 }));
          return { clave: bl.clave, etiqueta: bl.etiqueta, filas: filas.map(limpiar), totales: totalizar(filas) };
        })
        .filter((bl) => bl.filas.length > 0);

      return { ...info, bloques, totales: totalizar(filasGrupo.map((b) => b.fila)) };
    });

    const todas = brutas.map((b) => b.fila);
    return { grupos, totales: totalizar(todas), totalFilas: todas.length, division };
  }

  private etiquetasDeFiltros(ctx: Ctx, rango: RangoResuelto | null, division: DivisionPeriodo | null) {
    const { dto, def, agencias } = ctx;
    const nombres = (xs: string[]) => (xs.length ? xs.join(', ') : 'Todas');
    const extras: { etiqueta: string; valor: string }[] = [];
    if (dto.estado) extras.push({ etiqueta: 'Estado', valor: def.estados?.find((e) => e.valor === dto.estado)?.etiqueta ?? dto.estado });
    if (dto.ubicacion) extras.push({ etiqueta: 'Ubicación', valor: UBICACIONES_STOCK.find((u) => u.valor === dto.ubicacion)?.etiqueta ?? dto.ubicacion });
    if (dto.semaforo) extras.push({ etiqueta: 'Semáforo', valor: SEMAFORO_ETIQUETA[dto.semaforo] });
    return {
      region: dto.regionId ? nombres(unicos(agencias.map((a) => a.regionNombre))) : 'Todas',
      cliente: dto.clienteId ? nombres(unicos(agencias.map((a) => a.clienteNombre))) : 'Todos',
      agencias: dto.agenciaIds?.length ? nombres(agencias.map((a) => a.nombre)) : `Todas (${agencias.length})`,
      periodo: rango ? rango.etiqueta : 'Datos actuales',
      division,
      extras,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Consultas por reporte
  // ---------------------------------------------------------------------------------------------------------------------

  private async agenciasListado(ctx: Ctx): Promise<Bruta[]> {
    return ctx.agencias.map((a) => ({
      grupo: 'unico',
      fila: {
        codigo: a.codigo,
        agencia: a.nombre,
        region: a.regionNombre,
        cliente: a.clienteNombre,
        direccion: a.direccion ?? '',
        telefono: a.telefono ?? '',
        responsable: a.responsable,
        bahias: a.numeroBahias,
        especiales: a.tieneServiciosEspeciales ? 'Sí' : 'No',
        estado: a.estado === 1 ? 'Activa' : 'Inactiva',
      },
    }));
  }

  private async lavadoresListado(ctx: Ctx): Promise<Bruta[]> {
    const usuarios = await this.prisma.user.findMany({
      where: { agenciaId: { in: ctx.ids }, role: { namerol: { in: ['LAVADOR', 'LIDER', 'BACKUP'] } } },
      select: { id: true, name: true, lastname: true, estado: true, agenciaId: true, role: { select: { namerol: true } } },
      orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
    });
    const bahias = await this.prisma.bahiaOperador.findMany({
      where: { operadorId: { in: usuarios.map((u) => u.id) }, activo: true },
      select: { operadorId: true, bahia: { select: { nombre: true } } },
    });
    const bahiaDe = new Map(bahias.map((b) => [b.operadorId, b.bahia.nombre]));
    return usuarios.map((u) => ({
      grupo: u.agenciaId!,
      fila: { nombre: nombreDe(u), rol: titulo(u.role?.namerol), bahia: bahiaDe.get(u.id) ?? '', estado: u.estado === 1 ? 'Activo' : 'Inactivo' },
    }));
  }

  private async serviciosGenerales(ctx: Ctx): Promise<Bruta[]> {
    const { dto } = ctx;
    const filas = await this.prisma.servicioLavado.findMany({
      where: {
        deletedAt: null,
        bahia: { agenciaId: { in: ctx.ids } },
        horaIngreso: { gte: ctx.gte, lt: ctx.lt },
        ...(dto.estado ? { estado: dto.estado as any } : {}),
        ...(dto.lavadorId ? { OR: [{ operadorId: dto.lavadorId }, { operadoresAsignados: { some: { operadorId: dto.lavadorId } } }] } : {}),
      },
      select: {
        ordenTrabajoOT: true, placa: true, marca: true, modelo: true, color: true, estado: true, precio: true, observaciones: true, horaIngreso: true, horaSalida: true, aprobadoPor: true,
        bahia: { select: { agenciaId: true } },
        catalogo: { select: { nombre: true } },
        operador: { select: { name: true, lastname: true } },
        operadoresAsignados: { select: { operador: { select: { name: true, lastname: true } } } },
      },
      orderBy: { horaIngreso: 'asc' },
    });
    return filas.map((s) => {
      const asignados = s.operadoresAsignados.map((o) => nombreDe(o.operador)).filter(Boolean);
      return {
        grupo: s.bahia.agenciaId,
        fecha: fechaEcuador(s.horaIngreso),
        fila: {
          fecha: fechaEcuador(s.horaIngreso),
          horaIngreso: horaEcuador(s.horaIngreso),
          horaSalida: s.horaSalida ? horaEcuador(s.horaSalida) : '',
          ot: s.ordenTrabajoOT ?? '',
          placa: s.placa,
          marca: s.marca ?? '',
          modelo: s.modelo ?? '',
          color: s.color ?? '',
          servicio: s.catalogo?.nombre ?? '',
          lavador: asignados.length ? asignados.join(', ') : nombreDe(s.operador),
          observacion: s.observaciones ?? '',
          realizado: marcaServicioGeneral(s.estado),
          aprobado: aprobacionGeneral(s.estado),
          aprobadoPor: aprobacionGeneral(s.estado) ? (s.aprobadoPor ?? '') : '',
          precio: dinero(s.precio),
          firma: '',
        },
      };
    });
  }

  private async serviciosEspeciales(ctx: Ctx): Promise<Bruta[]> {
    const { dto } = ctx;
    const filas = await this.prisma.servicioEspecial.findMany({
      where: {
        deletedAt: null,
        agenciaId: { in: ctx.ids },
        OR: [{ fechaProgramada: { gte: ctx.gte, lt: ctx.lt } }, { fechaProgramada: null, createdAt: { gte: ctx.gte, lt: ctx.lt } }],
        ...(dto.estado ? { estado: dto.estado } : {}),
      },
      select: {
        id: true, codigoSE: true, ordenTrabajoOT: true, tipoServicio: true, placa: true, marca: true, modelo: true, color: true, estado: true, precio: true, agenciaId: true,
        observaciones: true, creadoPorNombre: true, fechaProgramada: true, createdAt: true, horaIngreso: true, fechaInicio: true, fechaFin: true,
      },
      orderBy: [{ fechaProgramada: 'asc' }, { createdAt: 'asc' }],
    });
    // La decisión vigente de cada servicio especial es la última que quedó registrada en la auditoría de decisiones.
    const decisiones = filas.length
      ? await this.prisma.auditoriaDecision.findMany({
          where: { entidad: 'SERVICIO_ESPECIAL', entidadId: { in: filas.map((f) => f.id) }, accion: { in: ['APROBAR', 'RECHAZAR', 'ANULAR', 'EDITAR_APROBADO'] } },
          select: { entidadId: true, accion: true, usuarioNombre: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const vigente = new Map(decisiones.map((d) => [d.entidadId, d]));
    return filas.map((s) => {
      const dia = fechaEcuador(s.fechaProgramada ?? s.createdAt);
      const decision = vigente.get(s.id);
      const aprobado = decision ? (decision.accion === 'APROBAR' || decision.accion === 'EDITAR_APROBADO' ? 'SI' : 'NO') : '';
      return {
        grupo: s.agenciaId!,
        fecha: dia,
        fila: {
          fecha: dia,
          horaIngreso: s.horaIngreso || (s.fechaInicio ? horaEcuador(s.fechaInicio) : ''),
          horaSalida: s.fechaFin ? horaEcuador(s.fechaFin) : '',
          ot: s.ordenTrabajoOT || s.codigoSE,
          placa: s.placa,
          marca: s.marca ?? '',
          modelo: s.modelo ?? '',
          color: s.color ?? '',
          servicio: s.tipoServicio,
          asesor: s.creadoPorNombre ?? '',
          observacion: s.observaciones ?? '',
          realizado: marcaServicioEspecial(s.estado),
          aprobado,
          aprobadoPor: decision?.usuarioNombre ?? '',
          precio: dinero(s.precio),
          firma: '',
        },
      };
    });
  }

  private async catalogoPrecios(ctx: Ctx): Promise<Bruta[]> {
    const [servicios, precios] = await Promise.all([
      this.prisma.catalogoServicio.findMany({ where: { estado: 'Activo' }, orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }] }),
      this.prisma.precioAgenciaServicio.findMany({ where: { agenciaId: { in: ctx.ids } }, select: { agenciaId: true, catalogoServicioId: true, precio: true } }),
    ]);
    const propio = new Map(precios.map((p) => [`${p.agenciaId}:${p.catalogoServicioId}`, p.precio]));
    const salida: Bruta[] = [];
    for (const a of ctx.agencias) {
      const ofrecidos = Array.isArray(a.servicioIds) ? new Set((a.servicioIds as unknown[]).map(Number)) : null;
      for (const s of servicios) {
        if (ofrecidos && ofrecidos.size && !ofrecidos.has(s.id)) continue;
        const especifico = s.categoria === 'GENERAL' ? propio.get(`${a.id}:${s.id}`) : undefined;
        salida.push({
          grupo: a.id,
          fila: {
            codigo: s.codigo,
            servicio: s.nombre,
            categoria: titulo(s.categoria),
            tiempo: s.tiempoEstimadoMin,
            precioGlobal: dinero(s.precio),
            precioAgencia: especifico === undefined ? null : dinero(especifico),
            precioVigente: dinero(especifico ?? s.precio),
            origen: especifico === undefined ? 'General' : 'Agencia',
          },
        });
      }
    }
    return salida;
  }

  private async maquinariaAsignada(ctx: Ctx): Promise<Bruta[]> {
    const filas = await this.prisma.maquinaria.findMany({
      where: { agenciaId: { in: ctx.ids }, activa: true },
      include: { bahia: { select: { nombre: true } }, operadorAsignado: { select: { name: true, lastname: true } } },
      orderBy: [{ tipo: 'asc' }, { codigo: 'asc' }],
    });
    return filas.map((m) => ({
      grupo: m.agenciaId!,
      fila: {
        codigo: m.codigo,
        nombre: m.nombre,
        tipo: titulo(m.tipo),
        marca: m.marca ?? '',
        modelo: m.modelo ?? '',
        serie: m.serie ?? '',
        bahia: m.bahia?.nombre ?? '',
        responsable: nombreDe(m.operadorAsignado),
        estado: ESTADO_MAQUINA[m.estadoOperativo] ?? titulo(m.estadoOperativo),
        horas: m.horasUso,
      },
    }));
  }

  private async incidentes(ctx: Ctx): Promise<Bruta[]> {
    const filas = await this.prisma.incidenteTecnico.findMany({
      where: { maquinaria: { agenciaId: { in: ctx.ids } }, fechaReporte: { gte: ctx.gte, lt: ctx.lt }, ...(ctx.dto.estado ? { estado: ctx.dto.estado } : {}) },
      include: {
        maquinaria: { select: { codigo: true, nombre: true, agenciaId: true } },
        reportadoPor: { select: { name: true, lastname: true } },
        tecnicoAsignado: { select: { name: true, lastname: true } },
      },
      orderBy: { fechaReporte: 'asc' },
    });
    return filas.map((i) => ({
      grupo: i.maquinaria.agenciaId!,
      fecha: fechaEcuador(i.fechaReporte),
      fila: {
        fecha: fechaEcuador(i.fechaReporte),
        maquina: `${i.maquinaria.codigo} · ${i.maquinaria.nombre}`,
        titulo: i.titulo,
        gravedad: titulo(i.gravedad),
        estado: titulo(i.estado),
        reportadoPor: nombreDe(i.reportadoPor),
        tecnico: nombreDe(i.tecnicoAsignado),
        fechaSolucion: i.fechaSolucion ? fechaEcuador(i.fechaSolucion) : '',
        costo: dinero(i.costoTotal),
      },
    }));
  }

  private async mantenimientos(ctx: Ctx): Promise<Bruta[]> {
    const filas = await this.prisma.mantenimientoMaquinaria.findMany({
      where: { maquinaria: { agenciaId: { in: ctx.ids } }, fechaMantenimiento: { gte: ctx.gte, lt: ctx.lt }, ...(ctx.dto.estado ? { estado: ctx.dto.estado } : {}) },
      include: { maquinaria: { select: { codigo: true, nombre: true, agenciaId: true } }, tecnico: { select: { name: true, lastname: true } } },
      orderBy: { fechaMantenimiento: 'asc' },
    });
    return filas.map((m) => ({
      grupo: m.maquinaria.agenciaId!,
      fecha: fechaEcuador(m.fechaMantenimiento),
      fila: {
        fecha: fechaEcuador(m.fechaMantenimiento),
        maquina: `${m.maquinaria.codigo} · ${m.maquinaria.nombre}`,
        tipo: titulo(m.tipo),
        estado: titulo(m.estado),
        tecnico: nombreDe(m.tecnico),
        observaciones: m.observaciones ?? '',
        proximo: m.proximoMantenimiento ? fechaEcuador(m.proximoMantenimiento) : '',
        costo: dinero(m.costoTotal),
      },
    }));
  }

  /**
   * Ubicaciones de stock que entran al reporte: las agencias del filtro y, si no se filtró por agencia ni cliente, también las
   * bodegas y los pulidores móviles de las regiones del alcance (y la bodega central solo para quien ve todo el país).
   */
  private async ubicacionesDeStock(ctx: Ctx) {
    const or: Record<string, unknown>[] = [{ agenciaId: { in: ctx.ids } }];
    let bodegas: { id: string; nombre: string; regionNombre: string }[] = [];
    if (ctx.incluyeBodegas) {
      const global = ctx.alcance.tipo === 'GLOBAL' && !ctx.dto.regionId;
      const lista = await this.prisma.bodega.findMany({
        where: { activa: true, OR: [{ regionId: { in: ctx.regionIds } }, ...(global ? [{ tipo: 'CENTRAL' as const }] : [])] },
        select: { id: true, nombre: true, region: { select: { nombre: true } } },
      });
      bodegas = lista.map((b) => ({ id: b.id, nombre: b.nombre, regionNombre: b.region?.nombre ?? '' }));
      if (bodegas.length) or.push({ bodegaId: { in: bodegas.map((b) => b.id) } });
      if (ctx.regionIds.length) or.push({ tipoUbicacion: 'PULIDOR_MOVIL', pulidor: { regionId: { in: ctx.regionIds } } });
    }
    return { or, bodegas };
  }

  private async insumosInventario(ctx: Ctx): Promise<Bruta[]> {
    const { or } = await this.ubicacionesDeStock(ctx);
    const [insumos, stocks] = await Promise.all([
      this.prisma.insumo.findMany({ select: { id: true, codigoSKU: true, nombre: true, categoria: true, costoUnitarioUSD: true, estado: true, unidadMedida: { select: { simbolo: true } } }, orderBy: [{ categoria: 'asc' }, { nombre: 'asc' }] }),
      ctx.ids.length || or.length > 1 ? this.prisma.stockUbicacion.groupBy({ by: ['insumoId'], where: { OR: or } as any, _sum: { cantidadActual: true } }) : [],
    ]);
    const total = new Map(stocks.map((s) => [s.insumoId, num(s._sum.cantidadActual)]));
    return insumos.map((i) => {
      const stock = Math.round((total.get(i.id) ?? 0) * 1000) / 1000;
      const costo = dinero(i.costoUnitarioUSD) ?? 0;
      return {
        grupo: 'unico',
        fila: {
          sku: i.codigoSKU,
          insumo: i.nombre,
          categoria: titulo(i.categoria),
          unidad: i.unidadMedida?.simbolo ?? '',
          stock,
          costo,
          valor: Math.round(stock * costo * 100) / 100,
          estado: i.estado === 1 ? 'Activo' : 'Inactivo',
        },
      };
    });
  }

  private async stockUbicacion(ctx: Ctx): Promise<Bruta[]> {
    const { or, bodegas } = await this.ubicacionesDeStock(ctx);
    const tipos = ctx.dto.ubicacion === 'AGENCIA' ? ['AGENCIA'] : ctx.dto.ubicacion === 'PULIDOR' ? ['PULIDOR_FIJO', 'PULIDOR_MOVIL'] : ctx.dto.ubicacion === 'BODEGA' ? ['BODEGA_CENTRAL'] : null;
    const filas = await this.prisma.stockUbicacion.findMany({
      where: { OR: or, ...(tipos ? { tipoUbicacion: { in: tipos as any } } : {}) } as any,
      include: {
        insumo: { select: { codigoSKU: true, nombre: true, unidadMedida: { select: { simbolo: true } } } },
        pulidor: { select: { name: true, lastname: true, regionId: true, region: { select: { nombre: true } } } },
        bodega: { select: { id: true, nombre: true } },
      },
      orderBy: { insumo: { nombre: 'asc' } },
    });
    for (const b of bodegas) ctx.grupos.set(`bodega:${b.id}`, { clave: `bodega:${b.id}`, titulo: `Bodega · ${b.nombre}`, tipo: 'BODEGA', region: b.regionNombre, cliente: '', agencia: '', responsable: '' });

    return filas.map((s) => {
      let grupo: string;
      let ubicacion: string;
      if (s.bodegaId && s.bodega) {
        grupo = `bodega:${s.bodega.id}`;
        ubicacion = `Bodega · ${s.bodega.nombre}`;
      } else if (s.tipoUbicacion === 'PULIDOR_MOVIL' && s.pulidorId) {
        grupo = `pulidor:${s.pulidorId}`;
        ubicacion = `Pulidor móvil · ${nombreDe(s.pulidor)}`;
        ctx.grupos.set(grupo, { clave: grupo, titulo: `Pulidor móvil · ${nombreDe(s.pulidor)}`, tipo: 'PULIDOR', region: s.pulidor?.region?.nombre ?? '', cliente: '', agencia: '', responsable: nombreDe(s.pulidor) });
      } else {
        grupo = s.agenciaId ?? 'sin-agencia';
        ubicacion = s.tipoUbicacion === 'PULIDOR_FIJO' ? `Pulidor fijo · ${nombreDe(s.pulidor)}` : 'Agencia';
      }
      const minimo = num(s.cantidadMinima);
      const cantidad = num(s.cantidadActual);
      return {
        grupo,
        fila: { sku: s.insumo.codigoSKU, insumo: s.insumo.nombre, ubicacion, unidad: s.insumo.unidadMedida?.simbolo ?? '', cantidad, minimo, situacion: minimo > 0 && cantidad <= minimo ? 'Bajo mínimo' : 'Normal' },
      };
    });
  }

  private async alertasStock(ctx: Ctx): Promise<Bruta[]> {
    const or: Record<string, unknown>[] = [{ agenciaId: { in: ctx.ids } }];
    if (ctx.incluyeBodegas && ctx.regionIds.length) or.push({ pulidor: { regionId: { in: ctx.regionIds } } });
    const filas = await this.prisma.alertaStock.findMany({
      where: { OR: or, estado: ctx.dto.estado ? (ctx.dto.estado as any) : { in: ['PENDIENTE', 'EN_PROCESO'] } } as any,
      include: {
        insumo: { select: { nombre: true } },
        usuarioEmisor: { select: { name: true, lastname: true } },
        pulidor: { select: { name: true, lastname: true, region: { select: { nombre: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return filas.map((a) => {
      let grupo = a.agenciaId ?? '';
      if (!a.agenciaId && a.pulidorId) {
        grupo = `pulidor:${a.pulidorId}`;
        ctx.grupos.set(grupo, { clave: grupo, titulo: `Pulidor · ${nombreDe(a.pulidor)}`, tipo: 'PULIDOR', region: a.pulidor?.region?.nombre ?? '', cliente: '', agencia: '', responsable: nombreDe(a.pulidor) });
      }
      return {
        grupo,
        fila: { fecha: fechaEcuador(a.createdAt), insumo: a.insumo.nombre, nivel: NIVELES[a.nivel] ?? titulo(a.nivel), estado: titulo(a.estado), stock: a.stockReportado === null ? null : num(a.stockReportado), emisor: nombreDe(a.usuarioEmisor), mensaje: a.mensaje ?? '' },
      };
    });
  }

  private async kardex(ctx: Ctx): Promise<Bruta[]> {
    const insumo = await this.prisma.insumo.findUnique({ where: { id: ctx.dto.productoId! }, select: { id: true } });
    if (!insumo) throw new NotFoundException('El producto no existe.');
    const { bodegas } = await this.ubicacionesDeStock(ctx);
    const ubicaciones = [...ctx.ids, ...bodegas.map((b) => b.id)];
    for (const b of bodegas) ctx.grupos.set(b.id, { clave: b.id, titulo: `Bodega · ${b.nombre}`, tipo: 'BODEGA', region: b.regionNombre, cliente: '', agencia: '', responsable: '' });
    if (!ubicaciones.length) return [];

    const filas = await this.prisma.kardexMovimiento.findMany({
      where: { insumoId: insumo.id, ubicacionId: { in: ubicaciones }, fecha: { gte: ctx.gte, lt: ctx.lt } },
      include: { usuario: { select: { name: true, lastname: true } } },
      orderBy: { fecha: 'asc' },
    });
    return filas.map((k) => ({
      grupo: k.ubicacionId,
      fecha: fechaEcuador(k.fecha),
      fila: {
        fecha: fechaEcuador(k.fecha),
        hora: horaEcuador(k.fecha),
        movimiento: MOVIMIENTOS_KARDEX[k.tipoMovimiento] ?? titulo(k.tipoMovimiento),
        cantidad: num(k.cantidad),
        anterior: num(k.stockAnterior),
        posterior: num(k.stockPosterior),
        costo: dinero(k.costoTotal),
        usuario: nombreDe(k.usuario),
      },
    }));
  }

  private async informes(ctx: Ctx): Promise<Bruta[]> {
    const desde = new Date(`${ctx.rango!.desde}T00:00:00Z`);
    const hasta = new Date(`${ctx.rango!.hasta}T00:00:00Z`);
    const filas = await this.prisma.informeInspeccion.findMany({
      where: { deletedAt: null, agenciaId: { in: ctx.ids }, fecha: { gte: desde, lte: hasta }, ...(ctx.dto.estado ? { estado: ctx.dto.estado } : {}) },
      include: { inspector: { select: { name: true, lastname: true } } },
      orderBy: [{ fecha: 'asc' }, { numero: 'asc' }],
    });
    return filas.map((i) => {
      const dia = i.fecha.toISOString().slice(0, 10);
      return {
        grupo: i.agenciaId,
        fecha: dia,
        fila: { numero: i.numero, fecha: dia, tipo: titulo(i.tipoInspeccion), estado: titulo(i.estado), inspector: nombreDe(i.inspector), destinatario: i.destinatarioNombre, asunto: i.asunto, calificacion: titulo(i.calificacion) },
      };
    });
  }

  private async auditorias5s(ctx: Ctx): Promise<Bruta[]> {
    const desde = new Date(`${ctx.rango!.desde}T00:00:00Z`);
    const hasta = new Date(`${ctx.rango!.hasta}T00:00:00Z`);
    const filas = await this.prisma.auditoria5s.findMany({
      where: {
        deletedAt: null,
        agenciaId: { in: ctx.ids },
        fecha: { gte: desde, lte: hasta },
        ...(ctx.dto.estado ? { estado: ctx.dto.estado } : {}),
        ...(ctx.dto.semaforo ? { semaforo: ctx.dto.semaforo } : {}),
      },
      include: { auditor: { select: { name: true, lastname: true } } },
      orderBy: [{ fecha: 'asc' }, { codigo: 'asc' }],
    });
    return filas.map((a) => {
      const dia = a.fecha.toISOString().slice(0, 10);
      return {
        grupo: a.agenciaId,
        fecha: dia,
        fila: {
          codigo: a.codigo,
          fecha: dia,
          area: titulo(a.area),
          formato: FORMATOS_5S[a.formato] ?? a.formato,
          auditor: nombreDe(a.auditor),
          estado: titulo(a.estado),
          puntaje: a.puntaje,
          porcentaje: a.porcentaje === null ? null : Math.round(a.porcentaje * 10) / 10,
          semaforo: a.semaforo ? SEMAFORO_ETIQUETA[a.semaforo] ?? titulo(a.semaforo) : '',
        },
      };
    });
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Bitácora de exportaciones
  // ---------------------------------------------------------------------------------------------------------------------

  /** Deja constancia de una exportación. Vuelve a comprobar que el usuario puede sacar ese reporte en ese formato. */
  async registrarExportacion(dto: RegistrarExportacionDto, user: any): Promise<{ ok: true }> {
    this.definicionAccesible(dto.reporteId, user);
    if (!tienePermiso(user, dto.formato === 'EXCEL' ? 'reportes.excel' : 'reportes.pdf')) throw new ForbiddenException('Tu rol no puede exportar en este formato.');
    const { formato, totalFilas, ...filtros } = dto;
    await this.prisma.exportacionReporte.create({
      data: {
        usuarioId: String(user.id),
        usuarioNombre: nombreDe(user),
        rol: rolDeUsuario(user),
        reporte: dto.reporteId,
        formato,
        filtros: filtros as any,
        totalFilas: totalFilas ?? 0,
      },
    });
    return { ok: true };
  }

  /** Últimas exportaciones. Solo ADMIN y SUPER_ADMIN. */
  async bitacora(user: any, limite = 100) {
    if (!ROLES_BITACORA.includes(rolDeUsuario(user))) throw new ForbiddenException('La bitácora de exportaciones es solo para administradores.');
    return this.prisma.exportacionReporte.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limite, 1), 500) });
  }
}
