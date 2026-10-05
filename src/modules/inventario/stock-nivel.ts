/** Niveles de stock que la pantalla de productos muestra y por los que se puede filtrar. */
export const NIVELES_STOCK = ['agotado', 'bajo_minimo', 'moderado', 'optimo'] as const;
export type NivelStock = (typeof NIVELES_STOCK)[number];

/** Filtros aceptados: cada nivel, o `alerta_total` (agotado o bajo el mínimo). */
export const NIVELES_STOCK_FILTRO = [...NIVELES_STOCK, 'alerta_total'] as const;
export type NivelStockFiltro = (typeof NIVELES_STOCK_FILTRO)[number];

/** Orden de gravedad (0 = más grave) para ordenar por alerta. */
export const GRAVEDAD_NIVEL: Record<NivelStock, number> = { agotado: 0, bajo_minimo: 1, moderado: 2, optimo: 3 };

/**
 * Nivel de un insumo según su stock. Misma regla que aplica la web: sin existencias → agotado; hasta el mínimo → bajo
 * mínimo; menos que el óptimo → moderado; si no, óptimo. Sin óptimo definido se toma el doble del mínimo (o 10).
 */
export function nivelStock(stock: unknown, minimo: unknown, optimo: unknown): NivelStock {
  const s = Number(stock) || 0;
  const min = Number(minimo) || 0;
  const opt = Number(optimo) || min * 2 || 10;
  if (s <= 0) return 'agotado';
  if (s <= min) return 'bajo_minimo';
  if (s < opt) return 'moderado';
  return 'optimo';
}

/** ¿El nivel pasa el filtro pedido? */
export function cumpleNivel(nivel: NivelStock, filtro: NivelStockFiltro): boolean {
  return filtro === 'alerta_total' ? nivel === 'agotado' || nivel === 'bajo_minimo' : nivel === filtro;
}
