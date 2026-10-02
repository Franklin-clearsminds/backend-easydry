import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { CreateInsumoDto, ListInsumosDto, UpdateInsumoDto } from './dto/insumos.dto.js';
import { cumpleNivel, nivelStock } from './stock-nivel.js';

interface Opciones {
  insumos?: any[];
  total?: number;
  /** insumoId → stock en la bodega (consulta SUM) */
  stockBodega?: Record<string, number>;
  /** stock por agencia (modo sede) */
  stockAgencia?: Array<{ insumoId: string; cantidadActual: number; cantidadMinima: number }>;
  agencia?: any;
  bodegaUsuario?: string | null;
}

const insumo = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  codigoSKU: `SKU-${id}`,
  nombre: `Insumo ${id}`,
  stockMinimoBodega: 10,
  stockOptimoBodega: 30,
  stockMinimoAgencia: 2,
  createdAt: new Date(`2026-09-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}T10:00:00Z`),
  ...extra,
});

function construir(op: Opciones = {}) {
  const findMany = vi.fn(async (args: any) => {
    if (args.select) return op.insumos ?? []; // consulta liviana de candidatos
    if (args.where?.id?.in) return (op.insumos ?? []).filter((i) => args.where.id.in.includes(i.id));
    return op.insumos ?? [];
  });
  const prisma = {
    insumo: { findMany, count: vi.fn().mockResolvedValue(op.total ?? (op.insumos?.length ?? 0)) },
    agencia: { findFirst: vi.fn().mockResolvedValue(op.agencia ?? null) },
    user: { findUnique: vi.fn().mockResolvedValue({ bodegaId: op.bodegaUsuario ?? null }) },
    stockUbicacion: { findMany: vi.fn().mockResolvedValue(op.stockAgencia ?? []) },
    $queryRawUnsafe: vi.fn(async (texto: string, ..._params: unknown[]) => {
      if (texto.includes('"tipo" = \'CENTRAL\'')) return [{ id: 'bod-central' }];
      return Object.entries(op.stockBodega ?? {}).map(([insumoId, cantidadActual]) => ({ insumoId, cantidadActual }));
    }),
  };
  return { service: new InventarioService(prisma as never), prisma, findMany };
}

describe('nivelStock', () => {
  it('agotado, bajo mínimo, moderado y óptimo (misma regla que la pantalla)', () => {
    expect(nivelStock(0, 10, 30)).toBe('agotado');
    expect(nivelStock(-2, 10, 30)).toBe('agotado');
    expect(nivelStock(10, 10, 30)).toBe('bajo_minimo');
    expect(nivelStock(11, 10, 30)).toBe('moderado');
    expect(nivelStock(29.9, 10, 30)).toBe('moderado');
    expect(nivelStock(30, 10, 30)).toBe('optimo');
  });

  it('sin óptimo definido toma el doble del mínimo (o 10)', () => {
    expect(nivelStock(15, 10, null)).toBe('moderado'); // óptimo = 20
    expect(nivelStock(20, 10, null)).toBe('optimo');
    expect(nivelStock(5, 0, 0)).toBe('moderado'); // sin mínimo: óptimo = 10
    expect(nivelStock('5', '3', undefined)).toBe('moderado'); // óptimo = 6, y los textos numéricos cuentan
    expect(nivelStock('7', '3', undefined)).toBe('optimo');
  });

  it('alerta_total incluye agotado y bajo mínimo (antes solo agotado por un error de la pantalla)', () => {
    expect(cumpleNivel('agotado', 'alerta_total')).toBe(true);
    expect(cumpleNivel('bajo_minimo', 'alerta_total')).toBe(true);
    expect(cumpleNivel('moderado', 'alerta_total')).toBe(false);
    expect(cumpleNivel('optimo', 'optimo')).toBe(true);
  });
});

