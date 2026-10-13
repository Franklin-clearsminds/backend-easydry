import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgenciasService } from '../../modules/agencias/agencias.service.js';
import { MaquinariaService } from '../../modules/maquinaria/maquinaria.service.js';
import { ListMaquinariaDto } from '../../modules/maquinaria/dto/maquinaria.dto.js';
import { ListAgenciasDto } from '../../modules/agencias/dto/agencias.dto.js';
import { ListOperadoresDto } from '../../modules/agencias/dto/usuarios-agencia.dto.js';
import { ListHistorialAsignacionesDto } from '../../modules/agencias/dto/bahias.dto.js';
import { normalizarRol } from '../permisos/alias-roles.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Mundo de la prueba, todo creado aquí:
 *
 *  Región NORTE ── Agencia A1 (cliente ACME): bahías 01, 02, 03 · Gina (APROBADOR) · Lucas (LIDER)
 *  │                                           Pedro y Luis (LAVADOR) · máquinas M1…M5
 *  └─ Agencia A2: bahía 01 · Ana (LAVADOR)
 *  Región SUR ──── Agencia A3 (sin bahías)
 *
 * Los listados son de toda la red (la base real tiene cientos de filas), así que cada consulta se acota con un filtro
 * del mundo de la prueba (agencia, región, nombre o marca).
 */
