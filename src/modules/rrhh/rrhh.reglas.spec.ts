import { describe, expect, it } from 'vitest';
import {
  PRECISION_MAX_M,
  coordenadasValidas,
  diaComoFecha,
  distanciaMetros,
  evaluarUbicacion,
  fechaEnEcuador,
  horasTrabajadas,
  personaEnAlcance,
  tareaVencida,
  whereUsuariosEnAlcance,
  type SitioReferencia,
} from './rrhh.reglas.js';

const QUITO = { latitud: -0.1807, longitud: -78.4678 };
/** ~1 m en grados de latitud. */
const M = 1 / 111_320;
const sitio = (extra: Partial<SitioReferencia> = {}): SitioReferencia => ({
  tipo: 'AGENCIA', id: 'a1', nombre: 'Quito Norte', regionId: 'r1', latitud: QUITO.latitud, longitud: QUITO.longitud, radioM: 100, ...extra,
});
const aMetros = (m: number) => ({ latitud: QUITO.latitud + m * M, longitud: QUITO.longitud });

describe('distanciaMetros (Haversine)', () => {
  it('es cero entre el mismo punto', () => {
    expect(distanciaMetros(QUITO, QUITO)).toBe(0);
  });
  it('mide con exactitud razonable', () => {
    expect(distanciaMetros(QUITO, aMetros(100))).toBeGreaterThan(99);
    expect(distanciaMetros(QUITO, aMetros(100))).toBeLessThan(101);
    // Quito – Guayaquil, unos 270 km en línea recta
    const d = distanciaMetros(QUITO, { latitud: -2.17, longitud: -79.92 });
    expect(d).toBeGreaterThan(260_000);
    expect(d).toBeLessThan(280_000);
  });
  it('es simétrica', () => {
    const a = aMetros(250);
    expect(distanciaMetros(QUITO, a)).toBeCloseTo(distanciaMetros(a, QUITO), 6);
  });
});

describe('coordenadasValidas', () => {
  it('acepta coordenadas reales y rechaza lo demás', () => {
    expect(coordenadasValidas(-0.18, -78.46)).toBe(true);
    expect(coordenadasValidas(91, 0)).toBe(false);
    expect(coordenadasValidas(0, 181)).toBe(false);
    expect(coordenadasValidas(undefined, 0)).toBe(false);
    expect(coordenadasValidas(NaN, 0)).toBe(false);
    expect(coordenadasValidas('1', '2')).toBe(false);
  });
});

describe('día y hora en Ecuador', () => {
  it('Ecuador va 5 horas detrás de UTC', () => {
    expect(fechaEnEcuador(new Date('2026-11-09T13:30:00Z'))).toEqual({ dia: '2026-11-09', hora: 8, minuto: 30 });
  });
  it('de madrugada en UTC todavía es el día anterior en Ecuador', () => {
    expect(fechaEnEcuador(new Date('2026-11-09T04:59:00Z'))).toEqual({ dia: '2026-11-08', hora: 23, minuto: 59 });
    expect(fechaEnEcuador(new Date('2026-11-09T05:00:00Z'))).toEqual({ dia: '2026-11-09', hora: 0, minuto: 0 });
  });
  it('el día se guarda a medianoche UTC', () => {
    expect(diaComoFecha('2026-11-09').toISOString()).toBe('2026-11-09T00:00:00.000Z');
  });
});

describe('horasTrabajadas', () => {
  it('calcula la diferencia entre entrada y salida', () => {
    expect(horasTrabajadas(new Date('2026-11-09T13:00:00Z'), new Date('2026-11-09T22:30:00Z'))).toBe(9.5);
  });
  it('sin una de las dos marcas, o con la salida antes de la entrada, no hay horas', () => {
    expect(horasTrabajadas(new Date(), null)).toBeNull();
    expect(horasTrabajadas(null, new Date())).toBeNull();
    expect(horasTrabajadas(new Date('2026-11-09T22:00:00Z'), new Date('2026-11-09T13:00:00Z'))).toBeNull();
  });
});

