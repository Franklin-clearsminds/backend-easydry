import { CacheService, huella } from '../../common/cache/cache.service.js';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TABLAS_ARCHIVABLES, type Columna } from './archivado.tablas.js';
import type { ConsultaArchivo, LectorArchivo, ValorFiltro } from './archivo-lector.js';

const TTL_ARCHIVO_SEG = 3600;
const MAX_BYTES_CACHE = 2_000_000;

const aTexto = (s: string) => `'${s.replace(/'/g, "''")}'`;
const identificador = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Lee los Parquet con DuckDB embebido. Se carga bajo demanda: en un equipo donde el binario nativo no puede cargarse (por
 * ejemplo Windows con Application Control) la aplicación arranca igual, y solo falla —con un error claro, nunca omitiendo
 * datos— la consulta que de verdad necesita leer el archivo.
 *
 * Origen de los archivos:
 *  - ARCHIVO_RAIZ_LOCAL=<carpeta>: lee de disco (pruebas y desarrollo);
 *  - si no, S3 por `httpfs` con las credenciales ARCHIVO_AWS_* (o las de la aplicación).
 */
@Injectable()
export class LectorDuckDb implements LectorArchivo {
  private readonly logger = new Logger(LectorDuckDb.name);
  private conexion: Promise<any> | null = null;
  private readonly raizLocal: string;
  private readonly bucket: string;

  constructor(
    private readonly config: ConfigService,
    /** Guarda las respuestas: un archivo Parquet archivado no cambia, así que la misma consulta da siempre lo mismo. */
    @Optional() private readonly cache?: CacheService,
  ) {
    this.raizLocal = config.get<string>('ARCHIVO_RAIZ_LOCAL')?.trim() ?? '';
    this.bucket = (config.get<string>('ARCHIVO_S3_BUCKET') || config.get<string>('AWS_S3_BUCKET_NAME') || '').trim();
  }

  async consultar(c: ConsultaArchivo): Promise<Array<Record<string, unknown>>> {
    return this.enCache('filas', c, async () => {
      const { sql, valores, columnas } = this.construir(c, false);
      const filas = await this.ejecutar(sql, valores);
      return filas.map((f) => this.aFormaPrisma(f, columnas));
    });
  }

  async contarPor(c: ConsultaArchivo, columna: string): Promise<Record<string, number>> {
    return this.enCache(`por:${columna}`, c, async () => {
      const { valores, origen, donde, permitidas } = this.construir(c, true);
      if (!permitidas.has(columna)) throw new Error(`La columna ${columna} no existe en ${c.tabla}.`);
      const filas = await this.ejecutar(`SELECT CAST(${identificador(columna)} AS VARCHAR) AS clave, count(*) AS n FROM ${origen}${donde} GROUP BY 1`, valores);
      return Object.fromEntries(filas.map((f) => [String(f.clave), Number(f.n)]));
    });
  }

  async contar(c: ConsultaArchivo): Promise<number> {
    return this.enCache('n', c, async () => {
      const { sql, valores } = this.construir(c, true);
      const filas = await this.ejecutar(sql, valores);
      return Number(filas[0]?.n ?? 0);
    });
  }

  /**
   * Los archivos de un lote archivado nunca cambian (cada lote tiene su propia clave y se reserva una sola vez): la misma consulta
   * sobre los mismos archivos da siempre lo mismo, así que se guarda por huella de la consulta. Abrir Parquet en S3 es lo más caro
   * del sistema; una repetición sale de la caché. Los resultados muy grandes no se guardan.
   */
  private async enCache<T>(tipo: string, c: ConsultaArchivo, calcular: () => Promise<T>): Promise<T> {
    if (!this.cache) return calcular();
    return this.cache.obtenerOCalcular(`archivo:${tipo}:${huella(c)}`, (r) => (JSON.stringify(r).length > MAX_BYTES_CACHE ? 0 : TTL_ARCHIVO_SEG), calcular);
  }

