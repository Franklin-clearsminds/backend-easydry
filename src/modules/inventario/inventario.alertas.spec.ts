import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListAlertasDto } from './dto/alertas.dto.js';
import { ListStockBajoDto } from './dto/movimiento-operacion.dto.js';

interface Opciones {
  rol?: string;
  usuario?: Record<string, unknown>;
  alertas?: any[];
  total?: number;
  resueltas?: number;
  insumosStockBajo?: any[];
  totalStockBajo?: number;
}

function construir(op: Opciones = {}) {
  const usuario = op.rol
    ? { id: 'u1', role: { namerol: op.rol }, regionId: 'reg1', bodega: null, agenciaId: null, ...op.usuario }
    : null;
  const count = vi.fn(async (args: any) => {
    const txt = JSON.stringify(args?.where ?? {});
    if (txt.includes('"estado":"RESUELTO"') && !txt.includes('"not"')) return op.resueltas ?? 0;
    if (txt.includes('"not":"RESUELTO"') && txt.includes('AGOTADO')) return 2;
    return op.total ?? 0;
  });
  const prisma = {
    alertaStock: { findMany: vi.fn().mockResolvedValue(op.alertas ?? []), count },
    user: {
      findUnique: vi.fn().mockResolvedValue(usuario),
      findMany: vi.fn().mockResolvedValue([{ id: 'pul1' }]),
    },
    agencia: { findMany: vi.fn().mockResolvedValue([{ id: 'ag1', nombre: 'A', servicioIds: [] }]) },
    recetaInsumo: { findMany: vi.fn().mockResolvedValue([]) },
    insumo: { findMany: vi.fn(async (a: any) => (op.insumosStockBajo ?? []).filter((i) => a.where.id.in.includes(i.id))) },
    $queryRawUnsafe: vi.fn(async (texto: string, ..._p: unknown[]) => {
      if (texto.includes('COUNT(*)')) return [{ total: op.totalStockBajo ?? (op.insumosStockBajo?.length ?? 0) }];
      return (op.insumosStockBajo ?? []).map((i) => ({ id: i.id }));
    }),
  };
  const service = new InventarioService(prisma as never);
  const sync = vi.spyOn(service as any, 'sincronizarNecesidadesAsignadas').mockResolvedValue(undefined);
  return { service, prisma, sync };
}

