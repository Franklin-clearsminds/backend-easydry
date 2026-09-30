import { describe, expect, it, vi } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';

const admin: Actor = { id: 'adm', rol: 'ADMIN', regionId: null, agenciaId: null };
const coordCosta: Actor = { id: 'coord', rol: 'COORD_MANTENIMIENTO', regionId: 'costa', agenciaId: null };

/**
 * Prisma simulado que reparte las filas en tres grupos según la condición recibida:
 * A (sin atender / vencidos), B (en proceso / pendientes) y C (cerradas / ejecutados).
 */
function fingirGrupos(A: any[], B: any[], C: any[], marcas: { A: RegExp; B: RegExp; C: RegExp }) {
  const grupoDe = (where: unknown): any[] => {
    const w = JSON.stringify(where);
    // La condición de las cerradas menciona los mismos estados que las otras: se comprueba primero.
    if (marcas.C.test(w)) return C;
    if (marcas.A.test(w)) return A;
    if (marcas.B.test(w)) return B;
    return [...A, ...B, ...C];
  };
  const count = vi.fn(async ({ where }: any) => grupoDe(where).length);
  const findMany = vi.fn(async ({ where, skip, take }: any) => grupoDe(where).slice(skip, skip + take));
  return { count, findMany };
}

function servicioCon(modelo: 'incidenteTecnico' | 'mantenimientoMaquinaria', mocks: { count: any; findMany: any }) {
  const prisma = {
    [modelo]: { count: mocks.count, findMany: mocks.findMany },
  };
  const service = new MaquinariaService(prisma as never, {} as never, {} as never);
  return service;
}

const inc = (id: string, estado: string, tecnicoAsignadoId: string | null) => ({ id, estado, tecnicoAsignadoId, gravedad: 'MEDIA', fechaReporte: new Date() });

describe('listIncidentes (paginación en el servidor)', () => {
  const A = [inc('a1', 'ABIERTO', null), inc('a2', 'ABIERTO', null)];
  const B = [inc('b1', 'EN_PROCESO', 't1'), inc('b2', 'EN_PROCESO', 't1'), inc('b3', 'EN_PROCESO', 't2')];
  const C = [inc('c1', 'RESUELTO', 't1'), inc('c2', 'CANCELADO', null)];
  const marcas = { A: /"tecnicoAsignadoId":null(?!.*NOT)/s, B: /"EN_PROCESO"/, C: /"NOT"/ };

  it('no trae 2.000 filas: pide solo la ventana de la página, sin atender primero', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const r: any = await servicioCon('incidenteTecnico', m).listIncidentes({ page: 1, pageSize: 3 } as never, admin);

    expect(r.data.map((i: any) => i.id)).toEqual(['a1', 'a2', 'b1']);
    expect(r.total).toBe(7);
    expect(r).toMatchObject({ page: 1, pageSize: 3, totalPages: 3, hasNextPage: true });
    // Nunca se pide más de la ventana
    const pedidas = m.findMany.mock.calls.map(([a]: any) => a.take);
    expect(pedidas.every((t: number) => t <= 3)).toBe(true);
    expect(m.findMany.mock.calls[0][0].orderBy).toEqual([{ fechaReporte: 'desc' }, { id: 'desc' }]);
  });

  it('las páginas siguientes continúan sin repetir ni saltar filas', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const service = servicioCon('incidenteTecnico', m);
    const todas: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r: any = await service.listIncidentes({ page, pageSize: 3 } as never, admin);
      todas.push(...r.data.map((i: any) => i.id));
    }
    expect(todas).toEqual(['a1', 'a2', 'b1', 'b2', 'b3', 'c1', 'c2']);
  });

  it('marca como no atendida solo lo abierto y sin técnico', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const r: any = await servicioCon('incidenteTecnico', m).listIncidentes({ pageSize: 10 } as never, admin);
    const banderas = Object.fromEntries(r.data.map((i: any) => [i.id, i.noAtendida]));
    expect(banderas).toMatchObject({ a1: true, a2: true, b1: false, c1: false, c2: false });
  });

  it('con una columna elegida ordena por ella (whitelist) en una sola consulta', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    await servicioCon('incidenteTecnico', m).listIncidentes({ sortField: 'maquina', sortOrder: 'asc', pageSize: 5 } as never, admin);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(m.findMany.mock.calls[0][0].orderBy).toEqual([{ maquinaria: { codigo: 'asc' } }, { id: 'asc' }]);
  });

  it('un campo de orden no permitido se ignora y se usan los grupos', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    await servicioCon('incidenteTecnico', m).listIncidentes({ sortField: 'passwordHash', pageSize: 10 } as never, admin);
    expect(m.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(JSON.stringify(m.findMany.mock.calls.map(([a]: any) => a.orderBy))).not.toContain('passwordHash');
  });

  it('recorta a 100 y un cliente sin tamaño recibe hasta 100 (antes 200)', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const service = servicioCon('incidenteTecnico', m);
    const r1: any = await service.listIncidentes({} as never, admin);
    expect(r1.pageSize).toBe(100);
    const r2: any = await service.listIncidentes({ pageSize: 200 } as never, admin);
    expect(r2.pageSize).toBe(100);
  });

  it('busca por texto, región, cliente y fechas en el servidor y respeta el alcance por rol', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    await servicioCon('incidenteTecnico', m).listIncidentes({
      search: 'hidro', regionId: 'costa', clienteId: 'cli1', tecnicoId: 't1', fechaDesde: '2026-09-01', fechaHasta: '2026-09-30',
    } as never, coordCosta);
    const donde = JSON.stringify(m.findMany.mock.calls[0][0].where);
    expect(donde).toContain('"contains":"hidro"');
    expect(donde).toContain('"regionId":"costa"');
    expect(donde).toContain('"clienteId":"cli1"');
    expect(donde).toContain('"tecnicoAsignadoId":"t1"');
    expect(donde).toContain('2026-09-30T23:59:59.999Z');
  });

  it('el resumen cuenta cada grupo con los filtros pero sin el de estado', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const r: any = await servicioCon('incidenteTecnico', m).listIncidentes(
      { estado: 'RESUELTO', incluirResumen: true, pageSize: 10 } as never, admin,
    );
    expect(r.resumen).toEqual({ noAtendidas: 2, enProceso: 3, cerradas: 2, total: 7 });
    const filtrosDelResumen = m.count.mock.calls.slice(-3).map(([a]: any) => JSON.stringify(a.where));
    expect(filtrosDelResumen.some((w: string) => w.includes('"estado":"RESUELTO"'))).toBe(false);
  });

  it('entrega el formato estándar con el alias data', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const r: any = await servicioCon('incidenteTecnico', m).listIncidentes({ pageSize: 10 } as never, admin);
    expect(r.success).toBe(true);
    expect(r.items).toEqual(r.data);
  });
});

