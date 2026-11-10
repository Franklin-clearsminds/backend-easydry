import { SIN_RESULTADOS, type Alcance } from '../../common/permisos/alcance.js';

/**
 * Reglas puras de RRHH (sin base de datos): distancia, tipo de marca, día en Ecuador y qué sitio valida la timbrada.
 * Las pruebas las cubren una por una; los servicios solo las aplican.
 */

/** Zona horaria de las marcas: la hora y el día son siempre los de Ecuador, sin importar el reloj del dispositivo. */
export const ZONA_HORARIA = 'America/Guayaquil';
/** Antes de esta hora la marca es Entrada; desde ella, Salida. */
export const HORA_CORTE = 12;

export const RADIO_POR_DEFECTO_M = 100;
/** Distancia máxima al sitio para timbrar: fija por canal (el GPS del navegador es menos preciso que el del celular). */
export const RADIO_APP_M = 100;
export const RADIO_WEB_M = 200;
export type OrigenTimbrada = 'APP' | 'WEB';
export const radioPorOrigen = (origen: OrigenTimbrada): number => (origen === 'WEB' ? RADIO_WEB_M : RADIO_APP_M);
/** Peor precisión de GPS que se acepta: el radio del canal más 20 %. Una lectura más vaga se rechaza. */
export const precisionMaxPorOrigen = (origen: OrigenTimbrada): number => radioPorOrigen(origen) * 1.2;
export const PRECISION_MAX_M = precisionMaxPorOrigen('APP');

export const MAX_ADJUNTOS = 5;
export const MAX_BYTES_ADJUNTO = 10 * 1024 * 1024;

export type TipoMarca = 'ENTRADA' | 'SALIDA';
export type Verificacion = 'VERIFICADA' | 'SIN_VERIFICAR' | 'SIN_REFERENCIA';

export interface Punto {
  latitud: number;
  longitud: number;
}

const RADIO_TIERRA_M = 6_371_000;
const aRadianes = (grados: number) => (grados * Math.PI) / 180;

/** Distancia en metros entre dos puntos (fórmula de Haversine). */
export function distanciaMetros(a: Punto, b: Punto): number {
  const dLat = aRadianes(b.latitud - a.latitud);
  const dLon = aRadianes(b.longitud - a.longitud);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aRadianes(a.latitud)) * Math.cos(aRadianes(b.latitud)) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function coordenadasValidas(latitud: unknown, longitud: unknown): boolean {
  return (
    typeof latitud === 'number' && typeof longitud === 'number' && Number.isFinite(latitud) && Number.isFinite(longitud) &&
    latitud >= -90 && latitud <= 90 && longitud >= -180 && longitud <= 180
  );
}

export interface FechaEcuador {
  /** AAAA-MM-DD en hora de Ecuador. */
  dia: string;
  hora: number;
  minuto: number;
}

/** Día y hora de un instante en Ecuador (no cambia con el horario de verano porque Ecuador no lo usa, pero se calcula con la zona igual). */
export function fechaEnEcuador(instante: Date): FechaEcuador {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instante);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '00';
  return { dia: `${valor('year')}-${valor('month')}-${valor('day')}`, hora: Number(valor('hour')), minuto: Number(valor('minute')) };
}

/** El día `AAAA-MM-DD` como fecha a medianoche UTC (como se guarda una columna `@db.Date`). */
export const diaComoFecha = (dia: string): Date => new Date(`${dia}T00:00:00.000Z`);

/** Antes de las 12:00 es Entrada; desde las 12:00, Salida. */
export function tipoPorHora(hora: number): TipoMarca {
  return hora < HORA_CORTE ? 'ENTRADA' : 'SALIDA';
}

export function horasTrabajadas(entrada: Date | null | undefined, salida: Date | null | undefined): number | null {
  if (!entrada || !salida) return null;
  const horas = (salida.getTime() - entrada.getTime()) / 3_600_000;
  return horas > 0 ? Math.round(horas * 100) / 100 : null;
}

export interface SitioReferencia {
  tipo: 'AGENCIA' | 'BODEGA';
  id: string;
  nombre: string;
  regionId: string | null;
  latitud: number | null;
  longitud: number | null;
  radioM: number;
}

export type ResultadoUbicacion =
  | { ok: true; verificacion: Verificacion; sitio: SitioReferencia | null; distanciaM: number | null; radioM: number | null; sitioSinUbicacion: SitioReferencia[] }
  | { ok: false; motivo: 'FALTA_UBICACION' | 'PRECISION' | 'LEJOS'; mensaje: string };

export interface LecturaGps {
  latitud?: number | null;
  longitud?: number | null;
  precisionM?: number | null;
}

/**
 * Decide si una marca es válida según dónde está la persona.
 *  - Sin agencia ni bodega asignada: solo foto (`SIN_VERIFICAR`); la ubicación que mande el dispositivo se guarda, pero no rechaza.
 *  - Con sitio asignado pero ninguno con ubicación guardada: se acepta solo con foto (`SIN_REFERENCIA`) y se avisa al admin.
 *  - Con sitio y ubicación: hace falta una lectura de GPS con la precisión del canal o mejor, y estar a menos del radio del canal
 *    (100 m en la app, 200 m en la web) de alguno de sus sitios.
 */
