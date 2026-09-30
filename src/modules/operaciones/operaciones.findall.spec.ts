import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OperacionesService } from './operaciones.service.js';
import { QueryServiciosDto } from './dto/query-servicios.dto.js';

function construir(total = 0) {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(total);
  const groupBy = vi.fn().mockResolvedValue([
    { estado: 'EN_PROCESO', _count: { _all: 3 } },
    { estado: 'FINALIZADO', _count: { _all: 5 } },
  ]);
  const prisma = { servicioLavado: { findMany, count, groupBy } };
  const service = new OperacionesService(prisma as never);
  return { service, findMany, count, groupBy };
}

const admin = { id: 'u1', role: { namerol: 'ADMIN' } };

describe('OperacionesService.findAll (servicios de lavado)', () => {
  it('sin tamaño de página (cliente antiguo) devuelve hasta 100, no 20', async () => {
    const { service, findMany } = construir(500);
    await service.findAll({}, admin);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
  });

  it('el DTO ya no fija pageSize=20 por su cuenta', async () => {
    const dto = plainToInstance(QueryServiciosDto, {});
    expect(dto.pageSize).toBeUndefined();
    expect(dto.page).toBeUndefined();
    expect(dto.sortField).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('pagina en el servidor y recorta a 100 lo que pidan de más', async () => {
    const { service, findMany } = construir(1000);
    const r: any = await service.findAll({ page: 3, pageSize: 25 }, admin);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 25 });
    expect(r).toMatchObject({ total: 1000, page: 3, pageSize: 25, totalPages: 40, hasNextPage: true });

    await service.findAll({ pageSize: 200 }, admin);
    expect(findMany.mock.calls[1][0].take).toBe(100);
  });

  it('ordena por fecha de ingreso, más reciente primero, con desempate por id', async () => {
    const { service, findMany } = construir();
    await service.findAll({}, admin);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ horaIngreso: 'desc' }, { id: 'desc' }]);
  });

  it('solo ordena por columnas permitidas', async () => {
    const { service, findMany } = construir();
    await service.findAll({ sortField: 'placa', sortOrder: 'asc' }, admin);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ placa: 'asc' }, { id: 'asc' }]);

    await service.findAll({ sortField: 'operador', sortOrder: 'asc' }, admin);
    expect(findMany.mock.calls[1][0].orderBy[0]).toEqual({ operador: { name: 'asc' } });

    await service.findAll({ sortField: 'operadorId; DROP TABLE', sortOrder: 'asc' }, admin);
    expect(findMany.mock.calls[2][0].orderBy).toEqual([{ horaIngreso: 'desc' }, { id: 'desc' }]);
  });

  it('busca por texto en varias columnas, sin distinguir mayúsculas y por palabras', async () => {
    const { service, findMany } = construir();
    await service.findAll({ search: 'abc toyota' }, admin);
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"placa":{"contains":"abc","mode":"insensitive"}');
    expect(where).toContain('"modelo":{"contains":"toyota","mode":"insensitive"}');
    expect(where).toContain('"ordenTrabajoOT"');
  });

  it('una búsqueda de una sola letra se ignora', async () => {
    const { service, findMany } = construir();
    await service.findAll({ search: 'a' }, admin);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).not.toContain('contains');
  });

  it('aplica en el servidor bahía, servicio, cliente y rango de fechas', async () => {
    const { service, findMany } = construir();
    await service.findAll({
      bahiaId: 'b1', servicioId: 7, clienteId: 'c1',
      fechaDesde: '2026-09-01T05:00:00.000Z', fechaHasta: '2026-09-30T04:59:59.999Z',
    }, admin);
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"bahiaId":"b1"');
    expect(where).toContain('"servicioCatalogoId":7');
    expect(where).toContain('"clienteId":"c1"');
    expect(where).toContain('"horaIngreso":{"gte":"2026-09-01T05:00:00.000Z","lte":"2026-09-30T04:59:59.999Z"}');
    expect(where).toContain('"deletedAt":null');
  });

  it('un usuario con alcance propio (técnico) solo ve lo suyo aunque pida los servicios de otro operador', async () => {
    const { service, findMany } = construir();
    await service.findAll({ operadorId: 'otro' }, { id: 'tec-1', role: { namerol: 'TECNICO' } });
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"operadorId":"tec-1"');
    expect(where).not.toContain('"operadorId":"otro"');
  });

  it('un rol de agencia sin agencia asignada no ve nada aunque el cliente mande una agencia', async () => {
    const { service, findMany } = construir();
    await service.findAll({ agenciaId: 'a-ajena' }, { id: 'u1', role: { namerol: 'LIDER' } });
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"id":{"in":[]}');
    expect(where).not.toContain('a-ajena');
  });

  it('el aprobador y el líder solo ven su agencia aunque pidan otra', async () => {
    const { service, findMany } = construir();
    await service.findAll({ agenciaId: 'a-ajena' }, { id: 'u1', role: { namerol: 'APROBADOR' }, agenciaId: 'a1' });
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"agenciaId":"a1"');
    expect(where).not.toContain('a-ajena');
  });

  it('el supervisor queda dentro de su región: pedir una agencia solo acota, no amplía', async () => {
    const { service, findMany } = construir();
    await service.findAll({ agenciaId: 'a2', regionId: 'r-ajena' }, { id: 'u1', role: { namerol: 'SUPERVISOR' }, regionId: 'r1' });
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"regionId":"r1"');
    expect(where).toContain('"id":"a2"');
    expect(where).not.toContain('r-ajena');
  });

  it('un supervisor sin región asignada no ve nada; sin usuario tampoco', async () => {
    const { service, findMany } = construir();
    await service.findAll({}, { id: 'u1', role: { namerol: 'SUPERVISOR' } });
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
    await service.findAll({});
    expect(JSON.stringify(findMany.mock.calls[1][0].where)).toContain('"id":{"in":[]}');
  });

  it('el resumen por estado usa los mismos filtros pero no el de estado', async () => {
    const { service, groupBy, count } = construir(8);
    const r: any = await service.findAll({ estado: 'FINALIZADO', bahiaId: 'b1', incluirResumen: true }, admin);
    const whereResumen = JSON.stringify(groupBy.mock.calls[0][0].where);
    expect(whereResumen).toContain('"bahiaId":"b1"');
    expect(whereResumen).not.toContain('FINALIZADO');
    expect(r.resumen).toEqual({ porEstado: { EN_PROCESO: 3, FINALIZADO: 5 }, porAprobar: 8, total: 8 });
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('sin pedir resumen no hace la consulta extra', async () => {
    const { service, groupBy } = construir();
    const r: any = await service.findAll({}, admin);
    expect(groupBy).not.toHaveBeenCalled();
    expect(r.resumen).toBeUndefined();
    expect(r.data).toEqual(r.items);
  });

  it('acepta varias bahías separadas por coma (mismo nombre en varias agencias)', async () => {
    const { service, findMany } = construir();
    await service.findAll({ bahiaId: 'b1, b2' }, admin);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('"bahiaId":{"in":["b1","b2"]}');
  });
});

