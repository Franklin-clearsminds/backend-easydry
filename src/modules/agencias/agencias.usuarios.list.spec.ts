import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgenciasService } from './agencias.service.js';
import { ListUsuariosAgenciaDto } from './dto/usuarios-agencia.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/** El líder de fábrica ya ve cédula, correo y teléfono (viene con «Ver lavadores completo»): para probar el caso «sin la casilla» se le quitan. */
const sinDatosPersonales = (actor: any) => ({
  ...actor,
  roleDetails: { ...actor.roleDetails, capacidades: actor.roleDetails.capacidades.filter((c: string) => c !== 'datos.contacto.ver' && c !== 'datos.cedula.ver') },
});

/**
 * Integración con la base real (sin mocks). Datos de partida, todos creados por esta prueba:
 *
 *  Región A ── Agencia A1 (cliente X): Ana (LIDER), Beto (APROBADOR), Carla (PULIDOR), Juan Quito (LAVADOR),
 *  │                                   Zoe (LAVADOR inactiva), Aaron (SUPER_ADMIN, nunca se lista)
 *  │        └─ Agencia A2:            Luis (LAVADOR)
 *  │        └─ Supervisor A (SUPERVISOR con regionId A, sin agencia)
 *  Región B ── Agencia B1:            Bruno (LAVADOR)  +  Supervisor B
 *  Sin sede:   Admin (ADMIN), Líder sin agencia (LIDER)
 */
const dto = (obj: Record<string, unknown>) => plainToInstance(ListUsuariosAgenciaDto, obj) as ListUsuariosAgenciaDto;