describe('evaluarUbicacion', () => {
  it('sin agencia ni bodega asignada no se puede timbrar, haya o no GPS', () => {
    expect(evaluarUbicacion([], {})).toMatchObject({ ok: false, motivo: 'SIN_SITIO', mensaje: expect.stringContaining('una agencia asignada') });
    expect(evaluarUbicacion([], { ...aMetros(0), precisionM: 5 }, 'APP', 'BODEGA')).toMatchObject({ ok: false, motivo: 'SIN_SITIO', mensaje: expect.stringContaining('una bodega asignada') });
  });

  it('con el sitio sin ubicación guardada tampoco se puede timbrar, y se devuelve el sitio para avisar a los administradores', () => {
    const s = sitio({ latitud: null, longitud: null });
    const r = evaluarUbicacion([s], { ...aMetros(0), precisionM: 5 });
    expect(r).toMatchObject({ ok: false, motivo: 'SIN_REFERENCIA', mensaje: expect.stringContaining('aún no tiene su ubicación configurada') });
    expect(!r.ok && r.sitioSinUbicacion).toEqual([expect.objectContaining({ id: s.id })]);
  });

  it('en «cualquier agencia», si ninguna tiene ubicación guardada no se puede timbrar', () => {
    expect(evaluarUbicacion([], { ...aMetros(0), precisionM: 5 }, 'WEB', 'CUALQUIER_AGENCIA')).toMatchObject({ ok: false, motivo: 'SIN_REFERENCIA' });
  });

  it('dentro del radio es válida y devuelve la distancia', () => {
    const r = evaluarUbicacion([sitio()], { ...aMetros(60), precisionM: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.verificacion).toBe('VERIFICADA');
      expect(r.distanciaM).toBeGreaterThan(59);
      expect(r.distanciaM).toBeLessThan(61);
      expect(r.radioM).toBe(100);
    }
  });

  it('justo en el borde del radio todavía vale, y un poco más allá se rechaza con la distancia', () => {
    expect(evaluarUbicacion([sitio()], { ...aMetros(99), precisionM: 10 }).ok).toBe(true);
    const lejos = evaluarUbicacion([sitio()], { ...aMetros(101), precisionM: 10 });
    expect(lejos).toMatchObject({ ok: false, motivo: 'LEJOS' });
    if (!lejos.ok) expect(lejos.mensaje).toMatch(/Estás a 101 m de Quito Norte.*100 m o menos/);
  });

  it('el radio es de 100 m en la app y en la web, sin importar el guardado en el sitio', () => {
    const s = sitio({ radioM: 30 });
    for (const canal of ['APP', 'WEB'] as const) {
      expect(evaluarUbicacion([s], { ...aMetros(90), precisionM: 10 }, canal).ok).toBe(true);
      expect(evaluarUbicacion([s], { ...aMetros(150), precisionM: 10 }, canal)).toMatchObject({ ok: false, motivo: 'LEJOS' });
    }
  });

  it('la precisión aceptada llega a 120 m en los dos canales', () => {
    for (const canal of ['APP', 'WEB'] as const) {
      expect(evaluarUbicacion([sitio()], { ...aMetros(10), precisionM: 120 }, canal).ok).toBe(true);
      expect(evaluarUbicacion([sitio()], { ...aMetros(10), precisionM: 121 }, canal)).toMatchObject({ ok: false, motivo: 'PRECISION' });
    }
  });

  it('sin coordenadas se pide activar la ubicación', () => {
    expect(evaluarUbicacion([sitio()], { precisionM: 10 })).toMatchObject({ ok: false, motivo: 'FALTA_UBICACION' });
    expect(evaluarUbicacion([sitio()], { latitud: 999, longitud: 0, precisionM: 10 })).toMatchObject({ ok: false, motivo: 'FALTA_UBICACION' });
  });

  it('la precisión de 120 m o mejor vale; una lectura más vaga se rechaza aunque esté cerca', () => {
    expect(PRECISION_MAX_M).toBe(120);
    expect(evaluarUbicacion([sitio()], { ...aMetros(10), precisionM: 120 }).ok).toBe(true);
    expect(evaluarUbicacion([sitio()], { ...aMetros(10), precisionM: 121 })).toMatchObject({ ok: false, motivo: 'PRECISION' });
    expect(evaluarUbicacion([sitio()], { ...aMetros(10) })).toMatchObject({ ok: false, motivo: 'PRECISION' });
    expect(evaluarUbicacion([sitio()], { ...aMetros(10), precisionM: -1 })).toMatchObject({ ok: false, motivo: 'PRECISION' });
  });

  it('con agencia y bodega vale estar dentro de cualquiera de las dos y devuelve cuál', () => {
    const agencia = sitio();
    const bodega = sitio({ tipo: 'BODEGA', id: 'b1', nombre: 'Bodega Sur', latitud: QUITO.latitud - 0.1, longitud: QUITO.longitud });
    const enBodega = { latitud: bodega.latitud as number, longitud: bodega.longitud as number, precisionM: 15 };
    const r = evaluarUbicacion([agencia, bodega], enBodega);
    expect(r.ok && r.sitio?.id).toBe('b1');
    const enAgencia = evaluarUbicacion([agencia, bodega], { ...aMetros(5), precisionM: 15 });
    expect(enAgencia.ok && enAgencia.sitio?.id).toBe('a1');
  });

  it('si uno de los dos sitios no tiene ubicación, se valida contra el que sí la tiene', () => {
    const sinUbicacion = sitio({ tipo: 'BODEGA', id: 'b1', latitud: null, longitud: null });
    const r = evaluarUbicacion([sitio(), sinUbicacion], { ...aMetros(10), precisionM: 10 });
    expect(r.ok && r.verificacion).toBe('VERIFICADA');
    expect(r.ok && r.sitio.id).toBe('a1');
    // y lejos del que sí la tiene, se rechaza
    expect(evaluarUbicacion([sitio(), sinUbicacion], { ...aMetros(900), precisionM: 10 }).ok).toBe(false);
  });
});

