/**
 * Valoración de lo que consume un servicio.
 *
 * `Insumo.costoUnitarioUSD` es el precio del ENVASE y las existencias y los consumos se llevan en unidad base (`contenidoNeto` por
 * envase). Para valorar una cantidad en unidad base hay que dividir el precio del envase entre su contenido: eso es el costo de UNA
 * unidad base. Cada consumo guarda ese costo y su total en el momento en que ocurre, así que cambiar luego el precio del insumo no
 * altera lo que costó el servicio (igual que el precio congelado de la OT).
 */
export interface InsumoConCosto {
  costoUnitarioUSD?: unknown;
  contenidoNeto?: unknown;
}

/** Costo de UNA unidad base del insumo (precio del envase ÷ contenido neto). */
export function costoPorUnidadBase(insumo: InsumoConCosto | null | undefined): number {
  const costo = Number(insumo?.costoUnitarioUSD || 0);
  const contenido = Number(insumo?.contenidoNeto) > 0 ? Number(insumo?.contenidoNeto) : 1;
  return costo / contenido;
}

/** Lo que se guarda en el consumo: costo de la unidad base y total de lo consumido (`cantidadBase` en unidad base). */
export function valorarConsumo(insumo: InsumoConCosto | null | undefined, cantidadBase: number): { costoUnitarioUSD: number; costoTotalUSD: number } {
  const unitario = costoPorUnidadBase(insumo);
  return {
    costoUnitarioUSD: Number(unitario.toFixed(6)),
    costoTotalUSD: Number((unitario * Number(cantidadBase || 0)).toFixed(4)),
  };
}

/**
 * Costo de una línea de consumo: el congelado al consumir si lo tiene; si es anterior a ese campo, la cantidad valorada con el
 * costo actual del insumo.
 */
export function costoDeConsumo(linea: { cantidadUsada?: unknown; costoTotalUSD?: unknown; insumo?: InsumoConCosto | null }): number {
  if (linea.costoTotalUSD !== null && linea.costoTotalUSD !== undefined) return Number(linea.costoTotalUSD);
  return Number(linea.cantidadUsada || 0) * costoPorUnidadBase(linea.insumo);
}

/**
 * Pasa una cantidad de la unidad en que está escrita la receta a la unidad PROPIA del insumo, que es en la que se llevan sus
 * existencias y su contenido neto (un insumo en ml con `contenidoNeto` 1000 se descuenta en ml). `factorBase` de cada unidad es su
 * equivalencia con la unidad base de su tipo (ml = 0,001; L = 1): 10 ml de receta sobre un insumo en ml son 10 ml; sobre un insumo
 * en L son 0,01 L. Sin datos de unidad se toma 1.
 */
export function aUnidadDelInsumo(cantidad: number, factorReceta?: unknown, factorInsumo?: unknown): number {
  const fr = Number(factorReceta) > 0 ? Number(factorReceta) : 1;
  const fi = Number(factorInsumo) > 0 ? Number(factorInsumo) : 1;
  return Number(((Number(cantidad) || 0) * fr / fi).toFixed(6));
}
