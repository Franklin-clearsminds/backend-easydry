import { createHash } from 'node:crypto';
import { parquetMetadata, parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import type { Columna } from './archivado.tablas.js';

type Fila = Record<string, unknown>;

/** Convierte el valor de una fila de Prisma al que espera la columna Parquet (JSON como texto, vacío como null). */
function convertir(valor: unknown, columna: Columna): unknown {
  if (valor === undefined || valor === null) return null;
  if (columna.json) return JSON.stringify(valor);
  // Decimal de Prisma: sus cantidades (12 dígitos y 4 decimales) caben exactas en un DOUBLE.
  if (columna.tipo === 'DOUBLE') return Number(valor);
  return valor;
}

/** Escribe las filas como un único archivo Parquet. */
export function escribirParquet(columnas: Columna[], filas: Fila[]): Buffer {
  const buffer = parquetWriteBuffer({
    columnData: columnas.map((c) => ({
      name: c.nombre,
      type: c.tipo,
      data: filas.map((f) => convertir(f[c.nombre], c)),
      nullable: true,
    })),
  });
  return Buffer.from(buffer);
}

const aArrayBuffer = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Número de filas que dice el pie del archivo (no lee los datos). */
export function contarFilas(parquet: Buffer): number {
  return Number(parquetMetadata(aArrayBuffer(parquet)).num_rows);
}

/** Todos los valores de la columna `id`: sirve para borrar de la base exactamente lo que está en el archivo. */
export async function leerIds(parquet: Buffer): Promise<string[]> {
  const filas = await parquetReadObjects({ file: aArrayBuffer(parquet), columns: ['id'] });
  return filas.map((f) => String(f.id));
}

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
