import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { StockResumenAgenciasDto, StockResumenBodegasDto, StockResumenPulidoresDto } from './dto/stock-resumen.dto.js';

const insumo = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  codigoSKU: `SKU-${id.toUpperCase()}`,
  nombre,
  categoria: 'QUIMICOS_LAVADO',
  contenidoNeto: 1,
  stockMinimoAgencia: 2,
  stockMinimoBodega: 10,
  stockOptimoBodega: 30,
  tipoProducto: { id: 't1', nombre: 'Líquido' },
  unidadMedida: { id: 'u1', simbolo: 'u', nombre: 'Unidad' },
  recetas: [] as Array<{ catalogoServicioId: number }>,
  ...extra,
});

const INSUMOS = [
  insumo('i1', 'Jabón neutro', { recetas: [{ catalogoServicioId: 1 }] }),
  insumo('i2', 'Cera líquida', { recetas: [{ catalogoServicioId: 1 }] }),
  insumo('i3', 'Pulidor abrasivo', { recetas: [{ catalogoServicioId: 2 }] }),
  insumo('i4', 'Ácido cítrico'),
];

function construir(op: { rol?: string; usuario?: Record<string, unknown> } = {}) {
  const usuario = op.rol ? { id: 'u1', role: { namerol: op.rol }, regionId: 'r1', region: { nombre: 'Norte' }, ...op.usuario } : null;
  const agencias = [
    { id: 'a1', codigo: 'A-01', nombre: 'Agencia Uno', region: 'Norte', regionId: 'r1', direccion: '', numeroBahias: 2, servicioIds: [1], tieneServiciosEspeciales: false },
    { id: 'a2', codigo: 'A-02', nombre: 'Agencia Dos', region: 'Norte', regionId: 'r1', direccion: '', numeroBahias: 1, servicioIds: [1], tieneServiciosEspeciales: false },
    { id: 'a3', codigo: 'A-03', nombre: 'Agencia Tres', region: 'Sur', regionId: 'r2', direccion: '', numeroBahias: 1, servicioIds: [], tieneServiciosEspeciales: false },
  ];
  const stocks = [
    { agenciaId: 'a1', insumoId: 'i1', cantidadActual: 0 }, // Sin Stock
    { agenciaId: 'a1', insumoId: 'i2', cantidadActual: 10 }, // Óptimo
    { agenciaId: 'a2', insumoId: 'i1', cantidadActual: 3 }, // Óptimo
    { agenciaId: 'a2', insumoId: 'i2', cantidadActual: 1 }, // Crítico
    { agenciaId: 'a3', insumoId: 'i4', cantidadActual: 5 }, // Óptimo
    // kits de pulidor
    { pulidorId: 'p1', insumoId: 'i3', cantidadActual: 0 }, // Sin Stock
    { pulidorId: 'p1', insumoId: 'i4', cantidadActual: 9 }, // Óptimo
    { pulidorId: 'p2', insumoId: 'i3', cantidadActual: 8 }, // Óptimo
  ];
  const pulidores = [
    { id: 'p1', name: 'Ana', lastname: 'Paz', email: 'ana@x.com', role: { namerol: 'PULIDOR_FIJO' }, regionId: 'r1', region: { id: 'r1', nombre: 'Norte' }, agenciaId: 'a1', agencia: { id: 'a1', nombre: 'Agencia Uno', regionId: 'r1' }, servicioIds: [] },
    { id: 'p2', name: 'Beto', lastname: 'Ruiz', email: 'beto@x.com', role: { namerol: 'PULIDOR_MOVIL' }, regionId: 'r1', region: { id: 'r1', nombre: 'Norte' }, agenciaId: null, agencia: null, servicioIds: [] },
  ];
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(usuario),
      findMany: vi.fn(async (args: any) =>
        pulidores.filter((p) => {
          const where = args.where || {};
          const coincide = (filtro: any) =>
            (!filtro.id || (typeof filtro.id === 'string' ? p.id === filtro.id : filtro.id.in?.includes(p.id))) &&
            (!filtro.regionId || p.regionId === filtro.regionId) &&
            (!filtro.agenciaId || p.agenciaId === filtro.agenciaId) &&
            (!filtro.agencia?.regionId || p.agencia?.regionId === filtro.agencia.regionId) &&
            (!filtro.OR || filtro.OR.some(coincide));
          return coincide(where) && (where.AND || []).every(coincide);
        }),
      ),
    },
    agencia: {
      findMany: vi.fn(async (args: any) =>
        agencias.filter((a) => {
          const where = args.where || {};
          const coincide = (filtro: any) =>
            (!filtro.id || (typeof filtro.id === 'string' ? a.id === filtro.id : filtro.id.in?.includes(a.id))) &&
            (!filtro.region || a.region === filtro.region) &&
            (!filtro.regionId || a.regionId === filtro.regionId);
          return coincide(where) && (where.AND || []).every(coincide);
        }),
      ),
    },
    insumo: { findMany: vi.fn().mockResolvedValue(INSUMOS) },
    stockUbicacion: {
      findMany: vi.fn(async (args: any) =>
        args?.where?.tipoUbicacion === 'AGENCIA' ? stocks.filter((s) => s.agenciaId) : stocks.filter((s) => (s as any).pulidorId),
      ),
    },
    recetaInsumo: { findMany: vi.fn().mockResolvedValue([{ insumoId: 'i3' }]) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([
      { insumoId: 'i1', cantidadActual: 0 }, // Agotado
      { insumoId: 'i2', cantidadActual: 8 }, // Crítico (≤ 10)
      { insumoId: 'i3', cantidadActual: 11 }, // Bajo (≤ 10 × 1.2 = 12)
      { insumoId: 'i4', cantidadActual: 50 }, // Óptimo
    ]),
  };
  const service = new InventarioService(prisma as never);
  vi.spyOn(service as any, 'listBodegas').mockResolvedValue([
    { id: 'b1', nombre: 'Bodega Central', esCentral: true, tipo: 'CENTRAL', porcentajeAlerta: 20, regionId: null },
  ]);
  return { service, prisma };
}

