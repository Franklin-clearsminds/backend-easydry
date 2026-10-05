import { startOfDay } from '../../modules/maquinaria/maquinaria.permisos.js';

export type ReglaLimpieza = 'AGENCIA' | 'PULIDOR' | null;

/**
 * Regla vigente de una máquina según a quién está asignada hoy (no según su tipo): con pulidor
 * asignado, diaria; si no, con agencia, 2x/semana (miércoles y sábado); sin ninguna de las dos
 * (p. ej. en un taller), no aplica ninguna regla. Compartido entre `MaquinariaService` y el cron
 * de recordatorio/escalación de limpieza (`maintenance-cron.service.ts`).
 */
export function reglaLimpieza(m: { agenciaId: string | null; operadorAsignadoId: string | null }): ReglaLimpieza {
  if (m.operadorAsignadoId) return 'PULIDOR';
  if (m.agenciaId) return 'AGENCIA';
  return null;
}

/** Miércoles (3) y sábado (6) más reciente, incluyendo hoy si hoy ya es uno de esos días. */
export function ultimoDiaDebidoAgencia(hoy: Date): Date {
  const base = startOfDay(hoy);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 3 || d.getDay() === 6) return d;
  }
  return base; // inalcanzable: siempre hay un miércoles o sábado en los últimos 7 días
}

/** `true` si la última limpieza registrada es anterior al último día que tocaba cumplir la regla. */
export function limpiezaAtrasada(regla: ReglaLimpieza, ultimaFecha: Date | null, ahora: Date): boolean {
  if (!regla) return false;
  const debida = regla === 'PULIDOR' ? startOfDay(ahora) : ultimoDiaDebidoAgencia(ahora);
  return !ultimaFecha || startOfDay(ultimaFecha).getTime() < debida.getTime();
}

/** `true` si hoy es un día en el que corresponde limpiar según la regla (para el recordatorio). */
export function esHoyDiaDebido(regla: ReglaLimpieza, hoy: Date): boolean {
  if (!regla) return false;
  if (regla === 'PULIDOR') return true; // diaria
  const dia = hoy.getDay();
  return dia === 3 || dia === 6; // miércoles o sábado
}