describe('alcance de personas', () => {
  const persona = { agenciaId: 'a1', regionId: null, agencia: { regionId: 'r1' }, bodega: null };

  it('global alcanza a todos', () => {
    expect(personaEnAlcance({ tipo: 'GLOBAL' }, persona)).toBe(true);
  });
  it('región: la región propia, la de su agencia o la de su bodega', () => {
    expect(personaEnAlcance({ tipo: 'REGION', regionId: 'r1' }, persona)).toBe(true);
    expect(personaEnAlcance({ tipo: 'REGION', regionId: 'r2' }, persona)).toBe(false);
    expect(personaEnAlcance({ tipo: 'REGION', regionId: 'r3' }, { regionId: 'r3' })).toBe(true);
    expect(personaEnAlcance({ tipo: 'REGION', regionId: 'r4' }, { bodega: { regionId: 'r4' } })).toBe(true);
    expect(personaEnAlcance({ tipo: 'REGION', regionId: 'r1' }, {})).toBe(false);
  });
  it('agencia: solo las personas de su agencia', () => {
    expect(personaEnAlcance({ tipo: 'AGENCIA', agenciaId: 'a1' }, persona)).toBe(true);
    expect(personaEnAlcance({ tipo: 'AGENCIA', agenciaId: 'a2' }, persona)).toBe(false);
    expect(personaEnAlcance({ tipo: 'AGENCIA', agenciaId: 'a1' }, { agenciaId: null })).toBe(false);
  });
  it('propio y sin ámbito no alcanzan a nadie', () => {
    expect(personaEnAlcance({ tipo: 'PROPIO', userId: 'u' }, persona)).toBe(false);
    expect(personaEnAlcance({ tipo: 'NINGUNO' }, persona)).toBe(false);
  });
  it('el filtro de Prisma sigue la misma regla', () => {
    expect(whereUsuariosEnAlcance({ tipo: 'GLOBAL' })).toEqual({});
    expect(whereUsuariosEnAlcance({ tipo: 'AGENCIA', agenciaId: 'a1' })).toEqual({ agenciaId: 'a1' });
    expect(JSON.stringify(whereUsuariosEnAlcance({ tipo: 'REGION', regionId: 'r1' }))).toContain('"regionId":"r1"');
    expect(whereUsuariosEnAlcance({ tipo: 'NINGUNO' })).toEqual({ id: { in: [] } });
  });
});

describe('tarea vencida', () => {
  const ayer = new Date(Date.now() - 86_400_000);
  const manana = new Date(Date.now() + 86_400_000);
  it('solo una Pendiente con la fecha límite pasada', () => {
    expect(tareaVencida({ estado: 'PENDIENTE', fechaLimite: ayer })).toBe(true);
    expect(tareaVencida({ estado: 'PENDIENTE', fechaLimite: manana })).toBe(false);
    expect(tareaVencida({ estado: 'PENDIENTE', fechaLimite: null })).toBe(false);
    expect(tareaVencida({ estado: 'COMPLETADA', fechaLimite: ayer })).toBe(false);
    expect(tareaVencida({ estado: 'REVISADA', fechaLimite: ayer })).toBe(false);
    expect(tareaVencida({ estado: 'CANCELADA', fechaLimite: ayer })).toBe(false);
  });
});
