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
    mantenimientoMaquinaria: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    consumoServicio: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    movimientoInventario: { findMany: vi.fn().mockResolvedValue([]) },
    stockUbicacion: { findMany: vi.fn().mockResolvedValue([]) },
    servicioEspecial: { findMany: vi.fn().mockResolvedValue([]) },
    solicitudAprobacion: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
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
    // Servicios del periodo (alimentan top agencias, mix, color/marca y ganancia neta).
    prisma.servicioLavado.findMany.mockResolvedValue([
      { precio: 30, marca: 'Toyota', modelo: 'Corolla', color: 'Rojo', horaInicio: null, horaSalida: null, catalogo: { nombre: 'Lavado Express', categoria: 'GENERAL' }, bahia: { nombre: 'Bahía 01', agencia: { nombre: 'Quito Norte', region: 'Sierra' } }, consumos: [{ cantidadUsada: 2, insumo: { costoUnitarioUSD: 1 } }] },
      { precio: 50, marca: 'Toyota', modelo: 'Hilux', color: 'Rojo', horaInicio: null, horaSalida: null, catalogo: { nombre: 'Cerámico', categoria: 'ESPECIAL' }, bahia: { nombre: 'Bahía 02', agencia: { nombre: 'Quito Norte', region: 'Sierra' } }, consumos: [{ cantidadUsada: 1, insumo: { costoUnitarioUSD: 5 } }] },
    ]);
    prisma.incidenteTecnico.findMany.mockResolvedValue([
      { costoTotal: 300, createdAt: new Date(), maquinaria: { agencia: { nombre: 'Quito Norte' } } },
      // Fuera del periodo: no debe sumar al costo del rango consultado.
      { costoTotal: 999, createdAt: new Date('2020-01-01T10:00:00'), maquinaria: { agencia: { nombre: 'Quito Norte' } } },
    ]);
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
    expect(res.topAgenciasProductivas).toEqual([{ nombre: 'Quito Norte', cantidad: 2 }]);
    expect(res.topColores).toEqual([{ nombre: 'Rojo', cantidad: 2 }]);
    expect(res.mixGenerales).toEqual([{ nombre: 'Lavado Express', cantidad: 1 }]);
    expect(res.mixEspeciales).toEqual([{ nombre: 'Cerámico', cantidad: 1 }]);
    // Rentabilidad por agencia (nombre + ingresos del período).
    const rentabilidad = res.topAgenciasRentabilidad[0];
    expect(rentabilidad.nombre).toBe('Quito Norte');
    expect(rentabilidad.ingresos).toBe(80); // 30 + 50
  });
});