describe('listAlertas — modo heredado (sin página)', () => {
  it('arreglo con tope de 100, el orden de siempre, y sincroniza para roles de varias sedes', async () => {
    const { service, prisma, sync } = construir({ rol: 'ADMIN', alertas: [{ id: 'a1' }] });
    const r = await service.listAlertas({} as any, 'u1');
    expect(Array.isArray(r)).toBe(true);
    expect(prisma.alertaStock.findMany.mock.calls[0][0]).toMatchObject({
      take: 100,
      orderBy: [{ nivel: 'asc' }, { createdAt: 'desc' }],
    });
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('la sincronización se limita a una vez cada 2 minutos', async () => {
    const { service, sync } = construir({ rol: 'ADMIN' });
    await service.listAlertas({} as any, 'u1');
    await service.listAlertas({} as any, 'u1');
    await service.listAlertas({} as any, 'u1');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('un líder solo ve su sede y no dispara la sincronización', async () => {
    const { service, prisma, sync } = construir({ rol: 'LIDER_OPERADOR', usuario: { agenciaId: 'ag9' } });
    await service.listAlertas({ sucursalId: 'otra' } as any, 'u1');
    expect(JSON.stringify(prisma.alertaStock.findMany.mock.calls[0][0].where)).toContain('"agenciaId":"ag9"');
    expect(sync).not.toHaveBeenCalled();
  });
});

describe('listAlertas — modo paginado (no escribe)', () => {
  it('no sincroniza al listar y responde el formato estándar', async () => {
    const { service, prisma, sync } = construir({ rol: 'ADMIN', alertas: [{ id: 'a1' }], total: 80 });
    const r: any = await service.listAlertas({ page: 2, pageSize: 25 } as any, 'u1');
    expect(sync).not.toHaveBeenCalled();
    expect(prisma.alertaStock.findMany.mock.calls[0][0]).toMatchObject({ skip: 25, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(r).toMatchObject({ total: 80, page: 2, pageSize: 25, totalPages: 4, hasNextPage: true });
    expect(r.resumen).toBeUndefined();
  });

  it('ordena solo por columnas permitidas', async () => {
    const { service, prisma } = construir({ rol: 'ADMIN' });
    await service.listAlertas({ page: 1, sortField: 'agencia', sortOrder: 'asc' } as any, 'u1');
    expect(prisma.alertaStock.findMany.mock.calls[0][0].orderBy[0]).toEqual({ agencia: { nombre: 'asc' } });
    await service.listAlertas({ page: 1, sortField: 'usuarioEmisorId; x' } as any, 'u1');
    expect(prisma.alertaStock.findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('filtros: grupo de nivel (crítico incluye agotado), estado y solo activas; el conteo usa los mismos', async () => {
    const { service, prisma } = construir({ rol: 'ADMIN' });
    await service.listAlertas({ page: 1, grupoNivel: 'CRITICO', estado: 'PENDIENTE', soloActivas: true } as any, 'u1');
    const where = prisma.alertaStock.findMany.mock.calls[0][0].where;
    const txt = JSON.stringify(where);
    expect(txt).toContain('"nivel":{"in":["CRITICO","AGOTADO"]}');
    expect(txt).toContain('"estado":"PENDIENTE"');
    expect(txt).toContain('"estado":{"not":"RESUELTO"}');
    expect(prisma.alertaStock.count.mock.calls[0][0].where).toEqual(where);
    await service.listAlertas({ page: 1, grupoNivel: 'BAJO' } as any, 'u1');
    expect(JSON.stringify(prisma.alertaStock.findMany.mock.calls[1][0].where)).toContain('"nivel":{"in":["BAJO"]}');
  });

  it('busca por palabras en insumo, sede, región, kit del pulidor y mensaje', async () => {
    const { service, prisma } = construir({ rol: 'ADMIN' });
    await service.listAlertas({ page: 1, search: 'jabon norte' } as any, 'u1');
    const txt = JSON.stringify(prisma.alertaStock.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"insumo":{"nombre":{"contains":"jabon"');
    expect(txt).toContain('"agencia":{"region":{"contains":"norte"');
    expect(txt).toContain('"pulidor":{"name"');
    expect(txt).toContain('"mensaje"');
  });

  it('el alcance de un asistente sigue aplicándose junto con los filtros', async () => {
    const { service, prisma } = construir({ rol: 'ASISTENTE_BODEGA' });
    await service.listAlertas({ page: 1, grupoNivel: 'BAJO', search: 'ab' } as any, 'u1');
    const txt = JSON.stringify(prisma.alertaStock.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agenciaId":{"in":["ag1"]}');
    expect(txt).toContain('"pulidorId":{"in":["pul1"]}');
    expect(txt).toContain('"nivel":{"in":["BAJO"]}');
  });

  it('el resumen cuenta activas y críticas con el alcance y la búsqueda, sin filtros de nivel ni de estado', async () => {
    const { service, prisma } = construir({ rol: 'ADMIN', total: 10, resueltas: 4 });
    const r: any = await service.listAlertas({ page: 1, incluirResumen: true, estado: 'RESUELTO', grupoNivel: 'BAJO' } as any, 'u1');
    expect(r.resumen).toEqual({ total: 10, resueltas: 4, activas: 6, criticas: 2 });
    const donde = prisma.alertaStock.count.mock.calls.slice(1).map((c) => JSON.stringify(c[0].where));
    expect(donde.join(' ')).not.toContain('"nivel":{"in":["BAJO"]}');
  });
});

describe('sincronizarAlertas', () => {
  it('solo lo ejecutan los roles con vista de varias sedes; el líder no', async () => {
    const lider = construir({ rol: 'LIDER_OPERADOR', usuario: { agenciaId: 'ag1' } });
    expect(await lider.service.sincronizarAlertas('u1')).toEqual({ sincronizado: false });
    expect(lider.sync).not.toHaveBeenCalled();
    const admin = construir({ rol: 'COORD_BODEGA' });
    expect(await admin.service.sincronizarAlertas('u1')).toEqual({ sincronizado: true });
    expect(admin.sync).toHaveBeenCalledWith('u1');
  });

  it('respeta el límite de 2 minutos salvo con forzar', async () => {
    const { service, sync } = construir({ rol: 'ADMIN' });
    expect((await service.sincronizarAlertas('u1')).sincronizado).toBe(true);
    expect((await service.sincronizarAlertas('u1')).sincronizado).toBe(false);
    expect((await service.sincronizarAlertas('u1', true)).sincronizado).toBe(true);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});

describe('listStockBajo (SQL)', () => {
  const insumos = [
    { id: 'i1', nombre: 'Jabón', stockActual: 1, stockMinimoBodega: 10 },
    { id: 'i2', nombre: 'Cera', stockActual: 3, stockMinimoBodega: 10 },
  ];

  it('filtra y cuenta en la base de datos y devuelve la página en el orden del SQL', async () => {
    const { service, prisma } = construir({ insumosStockBajo: insumos, totalStockBajo: 57 });
    const r: any = await service.listStockBajo({ page: 2, pageSize: 25 } as any);
    const [sqlPagina, ...params] = prisma.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sqlPagina).toContain('i."stockActual" <= i."stockMinimoBodega"');
    expect(sqlPagina).toContain('i."estado" = 1');
    expect(sqlPagina).toContain('ORDER BY i."stockActual" ASC NULLS LAST, i."id" ASC');
    expect(params.slice(-2)).toEqual([25, 25]);
    expect(r).toMatchObject({ total: 57, page: 2, pageSize: 25, totalPages: 3 });
    expect(r.items.map((i: any) => i.id)).toEqual(['i1', 'i2']);
    const sqlConteo = prisma.$queryRawUnsafe.mock.calls[1][0] as string;
    expect(sqlConteo).toContain('COUNT(*)');
    // el conteo usa exactamente los mismos filtros que la página
    expect(sqlConteo.split('WHERE')[1].trim()).toBe(sqlPagina.split('WHERE')[1].split('ORDER BY')[0].trim());
  });

  it('sin página devuelve la primera de 100 (antes 20) y el mismo formato', async () => {
    const { service, prisma } = construir({ insumosStockBajo: insumos });
    const r: any = await service.listStockBajo({} as any);
    expect((prisma.$queryRawUnsafe.mock.calls[0] as unknown[]).slice(-2)).toEqual([100, 0]);
    expect(r).toMatchObject({ page: 1, pageSize: 100, total: 2 });
    expect(Array.isArray(r.items)).toBe(true);
  });

  it('ordena solo por columnas permitidas y enlaza tipo y búsqueda como parámetros', async () => {
    const { service, prisma } = construir();
    await service.listStockBajo({ page: 1, sortField: 'deficit', sortOrder: 'desc', tipoProductoId: 't1', search: 'jabon cera' } as any);
    const [sql, ...params] = prisma.$queryRawUnsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toContain('ORDER BY (i."stockMinimoBodega" - i."stockActual") DESC NULLS LAST');
    expect(params).toEqual(expect.arrayContaining(['t1', '%jabon%', '%cera%']));
    expect(sql).not.toContain('jabon');
    await service.listStockBajo({ page: 1, sortField: 'nombre; DROP TABLE "Insumo"' } as any);
    const [sql2] = prisma.$queryRawUnsafe.mock.calls[2] as [string];
    expect(sql2).toContain('ORDER BY i."stockActual" ASC');
    expect(sql2).not.toContain('DROP');
  });

  it('una página sin resultados no consulta los insumos', async () => {
    const { service, prisma } = construir({ insumosStockBajo: [] });
    const r: any = await service.listStockBajo({ page: 1 } as any);
    expect(r).toMatchObject({ total: 0, items: [] });
    expect(prisma.insumo.findMany).not.toHaveBeenCalled();
  });
});

describe('DTO de alertas y stock bajo', () => {
  it('no fijan page/pageSize y validan los nuevos campos', async () => {
    for (const Clase of [ListAlertasDto, ListStockBajoDto]) {
      const vacio: any = plainToInstance(Clase as any, {});
      expect(vacio.page).toBeUndefined();
      expect(vacio.pageSize).toBeUndefined();
      expect(await validate(vacio)).toHaveLength(0);
    }
    expect(await validate(plainToInstance(ListAlertasDto, { page: 1, grupoNivel: 'CRITICO', soloActivas: true, agenciaId: 'a', incluirResumen: true }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListAlertasDto, { grupoNivel: 'otro' }))).length).toBeGreaterThan(0);
  });
});
