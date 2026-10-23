import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: el dashboard de auditorías (estrellas) y las estrellas de una agencia.
 *
 * Mundo (enero de 2026)
 *  R1: A1 y A2.   R2: A3.
 *  A1: informes guardados BUENO (6-ene) y EXCELENTE (20-ene); un borrador MALO que no cuenta; 5S 90 % (8-ene) y 80 % (22-ene).
 *  A2: informe guardado REGULAR (10-ene); 5S 60 % (12-ene).   A3 (otra región): informe MALO que un supervisor de R1 no ve.
 */
const ENERO = { rango: 'RANGO', fechaDesde: '2026-01-01', fechaHasta: '2026-01-31' } as any;

describe('dashboard de auditorías (base real)', () => {
  let env: Entorno;
  let service: AnalyticsService;
  let a1: any, a2: any, a3: any, r1: any;
  const act: Record<string, any> = {};
  let n = 0;

  const informe = async (agenciaId: string, inspectorId: string, fecha: string, calificacion: string | null, estado = 'GUARDADO') => {
    n++;
    const f = new Date(`${fecha}T12:00:00Z`);
    const x = await env.prisma.informeInspeccion.create({
      data: {
        numero: `${env.marca}-INF-${n}`, numeroMensual: n, periodo: fecha.slice(0, 7), agenciaId, inspectorId, destinatarioNombre: 'Para',
        fecha: f, fechaVisita: f, estado, calificacion,
      },
    });
    env.rastrear('InformeInspeccion', x.id);
    return x;
  };
  const cincoS = async (agenciaId: string, auditorId: string, fecha: string, porcentaje: number, semaforo: string) => {
    n++;
    const x = await env.prisma.auditoria5s.create({
      data: { codigo: `${env.marca}-A5S-${n}`, agenciaId, auditorId, area: 'LAVADO', fecha: new Date(`${fecha}T12:00:00Z`), estado: 'GUARDADA', puntaje: Math.round(porcentaje), porcentaje, semaforo },
    });
    env.rastrear('Auditoria5s', x.id);
    return x;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AnalyticsService(env.prisma as never);
    r1 = await env.region('AU1');
    const r2 = await env.region('AU2');
    a1 = await env.agencia('AU-A1', { regionId: r1.id });
    a2 = await env.agencia('AU-A2', { regionId: r1.id });
    a3 = await env.agencia('AU-A3', { regionId: r2.id });
    const auditor = await env.usuario('au-auditor', 'ADMIN');
    for (const [s, rol, opts] of [
      ['au-sa', 'SUPER_ADMIN', {}],
      ['au-sup', 'SUPERVISOR', { regionId: r1.id }],
      ['au-lider', 'LIDER', { agenciaId: a1.id }],
    ] as Array<[string, string, Record<string, any>]>) act[s] = await env.actor((await env.usuario(s, rol, opts)).id);

    await informe(a1.id, auditor.id, '2026-01-06', 'BUENO');
    await informe(a1.id, auditor.id, '2026-01-20', 'EXCELENTE');
    await informe(a1.id, auditor.id, '2026-01-25', 'MALO', 'BORRADOR');
    await informe(a2.id, auditor.id, '2026-01-10', 'REGULAR');
    await informe(a3.id, auditor.id, '2026-01-11', 'MALO');
    await cincoS(a1.id, auditor.id, '2026-01-08', 90, 'VERDE');
    await cincoS(a1.id, auditor.id, '2026-01-22', 80, 'AMARILLO');
    await cincoS(a2.id, auditor.id, '2026-01-12', 60, 'ROJO');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('resume las estrellas, la distribución, la evolución y el ranking, sin contar borradores', async () => {
    const res: any = await service.getDashboardAuditorias({ ...ENERO, regionId: r1.id }, act['au-sa']);
    expect(res.kpis).toMatchObject({ informes: 3, auditorias5s: 3 });
    // (4 + 5 + 2.5) / 3 = 3.83 → 3.8;  (4.5 + 4 + 3) / 3 = 3.83 → 3.8
    expect(res.kpis.estrellasInspeccion).toBe(3.8);
    expect(res.kpis.estrellas5s).toBe(3.8);
    expect(res.distribucionCalificaciones).toEqual([
      { nombre: 'EXCELENTE', cantidad: 1 }, { nombre: 'BUENO', cantidad: 1 }, { nombre: 'REGULAR', cantidad: 1 }, { nombre: 'MALO', cantidad: 0 },
    ]);
    expect(res.distribucion5s).toEqual([{ nombre: 'VERDE', cantidad: 1 }, { nombre: 'AMARILLO', cantidad: 1 }, { nombre: 'ROJO', cantidad: 1 }]);
    expect(res.evolucionMensual).toEqual([{ periodo: '2026-01', estrellasInspeccion: 3.8, estrellas5s: 3.8 }]);
    // A1: inspección (4+5)/2 = 4.5, 5S (4.5+4)/2 = 4.3 → 4.3 (redondeo a un decimal de 4.25); promedio de ambos.
    const [primera, segunda] = res.rankingAgencias;
    expect(primera).toMatchObject({ nombre: a1.nombre, estrellasInspeccion: 4.5 });
    expect(segunda).toMatchObject({ nombre: a2.nombre, estrellasInspeccion: 2.5, estrellas5s: 3 });
    expect(primera.estrellas).toBeGreaterThan(segunda.estrellas);
  });

  it('respeta el alcance: el supervisor de R1 no ve las agencias de R2', async () => {
    const res: any = await service.getDashboardAuditorias(ENERO, act['au-sup']);
    expect(res.kpis.informes).toBe(3);
    expect(res.rankingAgencias.map((a: any) => a.agenciaId)).not.toContain(a3.id);
  });

  it('las estrellas de la agencia: la última 5S y el último informe guardado', async () => {
    const res: any = await service.getEstrellasAgencia({}, act['au-lider']);
    expect(res.agenciaId).toBe(a1.id);
    expect(res.inspeccion).toMatchObject({ estrellas: 5, calificacion: 'EXCELENTE', fecha: '2026-01-20' });
    expect(res.cincoS).toMatchObject({ estrellas: 4, porcentaje: 80, fecha: '2026-01-22' });
  });

  it('quien ve varias agencias pide la suya; una fuera de su alcance no devuelve nada', async () => {
    const dentro: any = await service.getEstrellasAgencia({ agenciaId: a2.id }, act['au-sup']);
    expect(dentro.inspeccion).toMatchObject({ estrellas: 2.5, calificacion: 'REGULAR' });
    const fuera: any = await service.getEstrellasAgencia({ agenciaId: a3.id }, act['au-sup']);
    expect(fuera).toMatchObject({ agenciaId: null, inspeccion: null, cincoS: null });
    const sinPedir: any = await service.getEstrellasAgencia({}, act['au-sup']);
    expect(sinPedir.agenciaId).toBeNull();
  });
});