describe('listados paginados de la fase 8 (base real)', () => {
  let env: Entorno;
  let agencias: AgenciasService;
  let maquinaria: MaquinariaService;
  let norte: any;
  let sur: any;
  let acme: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let b1: any;
  let b2: any;
  let b3: any;
  let b4: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  const maq: any[] = [];

  /** El `Actor` que usa maquinaria (lo arma el controlador desde el usuario autenticado). */
  const actorMaquinaria = (a: any) => ({ id: a.id, rol: normalizarRol(a.role.namerol), regionId: a.regionId ?? null, agenciaId: a.agenciaId ?? null });

  beforeAll(async () => {
    env = await abrirEntorno();
    agencias = new AgenciasService(env.prisma as never);
    maquinaria = new MaquinariaService(env.prisma as never, env.storage(), env.notificaciones());

    norte = await env.region('NORTE');
    sur = await env.region('SUR');
    acme = await env.cliente('ACME');
    a1 = await env.agencia('A1', { regionId: norte.id, clienteId: acme.id });
    a2 = await env.agencia('A2', { regionId: norte.id });
    a3 = await env.agencia('A3', { regionId: sur.id });
    await env.prisma.agencia.update({ where: { id: a2.id }, data: { estado: 2 } }); // en mantenimiento
    b1 = await env.bahia('01', a1.id);
    b2 = await env.bahia('02', a1.id);
    b3 = await env.bahia('03', a1.id);
    b4 = await env.bahia('04', a2.id);

    const crear = async (clave: string, rol: string, opts: Record<string, unknown>) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('gina', 'APROBADOR', { agenciaId: a1.id, name: 'Gina', lastname: 'Paz' });
    await crear('lucas', 'LIDER', { agenciaId: a1.id, name: 'Lucas', lastname: 'Rey' });
    await crear('pedro', 'LAVADOR', { agenciaId: a1.id, name: 'Pedro', lastname: 'Ruiz' });
    await crear('luis', 'LAVADOR', { agenciaId: a1.id, name: 'Luis', lastname: 'Soto' });
    await crear('ana', 'LAVADOR', { agenciaId: a2.id, name: 'Ana', lastname: 'Lopez' });
    await crear('pulidor', 'PULIDOR', { agenciaId: a1.id, name: 'Pablo', lastname: 'Pulido' });
    await crear('admin', 'ADMIN', { name: 'Adela' });
    await crear('sinAcceso', 'LAVADOR', { agenciaId: a1.id });

    // Máquinas M1…M5 en A1 (M5 en A2), con un estado y una serie propios para filtrar.
    for (const [i, agenciaId] of [a1.id, a1.id, a1.id, a1.id, a2.id].entries()) {
      maq.push(await env.maquinaria(`M${i + 1}`, { agenciaId }));
    }
    await env.prisma.maquinaria.update({ where: { id: maq[0].id }, data: { bahiaId: b1.id, serie: `${env.marca}-serie-ab` } });
    await env.prisma.maquinaria.update({ where: { id: maq[1].id }, data: { operadorAsignadoId: ids.pulidor } });
    await env.prisma.maquinaria.update({ where: { id: maq[2].id }, data: { estadoOperativo: 'EN_MANTENIMIENTO' } });

    // M1: 3 incidentes abiertos sin técnico. M2: 1 mantenimiento pendiente ya vencido.
    for (let i = 0; i < 3; i++) {
      await env.prisma.incidenteTecnico.create({
        data: { maquinariaId: maq[0].id, reportadoPorId: ids.lucas, titulo: `${env.marca} falla ${i}`, descripcion: 'prueba', estado: 'ABIERTO' },
      });
    }
    await env.prisma.mantenimientoMaquinaria.create({
      data: { maquinariaId: maq[1].id, tecnicoId: ids.admin, estado: 'PENDIENTE', fechaProgramada: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    });

    // Servicios del mes en A1 (1 de 2 terminado → productividad 50) y asignaciones de bahía.
    const catalogo = await env.catalogo('LAVADO');
    await env.servicioLavado({ bahiaId: b1.id, operadorId: ids.pedro, catalogoId: catalogo.id, estado: 'FINALIZADO' });
    await env.servicioLavado({ bahiaId: b1.id, operadorId: ids.pedro, catalogoId: catalogo.id, estado: 'EN_ESPERA', horaSalida: null });
    // Pedro y Luis comparten la bahía 01; la columna legacy de la bahía apunta solo al último que llegó (Luis).
    await env.prisma.bahiaOperador.create({ data: { bahiaId: b1.id, operadorId: ids.pedro } });
    await env.prisma.bahiaOperador.create({ data: { bahiaId: b1.id, operadorId: ids.luis } });
    await env.prisma.bahia.update({ where: { id: b1.id }, data: { operadorActualId: ids.luis } });
    // Historial de asignaciones de bahía.
    await env.prisma.historialAsignacionBahia.create({ data: { bahiaId: b1.id, operadorId: ids.pedro, asignadoPorId: ids.admin } });
    await env.prisma.historialAsignacionBahia.create({ data: { bahiaId: b4.id, operadorId: ids.ana, asignadoPorId: ids.admin } });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const codigos = (filas: any[]) => filas.map((f) => String(f.codigo).replace(`${env.marca}-M-`, '')).sort();

  describe('maquinaria/list', () => {
    it('modo heredado: { success, total, data } con sus pendientes', async () => {
      const r: any = await maquinaria.list({ agenciaId: a1.id } as any, actorMaquinaria(actores.admin));
      expect(r).toMatchObject({ success: true, total: 4 });
      const por = (clave: string) => r.data.find((m: any) => m.id === maq[Number(clave) - 1].id);
      expect(por('1')).toMatchObject({ incidentesNoAtendidos: 3, mantenimientosVencidos: 0 });
      expect(por('2')).toMatchObject({ incidentesNoAtendidos: 0, mantenimientosVencidos: 1 });
      // Orden heredado: por código.
      expect(r.data.map((m: any) => m.codigo)).toEqual([...r.data.map((m: any) => m.codigo)].sort());
    });

    it('paginado: formato estándar con success, y los pendientes solo de las filas de la página', async () => {
      const r: any = await maquinaria.list({ page: 1, pageSize: 2, agenciaId: a1.id, sortField: 'codigo', sortOrder: 'asc' } as any, actorMaquinaria(actores.admin));
      expect(r).toMatchObject({ success: true, total: 4, page: 1, pageSize: 2, totalPages: 2 });
      expect(r.items).toBe(r.data);
      expect(codigos(r.items)).toEqual(['M1', 'M2']);
      expect(r.items[0].incidentesNoAtendidos).toBe(3);
      const p2: any = await maquinaria.list({ page: 2, pageSize: 2, agenciaId: a1.id, sortField: 'codigo', sortOrder: 'asc' } as any, actorMaquinaria(actores.admin));
      expect(codigos(p2.items)).toEqual(['M3', 'M4']);
    });

    it('filtra por región, cliente y estado, busca por serie y ordena solo por columnas permitidas', async () => {
      const admin = actorMaquinaria(actores.admin);
      const porRegion: any = await maquinaria.list({ page: 1, regionId: norte.id } as any, admin);
      expect(codigos(porRegion.items)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5']);
      const porCliente: any = await maquinaria.list({ page: 1, clienteId: acme.id } as any, admin);
      expect(codigos(porCliente.items)).toEqual(['M1', 'M2', 'M3', 'M4']); // M5 es de A2, sin cliente
      const porEstado: any = await maquinaria.list({ page: 1, regionId: norte.id, estadoOperativo: 'EN_MANTENIMIENTO' } as any, admin);
      expect(codigos(porEstado.items)).toEqual(['M3']);
      const porSerie: any = await maquinaria.list({ page: 1, regionId: norte.id, search: `${env.marca}-serie-ab` } as any, admin);
      expect(codigos(porSerie.items)).toEqual(['M1']);

      const porAgencia: any = await maquinaria.list({ page: 1, regionId: norte.id, sortField: 'agencia', sortOrder: 'desc' } as any, admin);
      expect(porAgencia.items.map((m: any) => m.agencia.id)[0]).toBe(a2.id); // A2 va después de A1 en orden descendente
      const porDefecto: any = await maquinaria.list({ page: 1, regionId: norte.id } as any, admin);
      const campoInvalido: any = await maquinaria.list({ page: 1, regionId: norte.id, sortField: 'fotoUrl; x' } as any, admin);
      expect(campoInvalido.items.map((m: any) => m.id)).toEqual(porDefecto.items.map((m: any) => m.id));
    });

    it('filtra por NOMBRE de agencia, bahía, región y cliente (lo que emite el filter-bar)', async () => {
      const admin = actorMaquinaria(actores.admin);
      const r: any = await maquinaria.list(
        { page: 1, agenciaNombre: a1.nombre, bahiaNombre: b1.nombre, regionNombre: norte.nombre, clienteNombre: acme.nombre } as any,
        admin,
      );
      expect(codigos(r.items)).toEqual(['M1']); // la única en esa bahía
    });

    it('un rol sin acceso sigue sin ver nada', async () => {
      const r: any = await maquinaria.list({ page: 1, agenciaId: a1.id } as any, { id: 'x', rol: 'DESCONOCIDO', regionId: null, agenciaId: null });
      expect(r.items).toEqual([]);
      expect(r.total).toBe(0);
    });

    it('el líder ve toda la maquinaria de su agencia; el pulidor, solo la que tiene asignada', async () => {
      const lider: any = await maquinaria.list({ page: 1 } as any, actorMaquinaria(actores.lucas));
      expect(codigos(lider.items)).toEqual(['M1', 'M2', 'M3', 'M4']);
      const pulidor: any = await maquinaria.list({ page: 1 } as any, actorMaquinaria(actores.pulidor));
      expect(codigos(pulidor.items)).toEqual(['M2']);
    });

    it('el DTO no fija page/pageSize y conserva los filtros nuevos', async () => {
      const dto: any = plainToInstance(ListMaquinariaDto, { regionId: 'r', clienteId: 'c' });
      expect(dto.page).toBeUndefined();
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({ regionId: 'r', clienteId: 'c' });
    });
  });

  describe('agencias/list', () => {
    const nombres = (filas: any[]) => filas.map((f) => f.nombre.replace(`${env.marca} `, ''));

    it('modo heredado: arreglo con productividad, gerente y líder', async () => {
      const r: any = await agencias.listAgencias({ search: env.marca } as any, actores.admin);
      expect(Array.isArray(r)).toBe(true);
      expect(nombres(r)).toEqual(['Agencia A1', 'Agencia A2', 'Agencia A3']); // orden heredado: por nombre
      expect(r[0]).toMatchObject({ productividad: 50, gerenteNombre: 'Gina Paz', liderOperadorNombre: 'Lucas Rey' });
      expect(r[1].productividad).toBe(0);
    });

    it('paginado: formato estándar y la productividad del mes de las agencias de la página', async () => {
      const r: any = await agencias.listAgencias({ page: 1, pageSize: 2, search: env.marca, sortField: 'nombre', sortOrder: 'asc' } as any, actores.admin);
      expect(r).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      expect(nombres(r.items)).toEqual(['Agencia A1', 'Agencia A2']);
      expect(r.items[0]).toMatchObject({ gerenteNombre: 'Gina Paz', productividad: 50 });
    });

    it('incluirProductividad: false omite la productividad (para usarla como selector)', async () => {
      const r: any = await agencias.listAgencias({ search: env.marca, incluirProductividad: false } as any, actores.admin);
      expect(r[0]).toMatchObject({ productividad: 0, gerenteNombre: 'Gina Paz' });
      const pagina: any = await agencias.listAgencias({ page: 1, search: env.marca, incluirProductividad: false } as any, actores.admin);
      expect(pagina.items.every((i: any) => i.productividad === 0)).toBe(true);
    });

    it('un rol de agencia local sigue viendo solo la suya, con búsqueda y filtros combinados', async () => {
      const r: any = await agencias.listAgencias({ page: 1, search: env.marca, estado: 1, regionId: norte.id } as any, actores.lucas);
      expect(nombres(r.items)).toEqual(['Agencia A1']);
      // Sin coincidencia con los filtros: nada, aunque sea su agencia.
      const otraRegion: any = await agencias.listAgencias({ page: 1, search: env.marca, regionId: sur.id } as any, actores.lucas);
      expect(otraRegion.items).toEqual([]);
    });

    it('filtra por región y cliente por nombre exacto y acepta el estado 2 (mantenimiento)', async () => {
      const porRegion: any = await agencias.listAgencias({ page: 1, regionNombre: norte.nombre } as any, actores.admin);
      expect(nombres(porRegion.items).sort()).toEqual(['Agencia A1', 'Agencia A2']);
      const porCliente: any = await agencias.listAgencias({ page: 1, clienteNombre: acme.nombre } as any, actores.admin);
      expect(nombres(porCliente.items)).toEqual(['Agencia A1']);
      const enMantenimiento: any = await agencias.listAgencias({ page: 1, regionNombre: norte.nombre, estado: 2 } as any, actores.admin);
      expect(nombres(enMantenimiento.items)).toEqual(['Agencia A2']);
    });

    it('ordena por cantidad de bahías y descarta columnas ajenas; el DTO no fija page', async () => {
      const r: any = await agencias.listAgencias({ page: 1, search: env.marca, sortField: 'bahias', sortOrder: 'desc' } as any, actores.admin);
      expect(nombres(r.items)).toEqual(['Agencia A1', 'Agencia A2', 'Agencia A3']); // 3, 1 y 0 bahías
      const ajena: any = await agencias.listAgencias({ page: 1, search: env.marca, sortField: 'servicioIds' } as any, actores.admin);
      expect(ajena.items).toHaveLength(3); // no falla: cae al orden por defecto
      expect(plainToInstance(ListAgenciasDto, {}).page).toBeUndefined();
    });
  });

  describe('agencias/operadores/list', () => {
    const nombresOp = (filas: any[]) => filas.map((f) => f.nombre).sort();

    it('modo heredado: arreglo con el nombre armado', async () => {
      const r: any = await agencias.listOperadores({ agenciaId: a1.id } as any, actores.admin);
      expect(Array.isArray(r)).toBe(true);
      expect(nombresOp(r)).toContain('Pedro Ruiz');
      expect(r.find((o: any) => o.id === ids.pedro)).toMatchObject({ id: ids.pedro, nombre: 'Pedro Ruiz' });
    });

    it('paginado: conserva el filtro por agencia (id o nombre) junto con la búsqueda', async () => {
      const r: any = await agencias.listOperadores({ page: 1, pageSize: 10, agenciaId: a1.nombre, search: 'ped' } as any, actores.admin);
      expect(r).toMatchObject({ total: 1, page: 1, pageSize: 10, totalPages: 1 });
      expect(r.items[0].nombre).toBe('Pedro Ruiz');
    });

    it('filtra por bahía asignada, cliente de la agencia y estado (pantalla de operadores)', async () => {
      const r: any = await agencias.listOperadores({ page: 1, bahiaNombre: b1.nombre, clienteNombre: acme.nombre, estado: 1 } as any, actores.admin);
      expect(nombresOp(r.items)).toEqual(['Luis Soto', 'Pedro Ruiz']);
    });

    it('la bahía de un operador sale de BahiaOperador (activo), no del campo legacy que se pisa al agregar un segundo lavador', async () => {
      // Bug real: al asignar un segundo lavador a una bahía con maxLavadoresPorBahia > 1, `Bahia.operadorActualId`
      // pasa al recién llegado. Si se leyera ese campo, el PRIMER lavador aparecería como "Sin asignar" aunque su fila
      // en BahiaOperador siga activa. Aquí Pedro llegó primero y el campo legacy apunta a Luis.
      const r: any = await agencias.listOperadores({ page: 1, agenciaId: a1.id, search: 'ruiz' } as any, actores.admin);
      expect(r.items[0]).toMatchObject({ nombre: 'Pedro Ruiz', bahiaId: b1.id, bahia: b1.nombre });
    });

    it('un líder queda limitado a su agencia aunque pida otra', async () => {
      const r: any = await agencias.listOperadores({ page: 1, agenciaId: a2.id } as any, actores.lucas);
      expect(r.items.map((o: any) => o.nombre)).not.toContain('Ana Lopez');
      expect(r.items.map((o: any) => o.nombre)).toContain('Pedro Ruiz'); // ve a los de su agencia
    });

    it('el DTO no fija page/pageSize', () => {
      expect(plainToInstance(ListOperadoresDto, {}).page).toBeUndefined();
    });
  });

  describe('agencias/bahias/historial-asignaciones', () => {
    it('sin usuario no se ve ningún historial (cerrado por defecto)', async () => {
      const r: any = await agencias.obtenerHistorialAsignaciones({ bahiaId: b1.id } as any);
      expect(r.items).toEqual([]);
    });

    it('50 por defecto, máximo 100 (antes sin máximo) y formato compatible (data + items)', async () => {
      const r: any = await agencias.obtenerHistorialAsignaciones({} as any, actores.admin);
      expect(r).toMatchObject({ page: 1, pageSize: 50 });
      expect(r.data).toBe(r.items);
      const grande: any = await agencias.obtenerHistorialAsignaciones({ pageSize: 5000, page: 2 } as any, actores.admin);
      expect(grande).toMatchObject({ page: 2, pageSize: 100 });
    });

    it('filtra por bahía y operador, busca y ordena solo por columnas permitidas (más reciente primero)', async () => {
      const porBahia: any = await agencias.obtenerHistorialAsignaciones({ bahiaId: b1.id } as any, actores.admin);
      expect(porBahia.items.map((h: any) => h.operador.id)).toEqual([ids.pedro]);
      const porOperador: any = await agencias.obtenerHistorialAsignaciones({ operadorId: ids.ana } as any, actores.admin);
      expect(porOperador.items.map((h: any) => h.bahia.id)).toEqual([b4.id]);
      // El texto se busca por palabras sueltas, cada una en bahía u operador: la marca (de la bahía) y "ana" (del operador).
      const porTexto: any = await agencias.obtenerHistorialAsignaciones({ search: `${env.marca} ana` } as any, actores.admin);
      expect(porTexto.items.map((h: any) => h.operador.id)).toEqual([ids.ana]);
      const porNombre: any = await agencias.obtenerHistorialAsignaciones({ search: 'ana lopez', bahiaId: b4.id } as any, actores.admin);
      expect(porNombre.items.map((h: any) => h.operador.id)).toEqual([ids.ana]);

      const porBahiaAsc: any = await agencias.obtenerHistorialAsignaciones({ search: env.marca, sortField: 'bahia', sortOrder: 'asc' } as any, actores.admin);
      expect(porBahiaAsc.items.map((h: any) => h.bahia.id)).toEqual([b1.id, b4.id]); // códigos …-B-01 antes que …-B-04
      const campoInvalido: any = await agencias.obtenerHistorialAsignaciones({ search: env.marca, sortField: 'password' } as any, actores.admin);
      const porDefecto: any = await agencias.obtenerHistorialAsignaciones({ search: env.marca } as any, actores.admin);
      expect(campoInvalido.items.map((h: any) => h.id)).toEqual(porDefecto.items.map((h: any) => h.id));
    });

    it('el DTO acepta page/pageSize numéricos', async () => {
      const dto: any = plainToInstance(ListHistorialAsignacionesDto, { page: '2', pageSize: '30', bahiaId: 'b' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({ page: 2, pageSize: 30 });
    });
  });
});