describe('listInsumos — modo heredado (sin página)', () => {
  it('arreglo con tope de 100, orden por SKU y los datos completos de siempre', async () => {
    const { service, findMany } = construir({ insumos: [insumo('1')], stockBodega: { '1': 25 } });
    const r: any = await service.listInsumos({} as any, { id: 'u1', role: 'ADMIN' });
    expect(Array.isArray(r)).toBe(true);
    const args = findMany.mock.calls[0][0];
    expect(args).toMatchObject({ take: 100, orderBy: { codigoSKU: 'asc' } });
    expect(args.include).toHaveProperty('stocks');
    expect(args.include).toHaveProperty('recetas');
    expect(args.include).toHaveProperty('presentaciones');
    expect(r[0]).toMatchObject({ id: '1', stockActual: 25, bodegaIdStock: 'bod-central' });
  });

  it('conserva la búsqueda y los filtros de antes', async () => {
    const { service, findMany } = construir();
    await service.listInsumos({ search: 'a', categoria: 'QUIMICOS', tipoProductoId: 't1', estado: 1 } as any, {});
    const txt = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(txt).toContain('"categoria":"QUIMICOS"');
    expect(txt).toContain('"tipoProductoId":"t1"');
    expect(txt).toContain('"estado":1');
    expect(txt).toContain('"contains":"a"'); // el modo heredado no exige 2 letras
  });

  it('un rol de sede ve solo los insumos de su agencia, con el stock y el mínimo de allí', async () => {
    const { service, findMany } = construir({
      insumos: [insumo('1', { stocks: [{ cantidadActual: 4, cantidadMinima: 3 }] })],
      agencia: { id: 'ag1', servicioIds: [5], tieneServiciosEspeciales: false },
    });
    const r: any = await service.listInsumos({} as any, { role: 'LIDER_OPERADOR', agenciaId: 'ag1' });
    const txt = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agenciaId":"ag1"');
    expect(txt).toContain('"catalogoServicioId":{"in":[5]}');
    expect(r[0]).toMatchObject({ stockActual: 4, stockMinimoAgencia: 3 });
  });

  it('un rol de sede siempre ve SU agencia, aunque el cliente mande otro agenciaId (nunca amplía su alcance)', async () => {
    const { service, findMany, prisma } = construir({
      insumos: [insumo('1', { stocks: [{ cantidadActual: 4, cantidadMinima: 3 }] })],
      agencia: { id: 'ag-mia', servicioIds: [], tieneServiciosEspeciales: false },
    });
    await service.listInsumos({ agenciaId: 'ag-ajena' } as any, { role: 'LIDER', agenciaId: 'ag-mia' });
    expect(prisma.agencia.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ id: 'ag-mia' }, { nombre: { equals: 'ag-mia', mode: 'insensitive' } }],
    });
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('"agenciaId":"ag-mia"');
  });

  it('una agencia inexistente no devuelve nada', async () => {
    const { service, findMany } = construir({ agencia: null });
    await service.listInsumos({ agenciaId: 'no-existe' } as any, {});
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: [] } });
  });
});