describe('obtenerStockAgenciasResumen', () => {
  it('modo heredado: la respuesta de siempre, con todos los insumos de cada ficha', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({}, undefined);
    expect(r).toMatchObject({ totalAgencias: 3, agenciasEnAlerta: 2, insumosCriticosTotal: 2 });
    expect(r.agencias).toHaveLength(3);
    const a1 = r.agencias.find((a: any) => a.agencia.id === 'a1');
    expect(a1).toMatchObject({ totalInsumos: 2, insumosCriticos: 1, tieneAlerta: true });
    expect(a1.insumos.map((i: any) => i.estado).sort()).toEqual(['Sin Stock', 'Óptimo']);
  });

  it('modo heredado por agencia (lo que usa la app móvil): una ficha con sus insumos', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({ agenciaId: 'a2' } as any);
    expect(r.agencias).toHaveLength(1);
    expect(r.agencias[0].insumos).toHaveLength(2);
  });

  it('paginado sin agenciaId: fichas sin insumos, métricas de toda la red y formato estándar', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({ page: 1, pageSize: 2 } as any);
    expect(r).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
    expect(r.metricas).toEqual({ totalAgencias: 3, agenciasEnAlerta: 2, insumosCriticosTotal: 2 });
    expect(r.items.map((a: any) => a.agencia.nombre)).toEqual(['Agencia Dos', 'Agencia Tres']);
    expect(r.items[0]).not.toHaveProperty('insumos');
    expect(r.items[0]).toMatchObject({ totalInsumos: 2, insumosCriticos: 1, tieneAlerta: true });
  });

  it('filtra por estado de la sede y busca por sede, región o insumo', async () => {
    const { service } = construir();
    const alerta: any = await service.obtenerStockAgenciasResumen({ page: 1, estadoUbicacion: 'alerta' } as any);
    expect(alerta.items.map((a: any) => a.agencia.id)).toEqual(['a2', 'a1']); // por defecto, alfabético por nombre
    const optimas: any = await service.obtenerStockAgenciasResumen({ page: 1, estadoUbicacion: 'optimo' } as any);
    expect(optimas.items.map((a: any) => a.agencia.id)).toEqual(['a3']);
    const porInsumo: any = await service.obtenerStockAgenciasResumen({ page: 1, search: 'acido' } as any);
    expect(porInsumo.items.map((a: any) => a.agencia.id)).toEqual(['a3']);
    const porRegion: any = await service.obtenerStockAgenciasResumen({ page: 1, search: 'norte' } as any);
    expect(porRegion.total).toBe(2);
    expect((await service.obtenerStockAgenciasResumen({ page: 1, search: 'a' } as any) as any).total).toBe(3);
  });

  it('ordena solo por columnas permitidas', async () => {
    const { service } = construir();
    const porCriticos: any = await service.obtenerStockAgenciasResumen({ page: 1, sortField: 'criticos', sortOrder: 'desc' } as any);
    expect(porCriticos.items.map((a: any) => a.agencia.id)).toEqual(['a2', 'a1', 'a3']); // 1, 1, 0 (empate: id descendente)
    const inyeccion: any = await service.obtenerStockAgenciasResumen({ page: 1, sortField: 'agencia.password', sortOrder: 'desc' } as any);
    // una columna que no está en la lista se ignora y se usa el orden por defecto (nombre ascendente)
    expect(inyeccion.items.map((a: any) => a.agencia.id)).toEqual(['a2', 'a3', 'a1']);
  });

  it('paginado con agenciaId: la ficha y una página de SUS insumos, con búsqueda, estado y orden', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({ page: 1, pageSize: 1, agenciaId: 'a1', sortField: 'estado', sortOrder: 'asc' } as any);
    expect(r.agencia).toMatchObject({ agencia: { id: 'a1' }, totalInsumos: 2, tieneAlerta: true });
    expect(r.agencia).not.toHaveProperty('insumos');
    expect(r).toMatchObject({ total: 2, totalPages: 2, hasNextPage: true });
    expect(r.items[0]).toMatchObject({ insumoId: 'i1', estado: 'Sin Stock' }); // el más grave primero
    const filtrado: any = await service.obtenerStockAgenciasResumen({ page: 1, agenciaId: 'a1', estado: 'optimo' } as any);
    expect(filtrado.items.map((i: any) => i.insumoId)).toEqual(['i2']);
    const buscado: any = await service.obtenerStockAgenciasResumen({ page: 1, agenciaId: 'a1', search: 'jabon' } as any);
    expect(buscado.items.map((i: any) => i.insumoId)).toEqual(['i1']);
  });

  it('una agencia fuera del alcance devuelve una página vacía, sin ficha', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({ page: 1, agenciaId: 'no-existe' } as any);
    expect(r).toMatchObject({ total: 0, items: [], agencia: null });
  });

  it('el asistente de bodega sigue limitado a su región', async () => {
    const { service, prisma } = construir({ rol: 'ASISTENTE_BODEGA' });
    await service.obtenerStockAgenciasResumen({ page: 1 } as any, 'u1');
    expect(JSON.stringify(prisma.agencia.findMany.mock.calls[0][0].where)).toContain('"regionId":"r1"');
  });

  it('el coordinador de mantenimiento ve agencias de su región y los filtros del cliente solo pueden reducirla', async () => {
    const { service, prisma } = construir({ rol: 'COORD_MANTENIMIENTO' });
    await service.obtenerStockAgenciasResumen({ page: 1, agenciaId: 'a-otra', region: 'Sur' } as any, 'u1');
    const where = prisma.agencia.findMany.mock.calls[0][0].where;
    expect(where.regionId).toBe('r1');
    expect(where.AND).toEqual([{ id: 'a-otra' }, { region: 'Sur' }]);
  });

  it('el líder queda acotado a las agencias de su región (para poder despachar), no a toda la red', async () => {
    const { service, prisma } = construir({
      rol: 'LIDER',
      usuario: { regionId: null, region: null, agenciaId: 'a1', agencia: { regionId: 'r1', region: 'Norte' } },
    });
    await service.obtenerStockAgenciasResumen({ page: 1 } as any, 'u1');
    expect(JSON.stringify(prisma.agencia.findMany.mock.calls[0][0].where)).toContain('"regionId":"r1"');
  });
});

