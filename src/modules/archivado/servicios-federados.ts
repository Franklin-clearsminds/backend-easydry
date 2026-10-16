import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Termino, ValorFiltro } from './archivo-lector.js';
import { TABLAS_ARCHIVABLES } from './archivado.tablas.js';
import { HistoricoService } from './historico.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;
type Where = Record<string, any>;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Una relación de un modelo: a un maestro que sigue en la base (`uno`) o a filas hijas que viajan archivadas con el padre (`muchos`). */
type Relacion =
  | { tipo: 'uno'; delegado: string; fk: string }
  | { tipo: 'muchos'; hijo: string; fk: string; modeloHijo: string }
  /** El padre archivado de una fila hija (p. ej. el servicio de una línea de consumo). */
  | { tipo: 'padre'; tabla: string; fk: string; modeloPadre: string };

interface ModeloFederado {
  tabla: string;
  /** Columna con la que se particionan los archivos. */
  evento: string;
  estadoColumna: string;
  /** Estados que llegan al archivo (los demás son siempre "vivos" y están solo en la base). */
  estadosArchivados: string[];
  relaciones: Record<string, Relacion>;
  /** Relaciones de un filtro (`bahia: { agencia: ... }`) → columna de la fila archivada con la que se comparan. */
  filtrosRelacion: Record<string, { columna: string; delegado: string; anidada?: string }>;
  /** Cuánto antes y después del rango pedido de cada columna de fecha puede estar la fecha del evento del archivo. */
  ventanas: Record<string, { antesDias: number; despuesDias: number }>;
}

const MODELOS: Record<string, ModeloFederado> = {
  servicioLavado: {
    tabla: 'servicio_lavado',
    evento: 'horaIngreso',
    estadoColumna: 'estado',
    estadosArchivados: ['APROBADO', 'RECHAZADO', 'CANCELADO'],
    relaciones: {
      operador: { tipo: 'uno', delegado: 'user', fk: 'operadorId' },
      bahia: { tipo: 'uno', delegado: 'bahia', fk: 'bahiaId' },
      catalogo: { tipo: 'uno', delegado: 'catalogoServicio', fk: 'servicioCatalogoId' },
      consumos: { tipo: 'muchos', hijo: 'consumo_servicio', fk: 'servicioId', modeloHijo: 'consumoServicio' },
      operadoresAsignados: { tipo: 'muchos', hijo: 'servicio_lavado_operador', fk: 'servicioId', modeloHijo: 'servicioLavadoOperador' },
    },
    filtrosRelacion: {
      bahia: { columna: 'agenciaId', delegado: 'agencia', anidada: 'agencia' },
      catalogo: { columna: 'servicioCatalogoId', delegado: 'catalogoServicio' },
    },
    ventanas: {
      horaIngreso: { antesDias: 0, despuesDias: 0 },
      horaSalida: { antesDias: 30, despuesDias: 0 },
      createdAt: { antesDias: 90, despuesDias: 0 },
      anuladoEn: { antesDias: 180, despuesDias: 0 },
    },
  },
  servicioEspecial: {
    tabla: 'servicio_especial',
    evento: 'fechaEvento',
    estadoColumna: 'estado',
    estadosArchivados: ['Completado', 'Cancelado'],
    relaciones: {
      operador: { tipo: 'uno', delegado: 'user', fk: 'operadorId' },
      agencia: { tipo: 'uno', delegado: 'agencia', fk: 'agenciaId' },
      region: { tipo: 'uno', delegado: 'region', fk: 'regionId' },
      catalogo: { tipo: 'uno', delegado: 'catalogoServicio', fk: 'servicioCatalogoId' },
      consumos: { tipo: 'muchos', hijo: 'consumo_servicio_especial', fk: 'servicioEspecialId', modeloHijo: 'consumoServicioEspecial' },
      operadoresAsignados: { tipo: 'muchos', hijo: 'servicio_especial_operador', fk: 'servicioId', modeloHijo: 'servicioEspecialOperador' },
    },
    filtrosRelacion: {
      agencia: { columna: 'agenciaId', delegado: 'agencia' },
      catalogo: { columna: 'servicioCatalogoId', delegado: 'catalogoServicio' },
    },
    ventanas: {
      createdAt: { antesDias: 90, despuesDias: 180 },
      fechaFin: { antesDias: 180, despuesDias: 90 },
    },
  },
  movimientoInventario: {
    tabla: 'movimiento_inventario',
    evento: 'fechaDespacho',
    estadoColumna: 'estadoDespacho',
    estadosArchivados: ['RECIBIDO', 'RECHAZADO', 'CANCELADO'],
    relaciones: {
      detalles: { tipo: 'muchos', hijo: 'movimiento_detalle', fk: 'movimientoId', modeloHijo: 'movimientoDetalle' },
      usuarioDespacha: { tipo: 'uno', delegado: 'user', fk: 'usuarioDespachaId' },
      usuarioRecibe: { tipo: 'uno', delegado: 'user', fk: 'usuarioRecibeId' },
    },
    filtrosRelacion: {},
    ventanas: {
      fechaDespacho: { antesDias: 0, despuesDias: 0 },
      createdAt: { antesDias: 30, despuesDias: 30 },
    },
  },
};

