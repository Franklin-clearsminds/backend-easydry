import { describe, expect, it } from 'vitest';
import {
  AJUSTE_POR_DEFECTO,
  HORARIO_POR_DEFECTO,
  evaluarDia,
  indiceDiaSemana,
  resolverMarca,
  sumarDias,
  validarAjuste,
  validarSemana,
  versionVigente,
  ventanasDe,
  type DiaHorario,
} from './rrhh.horarios.js';

const h = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const DIA: DiaHorario = { trabaja: true, entrada: '08:00', salida: '15:00' };
const NADA = { entrada: false, salida: false };

describe('horario por defecto y validaciones', () => {
  it('parte con 08:00 a 15:00 los siete días y es válido', () => {
    expect(HORARIO_POR_DEFECTO).toHaveLength(7);
    expect(HORARIO_POR_DEFECTO.every((d) => d.trabaja && d.entrada === '08:00' && d.salida === '15:00')).toBe(true);
    expect(validarSemana(HORARIO_POR_DEFECTO)).toBeNull();
  });

  it('rechaza semanas incompletas, horas mal escritas y turnos que cruzan la medianoche', () => {
    expect(validarSemana(HORARIO_POR_DEFECTO.slice(0, 6))).toMatch(/7 días/);
    expect(validarSemana(HORARIO_POR_DEFECTO.map((d, i) => (i === 2 ? { ...d, entrada: '8:00' } : d)))).toMatch(/miércoles.*HH:mm/);
    expect(validarSemana(HORARIO_POR_DEFECTO.map((d, i) => (i === 0 ? { ...d, entrada: '22:00', salida: '06:00' } : d)))).toMatch(/lunes.*posterior/);
    // un día libre no se valida por sus horas
    expect(validarSemana(HORARIO_POR_DEFECTO.map((d, i) => (i === 6 ? { trabaja: false, entrada: '08:00', salida: '08:00' } : d)))).toBeNull();
  });

  it('el ajuste: tolerancia de 5 a 20 min, ventana de 0 a 120 min y nunca menor que la tolerancia', () => {
    expect(validarAjuste(AJUSTE_POR_DEFECTO)).toBeNull();
    expect(validarAjuste({ toleranciaMin: 4, ventanaMin: 60 })).toMatch(/tolerancia/);
    expect(validarAjuste({ toleranciaMin: 21, ventanaMin: 60 })).toMatch(/tolerancia/);
    expect(validarAjuste({ toleranciaMin: 10, ventanaMin: 121 })).toMatch(/ventana/);
    expect(validarAjuste({ toleranciaMin: 10, ventanaMin: 5 })).toMatch(/menor que la tolerancia/);
    expect(validarAjuste({ toleranciaMin: 10, ventanaMin: 1.5 })).toMatch(/ventana/);
  });
});

describe('fechas y versiones', () => {
  it('el día de la semana empieza en lunes', () => {
    expect(indiceDiaSemana('2031-03-10')).toBe(0); // lunes
    expect(indiceDiaSemana('2031-03-16')).toBe(6); // domingo
    expect(sumarDias('2031-03-31', 1)).toBe('2031-04-01');
  });

  it('rige la versión más reciente que no pase del día; a igual fecha, la última guardada', () => {
    const v = [
      { id: 'a', vigenteDesde: '2031-03-01', createdAt: '2031-02-28T10:00:00Z' },
      { id: 'b', vigenteDesde: '2031-03-10', createdAt: '2031-03-09T10:00:00Z' },
      { id: 'c', vigenteDesde: '2031-03-10', createdAt: '2031-03-09T12:00:00Z' },
      { id: 'd', vigenteDesde: '2031-04-01', createdAt: '2031-03-20T10:00:00Z' },
    ];
    expect(versionVigente(v, '2031-02-01')).toBeNull();
    expect(versionVigente(v, '2031-03-05')?.id).toBe('a');
    expect(versionVigente(v, '2031-03-10')?.id).toBe('c');
    expect(versionVigente(v, '2031-03-31')?.id).toBe('c');
    expect(versionVigente(v, '2031-04-01')?.id).toBe('d');
  });
});

