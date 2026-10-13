import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): los listados de incidencias y mantenimientos, con su orden por grupos.
 *
 * Mundo de la prueba, todo creado aquí. Región R1 (cliente EasyDry), agencia A1, máquinas M1 y M2. Todo se consulta
 * como administrador con `regionId: R1`, así la base real (88 incidencias, ~600 mantenimientos) no se mezcla.
 *
 *  Incidencias, de la más reciente a la más antigua dentro de cada grupo:
 *    sin atender : a1, a2 (ABIERTO, sin técnico)
 *    en proceso  : b1, b2 (técnico T1) y b3 (técnico T2)
 *    cerradas    : c1 (RESUELTO) y c2 (CANCELADO)
 *  Mantenimientos:
 *    vencidos    : v1 (PENDIENTE, hace 10 días) y v2 (EN_PROCESO, hace 5)
 *    pendientes  : p1 (dentro de 5 días)
 *    ejecutados  : e1, e2, e3 (FINALIZADOS; e1 el más reciente)
 */
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

describe('MaquinariaService: listados paginados (base real)', () => {
  let env: Entorno;
  let service: MaquinariaService;
  let r1: any;
  let cliente: any;
  let admin: Actor;
  let coord: Actor;
  const ids: Record<string, string> = {};
  const inc: Record<string, string> = {};
  const man: Record<string, string> = {};

  const claves = (r: any, mapa: Record<string, string>) => r.data.map((x: any) => Object.entries(mapa).find(([, id]) => id === x.id)?.[0]);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new MaquinariaService(env.prisma as never, env.storage(), env.notificaciones());

    r1 = await env.region('R1');
    cliente = await env.cliente('EASYDRY');
    const a1 = await env.agencia('A1', { regionId: r1.id, clienteId: cliente.id });
    const m1 = await env.maquinaria('M1', { agenciaId: a1.id });
    const m2 = await env.maquinaria('M2', { agenciaId: a1.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, { name: clave, ...opts })).id;
    };
    await crear('admin', 'ADMIN');
    await crear('coord', 'COORD_MANTENIMIENTO', { regionId: r1.id });
    await crear('t1', 'TECNICO', { regionId: r1.id });
    await crear('t2', 'TECNICO', { regionId: r1.id });
    admin = { id: ids.admin, rol: 'ADMIN', regionId: null, agenciaId: null };
    coord = { id: ids.coord, rol: 'COORD_MANTENIMIENTO', regionId: r1.id, agenciaId: null };

    const incidente = async (clave: string, maquina: any, estado: string, tecnico: string | null, dias: number) => {
      inc[clave] = (
        await env.prisma.incidenteTecnico.create({
          data: {
            maquinariaId: maquina.id,
            reportadoPorId: ids.admin,
            titulo: `${env.marca} hidro ${clave}`,
            descripcion: 'prueba',
            estado,
            tecnicoAsignadoId: tecnico ? ids[tecnico] : null,
            fechaReporte: hace(dias),
          },
        })
      ).id;
    };
    await incidente('a1', m2, 'ABIERTO', null, 1);
    await incidente('a2', m1, 'ABIERTO', null, 2);
    await incidente('b1', m1, 'EN_PROCESO', 't1', 3);
    await incidente('b2', m1, 'EN_PROCESO', 't1', 4);
    await incidente('b3', m1, 'EN_PROCESO', 't2', 5);
    await incidente('c1', m1, 'RESUELTO', 't1', 6);
    await incidente('c2', m1, 'CANCELADO', null, 7);

    const mantenimiento = async (clave: string, estado: string, programada: Date, ejecucion: Date | null = null) => {
      man[clave] = (
        await env.prisma.mantenimientoMaquinaria.create({
          data: { maquinariaId: m1.id, tecnicoId: ids.t1, estado, fechaProgramada: programada, fechaEjecucion: ejecucion, fechaMantenimiento: ejecucion ?? programada },
        })
      ).id;
    };
    await mantenimiento('v1', 'PENDIENTE', hace(10));
    await mantenimiento('v2', 'EN_PROCESO', hace(5));
    await mantenimiento('p1', 'PENDIENTE', new Date(Date.now() + 5 * DIA));
    await mantenimiento('e1', 'FINALIZADO', hace(20), hace(1));
    await mantenimiento('e2', 'FINALIZADO', hace(21), hace(2));
    await mantenimiento('e3', 'FINALIZADO', hace(22), hace(3));
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('listIncidentes (paginación en el servidor)', () => {
    const lista = (dto: Record<string, unknown>, actor: Actor = admin) =>
      service.listIncidentes({ regionId: r1.id, ...dto } as never, actor) as Promise<any>;

    it('pagina por grupos: primero lo sin atender, luego lo que está en proceso, luego lo cerrado', async () => {
      const r = await lista({ page: 1, pageSize: 3 });
      expect(claves(r, inc)).toEqual(['a1', 'a2', 'b1']);
      expect(r.total).toBe(7);
      expect(r).toMatchObject({ page: 1, pageSize: 3, totalPages: 3, hasNextPage: true });
    });

    it('las páginas siguientes continúan sin repetir ni saltar filas', async () => {
      const todas: string[] = [];
      for (let page = 1; page <= 3; page++) todas.push(...claves(await lista({ page, pageSize: 3 }), inc));
      expect(todas).toEqual(['a1', 'a2', 'b1', 'b2', 'b3', 'c1', 'c2']);
    });

    it('marca como no atendida solo lo abierto y sin técnico', async () => {
      const r = await lista({ pageSize: 10 });
      const banderas = Object.fromEntries(r.data.map((i: any) => [Object.entries(inc).find(([, id]) => id === i.id)![0], i.noAtendida]));
      expect(banderas).toMatchObject({ a1: true, a2: true, b1: false, c1: false, c2: false });
    });

    it('con una columna elegida ordena por ella (whitelist)', async () => {
      const r = await lista({ sortField: 'maquina', sortOrder: 'asc', pageSize: 10 });
      const codigos = r.data.map((i: any) => i.maquinaria.codigo);
      expect(codigos).toEqual([...codigos].sort()); // M1 antes que M2
      expect(r.data[r.data.length - 1].id).toBe(inc.a1); // la única de M2 queda al final
    });

    it('un campo de orden no permitido se ignora y se usan los grupos', async () => {
      const r = await lista({ sortField: 'passwordHash', pageSize: 10 });
      expect(claves(r, inc)).toEqual(['a1', 'a2', 'b1', 'b2', 'b3', 'c1', 'c2']);
    });

    it('recorta a 100 y un cliente sin tamaño recibe hasta 100 (antes 200)', async () => {
      expect((await lista({})).pageSize).toBe(100);
      expect((await lista({ pageSize: 200 })).pageSize).toBe(100);
    });

    it('busca por texto, cliente, técnico y fechas en el servidor y respeta el alcance por rol', async () => {
      expect(claves(await lista({ search: `${env.marca} hidro b2` }), inc)).toEqual(['b2']); // una letra suelta no cuenta, dos sí
      expect(claves(await lista({ clienteId: cliente.id }), inc)).toHaveLength(7);
      expect(claves(await lista({ clienteId: '00000000-0000-4000-8000-000000000000' }), inc)).toEqual([]);
      expect(claves(await lista({ tecnicoId: ids.t1 }), inc).sort()).toEqual(['b1', 'b2', 'c1']);
      // Del día -5.5 al día -2.5: b1, b2 y b3. Con un "hasta" de solo día, ese día entra completo.
      const r = await lista({ fechaDesde: hace(5.5).toISOString(), fechaHasta: hace(2.5).toISOString() });
      expect(claves(r, inc).sort()).toEqual(['b1', 'b2', 'b3']);
      // El coordinador de la región ve lo mismo (todo está en su región); el de otra región, nada.
      expect(claves(await lista({}, coord), inc)).toHaveLength(7);
      const ajeno: Actor = { id: ids.coord, rol: 'COORD_MANTENIMIENTO', regionId: 'region-ajena', agenciaId: null };
      expect(claves(await lista({}, ajeno), inc)).toEqual([]);
    });

    it('el resumen cuenta cada grupo con los filtros pero sin el de estado', async () => {
      const r = await lista({ estado: 'RESUELTO', incluirResumen: true, pageSize: 10 });
      expect(claves(r, inc)).toEqual(['c1']); // la página sí respeta el estado…
      expect(r.resumen).toEqual({ noAtendidas: 2, enProceso: 3, cerradas: 2, total: 7 }); // …el resumen no
    });

    it('entrega el formato estándar con el alias data', async () => {
      const r = await lista({ pageSize: 10 });
      expect(r.success).toBe(true);
      expect(r.items).toEqual(r.data);
    });
  });

  describe('listMantenimientos (paginación en el servidor)', () => {
    const lista = (dto: Record<string, unknown>, actor: Actor = admin) =>
      service.listMantenimientos({ regionId: r1.id, ...dto } as never, actor) as Promise<any>;

    it('vencidos primero, luego pendientes y luego ejecutados, paginados sin repetir', async () => {
      const todos: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const r = await lista({ page, pageSize: 2 });
        todos.push(...claves(r, man));
        expect(r.total).toBe(6);
      }
      // Los vencidos más recientes primero; los ejecutados, por fecha de ejecución (el último ejecutado primero).
      expect(todos).toEqual(['v2', 'v1', 'p1', 'e1', 'e2', 'e3']);
    });

    it('marca como no atendido solo lo pendiente cuya fecha ya pasó', async () => {
      const r = await lista({ pageSize: 10 });
      const banderas = Object.fromEntries(r.data.map((m: any) => [Object.entries(man).find(([, id]) => id === m.id)![0], m.noAtendido]));
      expect(banderas).toEqual({ v1: true, v2: true, p1: false, e1: false, e2: false, e3: false });
    });

    it('el resumen cuenta vencidos, pendientes y ejecutados', async () => {
      const r = await lista({ incluirResumen: true, pageSize: 10 });
      expect(r.resumen).toEqual({ vencidos: 2, pendientes: 1, ejecutados: 3, total: 6 });
    });

    it('solo no atendidos agrega la condición de vencido a todas las consultas', async () => {
      const r = await lista({ soloNoAtendidos: true, pageSize: 10, incluirResumen: true });
      expect(claves(r, man).sort()).toEqual(['v1', 'v2']);
      expect(r.total).toBe(2);
    });

    it('ordena por una columna permitida y rechaza las demás', async () => {
      const tecnicoNuevo = await env.usuario('t-zeta', 'TECNICO', { regionId: r1.id, name: 'zeta' });
      const unico = await env.prisma.mantenimientoMaquinaria.create({
        data: { maquinariaId: (await env.prisma.maquinaria.findFirstOrThrow({ where: { codigo: `${env.marca}-M-M1` } })).id, tecnicoId: tecnicoNuevo.id, estado: 'PENDIENTE', fechaProgramada: new Date(Date.now() + 9 * DIA) },
      });
      const asc = await lista({ sortField: 'tecnico', sortOrder: 'asc', pageSize: 10 });
      expect(asc.data[asc.data.length - 1].id).toBe(unico.id); // técnico "zeta" va al final en ascendente
      const hostil = await lista({ sortField: 'costoTotal', pageSize: 10 });
      expect(hostil.total).toBe(7); // no falla: se ignora la columna y quedan los grupos
    });
  });
});