describe('dashboard admin — drill-down jerárquico', () => {
  it('agrupa por región en GLOBAL y calcula heatmap, top y bottom', async () => {
    const { prisma, service } = armar();
    // Servicios con hora de ingreso para poblar el heatmap (lunes 10:00, martes 15:00).
    const lunes10 = new Date('2026-10-05T10:00:00'); // lunes
    const martes15 = new Date('2026-10-06T15:00:00'); // martes
    prisma.servicioLavado.findMany.mockResolvedValue([
      { precio: 10, horaIngreso: lunes10, horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
      { precio: 20, horaIngreso: martes15, horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 02', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
    ]);
    prisma.servicioLavado.aggregate.mockResolvedValue({ _sum: { precio: 0 } });
    prisma.servicioLavado.count.mockResolvedValue(0);

    const res: any = await service.getDashboardMetrics({} as any, usuario('ADMIN'));

    expect(res.jerarquia.dimension).toBe('GLOBAL');
    expect(res.jerarquia.entidad).toBe('Región');
    expect(res.jerarquia.desglose[0]).toMatchObject({ nombre: 'Sierra', cantidad: 2 });
    expect(res.jerarquia.ranking.top[0].nombre).toBe('Sierra');
    // Heatmap: lunes (0) a las 10:00 → índice de hora 3; martes (1) a las 15:00 → índice 8.
    expect(res.jerarquia.heatmap.matriz[0][3]).toBe(1);
    expect(res.jerarquia.heatmap.matriz[1][8]).toBe(1);
  });

  it('con dimension=AGENCY agrupa por bahía y lista top/bottom de bahías', async () => {
    const { prisma, service } = armar();
    prisma.servicioLavado.findMany.mockResolvedValue([
      { precio: 10, horaIngreso: new Date('2026-10-05T10:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
      { precio: 10, horaIngreso: new Date('2026-10-05T11:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Luis', lastname: 'Mora' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
      { precio: 10, horaIngreso: new Date('2026-10-05T12:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Luis', lastname: 'Mora' }, bahia: { nombre: 'Bahía 02', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
    ]);
    prisma.servicioLavado.aggregate.mockResolvedValue({ _sum: { precio: 0 } });
    prisma.servicioLavado.count.mockResolvedValue(0);

    const res: any = await service.getDashboardMetrics({ dimension: 'AGENCY', agenciaId: 'a1' } as any, usuario('ADMIN'));

    expect(res.jerarquia.dimension).toBe('AGENCY');
    expect(res.jerarquia.entidad).toBe('Bahía');
    expect(res.jerarquia.desglose[0]).toMatchObject({ nombre: 'Bahía 01', cantidad: 2 });
    expect(res.jerarquia.ranking.entidad).toBe('Bahía');
  });

  it('con dimension=POLISHER filtra por operador y agrupa por día (evolución)', async () => {
    const { prisma, service } = armar();
    prisma.servicioLavado.findMany.mockResolvedValue([
      { precio: 10, horaIngreso: new Date('2026-10-05T10:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
      { precio: 20, horaIngreso: new Date('2026-10-06T09:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
    ]);
    prisma.servicioLavado.aggregate.mockResolvedValue({ _sum: { precio: 0 } });
    prisma.servicioLavado.count.mockResolvedValue(0);

    const res: any = await service.getDashboardMetrics(
      { dimension: 'POLISHER', pulidorId: 'op-1' } as any,
      usuario('ADMIN'),
    );

    // El alcance del filtro por operador debe llegar a la consulta.
    const where = prisma.servicioLavado.findMany.mock.calls[0][0].where;
    expect(where.operadorId).toBe('op-1');
    expect(res.jerarquia.dimension).toBe('POLISHER');
    expect(res.jerarquia.entidad).toBe('Día');
    expect(res.jerarquia.desglose.map((d: any) => d.nombre).sort()).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('lista las agencias operativas con menos actividad, incluidas las que no registraron servicios', async () => {
    const { prisma, service } = armar();
    prisma.agencia.findMany.mockResolvedValue([{ nombre: 'Quito Norte' }, { nombre: 'Ambato Centro' }]);
    prisma.servicioLavado.findMany.mockResolvedValue([
      { precio: 10, horaIngreso: new Date('2026-10-05T10:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
    ]);
    prisma.servicioLavado.aggregate.mockResolvedValue({ _sum: { precio: 0 } });
    prisma.servicioLavado.count.mockResolvedValue(0);

    const res: any = await service.getDashboardMetrics({} as any, usuario('ADMIN'));

    expect(res.jerarquia.bajaActividad.entidad).toBe('Agencia');
    expect(res.jerarquia.bajaActividad.items).toEqual([
      { nombre: 'Ambato Centro', cantidad: 0, tiempoPromedioMin: 0 },
      { nombre: 'Quito Norte', cantidad: 1, tiempoPromedioMin: 0 },
    ]);
    // Solo agencias activas y operativas: los talleres y las inactivas no cuentan como "dormidas".
    expect(prisma.agencia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ estado: 1, tipoUbicacion: 'OPERATIVA' }) }),
    );
  });

  it('la lista de menor actividad respeta la región filtrada', async () => {
    const { prisma, service } = armar();
    prisma.servicioLavado.aggregate.mockResolvedValue({ _sum: { precio: 0 } });
    prisma.servicioLavado.count.mockResolvedValue(0);

    await service.getDashboardMetrics({ regionId: 'r2' } as any, usuario('SUPER_ADMIN'));

    const whereOperativa = prisma.agencia.findMany.mock.calls.map((c: any) => c[0].where).find((w: any) => w?.tipoUbicacion);
    expect(whereOperativa).toEqual({ estado: 1, tipoUbicacion: 'OPERATIVA', regionId: 'r2' });
  });

  it('a nivel de agencia, la menor actividad se calcula por bahía', async () => {
    const { prisma, service } = armar();
    prisma.bahia.findMany.mockResolvedValue([{ nombre: 'Bahía 01' }, { nombre: 'Bahía 09' }]);
    prisma.servicioLavado.findMany.mockResolvedValue([
      { precio: 10, horaIngreso: new Date('2026-10-05T10:00:00'), horaInicio: null, horaSalida: null, operador: { name: 'Ana', lastname: 'Soto' }, bahia: { nombre: 'Bahía 01', agencia: { id: 'a1', nombre: 'Quito Norte', region: 'Sierra', regionRel: { nombre: 'Sierra' } } } },
    ]);
    prisma.servicioLavado.aggregate.mockResolvedValue({ _sum: { precio: 0 } });
    prisma.servicioLavado.count.mockResolvedValue(0);

    const res: any = await service.getDashboardMetrics({ dimension: 'AGENCY', agenciaId: 'a1' } as any, usuario('ADMIN'));

    expect(res.jerarquia.bajaActividad.entidad).toBe('Bahía');
    expect(res.jerarquia.bajaActividad.items.map((i: any) => [i.nombre, i.cantidad])).toEqual([['Bahía 09', 0], ['Bahía 01', 1]]);
    expect(prisma.bahia.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { agenciaId: 'a1' } }));
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

describe('salud de inventario — orden de ubicaciones', () => {
  /** Posición de stock con umbrales propios; `actual` define el estado resultante. */
  const posicion = (ubicacion: string, actual: number, minimo = 10, ideal = 40) => ({
    tipoUbicacion: 'AGENCIA',
    cantidadActual: actual,
    cantidadMinima: minimo,
    agencia: { nombre: ubicacion },
    insumo: { nombre: 'Shampoo', categoria: 'QUIMICO', costoUnitarioUSD: 2, stockMinimoAgencia: minimo, stockOptimoAgencia: ideal },
  });

  it('prioriza las ubicaciones con mezcla de severidades y completa con las más agotadas', async () => {
    const { prisma, service } = armar();
    prisma.stockUbicacion.findMany.mockResolvedValue([
      // 100% agotada y con MÁS problemas (4): antes copaba el primer lugar y el gráfico salía de un solo color.
      posicion('Solo Agotada', 0), posicion('Solo Agotada', 0), posicion('Solo Agotada', 0), posicion('Solo Agotada', 0),
      // Mezcla (2 críticos + 1 bajo ideal = 3 problemas): es la accionable y debe ir primero.
      posicion('Con Mezcla', 4), posicion('Con Mezcla', 4), posicion('Con Mezcla', 20),
      posicion('Otra Agotada', 0),
    ]);

    const res: any = await service.getDashboardBodega({} as any, usuario('COORD_BODEGA'));
    const nombres = res.saludPorUbicacion.map((u: any) => u.nombre);

    expect(nombres).toEqual(['Con Mezcla', 'Solo Agotada', 'Otra Agotada']);
    expect(res.saludPorUbicacion[0]).toEqual({
      nombre: 'Con Mezcla',
      AGOTADO: 0, 'CRÍTICO': 2, 'BAJO MÍNIMO': 0, 'BAJO IDEAL': 1, 'ÓPTIMO': 0, SOBRESTOCK: 0,
      criticos: 3, problemas: 3,
    });
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

  it('filtro por pulidor: acota las OT de Servicios Especiales al operador elegido', async () => {
    const { prisma, service } = armar();
    await service.getDashboardEspeciales({ pulidorId: 'op-1' } as any, usuario('COORD_SERVICIOS_ESPECIALES'));
    // Todas las consultas de la OT llevan el operadorId del pulidor seleccionado.
    for (const call of prisma.servicioEspecial.findMany.mock.calls) {
      expect(call[0].where.operadorId).toBe('op-1');
    }
    expect(prisma.servicioEspecial.findMany).toHaveBeenCalled();
  });

  it('filtro por pulidor: la bodega se acota al kit del pulidor', async () => {
    const { prisma, service } = armar();
    await service.getDashboardBodega({ pulidorId: 'op-1' } as any, usuario('COORD_BODEGA'));
    expect(prisma.alertaStock.findMany.mock.calls[0][0].where.pulidorId).toBe('op-1');
    expect(prisma.movimientoInventario.findMany.mock.calls[0][0].where.destinoPulidorId).toBe('op-1');
    expect(prisma.stockUbicacion.findMany.mock.calls[0][0].where.pulidorId).toBe('op-1');
  });
});

describe('filtros globales — periodo', () => {
  /** Rango explícito: se compara contra fechas locales, que es como las construye `resolverPeriodo`. */
  it('los rankings acotan al periodo pedido (antes ignoraban los presets y devolvían el mes completo)', async () => {
    const { prisma, service } = armar();

    await service.getRankingLavadores({ rango: 'RANGO', fechaDesde: '2026-01-01', fechaHasta: '2026-01-31' } as any, usuario('ADMIN'));
    const w = prisma.servicioLavado.findMany.mock.calls[0][0].where.horaIngreso;
    expect(w.gte.getTime()).toBe(new Date(2026, 0, 1).getTime());
    expect(w.lte.getTime()).toBe(new Date(2026, 0, 31, 23, 59, 59, 999).getTime());

    await service.getRankingPulidores({ rango: 'RANGO', fechaDesde: '2026-02-10', fechaHasta: '2026-02-11' } as any, usuario('ADMIN'));
    const w2 = prisma.servicioLavado.findMany.mock.calls[1][0].where.horaIngreso;
    expect(w2.gte.getTime()).toBe(new Date(2026, 1, 10).getTime());
    expect(w2.lte.getTime()).toBe(new Date(2026, 1, 11, 23, 59, 59, 999).getTime());
  });

  it('sin `rango` se conserva el mes en curso como respaldo', async () => {
    const { prisma, service } = armar();
    await service.getRankingLavadores({} as any, usuario('ADMIN'));
    const w = prisma.servicioLavado.findMany.mock.calls[0][0].where.horaIngreso;
    expect(w.gte.getDate()).toBe(1);
    expect(w.gte.getMonth()).toBe(new Date().getMonth());
  });

  it('el consumo de químicos también respeta el preset del periodo', async () => {
    const { prisma, service } = armar();
    prisma.consumoServicio.findMany.mockResolvedValue([]);
    await service.getConsumoQuimicos({ rango: 'RANGO', fechaDesde: '2026-03-01', fechaHasta: '2026-03-05' } as any, usuario('ADMIN'));
    const w = prisma.consumoServicio.findMany.mock.calls[0][0].where.createdAt;
    expect(w.gte.getTime()).toBe(new Date(2026, 2, 1).getTime());
    expect(w.lte.getTime()).toBe(new Date(2026, 2, 5, 23, 59, 59, 999).getTime());
  });
});

describe('dashboard taller — MTTR y periodo', () => {
  /** Incidente resuelto con una duración exacta en horas. */
  const incidente = (agencia: string, horas: number, gravedad = 'MEDIA') => {
    const reporte = new Date('2026-10-01T08:00:00');
    return {
      id: `i-${agencia}-${horas}`, titulo: 'Falla', gravedad, estado: 'RESUELTO', costoTotal: 100,
      fechaReporte: reporte, fechaSolucion: new Date(reporte.getTime() + horas * 3600000), createdAt: reporte,
      maquinaria: { nombre: 'Hidro', codigo: 'MQ-01', tipo: 'HIDRO', agencia: { nombre: agencia } },
    };
  };

  it('calcula el MTTR por agencia (dónde se resuelve lento) con su cantidad de incidentes', async () => {
    const { prisma, service } = armar();
    prisma.incidenteTecnico.findMany.mockResolvedValue([
      incidente('Quito Norte', 10),
      incidente('Quito Norte', 20),
      incidente('Ambato', 48, 'ALTA'),
    ]);
    prisma.maquinaria.findMany.mockResolvedValue([]);

    const res: any = await service.getDashboardTaller({} as any, usuario('ADMIN'));

    // Ordenado de más lento a más rápido, con el respaldo de cuántos incidentes promedian.
    expect(res.mttrPorAgencia).toEqual([
      { nombre: 'Ambato', horas: 48, incidentes: 1 },
      { nombre: 'Quito Norte', horas: 15, incidentes: 2 },
    ]);
    // El desglose por gravedad sigue existiendo y ahora informa sobre cuántos incidentes se calculó.
    expect(res.mttrPorGravedad).toEqual([{ nombre: 'MEDIA', horas: 15, incidentes: 2 }, { nombre: 'ALTA', horas: 48, incidentes: 1 }]);
  });

  it('acota la ventana de 30 días al fin del periodo y respeta el filtro de región', async () => {
    const { prisma, service } = armar();
    prisma.incidenteTecnico.findMany.mockResolvedValue([]);
    prisma.mantenimientoMaquinaria.findMany.mockResolvedValue([]);

    await service.getDashboardTaller(
      { rango: 'RANGO', fechaDesde: '2026-01-01', fechaHasta: '2026-01-31', regionId: 'r1' } as any,
      usuario('SUPER_ADMIN'),
    );

    const incWhere = prisma.incidenteTecnico.findMany.mock.calls[0][0].where;
    expect(incWhere.createdAt.lte.getTime()).toBe(new Date(2026, 0, 31, 23, 59, 59, 999).getTime());
    expect(incWhere.maquinaria).toEqual({ agencia: { regionId: 'r1' } });
    const mantWhere = prisma.mantenimientoMaquinaria.findMany.mock.calls[0][0].where;
    expect(mantWhere.createdAt.lte.getTime()).toBe(new Date(2026, 0, 31, 23, 59, 59, 999).getTime());
  });
});