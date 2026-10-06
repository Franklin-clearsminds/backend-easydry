import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgenciasService } from '../../modules/agencias/agencias.service.js';
import { RetosService } from '../../modules/retos/retos.service.js';
import { RolesService } from '../../modules/roles/roles.service.js';
import { CatalogosService } from '../../modules/catalogos/catalogos.service.js';
import { ListRegionesDto } from '../../modules/agencias/dto/regiones.dto.js';
import { ListClientesDto } from '../../modules/agencias/dto/clientes.dto.js';
import { ListBahiasDto } from '../../modules/agencias/dto/bahias.dto.js';
import { ListRetosDto } from '../../modules/retos/dto/retos.dto.js';
import { QueryRolesDto } from '../../modules/roles/dto/query-roles.dto.js';
import { ListCatalogoServiciosDto } from '../../modules/catalogos/dto/servicios.dto.js';

const tabla = (filas: unknown[] = [{ id: 'x' }], total = 0) => ({
  findMany: vi.fn().mockResolvedValue(filas),
  count: vi.fn().mockResolvedValue(total),
});

const region = { id: 'r1', nombre: 'Norte', usuarios: [{ id: 'u1', name: 'Ana', lastname: 'Paz', role: { namerol: 'SUPERVISOR' } }] };

const casos = [
  {
    nombre: 'regiones',
    dto: ListRegionesDto,
    construir: () => {
      const prisma = { region: tabla([region], 40) };
      return { prisma, tabla: prisma.region, llamar: (d: any) => new AgenciasService(prisma as never).listRegiones(d) };
    },
    heredado: [{ nombre: 'asc' }],
    columna: 'agencias',
    esperada: { agencias: { _count: 'asc' } },
  },
  {
    nombre: 'clientes',
    dto: ListClientesDto,
    construir: () => {
      const prisma = { cliente: tabla([{ id: 'c1' }], 40) };
      return { prisma, tabla: prisma.cliente, llamar: (d: any) => new AgenciasService(prisma as never).listClientes(d) };
    },
    heredado: [{ nombre: 'asc' }],
    columna: 'nombre',
    esperada: { nombre: 'asc' },
  },
  {
    nombre: 'bahías',
    dto: ListBahiasDto,
    construir: () => {
      const prisma = { bahia: tabla([{ id: 'b1' }], 40), servicioLavado: { findMany: vi.fn().mockResolvedValue([]) } };
      return { prisma, tabla: prisma.bahia, llamar: (d: any) => new AgenciasService(prisma as never).listBahias(d) };
    },
    heredado: [{ codigo: 'asc' }],
    columna: 'agencia',
    esperada: { agencia: { nombre: 'asc' } },
  },
  {
    nombre: 'retos',
    dto: ListRetosDto,
    construir: () => {
      const prisma = { reto: tabla([{ id: 'e1' }], 40) };
      return { prisma, tabla: prisma.reto, llamar: (d: any) => new RetosService(prisma as never).list(d, { role: 'SUPER_ADMIN' }) };
    },
    heredado: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }],
    columna: 'titulo',
    esperada: { titulo: 'asc' },
    porDefecto: [{ fechaInicio: 'desc' }, { id: 'desc' }],
  },
  {
    nombre: 'roles',
    dto: QueryRolesDto,
    construir: () => {
      const prisma = { role: tabla([{ id: 'ro1', namerol: 'ADMIN', _count: { users: 2 } }], 40) };
      const notifications = { notificarCambioPermisosRol: vi.fn() };
      return { prisma, tabla: prisma.role, llamar: (d: any) => new RolesService(prisma as never, notifications as never).findAll(d) };
    },
    heredado: [{ namerol: 'asc' }],
    columna: 'usuarios',
    esperada: { users: { _count: 'asc' } },
    porDefecto: [{ fechaCreacion: 'desc' }],
  },
  {
    nombre: 'catálogo de servicios',
    dto: ListCatalogoServiciosDto,
    construir: () => {
      const prisma = { catalogoServicio: tabla([{ id: 1, recetas: [] }], 40), agencia: { findUnique: vi.fn() } };
      return { prisma, tabla: prisma.catalogoServicio, llamar: (d: any) => new CatalogosService(prisma as never).listServicios(d, {}) };
    },
    heredado: [{ codigo: 'asc' }],
    columna: 'precio',
    esperada: { precio: 'asc' },
    porDefecto: [{ id: 'desc' }, undefined],
  },
] as const;

