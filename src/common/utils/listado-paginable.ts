import { PaginacionOpcionalDto, buildDataGridResponse } from '../dto/data-grid.dto.js';
import { OrdenColumnas, paginacionListado, resolverOrden } from './data-grid.helpers.js';

export interface ConfigListadoPaginable<T> {
  /** Filtros ya combinados (búsqueda incluida). */
  where: Record<string, unknown>;
  /** Columnas públicas por las que se puede ordenar. */
  columnas: OrdenColumnas;
  /** Orden que ya tenía el listado; solo lo usa el modo heredado. */
  ordenHeredado: unknown[];
  /** Orden por defecto del modo paginado (lo más reciente primero: columna `fecha`). */
  defecto?: { campo: string; dir: 'asc' | 'desc' };
  buscar: (args: { where: any; orderBy: any; skip: number; take: number }) => Promise<T[]>;
  contar: (where: any) => Promise<number>;
  /** Transformación de cada página (por ejemplo, agregar campos calculados). */
  mapear?: (items: T[]) => any[] | Promise<any[]>;
}

/**
 * Listado con modo heredado: sin `page` ni `pageSize` responde un arreglo (hasta 100, en el orden de siempre); con alguno
 * responde `{ items, total, page, pageSize, … }` con el orden pedido (lista permitida) y por defecto el más reciente primero.
 */
export async function listarPaginable<T>(dto: PaginacionOpcionalDto, cfg: ConfigListadoPaginable<T>): Promise<any> {
  const { page, pageSize, skip, take, paginado } = paginacionListado(dto);
  const transformar = cfg.mapear ?? ((items: T[]) => items);
  if (!paginado) {
    return transformar(await cfg.buscar({ where: cfg.where, orderBy: cfg.ordenHeredado, skip: 0, take }));
  }
  const orderBy = resolverOrden(dto.sortField, dto.sortOrder, cfg.columnas, cfg.defecto ?? { campo: 'fecha', dir: 'desc' });
  const [items, total] = await Promise.all([
    cfg.buscar({ where: cfg.where, orderBy, skip, take }),
    cfg.contar(cfg.where),
  ]);
  return buildDataGridResponse(await transformar(items), total, page, pageSize);
}