describe('obtenerStockPulidoresResumen', () => {
  it('modo heredado: kits con todos sus insumos', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockPulidoresResumen({}, undefined);
    expect(r).toMatchObject({ totalPulidores: 2, pulidoresEnAlerta: 1, insumosCriticosTotal: 1 });
    expect(r.pulidores.find((p: any) => p.id === 'p1').insumos.length).toBeGreaterThan(0);
  });

  it('paginado: fichas sin insumos, con filtro por tipo y por estado', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockPulidoresResumen({ page: 1, pageSize: 10 } as any);
    expect(r).toMatchObject({ total: 2, page: 1 });
    expect(r.metricas).toEqual({ totalPulidores: 2, pulidoresEnAlerta: 1, insumosCriticosTotal: 1 });
    expect(r.items[0]).not.toHaveProperty('insumos');
    expect((await service.obtenerStockPulidoresResumen({ page: 1, tipoPulidor: 'PULIDOR_MOVIL' } as any) as any).items.map((p: any) => p.id)).toEqual(['p2']);
    expect((await service.obtenerStockPulidoresResumen({ page: 1, estadoUbicacion: 'alerta' } as any) as any).items.map((p: any) => p.id)).toEqual(['p1']);
    expect((await service.obtenerStockPulidoresResumen({ page: 1, search: 'ruiz' } as any) as any).items.map((p: any) => p.id)).toEqual(['p2']);
  });

  it('con pulidorId: la ficha y una página de los insumos de su kit', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockPulidoresResumen({ page: 1, pulidorId: 'p1', sortField: 'stock', sortOrder: 'asc' } as any);
    expect(r.pulidor).toMatchObject({ id: 'p1', tipoPulidor: 'PULIDOR_FIJO' });
    expect(r.items[0].stockActual).toBeLessThanOrEqual(r.items[r.items.length - 1].stockActual);
    expect(r.total).toBe(r.items.length);
  });

  it('un pulidor solo ve su propio kit', async () => {
    const { service, prisma } = construir({ rol: 'PULIDOR' });
    await service.obtenerStockPulidoresResumen({ page: 1 } as any, 'p2');
    expect(prisma.user.findMany.mock.calls[0][0].where.id).toBe('p2');
  });

  it('el coordinador de mantenimiento ve kits de su región sin poder sustituirla desde los filtros', async () => {
    const { service, prisma } = construir({ rol: 'COORD_MANTENIMIENTO' });
    await service.obtenerStockPulidoresResumen({ page: 1, regionId: 'r-otra', pulidorId: 'p-ajeno' } as any, 'u1');
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ regionId: 'r1' }, { agencia: { regionId: 'r1' } }]);
    expect(where.AND).toEqual([
      { id: 'p-ajeno' },
      { OR: [{ regionId: 'r-otra' }, { agencia: { regionId: 'r-otra' } }] },
    ]);
  });

  it('mantiene el alcance regional del asistente obtenido desde su bodega', async () => {
    const { service, prisma } = construir({
      rol: 'ASISTENTE_BODEGA',
      usuario: { regionId: null, bodega: { regionId: 'r1' } },
    });
    await service.obtenerStockPulidoresResumen({ page: 1 } as any, 'u1');
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
      { regionId: 'r1' },
      { agencia: { regionId: 'r1' } },
    ]);
  });
});

