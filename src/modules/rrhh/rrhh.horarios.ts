/**
 * Reglas puras de los horarios del personal (sin base de datos): qué horario rige un día, en qué ventana se puede timbrar,
 * si una marca es Entrada o Salida y cómo se evalúa el cumplimiento de un día.
 *
 * Los horarios y los ajustes son versiones inmutables con una fecha de inicio: un cambio rige desde mañana y los días pasados se
 * evalúan siempre con la versión que regía ese día.
 */

/** Lunes = 0 … domingo = 6. */
export const DIAS_SEMANA = 7;
export const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const;

export interface DiaHorario {
  /** false = día libre: no se puede timbrar y no genera registro. */
  trabaja: boolean;
  /** HH:mm */
  entrada: string;
  /** HH:mm */
  salida: string;
}
export type SemanaHorario = DiaHorario[];

/** Horario con el que parte todo el personal: 08:00 a 15:00 los siete días. */
export const HORARIO_POR_DEFECTO: SemanaHorario = Array.from({ length: DIAS_SEMANA }, () => ({ trabaja: true, entrada: '08:00', salida: '15:00' }));

export interface AjusteHorario {
  /** Minutos de gracia antes y después de la hora del horario: dentro de ellos la marca es puntual. */
  toleranciaMin: number;
  /** Minutos antes y después de la hora del horario en los que se puede timbrar. Fuera de la ventana no se deja timbrar. */
  ventanaMin: number;
}

