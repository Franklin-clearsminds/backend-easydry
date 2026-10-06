import { describe, expect, it } from 'vitest';
import { calcularRanking, fuentesDeServicios, hoyEcuador, rangoReto, serviciosPorPersona, type ServicioContado } from './retos.reglas.js';

const dia = (d: number, h = 12, m = 0) => new Date(Date.UTC(2026, 9, d, h, m));
const servicio = (p: string | string[], fin: Date, extra: Partial<ServicioContado> = {}): ServicioContado => ({
  participantes: Array.isArray(p) ? p : [p],
  placa: 'AAA-001',
  monto: 0,
  fin,
  ...extra,
});
const A = { id: 'a', nombre: 'Pulidor A' };
const B = { id: 'b', nombre: 'Pulidor B' };
const ranking = { metrica: 'SERVICIOS' as const, modoGanador: 'RANKING' as const, cantidadGanadores: 1, meta: null };

describe('ranking de un reto', () => {
  it('empate: va primero quien llegó antes a esa cantidad (A completa su 7.º antes que B)', () => {
    const servicios = [
      ...Array.from({ length: 6 }, (_, i) => servicio('b', dia(1, 10 + i))), // B va 6
      ...Array.from({ length: 5 }, (_, i) => servicio('a', dia(2, 10 + i))), // A va 5
      servicio('a', dia(3, 9)), // A llega a 6
      servicio('a', dia(3, 10)), // A llega a 7
      servicio('b', dia(3, 15)), // B llega a 7, después
    ];
    const filas = calcularRanking([B, A], servicios, ranking);
    expect(filas.map((f) => [f.nombre, f.valor, f.posicion, f.gana])).toEqual([
      ['Pulidor A', 7, 1, true],
      ['Pulidor B', 7, 2, false],
    ]);
    expect(filas[0].alcanzadoEn).toBe(dia(3, 10).toISOString());
  });

  it('el orden de llegada del arreglo no importa: se acumula en orden cronológico', () => {
    const servicios = [servicio('b', dia(5)), servicio('a', dia(4))];
    expect(calcularRanking([A, B], servicios.reverse(), ranking)[0].nombre).toBe('Pulidor A');
  });

  it('sin servicios aparece con 0 y nunca gana', () => {
    const filas = calcularRanking([A, B], [servicio('a', dia(1))], { ...ranking, cantidadGanadores: 2 });
    expect(filas.map((f) => [f.nombre, f.valor, f.gana])).toEqual([['Pulidor A', 1, true], ['Pulidor B', 0, false]]);
  });

  it('AUTOS cuenta placas distintas; repetir un auto no suma ni cambia cuándo llegó', () => {
    const servicios = [
      servicio('a', dia(1), { placa: 'pbc-123' }),
      servicio('a', dia(2), { placa: 'PBC-123 ' }),
      servicio('a', dia(3), { placa: 'XYZ-999' }),
      servicio('a', dia(9), { placa: 'XYZ-999' }),
    ];
    const [fila] = calcularRanking([A], servicios, { ...ranking, metrica: 'AUTOS' });
    expect(fila.valor).toBe(2);
    expect(fila.alcanzadoEn).toBe(dia(3).toISOString());
  });

  it('MONTO suma el precio con dos decimales e ignora servicios sin precio', () => {
    const servicios = [servicio('a', dia(1), { monto: 10.1 }), servicio('a', dia(2), { monto: 20.2 }), servicio('a', dia(3))];
    const [fila] = calcularRanking([A], servicios, { ...ranking, metrica: 'MONTO' });
    expect(fila.valor).toBe(30.3);
    expect(fila.alcanzadoEn).toBe(dia(2).toISOString());
  });

  it('un servicio con varios asignados cuenta completo para cada uno (una sola vez por persona)', () => {
    const filas = calcularRanking([A, B], [servicio(['a', 'b', 'a'], dia(1))], ranking);
    expect(filas.map((f) => f.valor)).toEqual([1, 1]);
  });

  it('ignora servicios de quien no participa', () => {
    expect(calcularRanking([A], [servicio('x', dia(1))], ranking)[0].valor).toBe(0);
  });

  it('RANKING: ganan los primeros N con algo hecho', () => {
    const C = { id: 'c', nombre: 'Pulidor C' };
    const servicios = [servicio('a', dia(1)), servicio('a', dia(2)), servicio('b', dia(1))];
    const filas = calcularRanking([A, B, C], servicios, { ...ranking, cantidadGanadores: 3 });
    expect(filas.map((f) => f.gana)).toEqual([true, true, false]);
  });

  it('META: ganan todos los que lleguen a la meta, sin importar la posición', () => {
    const servicios = [servicio('a', dia(1)), servicio('a', dia(2)), servicio('b', dia(1)), servicio('b', dia(2))];
    const filas = calcularRanking([A, B], servicios, { ...ranking, modoGanador: 'META', meta: 2 });
    expect(filas.map((f) => f.gana)).toEqual([true, true]);
    expect(calcularRanking([A, B], servicios, { ...ranking, modoGanador: 'META', meta: 3 }).some((f) => f.gana)).toBe(false);
  });
});

describe('fechas del reto en hora de Ecuador (UTC-5)', () => {
  it('cubre desde las 00:00 del primer día hasta las 24:00 del último, hora local', () => {
    const { desde, hasta } = rangoReto(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'));
    expect(desde.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('un servicio a las 21:00 del último día (02:00 UTC del siguiente) todavía cuenta', () => {
    const { desde, hasta } = rangoReto(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-31T00:00:00Z'));
    const fin = new Date('2026-11-01T02:00:00Z');
    expect(fin >= desde && fin < hasta).toBe(true);
  });

  it('"hoy" es la fecha de Ecuador, no la de UTC', () => {
    expect(hoyEcuador(new Date('2026-11-01T03:00:00Z')).toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(hoyEcuador(new Date('2026-11-01T06:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('qué servicios se leen', () => {
  it('según el tipo elegido', () => {
    expect(fuentesDeServicios('TODOS')).toEqual({ generales: true, especiales: true });
    expect(fuentesDeServicios('GENERALES')).toEqual({ generales: true, especiales: false });
    expect(fuentesDeServicios('ESPECIALES')).toEqual({ generales: false, especiales: true });
    expect(fuentesDeServicios('ESPECIFICOS')).toEqual({ generales: true, especiales: true });
  });
});

describe('quién trabajó para cada participante', () => {
  it('cuenta los servicios de cada persona, una vez por servicio aunque aparezca repetida', () => {
    const r = serviciosPorPersona([
      servicio('b1', dia(1), { operadores: ['juan', 'juan'] }),
      servicio('b1', dia(2), { operadores: ['juan', 'pedro'] }),
      servicio('b2', dia(2), { operadores: ['pedro'] }),
      servicio('b3', dia(3)),
    ]);
    expect([...r.get('b1')!.entries()]).toEqual([['juan', 2], ['pedro', 1]]);
    expect([...r.get('b2')!.entries()]).toEqual([['pedro', 1]]);
    expect(r.get('b3')!.size).toBe(0);
  });
});
