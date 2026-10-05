import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgenciasService } from './agencias.service.js';
import { ListUsuariosAgenciaDto } from './dto/usuarios-agencia.dto.js';

function construir(total = 0) {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(total);
  const prisma = { user: { findMany, count } };
  const service = new AgenciasService(prisma as never);
  return { service, findMany, count };
}

const dto = (obj: Record<string, unknown>) => plainToInstance(ListUsuariosAgenciaDto, obj) as ListUsuariosAgenciaDto;
const json = (x: unknown) => JSON.stringify(x);

const ADMIN = { id: 'admin', role: { namerol: 'ADMIN' } };

describe('AgenciasService.listUsuariosPorAgencia - modo heredado', () => {
  it('sin page ni pageSize devuelve el arreglo plano completo, orden nombre asc y sin tope', async () => {
    const { service, findMany, count } = construir();
    const filas = [{ id: 'u1' }, { id: 'u2' }];
    findMany.mockResolvedValue(filas);
    const r = await service.listUsuariosPorAgencia(dto({}), ADMIN);
    expect(r).toBe(filas);
    expect(Array.isArray(r)).toBe(true);
    const args = findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ name: 'asc' });
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(args.where).toEqual({ role: { namerol: { not: 'SUPER_ADMIN' } } });
    expect(count).not.toHaveBeenCalled();
  });

  it('conserva los filtros heredados agencia, rol y estado', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ agenciaId: 'a1', rolNombre: 'PULIDOR_FIJO', estado: 1 }), ADMIN);
    expect(findMany.mock.calls[0][0].where).toEqual({
      role: { namerol: 'PULIDOR_FIJO' },
      agenciaId: 'a1',
      estado: 1,
    });
  });

  it('pedir SUPER_ADMIN devuelve una lista vacía', async () => {
    const { service, findMany } = construir();
    expect(await service.listUsuariosPorAgencia(dto({ rolNombre: 'super_admin' }), ADMIN)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('el DTO no fija page ni pageSize y acepta el cuerpo antiguo vacío', async () => {
    const d = dto({});
    expect(d.page).toBeUndefined();
    expect(d.pageSize).toBeUndefined();
    expect(d.sortField).toBeUndefined();
    expect(d.sortOrder).toBeUndefined();
    expect(await validate(d)).toHaveLength(0);
    expect(await validate(dto({ estado: 1, agenciaId: 'x' }))).toHaveLength(0);
  });
});

describe('AgenciasService.listUsuariosPorAgencia - modo paginado', () => {
  it('usa 25 por defecto, devuelve el formato estándar y no incluye contraseña', async () => {
    const { service, findMany } = construir(60);
    const r: any = await service.listUsuariosPorAgencia(dto({ page: 2 }), ADMIN);
    const args = findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 25, take: 25 });
    expect(args.select.password).toBeUndefined();
    expect(args.select.createdAt).toBe(true);
    expect(r).toMatchObject({ total: 60, page: 2, pageSize: 25, totalPages: 3, hasNextPage: true, hasPrevPage: true });
    expect(r.items).toBe(r.data);
    expect(r.resumen).toBeUndefined();
  });

  it('recorta pageSize a 100 (el DTO admite hasta 200)', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ pageSize: 200 }), ADMIN);
    expect(findMany.mock.calls[0][0].take).toBe(100);
    expect(await validate(dto({ pageSize: 200 }))).toHaveLength(0);
  });

  it('ordena por defecto por fecha de creación desc con desempate por id', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ page: 1 }), ADMIN);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('solo ordena por columnas permitidas', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ page: 1, sortField: 'rol', sortOrder: 'asc' }), ADMIN);
    expect(findMany.mock.calls[0][0].orderBy[0]).toEqual({ role: { namerol: 'asc' } });
    await service.listUsuariosPorAgencia(dto({ page: 1, sortField: 'agencia', sortOrder: 'desc' }), ADMIN);
    expect(findMany.mock.calls[1][0].orderBy[0]).toEqual({ agencia: { nombre: 'desc' } });
    await service.listUsuariosPorAgencia(dto({ page: 1, sortField: 'password; DROP TABLE', sortOrder: 'asc' }), ADMIN);
    expect(findMany.mock.calls[2][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    await service.listUsuariosPorAgencia(dto({ page: 1, sortField: 'password', sortOrder: 'asc' }), ADMIN);
    expect(findMany.mock.calls[3][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('busca por palabras en nombre, apellido, correo, agencia y rol', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ page: 1, search: 'juan quito' }), ADMIN);
    const w = json(findMany.mock.calls[0][0].where);
    expect(w).toContain('"name":{"contains":"juan","mode":"insensitive"}');
    expect(w).toContain('"lastname":{"contains":"quito","mode":"insensitive"}');
    expect(w).toContain('"email":{"contains":"juan"');
    expect(w).toContain('"agencia":{"nombre":{"contains":"quito"');
    expect(w).toContain('"role":{"namerol":{"contains":"juan"');
  });

  it('una búsqueda de una sola letra se ignora', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ page: 1, search: 'a' }), ADMIN);
    expect(json(findMany.mock.calls[0][0].where)).not.toContain('contains');
  });

  it('SUPER_ADMIN queda siempre excluido, incluso si lo piden por rol', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ page: 1, rolNombre: 'SUPER_ADMIN,ADMIN' }), ADMIN);
    const w = json(findMany.mock.calls[0][0].where);
    expect(w).toContain('{"role":{"namerol":{"not":"SUPER_ADMIN"}}}');
    expect(w).toContain('"namerol":{"in":["SUPER_ADMIN","ADMIN"]}');
  });

  it('aplica en el servidor agencia, región, cliente, estado y rol', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({
      page: 1, agenciaId: 'a1', regionId: 'r1', clienteId: 'c1', estado: 0, rolNombre: 'LAVADOR', rolId: 'rol1',
    }), ADMIN);
    const w = json(findMany.mock.calls[0][0].where);
    expect(w).toContain('{"agenciaId":"a1"}');
    expect(w).not.toContain('agenciasIds');
    expect(w).toContain('{"regionId":"r1"},{"agencia":{"regionId":"r1"}}');
    expect(w).toContain('{"agencia":{"clienteId":"c1"}}');
    expect(w).toContain('{"estado":0}');
    expect(w).toContain('"namerol":{"in":["LAVADOR"]}');
    expect(w).toContain('{"role":{"id":"rol1"}}');
  });

  it('el segmento inactivos filtra por estado 0 y el de supervisores por rol', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ page: 1, segmento: 'inactivos' }), ADMIN);
    expect(json(findMany.mock.calls[0][0].where)).toContain('{"estado":0}');
    await service.listUsuariosPorAgencia(dto({ page: 1, segmento: 'supervisores' }), ADMIN);
    expect(json(findMany.mock.calls[1][0].where)).toContain('"namerol":{"contains":"SUPERVISOR","mode":"insensitive"}');
  });

  it('con incluirResumen cuenta cada segmento con los mismos filtros, sin el segmento', async () => {
    const { service, count } = construir(7);
    const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: 'r1', segmento: 'bodega', incluirResumen: true }), ADMIN);
    expect(r.resumen).toEqual({ total: 7, lavadores: 7, supervisores: 7, bodega: 7, admins: 7, inactivos: 7 });
    // 1 conteo de la página + 6 del resumen
    expect(count).toHaveBeenCalledTimes(7);
    const wheres = count.mock.calls.map((c) => json(c[0].where));
    const sinSegmento = wheres.filter((w) => w.includes('"regionId":"r1"') && !w.includes('BODEGA') && !w.includes('LAVADOR'));
    expect(sinSegmento.length).toBeGreaterThanOrEqual(1);
    expect(wheres.every((w) => w.includes('"not":"SUPER_ADMIN"'))).toBe(true);
  });

  it('con solo pageSize se activa el modo paginado aunque no haya filtros', async () => {
    const { service } = construir(3);
    const r: any = await service.listUsuariosPorAgencia(dto({ pageSize: 10 }), ADMIN);
    expect(Array.isArray(r)).toBe(false);
    expect(r.pageSize).toBe(10);
  });
});