describe('obtenerStockBodegasResumen', () => {
  it('modo heredado: todos los insumos y las métricas de siempre', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockBodegasResumen({}, 'u1');
    expect(r.insumos).toHaveLength(4);
    expect(r.metricas).toMatchObject({ totalInsumos: 4, insumosBajoMinimo: 3, insumosOptimos: 1 });
  });

  it('paginado: página con búsqueda, estado y orden; las métricas cuentan todos los insumos', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockBodegasResumen({ page: 1, pageSize: 2, sortField: 'estado', sortOrder: 'asc' } as any, 'u1');
    expect(r).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
    expect(r.metricas.totalInsumos).toBe(4);
    expect(r.insumos).toBe(r.items);
    expect(r.items.map((i: any) => i.estado)).toEqual(['Agotado', 'Crítico']);

    const critico: any = await service.obtenerStockBodegasResumen({ page: 1, estado: 'critico' } as any, 'u1');
    expect(critico.items.map((i: any) => i.insumoId)).toEqual(['i2']);
    const buscado: any = await service.obtenerStockBodegasResumen({ page: 1, search: 'acido' } as any, 'u1');
    expect(buscado.items.map((i: any) => i.insumoId)).toEqual(['i4']);
    const porStock: any = await service.obtenerStockBodegasResumen({ page: 1, sortField: 'stock', sortOrder: 'desc' } as any, 'u1');
    expect(porStock.items.map((i: any) => i.insumoId)).toEqual(['i4', 'i3', 'i2', 'i1']);
  });
});