describe('listInsumos — modo paginado', () => {
  it('página liviana: sin stocks por ubicación, recetas ni presentaciones; formato estándar', async () => {
    const { service, findMany, prisma } = construir({ insumos: [insumo('1'), insumo('2')], total: 230, stockBodega: { '1': 5 } });
    const r: any = await service.listInsumos({ page: 3, pageSize: 25 } as any, { role: 'ADMIN' });
    const args = findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 50, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(Object.keys(args.include).sort()).toEqual(['tipoProducto', 'unidadMedida']);
    expect(prisma.insumo.count).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ total: 230, page: 3, pageSize: 25, totalPages: 10, hasNextPage: true });
    expect(r.items[0]).toMatchObject({ id: '1', stockActual: 5, bodegaIdStock: 'bod-central' });
    expect(r.items[1]).toMatchObject({ id: '2', stockActual: 0 });
  });

  it('recorta a 100 y solo ordena por columnas permitidas', async () => {
    const { service, findMany } = construir();
    await service.listInsumos({ pageSize: 200 } as any, {});
    expect(findMany.mock.calls[0][0].take).toBe(100);
    await service.listInsumos({ page: 1, sortField: 'tipo', sortOrder: 'asc' } as any, {});
    expect(findMany.mock.calls[1][0].orderBy[0]).toEqual({ tipoProducto: { nombre: 'asc' } });
    await service.listInsumos({ page: 1, sortField: 'imagenUrl; DROP', sortOrder: 'asc' } as any, {});
    expect(findMany.mock.calls[2][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('busca por palabras en nombre, SKU y descripción; una letra se ignora; filtros en el servidor', async () => {
    const { service, findMany, prisma } = construir();
    await service.listInsumos({ page: 1, search: 'jabon lit', estado: 1, tipoProductoId: 't1' } as any, {});
    const where = findMany.mock.calls[0][0].where;
    const txt = JSON.stringify(where);
    expect(txt).toContain('"nombre":{"contains":"jabon"');
    expect(txt).toContain('"codigoSKU":{"contains":"lit"');
    expect(txt).toContain('"descripcion"');
    expect(txt).toContain('"estado":1');
    expect(txt).toContain('"tipoProductoId":"t1"');
    expect(prisma.insumo.count.mock.calls[0][0].where).toEqual(where);

    await service.listInsumos({ page: 1, search: 'a' } as any, {});
    expect(JSON.stringify(findMany.mock.calls[1][0].where)).not.toContain('contains');
  });

  it('el asistente de bodega siempre ve el stock de SU bodega, aunque pida otra', async () => {
    const { service, prisma } = construir({ bodegaUsuario: 'bod-mia', stockBodega: { '1': 3 }, insumos: [insumo('1')] });
    await service.listInsumos({ page: 1, bodegaId: 'bod-ajena' } as any, { id: 'u1', role: 'ASISTENTE_BODEGA' });
    const llamadas = prisma.$queryRawUnsafe.mock.calls.filter((c) => String(c[0]).includes('SUM'));
    expect(llamadas[0][1]).toBe('bod-mia');
  });

  it('modo sede: el stock y el mínimo salen de la agencia', async () => {
    const { service, prisma } = construir({
      insumos: [insumo('1')],
      agencia: { id: 'ag1', servicioIds: [], tieneServiciosEspeciales: false },
      stockAgencia: [{ insumoId: '1', cantidadActual: 6, cantidadMinima: 4 }],
    });
    const r: any = await service.listInsumos({ page: 1 } as any, { role: 'LIDER', agenciaId: 'ag1' });
    expect(prisma.stockUbicacion.findMany.mock.calls[0][0].where).toEqual({ agenciaId: 'ag1', tipoUbicacion: 'AGENCIA' });
    expect(r.items[0]).toMatchObject({ stockActual: 6, stockMinimoAgencia: 4 });
  });
});

describe('listInsumos — nivel de stock y orden por stock (paginado)', () => {
  const catalogo = [
    insumo('1', { stockMinimoBodega: 10, stockOptimoBodega: 30 }), // 0  → agotado
    insumo('2', { stockMinimoBodega: 10, stockOptimoBodega: 30 }), // 8  → bajo mínimo
    insumo('3', { stockMinimoBodega: 10, stockOptimoBodega: 30 }), // 20 → moderado
    insumo('4', { stockMinimoBodega: 10, stockOptimoBodega: 30 }), // 50 → óptimo
  ];
  const stockBodega = { '2': 8, '3': 20, '4': 50 };

  it('filtra por nivel con el stock de la bodega y cuenta solo lo que coincide', async () => {
    const { service, findMany, prisma } = construir({ insumos: catalogo, stockBodega });
    const r: any = await service.listInsumos({ page: 1, nivelStock: 'moderado' } as any, {});
    expect(r.total).toBe(1);
    expect(r.items.map((i: any) => i.id)).toEqual(['3']);
    // primero la consulta liviana; después solo los datos de la página
    expect(findMany.mock.calls[0][0].select).toBeDefined();
    expect(findMany.mock.calls[1][0].where).toEqual({ id: { in: ['3'] } });
    expect(prisma.insumo.count).not.toHaveBeenCalled();
  });

  it('alerta_total = agotado + bajo mínimo', async () => {
    const { service } = construir({ insumos: catalogo, stockBodega });
    const r: any = await service.listInsumos({ page: 1, nivelStock: 'alerta_total', sortField: 'stock', sortOrder: 'asc' } as any, {});
    expect(r.total).toBe(2);
    expect(r.items.map((i: any) => i.id)).toEqual(['1', '2']);
  });

  it('ordena por stock y por gravedad de alerta, y pagina sobre ese orden', async () => {
    const { service } = construir({ insumos: catalogo, stockBodega });
    const asc: any = await service.listInsumos({ page: 1, pageSize: 2, sortField: 'stock', sortOrder: 'asc' } as any, {});
    expect(asc.items.map((i: any) => i.id)).toEqual(['1', '2']);
    expect(asc).toMatchObject({ total: 4, totalPages: 2, hasNextPage: true });
    const pag2: any = await service.listInsumos({ page: 2, pageSize: 2, sortField: 'stock', sortOrder: 'asc' } as any, {});
    expect(pag2.items.map((i: any) => i.id)).toEqual(['3', '4']);
    const alerta: any = await service.listInsumos({ page: 1, sortField: 'alerta', sortOrder: 'asc' } as any, {});
    expect(alerta.items.map((i: any) => i.id)).toEqual(['1', '2', '3', '4']);
    const desc: any = await service.listInsumos({ page: 1, sortField: 'stock', sortOrder: 'desc' } as any, {});
    expect(desc.items.map((i: any) => i.id)).toEqual(['4', '3', '2', '1']);
  });

  it('si ningún insumo cumple devuelve una página vacía sin pedir los datos completos', async () => {
    const { service, findMany } = construir({ insumos: catalogo.slice(1), stockBodega }); // sin el agotado
    const r: any = await service.listInsumos({ page: 1, nivelStock: 'agotado' } as any, {});
    expect(r).toMatchObject({ total: 0, items: [], totalPages: 1, hasNextPage: false });
    expect(findMany).toHaveBeenCalledTimes(1); // solo la consulta liviana
  });
});

describe('ListInsumosDto', () => {
  it('no fija page/pageSize, acepta niveles válidos y rechaza otros', async () => {
    const vacio: any = plainToInstance(ListInsumosDto, {});
    expect(vacio.page).toBeUndefined();
    expect(await validate(vacio)).toHaveLength(0);
    expect(await validate(plainToInstance(ListInsumosDto, { page: '2', pageSize: 50, nivelStock: 'alerta_total', sortField: 'stock', sortOrder: 'asc' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListInsumosDto, { nivelStock: 'inventado' }))).length).toBeGreaterThan(0);
  });
});

describe('categoria de insumo — @IsIn', () => {
  const base = { codigoSKU: 'SKU-1', nombre: 'Insumo', unidadMedidaId: 'u1', stockMinimoBodega: 1, stockMinimoAgencia: 1, stockOptimoBodega: 2 };

  it('CreateInsumoDto acepta una categoría válida del catálogo y rechaza cualquier otra', async () => {
    const valido = plainToInstance(CreateInsumoDto, { ...base, categoria: 'QUIMICOS_LAVADO' });
    expect(await validate(valido)).toHaveLength(0);

    const invalido = plainToInstance(CreateInsumoDto, { ...base, categoria: 'GENERAL' });
    const errores = await validate(invalido);
    expect(errores.some((e) => e.property === 'categoria')).toBe(true);
  });

  it('UpdateInsumoDto rechaza una categoría fuera del catálogo', async () => {
    const invalido = plainToInstance(UpdateInsumoDto, { id: 'i1', categoria: 'OTRA' });
    const errores = await validate(invalido);
    expect(errores.some((e) => e.property === 'categoria')).toBe(true);
  });
});
