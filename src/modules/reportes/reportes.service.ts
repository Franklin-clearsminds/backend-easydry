import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
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
import { dividirRango, etiquetaDia, fechaEcuador, finDeDia, horaEcuador, inicioDeDia, resolverRango, type BloquePeriodo, type DivisionPeriodo, type RangoResuelto } from './reportes.periodos.js';
import type { GenerarReporteDto, RegistrarExportacionDto } from './dto/reportes.dto.js';
import { RetosService } from '../retos/retos.service.js';
import { ReportesArchivoService } from './reportes.archivo.js';
import { CacheService } from '../../common/cache/cache.service.js';

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
  tipo: 'AGENCIA' | 'BODEGA' | 'PULIDOR' | 'RETO' | 'GENERAL';
  /** Datos propios del grupo que van en el encabezado de su hoja (p. ej. los de un reto). */
  datos?: { etiqueta: string; valor: string }[];
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

/** Un servicio del periodo, reducido a lo que miden los reportes de productividad. */
interface ServicioProductivo {
  origen: 'GENERAL' | 'ESPECIAL';
  agenciaId: string;
  fecha: string;
  /** SI realizado, NO cancelado o rechazado, vacío si sigue en curso. */
  resultado: 'SI' | 'NO' | '';
  monto: number;
  minutos: number | null;
  operarios: string[];
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
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly retosService?: RetosService,
    /** Suma al reporte lo que ya se archivó a Parquet. Sin él, el reporte lee solo de la base. */
    @Optional() private readonly archivo?: ReportesArchivoService,
    /** Guarda unos minutos las opciones de filtro (catálogo, casi no cambia). Sin él, cada apertura de Reportes recalcula todo. */
    @Optional() private readonly cache?: CacheService,
  ) {}

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

  /**
   * Regiones, clientes y agencias van siempre; los productos, lavadores y pulidores (listas largas) solo si se piden en `incluir`
   * (la pantalla los pide cuando el reporte elegido tiene ese filtro). Sin `incluir` devuelve todo, como antes.
   */
  async opciones(user: any, incluir?: string[]) {
    const pide = new Set(incluir ?? ['productos', 'lavadores', 'pulidores']);
    if (!this.cache) return this.calcularOpciones(user, pide);
    const clave = `reportes:opciones:${user?.id ?? 'anonimo'}:${[...pide].sort().join(',')}`;
    return this.cache.obtenerOCalcular(clave, 300, () => this.calcularOpciones(user, pide));
  }

  private async calcularOpciones(user: any, pide: Set<string>) {
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

    const verInsumos = pide.has('productos') && tienePermiso(user, 'inventario.ver');
    const verServicios = pide.has('lavadores') && tienePermiso(user, 'servicios.ver');
    const verEspeciales = pide.has('pulidores') && tienePermiso(user, 'especiales.ver');
    const [productos, lavadores, pulidores] = await Promise.all([
      verInsumos ? this.prisma.insumo.findMany({ where: { estado: 1 }, select: { id: true, codigoSKU: true, nombre: true }, orderBy: { nombre: 'asc' } }) : [],
      verServicios && ids.length
        ? this.prisma.user.findMany({
            where: { agenciaId: { in: ids }, role: { namerol: { in: ['LAVADOR', 'LIDER', 'BACKUP', 'AUXILIAR'] } } },
            select: { id: true, name: true, lastname: true, agenciaId: true },
            orderBy: { name: 'asc' },
          })
        : [],
      // Pulidores fijos de las agencias del alcance y móviles de sus regiones.
      verEspeciales && (ids.length || regionIds.length)
        ? this.prisma.user.findMany({
            where: { role: { namerol: 'PULIDOR' }, OR: [{ agenciaId: { in: ids } }, { agenciaId: null, regionId: { in: regionIds } }] },
            select: { id: true, name: true, lastname: true, agenciaId: true, regionId: true },
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
      pulidores: pulidores.map((u) => ({ id: u.id, nombre: nombreDe(u), agenciaId: u.agenciaId, regionId: u.regionId })),
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
      filtros: await this.etiquetasDeFiltrosConPersonas(ctx, rango, division),
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
      select: {
        id: true,
        codigo: true,
        nombre: true,
        direccion: true,
        telefono: true,
        numeroBahias: true,
        estado: true,
        tieneServiciosEspeciales: true,
        servicioIds: true,
        regionId: true,
        region: true,
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
      case 'consumo-insumos-agencia': return this.consumoInsumosAgencia(ctx);
      case 'consumo-insumos-pulidor': return this.consumoInsumosPulidor(ctx);
      case 'retos': return this.retos(ctx);
      case 'productividad-agencias': return this.productividadAgencias(ctx);
      case 'productividad-operarios': return this.productividadOperarios(ctx);
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
    // `_id` no es una columna: lo usa la pantalla para exportar el documento de cada auditoría.
    const limpiar = (f: FilaReporte): FilaReporte => Object.fromEntries(Object.entries(f).filter(([k]) => visibles.has(k) || k === '_id'));

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

  /** Igual que `etiquetasDeFiltros`, y si se filtró por lavador o pulidor, con su nombre. */
  private async etiquetasDeFiltrosConPersonas(ctx: Ctx, rango: RangoResuelto | null, division: DivisionPeriodo | null) {
    const filtros = this.etiquetasDeFiltros(ctx, rango, division);
    const personas: Array<[string, string | undefined]> = [['Lavador', ctx.dto.lavadorId], ['Pulidor', ctx.dto.pulidorId]];
    for (const [etiqueta, id] of personas) {
      if (!id || !ctx.def.extras.includes(etiqueta === 'Lavador' ? 'lavador' : 'pulidor')) continue;
      const u = await this.prisma.user.findUnique({ where: { id }, select: { name: true, lastname: true } });
      filtros.extras.push({ etiqueta, valor: u ? nombreDe(u) : id });
    }
    return filtros;
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
      where: { agenciaId: { in: ctx.ids }, role: { namerol: { in: ['LAVADOR', 'LIDER', 'BACKUP', 'AUXILIAR'] } } },
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
    const deBase = await this.prisma.servicioLavado.findMany({
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
    const archivados = this.archivo ? await this.archivo.serviciosGenerales({ agenciaIds: ctx.ids, gte: ctx.gte, lt: ctx.lt, estado: dto.estado, lavadorId: dto.lavadorId }) : [];
    const filas = ([...deBase, ...archivados] as typeof deBase).sort((a, b) => a.horaIngreso.getTime() - b.horaIngreso.getTime());
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
    const deBase = await this.prisma.servicioEspecial.findMany({
      where: {
        deletedAt: null,
        agenciaId: { in: ctx.ids },
        OR: [{ fechaProgramada: { gte: ctx.gte, lt: ctx.lt } }, { fechaProgramada: null, createdAt: { gte: ctx.gte, lt: ctx.lt } }],
        ...(dto.estado ? { estado: dto.estado } : {}),
        ...(dto.pulidorId ? { AND: [{ OR: [{ operadorId: dto.pulidorId }, { operadoresAsignados: { some: { operadorId: dto.pulidorId } } }] }] } : {}),
      },
      select: {
        id: true, codigoSE: true, ordenTrabajoOT: true, tipoServicio: true, placa: true, marca: true, modelo: true, color: true, estado: true, precio: true, agenciaId: true,
        observaciones: true, creadoPorNombre: true, fechaProgramada: true, createdAt: true, horaIngreso: true, fechaInicio: true, fechaFin: true,
      },
      orderBy: [{ fechaProgramada: 'asc' }, { createdAt: 'asc' }],
    });
    const archivados = this.archivo ? await this.archivo.serviciosEspeciales({ agenciaIds: ctx.ids, gte: ctx.gte, lt: ctx.lt, estado: dto.estado, pulidorId: dto.pulidorId }) : [];
    // Mismo orden que la base: por fecha programada (las vacías al final) y luego por creación.
    const filas = ([...deBase, ...archivados] as typeof deBase).sort((a, b) => (a.fechaProgramada?.getTime() ?? Infinity) - (b.fechaProgramada?.getTime() ?? Infinity) || a.createdAt.getTime() - b.createdAt.getTime());
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

    const deBase = await this.prisma.kardexMovimiento.findMany({
      where: { insumoId: insumo.id, ubicacionId: { in: ubicaciones }, fecha: { gte: ctx.gte, lt: ctx.lt } },
      include: { usuario: { select: { name: true, lastname: true } } },
      orderBy: { fecha: 'asc' },
    });
    const archivados = this.archivo ? await this.archivo.kardex({ insumoId: insumo.id, ubicaciones, gte: ctx.gte, lt: ctx.lt }) : [];
    const filas = ([...deBase, ...archivados] as typeof deBase).sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
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

  /** Líneas de consumo del periodo (servicios generales y especiales), de la base y del archivo, con el insumo ya identificado. */
  private async lineasDeConsumo(ctx: Ctx) {
    const rangoFecha = { gte: ctx.gte, lt: ctx.lt };
    const conSinAgencia = ctx.incluyeBodegas && ctx.regionIds.length > 0;
    const [generalesBase, especialesBase] = await Promise.all([
      this.prisma.consumoServicio.findMany({
        where: { createdAt: rangoFecha, agenciaId: { in: ctx.ids } },
        select: { insumoId: true, cantidadUsada: true, agenciaId: true, servicioId: true, createdAt: true, insumoNombre: true, insumoSKU: true, unidadSimbolo: true },
      }),
      this.prisma.consumoServicioEspecial.findMany({
        where: {
          createdAt: rangoFecha,
          servicioEspecial: { OR: [{ agenciaId: { in: ctx.ids } }, ...(conSinAgencia ? [{ agenciaId: null, regionId: { in: ctx.regionIds } }] : [])] },
        },
        select: {
          insumoId: true, cantidadUsada: true, pulidorId: true, servicioEspecialId: true, createdAt: true, insumoNombre: true, insumoSKU: true, unidadSimbolo: true,
          servicioEspecial: { select: { agenciaId: true, regionId: true } },
        },
      }),
    ]);
    const [generalesArchivo, especialesArchivo] = this.archivo
      ? await Promise.all([
          this.archivo.consumosGenerales({ agenciaIds: ctx.ids, gte: ctx.gte, lt: ctx.lt }),
          this.archivo.consumosEspeciales({ agenciaIds: ctx.ids, regionIds: ctx.regionIds, incluirSinAgencia: conSinAgencia, gte: ctx.gte, lt: ctx.lt }),
        ])
      : [[], []];

    type Linea = { insumoId: string; cantidad: number; agenciaId: string | null; dia: string; servicioId: string; pulidorId: string | null; nombre: string; sku: string; unidad: string };
    const generales: Linea[] = [...generalesBase, ...generalesArchivo].map((l: any) => ({
      insumoId: l.insumoId, cantidad: num(l.cantidadUsada), agenciaId: l.agenciaId ?? null, dia: fechaEcuador(l.createdAt), servicioId: l.servicioId, pulidorId: null, nombre: l.insumoNombre, sku: l.insumoSKU, unidad: l.unidadSimbolo,
    }));
    const especiales: Linea[] = [...especialesBase, ...especialesArchivo].map((l: any) => ({
      insumoId: l.insumoId, cantidad: num(l.cantidadUsada), agenciaId: l.servicioEspecial ? (l.servicioEspecial.agenciaId ?? null) : (l.agenciaId ?? null), dia: fechaEcuador(l.createdAt), servicioId: l.servicioEspecialId, pulidorId: l.pulidorId ?? null, nombre: l.insumoNombre, sku: l.insumoSKU, unidad: l.unidadSimbolo,
    }));

    // Lo que la línea guardó al consumir (nombre, SKU y unidad de ese momento) manda; los maestros completan lo que falte.
    const ids = unicos([...generales, ...especiales].map((l) => l.insumoId));
    const maestros = new Map<string, { nombre: string; sku: string; unidad: string }>();
    for (let i = 0; i < ids.length; i += 1000) {
      for (const m of await this.prisma.insumo.findMany({ where: { id: { in: ids.slice(i, i + 1000) } }, select: { id: true, nombre: true, codigoSKU: true, unidadMedida: { select: { simbolo: true } } } })) {
        maestros.set(m.id, { nombre: m.nombre, sku: m.codigoSKU, unidad: m.unidadMedida?.simbolo ?? '' });
      }
    }
    const completa = (l: Linea): Linea => {
      const m = maestros.get(l.insumoId);
      return { ...l, nombre: l.nombre || m?.nombre || 'Insumo', sku: l.sku || m?.sku || '', unidad: l.unidad || m?.unidad || '' };
    };
    return { generales: generales.map(completa), especiales: especiales.map(completa) };
  }

  private redondear(n: number): number {
    return Math.round(n * 10000) / 10000;
  }

  /** En cada agencia y bloque del periodo, una fila por insumo con lo usado en servicios generales y en especiales. */
  private async consumoInsumosAgencia(ctx: Ctx): Promise<Bruta[]> {
    const { generales, especiales } = await this.lineasDeConsumo(ctx);
    const { bloques } = dividirRango(ctx.rango!);
    const salida: Bruta[] = [];
    for (const b of bloques) {
      for (const a of ctx.agencias) {
        const acumulado = new Map<string, { sku: string; insumo: string; unidad: string; generales: number; especiales: number; servicios: Set<string> }>();
        const acumular = (lineas: typeof generales, campo: 'generales' | 'especiales') => {
          for (const l of lineas) {
            if (l.agenciaId !== a.id || l.dia < b.desde || l.dia > b.hasta) continue;
            const fila = acumulado.get(l.insumoId) ?? { sku: l.sku, insumo: l.nombre, unidad: l.unidad, generales: 0, especiales: 0, servicios: new Set<string>() };
            fila[campo] += l.cantidad;
            fila.servicios.add(l.servicioId);
            acumulado.set(l.insumoId, fila);
          }
        };
        acumular(generales, 'generales');
        acumular(especiales, 'especiales');
        [...acumulado.values()]
          .sort((x, y) => x.insumo.localeCompare(y.insumo, 'es') || x.sku.localeCompare(y.sku))
          .forEach((f) =>
            salida.push({
              grupo: a.id,
              fecha: b.desde,
              fila: { sku: f.sku, insumo: f.insumo, unidad: f.unidad, generales: this.redondear(f.generales), especiales: this.redondear(f.especiales), total: this.redondear(f.generales + f.especiales), servicios: f.servicios.size },
            }),
          );
      }
    }
    return salida;
  }

  /** En cada agencia (y los pulidores móviles aparte) y bloque del periodo, una fila por pulidor e insumo con lo que usó en servicios especiales. */
  private async consumoInsumosPulidor(ctx: Ctx): Promise<Bruta[]> {
    const { especiales } = await this.lineasDeConsumo(ctx);
    const conSinAgencia = ctx.incluyeBodegas && ctx.regionIds.length > 0;
    const SIN_AGENCIA = 'sin-agencia';
    if (conSinAgencia) ctx.grupos.set(SIN_AGENCIA, { clave: SIN_AGENCIA, titulo: 'Pulidores móviles (sin agencia)', tipo: 'GENERAL', region: '', cliente: '', agencia: '', responsable: '' });
    const idsPulidores = unicos(especiales.map((l) => l.pulidorId));
    const usuarios = idsPulidores.length ? await this.prisma.user.findMany({ where: { id: { in: idsPulidores } }, select: { id: true, name: true, lastname: true } }) : [];
    const nombre = new Map(usuarios.map((u) => [u.id, nombreDe(u)]));
    const { bloques } = dividirRango(ctx.rango!);
    const claves = [...ctx.ids, ...(conSinAgencia ? [SIN_AGENCIA] : [])];
    const salida: Bruta[] = [];
    for (const b of bloques) {
      for (const clave of claves) {
        const acumulado = new Map<string, { pulidor: string; sku: string; insumo: string; unidad: string; cantidad: number; servicios: Set<string> }>();
        for (const l of especiales) {
          if ((l.agenciaId ?? SIN_AGENCIA) !== clave || l.dia < b.desde || l.dia > b.hasta) continue;
          const llave = `${l.pulidorId}|${l.insumoId}`;
          const fila = acumulado.get(llave) ?? { pulidor: (l.pulidorId && nombre.get(l.pulidorId)) || 'Sin nombre', sku: l.sku, insumo: l.nombre, unidad: l.unidad, cantidad: 0, servicios: new Set<string>() };
          fila.cantidad += l.cantidad;
          fila.servicios.add(l.servicioId);
          acumulado.set(llave, fila);
        }
        [...acumulado.values()]
          .sort((x, y) => x.pulidor.localeCompare(y.pulidor, 'es') || x.insumo.localeCompare(y.insumo, 'es'))
          .forEach((f) => salida.push({ grupo: clave, fecha: b.desde, fila: { pulidor: f.pulidor, sku: f.sku, insumo: f.insumo, unidad: f.unidad, cantidad: this.redondear(f.cantidad), servicios: f.servicios.size } }));
      }
    }
    return salida;
  }

  /**
   * Una hoja por reto activo (o cerrado, si se pide) con su avance. El avance sale de la misma cuenta que usa la pantalla de retos,
   * que ya limita las agencias y bahías al alcance de quien pregunta. Un reto se ve con la regla del módulo de retos (todo el país, o
   * su región, su agencia o él mismo) y, si se filtra por región, cliente o agencia, solo si alcanza a esas agencias.
   */
  private async retos(ctx: Ctx): Promise<Bruta[]> {
    if (!this.retosService || ctx.alcance.tipo === 'NINGUNO') return [];
    const estado = ctx.dto.estado === 'FINALIZADO' ? { estado: 'FINALIZADO' } : ctx.dto.estado === 'TODOS' ? {} : { estado: 'ACTIVO' };
    const todos = await this.prisma.reto.findMany({ where: estado, orderBy: [{ fechaInicio: 'asc' }, { createdAt: 'asc' }] });

    const global = ctx.alcance.tipo === 'GLOBAL';
    const regionPropia = String(ctx.user?.region?.nombre ?? '').trim();
    const agenciaPropia = String(ctx.user?.agenciaId ?? '').trim();
    const idPropio = String(ctx.user?.id ?? '').trim();
    const regionesElegidas = new Set(ctx.agencias.map((a) => a.regionNombre).filter(Boolean));
    const ids = new Set(ctx.ids);
    const filtrado = !!(ctx.dto.regionId || ctx.dto.clienteId || ctx.dto.agenciaIds?.length);

    const visible = (r: any): boolean => {
      if (global) return true;
      const sinDestino = !r.regiones.length && !r.sucursalesIds.length && !r.pulidoresIds.length && !r.lavadoresIds.length;
      return (
        sinDestino ||
        r.regiones.includes('Todas') ||
        (!!regionPropia && r.regiones.includes(regionPropia)) ||
        (!!agenciaPropia && r.sucursalesIds.includes(agenciaPropia)) ||
        (!!idPropio && (r.pulidoresIds.includes(idPropio) || r.lavadoresIds.includes(idPropio)))
      );
    };
    const alcanza = (r: any): boolean => {
      if (!r.regiones.length && !r.sucursalesIds.length) return true;
      return r.regiones.includes('Todas') || r.regiones.some((x: string) => regionesElegidas.has(x)) || r.sucursalesIds.some((x: string) => ids.has(x));
    };

    const PARTICIPAN: Record<string, string> = { AGENCIA: 'Agencias', BAHIA: 'Bahías', LAVADOR: 'Lavadores', PULIDOR: 'Pulidores' };
    const METRICAS: Record<string, string> = { SERVICIOS: 'Servicios realizados', AUTOS: 'Autos distintos', MONTO: 'Monto vendido' };
    const SERVICIOS: Record<string, string> = { TODOS: 'Todos', GENERALES: 'Generales', ESPECIALES: 'Especiales', ESPECIFICOS: 'Específicos' };
    const dia = (f: Date): string => f.toISOString().slice(0, 10);

    const aplicables = todos.filter((r) => visible(r) && (!filtrado || alcanza(r)));
    const salida: Bruta[] = [];
    for (const r of aplicables) {
      let ranking: Awaited<ReturnType<RetosService['ranking']>>;
      try {
        ranking = await this.retosService.ranking(r.id, ctx.user);
      } catch {
        continue; // el reto no es visible para este usuario
      }
      // Una cantidad en dinero es sensible igual que los precios.
      const oculto = r.metrica === 'MONTO' && !ctx.verPrecios;
      const meta = r.modoGanador === 'META' && r.meta !== null ? Number(r.meta) : null;
      const modo = r.modoGanador === 'META'
        ? meta === null ? 'Meta' : oculto ? 'Meta por monto' : `Meta de ${r.metrica === 'MONTO' ? '$' : ''}${meta}`
        : r.cantidadGanadores === 1 ? 'Ranking: gana el primero' : `Ranking: ganan los ${r.cantidadGanadores} primeros`;
      const regiones = r.regiones.filter((x: string) => x && x.toLowerCase() !== 'todas');
      const partes = [regiones.length ? regiones.join(', ') : 'Todas las regiones'];
      if (r.sucursalesIds.length) partes.push(`${r.sucursalesIds.length} agencia(s)`);
      const personas = r.pulidoresIds.length + r.lavadoresIds.length;
      if (personas) partes.push(`${personas} persona(s)`);

      ctx.grupos.set(r.id, {
        clave: r.id,
        titulo: r.titulo,
        tipo: 'RETO',
        region: '',
        cliente: '',
        agencia: '',
        responsable: '',
        datos: [
          { etiqueta: 'RETO', valor: r.titulo },
          { etiqueta: 'ESTADO', valor: r.estado === 'FINALIZADO' ? 'Cerrado' : 'Activo' },
          { etiqueta: 'PARTICIPAN', valor: PARTICIPAN[r.tipoReto] ?? titulo(r.tipoReto) },
          { etiqueta: 'SE MIDE', valor: METRICAS[r.metrica] ?? titulo(r.metrica) },
          { etiqueta: 'SERVICIOS', valor: SERVICIOS[r.tipoServicios] ?? titulo(r.tipoServicios) },
          { etiqueta: 'MODO', valor: modo },
          { etiqueta: 'DURACIÓN', valor: `${etiquetaDia(dia(r.fechaInicio))} al ${etiquetaDia(dia(r.fechaFin))}` },
          { etiqueta: 'PREMIO', valor: r.premio ?? 'Sin premio' },
          { etiqueta: 'DIRIGIDO A', valor: partes.join(' · ') },
          { etiqueta: 'CREADO POR', valor: [r.creadorNombre, r.creadorRol ? `(${titulo(r.creadorRol)})` : ''].filter(Boolean).join(' ') || 'No registrado' },
        ],
      });

      for (const f of ranking.participantes) {
        const valor = Number(f.valor);
        const situacion = meta !== null ? (valor >= meta ? 'Meta cumplida' : 'En progreso') : f.gana ? 'Ganando' : 'En carrera';
        salida.push({
          grupo: r.id,
          fila: {
            posicion: f.posicion,
            participante: f.nombre,
            detalle: f.detalle ?? '',
            valor: oculto ? null : valor,
            meta: oculto ? null : meta,
            avance: meta ? Math.round((valor / meta) * 1000) / 10 : null,
            situacion,
          },
        });
      }
    }
    return salida;
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // Productividad
  // ---------------------------------------------------------------------------------------------------------------------

  /** Servicios del periodo (generales y especiales) ya reducidos a lo que necesitan los reportes de productividad. */
  private async serviciosParaProductividad(ctx: Ctx): Promise<ServicioProductivo[]> {
    const [generalesBase, especialesBase] = await Promise.all([
      this.prisma.servicioLavado.findMany({
        where: { deletedAt: null, bahia: { agenciaId: { in: ctx.ids } }, horaIngreso: { gte: ctx.gte, lt: ctx.lt } },
        select: {
          estado: true, precio: true, horaIngreso: true, horaInicio: true, horaSalida: true, operadorId: true,
          bahia: { select: { agenciaId: true } },
          operadoresAsignados: { select: { operadorId: true } },
        },
      }),
      this.prisma.servicioEspecial.findMany({
        where: {
          deletedAt: null,
          agenciaId: { in: ctx.ids },
          OR: [{ fechaProgramada: { gte: ctx.gte, lt: ctx.lt } }, { fechaProgramada: null, createdAt: { gte: ctx.gte, lt: ctx.lt } }],
        },
        select: {
          estado: true, precio: true, agenciaId: true, fechaProgramada: true, createdAt: true, tiempoEfectivoSeg: true, operadorId: true,
          operadoresAsignados: { select: { operadorId: true } },
        },
      }),
    ]);
    // Lo ya archivado también cuenta en la productividad del periodo.
    const [archivadosGenerales, archivadosEspeciales] = this.archivo
      ? await Promise.all([
          this.archivo.serviciosGenerales({ agenciaIds: ctx.ids, gte: ctx.gte, lt: ctx.lt }),
          this.archivo.serviciosEspeciales({ agenciaIds: ctx.ids, gte: ctx.gte, lt: ctx.lt, conOperadores: true }),
        ])
      : [[], []];
    const generales = [...generalesBase, ...archivadosGenerales] as typeof generalesBase;
    const especiales = [...especialesBase, ...archivadosEspeciales] as typeof especialesBase;

    const salida: ServicioProductivo[] = [];
    for (const s of generales) {
      const inicio = s.horaInicio ?? s.horaIngreso;
      const operarios = s.operadoresAsignados.length ? s.operadoresAsignados.map((o) => o.operadorId) : [s.operadorId];
      salida.push({
        origen: 'GENERAL',
        agenciaId: s.bahia.agenciaId,
        fecha: fechaEcuador(s.horaIngreso),
        resultado: s.estado === 'FINALIZADO' || s.estado === 'APROBADO' ? 'SI' : s.estado === 'CANCELADO' || s.estado === 'RECHAZADO' ? 'NO' : '',
        monto: num(s.precio),
        minutos: s.horaSalida ? Math.max(0, (s.horaSalida.getTime() - inicio.getTime()) / 60000) : null,
        operarios,
      });
    }
    for (const s of especiales) {
      salida.push({
        origen: 'ESPECIAL',
        agenciaId: s.agenciaId!,
        fecha: fechaEcuador(s.fechaProgramada ?? s.createdAt),
        resultado: s.estado === 'Completado' ? 'SI' : s.estado === 'Cancelado' ? 'NO' : '',
        monto: num(s.precio),
        minutos: s.tiempoEfectivoSeg ? s.tiempoEfectivoSeg / 60 : null,
        operarios: s.operadoresAsignados.length ? s.operadoresAsignados.map((o) => o.operadorId) : s.operadorId ? [s.operadorId] : [],
      });
    }
    return salida;
  }

  private promedio(valores: (number | null)[]): number | null {
    const v = valores.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  }

  /** Comparativa de agencias: en cada bloque del periodo, una fila por agencia con actividad, ordenadas por servicios realizados. */
  private async productividadAgencias(ctx: Ctx): Promise<Bruta[]> {
    const servicios = await this.serviciosParaProductividad(ctx);
    const { bloques } = dividirRango(ctx.rango!);
    const salida: Bruta[] = [];
    for (const b of bloques) {
      const filas = ctx.agencias
        .map((a) => {
          const propios = servicios.filter((s) => s.agenciaId === a.id && s.fecha >= b.desde && s.fecha <= b.hasta);
          const generales = propios.filter((s) => s.origen === 'GENERAL');
          const especiales = propios.filter((s) => s.origen === 'ESPECIAL');
          const realizados = generales.filter((s) => s.resultado === 'SI');
          return {
            agencia: a.nombre,
            region: a.regionNombre,
            cliente: a.clienteNombre,
            servicios: generales.length,
            realizados: realizados.length,
            noRealizados: generales.filter((s) => s.resultado === 'NO').length,
            cumplimiento: generales.length ? Math.round((realizados.length / generales.length) * 1000) / 10 : null,
            tiempo: this.promedio(realizados.map((s) => s.minutos)),
            especiales: especiales.length,
            especialesOk: especiales.filter((s) => s.resultado === 'SI').length,
            monto: Math.round(propios.filter((s) => s.resultado === 'SI').reduce((acc, s) => acc + s.monto, 0) * 100) / 100,
          };
        })
        .filter((f) => f.servicios > 0 || f.especiales > 0)
        .sort((x, y) => y.realizados - x.realizados || y.especialesOk - x.especialesOk || x.agencia.localeCompare(y.agencia, 'es'));
      filas.forEach((f, i) => salida.push({ grupo: 'unico', fecha: b.desde, fila: { posicion: i + 1, ...f } }));
    }
    return salida;
  }

  /** Ranking de operarios: en cada agencia y bloque del periodo, lavadores y pulidores ordenados por servicios realizados. */
  private async productividadOperarios(ctx: Ctx): Promise<Bruta[]> {
    const servicios = await this.serviciosParaProductividad(ctx);
    const idsOperarios = unicos(servicios.flatMap((s) => s.operarios));
    const usuarios = idsOperarios.length ? await this.prisma.user.findMany({ where: { id: { in: idsOperarios } }, select: { id: true, name: true, lastname: true } }) : [];
    const nombre = new Map(usuarios.map((u) => [u.id, nombreDe(u)]));
    const { bloques } = dividirRango(ctx.rango!);
    const salida: Bruta[] = [];
    for (const b of bloques) {
      for (const a of ctx.agencias) {
        const acumulado = new Map<string, { operario: string; rol: string; realizados: number; minutos: (number | null)[]; monto: number }>();
        for (const s of servicios) {
          if (s.agenciaId !== a.id || s.fecha < b.desde || s.fecha > b.hasta || s.resultado !== 'SI') continue;
          const rol = s.origen === 'GENERAL' ? 'Lavador' : 'Pulidor';
          for (const id of s.operarios) {
            const clave = `${id}|${rol}`;
            const fila = acumulado.get(clave) ?? { operario: nombre.get(id) ?? 'Sin nombre', rol, realizados: 0, minutos: [], monto: 0 };
            fila.realizados += 1;
            fila.minutos.push(s.minutos);
            // Con varios operarios el servicio se reparte: cada uno acredita su parte del monto.
            fila.monto += s.monto / s.operarios.length;
            acumulado.set(clave, fila);
          }
        }
        [...acumulado.values()]
          .sort((x, y) => y.realizados - x.realizados || x.operario.localeCompare(y.operario, 'es'))
          .forEach((f, i) =>
            salida.push({
              grupo: a.id,
              fecha: b.desde,
              fila: { posicion: i + 1, operario: f.operario, rol: f.rol, realizados: f.realizados, tiempo: this.promedio(f.minutos), monto: Math.round(f.monto * 100) / 100 },
            }),
          );
      }
    }
    return salida;
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
        fila: { _id: i.id, numero: i.numero, fecha: dia, tipo: titulo(i.tipoInspeccion), estado: titulo(i.estado), inspector: nombreDe(i.inspector), destinatario: i.destinatarioNombre, asunto: i.asunto, calificacion: titulo(i.calificacion) },
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
          _id: a.id,
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
