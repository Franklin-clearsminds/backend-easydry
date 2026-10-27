import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { tienePermiso } from '../permisos/capacidades.js';

/** Campos de dinero de lista: precios de servicios y costos de insumos. */
const CAMPOS_PRECIO = new Set([
  'precio',
  'precioCatalogo',
  'precioAgencia',
  'precioEfectivo',
  'costoUnitarioUSD',
  'costoUnitario',
  'costoTotal',
  'costoTotalUSD',
  'subtotalUSD',
]);

const esObjetoPlano = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** Copia del valor sin los campos de precio ni costo, a cualquier profundidad (los Decimal y las fechas no se tocan). */
export function quitarPrecios<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => quitarPrecios(v)) as unknown as T;
  if (!esObjetoPlano(valor)) return valor;
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor)) {
    if (!CAMPOS_PRECIO.has(k)) limpio[k] = quitarPrecios(v);
  }
  return limpio as T;
}

/**
 * Campos de costo y gasto de los dashboards (costo de insumos, gasto de mantenimiento, reparaciones, rankings de máquinas costosas).
 * Los ingresos y ventas no entran aquí: son del negocio, no de lo que cuesta operar.
 */
const ES_CAMPO_COSTO = /^(costo|gasto|granTotalCosto|topMaquinasCostosas|maquinasCostosasRank|subtotalUSD|faltanteUSD)|Costo(s|USD|Total)?$/;

/** Copia del valor sin los campos de costo y gasto de los dashboards, a cualquier profundidad. */
export function quitarCostos<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => quitarCostos(v)) as unknown as T;
  if (!esObjetoPlano(valor)) return valor;
  const limpio: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor)) {
    if (!ES_CAMPO_COSTO.test(k) && !CAMPOS_PRECIO.has(k)) limpio[k] = quitarCostos(v);
  }
  return limpio as T;
}

/** Igual que `OcultarPreciosInterceptor`, pero para los dashboards: quita costos y gastos, sin tocar ingresos ni ventas. */
@Injectable()
export class OcultarCostosInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest()?.user;
    if (!user || tienePermiso(user, 'precios.ver')) return next.handle();
    return next.handle().pipe(map((r) => quitarCostos(r)));
  }
}

/**
 * A quien no tiene el permiso `precios.ver` el servidor no le envía precios ni costos. Se aplica en los controladores que
 * devuelven catálogo, OT, precios por agencia e inventario; los dashboards y reportes conservan sus montos.
 */
@Injectable()
export class OcultarPreciosInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest()?.user;
    if (!user || tienePermiso(user, 'precios.ver')) return next.handle();
    return next.handle().pipe(map((r) => quitarPrecios(r)));
  }
}
