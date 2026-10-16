import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import type { AlmacenArchivo } from '../../src/modules/archivado/almacen.js';
import type { ConsultaArchivo } from '../../src/modules/archivado/archivo-lector.js';
import { LectorDuckDb } from '../../src/modules/archivado/lector-duckdb.js';

/**
 * Piezas para probar el archivado de punta a punta sin tocar el bucket real: un almacén en memoria donde se archiva, y un lector
 * DuckDB que lee esos mismos Parquet desde una carpeta del disco.
 */

/** ¿Carga DuckDB en este equipo? Si no (p. ej. Windows con Application Control), las pruebas que lo usan se omiten. */
export const duckdbDisponible: Promise<boolean> = import('@duckdb/node-api').then(
  async (d) => {
    try {
      await (await d.DuckDBInstance.create(':memory:')).connect();
      return true;
    } catch {
      return false;
    }
  },
  () => false,
);

export class AlmacenMemoria implements AlmacenArchivo {
  objetos = new Map<string, Buffer>();
  async put(clave: string, cuerpo: Buffer) {
    this.objetos.set(clave, Buffer.from(cuerpo));
  }
  async get(clave: string) {
    return this.objetos.get(clave) ?? null;
  }
}

/** Escribe en disco los Parquet del almacén (no los manifiestos), con la misma estructura de carpetas del bucket. */
export function volcarAlDisco(almacen: AlmacenMemoria, raiz: string): void {
  for (const [clave, cuerpo] of almacen.objetos) {
    if (!clave.endsWith('.parquet')) continue;
    const ruta = join(raiz, clave);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, cuerpo);
  }
}

/**
 * Las pruebas de archivado comparten la tabla `archivado_lotes` y corren en paralelo: pueden aparecer lotes de otra prueba cuyos
 * archivos solo existen en la memoria de ESA prueba. Este lector lee únicamente los archivos que están en su carpeta. (En
 * producción un lote sin su archivo debe fallar con ruido, y así es.)
 */
export class LectorSoloLocal extends LectorDuckDb {
  constructor(private readonly carpeta: string) {
    super(new ConfigService({ ARCHIVO_RAIZ_LOCAL: carpeta }));
  }
  private propias(c: ConsultaArchivo): ConsultaArchivo {
    return { ...c, claves: c.claves.filter((k) => existsSync(join(this.carpeta, k))) };
  }
  override async consultar(c: ConsultaArchivo) {
    const propia = this.propias(c);
    return propia.claves.length ? super.consultar(propia) : [];
  }
  override async contar(c: ConsultaArchivo) {
    const propia = this.propias(c);
    return propia.claves.length ? super.contar(propia) : 0;
  }
  override async contarPor(c: ConsultaArchivo, columna: string) {
    const propia = this.propias(c);
    return propia.claves.length ? super.contarPor(propia, columna) : {};
  }
}
