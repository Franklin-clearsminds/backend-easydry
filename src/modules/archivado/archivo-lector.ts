export type ValorFiltro = string | number | boolean | null | Array<string | number>;

/** Un criterio sobre una columna: igualdad o pertenencia (`igual`, con null o un arreglo), o texto contenido sin distinguir mayúsculas. */
export type Termino =
  | { columna: string; igual: ValorFiltro }
  | { columna: string; contiene: string }
  /** Igualdad de texto sin distinguir mayúsculas. */
  | { columna: string; igualInsensible: string };

export interface OrdenArchivo {
  columna: string;
  dir: 'asc' | 'desc';
  /** Los nulos van al final en ambos sentidos (como `resolverOrdenSql`). Por defecto, como Postgres: al final en ascendente y al principio en descendente. */
  nulosAlFinal?: boolean;
}

/** Una consulta sobre los Parquet de UNA tabla archivada. */
export interface ConsultaArchivo {
  /** Nombre lógico de la tabla (ver `TABLAS_ARCHIVABLES`). */
  tabla: string;
  /** Archivos exactos a leer (claves del bucket). El llamador ya excluyó los lotes no borrados o fallidos. */
  claves: string[];
  /** Rango de fechas del evento: `desde` incluido, `hasta` excluido. */
  desde?: Date;
  hasta?: Date;
  /**
   * Columna de fecha por la que se filtran `desde` y `hasta` (una columna TIMESTAMP de la tabla). Por defecto, la fecha del evento
   * por la que está particionada. Quien filtra por otra columna debe leer todos los archivos: los rangos de los lotes son los de la
   * fecha del evento.
   */
  columnaFecha?: string;
  /** Igualdad (valor) o pertenencia (arreglo) por columna. Solo columnas de la tabla. */
  filtros?: Record<string, ValorFiltro>;
  /** Cada grupo es un OR de términos y los grupos se combinan con AND (alcance por ubicación, búsqueda por palabras…). */
  grupos?: Termino[][];
  /** Orden por columnas concretas, con los nulos como Postgres (al final en ascendente, al principio en descendente). Sustituye a `orden`. */
  ordenPor?: OrdenArchivo[];
  orden?: 'asc' | 'desc';
  limite?: number;
  offset?: number;
}

/** Lee los Parquet archivados. Las filas salen con la misma forma que las de Prisma (fechas como Date, JSON ya interpretado). */
export interface LectorArchivo {
  consultar(c: ConsultaArchivo): Promise<Array<Record<string, unknown>>>;
  contar(c: ConsultaArchivo): Promise<number>;
  /** Cuántas filas hay por cada valor de `columna` (para resúmenes por estado, tipo…). Ignora `limite`, `offset` y el orden. */
  contarPor(c: ConsultaArchivo, columna: string): Promise<Record<string, number>>;
}

export const LECTOR_ARCHIVO = Symbol('LECTOR_ARCHIVO');
