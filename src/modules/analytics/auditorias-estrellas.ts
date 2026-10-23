/**
 * Puntuación en estrellas (de 0 a 5, con medias) de las dos auditorías:
 *  - Informe de inspección: Excelente 5 · Bueno 4 · Regular 2,5 · Malo 1.
 *  - Auditoría 5S: porcentaje ÷ 20, redondeado a la media estrella más cercana (87 % → 4,5).
 */
export const ESTRELLAS_INFORME: Record<string, number> = { EXCELENTE: 5, BUENO: 4, REGULAR: 2.5, MALO: 1 };

export const CALIFICACIONES_INFORME = ['EXCELENTE', 'BUENO', 'REGULAR', 'MALO'] as const;

export function estrellasDeInforme(calificacion?: string | null): number | null {
  return calificacion && calificacion in ESTRELLAS_INFORME ? ESTRELLAS_INFORME[calificacion] : null;
}

export function estrellasDe5s(porcentaje?: number | null): number | null {
  if (typeof porcentaje !== 'number' || !Number.isFinite(porcentaje)) return null;
  const estrellas = Math.round((porcentaje / 20) * 2) / 2;
  return Math.min(5, Math.max(0, estrellas));
}

/** Promedio con un decimal; null si no hay valores. */
export function promedioEstrellas(valores: readonly (number | null | undefined)[]): number | null {
  const v = valores.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}
