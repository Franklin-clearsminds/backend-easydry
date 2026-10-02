import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgenciasService } from '../../modules/agencias/agencias.service.js';
import { MaquinariaService } from '../../modules/maquinaria/maquinaria.service.js';
import { ListMaquinariaDto } from '../../modules/maquinaria/dto/maquinaria.dto.js';
import { ListAgenciasDto } from '../../modules/agencias/dto/agencias.dto.js';
import { ListOperadoresDto } from '../../modules/agencias/dto/usuarios-agencia.dto.js';
import { ListHistorialAsignacionesDto } from '../../modules/agencias/dto/bahias.dto.js';

const tabla = (filas: unknown[] = [{ id: 'x' }], total = 0) => ({
  findMany: vi.fn().mockResolvedValue(filas),
  count: vi.fn().mockResolvedValue(total),
});

const admin = { id: 'u1', rol: 'ADMIN' } as any;

function maquinaria(total = 40) {
  const prisma = {
    maquinaria: tabla([{ id: 'm1', codigo: 'M-1' }, { id: 'm2', codigo: 'M-2' }], total),
    incidenteTecnico: { groupBy: vi.fn().mockResolvedValue([{ maquinariaId: 'm1', _count: { _all: 3 } }]) },
    mantenimientoMaquinaria: {
      groupBy: vi.fn().mockResolvedValue([{ maquinariaId: 'm2', _count: { _all: 1 }, _min: { fechaProgramada: null } }]),
    },
    limpiezaMaquinaria: { groupBy: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new MaquinariaService(prisma as never, {} as never, {} as never) };
}

describe('maquinaria/list', () => {
  it('modo heredado: { success, total, data } con tope de 100 y sus pendientes', async () => {
    const { prisma, service } = maquinaria();
    const r: any = await service.list({} as any, admin);
    expect(r).toMatchObject({ success: true, total: 2 });
    expect(r.data[0]).toMatchObject({ id: 'm1', incidentesNoAtendidos: 3, mantenimientosVencidos: 0 });
    expect(r.data[1]).toMatchObject({ id: 'm2', incidentesNoAtendidos: 0, mantenimientosVencidos: 1 });
    expect(prisma.maquinaria.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100, orderBy: [{ codigo: 'asc' }] });
  });

  it('paginado: formato estándar con success, y los pendientes solo de las filas de la página', async () => {
    const { prisma, service } = maquinaria(40);
    const r: any = await service.list({ page: 2, pageSize: 2 } as any, admin);
    expect(r).toMatchObject({ success: true, total: 40, page: 2, pageSize: 2, totalPages: 20 });
    expect(r.items).toBe(r.data);
    expect(r.items[0].incidentesNoAtendidos).toBe(3);
    expect(JSON.stringify(prisma.incidenteTecnico.groupBy.mock.calls[0][0].where)).toContain('"maquinariaId":{"in":["m1","m2"]}');
    expect(prisma.maquinaria.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('filtra por región, cliente y estado, busca por serie y ordena solo por columnas permitidas', async () => {
    const { prisma, service } = maquinaria();
    await service.list({ page: 1, regionId: 'r1', clienteId: 'c1', estadoOperativo: 'OPERATIVA', search: 'ab', sortField: 'agencia', sortOrder: 'asc' } as any, admin);
    const args = prisma.maquinaria.findMany.mock.calls[0][0];
    const txt = JSON.stringify(args.where);
    expect(txt).toContain('"agencia":{"regionId":"r1"}');
    expect(txt).toContain('"agencia":{"clienteId":"c1"}');
    expect(txt).toContain('"estadoOperativo":"OPERATIVA"');
    expect(txt).toContain('"serie":{"contains":"ab"');
    expect(args.orderBy[0]).toEqual({ agencia: { nombre: 'asc' } });
    await service.list({ page: 1, sortField: 'fotoUrl; x' } as any, admin);
    expect(prisma.maquinaria.findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('filtra por NOMBRE de agencia, bahía, región y cliente (lo que emite el filter-bar)', async () => {
    const { prisma, service } = maquinaria();
    await service.list({ page: 1, agenciaNombre: 'Uno', bahiaNombre: 'Bahía 2', regionNombre: 'Norte', clienteNombre: 'EasyDry' } as any, admin);
    const txt = JSON.stringify(prisma.maquinaria.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agencia":{"nombre":{"equals":"Uno","mode":"insensitive"}}');
    expect(txt).toContain('"bahia":{"nombre":{"equals":"Bahía 2","mode":"insensitive"}}');
    expect(txt).toContain('"cliente":{"nombre":{"equals":"EasyDry"');
    expect(txt).toContain('"regionRel":{"nombre":{"equals":"Norte"');
  });

  it('un rol sin acceso sigue sin ver nada', async () => {
    const { prisma, service } = maquinaria();
    await service.list({ page: 1 } as any, { id: 'x', rol: 'DESCONOCIDO' } as any);
    expect(JSON.stringify(prisma.maquinaria.findMany.mock.calls[0][0].where)).toContain('"id"');
  });

  it('el líder ve toda la maquinaria de su agencia; el pulidor, solo la que tiene asignada', async () => {
    const { prisma, service } = maquinaria();
    await service.list({ page: 1 } as any, { id: 'lider-1', rol: 'LIDER', regionId: null, agenciaId: 'ag-1' } as any);
    expect(JSON.stringify(prisma.maquinaria.findMany.mock.calls[0][0].where)).toContain('"agenciaId":"ag-1"');

    await service.list({ page: 1 } as any, { id: 'pul-1', rol: 'PULIDOR', regionId: null, agenciaId: 'ag-1' } as any);
    expect(JSON.stringify(prisma.maquinaria.findMany.mock.calls[1][0].where)).toContain('"operadorAsignadoId":"pul-1"');
  });

  it('el DTO no fija page/pageSize y conserva los filtros nuevos', async () => {
    const dto: any = plainToInstance(ListMaquinariaDto, { regionId: 'r', clienteId: 'c' });
    expect(dto.page).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ regionId: 'r', clienteId: 'c' });
  });
});

describe('agencias/list', () => {
  const agenciaFila = (id: string) => ({
    id,
    nombre: `Agencia ${id}`,
    usuarios: [
      { id: 'g1', name: 'Gina', lastname: 'Paz', role: { namerol: 'GERENTE' } },
      { id: 'l1', name: 'Lucas', lastname: 'Rey', role: { namerol: 'LIDER_OPERADOR' } },
    ],
  });
  const armar = () => {
    const prisma = {
      agencia: tabla([agenciaFila('a1'), agenciaFila('a2')], 60),
      servicioLavado: {
        findMany: vi.fn().mockResolvedValue([
          { estado: 'FINALIZADO', bahia: { agenciaId: 'a1' } },
          { estado: 'PENDIENTE', bahia: { agenciaId: 'a1' } },
        ]),
      },
    };
    return { prisma, service: new AgenciasService(prisma as never) };
  };

  it('modo heredado: arreglo de hasta 100 con productividad, gerente y líder', async () => {
    const { prisma, service } = armar();
    const r: any = await service.listAgencias({} as any, { role: { namerol: 'ADMIN' } });
    expect(Array.isArray(r)).toBe(true);
    expect(prisma.agencia.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100, orderBy: [{ nombre: 'asc' }] });
    expect(r[0]).toMatchObject({ productividad: 50, gerenteNombre: 'Gina Paz', liderOperadorNombre: 'Lucas Rey' });
    expect(r[1].productividad).toBe(0);
  });

  it('paginado: la productividad del mes se consulta solo para las agencias de la página', async () => {
    const { prisma, service } = armar();
    const r: any = await service.listAgencias({ page: 3, pageSize: 25 } as any, { role: { namerol: 'ADMIN' } });
    expect(r).toMatchObject({ total: 60, page: 3, pageSize: 25, totalPages: 3 });
    expect(r.items[0].gerenteNombre).toBe('Gina Paz');
    expect(JSON.stringify(prisma.servicioLavado.findMany.mock.calls[0][0].where)).toContain('"agenciaId":{"in":["a1","a2"]}');
    expect(prisma.agencia.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('incluirProductividad: false omite la consulta de servicios del mes (para usarla como selector)', async () => {
    const { prisma, service } = armar();
    const r: any = await service.listAgencias({ incluirProductividad: false } as any, { role: { namerol: 'ADMIN' } });
    expect(prisma.servicioLavado.findMany).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ productividad: 0, gerenteNombre: 'Gina Paz' });
    const pagina: any = await service.listAgencias({ page: 1, incluirProductividad: false } as any, { role: { namerol: 'ADMIN' } });
    expect(pagina.items[0].productividad).toBe(0);
    expect(prisma.servicioLavado.findMany).not.toHaveBeenCalled();
  });

  it('un rol de agencia local sigue viendo solo la suya, con búsqueda y filtros combinados', async () => {
    const { prisma, service } = armar();
    await service.listAgencias({ page: 1, search: 'norte', estado: 1, regionId: 'r1' } as any, { role: { namerol: 'LIDER_OPERADOR' }, agenciaId: 'a9' });
    const where = prisma.agencia.findMany.mock.calls[0][0].where;
    const txt = JSON.stringify(where);
    expect(txt).toContain('"id":"a9"');
    expect(txt).toContain('"estado":1');
    expect(txt).toContain('"regionId":"r1"');
    expect(txt).toContain('"cliente":{"nombre":{"contains":"norte"');
    expect(prisma.agencia.count.mock.calls[0][0].where).toEqual(where);
  });

  it('filtra por región y cliente por nombre exacto y acepta el estado 2 (mantenimiento)', async () => {
    const { prisma, service } = armar();
    await service.listAgencias({ page: 1, regionNombre: 'Norte', clienteNombre: 'Acme', estado: 2 } as any, { role: { namerol: 'ADMIN' } });
    const txt = JSON.stringify(prisma.agencia.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"regionRel":{"nombre":{"equals":"Norte"');
    expect(txt).toContain('"cliente":{"nombre":{"equals":"Acme"');
    expect(txt).toContain('"estado":2');
  });

  it('ordena por cantidad de bahías y descarta columnas ajenas; el DTO no fija page', async () => {
    const { prisma, service } = armar();
    await service.listAgencias({ page: 1, sortField: 'bahias', sortOrder: 'desc' } as any, { role: { namerol: 'ADMIN' } });
    expect(prisma.agencia.findMany.mock.calls[0][0].orderBy[0]).toEqual({ bahias: { _count: 'desc' } });
    await service.listAgencias({ page: 1, sortField: 'servicioIds' } as any, { role: { namerol: 'ADMIN' } });
    expect(prisma.agencia.findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(plainToInstance(ListAgenciasDto, {}).page).toBeUndefined();
  });
});

describe('agencias/operadores/list', () => {
  const armar = () => {
    const prisma = {
      user: tabla([{ id: 'o1', name: 'Pedro', lastname: 'Ruiz', email: 'op.1@x', role: { namerol: 'LAVADOR' }, bahiaOperadores: [], _count: { serviciosAtendidos: 0 } }], 30),
    };
    return { prisma, service: new AgenciasService(prisma as never) };
  };

  it('modo heredado: arreglo con tope de 100 y el orden por nombre', async () => {
    const { prisma, service } = armar();
    const r: any = await service.listOperadores({} as any, { role: 'ADMIN' });
    expect(Array.isArray(r)).toBe(true);
    expect(r[0]).toMatchObject({ id: 'o1', nombre: 'Pedro Ruiz' });
    expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({ take: 100, orderBy: [{ name: 'asc' }] });
  });

  it('paginado: conserva el filtro por agencia (id o nombre) junto con la búsqueda', async () => {
    const { prisma, service } = armar();
    const r: any = await service.listOperadores({ page: 1, pageSize: 10, agenciaId: 'Norte', search: 'ped' } as any, { role: 'ADMIN' });
    expect(r).toMatchObject({ total: 30, page: 1, pageSize: 10, totalPages: 3 });
    const txt = JSON.stringify(prisma.user.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agencia":{"nombre":"Norte"}');
    expect(txt).toContain('"name":{"contains":"ped"');
    expect(r.items[0].nombre).toBe('Pedro Ruiz');
  });

  it('filtra por bahía asignada, cliente de la agencia y estado (pantalla de operadores)', async () => {
    const { prisma, service } = armar();
    await service.listOperadores({ page: 1, bahiaNombre: 'Bahía 2', clienteNombre: 'EasyDry', estado: 1 } as any, { role: 'ADMIN' });
    const txt = JSON.stringify(prisma.user.findMany.mock.calls[0][0].where);
    // Filtra por la relación real BahiaOperador (activa), no por el campo legacy Bahia.operadorActualId
    // que se pisa al asignar un segundo lavador a la misma bahía (ver conversación 2026-09-30).
    expect(txt).toContain('"bahiaOperadores":{"some":{"activo":true,"bahia":{"nombre":{"contains":"Bahía 2"');
    expect(txt).toContain('"cliente":{"nombre":{"equals":"EasyDry"');
    expect(txt).toContain('"estado":1');
  });

  it('la bahía de un operador sale de BahiaOperador (activo), no del campo legacy que se pisa al agregar un segundo lavador', async () => {
    // Bug real: al asignar un segundo lavador a una bahía con maxLavadoresPorBahia > 1,
    // `asignarOperadorABahia` mueve `Bahia.operadorActualId` al recién llegado. Si `mapUserToOperador`
    // siguiera leyendo esa relación legacy, el PRIMER lavador aparecería como "Sin asignar" aunque su
    // fila en BahiaOperador siga activa. Se verifica que ahora lee de ahí.
    const prisma = {
      user: tabla([
        {
          id: 'o1', name: 'Pedro', lastname: 'Ruiz', email: 'op.1@x', role: { namerol: 'LAVADOR' },
          bahiaOperadores: [{ bahia: { id: 'b1', nombre: 'Bahía 01', codigo: 'B01' } }],
          _count: { serviciosAtendidos: 0 },
        },
      ], 1),
    };
    const service = new AgenciasService(prisma as never);
    const r: any = await service.listOperadores({ page: 1, pageSize: 10 } as any, { role: 'ADMIN' });
    expect(r.items[0]).toMatchObject({ bahia: 'Bahía 01', bahiaId: 'b1' });
  });

  it('un líder queda limitado a su agencia aunque pida otra', async () => {
    const { prisma, service } = armar();
    await service.listOperadores({ page: 1, agenciaId: 'otra' } as any, { role: 'LIDER_OPERADOR', agenciaId: 'a1' });
    const txt = JSON.stringify(prisma.user.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"agenciaId":"a1"');
    expect(txt).not.toContain('otra');
  });

  it('el DTO no fija page/pageSize', () => {
    expect(plainToInstance(ListOperadoresDto, {}).page).toBeUndefined();
  });
});

describe('agencias/bahias/historial-asignaciones', () => {
  const armar = () => {
    const prisma = { historialAsignacionBahia: tabla([{ id: 'h1' }], 230) };
    return { prisma, service: new AgenciasService(prisma as never) };
  };

  it('50 por defecto, máximo 100 (antes sin máximo) y formato compatible (data + items)', async () => {
    const { prisma, service } = armar();
    const r: any = await service.obtenerHistorialAsignaciones({} as any);
    expect(prisma.historialAsignacionBahia.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 });
    expect(r).toMatchObject({ total: 230, page: 1, pageSize: 50, totalPages: 5 });
    expect(r.data).toBe(r.items);
    await service.obtenerHistorialAsignaciones({ pageSize: 5000, page: 2 } as any);
    expect(prisma.historialAsignacionBahia.findMany.mock.calls[1][0]).toMatchObject({ skip: 100, take: 100 });
  });

  it('filtra por bahía y operador, busca y ordena solo por columnas permitidas (más reciente primero)', async () => {
    const { prisma, service } = armar();
    await service.obtenerHistorialAsignaciones({ bahiaId: 'b1', operadorId: 'o1', search: 'ana' } as any);
    const args = prisma.historialAsignacionBahia.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ fechaInicio: 'desc' }, { id: 'desc' }]);
    const txt = JSON.stringify(args.where);
    expect(txt).toContain('"bahiaId":"b1"');
    expect(txt).toContain('"operadorId":"o1"');
    expect(txt).toContain('"operador":{"name":{"contains":"ana"');
    expect(prisma.historialAsignacionBahia.count.mock.calls[0][0].where).toEqual(args.where);
    await service.obtenerHistorialAsignaciones({ sortField: 'bahia', sortOrder: 'asc' } as any);
    expect(prisma.historialAsignacionBahia.findMany.mock.calls[1][0].orderBy[0]).toEqual({ bahia: { codigo: 'asc' } });
    await service.obtenerHistorialAsignaciones({ sortField: 'password' } as any);
    expect(prisma.historialAsignacionBahia.findMany.mock.calls[2][0].orderBy).toEqual([{ fechaInicio: 'desc' }, { id: 'desc' }]);
  });

  it('el DTO acepta page/pageSize numéricos', async () => {
    const dto: any = plainToInstance(ListHistorialAsignacionesDto, { page: '2', pageSize: '30', bahiaId: 'b' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto).toMatchObject({ page: 2, pageSize: 30 });
  });
});
