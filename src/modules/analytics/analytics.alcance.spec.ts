import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

/** Usuario como lo deja `JwtStrategy.validate()`: `role` y `roleDetails` apuntan al mismo objeto. */
const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  const role = { namerol, capacidades: r.capacidades, ambito: r.ambito };
  return { id: `id-${namerol}`, role, roleDetails: role, ...extra };
};

function armar() {
  const prisma: any = {
    // Si el filtro de agencia quedó en "sin resultados", no devuelve agencias (como en la base real).
    agencia: {
      findMany: vi.fn((args: any) => Promise.resolve(args?.where?.id?.in?.length === 0 ? [] : [{ id: 'a1' }])),
      findUnique: vi.fn().mockResolvedValue({ regionId: 'r1' }),
      count: vi.fn().mockResolvedValue(0),
    },
    bodega: { findMany: vi.fn().mockResolvedValue([{ id: 'b1' }]) },
    bahia: { findMany: vi.fn().mockResolvedValue([]) },
    servicioLavado: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { precio: 0 } }),
    },
    incidenteTecnico: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { costoTotal: 0 } }),
    },
    alertaStock: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    maquinaria: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    mantenimientoMaquinaria: { findMany: vi.fn().mockResolvedValue([]) },
    consumoServicio: { findMany: vi.fn().mockResolvedValue([]) },
    movimientoInventario: { findMany: vi.fn().mockResolvedValue([]) },
    stockUbicacion: { findMany: vi.fn().mockResolvedValue([]) },
    servicioEspecial: { findMany: vi.fn().mockResolvedValue([]) },
    solicitudAprobacion: { findMany: vi.fn().mockResolvedValue([]) },
    auditoriaDecision: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    user: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    role: { findMany: vi.fn().mockResolvedValue([]) },
    catalogoServicio: { count: vi.fn().mockResolvedValue(0), groupBy: vi.fn().mockResolvedValue([]) },
    insumo: { count: vi.fn().mockResolvedValue(0) },
  };
  return { prisma, service: new AnalyticsService(prisma) };
}

const dondeServicios = (prisma: any) => JSON.stringify(prisma.servicioLavado.findMany.mock.calls[0][0].where);

