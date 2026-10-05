import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { QueryServicioEspecialDto } from './dto/servicios-especiales.dto.js';

function construir(total = 0) {
  const findMany = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(total);
  const groupBy = vi.fn().mockResolvedValue([
    { estado: 'Pendiente', _count: { _all: 2 } },
    { estado: 'Completado', _count: { _all: 4 } },
  ]);
  const prisma = { servicioEspecial: { findMany, count, groupBy } };
  const service = new ServiciosEspecialesService(prisma as never);
  return { service, findMany, count, groupBy };
}

const admin = { id: 'u1', role: { namerol: 'ADMIN' } };

describe('ServiciosEspecialesService.findAll', () => {
  it('sin tamaño de página (cliente antiguo) devuelve hasta 100, no 50', async () => {
    const { service, findMany } = construir(500);
    await service.findAll({}, admin);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
  });

  it('el DTO no fija página ni tamaño por su cuenta y acepta los campos nuevos', async () => {
    const dto = plainToInstance(QueryServicioEspecialDto, { page: '2', pageSize: '25', sortField: 'placa', incluirResumen: true });
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
    expect(await validate(dto)).toHaveLength(0);
    expect(plainToInstance(QueryServicioEspecialDto, {}).pageSize).toBeUndefined();
  });

  it('pagina en el servidor y recorta a 100', async () => {
    const { service, findMany } = construir(1000);
    const r: any = await service.findAll({ page: 3, pageSize: 25 }, admin);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 25 });
    expect(r).toMatchObject({ total: 1000, page: 3, pageSize: 25, totalPages: 40, hasNextPage: true });
    await service.findAll({ pageSize: 200 }, admin);
    expect(findMany.mock.calls[1][0].take).toBe(100);
  });

  it('ordena más reciente primero por defecto y solo por columnas permitidas', async () => {
    const { service, findMany } = construir();
    await service.findAll({}, admin);
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);

    await service.findAll({ sortField: 'operador', sortOrder: 'asc' }, admin);
    expect(findMany.mock.calls[1][0].orderBy[0]).toEqual({ operador: { name: 'asc' } });

    await service.findAll({ sortField: 'passwordHash', sortOrder: 'asc' }, admin);
    expect(findMany.mock.calls[2][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('busca por palabras sin distinguir mayúsculas e ignora una sola letra', async () => {
    const { service, findMany } = construir();
    await service.findAll({ search: 'abc pulido' }, admin);
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"placa":{"contains":"abc","mode":"insensitive"}');
    expect(where).toContain('"tipoServicio":{"contains":"pulido","mode":"insensitive"}');

    await service.findAll({ search: 'a' }, admin);
    expect(JSON.stringify(findMany.mock.calls[1][0].where)).not.toContain('contains');
  });

  it('aplica rango de fechas, región y agencia en el servidor', async () => {
    const { service, findMany } = construir();
    await service.findAll({
      regionId: 'r1', agenciaId: 'a1',
      fechaDesde: '2026-09-01T05:00:00.000Z', fechaHasta: '2026-09-30T04:59:59.999Z',
    }, admin);
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"regionId":"r1"');
    expect(where).toContain('"agenciaId":"a1"');
    expect(where).toContain('"createdAt":{"gte":"2026-09-01T05:00:00.000Z","lte":"2026-09-30T04:59:59.999Z"}');
    expect(where).toContain('"deletedAt":null');
  });

  it('un pulidor solo ve los suyos aunque pida otro operador', async () => {
    const { service, findMany } = construir();
    await service.findAll({ operadorId: 'otro' }, { id: 'pul-1', regionId: 'r1', role: { namerol: 'PULIDOR_MOVIL' } });
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"operadorId":"pul-1"');
    expect(where).not.toContain('"operadorId":"otro"');
  });

  it('el estado "En Proceso" agrupa pendientes y el resumen no lo usa', async () => {
    const { service, findMany, groupBy } = construir(6);
    const r: any = await service.findAll({ estado: 'En Proceso', regionId: 'r1', incluirResumen: true }, admin);
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('Pendiente');
    const whereResumen = JSON.stringify(groupBy.mock.calls[0][0].where);
    expect(whereResumen).toContain('"regionId":"r1"');
    expect(whereResumen).not.toContain('Pendiente');
    expect(r.resumen).toEqual({ porEstado: { Pendiente: 2, Completado: 4 }, total: 6 });
  });

  it('sin pedir resumen no hace la consulta extra', async () => {
    const { service, groupBy } = construir();
    const r: any = await service.findAll({}, admin);
    expect(groupBy).not.toHaveBeenCalled();
    expect(r.resumen).toBeUndefined();
    expect(r.data).toEqual(r.items);
  });

  it('el supervisor combina su región con la búsqueda sin perder ninguna', async () => {
    const { service, findMany } = construir();
    await service.findAll({ search: 'abc' }, { id: 's1', regionId: 'r9', role: { namerol: 'SUPERVISOR' } });
    const where = JSON.stringify(findMany.mock.calls[0][0].where);
    expect(where).toContain('"regionId":"r9"');
    expect(where).toContain('"placa":{"contains":"abc"');
  });
});