const TABLA_DE_HIJO: Record<string, string> = {
  consumoServicio: 'consumo_servicio',
  consumoServicioEspecial: 'consumo_servicio_especial',
  movimientoDetalle: 'movimiento_detalle',
  servicioLavadoOperador: 'servicio_lavado_operador',
  servicioEspecialOperador: 'servicio_especial_operador',
};

/** Relaciones de las filas hijas (para proyectar sus `select`/`include`). */
const RELACIONES_HIJO: Record<string, Record<string, Relacion>> = {
  consumoServicio: {
    insumo: { tipo: 'uno', delegado: 'insumo', fk: 'insumoId' },
    servicio: { tipo: 'padre', tabla: 'servicio_lavado', fk: 'servicioId', modeloPadre: 'servicioLavado' },
  },
  consumoServicioEspecial: {
    insumo: { tipo: 'uno', delegado: 'insumo', fk: 'insumoId' },
    servicioEspecial: { tipo: 'padre', tabla: 'servicio_especial', fk: 'servicioEspecialId', modeloPadre: 'servicioEspecial' },
  },
  movimientoDetalle: { insumo: { tipo: 'uno', delegado: 'insumo', fk: 'insumoId' } },
  servicioLavadoOperador: { operador: { tipo: 'uno', delegado: 'user', fk: 'operadorId' } },
  servicioEspecialOperador: { operador: { tipo: 'uno', delegado: 'user', fk: 'operadorId' } },
};

const comoFecha = (v: unknown): number | null => (v instanceof Date ? v.getTime() : typeof v === 'string' || typeof v === 'number' ? new Date(v).getTime() : null);
const igual = (a: unknown, b: unknown): boolean => {
  if (a instanceof Date || b instanceof Date) return comoFecha(a) === comoFecha(b);
  return (a ?? null) === (b ?? null);
};

/**
 * Un `where` de Prisma evaluado contra una fila ARCHIVADA. Vocabulario soportado: igualdad (valor o `null`), `equals`, `in`, `notIn`,
 * `not`, `gt/gte/lt/lte`, `contains/startsWith/endsWith` (con `mode`), `AND`, `OR` y `NOT`. Las relaciones ya vienen resueltas a ids (ver `resolverRelaciones`). Lo que no se
 * conoce lanza un error: un filtro mal entendido daría números distintos sin avisar.
 */
function evaluar(fila: Fila, where: Where): boolean {
  for (const [clave, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (clave === 'AND') {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w: Where) => evaluar(fila, w))) return false;
    } else if (clave === 'OR') {
      if (!(cond as Where[]).some((w) => evaluar(fila, w))) return false;
    } else if (clave === 'NOT') {
      if ((Array.isArray(cond) ? cond : [cond]).some((w: Where) => evaluar(fila, w))) return false;
    } else if (!cumple(fila[clave], cond)) return false;
  }
  return true;
}