describe('AgenciasService.listUsuariosPorAgencia (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let regionA: { id: string };
  let regionB: { id: string };
  let clienteX: { id: string };
  let a1: { id: string };
  let a2: { id: string };
  let b1: { id: string };
  let ids: Record<string, string> = {};
  let admin: any;
  let liderA1: any;
  let liderSinSede: any;
  let supervisorA: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);

    regionA = await env.region('A');
    regionB = await env.region('B');
    clienteX = await env.cliente('X');
    a1 = await env.agencia('A1', { regionId: regionA.id, clienteId: clienteX.id });
    a2 = await env.agencia('A2', { regionId: regionA.id });
    b1 = await env.agencia('B1', { regionId: regionB.id });

    const crear = async (clave: string, rol: string, name: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, { name, lastname: 'Prueba', ...opts });
      ids[clave] = u.id;
      return u;
    };
    await crear('ana', 'LIDER', 'Ana', { agenciaId: a1.id });
    await crear('beto', 'APROBADOR', 'Beto', { agenciaId: a1.id });
    await crear('carla', 'PULIDOR', 'Carla', { agenciaId: a1.id });
    await crear('juan', 'LAVADOR', 'Juan', { agenciaId: a1.id, lastname: 'Quito' });
    await crear('zoe', 'LAVADOR', 'Zoe', { agenciaId: a1.id, estado: 0 });
    await crear('aaron', 'SUPER_ADMIN', 'Aaron', { agenciaId: a1.id });
    await crear('luis', 'LAVADOR', 'Luis', { agenciaId: a2.id });
    await crear('bruno', 'LAVADOR', 'Bruno', { agenciaId: b1.id });
    await crear('supA', 'SUPERVISOR', 'Sara', { regionId: regionA.id });
    await crear('supB', 'SUPERVISOR', 'Saul', { regionId: regionB.id });
    await crear('admin', 'ADMIN', 'Adela');
    await crear('sinSede', 'LIDER', 'Lola');

    admin = await env.actor(ids.admin);
    liderA1 = await env.actor(ids.ana);
    liderSinSede = await env.actor(ids.sinSede);
    supervisorA = await env.actor(ids.supA);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const idsDe = (filas: any[]) => filas.map((f) => f.id);
  const claves = (filas: any[]) => {
    const inverso = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    return filas.map((f) => inverso[f.id]);
  };

  describe('modo heredado (sin page ni pageSize)', () => {
    it('devuelve el arreglo plano completo ordenado por nombre, sin SUPER_ADMIN', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ agenciaId: a1.id }), admin);
      expect(Array.isArray(r)).toBe(true);
      expect(claves(r)).toEqual(['ana', 'beto', 'carla', 'juan', 'zoe']);
    });

    it('conserva los filtros heredados agencia, rol y estado', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ agenciaId: a1.id, rolNombre: 'LAVADOR', estado: 1 }), admin);
      expect(claves(r)).toEqual(['juan']);
      const inactivos: any = await service.listUsuariosPorAgencia(dto({ agenciaId: a1.id, estado: 0 }), admin);
      expect(claves(inactivos)).toEqual(['zoe']);
    });

    it('pedir SUPER_ADMIN devuelve una lista vacía', async () => {
      expect(await service.listUsuariosPorAgencia(dto({ rolNombre: 'super_admin', agenciaId: a1.id }), admin)).toEqual([]);
    });

    it('el DTO no fija page ni pageSize y acepta el cuerpo antiguo vacío', async () => {
      const d = dto({});
      expect(d.page).toBeUndefined();
      expect(d.pageSize).toBeUndefined();
      expect(d.sortField).toBeUndefined();
      expect(d.sortOrder).toBeUndefined();
      expect(await validate(d)).toHaveLength(0);
      expect(await validate(dto({ estado: 1, agenciaId: 'x' }))).toHaveLength(0);
      expect(await validate(dto({ pageSize: 200 }))).toHaveLength(0);
    });
  });

  describe('modo paginado', () => {
    it('devuelve el formato estándar, pagina de verdad y no incluye la contraseña', async () => {
      const p1: any = await service.listUsuariosPorAgencia(dto({ page: 1, pageSize: 2, agenciaId: a1.id, sortField: 'nombre', sortOrder: 'asc' }), admin);
      expect(p1).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3, hasNextPage: true, hasPrevPage: false });
      expect(p1.items).toBe(p1.data);
      expect(claves(p1.items)).toEqual(['ana', 'beto']);
      expect(JSON.stringify(p1.items)).not.toMatch(/passwordHash|password/i);

      const p3: any = await service.listUsuariosPorAgencia(dto({ page: 3, pageSize: 2, agenciaId: a1.id, sortField: 'nombre', sortOrder: 'asc' }), admin);
      expect(claves(p3.items)).toEqual(['zoe']);
      expect(p3).toMatchObject({ hasNextPage: false, hasPrevPage: true });
    });

    it('usa 25 por defecto y recorta pageSize a 100', async () => {
      const porDefecto: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id }), admin);
      expect(porDefecto.pageSize).toBe(25);
      const grande: any = await service.listUsuariosPorAgencia(dto({ pageSize: 200, agenciaId: a1.id }), admin);
      expect(grande.pageSize).toBe(100);
      expect(grande.total).toBe(5);
    });

    it('ordena por defecto por fecha de creación descendente', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id }), admin);
      const fechas = r.items.map((i: any) => new Date(i.createdAt).getTime());
      expect(fechas).toEqual([...fechas].sort((x, y) => y - x));
    });

    it('solo ordena por columnas permitidas', async () => {
      const porRol: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id, sortField: 'rol', sortOrder: 'asc' }), admin);
      const roles = porRol.items.map((i: any) => i.role.namerol);
      expect(roles).toEqual([...roles].sort());

      const porNombreDesc: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id, sortField: 'nombre', sortOrder: 'desc' }), admin);
      expect(claves(porNombreDesc.items)).toEqual(['zoe', 'juan', 'carla', 'beto', 'ana']);

      const porDefecto: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id }), admin);
      for (const campo of ['password; DROP TABLE', 'passwordHash']) {
        const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id, sortField: campo, sortOrder: 'asc' }), admin);
        expect(idsDe(r.items)).toEqual(idsDe(porDefecto.items)); // campo no permitido: cae al orden por defecto
      }
    });

    it('busca por palabras en nombre y apellido', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id, search: 'juan quito' }), admin);
      expect(claves(r.items)).toEqual(['juan']);
      const porCorreo: any = await service.listUsuariosPorAgencia(dto({ page: 1, search: `${env.marca}-zoe` }), admin);
      expect(claves(porCorreo.items)).toEqual(['zoe']);
    });

    it('una búsqueda de una sola letra se ignora', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id, search: 'a' }), admin);
      expect(r.total).toBe(5);
    });

    it('SUPER_ADMIN queda siempre excluido, incluso si lo piden por rol', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: a1.id, rolNombre: 'SUPER_ADMIN,APROBADOR' }), admin);
      expect(claves(r.items)).toEqual(['beto']);
    });

    it('aplica en el servidor agencia, región, cliente, estado y rol', async () => {
      const porRegion: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: regionA.id, sortField: 'nombre', sortOrder: 'asc' }), admin);
      expect(claves(porRegion.items)).toEqual(['ana', 'beto', 'carla', 'juan', 'luis', 'supA', 'zoe']);

      const porCliente: any = await service.listUsuariosPorAgencia(dto({ page: 1, clienteId: clienteX.id }), admin);
      expect(new Set(claves(porCliente.items))).toEqual(new Set(['ana', 'beto', 'carla', 'juan', 'zoe']));

      const porRolYEstado: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: regionA.id, rolNombre: 'LAVADOR', estado: 1 }), admin);
      expect(new Set(claves(porRolYEstado.items))).toEqual(new Set(['juan', 'luis']));
    });

    it('los segmentos rápidos filtran por estado y por rol', async () => {
      const inactivos: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: regionA.id, segmento: 'inactivos' }), admin);
      expect(claves(inactivos.items)).toEqual(['zoe']);
      const supervisores: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: regionA.id, segmento: 'supervisores' }), admin);
      expect(claves(supervisores.items)).toEqual(['supA']);
    });

    it('con incluirResumen cuenta cada segmento con los mismos filtros, sin el segmento', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: regionA.id, segmento: 'supervisores', incluirResumen: true }), admin);
      expect(claves(r.items)).toEqual(['supA']); // la página respeta el segmento...
      expect(r.resumen).toEqual({ total: 7, lavadores: 4, supervisores: 1, bodega: 0, admins: 0, inactivos: 1 }); // ...el resumen no
    });

    it('con solo pageSize se activa el modo paginado aunque no haya filtros', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ pageSize: 10 }), admin);
      expect(Array.isArray(r)).toBe(false);
      expect(r.pageSize).toBe(10);
    });
  });

  describe('alcance y datos de contacto', () => {
    it('cada rol solo lista usuarios de su alcance: agencia, región o ninguno', async () => {
      const lider: any = await service.listUsuariosPorAgencia(dto({}), liderA1);
      expect(new Set(claves(lider))).toEqual(new Set(['ana', 'beto', 'carla', 'juan', 'zoe']));

      const supervisor: any = await service.listUsuariosPorAgencia(dto({ page: 1 }), supervisorA);
      expect(new Set(claves(supervisor.items))).toEqual(new Set(['ana', 'beto', 'carla', 'juan', 'luis', 'supA', 'zoe']));

      expect(await service.listUsuariosPorAgencia(dto({}), liderSinSede)).toEqual([]);
    });

    it('pedir otra agencia no amplía el alcance del líder', async () => {
      expect(await service.listUsuariosPorAgencia(dto({ agenciaId: a2.id }), liderA1)).toEqual([]);
      const paginado: any = await service.listUsuariosPorAgencia(dto({ page: 1, agenciaId: b1.id }), liderA1);
      expect(paginado.items).toEqual([]);
      expect(paginado.total).toBe(0);
    });

    it('pedir otra región no amplía el alcance del supervisor', async () => {
      const r: any = await service.listUsuariosPorAgencia(dto({ page: 1, regionId: regionB.id }), supervisorA);
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
    });

    it('quien no es administrador no recibe correos; el administrador sí', async () => {
      const comoLider: any = await service.listUsuariosPorAgencia(dto({}), sinDatosPersonales(liderA1));
      expect(comoLider.length).toBeGreaterThan(0);
      expect(comoLider.every((u: any) => u.email === undefined)).toBe(true);

      const comoAdmin: any = await service.listUsuariosPorAgencia(dto({ agenciaId: a1.id }), admin);
      expect(comoAdmin.every((u: any) => typeof u.email === 'string' && u.email.includes(env.marca))).toBe(true);
    });
  });
});
