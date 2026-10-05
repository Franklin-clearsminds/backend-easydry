import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OpcionesDto, listarOpciones } from './opciones.js';
import { AgenciasService } from '../../modules/agencias/agencias.service.js';
import { CatalogosService } from '../../modules/catalogos/catalogos.service.js';
import { InventarioService } from '../../modules/inventario/inventario.service.js';
import { AgenciasOpcionesDto, UsuariosOpcionesDto } from '../../modules/agencias/dto/opciones.dto.js';

const tabla = (filas: unknown[], total = filas.length) => ({
  findMany: vi.fn().mockResolvedValue(filas),
  count: vi.fn().mockResolvedValue(total),
});

describe('listarOpciones', () => {
  const armar = (total = 100) => {
    const t = tabla([{ id: 'a', n: 'Alfa' }, { id: 'b', n: 'Beta' }], total);
    const cfg = {
      where: { estado: 1 },
      camposBusqueda: ['n'],
      orderBy: [{ n: 'asc' }, { id: 'asc' }],
      buscar: ({ where, orderBy, skip, take }: any) => t.findMany({ where, orderBy, skip, take }),
      contar: (where: any) => t.count({ where }),
      mapear: (f: any) => ({ value: f.id, label: f.n }),
    };
    return { t, cfg };
  };

  it('30 por defecto y formato estándar con { value, label }', async () => {
    const { t, cfg } = armar();
    const r: any = await listarOpciones({} as OpcionesDto, cfg);
    expect(t.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 30, orderBy: [{ n: 'asc' }, { id: 'asc' }] });
    expect(r).toMatchObject({ total: 100, page: 1, pageSize: 30, totalPages: 4, hasNextPage: true });
    expect(r.items).toEqual([{ value: 'a', label: 'Alfa' }, { value: 'b', label: 'Beta' }]);
  });

  it('pagina, recorta a 100 y busca por palabras con mínimo de 2 letras', async () => {
    const { t, cfg } = armar();
    await listarOpciones({ page: 3, pageSize: 20, search: 'al fa' } as OpcionesDto, cfg);
    const args = t.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 40, take: 20 });
    expect(JSON.stringify(args.where)).toContain('"n":{"contains":"al"');
    expect(JSON.stringify(args.where)).toContain('"estado":1');
    expect(t.count.mock.calls[0][0].where).toEqual(args.where);
    await listarOpciones({ pageSize: 900 } as OpcionesDto, cfg);
    expect(t.findMany.mock.calls[1][0].take).toBe(100);
    await listarOpciones({ search: 'a' } as OpcionesDto, cfg);
    expect(JSON.stringify(t.findMany.mock.calls[2][0].where)).not.toContain('contains');
  });

  it('con ids devuelve solo esas opciones (máx. 50), sin paginar y sin buscar', async () => {
    const { t, cfg } = armar();
    const muchos = Array.from({ length: 80 }, (_, i) => `id${i}`);
    const r: any = await listarOpciones({ ids: muchos, search: 'zzz', page: 5 } as OpcionesDto, cfg);
    const args = t.findMany.mock.calls[0][0];
    expect(args.take).toBe(50);
    expect(JSON.stringify(args.where)).toContain('"id":{"in":["id0"');
    expect(JSON.stringify(args.where)).not.toContain('zzz');
    expect(t.count).not.toHaveBeenCalled();
    expect(r).toMatchObject({ total: 2, page: 1 });
  });

  it('el DTO valida ids y no fija page/pageSize', async () => {
    const dto: any = plainToInstance(OpcionesDto, { ids: ['a', 'b'], page: '2' });
    expect(await validate(dto)).toHaveLength(0);
    expect(plainToInstance(OpcionesDto, {}).page).toBeUndefined();
    expect((await validate(plainToInstance(OpcionesDto, { ids: [1, 2] as any }))).length).toBeGreaterThan(0);
  });
});

