/**
 * Periodos de los reportes. Todo se calcula con el calendario de Ecuador (UTC-5, sin horario de verano) para que «hoy» y los
 * límites de un día no dependan de la zona horaria del servidor. Las fechas viajan como `YYYY-MM-DD`; solo al consultar la base
 * se convierten a instantes.
 */

export type ModoPeriodo = 'HOY' | 'SEMANA' | 'MES' | 'ANIO' | 'DIA' | 'SEMANA_DE' | 'MES_DE' | 'ANIO_DE' | 'RANGO';

export interface FiltroPeriodo {
  modo: ModoPeriodo;
  /** DIA y SEMANA_DE: cualquier día de la semana elegida. */
  fecha?: string;
  /** MES_DE: `YYYY-MM`. */
  mes?: string;
  /** ANIO_DE. */
  anio?: number;
  /** RANGO. */
  desde?: string;
  hasta?: string;
}

export interface RangoResuelto {
  /** Inclusivos, `YYYY-MM-DD`. */
  desde: string;
  hasta: string;
  etiqueta: string;
}

export type DivisionPeriodo = 'MES' | 'SEMANA' | 'DIA' | 'UNICO';

export interface BloquePeriodo {
  clave: string;
  etiqueta: string;
  desde: string;
  hasta: string;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIA_MS = 86_400_000;
const OFFSET_EC_MS = 5 * 3_600_000;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Mayor tamaño de un rango (en días) que se reparte por semanas; más allá se reparte por meses. */
const MAX_DIAS_POR_SEMANAS = 62;

const aUtc = (iso: string): number => Date.parse(`${iso}T12:00:00Z`);
const deUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const sumarDias = (iso: string, dias: number): string => deUtc(aUtc(iso) + dias * DIA_MS);
const diasEntre = (desde: string, hasta: string): number => Math.round((aUtc(hasta) - aUtc(desde)) / DIA_MS) + 1;
const pad = (n: number): string => String(n).padStart(2, '0');

export function fechaValida(iso: string | undefined | null): iso is string {
  if (!iso || !RE_FECHA.test(iso)) return false;
  return deUtc(aUtc(iso)) === iso;
}

/** Fecha de hoy en Ecuador. */
export function hoyEcuador(ahora: Date = new Date()): string {
  return deUtc(ahora.getTime() - OFFSET_EC_MS);
}

/** Fecha (Ecuador) de un instante guardado en la base. */
export function fechaEcuador(instante: Date): string {
  return deUtc(instante.getTime() - OFFSET_EC_MS);
}

/** Hora `HH:mm` (Ecuador) de un instante. */
export function horaEcuador(instante: Date): string {
  const d = new Date(instante.getTime() - OFFSET_EC_MS);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Primer instante del día (Ecuador). */
export function inicioDeDia(iso: string): Date {
  return new Date(`${iso}T00:00:00-05:00`);
}

/** Primer instante del día siguiente: úsalo con `lt`. */
export function finDeDia(iso: string): Date {
  return inicioDeDia(sumarDias(iso, 1));
}

/** Lunes de la semana que contiene la fecha. */
export function lunesDe(iso: string): string {
  const dia = new Date(aUtc(iso)).getUTCDay();
  return sumarDias(iso, dia === 0 ? -6 : 1 - dia);
}

const ultimoDiaDelMes = (anio: number, mes: number): number => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

export function etiquetaDia(iso: string): string {
  const d = new Date(aUtc(iso));
  return `${pad(d.getUTCDate())} ${MESES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
}

function etiquetaRango(desde: string, hasta: string): string {
  return desde === hasta ? etiquetaDia(desde) : `${etiquetaDia(desde)} al ${etiquetaDia(hasta)}`;
}

/** Convierte el filtro del usuario en un rango de fechas. Lanza `Error` con un mensaje legible si el filtro no es válido. */
export function resolverRango(filtro: FiltroPeriodo, ahora: Date = new Date()): RangoResuelto {
  const hoy = hoyEcuador(ahora);
  switch (filtro.modo) {
    case 'HOY':
      return { desde: hoy, hasta: hoy, etiqueta: `Hoy · ${etiquetaDia(hoy)}` };
    case 'SEMANA': {
      const desde = lunesDe(hoy);
      const hasta = sumarDias(desde, 6);
      return { desde, hasta, etiqueta: `Esta semana · ${etiquetaRango(desde, hasta)}` };
    }
    case 'MES': {
      const [a, m] = hoy.split('-').map(Number);
      return { desde: `${a}-${pad(m)}-01`, hasta: `${a}-${pad(m)}-${pad(ultimoDiaDelMes(a, m))}`, etiqueta: `Este mes · ${MESES[m - 1]} ${a}` };
    }
    case 'ANIO': {
      const a = Number(hoy.slice(0, 4));
      return { desde: `${a}-01-01`, hasta: `${a}-12-31`, etiqueta: `Este año · ${a}` };
    }
    case 'DIA': {
      if (!fechaValida(filtro.fecha)) throw new Error('Elige el día del reporte.');
      return { desde: filtro.fecha, hasta: filtro.fecha, etiqueta: etiquetaDia(filtro.fecha) };
    }
    case 'SEMANA_DE': {
      if (!fechaValida(filtro.fecha)) throw new Error('Elige la semana del reporte.');
      const desde = lunesDe(filtro.fecha);
      const hasta = sumarDias(desde, 6);
      return { desde, hasta, etiqueta: `Semana del ${etiquetaRango(desde, hasta)}` };
    }
    case 'MES_DE': {
      if (!filtro.mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(filtro.mes)) throw new Error('Elige el mes del reporte.');
      const [a, m] = filtro.mes.split('-').map(Number);
      return { desde: `${a}-${pad(m)}-01`, hasta: `${a}-${pad(m)}-${pad(ultimoDiaDelMes(a, m))}`, etiqueta: `${MESES[m - 1]} ${a}` };
    }
    case 'ANIO_DE': {
      const a = Number(filtro.anio);
      if (!Number.isInteger(a) || a < 2000 || a > 2100) throw new Error('Elige el año del reporte.');
      return { desde: `${a}-01-01`, hasta: `${a}-12-31`, etiqueta: `Año ${a}` };
    }
    case 'RANGO': {
      if (!fechaValida(filtro.desde) || !fechaValida(filtro.hasta)) throw new Error('Indica las fechas inicial y final del rango.');
      if (filtro.hasta < filtro.desde) throw new Error('La fecha final no puede ser anterior a la inicial.');
      return { desde: filtro.desde, hasta: filtro.hasta, etiqueta: etiquetaRango(filtro.desde, filtro.hasta) };
    }
    default:
      throw new Error('Periodo no válido.');
  }
}

/** Cómo se reparte un rango: año (y rangos largos) en meses, mes en semanas, semana en días y un solo día sin dividir. */
export function divisionDe(rango: Pick<RangoResuelto, 'desde' | 'hasta'>): DivisionPeriodo {
  const dias = diasEntre(rango.desde, rango.hasta);
  if (dias <= 1) return 'UNICO';
  if (dias <= 7) return 'DIA';
  if (dias <= MAX_DIAS_POR_SEMANAS) return 'SEMANA';
  return 'MES';
}

/** Bloques consecutivos que cubren el rango completo (los extremos quedan recortados al rango pedido). */
export function dividirRango(rango: Pick<RangoResuelto, 'desde' | 'hasta'>): { division: DivisionPeriodo; bloques: BloquePeriodo[] } {
  const division = divisionDe(rango);
  const bloques: BloquePeriodo[] = [];

  if (division === 'UNICO') {
    bloques.push({ clave: rango.desde, etiqueta: etiquetaDia(rango.desde), desde: rango.desde, hasta: rango.hasta });
  } else if (division === 'DIA') {
    for (let d = rango.desde; d <= rango.hasta; d = sumarDias(d, 1)) {
      const nombre = DIAS[new Date(aUtc(d)).getUTCDay()];
      bloques.push({ clave: d, etiqueta: `${nombre[0].toUpperCase()}${nombre.slice(1)} ${etiquetaDia(d)}`, desde: d, hasta: d });
    }
  } else if (division === 'SEMANA') {
    for (let lunes = lunesDe(rango.desde); lunes <= rango.hasta; lunes = sumarDias(lunes, 7)) {
      const desde = lunes < rango.desde ? rango.desde : lunes;
      const domingo = sumarDias(lunes, 6);
      const hasta = domingo > rango.hasta ? rango.hasta : domingo;
      bloques.push({ clave: lunes, etiqueta: `Semana del ${etiquetaRango(desde, hasta)}`, desde, hasta });
    }
  } else {
    let [a, m] = rango.desde.split('-').map(Number);
    const [af, mf] = rango.hasta.split('-').map(Number);
    while (a < af || (a === af && m <= mf)) {
      const inicioMes = `${a}-${pad(m)}-01`;
      const finMes = `${a}-${pad(m)}-${pad(ultimoDiaDelMes(a, m))}`;
      bloques.push({
        clave: `${a}-${pad(m)}`,
        etiqueta: `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${a}`,
        desde: inicioMes < rango.desde ? rango.desde : inicioMes,
        hasta: finMes > rango.hasta ? rango.hasta : finMes,
      });
      m += 1;
      if (m > 12) {
        m = 1;
        a += 1;
      }
    }
  }
  return { division, bloques };
}
