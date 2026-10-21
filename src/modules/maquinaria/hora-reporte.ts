/**
 * Hora de un reporte hecho desde el teléfono (offline-first).
 *
 * La app guarda el reporte con la hora del teléfono y lo envía cuando hay conexión, así que la hora real del
 * hecho puede ser anterior al envío. Se acepta si es creíble; si el reloj del teléfono está adelantado
 * (más de 5 minutos), reseteado (antes de 2020) o es demasiado antigua, se usa la hora del servidor.
 */
export const TOLERANCIA_RELOJ_ADELANTADO_MS = 5 * 60 * 1000;
export const ANTIGUEDAD_MAXIMA_REPORTE_MS = 14 * 24 * 60 * 60 * 1000;

export function horaDeReporte(valor: string | undefined | null, ahora: Date = new Date()): Date {
  if (!valor) return ahora;
  const reportada = new Date(valor);
  if (isNaN(reportada.getTime()) || reportada.getFullYear() < 2020) return ahora;
  const diff = reportada.getTime() - ahora.getTime();
  if (diff > TOLERANCIA_RELOJ_ADELANTADO_MS) return ahora;
  if (-diff > ANTIGUEDAD_MAXIMA_REPORTE_MS) return ahora;
  return reportada;
}
