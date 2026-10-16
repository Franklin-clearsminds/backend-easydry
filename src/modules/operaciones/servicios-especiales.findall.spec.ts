import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { QueryServicioEspecialDto } from './dto/servicios-especiales.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el listado de servicios especiales.
 *
 * Mundo de la prueba, todo creado aquí. Región R1 (agencia A1) y región R2 (agencia A2). Servicios (E1 el más antiguo):
 *   E1 Pendiente   A1/R1  Paco    ABC-111 "Pulido espejo"
 *   E2 En Proceso  A1/R1  Beto    XYZ-222 "Recubrimiento"
 *   E3 Completado  A1/R1  Paco    LMN-333
 *   E4 Pendiente   A2/R2  Rita    DEF-444
 *   E6 Pendiente   A1/R1  Beto, con Paco también asignado
 *   + uno anulado, que nunca se lista.
 * Las consultas de un administrador se acotan con la región R1 (la base real tiene servicios propios).
 */
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

describe('ServiciosEspecialesService.findAll (base real)', () => {
  let env: Entorno;
  let service: ServiciosEspecialesService;
  let r1: any;
  let a1: any;
  let a2: any;
  const ids: Record<string, string> = {};
  const e: Record<string, string> = {};
  const actores: Record<string, any> = {};

  const claves = (r: any) => (r.items ?? r.data).map((x: any) => Object.entries(e).find(([, id]) => id === x.id)?.[0]);
  const lista = (query: Record<string, unknown>, actor: any = actores.admin) =>
    service.findAll({ regionId: r1.id, ...query } as any, actor) as Promise<any>;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new ServiciosEspecialesService(env.prisma as never);

    r1 = await env.region('R1');
    const r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r2.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('admin', 'ADMIN');
    await crear('supervisor', 'SUPERVISOR', { regionId: r1.id });
    await crear('paco', 'PULIDOR', { regionId: r1.id });
    await crear('beto', 'PULIDOR', { regionId: r1.id });
    await crear('rita', 'PULIDOR', { regionId: r2.id });

    const nuevo = async (clave: string, extra: Record<string, unknown>, dias: number) => {
      e[clave] = (await env.servicioEspecial({ ...extra, datos: { createdAt: hace(dias), ...((extra.datos as object) ?? {}) } } as never)).id;
    };
    await nuevo('E1', { estado: 'Pendiente', agenciaId: a1.id, regionId: r1.id, operadorId: ids.paco, placa: 'ABC-111', tipoServicio: 'Pulido espejo', fechaFin: null }, 5);
    await nuevo('E2', { estado: 'En Proceso', agenciaId: a1.id, regionId: r1.id, operadorId: ids.beto, placa: 'XYZ-222', tipoServicio: 'Recubrimiento', fechaFin: null }, 4);
    await nuevo('E3', { estado: 'Completado', agenciaId: a1.id, regionId: r1.id, operadorId: ids.paco, placa: 'LMN-333' }, 3);
    await nuevo('E4', { estado: 'Pendiente', agenciaId: a2.id, regionId: r2.id, operadorId: ids.rita, placa: 'DEF-444', fechaFin: null }, 2);
    await nuevo('E6', { estado: 'Pendiente', agenciaId: a1.id, regionId: r1.id, operadorId: ids.beto, asignados: [ids.beto, ids.paco], placa: 'OPQ-666', fechaFin: null }, 1);
    await env.servicioEspecial({ estado: 'Cancelado', agenciaId: a1.id, regionId: r1.id, operadorId: ids.paco, placa: 'ANU-999', deletedAt: new Date() });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('sin tamaño de página (cliente antiguo) devuelve hasta 100, no 50; los anulados no salen', async () => {
    const r = await lista({});
    expect(r.pageSize).toBe(100);
    expect(claves(r)).toHaveLength(4);
  });

  it('el DTO no fija página ni tamaño por su cuenta y acepta los campos nuevos', async () => {
    const dto = plainToInstance(QueryServicioEspecialDto, { page: '2', pageSize: '25', sortField: 'placa', incluirResumen: true });
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(25);
    expect(await validate(dto)).toHaveLength(0);
    expect(plainToInstance(QueryServicioEspecialDto, {}).pageSize).toBeUndefined();
  });

  it('pagina en el servidor y recorta a 100', async () => {
    const r = await lista({ page: 2, pageSize: 3 });
    expect(r).toMatchObject({ total: 4, page: 2, pageSize: 3, totalPages: 2, hasNextPage: false });
    expect(claves(r)).toHaveLength(1);
    expect((await lista({ pageSize: 200 })).pageSize).toBe(100);
  });

  it('ordena más reciente primero por defecto y solo por columnas permitidas', async () => {
    expect(claves(await lista({}))).toEqual(['E6', 'E3', 'E2', 'E1']);
    const porOperador = claves(await lista({ sortField: 'operador', sortOrder: 'asc' }));
    expect(porOperador.slice(0, 2).sort()).toEqual(['E2', 'E6']); // Beto antes que Paco
    expect(claves(await lista({ sortField: 'passwordHash', sortOrder: 'asc' }))).toEqual(['E6', 'E3', 'E2', 'E1']);
  });

  it('busca por palabras sin distinguir mayúsculas e ignora una sola letra', async () => {
    expect(claves(await lista({ search: 'abc pulido' }))).toEqual(['E1']);
    expect(claves(await lista({ search: 'RECUBRIMIENTO' }))).toEqual(['E2']);
    expect(claves(await lista({ search: 'a' }))).toHaveLength(4);
  });

  it('aplica rango de fechas, región y agencia en el servidor', async () => {
    const r = await lista({ agenciaId: a1.id, fechaDesde: hace(4.5).toISOString(), fechaHasta: hace(2.5).toISOString() });
    expect(claves(r).sort()).toEqual(['E2', 'E3']);
    // E4 es de otra región y agencia: no entra aunque se le pida a un administrador sin filtros.
    expect(claves(await service.findAll({ regionId: a2.regionId ?? undefined, agenciaId: a2.id } as any, actores.admin))).toEqual(['E4']);
  });

  it('un pulidor solo ve los suyos (principal o asignado) aunque pida otro operador', async () => {
    expect(claves(await lista({ operadorId: ids.rita }, actores.paco)).sort()).toEqual(['E1', 'E3', 'E6']);
    expect(claves(await lista({}, actores.rita))).toEqual(['E4']);
  });

  it('el estado "En Proceso" agrupa pendientes y el resumen no lo usa', async () => {
    const r = await lista({ estado: 'En Proceso', incluirResumen: true });
    expect(claves(r).sort()).toEqual(['E1', 'E2', 'E6']); // En Proceso y Pendiente
    expect(r.resumen).toEqual({ porEstado: { Pendiente: 2, 'En Proceso': 1, Completado: 1 }, total: 4 });
  });

  it('sin pedir resumen no devuelve el resumen', async () => {
    const r = await lista({});
    expect(r.resumen).toBeUndefined();
    expect(r.data).toEqual(r.items);
  });

  it('el supervisor combina su región con la búsqueda sin perder ninguna', async () => {
    expect(claves(await service.findAll({ search: 'abc' } as any, actores.supervisor) as any)).toEqual(['E1']);
    expect(claves(await service.findAll({ search: 'def' } as any, actores.supervisor) as any)).toEqual([]); // DEF-444 es de R2
  });
});
