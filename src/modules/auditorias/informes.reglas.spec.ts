import { describe, expect, it } from 'vitest';
import {
  cargoDeRol,
  correlativoDe,
  esEditable,
  estadoPlanEfectivo,
  faltantesParaEnviar,
  formatearNumero,
  periodoDe,
  puedePasarA,
} from './informes.reglas.js';

describe('estados del informe de inspección', () => {
  it('sigue el flujo borrador → revisión → aprobado → cerrado', () => {
    expect(puedePasarA('BORRADOR', 'EN_REVISION')).toBe(true);
    expect(puedePasarA('EN_REVISION', 'APROBADO')).toBe(true);
    expect(puedePasarA('EN_REVISION', 'RECHAZADO')).toBe(true);
    expect(puedePasarA('RECHAZADO', 'BORRADOR')).toBe(true);
    expect(puedePasarA('APROBADO', 'CERRADO')).toBe(true);
  });

  it('no permite saltos ni salir de cerrado', () => {
    expect(puedePasarA('BORRADOR', 'APROBADO')).toBe(false);
    expect(puedePasarA('CERRADO', 'BORRADOR')).toBe(false);
    expect(puedePasarA('APROBADO', 'BORRADOR')).toBe(false);
  });

  it('solo un borrador se edita', () => {
    expect(esEditable('BORRADOR')).toBe(true);
    for (const e of ['EN_REVISION', 'APROBADO', 'RECHAZADO', 'CERRADO']) expect(esEditable(e)).toBe(false);
  });
});

describe('planes de acción', () => {
  const hoy = new Date('2026-10-14T00:00:00Z');
  it('un plan nunca se muestra vencido: se ve con el estado que tiene', () => {
    const pasado = new Date('2026-09-01');
    expect(estadoPlanEfectivo({ estado: 'PENDIENTE' }, new Date('2026-10-01'))).toBe('PENDIENTE');
    expect(estadoPlanEfectivo({ estado: 'EN_PROCESO' }, new Date('2026-10-01'))).toBe('EN_PROCESO');
    expect(pasado).toBeInstanceOf(Date);
  });
});

describe('numeración y envío', () => {
  it('formato INF-AAAA-NNNN y correlativo', () => {
    expect(formatearNumero(2026, 3)).toBe('INF-2026-0003');
    expect(correlativoDe('INF-2026-0125')).toBe(125);
    expect(correlativoDe('xx')).toBe(0);
    expect(periodoDe('2026-10-14')).toBe('2026-10');
  });

  it('para enviar a revisión exige destinatario, asunto, contenido y calificación', () => {
    const completo = { asunto: 'Visita mensual', destinatarioNombre: 'Jefe', desarrollo: 'Todo en orden', novedades: 0, calificacion: 'BUENO' };
    expect(faltantesParaEnviar(completo)).toEqual([]);
    expect(faltantesParaEnviar({ ...completo, desarrollo: '', novedades: 2 })).toEqual([]);
    expect(faltantesParaEnviar({ ...completo, desarrollo: '', novedades: 0 })).toHaveLength(1);
    expect(faltantesParaEnviar({ ...completo, calificacion: null })).toHaveLength(1);
    expect(faltantesParaEnviar({ asunto: ' ', destinatarioNombre: '', desarrollo: '', novedades: 0, calificacion: null })).toHaveLength(4);
  });

  it('cargo legible de un rol', () => {
    expect(cargoDeRol('COORD_MANTENIMIENTO')).toBe('Coord Mantenimiento');
    expect(cargoDeRol('SUPERVISOR')).toBe('Supervisor');
  });
});