describe('DTO de los resúmenes', () => {
  it('no fijan page/pageSize y conservan los filtros que antes pasaban sin declarar', async () => {
    for (const Clase of [StockResumenAgenciasDto, StockResumenPulidoresDto, StockResumenBodegasDto]) {
      const vacio: any = plainToInstance(Clase as any, {});
      expect(vacio.page).toBeUndefined();
      expect(await validate(vacio)).toHaveLength(0);
    }
    const ag: any = plainToInstance(StockResumenAgenciasDto, { agenciaId: 'a', region: 'Norte', page: '1', estadoUbicacion: 'alerta' });
    expect(await validate(ag)).toHaveLength(0);
    expect(ag).toMatchObject({ agenciaId: 'a', region: 'Norte', page: 1 });
    expect((await validate(plainToInstance(StockResumenAgenciasDto, { estadoUbicacion: 'raro' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(StockResumenPulidoresDto, { tipoPulidor: 'otro' }))).length).toBeGreaterThan(0);
    expect(plainToInstance(StockResumenPulidoresDto, { pulidorId: 'p', regionId: 'r' })).toMatchObject({ pulidorId: 'p', regionId: 'r' });
    expect(plainToInstance(StockResumenBodegasDto, { bodegaId: 'b' })).toMatchObject({ bodegaId: 'b' });
  });
});

describe('insumos requeridos por servicios (agencia y kit de pulidor)', () => {
  const insumosCalculados = [
    { id: 'i1', codigoSKU: 'SKU-1', nombre: 'Jabón', tipoProducto: 'Líquido', estado: 'AGOTADO', stockActual: 0, stockMinimo: 2, serviciosEstimados: 0, serviciosAsociados: [{ nombre: 'Lavado básico' }] },
    { id: 'i2', codigoSKU: 'SKU-2', nombre: 'Cera', tipoProducto: 'Líquido', estado: 'OPTIMO', stockActual: 30, stockMinimo: 2, serviciosEstimados: 12, serviciosAsociados: [{ nombre: 'Encerado' }, { nombre: 'Lavado básico' }] },
    { id: 'i3', codigoSKU: 'SKU-3', nombre: 'Ácido', tipoProducto: 'Químico', estado: 'BAJO', stockActual: 2, stockMinimo: 2, serviciosEstimados: 1, serviciosAsociados: [{ nombre: 'Pulido' }] },
    { id: 'i4', codigoSKU: 'SKU-4', nombre: 'Guantes', tipoProducto: 'Consumible', estado: 'NO_NECESARIO', stockActual: 5, stockMinimo: 1, serviciosEstimados: 0, serviciosAsociados: [] },
  ];
  const base = { agencia: { id: 'a1' }, resumen: { totalInsumosEnSede: 4, insumosAgotados: 1 }, insumos: insumosCalculados };
  const { service } = construir();
  const paginar = (dto: any) => (service as any).paginarInsumosServicios(base, dto);

  it('modo heredado: la respuesta de siempre (con el tope de 100)', () => {
    const r = paginar(undefined);
    expect(r.insumos).toHaveLength(4);
    expect(r.resumen).toBe(base.resumen);
    expect(paginar({})).toMatchObject({ insumos: insumosCalculados });
  });

  it('paginado: el resumen cuenta todos los insumos y la página trae solo una parte', () => {
    const r = paginar({ page: 1, pageSize: 2 });
    expect(r.resumen).toBe(base.resumen);
    expect(r).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
    expect(r.insumos.map((i: any) => i.id)).toEqual(['i3', 'i2']); // por nombre: Ácido, Cera
    expect(r.items).toBe(r.insumos);
  });

  it('filtra por estado, busca (también por servicio) y ordena por gravedad', () => {
    expect(paginar({ page: 1, estado: 'agotado' }).insumos.map((i: any) => i.id)).toEqual(['i1']);
    expect(paginar({ page: 1, search: 'encerado' }).insumos.map((i: any) => i.id)).toEqual(['i2']);
    expect(paginar({ page: 1, search: 'lavado basico' }).insumos.map((i: any) => i.id)).toEqual(['i2', 'i1']);
    expect(paginar({ page: 1, sortField: 'estado', sortOrder: 'asc' }).insumos.map((i: any) => i.id)).toEqual(['i1', 'i3', 'i2', 'i4']);
    expect(paginar({ page: 1, sortField: 'capacidad', sortOrder: 'desc' }).insumos[0].id).toBe('i2');
    expect(paginar({ page: 1, sortField: 'servicios', sortOrder: 'desc' }).insumos[0].id).toBe('i2');
    expect(paginar({ page: 1, sortField: 'stockActual; DROP', sortOrder: 'desc' }).insumos.map((i: any) => i.id)).toEqual(['i3', 'i2', 'i4', 'i1']);
  });

  it('obtenerInsumosServiciosAgencia entrega la página y conserva el resumen completo', async () => {
    const { service: svc, prisma } = construir();
    (prisma as any).agencia.findUnique = vi.fn().mockResolvedValue({ id: 'a1', codigo: 'A-01', nombre: 'Uno', region: 'Norte', servicioIds: [1] });
    (prisma as any).catalogoServicio = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 1, codigo: 'S1', nombre: 'Lavado', categoria: 'BASICO',
          recetas: [
            { cantidadUsada: 1, insumo: INSUMOS[0], unidadConsumo: null },
            { cantidadUsada: 1, insumo: INSUMOS[1], unidadConsumo: null },
            { cantidadUsada: 1, insumo: INSUMOS[2], unidadConsumo: null },
          ],
        },
      ]),
    };
    (prisma as any).stockUbicacion = {
      findMany: vi.fn().mockResolvedValue([
        { insumoId: 'i1', cantidadActual: 0, cantidadMinima: 2, insumo: INSUMOS[0] },
        { insumoId: 'i2', cantidadActual: 30, cantidadMinima: 2, insumo: INSUMOS[1] },
        { insumoId: 'i3', cantidadActual: 1, cantidadMinima: 2, insumo: INSUMOS[2] },
      ]),
      create: vi.fn(),
    };
    const r: any = await svc.obtenerInsumosServiciosAgencia('a1', undefined, { page: 1, pageSize: 2, sortField: 'estado', sortOrder: 'asc' } as any);
    expect(r.resumen).toMatchObject({ totalInsumosEnSede: 3, insumosAgotados: 1, insumosBajoMinimo: 1, insumosOptimos: 1 });
    expect(r).toMatchObject({ total: 3, totalPages: 2 });
    expect(r.insumos.map((i: any) => i.estado)).toEqual(['AGOTADO', 'BAJO']);
    const heredado: any = await svc.obtenerInsumosServiciosAgencia('a1');
    expect(heredado.insumos).toHaveLength(3);
    expect(heredado.total).toBeUndefined();
  });

  it('el DTO conserva servicioIds y filtros, y no fija page/pageSize', async () => {
    const { InsumosServiciosDto } = await import('./dto/stock-resumen.dto.js');
    const dto: any = plainToInstance(InsumosServiciosDto, { agenciaId: 'a', servicioIds: [1, 2], estado: 'BAJO', page: '2' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ agenciaId: 'a', servicioIds: [1, 2], estado: 'BAJO', page: 2 });
    expect(plainToInstance(InsumosServiciosDto, {}).page).toBeUndefined();
  });
});

describe('obtenerStockAgenciasResumen — otras agencias (líder)', () => {
  it('excluye la agencia propia de las fichas, pero no de las métricas', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({ page: 1, excluirAgenciaId: 'a1' } as any);
    expect(r.items.map((a: any) => a.agencia.id)).toEqual(['a2', 'a3']);
    expect(r.total).toBe(2);
    expect(r.metricas.totalAgencias).toBe(3);
  });

  it('si la propia es la única no se excluye (la pantalla no queda vacía)', async () => {
    const { service } = construir();
    const r: any = await service.obtenerStockAgenciasResumen({ page: 1, excluirAgenciaId: 'a3', region: 'Sur' } as any);
    expect(r.items.map((a: any) => a.agencia.id)).toEqual(['a3']);
  });
});