describe('OperacionesService.findAll — filtros por nombre', () => {
  it('filtra por agencia, bahía, cliente y operador por nombre sin quitar el alcance por rol', async () => {
    const { service, findMany } = construir();
    await service.findAll(
      { page: 1, agenciaNombre: 'Uno', bahiaNombre: 'Bahía 2', clienteNombre: 'EasyDry', operadorNombre: 'Pedro Ruiz' },
      { id: 'u1', role: { namerol: 'APROBADOR' }, agenciaId: 'a9' },
    );
    const txt = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agenciaId":"a9"'); // el alcance del aprobador sigue
    expect(txt).toContain('"agencia":{"nombre":{"equals":"Uno","mode":"insensitive"}}');
    expect(txt).toContain('"bahia":{"nombre":{"equals":"Bahía 2","mode":"insensitive"}}');
    expect(txt).toContain('"cliente":{"nombre":{"equals":"EasyDry"');
    expect(txt).toContain('"operador":{"name":{"contains":"Pedro"');
    expect(txt).toContain('"operador":{"lastname":{"contains":"Ruiz"');
  });

  it('los DTO conservan los filtros por nombre', () => {
    const dto: any = plainToInstance(QueryServiciosDto, { agenciaNombre: 'A', bahiaNombre: 'B', operadorNombre: 'C', clienteNombre: 'D' });
    expect(dto).toMatchObject({ agenciaNombre: 'A', bahiaNombre: 'B', operadorNombre: 'C', clienteNombre: 'D' });
  });
});