export const TOLERANCIA_MIN_PERMITIDA = 5;
export const TOLERANCIA_MAX_PERMITIDA = 20;
export const TOLERANCIA_POR_DEFECTO = 10;
export const VENTANA_MIN_PERMITIDA = 0;
export const VENTANA_MAX_PERMITIDA = 120;
export const VENTANA_POR_DEFECTO = 120;
export const AJUSTE_POR_DEFECTO: AjusteHorario = { toleranciaMin: TOLERANCIA_POR_DEFECTO, ventanaMin: VENTANA_POR_DEFECTO };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const aMinutos = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const aHHMM = (minutos: number): string => {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Valida una semana de horario; devuelve el mensaje del primer problema o null si está bien. */
export function validarSemana(semana: unknown): string | null {
  if (!Array.isArray(semana) || semana.length !== DIAS_SEMANA) return 'El horario debe traer los 7 días de la semana (lunes a domingo).';
  for (let i = 0; i < DIAS_SEMANA; i++) {
    const d = semana[i] as Partial<DiaHorario> | null;
    if (!d || typeof d.trabaja !== 'boolean' || typeof d.entrada !== 'string' || typeof d.salida !== 'string') return `El ${NOMBRES_DIA[i]} no tiene un horario válido.`;
    if (!HHMM.test(d.entrada) || !HHMM.test(d.salida)) return `El ${NOMBRES_DIA[i]} debe tener horas en formato HH:mm.`;
    if (d.trabaja && aMinutos(d.entrada) >= aMinutos(d.salida)) return `El ${NOMBRES_DIA[i]}: la salida debe ser posterior a la entrada (no se admiten turnos que cruzan la medianoche).`;
  }
  return null;
}

/** Valida el ajuste general; devuelve el mensaje del primer problema o null si está bien. */
export function validarAjuste(a: Partial<AjusteHorario>): string | null {
  const { toleranciaMin: t, ventanaMin: v } = a;
  if (!Number.isInteger(t) || (t as number) < TOLERANCIA_MIN_PERMITIDA || (t as number) > TOLERANCIA_MAX_PERMITIDA) {
    return `La tolerancia debe ser un número entero de minutos entre ${TOLERANCIA_MIN_PERMITIDA} y ${TOLERANCIA_MAX_PERMITIDA}.`;
  }
  if (!Number.isInteger(v) || (v as number) < VENTANA_MIN_PERMITIDA || (v as number) > VENTANA_MAX_PERMITIDA) {
    return `La ventana de timbrada debe ser un número entero de minutos entre ${VENTANA_MIN_PERMITIDA} y ${VENTANA_MAX_PERMITIDA}.`;
  }
  if ((v as number) < (t as number)) return 'La ventana de timbrada no puede ser menor que la tolerancia.';
  return null;
}

// ───────────────────────── Fechas ─────────────────────────

/** Índice del día de la semana de un `AAAA-MM-DD` (lunes = 0 … domingo = 6). */
export function indiceDiaSemana(dia: string): number {
  return (new Date(`${dia}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

export function sumarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────── Versiones ─────────────────────────

export interface Versionado {
  vigenteDesde: Date | string;
  createdAt: Date | string;
}
const diaDe = (v: Date | string): string => (typeof v === 'string' ? v : v.toISOString()).slice(0, 10);

/** La versión que rige un día: la de fecha de inicio más reciente que no pase de ese día (a igual fecha, la última que se guardó). */
export function versionVigente<T extends Versionado>(versiones: readonly T[], dia: string): T | null {
  let mejor: T | null = null;
  for (const v of versiones) {
    if (diaDe(v.vigenteDesde) > dia) continue;
    if (!mejor) { mejor = v; continue; }
    const a = diaDe(v.vigenteDesde);
    const b = diaDe(mejor.vigenteDesde);
    if (a > b || (a === b && new Date(v.createdAt).getTime() >= new Date(mejor.createdAt).getTime())) mejor = v;
  }
  return mejor;
}

// ───────────────────────── Qué marca es ─────────────────────────

export type TipoMarca = 'ENTRADA' | 'SALIDA';

export interface Ventanas {
  entrada: { desde: string; hasta: string };
  salida: { desde: string; hasta: string };
}

export function ventanasDe(dia: DiaHorario, ajuste: AjusteHorario): Ventanas {
  const e = aMinutos(dia.entrada);
  const s = aMinutos(dia.salida);
  const v = ajuste.ventanaMin;
  return {
    entrada: { desde: aHHMM(Math.max(0, e - v)), hasta: aHHMM(Math.min(1439, e + v)) },
    salida: { desde: aHHMM(Math.max(0, s - v)), hasta: aHHMM(Math.min(1439, s + v)) },
  };
}

export type ResultadoMarca =
  | { ok: true; tipo: TipoMarca }
  | { ok: false; motivo: 'DIA_LIBRE' | 'FUERA_DE_VENTANA' | 'YA_REGISTRADA'; mensaje: string };

/**
 * Decide si una marca es Entrada o Salida según la hora del horario a la que cae más cerca, dentro de la ventana. Si las ventanas
 * se solapan gana la hora más cercana; tras una entrada solo cabe una salida y nunca hay más de una de cada tipo por día.
 */
export function resolverMarca(dia: DiaHorario, ajuste: AjusteHorario, minutoActual: number, ya: { entrada: boolean; salida: boolean }): ResultadoMarca {
  if (!dia.trabaja) return { ok: false, motivo: 'DIA_LIBRE', mensaje: 'Hoy no es un día de trabajo en tu horario, así que no se puede timbrar.' };
  const e = aMinutos(dia.entrada);
  const s = aMinutos(dia.salida);
  const v = ajuste.ventanaMin;
  const candidatos: Array<{ tipo: TipoMarca; distancia: number }> = [];
  if (Math.abs(minutoActual - e) <= v) candidatos.push({ tipo: 'ENTRADA', distancia: Math.abs(minutoActual - e) });
  if (Math.abs(minutoActual - s) <= v) candidatos.push({ tipo: 'SALIDA', distancia: Math.abs(minutoActual - s) });

  if (candidatos.length === 0) {
    const w = ventanasDe(dia, ajuste);
    return {
      ok: false,
      motivo: 'FUERA_DE_VENTANA',
      mensaje: `Fuera del horario para timbrar. La entrada se marca de ${w.entrada.desde} a ${w.entrada.hasta} y la salida de ${w.salida.desde} a ${w.salida.hasta}.`,
    };
  }
  const libres = candidatos.filter((c) => (c.tipo === 'ENTRADA' ? !ya.entrada : !ya.salida)).sort((a, b) => a.distancia - b.distancia);
  if (libres.length === 0) {
    const tipo = candidatos.sort((a, b) => a.distancia - b.distancia)[0].tipo;
    return { ok: false, motivo: 'YA_REGISTRADA', mensaje: tipo === 'ENTRADA' ? 'Ya registraste tu entrada de hoy.' : 'Ya registraste tu salida de hoy.' };
  }
  return { ok: true, tipo: libres[0].tipo };
}

// ───────────────────────── Evaluación del día ─────────────────────────

export type EstadoDia =
  | 'SIN_HORARIO' // el día es anterior a que existan horarios, o a que la persona existiera
  | 'DIA_LIBRE'
  | 'PENDIENTE' // hoy y aún no termina la ventana de entrada
  | 'EN_CURSO' // hoy, con entrada, y aún no termina la ventana de salida
  | 'SIN_MARCA' // día laboral sin ninguna marca
  | 'INCOMPLETO' // falta la entrada o la salida
  | 'CUMPLE'
  | 'ATRASO'
  | 'ENTRADA_TEMPRANA'
  | 'SALIDA_ANTICIPADA'
  | 'SALIDA_TARDIA';

export interface EvaluacionDia {
  estado: EstadoDia;
  /** Todo lo que se salió del horario (un día puede tener, por ejemplo, atraso y salida tardía). */
  observaciones: EstadoDia[];
  horario: { entrada: string; salida: string } | null;
  entradaReal: string | null;
  salidaReal: string | null;
  /** Minutos respecto a la hora del horario: positivo = después, negativo = antes. */
  minutosEntrada: number | null;
  minutosSalida: number | null;
  /** Salida real menos entrada real, en horas. */
  horasReales: number | null;
  /** Solo el tiempo trabajado dentro del horario, en horas. */
  horasDentroHorario: number | null;
}

const horas = (minutos: number) => Math.round((minutos / 60) * 100) / 100;

const VACIA: Omit<EvaluacionDia, 'estado' | 'observaciones'> = {
  horario: null, entradaReal: null, salidaReal: null, minutosEntrada: null, minutosSalida: null, horasReales: null, horasDentroHorario: null,
};

export interface EntradaEvaluacion {
  /** null = no había horario ese día (antes de la activación o de que existiera la persona). */
  dia: DiaHorario | null;
  ajuste: AjusteHorario | null;
  /** Minuto del día (hora de Ecuador) de cada marca. */
  entradaMin: number | null;
  salidaMin: number | null;
  /** Solo para hoy: el minuto actual, para no dar por faltante lo que todavía puede marcarse. */
  ahoraMin?: number | null;
}

export function evaluarDia(x: EntradaEvaluacion): EvaluacionDia {
  const { dia, ajuste, entradaMin, salidaMin } = x;
  const base = { ...VACIA, entradaReal: entradaMin != null ? aHHMM(entradaMin) : null, salidaReal: salidaMin != null ? aHHMM(salidaMin) : null };
  if (!dia || !ajuste) return { ...base, estado: 'SIN_HORARIO', observaciones: [] };

  const e = aMinutos(dia.entrada);
  const s = aMinutos(dia.salida);
  const comunes = { ...base, horario: { entrada: dia.entrada, salida: dia.salida } };
  const realesMin = entradaMin != null && salidaMin != null && salidaMin > entradaMin ? salidaMin - entradaMin : null;
  const dentroMin = realesMin != null ? Math.max(0, Math.min(salidaMin as number, s) - Math.max(entradaMin as number, e)) : null;
  const con = {
    ...comunes,
    minutosEntrada: entradaMin != null ? entradaMin - e : null,
    minutosSalida: salidaMin != null ? salidaMin - s : null,
    horasReales: realesMin != null ? horas(realesMin) : null,
    horasDentroHorario: dentroMin != null ? horas(dentroMin) : null,
  };

  if (!dia.trabaja) return { ...con, estado: 'DIA_LIBRE', observaciones: [] };
  if (entradaMin == null && salidaMin == null) {
    if (x.ahoraMin != null && x.ahoraMin <= e + ajuste.ventanaMin) return { ...comunes, estado: 'PENDIENTE', observaciones: [] };
    return { ...comunes, estado: 'SIN_MARCA', observaciones: [] };
  }
  if (entradaMin == null || salidaMin == null) {
    if (entradaMin != null && x.ahoraMin != null && x.ahoraMin <= s + ajuste.ventanaMin) return { ...con, estado: 'EN_CURSO', observaciones: [] };
    return { ...con, estado: 'INCOMPLETO', observaciones: [] };
  }

  const t = ajuste.toleranciaMin;
  const observaciones: EstadoDia[] = [];
  if (entradaMin > e + t) observaciones.push('ATRASO');
  if (salidaMin < s - t) observaciones.push('SALIDA_ANTICIPADA');
  if (entradaMin < e - t) observaciones.push('ENTRADA_TEMPRANA');
  if (salidaMin > s + t) observaciones.push('SALIDA_TARDIA');
  return { ...con, estado: observaciones[0] ?? 'CUMPLE', observaciones };
}
