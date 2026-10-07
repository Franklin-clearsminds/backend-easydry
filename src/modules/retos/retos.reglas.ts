/**
 * Reglas de un reto parametrizable, sin acceso a datos: qué opciones son válidas y cómo se arma el ranking.
 *
 * Un reto se define con cinco piezas: quiénes compiten (tipoReto), qué servicios cuentan (tipoServicios), dónde
 * (regiones, clientes, agencias, bahías), qué se mide (metrica) y cómo se gana (modoGanador).
 */

export const PARTICIPANTES_RETO = ['AGENCIA', 'BAHIA', 'LAVADOR', 'PULIDOR'] as const;
export type ParticipanteReto = (typeof PARTICIPANTES_RETO)[number];

export const TIPOS_SERVICIO_RETO = ['TODOS', 'GENERALES', 'ESPECIALES', 'ESPECIFICOS'] as const;
export type TipoServicioReto = (typeof TIPOS_SERVICIO_RETO)[number];

export const METRICAS_RETO = ['SERVICIOS', 'AUTOS', 'MONTO'] as const;
export type MetricaReto = (typeof METRICAS_RETO)[number];

export const MODOS_GANADOR = ['RANKING', 'META'] as const;
export type ModoGanador = (typeof MODOS_GANADOR)[number];

/** Los lavadores solo hacen servicios generales y los pulidores solo especiales; agencias y bahías tienen de los dos. */
export const TIPOS_SERVICIO_POR_PARTICIPANTE: Record<ParticipanteReto, readonly TipoServicioReto[]> = {
  AGENCIA: TIPOS_SERVICIO_RETO,
  BAHIA: TIPOS_SERVICIO_RETO,
  LAVADOR: ['GENERALES', 'ESPECIFICOS'],
  PULIDOR: ['ESPECIALES', 'ESPECIFICOS'],
};

/** Categoría del catálogo que puede elegirse como servicio específico (sin restricción para agencias y bahías). */
export const CATEGORIA_POR_PARTICIPANTE: Partial<Record<ParticipanteReto, 'GENERAL' | 'ESPECIAL'>> = {
  LAVADOR: 'GENERAL',
  PULIDOR: 'ESPECIAL',
};

/** Qué fuentes de servicios hay que leer. */
export function fuentesDeServicios(tipo: TipoServicioReto): { generales: boolean; especiales: boolean } {
  return { generales: tipo !== 'ESPECIALES', especiales: tipo !== 'GENERALES' };
}

/** Ecuador continental está siempre en UTC-5 (sin horario de verano). */
const DESFASE_ECUADOR_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Día calendario (fecha guardada a medianoche UTC) → instante en que empieza ese día en Ecuador. */
function inicioDiaEcuador(fecha: Date): Date {
  const dia = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return new Date(dia + DESFASE_ECUADOR_MS);
}

/** Instantes que cubre el reto: desde el inicio del primer día hasta el final del último, en hora de Ecuador. */
export function rangoReto(fechaInicio: Date, fechaFin: Date): { desde: Date; hasta: Date } {
  return { desde: inicioDiaEcuador(fechaInicio), hasta: new Date(inicioDiaEcuador(fechaFin).getTime() + DIA_MS) };
}