  private construir(c: ConsultaArchivo, soloContar: boolean) {
    // Una tabla hija no tiene fecha propia (va en la partición de su padre): se lee entera y se filtra por la clave foránea.
    const padre = TABLAS_ARCHIVABLES.find((t) => t.tabla === c.tabla);
    const hija = padre ? undefined : TABLAS_ARCHIVABLES.flatMap((t) => t.hijos ?? []).find((h) => h.tabla === c.tabla);
    const cfg = padre ? { columnas: padre.columnas, columnaFecha: padre.columnaFecha as string | null } : hija ? { columnas: hija.columnas, columnaFecha: null } : null;
    if (!cfg) throw new Error(`La tabla ${c.tabla} no se archiva.`);
    if (!cfg.columnaFecha && !c.columnaFecha && (c.desde || c.hasta)) throw new Error(`La tabla ${c.tabla} no tiene fecha propia: se filtra por la de su padre o se indica una columna con \`columnaFecha\`.`);
    if (!c.claves.length) throw new Error('Consulta de archivo sin archivos que leer.');
    const permitidas = new Set(cfg.columnas.map((col) => col.nombre));

    const archivos = c.claves.map((k) => aTexto(this.raizLocal ? `${this.raizLocal.replace(/\/$/, '')}/${k}` : `s3://${this.bucket}/${k}`));
    // Versiones viejas de un archivo pueden no traer columnas nuevas: se rellenan con NULL.
    const origen = `read_parquet([${archivos.join(', ')}], union_by_name = true)`;

    const condiciones: string[] = [];
    const valores: unknown[] = [];
    // Por defecto se filtra por la fecha del evento; quien lo pida puede filtrar por otra columna TIMESTAMP de la tabla.
    if (c.columnaFecha && !permitidas.has(c.columnaFecha)) throw new Error(`La columna ${c.columnaFecha} no existe en ${c.tabla}.`);
    const fecha = c.columnaFecha ? identificador(c.columnaFecha) : cfg.columnaFecha ? identificador(cfg.columnaFecha) : null;
    if (c.desde && fecha) {
      condiciones.push(`${fecha} >= CAST(? AS TIMESTAMP)`);
      valores.push(c.desde.toISOString().replace('Z', ''));
    }
    if (c.hasta && fecha) {
      condiciones.push(`${fecha} < CAST(? AS TIMESTAMP)`);
      valores.push(c.hasta.toISOString().replace('Z', ''));
    }
    for (const [columna, valor] of Object.entries(c.filtros ?? {})) {
      if (!permitidas.has(columna)) throw new Error(`La columna ${columna} no existe en ${c.tabla}.`);
      this.condicion(identificador(columna), valor, condiciones, valores);
    }
    for (const grupo of c.grupos ?? []) {
      const partes: string[] = [];
      for (const t of grupo) {
        if (!permitidas.has(t.columna)) throw new Error(`La columna ${t.columna} no existe en ${c.tabla}.`);
        const col = identificador(t.columna);
        if ('contiene' in t) {
          partes.push(`contains(lower(CAST(${col} AS VARCHAR)), lower(?))`);
          valores.push(t.contiene);
        } else if ('igualInsensible' in t) {
          partes.push(`lower(CAST(${col} AS VARCHAR)) = lower(?)`);
          valores.push(t.igualInsensible);
        } else {
          this.condicion(col, t.igual, partes, valores);
        }
      }
      condiciones.push(partes.length ? `(${partes.join(' OR ')})` : 'FALSE');
    }
    const donde = condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : '';

    if (soloContar) return { sql: `SELECT count(*) AS n FROM ${origen}${donde}`, valores, columnas: cfg.columnas, origen, donde, permitidas };

    const sentido = c.orden === 'asc' ? 'ASC' : 'DESC';
    const limite = c.limite !== undefined ? ` LIMIT ${Math.max(0, Math.floor(c.limite))}` : '';
    const offset = c.offset ? ` OFFSET ${Math.max(0, Math.floor(c.offset))}` : '';
    // Las fechas salen como texto ISO: DuckDB las entrega como objetos propios que no son JSON.
    const proyeccion = cfg.columnas
      .map((col) => (col.tipo === 'TIMESTAMP' ? `strftime(${identificador(col.nombre)}, '%Y-%m-%dT%H:%M:%S.%gZ') AS ${identificador(col.nombre)}` : identificador(col.nombre)))
      .join(', ');
    let orden = `${fecha ? `${fecha} ${sentido}, ` : ''}"id" ${sentido}`;
    if (c.ordenPor?.length) {
      for (const o of c.ordenPor) if (!permitidas.has(o.columna)) throw new Error(`La columna ${o.columna} no existe en ${c.tabla}.`);
      const dirs = c.ordenPor.map((o) => (o.dir === 'asc' ? 'ASC' : 'DESC'));
      // Como Postgres: los nulos van al final en ascendente y al principio en descendente.
      orden = [...c.ordenPor.map((o, i) => `${identificador(o.columna)} ${dirs[i]} NULLS ${o.nulosAlFinal || dirs[i] === 'ASC' ? 'LAST' : 'FIRST'}`), `"id" ${dirs[0]}`].join(', ');
    }
    return {
      sql: `SELECT ${proyeccion} FROM ${origen}${donde} ORDER BY ${orden}${limite}${offset}`,
      valores,
      columnas: cfg.columnas,
      origen,
      donde,
      permitidas,
    };
  }