describe('AgenciasService.listUsuariosPorAgencia — alcance y datos de contacto', () => {
  const rol = (namerol: string, extra: Record<string, unknown> = {}) => ({ id: 'u-' + namerol, role: { namerol }, ...extra });

  it('cada rol solo lista usuarios de su alcance: agencia, región o ninguno', async () => {
    const a = construir();
    await a.service.listUsuariosPorAgencia(dto({}), rol('LIDER', { agenciaId: 'a1' }));
    expect(json(a.findMany.mock.calls[0][0].where)).toContain('"agenciaId":"a1"');
    const b = construir();
    await b.service.listUsuariosPorAgencia(dto({ page: 1 }), rol('SUPERVISOR', { regionId: 'r1' }));
    expect(json(b.findMany.mock.calls[0][0].where)).toContain('{"regionId":"r1"},{"agencia":{"regionId":"r1"}}');
    const c = construir();
    await c.service.listUsuariosPorAgencia(dto({}), rol('LIDER'));
    expect(json(c.findMany.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
  });

  it('pedir otra agencia no amplía el alcance del líder', async () => {
    const { service, findMany } = construir();
    await service.listUsuariosPorAgencia(dto({ agenciaId: 'a-ajena' }), rol('LIDER', { agenciaId: 'a1' }));
    const w = json(findMany.mock.calls[0][0].where);
    expect(w).toContain('"agenciaId":"a1"');
    expect(w).toContain('"agenciaId":"a-ajena"'); // ambos a la vez: no devuelve nada de la ajena
  });

  it('quien no es administrador no recibe correos; el administrador sí', async () => {
    const filas = [{ id: 'u1', name: 'Ana', email: 'ana@x.com', telefono: '099' }];
    const a = construir();
    a.findMany.mockResolvedValue(filas);
    expect(await a.service.listUsuariosPorAgencia(dto({}), rol('LIDER', { agenciaId: 'a1' }))).toEqual([{ id: 'u1', name: 'Ana' }]);
    const b = construir();
    b.findMany.mockResolvedValue(filas);
    expect(await b.service.listUsuariosPorAgencia(dto({}), ADMIN)).toEqual(filas);
  });
});
