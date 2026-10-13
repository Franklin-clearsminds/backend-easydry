import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OperacionesService } from './operaciones.service.js';
import { QueryServiciosDto } from './dto/query-servicios.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el listado de servicios de lavado.
 *
 * Mundo de la prueba, todo creado aquí. Región R1 (cliente EasyDry): agencia A1 (bahías B1 y B2) y agencia A2 (B3);
 * región R2: agencia A3 (B4). Servicios (S1 el más antiguo; todos con `bahiaId` entre las 4 bahías propias):
 *   S1 B1 EN_PROCESO  Luis   ABC-111 "Toyota Corolla"   catálogo C1
 *   S2 B1 FINALIZADO  Pedro  XYZ-222 "Kia Rio"          catálogo C2 (sin aprobar)
 *   S3 B2 APROBADO    Luis   LMN-333                    C1
 *   S4 B3 FINALIZADO  Ana    DEF-444                    C1
 *   S5 B4 RECHAZADO   Sara   GHI-555                    C1
 *   + un servicio anulado en B1, que nunca se lista.
 * Todas las consultas se acotan con las 4 bahías propias: la base real tiene miles de servicios.
 */
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

describe('OperacionesService.findAll (servicios de lavado, base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let r1: any;
  let cliente: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let b: Record<string, any>;
  let c1: any;
  let c2: any;
  const ids: Record<string, string> = {};
  const s: Record<string, string> = {};
  const actores: Record<string, any> = {};
  let bahiasPropias: string;

  const claves = (r: any) => (r.items ?? r.data).map((x: any) => Object.entries(s).find(([, id]) => id === x.id)?.[0]);
  const lista = (params: Record<string, unknown>, actor: any = actores.admin) =>
    service.findAll({ bahiaId: bahiasPropias, ...params } as any, actor) as Promise<any>;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);

    r1 = await env.region('R1');
    const r2 = await env.region('R2');
    cliente = await env.cliente('EASYDRY');
    a1 = await env.agencia('A1', { regionId: r1.id, clienteId: cliente.id });
    a2 = await env.agencia('A2', { regionId: r1.id, clienteId: cliente.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    b = { b1: await env.bahia('B1', a1.id), b2: await env.bahia('B2', a1.id), b3: await env.bahia('B3', a2.id), b4: await env.bahia('B4', a3.id) };
    bahiasPropias = [b.b1.id, b.b2.id, b.b3.id, b.b4.id].join(',');
    c1 = await env.catalogo('C1');
    c2 = await env.catalogo('C2');

    // Un rol propio de ámbito PROPIO (el servicio lo reconoce por el ámbito guardado en el rol).
    const rolPropio = await env.prisma.role.create({
      data: { namerol: `${env.marca}_PROPIO`.toUpperCase(), esSistema: false, ambito: 'PROPIO', capacidades: ['servicios.ver'] },
    });
    env.rastrear('Role', rolPropio.id);

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, { name: clave, ...opts });
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('admin', 'ADMIN');
    await crear('aprobador', 'APROBADOR', { agenciaId: a1.id });
    await crear('supervisor', 'SUPERVISOR', { regionId: r1.id });
    await crear('supervisorSinRegion', 'SUPERVISOR');
    await crear('liderSinAgencia', 'LIDER');
    await crear('luis', 'LAVADOR', { agenciaId: a1.id, lastname: 'Soto' });
    await crear('pedro', 'LAVADOR', { agenciaId: a1.id, lastname: 'Ruiz' });
    await crear('ana', 'LAVADOR', { agenciaId: a2.id });
    await crear('sara', 'LAVADOR', { agenciaId: a3.id });
    await crear('propio', rolPropio.namerol);

    const servicio = async (clave: string, bahia: any, operador: string, cat: any, estado: any, placa: string, dias: number, extra: Record<string, unknown> = {}) => {
      s[clave] = (
        await env.servicioLavado({ bahiaId: bahia.id, operadorId: ids[operador], catalogoId: cat.id, estado, placa, horaIngreso: hace(dias), horaSalida: null, ...extra })
      ).id;
    };
    await servicio('S1', b.b1, 'luis', c1, 'EN_PROCESO', 'ABC-111', 5, { modelo: 'Toyota Corolla' });
    await servicio('S2', b.b1, 'pedro', c2, 'FINALIZADO', 'XYZ-222', 4, { modelo: 'Kia Rio' });
    await servicio('S3', b.b2, 'luis', c1, 'APROBADO', 'LMN-333', 3);
    await servicio('S4', b.b3, 'ana', c1, 'FINALIZADO', 'DEF-444', 2);
    await servicio('S5', b.b4, 'sara', c1, 'RECHAZADO', 'GHI-555', 1, { asignados: [ids.propio] });
    await env.servicioLavado({ bahiaId: b.b1.id, operadorId: ids.luis, catalogoId: c1.id, estado: 'FINALIZADO', placa: 'ANU-999', deletedAt: new Date() });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('sin tamaño de página (cliente antiguo) devuelve hasta 100, no 20; los anulados no salen', async () => {
    const r = await lista({});
    expect(r.pageSize).toBe(100);
    expect(claves(r)).toHaveLength(5);
  });

  it('el DTO ya no fija pageSize=20 por su cuenta', async () => {
    const dto = plainToInstance(QueryServiciosDto, {});
    expect(dto.pageSize).toBeUndefined();
    expect(dto.page).toBeUndefined();
    expect(dto.sortField).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('pagina en el servidor y recorta a 100 lo que pidan de más', async () => {
    const r = await lista({ page: 2, pageSize: 2 });
    expect(r).toMatchObject({ total: 5, page: 2, pageSize: 2, totalPages: 3, hasNextPage: true });
    expect(claves(r)).toHaveLength(2);
    expect((await lista({ pageSize: 200 })).pageSize).toBe(100);
  });

  it('ordena por fecha de ingreso, más reciente primero, con desempate por id', async () => {
    expect(claves(await lista({}))).toEqual(['S5', 'S4', 'S3', 'S2', 'S1']);
  });

  it('solo ordena por columnas permitidas', async () => {
    expect(claves(await lista({ sortField: 'placa', sortOrder: 'asc' }))).toEqual(['S1', 'S4', 'S5', 'S3', 'S2']); // ABC, DEF, GHI, LMN, XYZ
    const porOperador = claves(await lista({ sortField: 'operador', sortOrder: 'asc' }));
    expect(porOperador[0]).toBe('S4'); // Ana
    expect(porOperador[4]).toBe('S5'); // Sara
    expect(claves(await lista({ sortField: 'operadorId; DROP TABLE', sortOrder: 'asc' }))).toEqual(['S5', 'S4', 'S3', 'S2', 'S1']);
  });

  it('busca por texto en varias columnas, sin distinguir mayúsculas y por palabras', async () => {
    expect(claves(await lista({ search: 'abc toyota' }))).toEqual(['S1']);
    expect(claves(await lista({ search: 'KIA' }))).toEqual(['S2']);
    expect(claves(await lista({ search: 'ruiz' }))).toEqual(['S2']); // por el apellido del operador
    expect(claves(await lista({ search: 'abc kia' }))).toEqual([]); // cada palabra tiene que aparecer
  });

  it('una búsqueda de una sola letra se ignora', async () => {
    expect(claves(await lista({ search: 'a' }))).toHaveLength(5);
  });

  it('aplica en el servidor bahía, servicio, cliente y rango de fechas', async () => {
    expect(claves(await service.findAll({ bahiaId: b.b2.id } as any, actores.admin) as any)).toEqual(['S3']);
    expect(claves(await lista({ servicioId: c2.id })).sort()).toEqual(['S2']);
    expect(claves(await lista({ clienteId: cliente.id })).sort()).toEqual(['S1', 'S2', 'S3', 'S4']); // S5 es de A3, sin cliente
    // Del día -4.5 al día -1.5: S2, S3 y S4.
    const r = await lista({ fechaDesde: hace(4.5).toISOString(), fechaHasta: hace(1.5).toISOString() });
    expect(claves(r).sort()).toEqual(['S2', 'S3', 'S4']);
  });

  it('un usuario con alcance propio solo ve lo suyo aunque pida los servicios de otro operador', async () => {
    // "propio" es lavador asignado de S5. Pedir los servicios de Luis no le muestra nada de Luis.
    expect(claves(await lista({ operadorId: ids.luis }, actores.propio))).toEqual(['S5']);
    expect(claves(await lista({}, actores.propio))).toEqual(['S5']);
  });

  it('un rol de agencia sin agencia asignada no ve nada aunque el cliente mande una agencia', async () => {
    expect(claves(await lista({ agenciaId: a1.id }, actores.liderSinAgencia))).toEqual([]);
  });

  it('el aprobador y el líder solo ven su agencia aunque pidan otra', async () => {
    expect(claves(await lista({ agenciaId: a3.id }, actores.aprobador)).sort()).toEqual(['S1', 'S2', 'S3']);
  });

  it('el supervisor queda dentro de su región: pedir una agencia solo acota, no amplía', async () => {
    expect(claves(await lista({}, actores.supervisor)).sort()).toEqual(['S1', 'S2', 'S3', 'S4']); // R1: A1 y A2
    expect(claves(await lista({ agenciaId: a2.id }, actores.supervisor))).toEqual(['S4']); // acota dentro de su región
    expect(claves(await lista({ agenciaId: a3.id }, actores.supervisor))).toEqual([]); // A3 es de otra región: no amplía
    expect(claves(await lista({ regionId: 'region-ajena' }, actores.supervisor)).sort()).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('un supervisor sin región asignada no ve nada; sin usuario tampoco', async () => {
    expect(claves(await lista({}, actores.supervisorSinRegion))).toEqual([]);
    expect(claves((await service.findAll({ bahiaId: bahiasPropias } as any)) as any)).toEqual([]);
  });

  it('el resumen por estado usa los mismos filtros pero no el de estado', async () => {
    const r = await lista({ estado: 'FINALIZADO', incluirResumen: true });
    expect(claves(r).sort()).toEqual(['S2', 'S3', 'S4']); // "FINALIZADO" incluye también los aprobados
    expect(r.resumen).toEqual({ porEstado: { EN_PROCESO: 1, FINALIZADO: 2, APROBADO: 1, RECHAZADO: 1 }, porAprobar: 2, total: 5 });
  });

  it('sin pedir resumen no devuelve el resumen', async () => {
    const r = await lista({});
    expect(r.resumen).toBeUndefined();
    expect(r.data).toEqual(r.items);
  });

  it('acepta varias bahías separadas por coma (mismo nombre en varias agencias)', async () => {
    expect(claves(await service.findAll({ bahiaId: `${b.b1.id}, ${b.b2.id}` } as any, actores.admin) as any).sort()).toEqual(['S1', 'S2', 'S3']);
  });

  describe('filtros por nombre', () => {
    it('filtra por agencia, bahía, cliente y operador por nombre sin quitar el alcance por rol', async () => {
      const r = await lista(
        { page: 1, agenciaNombre: a1.nombre, bahiaNombre: b.b1.nombre, clienteNombre: cliente.nombre, operadorNombre: 'pedro ruiz' },
        actores.aprobador,
      );
      expect(claves(r)).toEqual(['S2']);
      // El alcance del aprobador sigue: con el nombre de la agencia A3 no ve nada, aunque el servicio exista.
      expect(claves(await lista({ page: 1, agenciaNombre: a3.nombre }, actores.aprobador))).toEqual([]);
      expect(claves(await lista({ page: 1, agenciaNombre: a3.nombre }, actores.admin))).toEqual(['S5']);
    });

    it('los DTO conservan los filtros por nombre', () => {
      const dto: any = plainToInstance(QueryServiciosDto, { agenciaNombre: 'A', bahiaNombre: 'B', operadorNombre: 'C', clienteNombre: 'D' });
      expect(dto).toMatchObject({ agenciaNombre: 'A', bahiaNombre: 'B', operadorNombre: 'C', clienteNombre: 'D' });
    });
  });
});
