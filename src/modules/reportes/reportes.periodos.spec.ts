import { describe, expect, it } from 'vitest';
import { dividirRango, divisionDe, fechaEcuador, finDeDia, hoyEcuador, inicioDeDia, lunesDe, resolverRango } from './reportes.periodos.js';

// 10 de octubre de 2026 es sábado.
const AHORA = new Date('2026-10-10T15:00:00Z');

describe('resolverRango', () => {
  it('«hoy» usa el calendario de Ecuador aunque en UTC ya sea el día siguiente', () => {
    const casiMedianoche = new Date('2026-10-11T03:30:00Z'); // 22:30 del sábado 10 en Ecuador
    expect(hoyEcuador(casiMedianoche)).toBe('2026-10-10');
    expect(resolverRango({ modo: 'HOY' }, casiMedianoche).desde).toBe('2026-10-10');
  });

  it('esta semana va de lunes a domingo', () => {
    const r = resolverRango({ modo: 'SEMANA' }, AHORA);
    expect([r.desde, r.hasta]).toEqual(['2026-10-05', '2026-10-11']);
  });

  it('este mes y este año cubren el periodo completo', () => {
    expect(resolverRango({ modo: 'MES' }, AHORA)).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(resolverRango({ modo: 'ANIO' }, AHORA)).toMatchObject({ desde: '2026-01-01', hasta: '2026-12-31' });
  });

  it('un mes concreto respeta febrero bisiesto', () => {
    expect(resolverRango({ modo: 'MES_DE', mes: '2028-02' }).hasta).toBe('2028-02-29');
    expect(resolverRango({ modo: 'MES_DE', mes: '2027-02' }).hasta).toBe('2027-02-28');
  });

  it('una semana concreta se calcula desde cualquier día de ella', () => {
    const r = resolverRango({ modo: 'SEMANA_DE', fecha: '2026-10-07' });
    expect([r.desde, r.hasta]).toEqual(['2026-10-05', '2026-10-11']);
  });

  it('rechaza filtros incompletos o incoherentes', () => {
    expect(() => resolverRango({ modo: 'DIA' })).toThrow();
    expect(() => resolverRango({ modo: 'DIA', fecha: '2026-02-30' })).toThrow();
    expect(() => resolverRango({ modo: 'RANGO', desde: '2026-10-10', hasta: '2026-10-01' })).toThrow();
    expect(() => resolverRango({ modo: 'ANIO_DE', anio: 1800 })).toThrow();
  });
});

describe('límites de un día en Ecuador', () => {
  it('el día empieza a las 05:00 UTC y termina al comenzar el siguiente', () => {
    expect(inicioDeDia('2026-10-10').toISOString()).toBe('2026-10-10T05:00:00.000Z');
    expect(finDeDia('2026-10-10').toISOString()).toBe('2026-10-11T05:00:00.000Z');
  });

  it('un servicio de las 23:30 locales cae en su propio día', () => {
    expect(fechaEcuador(new Date('2026-10-11T04:30:00Z'))).toBe('2026-10-10');
  });
});

describe('lunesDe', () => {
  it('el domingo pertenece a la semana que empezó el lunes anterior', () => {
    expect(lunesDe('2026-10-11')).toBe('2026-10-05');
    expect(lunesDe('2026-10-05')).toBe('2026-10-05');
  });
});

describe('división del periodo', () => {
  it('un año se reparte en 12 meses', () => {
    const { division, bloques } = dividirRango({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(division).toBe('MES');
    expect(bloques).toHaveLength(12);
    expect(bloques[1]).toMatchObject({ desde: '2026-02-01', hasta: '2026-02-28', etiqueta: 'Febrero 2026' });
  });

  it('un mes se reparte en semanas recortadas a sus extremos', () => {
    const { division, bloques } = dividirRango({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(division).toBe('SEMANA');
    expect(bloques[0]).toMatchObject({ desde: '2026-10-01', hasta: '2026-10-04' });
    expect(bloques.at(-1)).toMatchObject({ desde: '2026-10-26', hasta: '2026-10-31' });
    expect(bloques).toHaveLength(5);
  });

  it('una semana se reparte en 7 días', () => {
    const { division, bloques } = dividirRango({ desde: '2026-10-05', hasta: '2026-10-11' });
    expect(division).toBe('DIA');
    expect(bloques).toHaveLength(7);
    expect(bloques[0].etiqueta).toBe('Lunes 05 oct 2026');
  });

  it('un solo día no se divide', () => {
    expect(divisionDe({ desde: '2026-10-10', hasta: '2026-10-10' })).toBe('UNICO');
    expect(dividirRango({ desde: '2026-10-10', hasta: '2026-10-10' }).bloques).toHaveLength(1);
  });

  it('un rango personalizado largo se reparte por meses y uno corto por semanas', () => {
    expect(divisionDe({ desde: '2026-01-15', hasta: '2026-06-10' })).toBe('MES');
    expect(divisionDe({ desde: '2026-10-01', hasta: '2026-10-20' })).toBe('SEMANA');
  });

  it('los bloques cubren el rango sin huecos ni solapes', () => {
    for (const rango of [
      { desde: '2026-01-01', hasta: '2026-12-31' },
      { desde: '2026-10-01', hasta: '2026-10-31' },
      { desde: '2026-03-18', hasta: '2026-05-02' },
    ]) {
      const { bloques } = dividirRango(rango);
      expect(bloques[0].desde).toBe(rango.desde);
      expect(bloques.at(-1)!.hasta).toBe(rango.hasta);
      for (let i = 1; i < bloques.length; i++) {
        const anterior = new Date(`${bloques[i - 1].hasta}T12:00:00Z`).getTime();
        const actual = new Date(`${bloques[i].desde}T12:00:00Z`).getTime();
        expect(actual - anterior).toBe(86_400_000);
      }
    }
  });
});