describe('opciones de agencias, regiones, clientes, bahías, operadores y usuarios', () => {
  it('agencias: respeta el alcance por rol y arma etiqueta y subetiqueta', async () => {
    const prisma = { agencia: tabla([{ id: 'a1', nombre: 'Uno', codigo: 'A-01', region: 'Norte' }], 1) };
    const s = new AgenciasService(prisma as never);
    const r: any = await s.listAgenciasOpciones({ regionId: 'r1', estado: 1, search: 'un' } as any, { role: { namerol: 'LIDER_OPERADOR' }, agenciaId: 'a9' });
    const txt = JSON.stringify(prisma.agencia.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"id":"a9"');
    expect(txt).toContain('"regionId":"r1"');
    expect(txt).toContain('"estado":1');
    expect(r.items).toEqual([{ value: 'a1', label: 'Uno', sublabel: 'A-01 · Norte' }]);
    expect(prisma.agencia.findMany.mock.calls[0][0].select).toEqual({ id: true, nombre: true, codigo: true, region: true });
  });

  it('agencias: un rol global las ve todas', async () => {
    const prisma = { agencia: tabla([], 0) };
    await new AgenciasService(prisma as never).listAgenciasOpciones({} as any, { role: { namerol: 'ADMIN' } });
    expect(prisma.agencia.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('regiones y clientes: filtro de estado y orden alfabético', async () => {
    const prisma = { region: tabla([{ id: 'r1', nombre: 'Norte', codigo: 'NOR' }], 1), cliente: tabla([{ id: 'c1', nombre: 'EasyDry' }], 1) };
    const s = new AgenciasService(prisma as never);
    const reg: any = await s.listRegionesOpciones({ estado: 1 } as any);
    expect(reg.items).toEqual([{ value: 'r1', label: 'Norte', sublabel: 'NOR' }]);
    expect(prisma.region.findMany.mock.calls[0][0].where).toEqual({ estado: 1 });
    const cli: any = await s.listClientesOpciones({} as any);
    expect(cli.items).toEqual([{ value: 'c1', label: 'EasyDry' }]);
  });

  it('bahías: por agencia, con código y agencia en la subetiqueta', async () => {
    const prisma = { bahia: tabla([{ id: 'b1', codigo: 'B-1', nombre: 'Bahía 1', agencia: { nombre: 'Uno' } }], 1) };
    const r: any = await new AgenciasService(prisma as never).listBahiasOpciones({ agenciaId: 'a1', activa: true } as any);
    expect(JSON.stringify(prisma.bahia.findMany.mock.calls[0][0].where)).toContain('"agenciaId":"a1"');
    expect(r.items[0]).toEqual({ value: 'b1', label: 'Bahía 1', sublabel: 'B-1 · Uno' });
  });

  it('operadores: quita la cédula "(CI: …)" de la etiqueta y un líder queda en su agencia', async () => {
    const prisma = { user: tabla([{ id: 'o1', name: 'Pedro', lastname: 'Ruiz (CI: 1723456789)', agencia: { nombre: 'Uno' } }], 1) };
    const r: any = await new AgenciasService(prisma as never).listOperadoresOpciones({ agenciaId: 'otra' } as any, { role: 'LIDER_OPERADOR', agenciaId: 'a1' });
    expect(r.items[0]).toEqual({ value: 'o1', label: 'Pedro Ruiz', sublabel: 'Uno' });
    const txt = JSON.stringify(prisma.user.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agenciaId":"a1"');
    expect(txt).not.toContain('otra');
  });

  it('usuarios: nunca ofrece SUPER_ADMIN y solo pide los campos necesarios', async () => {
    const prisma = { user: tabla([{ id: 'u1', name: 'Ana', lastname: 'Paz', email: 'a@x.com', role: { namerol: 'ADMIN' } }], 1) };
    const r: any = await new AgenciasService(prisma as never).listUsuariosOpciones({ rolNombre: 'ADMIN, LIDER', agenciaId: 'a1' } as any, { id: 'admin', role: { namerol: 'ADMIN' } });
    const args = prisma.user.findMany.mock.calls[0][0];
    const txt = JSON.stringify(args.where);
    expect(txt).toContain('"namerol":{"not":"SUPER_ADMIN"}');
    expect(txt).toContain('"namerol":{"in":["ADMIN","LIDER"]}');
    expect(txt).toContain('"agenciaId":"a1"');
    expect(Object.keys(args.select).sort()).toEqual(['email', 'id', 'lastname', 'name', 'role']);
    expect(r.items[0]).toEqual({ value: 'u1', label: 'Ana Paz', sublabel: 'ADMIN · a@x.com' });
  });

  it('los DTO no fijan page y validan', async () => {
    expect(plainToInstance(AgenciasOpcionesDto, {}).page).toBeUndefined();
    expect(await validate(plainToInstance(AgenciasOpcionesDto, { estado: '1', regionId: 'r', ids: ['a'] }))).toHaveLength(0);
    expect((await validate(plainToInstance(AgenciasOpcionesDto, { estado: 7 }))).length).toBeGreaterThan(0);
    expect(plainToInstance(UsuariosOpcionesDto, { rolNombre: 'A,B' })).toMatchObject({ rolNombre: 'A,B' });
  });
});

describe('opciones de servicios del catálogo e insumos', () => {
  it('servicios: un rol de sede solo ve los de su agencia (id en la lista y categoría GENERAL)', async () => {
    const prisma = {
      catalogoServicio: tabla([{ id: 7, codigo: 'S-7', nombre: 'Encerado', categoria: 'GENERAL' }], 1),
      agencia: { findUnique: vi.fn().mockResolvedValue({ tieneServiciosEspeciales: false, servicioIds: [7, 8] }) },
    };
    const r: any = await new CatalogosService(prisma as never).listServiciosOpciones({ search: 'enc' } as any, { agenciaId: 'a1', namerol: 'LIDER_OPERADOR' });
    const txt = JSON.stringify(prisma.catalogoServicio.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"id":{"in":[7,8]}');
    expect(txt).toContain('"categoria":"GENERAL"');
    expect(txt).toContain('"nombre":{"contains":"enc"');
    expect(r.items).toEqual([{ value: '7', label: 'Encerado', sublabel: 'S-7 · GENERAL' }]);
  });

  it('servicios: un administrador ve el catálogo y puede filtrar por categoría', async () => {
    const prisma = { catalogoServicio: tabla([], 0), agencia: { findUnique: vi.fn() } };
    await new CatalogosService(prisma as never).listServiciosOpciones({ categoria: 'especial' } as any, { namerol: 'ADMIN' });
    expect(prisma.catalogoServicio.findMany.mock.calls[0][0].where).toEqual({ categoria: 'ESPECIAL' });
  });

  it('insumos: solo activos por defecto, con el alcance de la sede y etiqueta con SKU y tipo', async () => {
    const prisma = {
      insumo: tabla([{ id: 'i1', codigoSKU: 'SKU-1', nombre: 'Jabón', tipoProducto: { nombre: 'Líquido' } }], 1),
      agencia: { findFirst: vi.fn().mockResolvedValue({ id: 'ag1', servicioIds: [3], tieneServiciosEspeciales: false }) },
      user: { findUnique: vi.fn() },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    };
    const r: any = await new InventarioService(prisma as never).listInsumosOpciones({ tipoProductoId: 't1' } as any, { role: 'LIDER_OPERADOR', agenciaId: 'ag1' });
    const txt = JSON.stringify(prisma.insumo.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"estado":1');
    expect(txt).toContain('"tipoProductoId":"t1"');
    expect(txt).toContain('"agenciaId":"ag1"');
    expect(r.items).toEqual([{ value: 'i1', label: 'Jabón', sublabel: 'SKU-1 · Líquido' }]);
  });

  it('insumos: un administrador sin sede ve el catálogo y puede pedir inactivos', async () => {
    const prisma = {
      insumo: tabla([], 0),
      agencia: { findFirst: vi.fn() },
      user: { findUnique: vi.fn() },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ id: 'bod' }]),
    };
    await new InventarioService(prisma as never).listInsumosOpciones({ estado: 0 } as any, { role: 'ADMIN' });
    expect(prisma.insumo.findMany.mock.calls[0][0].where).toEqual({ estado: 0 });
  });
});