function cumple(valor: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return igual(valor, cond);
  for (const [op, esperado] of Object.entries(cond as Where)) {
    if (esperado === undefined) continue;
    const v = valor instanceof Date ? valor.getTime() : valor;
    const e = esperado instanceof Date ? esperado.getTime() : esperado;
    switch (op) {
      case 'equals': if (!igual(valor, esperado)) return false; break;
      case 'in': if (!(esperado as unknown[]).some((x) => igual(valor, x))) return false; break;
      case 'notIn': if ((esperado as unknown[]).some((x) => igual(valor, x))) return false; break;
      case 'not': if (cumple(valor, esperado)) return false; break;
      case 'mode': break; // lo usan `contains`/`startsWith`/`endsWith`
      case 'contains': case 'startsWith': case 'endsWith': {
        if (typeof valor !== 'string') return false;
        const insensible = (cond as Where).mode === 'insensitive';
        const t = insensible ? valor.toLowerCase() : valor;
        const q = insensible ? String(esperado).toLowerCase() : String(esperado);
        if (op === 'contains' ? !t.includes(q) : op === 'startsWith' ? !t.startsWith(q) : !t.endsWith(q)) return false;
        break;
      }
      case 'gt': if (v === null || v === undefined || !((v as number) > (e as number))) return false; break;
      case 'gte': if (v === null || v === undefined || !((v as number) >= (e as number))) return false; break;
      case 'lt': if (v === null || v === undefined || !((v as number) < (e as number))) return false; break;
      case 'lte': if (v === null || v === undefined || !((v as number) <= (e as number))) return false; break;
      default: throw new Error(`Operador de filtro no soportado para el archivo: ${op}`);
    }
  }
  return true;
}

/**
 * Lee servicios, movimientos y consumos como si estuvieran todos en la base: ejecuta la consulta de siempre sobre la base y le suma
 * lo archivado en Parquet que cumple el MISMO filtro, con la misma forma de fila. Es para los paneles de análisis, que filtran por
 * periodo, agencia/región, pulidor y categoría y calculan sus totales en memoria o con agregados.
 *
 * El archivo solo se consulta cuando algún lote toca el periodo pedido (consulta barata a la tabla de lotes): para el día a día no
 * cuesta nada. Las filas archivadas no cambian, así que base y archivo nunca se repiten.
 */
export class ServiciosFederados {
  private readonly logger = new Logger(ServiciosFederados.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historico?: HistoricoService,
  ) {}

  // ── Lectura pública ────────────────────────────────────────────────────────────────────────────