describe.each(casos)('listado paginado de $nombre', (caso: any) => {
  it('modo heredado: arreglo con el orden de siempre y tope de 100', async () => {
    const { tabla: t, llamar } = caso.construir();
    const r = await llamar({});
    expect(Array.isArray(r)).toBe(true);
    const args = t.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 0, take: 100 });
    expect(args.orderBy).toEqual(caso.heredado);
    expect(t.count).not.toHaveBeenCalled();
  });

  it('modo paginado: formato estándar, recorta a 100 y lo más reciente primero', async () => {
    const { tabla: t, llamar } = caso.construir();
    const r: any = await llamar({ page: 3, pageSize: 25 });
    const args = t.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 50, take: 25 });
    expect(args.orderBy[0]).toEqual((caso.porDefecto ?? [{ createdAt: 'desc' }, { id: 'desc' }])[0] ?? args.orderBy[0]);
    expect(r).toMatchObject({ total: 40, page: 3, pageSize: 25, totalPages: 2, hasNextPage: false, hasPrevPage: true });
    await llamar({ pageSize: 500 });
    expect(t.findMany.mock.calls[1][0].take).toBe(100);
  });

  it('ordena solo por columnas permitidas', async () => {
    const { tabla: t, llamar } = caso.construir();
    await llamar({ page: 1, sortField: caso.columna, sortOrder: 'asc' });
    expect(t.findMany.mock.calls[0][0].orderBy[0]).toEqual(caso.esperada);
    await llamar({ page: 1, sortField: 'password; DROP', sortOrder: 'asc' });
    const dflt = t.findMany.mock.calls[1][0].orderBy[0];
    expect(JSON.stringify(dflt)).not.toContain('password');
  });

  it('el conteo usa los mismos filtros y una búsqueda de una letra se ignora', async () => {
    const { tabla: t, llamar } = caso.construir();
    await llamar({ page: 1, search: 'ab cd' });
    expect(t.count.mock.calls[0][0].where).toEqual(t.findMany.mock.calls[0][0].where);
    expect(JSON.stringify(t.findMany.mock.calls[0][0].where)).toContain('"contains":"cd"');
    await llamar({ page: 1, search: 'a' });
    expect(JSON.stringify(t.findMany.mock.calls[1][0].where)).not.toContain('contains');
  });

  it('el DTO no fija page/pageSize y valida', async () => {
    const vacio: any = plainToInstance(caso.dto, {});
    expect(vacio.page).toBeUndefined();
    expect(vacio.pageSize).toBeUndefined();
    expect(await validate(vacio)).toHaveLength(0);
    expect(await validate(plainToInstance(caso.dto, { page: '2', pageSize: 200, sortField: 'nombre', sortOrder: 'asc', search: 'ab' }))).toHaveLength(0);
  });
});

describe('particularidades', () => {
  it('regiones: conserva el responsable (supervisor) en cada fila, con o sin página', async () => {
    const prisma = { region: tabla([region], 1) };
    const s = new AgenciasService(prisma as never);
    const heredado: any = await s.listRegiones({} as any);
    expect(heredado[0]).toMatchObject({ responsable: 'Ana Paz', supervisorId: 'u1' });
    const pagina: any = await s.listRegiones({ page: 1 } as any);
    expect(pagina.items[0]).toMatchObject({ responsable: 'Ana Paz', supervisorId: 'u1' });
  });

  it('regiones: conserva el filtro de estado', async () => {
    const prisma = { region: tabla([], 0) };
    await new AgenciasService(prisma as never).listRegiones({ estado: 0, page: 1 } as any);
    expect(prisma.region.findMany.mock.calls[0][0].where).toEqual({ estado: 0 });
  });

  it('bahías: conserva los filtros de agencia y estado, y busca también por agencia', async () => {
    const prisma = { bahia: tabla([], 0) };
    await new AgenciasService(prisma as never).listBahias({ agenciaId: 'a1', activa: true, search: 'norte' } as any);
    const txt = JSON.stringify(prisma.bahia.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agenciaId":"a1"');
    expect(txt).toContain('"activa":true');
    expect(txt).toContain('"agencia":{"nombre":{"contains":"norte"');
  });

  it('retos: un rol no administrador conserva su regla de visibilidad junto con la búsqueda', async () => {
    const prisma = { reto: tabla([], 0) };
    await new RetosService(prisma as never).list({ page: 1, search: 'verano' } as any, { role: 'LAVADOR', agenciaId: 'a1', region: { nombre: 'Norte' } });
    const txt = JSON.stringify(prisma.reto.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"estado":"ACTIVO"');
    expect(txt).toContain('"sucursalesIds":{"has":"a1"}');
    expect(txt).toContain('"titulo":{"contains":"verano"');
  });

  it('roles: nunca lista SUPER_ADMIN y conserva los campos calculados', async () => {
    const prisma = { role: tabla([{ id: 'ro1', namerol: 'ADMIN', _count: { users: 2 } }], 1) };
    const notifications = { notificarCambioPermisosRol: vi.fn() };
    const r: any = await new RolesService(prisma as never, notifications as never).findAll({ page: 1, estado: 1 } as any);
    expect(JSON.stringify(prisma.role.findMany.mock.calls[0][0].where)).toContain('"namerol":{"not":"SUPER_ADMIN"}');
    expect(r.items[0]).toMatchObject({ namerol: 'ADMIN', usuariosCount: 2 });
  });

  it('catálogo de servicios: un rol acotado sigue recibiendo su agencia, en ambos modos', async () => {
    const prisma = {
      catalogoServicio: tabla([{ id: 1, recetas: [] }], 1),
      agencia: { findUnique: vi.fn().mockResolvedValue({ tieneServiciosEspeciales: false, servicioIds: [1, 2] }) },
    };
    const s = new CatalogosService(prisma as never);
    const heredado: any = await s.listServicios({} as any, { agenciaId: 'a1', namerol: 'LIDER_OPERADOR' });
    expect(heredado.agencia).toEqual({ tieneServiciosEspeciales: false, servicioIds: [1, 2] });
    expect(heredado.servicios).toHaveLength(1);
    const pagina: any = await s.listServicios({ page: 1 } as any, { agenciaId: 'a1', namerol: 'LIDER_OPERADOR' });
    expect(pagina.agencia).toBeDefined();
    expect(pagina.items).toHaveLength(1);
    const txt = JSON.stringify(prisma.catalogoServicio.findMany.mock.calls[1][0].where);
    expect(txt).toContain('"id":{"in":[1,2]}');
    expect(txt).toContain('"categoria":"GENERAL"');
  });

  it('catálogo de servicios: un administrador sin agencia recibe el arreglo plano de siempre', async () => {
    const prisma = { catalogoServicio: tabla([{ id: 1, recetas: [] }], 1), agencia: { findUnique: vi.fn() } };
    const r = await new CatalogosService(prisma as never).listServicios({} as any, { namerol: 'ADMIN' });
    expect(Array.isArray(r)).toBe(true);
  });
});