  private condicion(columna: string, valor: ValorFiltro, condiciones: string[], valores: unknown[]) {
    if (Array.isArray(valor)) {
      if (!valor.length) return void condiciones.push('FALSE');
      condiciones.push(`${columna} IN (${valor.map(() => '?').join(', ')})`);
      valores.push(...valor);
    } else if (valor === null) {
      condiciones.push(`${columna} IS NULL`);
    } else {
      condiciones.push(`${columna} = ?`);
      valores.push(valor);
    }
  }

  private aFormaPrisma(fila: Record<string, unknown>, columnas: Columna[]): Record<string, unknown> {
    const salida: Record<string, unknown> = {};
    for (const col of columnas) {
      const v = fila[col.nombre];
      if (v === null || v === undefined) salida[col.nombre] = null;
      else if (col.tipo === 'TIMESTAMP') salida[col.nombre] = new Date(String(v));
      else if (col.json) salida[col.nombre] = JSON.parse(String(v));
      else if (col.tipo === 'DOUBLE') salida[col.nombre] = Number(v);
      else salida[col.nombre] = v;
    }
    return salida;
  }

  private async ejecutar(sql: string, valores: unknown[]): Promise<Array<Record<string, any>>> {
    const conexion = await this.abrir();
    const resultado = await conexion.runAndReadAll(sql, valores as never);
    return resultado.getRowObjectsJson();
  }

  private abrir(): Promise<any> {
    this.conexion ??= (async () => {
      let duckdb: any;
      try {
        duckdb = await import('@duckdb/node-api');
      } catch (e: any) {
        this.conexion = null;
        throw new Error(`El lector del archivo histórico (DuckDB) no está disponible en este equipo: ${e?.message ?? e}`);
      }
      const instancia = await duckdb.DuckDBInstance.create(':memory:');
      const conexion = await instancia.connect();
      if (!this.raizLocal) await this.configurarS3(conexion);
      return conexion;
    })();
    return this.conexion;
  }

  private async configurarS3(conexion: any): Promise<void> {
    const leer = (...n: string[]) => n.map((k) => this.config.get<string>(k)?.trim()).find(Boolean) ?? '';
    await conexion.run('INSTALL httpfs');
    await conexion.run('LOAD httpfs');
    const clave = leer('ARCHIVO_AWS_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID');
    const secreto = leer('ARCHIVO_AWS_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY');
    const endpoint = leer('AWS_ENDPOINT', 'AWS_S3_ENDPOINT').replace(/^https?:\/\//, '');
    const partes = [
      'TYPE S3',
      `REGION ${aTexto(leer('AWS_REGION') || 'us-east-1')}`,
      ...(clave && secreto ? [`KEY_ID ${aTexto(clave)}`, `SECRET ${aTexto(secreto)}`] : []),
      ...(endpoint ? [`ENDPOINT ${aTexto(endpoint)}`, 'URL_STYLE \'path\'', `USE_SSL ${this.config.get<string>('AWS_ENDPOINT')?.startsWith('https') ? 'true' : 'false'}`] : []),
    ];
    await conexion.run(`CREATE OR REPLACE SECRET archivo_s3 (${partes.join(', ')})`);
    this.logger.log('Lector del archivo histórico listo (S3 por httpfs).');
  }
}