export function evaluarUbicacion(sitiosGuardados: SitioReferencia[], lectura: LecturaGps, origen: OrigenTimbrada = 'APP'): ResultadoUbicacion {
  const radio = radioPorOrigen(origen);
  const sitios = sitiosGuardados.map((s) => ({ ...s, radioM: radio }));
  if (sitios.length === 0) return { ok: true, verificacion: 'SIN_VERIFICAR', sitio: null, distanciaM: null, radioM: null, sitioSinUbicacion: [] };

  const conUbicacion = sitios.filter((s) => s.latitud != null && s.longitud != null);
  const sinUbicacion = sitios.filter((s) => s.latitud == null || s.longitud == null);
  if (conUbicacion.length === 0) {
    return { ok: true, verificacion: 'SIN_REFERENCIA', sitio: sitios[0], distanciaM: null, radioM: null, sitioSinUbicacion: sinUbicacion };
  }

  if (!coordenadasValidas(lectura.latitud, lectura.longitud)) {
    return { ok: false, motivo: 'FALTA_UBICACION', mensaje: 'No se recibió tu ubicación. Activa el GPS y permite el acceso a la ubicación para timbrar.' };
  }
  const precision = lectura.precisionM;
  if (typeof precision !== 'number' || !Number.isFinite(precision) || precision < 0 || precision > precisionMaxPorOrigen(origen)) {
    return {
      ok: false,
      motivo: 'PRECISION',
      mensaje: 'No se pudo obtener una ubicación precisa. Usa la app en tu celular o acércate a una ventana y vuelve a intentar.',
    };
  }

  const punto = { latitud: lectura.latitud as number, longitud: lectura.longitud as number };
  const medidos = conUbicacion
    .map((s) => ({ sitio: s, distanciaM: distanciaMetros(punto, { latitud: s.latitud as number, longitud: s.longitud as number }) }))
    .sort((a, b) => a.distanciaM - b.distanciaM);
  // Vale la marca si está dentro del radio de alguno; si no, se informa del más cercano.
  const dentro = medidos.find((m) => m.distanciaM <= m.sitio.radioM);
  if (dentro) {
    return { ok: true, verificacion: 'VERIFICADA', sitio: dentro.sitio, distanciaM: Math.round(dentro.distanciaM * 10) / 10, radioM: dentro.sitio.radioM, sitioSinUbicacion: sinUbicacion };
  }
  const cerca = medidos[0];
  return {
    ok: false,
    motivo: 'LEJOS',
    mensaje: `Estás a ${Math.round(cerca.distanciaM)} m de ${cerca.sitio.nombre}. Debes estar a ${cerca.sitio.radioM} m o menos para timbrar.`,
  };
}

// ───────────────────────── Ámbito de personas ─────────────────────────

/** Persona con lo necesario para saber si cae en un ámbito. */
export interface PersonaAmbito {
  agenciaId?: string | null;
  regionId?: string | null;
  agencia?: { regionId?: string | null } | null;
  bodega?: { regionId?: string | null } | null;
}

/** ¿Está esta persona dentro del alcance de quien actúa? Nadie actúa fuera de su agencia o región. */
export function personaEnAlcance(alcance: Alcance, persona: PersonaAmbito): boolean {
  switch (alcance.tipo) {
    case 'GLOBAL':
      return true;
    case 'REGION': {
      const region = persona.regionId ?? persona.agencia?.regionId ?? persona.bodega?.regionId ?? null;
      return !!region && region === alcance.regionId;
    }
    case 'AGENCIA':
      return !!persona.agenciaId && persona.agenciaId === alcance.agenciaId;
    default:
      return false;
  }
}

/** Filtro de Prisma sobre `User` para las personas dentro del alcance. */
export function whereUsuariosEnAlcance(alcance: Alcance): Record<string, unknown> {
  switch (alcance.tipo) {
    case 'GLOBAL':
      return {};
    case 'REGION':
      return { OR: [{ regionId: alcance.regionId }, { agencia: { regionId: alcance.regionId } }, { bodega: { regionId: alcance.regionId } }] };
    case 'AGENCIA':
      return { agenciaId: alcance.agenciaId };
    default:
      return SIN_RESULTADOS;
  }
}

// ───────────────────────── Tareas ─────────────────────────

export type EstadoTareaRrhh = 'PENDIENTE' | 'COMPLETADA' | 'REVISADA' | 'CANCELADA';

/** Vencida no es un estado guardado: es una tarea Pendiente cuya fecha límite ya pasó. */
export function tareaVencida(tarea: { estado: string; fechaLimite?: Date | null }, ahora = new Date()): boolean {
  return tarea.estado === 'PENDIENTE' && !!tarea.fechaLimite && tarea.fechaLimite.getTime() < ahora.getTime();
}

export const NUMERO_TAREA = (numero: number): string => `TAR-${String(numero).padStart(4, '0')}`;
