import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListMovimientosGlobalesDto } from './dto/movimiento-operacion.dto.js';
import { ListKardexDto } from './dto/kardex.dto.js';

function construir(total = 0, role = 'ADMIN') {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(total);
  const groupBy = vi.fn().mockResolvedValue([
    { tipoMovimientoId: 't-entrada', _count: { _all: 4 } },
    { tipoMovimientoId: 't-consumo', _count: { _all: 6 } },
  ]);
  const kFindMany = vi.fn().mockResolvedValue([]);
  const kCount = vi.fn().mockResolvedValue(total);
  const prisma = {
    movimientoInventarioGlobal: { findMany, count, groupBy },
    kardexMovimiento: { findMany: kFindMany, count: kCount },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: { namerol: role }, bodega: null }) },
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: 'bod-1' }]),
  };
  const service = new InventarioService(prisma as never);
  vi.spyOn(service as any, 'ensureMovimientoGlobalRutaColumns').mockResolvedValue(undefined);
  return { service, findMany, count, groupBy, kFindMany, kCount };
}

describe('InventarioService.listMovimientosGlobales (Kardex)', () => {
  it('sin tamaño de página (cliente antiguo) devuelve hasta 100, no 20', async () => {
    const { service, findMany } = construir(500);
    await service.listMovimientosGlobales({} as any);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
  });

  it('los DTO ya no fijan page/pageSize/sortField por su cuenta y validan', async () => {
    for (const Clase of [ListMovimientosGlobalesDto, ListKardexDto]) {
      const dto: any = plainToInstance(Clase as any, {});
      expect(dto.pageSize).toBeUndefined();
      expect(dto.page).toBeUndefined();
      expect(dto.sortField).toBeUndefined();
      expect(await validate(dto)).toHaveLength(0);
      const con: any = plainToInstance(Clase as any, { pageSize: 200, page: 2 });
      expect(await validate(con)).toHaveLength(0);
    }
  });

  it('pagina en el servidor y recorta a 100', async () => {
    const { service, findMany } = construir(1000);
    const r: any = await service.listMovimientosGlobales({ page: 3, pageSize: 25 } as any);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 25 });
    expect(r).toMatchObject({ total: 1000, page: 3, pageSize: 25, totalPages: 40, hasNextPage: true });
    await service.listMovimientosGlobales({ pageSize: 200 } as any);
    expect(findMany.mock.calls[1][0].take).toBe(100);
  });

  it('ordena por fecha desc con desempate por id y solo por columnas permitidas', async () => {
    const { service, findMany } = construir();
    await service.listMovimientosGlobales({} as any);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ fechaMovimiento: 'desc' }, { id: 'desc' }]);

    await service.listMovimientosGlobales({ sortField: 'producto', sortOrder: 'asc' } as any);
    expect(findMany.mock.calls[1][0].orderBy[0]).toEqual({ insumo: { nombre: 'asc' } });

    await service.listMovimientosGlobales({ sortField: 'stockNuevo', sortOrder: 'asc' } as any);
    expect(findMany.mock.calls[2][0].orderBy).toEqual([{ stockNuevo: 'asc' }, { id: 'asc' }]);

    await service.listMovimientosGlobales({ sortField: 'evidenciasUrls; DROP TABLE', sortOrder: 'asc' } as any);
    expect(findMany.mock.calls[3][0].orderBy).toEqual([{ fechaMovimiento: 'desc' }, { id: 'desc' }]);
  });

  it('busca por palabras en comprobante, insumo, responsable y más', async () => {
    const { service, findMany } = construir();
    await service.listMovimientosGlobales({ search: 'mov jabon' } as any);
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"numeroComprobante":{"contains":"mov","mode":"insensitive"}');
    expect(where).toContain('"insumo":{"nombre":{"contains":"jabon","mode":"insensitive"}}');
    expect(where).toContain('"insumo":{"codigoSKU"');
    expect(where).toContain('"responsable":{"name"');
    expect(where).toContain('"referencia"');
  });

  it('una búsqueda de una sola letra se ignora', async () => {
    const { service, findMany } = construir();
    await service.listMovimientosGlobales({ search: 'a' } as any);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('contains');
  });

  it('aplica insumo, tipo, ubicación y rango de fechas en el servidor', async () => {
    const { service, findMany } = construir();
    await service.listMovimientosGlobales({
      insumoId: 'i1',
      tipoMovimientoId: 't1',
      ubicacionId: 'b1',
      fechaDesde: '2026-09-01T05:00:00.000Z',
      fechaHasta: '2026-09-30',
    } as any);
    const txt = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(txt).toContain('"insumoId":"i1"');
    expect(txt).toContain('"tipoMovimientoId":"t1"');
    expect(txt).toContain('"ubicacionId":"b1"');
    expect(txt).toContain('"gte":"2026-09-01T05:00:00.000Z"');
    expect(txt).toContain('"lte":"2026-09-30T23:59:59.999Z"');
  });

  it('una fecha inválida se ignora en vez de romper la consulta', async () => {
    const { service, findMany } = construir();
    await service.listMovimientosGlobales({ fechaDesde: 'no-es-fecha' } as any);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('fechaMovimiento');
  });

  it('un rol global no recibe filtro de ubicación', async () => {
    const { service, findMany } = construir(0, 'ADMIN');
    await service.listMovimientosGlobales({} as any, 'u1');
    expect(findMany.mock.calls[0][0].where).toEqual({});
  });

  it('el coordinador de bodega conserva su alcance por ubicación (y sus propios movimientos)', async () => {
    const { service, findMany } = construir(0, 'COORD_BODEGA');
    await service.listMovimientosGlobales({ tipoMovimientoId: 't1' } as any, 'u1');
    const txt = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(txt).toContain('"ubicacionId":{"in":["bod-1","BODEGA_CENTRAL","bod_central"]}');
    expect(txt).toContain('"ubicacionId":null');
    expect(txt).toContain('"responsableId":"u1"');
    expect(txt).toContain('"tipoMovimientoId":"t1"');
  });

  it('el resumen cuenta por tipo con los mismos filtros pero sin el de tipo', async () => {
    const { service, groupBy } = construir(10);
    const r: any = await service.listMovimientosGlobales({ incluirResumen: true, tipoMovimientoId: 't1', insumoId: 'i1' } as any);
    expect(r.resumen).toEqual({ porTipo: { 't-entrada': 4, 't-consumo': 6 }, total: 10 });
    const where = JSON.stringify(groupBy.mock.calls[0][0].where);
    expect(where).toContain('"insumoId":"i1"');
    expect(where).not.toContain('"tipoMovimientoId":"t1"');
  });

  it('sin incluirResumen no consulta el resumen', async () => {
    const { service, groupBy } = construir();
    const r: any = await service.listMovimientosGlobales({} as any);
    expect(groupBy).not.toHaveBeenCalled();
    expect(r.resumen).toBeUndefined();
  });
});

