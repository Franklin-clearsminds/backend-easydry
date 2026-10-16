import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TABLAS_ARCHIVABLES } from './archivado.tablas.js';
import { LECTOR_ARCHIVO, type ConsultaArchivo, type LectorArchivo, type ValorFiltro } from './archivo-lector.js';

export interface ConsultaHistorica {
  /** Nombre lógico de la tabla (ver `TABLAS_ARCHIVABLES`). */
  tabla: string;
  /** Condición para la base (Prisma). Debe incluir el ámbito del rol: quien llama es responsable de aplicarlo. */
  dondeDb?: Record<string, unknown>;
  /** Los MISMOS criterios para el archivo (igualdad o pertenencia por columna), incluido el ámbito del rol. */
  filtrosArchivo?: Record<string, ValorFiltro>;
  /** Rango de la fecha del evento: `desde` incluido, `hasta` excluido. */
  desde?: Date;
  hasta?: Date;
  orden?: 'asc' | 'desc';
  limite: number;
  offset?: number;
}

export interface ResultadoHistorico {
  filas: Array<Record<string, unknown>>;
  /** Total que cumple el filtro entre base y archivo (para paginar). */
  total: number;
  /** Solo para métricas y pruebas: la interfaz de usuario no debe mostrarlo (la fuente es transparente). */
  usoArchivo: boolean;
}

/**
 * Consulta unificada: base + archivo Parquet como si fueran una sola fuente.
 *
 * No hay lógica de "frontera" entre ambas. Un lote solo cuenta como archivado cuando está BORRADO (sus filas ya no están en
 * la base), así que lo que está en la base y lo que está en el archivo nunca se repite. Los lotes VERIFICADO (filas aún en la
 * base), SUBIDO o FALLIDO no se leen. Si el rango pedido no toca ningún lote, el archivo ni se consulta.
 */
