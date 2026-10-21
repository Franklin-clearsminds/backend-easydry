import { horaDeReporte } from './hora-reporte';

describe('horaDeReporte', () => {
  const ahora = new Date('2026-10-21T15:00:00.000Z');

  it('sin hora del teléfono usa la del servidor', () => {
    expect(horaDeReporte(undefined, ahora)).toBe(ahora);
    expect(horaDeReporte('', ahora)).toBe(ahora);
  });

  it('acepta la hora del teléfono cuando es anterior (reporte hecho sin conexión)', () => {
    const r = horaDeReporte('2026-10-21T09:30:00.000Z', ahora);
    expect(r.toISOString()).toBe('2026-10-21T09:30:00.000Z');
  });

  it('tolera hasta 5 minutos de reloj adelantado, no más', () => {
    expect(horaDeReporte('2026-10-21T15:04:00.000Z', ahora).toISOString()).toBe('2026-10-21T15:04:00.000Z');
    expect(horaDeReporte('2026-10-21T15:10:00.000Z', ahora)).toBe(ahora);
  });

  it('rechaza relojes reseteados, fechas inválidas y reportes de hace más de 14 días', () => {
    expect(horaDeReporte('2001-01-01T00:00:00.000Z', ahora)).toBe(ahora);
    expect(horaDeReporte('no-es-fecha', ahora)).toBe(ahora);
    expect(horaDeReporte('2026-10-01T00:00:00.000Z', ahora)).toBe(ahora);
  });
});