/** Fecha de hoy en Ecuador, a medianoche UTC (el mismo formato con que se guardan fechaInicio y fechaFin). */
export function hoyEcuador(ahora = new Date()): Date {
  const local = new Date(ahora.getTime() - DESFASE_ECUADOR_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Un servicio que cuenta para el reto, ya atribuido a sus participantes. */
export interface ServicioContado {
  participantes: string[];
  placa: string;
  monto: number;
  fin: Date;
  /** Quiénes hicieron el servicio (operador y asignados). */
  operadores?: string[];
}

/** Persona que trabajó para un participante (p. ej. el lavador de una bahía). `servicios: null` = asignada, sin servicios aún. */
export interface PersonaEnFila {
  id: string;
  nombre: string;
  servicios: number | null;
}

export interface ParticipanteRanking {
  id: string;
  nombre: string;
  detalle?: string;
  agenciaId?: string | null;
  regionId?: string | null;
}

export interface FilaRanking {
  posicion: number;
  participanteId: string;
  nombre: string;
  detalle?: string;
  valor: number;
  /** Cuándo llegó a su valor actual: decide los empates (gana quien llegó primero). */
  alcanzadoEn: string | null;
  gana: boolean;
  agenciaId?: string | null;
  regionId?: string | null;
  personas?: PersonaEnFila[];
}

export interface ReglasGanador {
  metrica: MetricaReto;
  modoGanador: ModoGanador;
  cantidadGanadores: number;
  meta: number | null;
}

/**
 * Ranking del reto. Cada participante acumula su valor en orden cronológico y se anota cuándo llegó a su valor final;
 * a igual valor va primero quien llegó antes (si A y B terminan con 7, gana el que completó su 7.º primero).
 */
export function calcularRanking(
  participantes: ParticipanteRanking[],
  servicios: ServicioContado[],
  reglas: ReglasGanador,
): FilaRanking[] {
  const acumulado = new Map<string, { valor: number; alcanzadoEn: Date | null; placas: Set<string> }>(
    participantes.map((p) => [p.id, { valor: 0, alcanzadoEn: null, placas: new Set<string>() }]),
  );

  const enOrden = [...servicios].sort((a, b) => a.fin.getTime() - b.fin.getTime());
  for (const servicio of enOrden) {
    for (const id of new Set(servicio.participantes)) {
      const p = acumulado.get(id);
      if (!p) continue;
      if (reglas.metrica === 'SERVICIOS') {
        p.valor += 1;
      } else if (reglas.metrica === 'AUTOS') {
        const placa = servicio.placa.trim().toUpperCase();
        if (!placa || p.placas.has(placa)) continue;
        p.placas.add(placa);
        p.valor += 1;
      } else {
        if (!(servicio.monto > 0)) continue;
        p.valor = Math.round((p.valor + servicio.monto) * 100) / 100;
      }
      p.alcanzadoEn = servicio.fin;
    }
  }

  const filas = participantes.map((p) => {
    const a = acumulado.get(p.id)!;
    return { ...p, valor: a.valor, alcanzadoEn: a.alcanzadoEn };
  });
  filas.sort(
    (a, b) =>
      b.valor - a.valor ||
      (a.alcanzadoEn?.getTime() ?? Infinity) - (b.alcanzadoEn?.getTime() ?? Infinity) ||
      a.nombre.localeCompare(b.nombre),
  );

  return filas.map((f, i) => {
    const posicion = i + 1;
    const gana =
      reglas.modoGanador === 'META'
        ? reglas.meta !== null && reglas.meta > 0 && f.valor >= reglas.meta
        : f.valor > 0 && posicion <= Math.max(1, reglas.cantidadGanadores);
    return {
      posicion,
      participanteId: f.id,
      nombre: f.nombre,
      detalle: f.detalle,
      valor: f.valor,
      alcanzadoEn: f.alcanzadoEn ? f.alcanzadoEn.toISOString() : null,
      gana,
      agenciaId: f.agenciaId,
      regionId: f.regionId,
    };
  });
}

/** Cuántos servicios contados hizo cada persona para cada participante: participanteId → (personaId → servicios). */
export function serviciosPorPersona(servicios: ServicioContado[]): Map<string, Map<string, number>> {
  const resultado = new Map<string, Map<string, number>>();
  for (const servicio of servicios) {
    for (const participante of new Set(servicio.participantes)) {
      const porPersona = resultado.get(participante) ?? new Map<string, number>();
      for (const persona of new Set(servicio.operadores ?? [])) {
        porPersona.set(persona, (porPersona.get(persona) ?? 0) + 1);
      }
      resultado.set(participante, porPersona);
    }
  }
  return resultado;
}
