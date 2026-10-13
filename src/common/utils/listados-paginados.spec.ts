import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { hoyEcuador } from '../../modules/retos/retos.reglas.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): los seis listados que comparten el patrón "arreglo heredado / página".
 * Cada listado tiene tres filas propias con un orden conocido; todas las consultas se acotan con `search: marca`
 * porque las tablas reales tienen muchas más filas. Cada caso declara el orden que debe verse en cada modo.
 */
const DIA = 24 * 60 * 60 * 1000;
const fecha = (dias: number) => new Date(hoyEcuador().getTime() + dias * DIA);

interface Caso {
  nombre: string;
  dto: new () => object;
  /** Columna pública por la que se puede ordenar y las filas en el orden que debe dar (ascendente). */
  columna: string;
  /** Orden de siempre (modo heredado) y orden por la columna, como ids. */
  heredado: () => string[];
  porColumna: () => string[];
  llamar: (dto: Record<string, unknown>) => Promise<any>;
}

describe('listados paginados (base real)', () => {
  let env: Entorno;
  let agencias: AgenciasService;
  let retosSvc: RetosService;
  let rolesSvc: RolesService;
  let catalogoSvc: CatalogosService;
  let admin: any;
  let ids: Record<string, string[]>;
  const ctxAdmin = { namerol: 'ADMIN' };

  const clave = (s: string) => `${env.marca} ${s}`;
  const idsDe = (r: any) => (Array.isArray(r) ? r : r.items).map((f: any) => f.id);

  beforeAll(async () => {
    env = await abrirEntorno();
    agencias = new AgenciasService(env.prisma as never);
    retosSvc = new RetosService(env.prisma as never);
    rolesSvc = new RolesService(env.prisma as never, env.notificaciones());
    catalogoSvc = new CatalogosService(env.prisma as never);
    admin = await env.actor((await env.usuario('admin', 'ADMIN')).id);
    ids = {};

    // Regiones A, B, C con 2, 0 y 1 agencias (y un supervisor en A).
    const [rA, rB, rC] = [await env.region('A'), await env.region('B'), await env.region('C')];
    ids.regiones = [rA.id, rB.id, rC.id];
    await env.agencia('RA1', { regionId: rA.id });
    await env.agencia('RA2', { regionId: rA.id });
    await env.agencia('RC1', { regionId: rC.id });
    await env.usuario('sup-a', 'SUPERVISOR', { regionId: rA.id, name: 'Ana', lastname: 'Paz' });

    // Clientes A, B, C.
    ids.clientes = [(await env.cliente('A')).id, (await env.cliente('B')).id, (await env.cliente('C')).id];

    // Bahías x1, x2, x3 en agencias TRES, UNO y DOS (nombres de agencia con palabras únicas).
    const [agUno, agDos, agTres] = [await env.agencia('UNO'), await env.agencia('DOS'), await env.agencia('TRES')];
    const [bx1, bx2, bx3] = [await env.bahia('x1', agTres.id), await env.bahia('x2', agUno.id), await env.bahia('x3', agDos.id)];
    ids.bahias = [bx1.id, bx2.id, bx3.id];
    ids.agencias = [agUno.id, agDos.id, agTres.id];

    // Retos a, b y c con fechas de inicio hace 5, 1 y 3 días (el más reciente primero: b, c, a).
    const crearReto = async (t: string, dias: number) => {
      const r = await env.prisma.reto.create({ data: { titulo: clave(t), fechaInicio: fecha(-dias), fechaFin: fecha(20) } as never });
      env.rastrear('Reto', r.id);
      return r.id;
    };
    ids.retos = [await crearReto('a', 5), await crearReto('b', 1), await crearReto('c', 3)];

    // Roles propios R1, R2, R3 con 2, 0 y 1 usuarios.
    const rol = async (s: string) => {
      const r = await env.prisma.role.create({ data: { namerol: `${env.marca}_${s}`.toUpperCase(), esSistema: false, capacidades: [] } });
      env.rastrear('Role', r.id);
      return r;
    };
    const [ro1, ro2, ro3] = [await rol('R1'), await rol('R2'), await rol('R3')];
    ids.roles = [ro1.id, ro2.id, ro3.id];
    await env.usuario('r1a', ro1.namerol);
    await env.usuario('r1b', ro1.namerol);
    await env.usuario('r3a', ro3.namerol);

    // Servicios S1, S2, S3 con precios 30, 10 y 20.
    ids.catalogo = [
      String((await env.catalogo('S1', { precio: 30 })).id),
      String((await env.catalogo('S2', { precio: 10 })).id),
      String((await env.catalogo('S3', { precio: 20 })).id),
    ];
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const casos = (): Caso[] => [
    {
      nombre: 'regiones',
      dto: ListRegionesDto,
      columna: 'agencias',
      heredado: () => ids.regiones, // A, B, C por nombre
      porColumna: () => [ids.regiones[1], ids.regiones[2], ids.regiones[0]], // 0, 1 y 2 agencias: B, C, A
      llamar: (d) => agencias.listRegiones(d as any),
    },
    {
      nombre: 'clientes',
      dto: ListClientesDto,
      columna: 'nombre',
      heredado: () => ids.clientes,
      porColumna: () => ids.clientes,
      llamar: (d) => agencias.listClientes(d as any),
    },
    {
      nombre: 'bahías',
      dto: ListBahiasDto,
      columna: 'agencia',
      heredado: () => ids.bahias, // por código: x1, x2, x3
      porColumna: () => [ids.bahias[2], ids.bahias[0], ids.bahias[1]], // por nombre de agencia, alfabético: DOS (x3), TRES (x1), UNO (x2)
      llamar: (d) => agencias.listBahias(d as any, admin),
    },
    {
      nombre: 'retos',
      dto: ListRetosDto,
      columna: 'titulo',
      heredado: () => [ids.retos[1], ids.retos[2], ids.retos[0]], // inicio más reciente primero: b, c, a
      porColumna: () => ids.retos,
      llamar: (d) => retosSvc.list(d as any, admin),
    },
    {
      nombre: 'roles',
      dto: QueryRolesDto,
      columna: 'usuarios',
      heredado: () => ids.roles,
      porColumna: () => [ids.roles[1], ids.roles[2], ids.roles[0]], // 0, 1 y 2 usuarios
      llamar: (d) => rolesSvc.findAll(d as any),
    },
    {
      nombre: 'catálogo de servicios',
      dto: ListCatalogoServiciosDto,
      columna: 'precio',
      heredado: () => ids.catalogo,
      porColumna: () => [ids.catalogo[1], ids.catalogo[2], ids.catalogo[0]], // 10, 20 y 30
      llamar: (d) => catalogoSvc.listServicios(d as any, ctxAdmin),
    },
  ];

  const esperadoPorColumna = (c: Caso) => c.porColumna().map(String);
  const normalizar = (r: any) => idsDe(r).map(String);
  const listar = async (c: Caso, dto: Record<string, unknown>) => {
    const r = await c.llamar({ search: env.marca, ...dto });
    return r;
  };

  for (const nombre of ['regiones', 'clientes', 'bahías', 'retos', 'roles', 'catálogo de servicios']) {
    describe(`listado paginado de ${nombre}`, () => {
      const caso = () => casos().find((c) => c.nombre === nombre)!;

      it('modo heredado: arreglo con el orden de siempre', async () => {
        const c = caso();
        const r = await listar(c, {});
        // Algunos listados devuelven el arreglo dentro de una propiedad (catálogo: `servicios`).
        const filas = Array.isArray(r) ? r : (r.servicios ?? r.items);
        expect(Array.isArray(filas)).toBe(true);
        expect(filas.map((f: any) => String(f.id))).toEqual(c.heredado().map(String));
      });

      it('modo paginado: formato estándar, recorta a 100 y reparte las filas en páginas', async () => {
        const c = caso();
        const p2: any = await listar(c, { page: 2, pageSize: 2, sortField: c.columna, sortOrder: 'asc' });
        expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 2, totalPages: 2, hasNextPage: false, hasPrevPage: true });
        expect(p2.items).toHaveLength(1);
        const grande: any = await listar(c, { page: 1, pageSize: 500 });
        expect(grande.pageSize).toBe(100);
      });

      it('ordena solo por columnas permitidas', async () => {
        const c = caso();
        const r = await listar(c, { page: 1, sortField: c.columna, sortOrder: 'asc' });
        expect(normalizar(r)).toEqual(esperadoPorColumna(c));
        // Una columna que no está permitida no rompe ni se usa: cae al orden por defecto.
        const hostil = await listar(c, { page: 1, sortField: 'password; DROP', sortOrder: 'asc' });
        expect(normalizar(hostil).sort()).toEqual([...esperadoPorColumna(c)].sort());
      });

      it('el total usa los mismos filtros y una búsqueda de una letra se ignora', async () => {
        const c = caso();
        const filtrado: any = await listar(c, { page: 1 });
        expect(filtrado.total).toBe(3);
        expect(filtrado.items).toHaveLength(3);
        const ninguno: any = await listar(c, { page: 1, search: `${env.marca} zzqq` });
        expect(ninguno).toMatchObject({ total: 0 });
        expect(ninguno.items).toEqual([]);
        // Una búsqueda de una sola letra no filtra nada: da lo mismo que no buscar.
        await env.reintentar(async () => {
          const sinBusqueda: any = await c.llamar({ page: 1 });
          const unaLetra: any = await c.llamar({ page: 1, search: 'x' });
          expect(unaLetra.total).toBe(sinBusqueda.total);
        });
      });

      it('el DTO no fija page/pageSize y valida', async () => {
        const dtoClase = caso().dto;
        const vacio: any = plainToInstance(dtoClase, {});
        expect(vacio.page).toBeUndefined();
        expect(vacio.pageSize).toBeUndefined();
        expect(await validate(vacio)).toHaveLength(0);
        expect(await validate(plainToInstance(dtoClase, { page: '2', pageSize: 200, sortField: 'nombre', sortOrder: 'asc', search: 'ab' }))).toHaveLength(0);
      });
    });
  }

  describe('particularidades', () => {
    it('regiones: conserva el responsable (supervisor) en cada fila, con o sin página', async () => {
      const heredado: any = await agencias.listRegiones({ search: env.marca } as any);
      expect(heredado.find((r: any) => r.id === ids.regiones[0])).toMatchObject({ responsable: 'Ana Paz' });
      const pagina: any = await agencias.listRegiones({ page: 1, search: env.marca } as any);
      expect(pagina.items.find((r: any) => r.id === ids.regiones[0])).toMatchObject({ responsable: 'Ana Paz' });
    });

    it('regiones: conserva el filtro de estado', async () => {
      const inactiva = await env.region('INACTIVA');
      await env.prisma.region.update({ where: { id: inactiva.id }, data: { estado: 0 } });
      const r: any = await agencias.listRegiones({ estado: 0, page: 1, search: env.marca } as any);
      expect(r.items.map((x: any) => x.id)).toEqual([inactiva.id]);
    });

    it('bahías: conserva los filtros de agencia y estado, y busca también por agencia', async () => {
      const inactiva = await env.bahia('x4', ids.agencias[0], { activa: false }); // en la agencia UNO, pero inactiva
      const porAgenciaYEstado: any = await agencias.listBahias({ agenciaId: ids.agencias[0], activa: true, search: env.marca } as any, admin);
      expect(porAgenciaYEstado.map((b: any) => b.id)).toEqual([ids.bahias[1]]); // x2 (activa), no x4
      expect(porAgenciaYEstado.map((b: any) => b.id)).not.toContain(inactiva.id);
      const porNombreDeAgencia: any = await agencias.listBahias({ search: `${env.marca} dos` } as any, admin);
      expect(porNombreDeAgencia.map((b: any) => b.id)).toEqual([ids.bahias[2]]); // x3 está en la agencia DOS
    });

    it('retos: un rol no administrador conserva su regla de visibilidad junto con la búsqueda', async () => {
      const lavador = await env.actor((await env.usuario('lavador', 'LAVADOR', { agenciaId: ids.agencias[0] })).id);
      const suyo = await env.prisma.reto.create({
        data: { titulo: clave('verano suyo'), fechaInicio: fecha(-2), fechaFin: fecha(20), sucursalesIds: [ids.agencias[0]] } as never,
      });
      const ajeno = await env.prisma.reto.create({
        data: { titulo: clave('verano ajeno'), fechaInicio: fecha(-2), fechaFin: fecha(20), sucursalesIds: [ids.agencias[1]] } as never,
      });
      const cerrado = await env.prisma.reto.create({
        data: { titulo: clave('verano cerrado'), fechaInicio: fecha(-2), fechaFin: fecha(20), sucursalesIds: [ids.agencias[0]], estado: 'FINALIZADO' } as never,
      });
      for (const r of [suyo, ajeno, cerrado]) env.rastrear('Reto', r.id);

      const r: any = await retosSvc.list({ page: 1, search: clave('verano') } as any, lavador);
      // Por defecto solo los ACTIVOS, y solo el de su agencia.
      expect(r.items.map((x: any) => x.id)).toEqual([suyo.id]);
    });

    it('roles: nunca lista SUPER_ADMIN y conserva los campos calculados', async () => {
      const todos: any = await rolesSvc.findAll({ page: 1, pageSize: 100, estado: 1 } as any);
      expect(todos.items.map((r: any) => r.namerol)).not.toContain('SUPER_ADMIN');
      const mios: any = await rolesSvc.findAll({ page: 1, search: env.marca } as any);
      expect(mios.items.find((r: any) => r.id === ids.roles[0])).toMatchObject({ usuariosCount: 2 });
    });

    it('catálogo de servicios: un rol acotado sigue recibiendo su agencia, en ambos modos', async () => {
      const sede = await env.agencia('SEDE-CATALOGO');
      const [s1, s2] = ids.catalogo;
      await env.prisma.agencia.update({
        where: { id: sede.id },
        data: { servicioIds: [Number(s1), Number(s2)], tieneServiciosEspeciales: false },
      });
      const ctx = { agenciaId: sede.id, namerol: 'LIDER' };
      const heredado: any = await catalogoSvc.listServicios({ search: env.marca } as any, ctx);
      expect(heredado.agencia).toMatchObject({ tieneServiciosEspeciales: false, servicioIds: [Number(s1), Number(s2)] });
      expect(heredado.servicios.map((s: any) => String(s.id)).sort()).toEqual([s1, s2].sort());
      const pagina: any = await catalogoSvc.listServicios({ page: 1, search: env.marca } as any, ctx);
      expect(pagina.agencia).toBeDefined();
      expect(pagina.items.map((s: any) => String(s.id)).sort()).toEqual([s1, s2].sort());
    });

    it('catálogo de servicios: un administrador sin agencia recibe el arreglo plano de siempre', async () => {
      const r = await catalogoSvc.listServicios({ search: env.marca } as any, ctxAdmin);
      expect(Array.isArray(r)).toBe(true);
    });
  });
});
