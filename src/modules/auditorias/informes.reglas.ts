/**
 * Reglas puras de los informes de inspección (sin base de datos): estados, transiciones y cálculos. Las usa el servicio y se
 * prueban solas.
 */

/** Un informe es borrador mientras se elabora y queda guardado, sin poder modificarse, cuando se firma y se guarda. */
import { createHash } from 'node:crypto';

export const ESTADOS_INFORME = ['BORRADOR', 'GUARDADO'] as const;
export type EstadoInforme = (typeof ESTADOS_INFORME)[number];

export const TIPOS_INSPECCION = ['RUTINA', 'SEGUIMIENTO', 'EXTRAORDINARIA', 'CIERRE_MENSUAL', 'APERTURA_AGENCIA', 'CIERRE_AGENCIA', 'NOVEDADES'] as const;
export const CATEGORIAS_NOVEDAD = ['INFRAESTRUCTURA', 'MAQUINARIA', 'INSUMOS', 'LIMPIEZA', 'SEGURIDAD', 'OPERACION', 'PERSONAL', 'OTROS'] as const;
export const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export const ESTADOS_NOVEDAD = ['ABIERTA', 'EN_SEGUIMIENTO', 'RESUELTA'] as const;
/** El responsable de un plan es siempre la agencia del informe y su fecha es la de creación: no hay estado «vencido». */
export const ESTADOS_PLAN = ['PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'CANCELADO'] as const;
export const CALIFICACIONES = ['EXCELENTE', 'BUENO', 'REGULAR', 'MALO'] as const;
/** Estados en que un informe ya es resultado final: lo único que ven quienes no pueden auditar. */
export const ESTADOS_RESULTADO: readonly EstadoInforme[] = ['GUARDADO'];

/** Las cuatro firmas que lleva un informe, en el orden en que se muestran. */
export const FIRMAS_INFORME = [
  { tipo: 'RESPONSABLE', nombre: 'Responsable' },
  { tipo: 'JEFE_TALLER', nombre: 'Taller' },
  { tipo: 'LIDER_BAHIA', nombre: 'Líder de bahía' },
  { tipo: 'RECEPCION', nombre: 'Recepción' },
] as const;
export const TIPOS_FIRMA = FIRMAS_INFORME.map((f) => f.tipo) as readonly string[];
export const TIPO_FIRMA_JEFE = 'JEFE_TALLER';
/** La firma de recepción no se hace al elaborar el informe: la hace un Admin o Super Admin cuando lo aprueba. */
export const TIPO_FIRMA_RECEPCION = 'RECEPCION';

/** Una firma o un logo se guardan como imagen en data URL; este tope evita guardar archivos enormes. */
export const MAX_FIRMA_CARACTERES = 400_000;
export const MAX_LOGO_CARACTERES = 400_000;
export const esImagenDataUrl = (s: unknown, max: number): s is string =>
  typeof s === 'string' && s.length <= max && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s);

/**
 * Huella del contenido que se firma (lo que sale en el documento): si cambia, las firmas anteriores dejan de valer. Se calcula siempre
 * sobre lo que está guardado, así que guardar sin cambios no anula nada.
 */
export function huellaContenido(i: any): string {
  const dia = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : '');
  const lista = (a: unknown) => (Array.isArray(a) ? a.map(String) : []);
  const base = {
    agenciaId: i.agenciaId ?? '',
    destinatario: i.destinatarioNombre ?? '',
    fecha: dia(i.fecha),
    tipo: i.tipoInspeccion ?? '',
    asunto: i.asunto ?? '',
    antecedentes: i.antecedentes ?? '',
    desarrollo: i.desarrollo ?? '',
    actividadesGeneral: i.actividadesGeneral ?? '',
    planesGeneral: i.planesGeneral ?? '',
    observacionesJefeTaller: i.observacionesJefeTaller ?? '',
    calificacion: i.calificacion ?? '',
    jefePresente: i.jefeTallerPresente !== false,
    novedades: (i.novedades ?? []).map((n: any) => [n.titulo, n.descripcion, n.categoria, n.area, lista(n.fotos)]),
    actividades: (i.actividades ?? []).map((a: any) => [a.nombre, a.descripcion, lista(a.fotos)]),
    planes: (i.planes ?? []).map((p: any) => [p.problema, p.accionRequerida, lista(p.evidenciaCumplimiento)]),
  };
  return createHash('sha256').update(JSON.stringify(base)).digest('hex');
}

/** Nombres de personas para comparar sin mayúsculas, acentos ni espacios de más. */
export const nombreNormalizado = (s: string): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** A qué estados puede pasar un informe: solo de borrador a guardado, y de ahí no se vuelve. */
export const TRANSICIONES: Record<EstadoInforme, readonly EstadoInforme[]> = {
  BORRADOR: ['GUARDADO'],
  GUARDADO: [],
};

export const puedePasarA = (desde: string, hacia: EstadoInforme): boolean =>
  (TRANSICIONES[desde as EstadoInforme] ?? []).includes(hacia);

/** El contenido solo se edita mientras es borrador: de ahí en adelante lo aprobado no cambia. */
export const esEditable = (estado: string): boolean => estado === 'BORRADOR';

/** Periodo AAAA-MM de una fecha AAAA-MM-DD. */
export const periodoDe = (fecha: string): string => fecha.slice(0, 7);

/** Identificador legible: INF-AAAA-NNNN. */
export const formatearNumero = (anio: number, correlativo: number): string => `INF-${anio}-${String(correlativo).padStart(4, '0')}`;

/** Correlativo de un número INF-AAAA-NNNN (0 si no tiene el formato). */
export function correlativoDe(numero: string | null | undefined): number {
  const m = /^INF-\d{4}-(\d+)$/.exec(String(numero ?? ''));
  return m ? Number(m[1]) : 0;
}

/** Estado de un plan tal como se muestra: el que tiene (ya no se calcula «vencido»). */
export function estadoPlanEfectivo(plan: { estado: string }, _hoy?: Date): string {
  return plan.estado;
}

/** Qué falta para poder guardar el informe de forma definitiva (lista vacía = completo). Recepción se firma después, al aprobarlo. */
export function faltantesParaGuardar(i: {
  asunto: string;
  destinatarioNombre: string;
  desarrollo: string;
  novedades: number;
  calificacion: string | null;
  selloValidado: boolean;
  /** Tipos de firma que ya tienen imagen. */
  firmadas: readonly string[];
  /** El jefe de taller estuvo en la visita (por defecto sí). Si no, no se exige su contraseña, pero el taller sí firma con nombre escrito. */
  jefePresente?: boolean;
}): string[] {
  const faltan: string[] = [];
  if (!i.destinatarioNombre.trim()) faltan.push('el destinatario (PARA)');
  if (!i.asunto.trim()) faltan.push('el asunto');
  if (!i.desarrollo.trim() && i.novedades === 0) faltan.push('el desarrollo o al menos una novedad');
  if (!i.calificacion) faltan.push('la calificación del servicio');
  const jefePresente = i.jefePresente !== false;
  if (jefePresente && !i.selloValidado) faltan.push('el jefe de taller con su contraseña');
  for (const f of FIRMAS_INFORME) {
    if (f.tipo === TIPO_FIRMA_RECEPCION) continue;
    if (!i.firmadas.includes(f.tipo)) faltan.push(`la firma de ${f.nombre.toLowerCase()}`);
  }
  return faltan;
}

/** Cargo que se muestra de un rol (SUPERVISOR → «Supervisor»). */
export function cargoDeRol(rol: string): string {
  return String(rol || '')
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
