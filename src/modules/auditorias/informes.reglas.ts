/**
 * Reglas puras de los informes de inspección (sin base de datos): estados, transiciones y cálculos. Las usa el servicio y se
 * prueban solas.
 */

export const ESTADOS_INFORME = ['BORRADOR', 'EN_REVISION', 'APROBADO', 'RECHAZADO', 'CERRADO'] as const;
export type EstadoInforme = (typeof ESTADOS_INFORME)[number];

export const TIPOS_INSPECCION = ['RUTINA', 'SEGUIMIENTO', 'EXTRAORDINARIA', 'CIERRE_MENSUAL', 'APERTURA_AGENCIA', 'CIERRE_AGENCIA', 'NOVEDADES'] as const;
export const CATEGORIAS_NOVEDAD = ['INFRAESTRUCTURA', 'MAQUINARIA', 'INSUMOS', 'LIMPIEZA', 'SEGURIDAD', 'OPERACION', 'PERSONAL', 'OTROS'] as const;
export const PRIORIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export const ESTADOS_NOVEDAD = ['ABIERTA', 'EN_SEGUIMIENTO', 'RESUELTA'] as const;
/** VENCIDO no se guarda: se calcula (compromiso pasado y plan todavía abierto). Se admite en filtros. */
export const ESTADOS_PLAN = ['PENDIENTE', 'EN_PROCESO', 'COMPLETADO', 'CANCELADO'] as const;
export const CALIFICACIONES = ['EXCELENTE', 'BUENO', 'REGULAR', 'MALO'] as const;
/** Estados en que un informe ya es resultado final: lo único que ven quienes no pueden auditar. */
export const ESTADOS_RESULTADO: readonly EstadoInforme[] = ['APROBADO', 'CERRADO'];

/** A qué estados puede pasar un informe. Las firmas del documento no se registran en el sistema: se imprimen en blanco para firmar a mano. */
export const TRANSICIONES: Record<EstadoInforme, readonly EstadoInforme[]> = {
  BORRADOR: ['EN_REVISION'],
  EN_REVISION: ['APROBADO', 'RECHAZADO'],
  APROBADO: ['CERRADO'],
  RECHAZADO: ['BORRADOR'],
  CERRADO: [],
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

/** Estado de un plan tal como se muestra: «VENCIDO» si el compromiso ya pasó y el plan sigue abierto. */
export function estadoPlanEfectivo(plan: { estado: string; fechaCompromiso: Date | null }, hoy: Date): string {
  if ((plan.estado === 'PENDIENTE' || plan.estado === 'EN_PROCESO') && plan.fechaCompromiso && plan.fechaCompromiso.getTime() < hoy.getTime()) {
    return 'VENCIDO';
  }
  return plan.estado;
}

/** Qué falta para poder enviar el informe a revisión (lista vacía = completo). */
export function faltantesParaEnviar(i: {
  asunto: string;
  destinatarioNombre: string;
  desarrollo: string;
  novedades: number;
  calificacion: string | null;
}): string[] {
  const faltan: string[] = [];
  if (!i.destinatarioNombre.trim()) faltan.push('el destinatario (PARA)');
  if (!i.asunto.trim()) faltan.push('el asunto');
  if (!i.desarrollo.trim() && i.novedades === 0) faltan.push('el desarrollo o al menos una novedad');
  if (!i.calificacion) faltan.push('la calificación del servicio');
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
