import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListTiposProductoDto } from './dto/tipo-producto.dto.js';
import { ListUnidadesDto } from './dto/unidades.dto.js';
import { ListPresentacionesDto } from './dto/presentaciones.dto.js';

function catalogo(total = 0) {
  return { findMany: vi.fn().mockResolvedValue([{ id: 'x' }]), count: vi.fn().mockResolvedValue(total) };
}

function construir(total = 0) {
  const prisma = {
    tipoProducto: catalogo(total),
    unidadMedida: catalogo(total),
    presentacionInsumo: catalogo(total),
  };
  return { service: new InventarioService(prisma as never), prisma };
}

const casos = [
  { nombre: 'tipos de producto', dto: ListTiposProductoDto, tabla: 'tipoProducto', llamar: (s: InventarioService, d: any) => s.listTiposProducto(d), heredado: [{ nombre: 'asc' }], columna: 'nombre', esperada: { nombre: 'asc' } },
  { nombre: 'unidades de medida', dto: ListUnidadesDto, tabla: 'unidadMedida', llamar: (s: InventarioService, d: any) => s.listUnidades(d), heredado: [{ codigo: 'asc' }], columna: 'simbolo', esperada: { simbolo: 'asc' } },
  { nombre: 'presentaciones', dto: ListPresentacionesDto, tabla: 'presentacionInsumo', llamar: (s: InventarioService, d: any) => s.listPresentaciones(d), heredado: [{ nombre: 'asc' }], columna: 'insumo', esperada: { insumo: { nombre: 'asc' } } },
] as const;

describe.each(casos)('catálogo de $nombre', (caso) => {
  it('modo heredado (sin página): arreglo, mismo orden de siempre, tope de 100', async () => {
    const { service, prisma } = construir();
    const r = await caso.llamar(service, {});
    expect(Array.isArray(r)).toBe(true);
    const args = (prisma as any)[caso.tabla].findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 0, take: 100 });
    expect(args.orderBy).toEqual(caso.heredado);
    expect((prisma as any)[caso.tabla].count).not.toHaveBeenCalled();
  });

  it('modo paginado: formato estándar, recorta a 100 y ordena por lo más reciente', async () => {
    const { service, prisma } = construir(230);
    const r: any = await caso.llamar(service, { page: 3, pageSize: 25 });
    const m = (prisma as any)[caso.tabla];
    expect(m.findMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 25, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(r).toMatchObject({ total: 230, page: 3, pageSize: 25, totalPages: 10, hasNextPage: true });
    expect(r.items).toEqual([{ id: 'x' }]);
    await caso.llamar(service, { pageSize: 200 });
    expect(m.findMany.mock.calls[1][0].take).toBe(100);
  });

  it('ordena solo por columnas permitidas', async () => {
    const { service, prisma } = construir();
    const m = (prisma as any)[caso.tabla];
    await caso.llamar(service, { page: 1, sortField: caso.columna, sortOrder: 'asc' });
    expect(m.findMany.mock.calls[0][0].orderBy).toEqual([caso.esperada, { id: 'asc' }]);
    await caso.llamar(service, { page: 1, sortField: 'passwordHash; DROP', sortOrder: 'asc' });
    expect(m.findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('el conteo usa los mismos filtros que la página', async () => {
    const { service, prisma } = construir();
    const m = (prisma as any)[caso.tabla];
    await caso.llamar(service, { page: 1, estado: 1, search: 'gel litro' });
    expect(m.count.mock.calls[0][0].where).toEqual(m.findMany.mock.calls[0][0].where);
    const texto = JSON.stringify(m.findMany.mock.calls[0][0].where);
    expect(texto).toContain('"estado":1');
    expect(texto).toContain('"contains":"gel"');
    expect(texto).toContain('"contains":"litro"');
  });

  it('una búsqueda de una letra se ignora', async () => {
    const { service, prisma } = construir();
    await caso.llamar(service, { page: 1, search: 'a' });
    expect(JSON.stringify((prisma as any)[caso.tabla].findMany.mock.calls[0][0].where)).not.toContain('contains');
  });

  it('el DTO no fija page/pageSize y valida', async () => {
    const vacio: any = plainToInstance(caso.dto as any, {});
    expect(vacio.page).toBeUndefined();
    expect(vacio.pageSize).toBeUndefined();
    expect(await validate(vacio)).toHaveLength(0);
    const con: any = plainToInstance(caso.dto as any, { page: '2', pageSize: 200, sortField: 'nombre', sortOrder: 'asc', search: 'ab' });
    expect(await validate(con)).toHaveLength(0);
    expect(con.page).toBe(2);
  });
});

describe('filtros propios de cada catálogo', () => {
  it('tipos: la cantidad de insumos es ordenable', async () => {
    const { service, prisma } = construir();
    await service.listTiposProducto({ page: 1, sortField: 'insumos', sortOrder: 'desc' } as any);
    expect(prisma.tipoProducto.findMany.mock.calls[0][0].orderBy[0]).toEqual({ insumos: { _count: 'desc' } });
  });

  it('unidades: filtra por familia y estado', async () => {
    const { service, prisma } = construir();
    await service.listUnidades({ tipo: 'VOLUMEN', estado: 1 } as any);
    const txt = JSON.stringify(prisma.unidadMedida.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"tipo":"VOLUMEN"');
    expect(txt).toContain('"estado":1');
  });

  it('presentaciones: filtra por insumo (lo que usa el modal del producto)', async () => {
    const { service, prisma } = construir();
    await service.listPresentaciones({ insumoId: 'i1' } as any);
    expect(prisma.presentacionInsumo.findMany.mock.calls[0][0].where).toEqual({ insumoId: 'i1' });
  });
});