  async findMany(modelo: 'servicioLavado' | 'servicioEspecial' | 'movimientoInventario', args: { where?: Where; select?: Where; include?: Where; orderBy?: Where | Where[]; take?: number }): Promise<any[]> {
    const deBase: Fila[] = await (this.prisma as any)[modelo].findMany(args);
    const criterio = args.orderBy && !Array.isArray(args.orderBy) && Object.keys(args.orderBy).length === 1 ? Object.entries(args.orderBy)[0] : null;
    const archivadas = await this.filasArchivadas(modelo, args.where ?? {}, args.take && criterio ? { columna: criterio[0], dir: criterio[1] as 'asc' | 'desc', limite: args.take } : undefined);
    if (!archivadas.length) return deBase;
    const proyectadas = await this.proyectar(modelo, archivadas, args.select ?? args.include ?? null, !args.select);
    const todas = [...deBase, ...proyectadas];
    if (!args.orderBy) return args.take ? todas.slice(0, args.take) : todas;
    // Con orden, el campo por el que se ordena debe estar en lo que se pidió (si no, no se puede ordenar lo archivado).
    const criterios = (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]).flatMap((o) => Object.entries(o) as Array<[string, 'asc' | 'desc']>);
    const completas = [...deBase.map((f, i) => ({ f, i, a: false })), ...proyectadas.map((f, i) => ({ f, i, a: true }))];
    completas.sort((x, y) => {
      for (const [campo, dir] of criterios) {
        const c = comparar(x.f[campo], y.f[campo], dir);
        if (c) return c;
      }
      return Number(x.a) - Number(y.a) || x.i - y.i; // empate: primero lo de la base
    });
    const ordenadas = completas.map((x) => x.f);
    return args.take ? ordenadas.slice(0, args.take) : ordenadas;
  }

  async count(modelo: 'servicioLavado' | 'servicioEspecial' | 'movimientoInventario', args: { where: Where }): Promise<number> {
    const [base, archivadas] = await Promise.all([(this.prisma as any)[modelo].count(args) as Promise<number>, this.filasArchivadas(modelo, args.where)]);
    return base + archivadas.length;
  }

  /** Suma de `precio` (servicios) de base y archivo; con la forma de `aggregate({ _sum: { precio: true } })`. */
  async aggregate(modelo: 'servicioLavado' | 'servicioEspecial', args: { _sum: { precio: true }; where: Where }): Promise<{ _sum: { precio: Prisma.Decimal | null } }> {
    const base = await (this.prisma as any)[modelo].aggregate(args);
    const archivadas = await this.filasArchivadas(modelo, args.where);
    if (!archivadas.length) return base;
    let total = new Prisma.Decimal(base._sum.precio ?? 0);
    for (const f of archivadas) if (f.precio !== null && f.precio !== undefined) total = total.plus(new Prisma.Decimal(f.precio));
    return { _sum: { precio: total } };
  }

  /** Servicios por id (base primero; los que no estén, del archivo). Para búsquedas puntuales sin rango de fechas. */
  async servicioPorId(modelo: 'servicioLavado' | 'servicioEspecial', ids: string[], select: Where): Promise<any[]> {
    const deBase: Fila[] = await (this.prisma as any)[modelo].findMany({ where: { id: { in: ids } }, select });
    if (!this.historico) return deBase;
    const faltan = ids.filter((id) => !deBase.some((f) => f.id === id));
    if (!faltan.length) return deBase;
    const cfg = MODELOS[modelo];
    if (!(await this.historico.hayDatosArchivados([cfg.tabla]))) return deBase;
    const r = await this.historico.listarArchivo({ tabla: cfg.tabla, filtros: { id: faltan } });
    if (!r?.filas.length) return deBase;
    return [...deBase, ...(await this.proyectar(modelo, r.filas, select, false))];
  }

  /** Líneas de consumo de servicios de lavado: base + archivo, con la forma de `consumoServicio.findMany({ where, include | select })`. */
  async consumos(args: { where: Where; include?: Where; select?: Where }): Promise<any[]> {
    const deBase: Fila[] = await this.prisma.consumoServicio.findMany(args as never);
    const archivadas = await this.consumosArchivados(args.where);
    if (!archivadas.length) return deBase;
    return [...deBase, ...(await this.proyectar('consumoServicio', archivadas, args.select ?? args.include ?? null, !args.select))];
  }

  /** Suma de lo consumido por insumo (base + archivo), con la forma de `consumoServicio.groupBy({ by: ['insumoId'], _sum })`. */
  async consumoPorInsumo(args: { by: ['insumoId']; where: Where; _sum: { cantidadUsada: true } }): Promise<Array<{ insumoId: string; _sum: { cantidadUsada: Prisma.Decimal | null } }>> {
    const base = await this.prisma.consumoServicio.groupBy(args as never) as unknown as Array<{ insumoId: string; _sum: { cantidadUsada: Prisma.Decimal | null } }>;
    const archivadas = await this.consumosArchivados(args.where);
    if (!archivadas.length) return base;
    const suma = new Map<string, Prisma.Decimal>();
    for (const b of base) suma.set(b.insumoId, new Prisma.Decimal(b._sum.cantidadUsada ?? 0));
    for (const f of archivadas) suma.set(String(f.insumoId), (suma.get(String(f.insumoId)) ?? new Prisma.Decimal(0)).plus(new Prisma.Decimal(f.cantidadUsada as number)));
    return [...suma.entries()].map(([insumoId, total]) => ({ insumoId, _sum: { cantidadUsada: total } }));
  }

  // ── Qué filas archivadas cumplen un filtro ────────────────────────────────────────────────────────

  /** Convierte las relaciones del filtro (`bahia: { agencia: … }`, `catalogo: …`) en condiciones sobre columnas de la fila archivada. */
  private async resolverRelaciones(cfg: ModeloFederado, where: Where): Promise<Where> {
    const salida: Where = {};
    for (const [clave, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (clave === 'AND' || clave === 'OR' || clave === 'NOT') {
        const lista = Array.isArray(cond) ? cond : [cond];
        salida[clave] = await Promise.all(lista.map((w: Where) => this.resolverRelaciones(cfg, w)));
        continue;
      }
      const rel = cfg.filtrosRelacion[clave];
      if (!rel) { salida[clave] = cond; continue; }
      const sub = rel.anidada ? (cond as Where)[rel.anidada] : cond;
      if (rel.anidada && Object.keys(cond as Where).some((k) => k !== rel.anidada)) throw new Error(`Filtro por ${clave} no soportado para el archivo.`);
      const ids = (await (this.prisma as any)[rel.delegado].findMany({ where: sub ?? {}, select: { id: true } })).map((x: { id: string | number }) => x.id);
      salida[rel.columna] = { in: ids };
    }
    return salida;
  }

  /**
   * Rango (de la columna de evento) que cubre las fechas del filtro, o `null` si no hay forma de acotar. `exacta` = la fecha del filtro
   * ES la del evento (sin holgura): el rango ya es el filtro y no hace falta volver a comprobarlo fila por fila.
   */
  private ventanaDe(cfg: ModeloFederado, where: Where): { desde?: Date; hasta?: Date; exacta: boolean } | null {
    let mejor: { desde?: Date; hasta?: Date; exacta: boolean } | null = null;
    const nivel = [where, ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [])];
    for (const w of nivel) {
      for (const [columna, v] of Object.entries(cfg.ventanas)) {
        const cond = w[columna];
        if (!cond || typeof cond !== 'object' || cond instanceof Date) continue;
        const gte = (cond.gte ?? cond.gt) as Date | undefined;
        const tope = (cond.lte ?? cond.lt) as Date | undefined;
        if (!gte && !tope) continue;
        const exclusivo = cond.lte !== undefined ? 1 : 0; // "hasta" del archivo es exclusivo
        const candidata = {
          desde: gte ? new Date(gte.getTime() - v.antesDias * DIA_MS) : undefined,
          hasta: tope ? new Date(tope.getTime() + exclusivo + v.despuesDias * DIA_MS) : undefined,
          exacta: columna === cfg.evento && cond.gt === undefined && v.antesDias === 0 && v.despuesDias === 0,
        };
        // Si varias fechas acotan, la más estrecha gana (cualquiera de ellas es válida por separado).
        const ancho = (x: { desde?: Date; hasta?: Date }) => (x.hasta?.getTime() ?? Infinity) - (x.desde?.getTime() ?? -Infinity);
        if (!mejor || ancho(candidata) < ancho(mejor)) mejor = candidata;
      }
    }
    return mejor;
  }

  /**
   * Lo que el lector puede aplicar al leer: igualdades, pertenencias y textos contenidos (sin distinguir mayúsculas), con los OR como
   * grupos. `exacta` = el filtro entero se pudo traducir, así que las filas leídas ya lo cumplen y se puede pedir solo las primeras.
   */
  private aTerminos(cfg: ModeloFederado, where: Where, ventana: { exacta: boolean } | null): { filtros: Record<string, ValorFiltro>; grupos: Termino[][]; exacta: boolean } {
    const filtros: Record<string, ValorFiltro> = {};
    const grupos: Termino[][] = [];
    let exacta = true;
    const simple = (c: unknown): ValorFiltro | undefined => {
      if (c === null || typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return c;
      if (c && typeof c === 'object' && !(c instanceof Date)) {
        const o = c as Where;
        if (Object.keys(o).length === 1 && typeof o.equals === 'string') return o.equals;
        if (Object.keys(o).length === 1 && Array.isArray(o.in) && o.in.every((x: unknown) => typeof x === 'string' || typeof x === 'number')) return o.in;
      }
      return undefined;
    };
    const termino = (columna: string, c: unknown): Termino | null => {
      const v = simple(c);
      if (v !== undefined) return { columna, igual: v };
      const o = c as Where;
      if (o && typeof o === 'object' && !(c instanceof Date) && Object.keys(o).every((k) => ['contains', 'mode'].includes(k)) && typeof o.contains === 'string' && o.mode === 'insensitive') return { columna, contiene: o.contains };
      return null;
    };
    const recorrer = (w: Where) => {
      for (const [clave, cond] of Object.entries(w)) {
        if (cond === undefined) continue;
        if (clave === 'AND') { for (const x of Array.isArray(cond) ? cond : [cond]) recorrer(x); continue; }
        if (clave === 'OR') {
          const terminos: Termino[] = [];
          for (const x of cond as Where[]) {
            const entradas = Object.entries(x);
            const t = entradas.length === 1 ? termino(entradas[0][0], entradas[0][1]) : null;
            if (!t) { exacta = false; return; }
            terminos.push(t);
          }
          grupos.push(terminos);
          continue;
        }
        if (clave === 'NOT') { exacta = false; continue; }
        if (clave === cfg.evento && ventana?.exacta) continue; // ya es el rango
        const t = termino(clave, cond);
        if (!t) { exacta = false; continue; }
        if ('igual' in t) {
          if (clave in filtros) exacta = false;
          else filtros[clave] = t.igual;
        } else grupos.push([t]);
      }
    };
    recorrer(where);
    if (!ventana && Object.keys(where).some((k) => cfg.ventanas[k])) exacta = false;
    return { filtros, grupos, exacta };
  }

  /** ¿El filtro de estado pide solo estados que nunca se archivan? Entonces el archivo no interviene. */
  private soloEstadosVivos(cfg: ModeloFederado, where: Where): boolean {
    const nivel = [where, ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [])];
    for (const w of nivel) {
      const e = w[cfg.estadoColumna];
      const pedidos: unknown[] | null = typeof e === 'string' ? [e] : e && typeof e === 'object' && Array.isArray(e.in) ? e.in : e && typeof e === 'object' && typeof e.equals === 'string' ? [e.equals] : null;
      if (pedidos && !pedidos.some((x) => cfg.estadosArchivados.includes(String(x)))) return true;
    }
    return false;
  }

  private async filasArchivadas(modelo: string, where: Where, orden?: { columna: string; dir: 'asc' | 'desc'; limite: number }): Promise<Fila[]> {
    if (!this.historico) return [];
    const cfg = MODELOS[modelo];
    if (!cfg) throw new Error(`Modelo sin archivo: ${modelo}`);
    if (this.soloEstadosVivos(cfg, where)) return [];
    const ventana = this.ventanaDe(cfg, where);
    if (!(await this.historico.hayDatosArchivados([cfg.tabla], ventana?.desde, ventana?.hasta))) return [];
    const resuelto = await this.resolverRelaciones(cfg, where);
    const { filtros, grupos, exacta } = this.aTerminos(cfg, resuelto, ventana);
    // Con orden por la fecha del evento y el filtro entero traducido, basta leer las primeras filas del archivo.
    const limitar = exacta && orden && orden.columna === cfg.evento;
    const r = await this.historico.listarArchivo({
      tabla: cfg.tabla,
      desde: ventana?.desde,
      hasta: ventana?.hasta,
      filtros,
      grupos,
      ...(limitar ? { ordenPor: [{ columna: cfg.evento, dir: orden!.dir }], limite: orden!.limite } : {}),
    });
    return (r?.filas ?? []).filter((f) => evaluar(f, resuelto));
  }

  private async consumosArchivados(where: Where): Promise<Fila[]> {
    if (!this.historico) return [];
    const createdAt = where.createdAt as { gte?: Date; lte?: Date; lt?: Date } | undefined;
    if (!createdAt?.gte && !createdAt?.lte && !createdAt?.lt) {
      this.logger.warn('Consulta de consumos sin fechas que acoten el archivo: solo se cuenta lo que está en la base.');
      return [];
    }
    // Las líneas viven en el archivo del mes de SU servicio, que suele ser el mismo; se deja un margen por si se crearon después.
    const holgura = 90 * DIA_MS;
    const desde = createdAt.gte ? new Date(createdAt.gte.getTime() - holgura) : undefined;
    const tope = createdAt.lte ? new Date(createdAt.lte.getTime() + 1) : createdAt.lt;
    const hasta = tope ? new Date(tope.getTime() + holgura) : undefined;
    if (!(await this.historico.hayDatosArchivados(['consumo_servicio'], desde, hasta))) return [];
    const filas = await this.historico.listarHijos({ hijo: 'consumo_servicio', columnaFecha: 'createdAt', desde: createdAt.gte, hasta: tope, holguraMs: holgura });
    return filas.filter((f) => evaluar(f as Fila, where));
  }

  // ── Forma de las filas archivadas ───────────────────────────────────────────────────────────────

  /** Pasa las columnas decimales de una fila archivada a `Decimal` (como las devuelve Prisma). */
  private conDecimales(tabla: string, fila: Fila): Fila {
    const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === tabla);
    const columnas = cfg?.columnas ?? TABLAS_ARCHIVABLES.flatMap((t) => t.hijos ?? []).find((h) => h.tabla === tabla)?.columnas ?? [];
    const salida: Fila = { ...fila };
    for (const c of columnas) if (c.tipo === 'DOUBLE' && salida[c.nombre] !== null && salida[c.nombre] !== undefined) salida[c.nombre] = new Prisma.Decimal(salida[c.nombre] as number);
    return salida;
  }

  /**
   * Las filas archivadas con la forma que devolvería Prisma para ese `select`/`include`: las columnas pedidas y, por cada relación,
   * el maestro (de la base) o las filas hijas (del archivo del mismo lote). `todas` = es un `include` (todas las columnas + relaciones).
   */
  private async proyectar(modelo: string, filas: Fila[], seleccion: Where | null, todas: boolean): Promise<Fila[]> {
    const cfg = MODELOS[modelo];
    const tabla = cfg?.tabla ?? TABLA_DE_HIJO[modelo] ?? modelo;
    const relaciones: Record<string, Relacion> = cfg?.relaciones ?? RELACIONES_HIJO[modelo] ?? {};
    const pedidas = Object.entries(seleccion ?? {}).filter(([, v]) => v);
    const escalares = todas ? null : pedidas.filter(([k]) => !relaciones[k]).map(([k]) => k);
    const rels = pedidas.filter(([k]) => relaciones[k]);

    const base = filas.map((f) => this.conDecimales(tabla, f));
    const salida: Fila[] = base.map((f) => (escalares ? Object.fromEntries(escalares.map((k) => [k, f[k] ?? null])) : { ...f }));

    for (const [nombre, valor] of rels) {
      const rel = relaciones[nombre];
      const sub = valor === true ? null : (valor as Where);
      const subSelect: Where | null = sub ? (sub.select ?? sub.include ?? null) : null;
      if (rel.tipo === 'uno') {
        const mapa = await this.cargarMaestros(rel.delegado, base.map((f) => f[rel.fk]).filter((x) => x !== null && x !== undefined), subSelect, !!sub && !sub.select);
        salida.forEach((s, i) => { s[nombre] = mapa.get(base[i][rel.fk] as string | number) ?? null; });
      } else if (rel.tipo === 'muchos') {
        // Los archivos de los hijos se eligen por la fecha del evento de su padre: las filas ya leídas dicen cuáles.
        const eventos = base.map((f) => comoFecha(f[cfg!.evento])).filter((x): x is number => x !== null);
        const hijas = await this.historico!.hijosDe({ tabla, hijo: rel.hijo, idsPadre: base.map((f) => String(f.id)), ...(eventos.length ? { desde: new Date(Math.min(...eventos)), hasta: new Date(Math.max(...eventos) + 1) } : {}) });
        const proyectadas = hijas.length ? await this.proyectar(rel.modeloHijo, hijas as Fila[], subSelect, !sub || !sub.select) : [];
        const porPadre = new Map<string, Fila[]>();
        hijas.forEach((h, i) => { const k = String(h[rel.fk]); (porPadre.get(k) ?? porPadre.set(k, []).get(k)!).push(proyectadas[i]); });
        salida.forEach((s, i) => { s[nombre] = porPadre.get(String(base[i].id)) ?? []; });
      } else {
        // El padre archivado de una línea (mismo grupo): se busca por id en el archivo de la tabla padre.
        const ids = [...new Set(base.map((f) => String(f[rel.fk])))];
        // El servicio se creó antes que su línea de consumo: la ventana de lotes va desde unos meses antes de la primera línea.
        const creadas = base.map((f) => comoFecha(f.createdAt)).filter((x): x is number => x !== null);
        const r = ids.length ? await this.historico!.listarArchivo({ tabla: rel.tabla, filtros: { id: ids }, ...(creadas.length ? { desde: new Date(Math.min(...creadas) - 180 * DIA_MS), hasta: new Date(Math.max(...creadas) + 30 * DIA_MS) } : {}) }) : null;
        const padres = r?.filas ?? [];
        const proyectados = padres.length ? await this.proyectar(rel.modeloPadre, padres as Fila[], subSelect, !sub || !sub.select) : [];
        const mapa = new Map(padres.map((p, i) => [String(p.id), proyectados[i]]));
        salida.forEach((s, i) => { s[nombre] = mapa.get(String(base[i][rel.fk])) ?? null; });
      }
    }
    return salida;
  }

  /** Maestros de la base por id, con el mismo `select` que pidió quien consulta (y sin el `id` que se añade para poder unirlos). */
  private async cargarMaestros(delegado: string, ids: Array<string | number>, select: Where | null, incluirTodo: boolean): Promise<Map<string | number, Fila>> {
    const mapa = new Map<string | number, Fila>();
    const unicos = [...new Set(ids)];
    if (!unicos.length) return mapa;
    const quitarId = !!select && !select.id;
    const consulta = select ? { select: { ...select, id: true } } : {};
    for (let i = 0; i < unicos.length; i += 1000) {
      const filas = await (this.prisma as any)[delegado].findMany({ where: { id: { in: unicos.slice(i, i + 1000) } }, ...consulta });
      for (const f of filas as Fila[]) {
        const { id, ...resto } = f;
        mapa.set(id, quitarId ? resto : f);
      }
    }
    void incluirTodo;
    return mapa;
  }
}

/** Compara como Postgres: nulos al final en ascendente y al principio en descendente. */
function comparar(a: unknown, b: unknown, dir: 'asc' | 'desc'): number {
  const sentido = dir === 'asc' ? 1 : -1;
  const na = a === null || a === undefined;
  const nb = b === null || b === undefined;
  if (na || nb) return na === nb ? 0 : (na ? 1 : -1) * sentido;
  const x = a instanceof Date ? a.getTime() : a instanceof Prisma.Decimal ? a.toNumber() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : b instanceof Prisma.Decimal ? b.toNumber() : (b as number | string);
  return (x < y ? -1 : x > y ? 1 : 0) * sentido;
}