describe('dashboard — alcance', () => {
  it('cada rol ve solo su agencia o su región; el cliente solo acota dentro de su alcance', async () => {
    const a = armar();
    await a.service.getDashboardMetrics({ agenciaId: 'a-ajena' } as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(dondeServicios(a.prisma)).toContain('"id":"a1"');
    expect(dondeServicios(a.prisma)).not.toContain('a-ajena');

    const b = armar();
    await b.service.getDashboardMetrics({ regionId: 'r-ajena' } as any, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(dondeServicios(b.prisma)).toContain('"regionId":"r1"');
    expect(dondeServicios(b.prisma)).not.toContain('r-ajena');
  });

  it('un usuario global puede acotar a la agencia que pida; sin filtro ve todo el país', async () => {
    const a = armar();
    await a.service.getDashboardMetrics({ agenciaId: 'a2' } as any, usuario('COORD_BODEGA'));
    expect(dondeServicios(a.prisma)).toContain('"id":"a2"');

    const b = armar();
    await b.service.getDashboardMetrics({} as any, usuario('COORD_BODEGA'));
    expect(JSON.parse(dondeServicios(b.prisma)).bahia).toBeUndefined();
  });

  it('un rol de agencia sin agencia no ve nada, en ninguna de las consultas', async () => {
    const { prisma, service } = armar();
    await service.getDashboardMetrics({ agenciaId: 'a1' } as any, usuario('LIDER'));
    expect(dondeServicios(prisma)).toContain('"id":{"in":[]}');
    expect(JSON.stringify(prisma.incidenteTecnico.count.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
    expect(JSON.stringify(prisma.alertaStock.findMany.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
    expect(JSON.stringify(prisma.maquinaria.groupBy.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
  });
});

describe('dashboard admin — KPIs estratégicos', () => {
  it('calcula ingresos, ticket, crecimiento, inventario y top agencias', async () => {
    const { prisma, service } = armar();
    prisma.servicioLavado.aggregate
      .mockResolvedValueOnce({ _sum: { precio: 500 } }) // hoy
      .mockResolvedValueOnce({ _sum: { precio: 6000 } }) // mes
      .mockResolvedValueOnce({ _sum: { precio: 5000 } }); // mes anterior
    prisma.servicioLavado.count.mockResolvedValue(10);
    prisma.servicioLavado.groupBy.mockResolvedValue([{ bahiaId: 'b1', _count: { id: 7 } }]);
    prisma.bahia.findMany.mockResolvedValue([{ id: 'b1', agencia: { nombre: 'Quito Norte' } }]);
    prisma.incidenteTecnico.aggregate.mockResolvedValue({ _sum: { costoTotal: 300 } });
    prisma.stockUbicacion.findMany.mockResolvedValue([{ cantidadActual: 10, insumo: { costoUnitarioUSD: 2 } }]);
    prisma.movimientoInventario.findMany.mockResolvedValue([{ detalles: [{ cantidadEnviada: 5, costoUnitarioUSD: 3 }] }]);

    const res: any = await service.getDashboardMetrics({} as any, usuario('ADMIN'));

    expect(res.isAdminView).toBe(true);
    expect(res.kpis.ingresoHoy).toBe(500);
    expect(res.kpis.ticketPromedioHoy).toBe(50); // 500 / 10 servicios
    expect(res.kpis.variacionMesPct).toBe(20); // (6000 - 5000) / 5000
    expect(res.kpis.costoReparaciones30d).toBe(300);
    expect(res.kpis.valorInventarioUSD).toBe(20); // 10 × $2
    expect(res.kpis.valorEnTransitoUSD).toBe(15); // 5 × $3
    expect(res.topAgenciasProductivas).toEqual([{ nombre: 'Quito Norte', cantidad: 7 }]);
  });
});

describe('dashboard aprobador — control', () => {
  it('cuenta anuladas del día y descuentos fuera de rango (>15% del precio enlazado)', async () => {
    const { prisma, service } = armar();
    prisma.solicitudAprobacion.findMany.mockImplementation((args: any) => {
      if (args?.select?.entidadRefId) {
        const createdAt = new Date();
        return Promise.resolve([
          { tipo: 'DESCUENTO', estado: 'APROBADO', createdAt, montoUSD: 30, entidadRefId: 's1' }, // 30/100 = 30% → fuera
          { tipo: 'DESCUENTO', estado: 'PENDIENTE', createdAt, montoUSD: 5, entidadRefId: 's2' }, // 5% → dentro
          { tipo: 'DESCUENTO', estado: 'PENDIENTE', createdAt, montoUSD: 20, entidadRefId: 'x' }, // sin precio base → no cuenta
        ]);
      }
      return Promise.resolve([]);
    });
    prisma.servicioLavado.findMany.mockResolvedValue([{ id: 's1', precio: 100 }, { id: 's2', precio: 100 }]);
    prisma.servicioLavado.count.mockResolvedValue(2);

    const res: any = await service.getDashboardMetrics({} as any, usuario('APROBADOR', { agenciaId: 'a1' }));

    expect(res.isAprobadorView).toBe(true);
    expect(res.kpis.descuentosFueraDeRango).toBe(1);
    expect(res.kpis.anuladasHoy).toBe(2);
  });
});

describe('consumo de químicos — alcance', () => {
  it('se limita a las agencias de su alcance', async () => {
    const a = armar();
    await a.service.getConsumoQuimicos({ agenciaId: 'a-ajena' } as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(a.prisma.agencia.findMany.mock.calls[0][0].where).toEqual({ id: 'a1' });
    expect(a.prisma.consumoServicio.findMany.mock.calls[0][0].where.agenciaId).toEqual({ in: ['a1'] });
    const b = armar();
    await b.service.getConsumoQuimicos({} as any, usuario('COORD_BODEGA'));
    expect(b.prisma.consumoServicio.findMany.mock.calls[0][0].where).not.toHaveProperty('agenciaId');
  });

  it('respeta el filtro por región de un usuario global (antes se ignoraba)', async () => {
    const { prisma, service } = armar();
    await service.getConsumoQuimicos({ regionId: 'r2' } as any, usuario('COORD_BODEGA'));
    expect(prisma.agencia.findMany.mock.calls[0][0].where).toEqual({ regionId: 'r2' });
    expect(prisma.consumoServicio.findMany.mock.calls[0][0].where.agenciaId).toEqual({ in: ['a1'] });
  });
});

describe('ranking de lavadores', () => {
  it('agrupa por operador, calcula cantidad y tiempo promedio solo sobre los que tienen hora de salida', async () => {
    const { prisma, service } = armar();
    prisma.servicioLavado.findMany.mockResolvedValue([
      { operadorId: 'op1', horaIngreso: new Date('2026-10-01T10:00:00Z'), horaSalida: new Date('2026-10-01T10:30:00Z'), operador: { id: 'op1', name: 'Juan', lastname: 'Pérez' } },
      { operadorId: 'op1', horaIngreso: new Date('2026-10-01T11:00:00Z'), horaSalida: new Date('2026-10-01T11:50:00Z'), operador: { id: 'op1', name: 'Juan', lastname: 'Pérez' } },
      { operadorId: 'op1', horaIngreso: new Date('2026-10-01T12:00:00Z'), horaSalida: null, operador: { id: 'op1', name: 'Juan', lastname: 'Pérez' } },
      { operadorId: 'op2', horaIngreso: new Date('2026-10-01T09:00:00Z'), horaSalida: new Date('2026-10-01T09:20:00Z'), operador: { id: 'op2', name: 'Ana', lastname: 'Soto' } },
    ]);

    const res = await service.getRankingLavadores({} as any, usuario('ADMIN'));
    expect(res.ranking).toHaveLength(2);
    const op1 = res.ranking.find((r: any) => r.operadorId === 'op1');
    expect(op1).toMatchObject({ nombre: 'Juan Pérez', cantidadServicios: 3, tiempoPromedioMin: 40 });
    const op2 = res.ranking.find((r: any) => r.operadorId === 'op2');
    expect(op2).toMatchObject({ nombre: 'Ana Soto', cantidadServicios: 1, tiempoPromedioMin: 20 });
    expect(res.ranking[0].operadorId).toBe('op1'); // ordenado por cantidad desc
  });

  it('se limita a las agencias de su alcance', async () => {
    const { prisma, service } = armar();
    await service.getRankingLavadores({ agenciaId: 'a-ajena' } as any, usuario('LIDER', { agenciaId: 'a1' }));
    const where = prisma.servicioLavado.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"id":"a1"');
    expect(JSON.stringify(where)).not.toContain('a-ajena');
  });
});

describe('dashboards dedicados — alcance y filtros', () => {
  it('el taller acota la maquinaria al alcance y al filtro pedido', async () => {
    const { prisma, service } = armar();
    await service.getDashboardTaller({ agenciaId: 'a2' } as any, usuario('COORD_BODEGA'));
    expect(JSON.stringify(prisma.maquinaria.findMany.mock.calls[0][0].where)).toContain('"id":"a2"');
  });

  it('la bodega aplica el alcance a alertas, movimientos y stock (ya no ve datos ajenos)', async () => {
    const { prisma, service } = armar();
    await service.getDashboardBodega({} as any, usuario('ASISTENTE_BODEGA', { regionId: 'r1' }));

    expect(prisma.agencia.findMany.mock.calls[0][0].where).toEqual({ regionId: 'r1' });
    expect(JSON.stringify(prisma.alertaStock.findMany.mock.calls[0][0].where)).toContain('"in":["a1"]');
    expect(prisma.movimientoInventario.findMany.mock.calls[0][0].where.OR).toEqual([
      { origenAgenciaId: { in: ['a1'] } },
      { destinoAgenciaId: { in: ['a1'] } },
      { origenBodegaId: { in: ['b1'] } },
      { destinoBodegaId: { in: ['b1'] } },
    ]);
    expect(prisma.stockUbicacion.findMany.mock.calls[0][0].where.OR).toEqual([
      { agenciaId: { in: ['a1'] } },
      { bodega: { regionId: 'r1' } },
    ]);
  });

  it('un rol de agencia sin agencia no ve movimientos ni stock', async () => {
    const { prisma, service } = armar();
    await service.getDashboardBodega({} as any, usuario('LIDER'));
    expect(prisma.movimientoInventario.findMany.mock.calls[0][0].where.OR).toEqual([
      { origenAgenciaId: { in: [] } },
      { destinoAgenciaId: { in: [] } },
    ]);
    expect(prisma.stockUbicacion.findMany.mock.calls[0][0].where.OR).toEqual([{ agenciaId: { in: [] } }]);
  });
});