describe('resolverMarca: entrada o salida por cercanía al horario', () => {
  it('con 08:00 a 15:00 y ventana de 2 h: entrada de 06:00 a 10:00, salida de 13:00 a 17:00', () => {
    expect(ventanasDe(DIA, AJUSTE_POR_DEFECTO)).toEqual({ entrada: { desde: '06:00', hasta: '10:00' }, salida: { desde: '13:00', hasta: '17:00' } });
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('06:00'), NADA)).toEqual({ ok: true, tipo: 'ENTRADA' });
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('10:00'), NADA)).toEqual({ ok: true, tipo: 'ENTRADA' });
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('13:00'), { entrada: true, salida: false })).toEqual({ ok: true, tipo: 'SALIDA' });
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('17:00'), { entrada: true, salida: false })).toEqual({ ok: true, tipo: 'SALIDA' });
  });

  it('fuera de las ventanas no se deja timbrar y el mensaje dice cuáles son', () => {
    const r = resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('11:30'), NADA);
    expect(r).toMatchObject({ ok: false, motivo: 'FUERA_DE_VENTANA' });
    expect((r as any).mensaje).toContain('06:00 a 10:00');
    expect((r as any).mensaje).toContain('13:00 a 17:00');
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('17:01'), NADA)).toMatchObject({ ok: false, motivo: 'FUERA_DE_VENTANA' });
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('05:59'), NADA)).toMatchObject({ ok: false, motivo: 'FUERA_DE_VENTANA' });
  });

  it('un día libre no se puede timbrar', () => {
    expect(resolverMarca({ ...DIA, trabaja: false }, AJUSTE_POR_DEFECTO, h('08:00'), NADA)).toMatchObject({ ok: false, motivo: 'DIA_LIBRE' });
  });

  it('una sola entrada y una sola salida por día', () => {
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('08:05'), { entrada: true, salida: false })).toMatchObject({ ok: false, motivo: 'YA_REGISTRADA', mensaje: 'Ya registraste tu entrada de hoy.' });
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('15:05'), { entrada: true, salida: true })).toMatchObject({ ok: false, motivo: 'YA_REGISTRADA', mensaje: 'Ya registraste tu salida de hoy.' });
  });

  it('se acepta una salida aunque no haya entrada', () => {
    expect(resolverMarca(DIA, AJUSTE_POR_DEFECTO, h('15:00'), NADA)).toEqual({ ok: true, tipo: 'SALIDA' });
  });

  it('con ventanas que se solapan gana la hora más cercana y, tras la entrada, solo cabe la salida', () => {
    const corto: DiaHorario = { trabaja: true, entrada: '08:00', salida: '10:00' };
    expect(resolverMarca(corto, AJUSTE_POR_DEFECTO, h('08:50'), NADA)).toEqual({ ok: true, tipo: 'ENTRADA' });
    expect(resolverMarca(corto, AJUSTE_POR_DEFECTO, h('09:10'), NADA)).toEqual({ ok: true, tipo: 'SALIDA' });
    expect(resolverMarca(corto, AJUSTE_POR_DEFECTO, h('08:50'), { entrada: true, salida: false })).toEqual({ ok: true, tipo: 'SALIDA' });
  });

  it('con ventana 0 solo vale el minuto exacto', () => {
    const exacta = { toleranciaMin: 5, ventanaMin: 0 };
    expect(resolverMarca(DIA, exacta, h('08:00'), NADA)).toEqual({ ok: true, tipo: 'ENTRADA' });
    expect(resolverMarca(DIA, exacta, h('08:01'), NADA)).toMatchObject({ ok: false });
  });
});

