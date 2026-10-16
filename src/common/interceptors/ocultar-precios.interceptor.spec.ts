import { describe, expect, it } from 'vitest';
import { of, firstValueFrom } from 'rxjs';
import { OcultarPreciosInterceptor, quitarPrecios } from './ocultar-precios.interceptor.js';

const contexto = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
const rol = (namerol: string, capacidades: string[]) => ({ roleDetails: { namerol, capacidades } });

describe('quitarPrecios', () => {
  it('quita precios y costos a cualquier profundidad y respeta fechas y el resto de campos', () => {
    const fecha = new Date('2026-10-01');
    const r = quitarPrecios({
      nombre: 'Lavado Express',
      precio: 10,
      fecha,
      servicios: [{ id: 1, precioEfectivo: 8, precioAgencia: 8, precioCatalogo: 10, detalle: { costoUnitarioUSD: 3, cantidad: 2 } }],
    });
    expect(r).toEqual({ nombre: 'Lavado Express', fecha, servicios: [{ id: 1, detalle: { cantidad: 2 } }] });
  });

  it('deja intactos los valores que no son objetos planos (números, nulos, texto)', () => {
    expect(quitarPrecios(5)).toBe(5);
    expect(quitarPrecios(null)).toBeNull();
    expect(quitarPrecios('precio')).toBe('precio');
  });
});

describe('OcultarPreciosInterceptor', () => {
  const interceptor = new OcultarPreciosInterceptor();
  const handler = { handle: () => of({ id: 1, precio: 10 }) } as any;

  it('quien no tiene precios.ver no recibe el precio', async () => {
    const r = await firstValueFrom(interceptor.intercept(contexto(rol('COORD_COMERCIAL', ['servicios.ver'])), handler));
    expect(r).toEqual({ id: 1 });
  });

  it('quien tiene precios.ver lo recibe', async () => {
    const r = await firstValueFrom(interceptor.intercept(contexto(rol('LIDER', ['precios.ver'])), handler));
    expect(r).toEqual({ id: 1, precio: 10 });
  });

  it('SUPER_ADMIN siempre lo recibe', async () => {
    const r = await firstValueFrom(interceptor.intercept(contexto(rol('SUPER_ADMIN', [])), handler));
    expect(r).toEqual({ id: 1, precio: 10 });
  });
});