describe('InventarioService.listKardex (kardex/list)', () => {
  it('hasta 100 sin tamaño, recorta a 100 y conserva la forma de respuesta', async () => {
    const { service, kFindMany } = construir(300);
    const r: any = await service.listKardex({} as any);
    expect(kFindMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
    expect(r).toMatchObject({ total: 300, items: [], data: [] });
    await service.listKardex({ pageSize: 200, page: 2 } as any);
    expect(kFindMany.mock.calls[1][0]).toMatchObject({ skip: 100, take: 100 });
  });

  it('orden por fecha desc por defecto; createdAt equivale a fecha; campo malicioso ignorado', async () => {
    const { service, kFindMany } = construir();
    await service.listKardex({} as any);
    expect(kFindMany.mock.calls[0][0].orderBy).toEqual([{ fecha: 'desc' }, { id: 'desc' }]);
    await service.listKardex({ sortField: 'createdAt', sortOrder: 'asc' } as any);
    expect(kFindMany.mock.calls[1][0].orderBy[0]).toEqual({ fecha: 'asc' });
    await service.listKardex({ sortField: 'insumo', sortOrder: 'asc' } as any);
    expect(kFindMany.mock.calls[2][0].orderBy[0]).toEqual({ insumo: { nombre: 'asc' } });
    await service.listKardex({ sortField: 'insumoId; x', sortOrder: 'asc' } as any);
    expect(kFindMany.mock.calls[3][0].orderBy).toEqual([{ fecha: 'desc' }, { id: 'desc' }]);
  });

  it('filtros y búsqueda', async () => {
    const { service, kFindMany, kCount } = construir();
    await service.listKardex({ insumoId: 'i1', ubicacionId: 'u1', tipoMovimiento: 'COMPRA_INGRESO', fechaDesde: '2026-01-01', search: 'jabon' } as any);
    const txt = JSON.stringify(kFindMany.mock.calls[0][0].where);
    expect(txt).toContain('"insumoId":"i1"');
    expect(txt).toContain('"tipoMovimiento":"COMPRA_INGRESO"');
    expect(txt).toContain('"gte"');
    expect(txt).toContain('"contains":"jabon"');
    expect(kCount.mock.calls[0][0].where).toEqual(kFindMany.mock.calls[0][0].where);
  });
});

describe('InventarioService.listKardex — alcance por rol y nombre de ubicación', () => {
  it('sin usuario o con un admin: sin restricción de ubicación', async () => {
    const prisma: any = {
      kardexMovimiento: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: { namerol: 'ADMIN' } }) },
    };
    const service = new InventarioService(prisma as never);
    await service.listKardex({} as any);
    expect(prisma.kardexMovimiento.findMany.mock.calls[0][0].where).toEqual({});
    await service.listKardex({} as any, 'u1');
    expect(prisma.kardexMovimiento.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('el asistente de bodega solo ve el Kardex de su propia bodega (antes veía todas)', async () => {
    const prisma: any = {
      kardexMovimiento: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: { namerol: 'ASISTENTE_BODEGA' }, bodegaId: 'bod-1' }) },
    };
    const service = new InventarioService(prisma as never);
    await service.listKardex({} as any, 'u1');
    const where = JSON.stringify(prisma.kardexMovimiento.findMany.mock.calls[0][0].where);
    expect(where).toContain('"ubicacionId":{"in":["bod-1"]}');
    expect(where).toContain('"usuarioId":"u1"'); // además de su bodega, ve lo que él mismo registró (reajustes, etc.)
  });

  it('un asistente sin bodega asignada no ve nada del Kardex', async () => {
    const prisma: any = {
      kardexMovimiento: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: { namerol: 'ASISTENTE_BODEGA' }, bodegaId: null }) },
    };
    const service = new InventarioService(prisma as never);
    await service.listKardex({} as any, 'u1');
    expect(prisma.kardexMovimiento.findMany.mock.calls[0][0].where).toMatchObject({ id: '__SIN_ACCESO_KARDEX__' });
  });

  it('expone el nombre de la ubicación además del id (agencia)', async () => {
    const prisma: any = {
      kardexMovimiento: {
        findMany: vi.fn().mockResolvedValue([{ id: 'k1', ubicacionId: 'ag-1' }]),
        count: vi.fn().mockResolvedValue(1),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', role: { namerol: 'ADMIN' } }) },
      agencia: { findUnique: vi.fn().mockResolvedValue({ nombre: 'Agencia Centro', codigo: 'AC' }) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    const service = new InventarioService(prisma as never);
    const r: any = await service.listKardex({} as any, 'u1');
    expect(r.items[0].ubicacionId).toBe('ag-1');
    expect(r.items[0].ubicacionNombre).toContain('Agencia Centro');
  });
});