describe('evaluarDia', () => {
  const ev = (entrada: string | null, salida: string | null, extra: Record<string, unknown> = {}) =>
    evaluarDia({ dia: DIA, ajuste: AJUSTE_POR_DEFECTO, entradaMin: entrada ? h(entrada) : null, salidaMin: salida ? h(salida) : null, ...extra });

  it('cumple si entra y sale dentro de ±10 min, con las dos cifras de horas', () => {
    const r = ev('08:07', '14:55');
    expect(r).toMatchObject({ estado: 'CUMPLE', observaciones: [], minutosEntrada: 7, minutosSalida: -5, horasReales: 6.8, horasDentroHorario: 6.8 });
    expect(ev('07:50', '15:10').estado).toBe('CUMPLE');
  });

  it('atraso: entra más de 10 min tarde; las horas dentro del horario descuentan el atraso', () => {
    const r = ev('08:40', '15:00');
    expect(r).toMatchObject({ estado: 'ATRASO', minutosEntrada: 40, horasReales: 6.33, horasDentroHorario: 6.33 });
  });

  it('entrada temprana: las horas reales suben pero las del horario no', () => {
    const r = ev('07:00', '15:00');
    expect(r).toMatchObject({ estado: 'ENTRADA_TEMPRANA', horasReales: 8, horasDentroHorario: 7 });
  });

  it('salida anticipada y salida tardía', () => {
    expect(ev('08:00', '13:30')).toMatchObject({ estado: 'SALIDA_ANTICIPADA', minutosSalida: -90, horasReales: 5.5, horasDentroHorario: 5.5 });
    expect(ev('08:00', '16:30')).toMatchObject({ estado: 'SALIDA_TARDIA', horasReales: 8.5, horasDentroHorario: 7 });
  });

  it('un día puede traer más de una observación; el estado es la primera', () => {
    expect(ev('08:30', '16:30')).toMatchObject({ estado: 'ATRASO', observaciones: ['ATRASO', 'SALIDA_TARDIA'] });
  });

  it('la tolerancia es la configurada', () => {
    const ajuste = { toleranciaMin: 20, ventanaMin: 120 };
    expect(evaluarDia({ dia: DIA, ajuste, entradaMin: h('08:18'), salidaMin: h('15:00') }).estado).toBe('CUMPLE');
    expect(evaluarDia({ dia: DIA, ajuste, entradaMin: h('08:21'), salidaMin: h('15:00') }).estado).toBe('ATRASO');
  });

  it('sin marcas: Sin marca; con una sola: Incompleto y sin horas calculadas', () => {
    expect(ev(null, null)).toMatchObject({ estado: 'SIN_MARCA', horasReales: null });
    expect(ev('08:00', null)).toMatchObject({ estado: 'INCOMPLETO', horasReales: null, horasDentroHorario: null, entradaReal: '08:00' });
    expect(ev(null, '15:00')).toMatchObject({ estado: 'INCOMPLETO', horasReales: null, salidaReal: '15:00' });
  });

  it('hoy no se da por faltante lo que todavía puede marcarse', () => {
    expect(ev(null, null, { ahoraMin: h('09:30') }).estado).toBe('PENDIENTE');
    expect(ev(null, null, { ahoraMin: h('10:01') }).estado).toBe('SIN_MARCA');
    expect(ev('08:00', null, { ahoraMin: h('12:00') }).estado).toBe('EN_CURSO');
    expect(ev('08:00', null, { ahoraMin: h('17:01') }).estado).toBe('INCOMPLETO');
  });

  it('día libre y días sin horario no se evalúan', () => {
    expect(evaluarDia({ dia: { ...DIA, trabaja: false }, ajuste: AJUSTE_POR_DEFECTO, entradaMin: null, salidaMin: null }).estado).toBe('DIA_LIBRE');
    expect(evaluarDia({ dia: null, ajuste: null, entradaMin: h('08:00'), salidaMin: null }).estado).toBe('SIN_HORARIO');
    expect(evaluarDia({ dia: DIA, ajuste: null, entradaMin: null, salidaMin: null }).estado).toBe('SIN_HORARIO');
  });
});