describe('listMantenimientos (paginación en el servidor)', () => {
  const mant = (id: string, estado: string) => ({ id, estado, fechaProgramada: new Date('2026-09-01'), fechaMantenimiento: new Date('2026-09-01') });
  const A = [mant('v1', 'PENDIENTE'), mant('v2', 'EN_PROCESO')];
  const B = [mant('p1', 'PENDIENTE')];
  const C = [mant('e1', 'FINALIZADO'), mant('e2', 'FINALIZADO'), mant('e3', 'FINALIZADO')];
  const marcas = { A: /"lt":/, B: /"gte":/, C: /"NOT"/ };

  it('vencidos primero, luego pendientes y luego ejecutados, paginados sin repetir', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const service = servicioCon('mantenimientoMaquinaria', m);
    const todos: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const r: any = await service.listMantenimientos({ page, pageSize: 2 } as never, admin);
      todos.push(...r.data.map((x: any) => x.id));
      expect(r.total).toBe(6);
    }
    expect(todos).toEqual(['v1', 'v2', 'p1', 'e1', 'e2', 'e3']);
  });

  it('los sin fecha van al final de su grupo y los ejecutados ordenan por ejecución', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    await servicioCon('mantenimientoMaquinaria', m).listMantenimientos({ pageSize: 10 } as never, admin);
    const ordenes = m.findMany.mock.calls.map(([a]: any) => JSON.stringify(a.orderBy));
    expect(ordenes[0]).toContain('"nulls":"last"');
    expect(ordenes.some((o: string) => o.includes('fechaEjecucion'))).toBe(true);
  });

  it('el resumen cuenta vencidos, pendientes y ejecutados', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const r: any = await servicioCon('mantenimientoMaquinaria', m).listMantenimientos({ incluirResumen: true, pageSize: 10 } as never, admin);
    expect(r.resumen).toEqual({ vencidos: 2, pendientes: 1, ejecutados: 3, total: 6 });
  });

  it('solo no atendidos agrega la condición de vencido a todas las consultas', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    await servicioCon('mantenimientoMaquinaria', m).listMantenimientos({ soloNoAtendidos: true, pageSize: 10 } as never, admin);
    const condiciones = [...m.count.mock.calls, ...m.findMany.mock.calls].map(([a]: any) => JSON.stringify(a.where));
    expect(condiciones.length).toBeGreaterThan(0);
    expect(condiciones.every((w: string) => w.includes('"lt":'))).toBe(true);
  });

  it('ordena por una columna permitida y rechaza las demás', async () => {
    const m = fingirGrupos(A, B, C, marcas);
    const service = servicioCon('mantenimientoMaquinaria', m);
    await service.listMantenimientos({ sortField: 'tecnico', sortOrder: 'asc', pageSize: 5 } as never, admin);
    expect(m.findMany.mock.calls[0][0].orderBy).toEqual([{ tecnico: { name: 'asc' } }, { id: 'asc' }]);
    m.findMany.mockClear();
    await service.listMantenimientos({ sortField: 'costoTotal', pageSize: 5 } as never, admin);
    expect(JSON.stringify(m.findMany.mock.calls.map(([a]: any) => a.orderBy))).not.toContain('costoTotal');
  });
});