@Injectable()
export class HistoricoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LECTOR_ARCHIVO) private readonly lector: LectorArchivo,
  ) {}

  async consultar(c: ConsultaHistorica): Promise<ResultadoHistorico> {
    const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === c.tabla);
    if (!cfg) throw new Error(`La tabla ${c.tabla} no se archiva.`);
    const orden = c.orden ?? 'desc';
    const offset = c.offset ?? 0;
    const necesarias = offset + c.limite;
    const delegado = (this.prisma as any)[cfg.modelo];
    const fecha = cfg.columnaFecha;

    const rango: Record<string, unknown>[] = [];
    if (c.desde) rango.push({ [fecha]: { gte: c.desde } });
    if (c.hasta) rango.push({ [fecha]: { lt: c.hasta } });
    const whereDb = { AND: [c.dondeDb ?? {}, ...rango] };

    const lotes = await this.prisma.archivadoLote.findMany({
      where: {
        tabla: c.tabla,
        estado: 'BORRADO',
        ...(c.desde ? { fechaMax: { gte: c.desde } } : {}),
        ...(c.hasta ? { fechaMin: { lt: c.hasta } } : {}),
      },
      orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { parte: 'asc' }],
      select: { clave: true },
    });

    const consultaArchivo = lotes.length
      ? { tabla: c.tabla, claves: lotes.map((l) => l.clave), desde: c.desde, hasta: c.hasta, filtros: c.filtrosArchivo, orden }
      : null;

    const [filasDb, totalDb, filasArchivo, totalArchivo] = await Promise.all([
      delegado.findMany({ where: whereDb, orderBy: [{ [fecha]: orden }, { id: orden }], take: necesarias }) as Promise<Array<Record<string, unknown>>>,
      delegado.count({ where: whereDb }) as Promise<number>,
      consultaArchivo ? this.lector.consultar({ ...consultaArchivo, limite: necesarias }) : Promise.resolve([]),
      consultaArchivo ? this.lector.contar(consultaArchivo) : Promise.resolve(0),
    ]);

    const sentido = orden === 'asc' ? 1 : -1;
    const fusionadas = [...filasDb, ...filasArchivo].sort((a, b) => {
      const porFecha = ((a[fecha] as Date).getTime() - (b[fecha] as Date).getTime()) * sentido;
      return porFecha || String(a.id).localeCompare(String(b.id)) * sentido;
    });

    return {
      filas: fusionadas.slice(offset, offset + c.limite),
      total: totalDb + totalArchivo,
      usoArchivo: consultaArchivo !== null,
    };
  }

  /** Lotes ya borrados de la base (archivados de verdad) cuyo rango de fechas toca el pedido. */
  private lotesQueTocan(tabla: string, desde?: Date, hasta?: Date, sinRecortarPorFecha = false) {
    return this.prisma.archivadoLote.findMany({
      where: {
        tabla,
        estado: 'BORRADO',
        // Los rangos de los lotes son los de la fecha del evento: si se filtra por otra columna no sirven para descartar lotes.
        ...(desde && !sinRecortarPorFecha ? { fechaMax: { gte: desde } } : {}),
        ...(hasta && !sinRecortarPorFecha ? { fechaMin: { lt: hasta } } : {}),
      },
      orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { parte: 'asc' }],
      select: { clave: true },
    });
  }

  /**
   * Para listados paginados: la parte archivada de una consulta con su total, o `null` si ningún lote toca el rango (en cuyo
   * caso quien llama sigue con su consulta de siempre, sin cargar DuckDB). `limite` acota las filas leídas; sin él se leen todas.
   */
  async listarArchivo(c: {
    tabla: string;
    desde?: Date;
    hasta?: Date;
    /** Columna por la que se filtran `desde` y `hasta` si no es la de la fecha del evento (entonces se leen todos los lotes). */
    columnaFecha?: string;
    filtros?: ConsultaHistorica['filtrosArchivo'];
    grupos?: ConsultaArchivo['grupos'];
    ordenPor?: ConsultaArchivo['ordenPor'];
    limite?: number;
  }): Promise<{ filas: Array<Record<string, unknown>>; total: number } | null> {
    if (!TABLAS_ARCHIVABLES.some((t) => t.tabla === c.tabla)) throw new Error(`La tabla ${c.tabla} no se archiva.`);
    const lotes = await this.lotesQueTocan(c.tabla, c.desde, c.hasta, !!c.columnaFecha);
    if (!lotes.length) return null;
    const base: ConsultaArchivo = { tabla: c.tabla, claves: lotes.map((l) => l.clave), desde: c.desde, hasta: c.hasta, columnaFecha: c.columnaFecha, filtros: c.filtros, grupos: c.grupos, ordenPor: c.ordenPor };
    const [filas, total] = await Promise.all([c.limite === 0 ? Promise.resolve([]) : this.lector.consultar({ ...base, limite: c.limite }), this.lector.contar(base)]);
    return { filas, total };
  }

  /**
   * Filas de una tabla HIJA archivada filtradas por una columna de fecha propia (p. ej. el `createdAt` de una línea de consumo), sin
   * pasar por el padre. Los archivos de un hijo se particionan por la fecha de su PADRE, que suele ser cercana pero no igual: por eso
   * los lotes se eligen con una `holgura` alrededor del rango. `null` si ningún lote toca el rango.
   */
  async listarHijos(c: {
    hijo: string;
    columnaFecha: string;
    desde?: Date;
    hasta?: Date;
    holguraMs?: number;
    filtros?: ConsultaHistorica['filtrosArchivo'];
    grupos?: ConsultaArchivo['grupos'];
    ordenPor?: ConsultaArchivo['ordenPor'];
    limite?: number;
  }): Promise<Array<Record<string, unknown>>> {
    if (!TABLAS_ARCHIVABLES.some((t) => t.hijos?.some((h) => h.tabla === c.hijo))) throw new Error(`${c.hijo} no es una tabla hija archivada.`);
    const holgura = c.holguraMs ?? 0;
    const lotes = await this.lotesQueTocan(c.hijo, c.desde ? new Date(c.desde.getTime() - holgura) : undefined, c.hasta ? new Date(c.hasta.getTime() + holgura) : undefined);
    if (!lotes.length) return [];
    return this.lector.consultar({
      tabla: c.hijo,
      claves: lotes.map((l) => l.clave),
      desde: c.desde,
      hasta: c.hasta,
      columnaFecha: c.columnaFecha,
      filtros: c.filtros,
      grupos: c.grupos,
      ordenPor: c.ordenPor,
      limite: c.limite,
    });
  }

  /**
   * Una fila archivada que cumpla estos criterios, o `null`. Con `desde`/`hasta` solo se leen los lotes de esas fechas (los de la
   * fecha del evento): sirve para búsquedas por clave (p. ej. un `clientUuid`) cuando se sabe más o menos de cuándo es la fila.
   */
  async buscarUno(c: { tabla: string; desde?: Date; hasta?: Date; grupos?: ConsultaArchivo['grupos']; filtros?: ConsultaHistorica['filtrosArchivo'] }): Promise<Record<string, unknown> | null> {
    if (!TABLAS_ARCHIVABLES.some((t) => t.tabla === c.tabla)) throw new Error(`La tabla ${c.tabla} no se archiva.`);
    const lotes = await this.lotesQueTocan(c.tabla, c.desde, c.hasta);
    if (!lotes.length) return null;
    const filas = await this.lector.consultar({ tabla: c.tabla, claves: lotes.map((l) => l.clave), grupos: c.grupos, filtros: c.filtros, limite: 1 });
    return filas[0] ?? null;
  }

  /**
   * Los hijos de UNA fila archivada (p. ej. los consumos y evidencias de un servicio). Se buscan solo en los archivos del mes de la
   * fila —el de su fecha del evento— y de su mismo lote, no en todo el archivo: sirve para abrir el detalle de un registro.
   */
  async hijosDeFila(c: { tabla: string; hijo: string; id: string; fechaEvento: Date }): Promise<Array<Record<string, unknown>>> {
    const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === c.tabla);
    const hijo = cfg?.hijos?.find((h) => h.tabla === c.hijo);
    if (!cfg || !hijo) throw new Error(`${c.hijo} no es hija de ${c.tabla}.`);
    const anio = c.fechaEvento.getUTCFullYear();
    const mes = c.fechaEvento.getUTCMonth() + 1;
    const padres = await this.prisma.archivadoLote.findMany({ where: { tabla: c.tabla, estado: 'BORRADO', anio, mes }, select: { grupoId: true } });
    const grupos = [...new Set(padres.map((l) => l.grupoId).filter((g): g is string => !!g))];
    if (!grupos.length) return [];
    const lotes = await this.prisma.archivadoLote.findMany({ where: { tabla: c.hijo, estado: 'BORRADO', grupoId: { in: grupos } }, orderBy: [{ parte: 'asc' }], select: { clave: true } });
    if (!lotes.length) return [];
    return this.lector.consultar({ tabla: c.hijo, claves: lotes.map((l) => l.clave), filtros: { [hijo.fk]: c.id } });
  }

  /**
   * ¿Algún lote ya borrado de la base, de estas tablas, toca el rango? Es una consulta barata (no lee Parquet) para avisar al
   * usuario de que un número no incluye lo archivado. Con `desde`/`hasta` vacíos pregunta por todo el archivo.
   */
  async hayDatosArchivados(tablas: string[], desde?: Date, hasta?: Date): Promise<boolean> {
    const n = await this.prisma.archivadoLote.count({
      where: {
        tabla: { in: tablas },
        estado: 'BORRADO',
        ...(desde ? { fechaMax: { gte: desde } } : {}),
        ...(hasta ? { fechaMin: { lt: hasta } } : {}),
      },
    });
    return n > 0;
  }

  /** Igual que `listarArchivo` pero cuenta las filas por cada valor de `columna`; `null` si ningún lote toca el rango. */
  async contarPorArchivo(c: {
    tabla: string;
    columna: string;
    desde?: Date;
    hasta?: Date;
    columnaFecha?: string;
    filtros?: ConsultaHistorica['filtrosArchivo'];
    grupos?: ConsultaArchivo['grupos'];
  }): Promise<Record<string, number> | null> {
    if (!TABLAS_ARCHIVABLES.some((t) => t.tabla === c.tabla)) throw new Error(`La tabla ${c.tabla} no se archiva.`);
    const lotes = await this.lotesQueTocan(c.tabla, c.desde, c.hasta, !!c.columnaFecha);
    if (!lotes.length) return null;
    return this.lector.contarPor({ tabla: c.tabla, claves: lotes.map((l) => l.clave), desde: c.desde, hasta: c.hasta, columnaFecha: c.columnaFecha, filtros: c.filtros, grupos: c.grupos }, c.columna);
  }

  /** Archivos de una tabla hija: los de los mismos lotes (grupos) que los archivos del padre que tocan el rango. */
  private async lotesDeHijo(tabla: string, hijo: string, desde?: Date, hasta?: Date): Promise<string[]> {
    const padres = await this.prisma.archivadoLote.findMany({
      where: {
        tabla,
        estado: 'BORRADO',
        ...(desde ? { fechaMax: { gte: desde } } : {}),
        ...(hasta ? { fechaMin: { lt: hasta } } : {}),
      },
      select: { grupoId: true },
    });
    const grupos = [...new Set(padres.map((l) => l.grupoId).filter((g): g is string => !!g))];
    if (!grupos.length) return [];
    const lotes = await this.prisma.archivadoLote.findMany({
      where: { tabla: hijo, estado: 'BORRADO', grupoId: { in: grupos } },
      orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { parte: 'asc' }],
      select: { clave: true },
    });
    return lotes.map((l) => l.clave);
  }

  /**
   * Ids de los padres archivados que tienen algún hijo con esos valores (p. ej. los servicios a los que se asignó un operador).
   * Sirve a los filtros que dependen de una tabla hija. Vacío si el rango no toca el archivo.
   */
  async idsDePadresPorHijo(c: { tabla: string; hijo: string; desde?: Date; hasta?: Date; filtros: NonNullable<ConsultaHistorica['filtrosArchivo']> }): Promise<string[]> {
    const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === c.tabla);
    const hijo = cfg?.hijos?.find((h) => h.tabla === c.hijo);
    if (!cfg || !hijo) throw new Error(`${c.hijo} no es hija de ${c.tabla}.`);
    const claves = await this.lotesDeHijo(c.tabla, c.hijo, c.desde, c.hasta);
    if (!claves.length) return [];
    const filas = await this.lector.consultar({ tabla: c.hijo, claves, filtros: c.filtros });
    return [...new Set(filas.map((f) => String(f[hijo.fk])))];
  }

  /** Filas hijas de una lista de padres archivados (p. ej. los operadores asignados a los servicios de una página). */
  async hijosDe(c: { tabla: string; hijo: string; idsPadre: string[]; desde?: Date; hasta?: Date }): Promise<Array<Record<string, unknown>>> {
    const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === c.tabla);
    const hijo = cfg?.hijos?.find((h) => h.tabla === c.hijo);
    if (!cfg || !hijo) throw new Error(`${c.hijo} no es hija de ${c.tabla}.`);
    if (!c.idsPadre.length) return [];
    const claves = await this.lotesDeHijo(c.tabla, c.hijo, c.desde, c.hasta);
    if (!claves.length) return [];
    return this.lector.consultar({ tabla: c.hijo, claves, filtros: { [hijo.fk]: c.idsPadre } });
  }

  /**
   * Solo la parte archivada de una consulta, sin tope de filas y con los hijos de la familia si se piden. Es para quien ya
   * consulta la base por su cuenta (los reportes) y solo necesita sumar lo archivado. Los hijos salen agrupados por tabla y ya
   * limitados a las filas de los padres devueltos. Si ningún lote toca el rango, devuelve vacío sin cargar DuckDB.
   */
  async leerArchivo(c: Omit<ConsultaHistorica, 'dondeDb' | 'limite' | 'offset'> & { conHijos?: boolean }): Promise<{ filas: Array<Record<string, unknown>>; hijos: Record<string, Array<Record<string, unknown>>> }> {
    const cfg = TABLAS_ARCHIVABLES.find((t) => t.tabla === c.tabla);
    if (!cfg) throw new Error(`La tabla ${c.tabla} no se archiva.`);

    const lotes = await this.prisma.archivadoLote.findMany({
      where: {
        tabla: c.tabla,
        estado: 'BORRADO',
        ...(c.desde ? { fechaMax: { gte: c.desde } } : {}),
        ...(c.hasta ? { fechaMin: { lt: c.hasta } } : {}),
      },
      orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { parte: 'asc' }],
      select: { clave: true, grupoId: true },
    });
    if (!lotes.length) return { filas: [], hijos: {} };

    const filas = await this.lector.consultar({ tabla: c.tabla, claves: lotes.map((l) => l.clave), desde: c.desde, hasta: c.hasta, filtros: c.filtrosArchivo, orden: c.orden ?? 'asc' });
    const hijos: Record<string, Array<Record<string, unknown>>> = {};
    if (!c.conHijos || !cfg.hijos?.length) return { filas, hijos };

    // Los archivos de los hijos son los del mismo grupo (mismo lote). Se leen enteros y se quedan solo los de los padres devueltos.
    const grupos = [...new Set(lotes.map((l) => l.grupoId).filter((g): g is string => !!g))];
    const ids = new Set(filas.map((f) => String(f.id)));
    for (const hijo of cfg.hijos) {
      hijos[hijo.tabla] = [];
      if (!filas.length || !grupos.length) continue;
      const lotesHijo = await this.prisma.archivadoLote.findMany({
        where: { tabla: hijo.tabla, estado: 'BORRADO', grupoId: { in: grupos } },
        orderBy: [{ anio: 'asc' }, { mes: 'asc' }, { parte: 'asc' }],
        select: { clave: true },
      });
      if (!lotesHijo.length) continue;
      const todas = await this.lector.consultar({ tabla: hijo.tabla, claves: lotesHijo.map((l) => l.clave), orden: 'asc' });
      hijos[hijo.tabla] = todas.filter((h) => ids.has(String(h[hijo.fk])));
    }
    return { filas, hijos };
  }
}
