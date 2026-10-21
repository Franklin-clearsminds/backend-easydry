import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetosService } from './retos.service.js';
import { hoyEcuador } from './retos.reglas.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Mundo de la prueba, todo creado aquí:
 *
 *  Región COSTA ── Agencia A1 (Lía LIDER, Luis LAVADOR, Pedro LAVADOR, Paco PULIDOR fijo) · Agencia A2
 *  Región SIERRA ─ Agencia A3 (Sara LAVADOR)
 *  Pulidor móvil Ana (en COSTA, sin agencia) · Admin · Jefe comercial · Coordinador comercial de COSTA
 *
 * Las fechas son relativas a hoy (hora de Ecuador) para que la prueba no caduque. Los retos y servicios se
 * acotan siempre a las agencias/personas de este mundo, así los datos reales de la base no entran en el ranking.
 */
const DIA = 24 * 60 * 60 * 1000;
const fecha = (dias: number) => new Date(hoyEcuador().getTime() + dias * DIA).toISOString().slice(0, 10);
/** Un instante a mediodía de Ecuador, `dias` días desde hoy. */
const instante = (dias: number) => new Date(hoyEcuador().getTime() + dias * DIA + 17 * 60 * 60 * 1000);

describe('RetosService (base real)', () => {
  let env: Entorno;
  let service: RetosService;
  let costa: any;
  let sierra: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let bahiaA1: any;
  let general: any;
  let especial: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  let n = 0;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new RetosService(env.prisma as never, env.notificaciones());

    costa = await env.region('COSTA');
    sierra = await env.region('SIERRA');
    a1 = await env.agencia('A1', { regionId: costa.id });
    a2 = await env.agencia('A2', { regionId: costa.id });
    a3 = await env.agencia('A3', { regionId: sierra.id });
    bahiaA1 = await env.bahia('B1', a1.id);
    general = await env.catalogo('GENERAL1');
    especial = await env.catalogo('ESPECIAL1', { categoria: 'ESPECIAL' });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, { name: clave, ...opts });
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('lia', 'LIDER', { agenciaId: a1.id, regionId: costa.id });
    await crear('luis', 'LAVADOR', { agenciaId: a1.id });
    await crear('pedro', 'LAVADOR', { agenciaId: a1.id, lastname: 'Mora (CI: 1712345678)' });
    await crear('paco', 'PULIDOR', { agenciaId: a1.id });
    await crear('sara', 'LAVADOR', { agenciaId: a3.id });
    await crear('ana', 'PULIDOR', { regionId: costa.id });
    await crear('admin', 'ADMIN');
    await crear('jefe', 'JEFE_COMERCIAL');
    await crear('coord', 'COORD_COMERCIAL', { regionId: costa.id });
    await crear('coordSinRegion', 'COORD_COMERCIAL');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  /** Cuerpo de un reto con título único por llamada. */
  const dto = (extra: Record<string, unknown> = {}) =>
    ({ titulo: `${env.marca} reto ${++n}`, fechaInicio: fecha(-10), fechaFin: fecha(20), ...extra }) as any;
  const enBase = (id: string) => env.prisma.reto.findUniqueOrThrow({ where: { id } });
  /** Crea un reto por el servicio y lo deja registrado para borrarlo al cerrar. */
  const crearReto = async (extra: Record<string, unknown>, actor: any) => {
    const r: any = await service.create(dto(extra), actor);
    env.rastrear('Reto', r.id);
    return enBase(r.id);
  };
  /** Un reto escrito directo en la base (para probar ranking/cierre/listado sin pasar por la validación de create). */
  const retoDirecto = async (extra: Record<string, unknown> = {}) => {
    const r = await env.prisma.reto.create({
      data: {
        titulo: `${env.marca} directo ${++n}`,
        fechaInicio: new Date(fecha(-10)),
        fechaFin: new Date(fecha(20)),
        regiones: [costa.nombre],
        sucursalesIds: [a1.id, a2.id],
        creadoPorId: ids.coord,
        ...extra,
      } as never,
    });
    env.rastrear('Reto', r.id);
    return r;
  };
  const lavado = (agenciaBahia: string, operadorId: string, dias: number, extra: Record<string, unknown> = {}) =>
    env.servicioLavado({ bahiaId: agenciaBahia, operadorId, catalogoId: general.id, horaSalida: instante(dias), ...extra });

  describe('create', () => {
    it('administradores y jefe comercial crean retos nacionales o de cualquier región', async () => {
      for (const rol of ['admin', 'jefe']) {
        const r = await crearReto({ regiones: [costa.nombre, sierra.nombre] }, actores[rol]);
        expect(r.regiones).toEqual([costa.nombre, sierra.nombre]);
        expect(r.creadoPorId).toBe(ids[rol]);
      }
    });

    it('valores por defecto: agencias, todos los servicios, cantidad de servicios, gana el primero', async () => {
      const r = await crearReto({}, actores.admin);
      expect(r).toMatchObject({ tipoReto: 'AGENCIA', tipoServicios: 'TODOS', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 1, meta: null });
    });

    it('el coordinador comercial solo crea retos para su región', async () => {
      const ok = await crearReto({ regiones: [costa.nombre.toLowerCase()] }, actores.coord);
      expect(ok.titulo).toContain(env.marca);
      for (const regiones of [[sierra.nombre], [costa.nombre, sierra.nombre], [], ['Todas']]) {
        const d = dto({ regiones });
        await expect(service.create(d, actores.coord)).rejects.toThrow(/tu región/);
        expect(await env.prisma.reto.count({ where: { titulo: d.titulo } })).toBe(0);
      }
    });

    it('el coordinador solo elige agencias y personas de su región, y necesita tener región', async () => {
      await expect(service.create(dto({ regiones: [costa.nombre], sucursalesIds: [a3.id] }), actores.coord)).rejects.toThrow(/no pertenecen a tu región/);
      await expect(
        service.create(dto({ regiones: [costa.nombre], tipoReto: 'LAVADOR', lavadoresIds: [ids.sara] }), actores.coord),
      ).rejects.toThrow(/lavadores no pertenecen/);
      await expect(service.create(dto({ regiones: [costa.nombre] }), actores.coordSinRegion)).rejects.toThrow(/región asignada/);
      // Con agencias y personas de su región sí.
      const ok = await crearReto({ regiones: [costa.nombre], sucursalesIds: [a1.id] }, actores.coord);
      expect(ok.sucursalesIds).toEqual([a1.id]);
    });

    it('rechaza fechas al revés', async () => {
      await expect(service.create(dto({ fechaInicio: fecha(10), fechaFin: fecha(-10) }), actores.admin)).rejects.toThrow(/fecha de fin/);
    });

    it('los lavadores solo compiten con servicios generales y los pulidores con especiales', async () => {
      await expect(service.create(dto({ tipoReto: 'LAVADOR', tipoServicios: 'ESPECIALES' }), actores.admin)).rejects.toThrow(/generales/);
      await expect(service.create(dto({ tipoReto: 'PULIDOR', tipoServicios: 'TODOS' }), actores.admin)).rejects.toThrow(/especiales/);
      const r = await crearReto({ tipoReto: 'PULIDOR' }, actores.admin);
      expect(r).toMatchObject({ tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', pulidoresIds: [] });
    });

    it('servicios específicos: exige elegir y, para personas, que sean de su categoría', async () => {
      await expect(service.create(dto({ tipoServicios: 'ESPECIFICOS' }), actores.admin)).rejects.toThrow(/uno o varios servicios/);
      const r = await crearReto({ tipoReto: 'PULIDOR', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [especial.id] }, actores.admin);
      expect(r.catalogoServicioIds).toEqual([especial.id]);
      // Un servicio GENERAL no sirve para un reto de pulidores.
      const d = dto({ tipoReto: 'PULIDOR', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [general.id] });
      await expect(service.create(d, actores.admin)).rejects.toThrow();
      expect(await env.prisma.reto.count({ where: { titulo: d.titulo } })).toBe(0);
      // Sin "específicos" no se guardan servicios sueltos.
      const otro = await crearReto({ tipoServicios: 'TODOS', catalogoServicioIds: [general.id] }, actores.admin);
      expect(otro.catalogoServicioIds).toEqual([]);
    });

    it('meta: obligatoria con META, entera salvo para monto', async () => {
      await expect(service.create(dto({ modoGanador: 'META' }), actores.admin)).rejects.toThrow(/meta/);
      await expect(service.create(dto({ modoGanador: 'META', meta: 2.5 }), actores.admin)).rejects.toThrow(/entero/);
      const r = await crearReto({ modoGanador: 'META', metrica: 'MONTO', meta: 1500.5 }, actores.admin);
      expect(r).toMatchObject({ modoGanador: 'META', cantidadGanadores: 1 });
      expect(Number(r.meta)).toBe(1500.5);
    });

    it('las listas de personas solo se guardan para su tipo de reto', async () => {
      const r = await crearReto({ tipoReto: 'AGENCIA', pulidoresIds: [ids.paco], lavadoresIds: [ids.luis] }, actores.admin);
      expect(r).toMatchObject({ pulidoresIds: [], lavadoresIds: [] });
    });
  });

  describe('list', () => {
    let nacional: any;
    let deCosta: any;
    let deSierra: any;
    let deA1: any;
    let privadoPulidor: any;

    beforeAll(async () => {
      nacional = await retoDirecto({ titulo: `${env.marca} L nacional`, regiones: [], sucursalesIds: [] });
      deCosta = await retoDirecto({ titulo: `${env.marca} L costa`, regiones: [costa.nombre], sucursalesIds: [] });
      deSierra = await retoDirecto({ titulo: `${env.marca} L sierra`, regiones: [sierra.nombre], sucursalesIds: [] });
      deA1 = await retoDirecto({ titulo: `${env.marca} L a1`, regiones: [], sucursalesIds: [a1.id] });
      privadoPulidor = await retoDirecto({ titulo: `${env.marca} L privado`, regiones: [], sucursalesIds: [], tipoReto: 'PULIDOR', pulidoresIds: [ids.ana] });
    });

    const titulos = (r: any) => r.items.map((i: any) => i.titulo.replace(`${env.marca} `, '')).sort();

    it('administradores y jefe comercial ven todos', async () => {
      for (const rol of ['admin', 'jefe']) {
        const r: any = await service.list({ page: 1, pageSize: 50, search: `${env.marca} L `, incluirTodos: true } as any, actores[rol]);
        expect(titulos(r)).toEqual(['L a1', 'L costa', 'L nacional', 'L privado', 'L sierra']);
      }
    });

    it('el resto solo ve los de su región, su agencia o donde participa', async () => {
      const lider: any = await service.list({ page: 1, pageSize: 50, search: `${env.marca} L `, incluirTodos: true } as any, actores.lia);
      // Ve el de su agencia, el de su región y el nacional (sin regiones ni participantes); no el de Sierra ni el privado de pulidores.
      expect(titulos(lider)).toEqual(['L a1', 'L costa', 'L nacional']);

      const ana: any = await service.list({ page: 1, pageSize: 50, search: `${env.marca} L `, incluirTodos: true } as any, actores.ana);
      expect(titulos(ana)).toEqual(['L costa', 'L nacional', 'L privado']); // el privado, porque participa como pulidora
    });
  });

  describe('actualizar', () => {
    it('lo edita su creador o alguien con alcance nacional; nadie más', async () => {
      const mio = await retoDirecto({ creadoPorId: ids.coord });
      await expect(service.actualizar({ id: mio.id, titulo: '  Nuevo título ', premio: 'Cena' } as any, actores.coord)).resolves.toMatchObject({ titulo: 'Nuevo título', premio: 'Cena' });

      const ajeno = await retoDirecto({ creadoPorId: ids.lia });
      await expect(service.actualizar({ id: ajeno.id, titulo: 'X' } as any, actores.coord)).rejects.toThrow(/creador o alguien con alcance nacional/);
      await expect(service.actualizar({ id: ajeno.id, titulo: 'Corregido por admin' } as any, actores.admin)).resolves.toMatchObject({ titulo: 'Corregido por admin' });
    });

    it('no edita un reto cerrado ni deja la fecha fin antes del inicio o de hoy', async () => {
      const cerrado = await retoDirecto({ creadoPorId: ids.coord, estado: 'FINALIZADO' });
      await expect(service.actualizar({ id: cerrado.id, titulo: 'X' } as any, actores.coord)).rejects.toThrow(/reto activo/);

      const activo = await retoDirecto({ creadoPorId: ids.coord });
      await expect(service.actualizar({ id: activo.id, fechaInicio: '2030-02-01', fechaFin: '2030-01-01' } as any, actores.coord)).rejects.toThrow(/anterior a la fecha de inicio/);
      await expect(service.actualizar({ id: activo.id, fechaFin: '2000-01-01' } as any, actores.admin)).rejects.toThrow(/anterior/);
      await expect(service.actualizar({ id: activo.id, titulo: '   ' } as any, actores.coord)).rejects.toThrow(/título/);
    });
  });

  describe('delete', () => {
    it('lo elimina su creador o alguien con alcance nacional; nadie más', async () => {
      const mio = await retoDirecto({ creadoPorId: ids.coord });
      await expect(service.delete(mio.id, actores.coord)).resolves.toMatchObject({ success: true });
      expect(await env.prisma.reto.count({ where: { id: mio.id } })).toBe(0);

      for (const rol of ['admin', 'jefe']) {
        const r = await retoDirecto({ creadoPorId: ids.coord });
        await expect(service.delete(r.id, actores[rol])).resolves.toMatchObject({ success: true });
        expect(await env.prisma.reto.count({ where: { id: r.id } })).toBe(0);
      }

      const ajeno = await retoDirecto({ creadoPorId: ids.lia });
      await expect(service.delete(ajeno.id, actores.coord)).rejects.toThrow(/creador o alguien con alcance nacional/);
      expect(await env.prisma.reto.count({ where: { id: ajeno.id } })).toBe(1);
    });
  });

  describe('ranking', () => {
    it('agencias: suma generales y especiales, y desempata por quién llegó primero', async () => {
      const bahiaA2 = await env.bahia('B2', a2.id);
      const reto = await retoDirecto({});
      await lavado(bahiaA1.id, ids.luis, -5); // A1
      await lavado(bahiaA2.id, ids.luis, -7); // A2
      await env.servicioEspecial({ agenciaId: a2.id, operadorId: ids.paco, fechaFin: instante(-8) }); // A2
      await env.servicioEspecial({ agenciaId: a1.id, operadorId: ids.paco, fechaFin: instante(-6) }); // A1
      // Estos no cuentan: fuera de fechas, sin terminar y borrado.
      await lavado(bahiaA1.id, ids.luis, -40);
      await lavado(bahiaA1.id, ids.luis, -4, { estado: 'EN_PROCESO' });
      await lavado(bahiaA1.id, ids.luis, -4, { deletedAt: new Date() });

      const r: any = await service.ranking(reto.id, actores.admin);
      // Empatan en 2: A2 llegó al segundo servicio antes (-7 y -8) que A1 (-5 y -6).
      expect(r.participantes.map((p: any) => [p.nombre, p.valor, p.posicion, p.gana])).toEqual([
        [a2.nombre, 2, 1, true],
        [a1.nombre, 2, 2, false],
      ]);
    });

    it('quien ve por agencia solo ve su fila, con su posición real', async () => {
      const a2Propia = await env.agencia('A2-PROPIA', { regionId: costa.id });
      const a1Propia = await env.agencia('A1-PROPIA', { regionId: costa.id });
      const liderPropio = await env.usuario('lider-propio', 'LIDER', { agenciaId: a1Propia.id, regionId: costa.id });
      const bahia2 = await env.bahia('B-PROPIA', a2Propia.id);
      const reto = await retoDirecto({ sucursalesIds: [a1Propia.id, a2Propia.id] });
      await lavado(bahia2.id, ids.luis, -3); // solo A2 tiene servicios

      const r: any = await service.ranking(reto.id, await env.actor(liderPropio.id));
      expect(r.participantes).toEqual([expect.objectContaining({ participanteId: a1Propia.id, posicion: 2, valor: 0 })]);
    });

    it('servicios generales solamente: no cuenta los especiales; servicios específicos filtra por catálogo', async () => {
      const otroGeneral = await env.catalogo('GENERAL2');
      const bahia = await env.bahia('B-GEN', a1.id);
      const solo = await env.agencia('A-SOLO', { regionId: costa.id });
      const bahiaSolo = await env.bahia('B-SOLO', solo.id);
      void bahia;
      await env.servicioLavado({ bahiaId: bahiaSolo.id, operadorId: ids.luis, catalogoId: general.id, horaSalida: instante(-3) });
      await env.servicioLavado({ bahiaId: bahiaSolo.id, operadorId: ids.luis, catalogoId: otroGeneral.id, horaSalida: instante(-3) });
      await env.servicioEspecial({ agenciaId: solo.id, operadorId: ids.paco, fechaFin: instante(-3), catalogoId: especial.id });

      const generales = await retoDirecto({ sucursalesIds: [solo.id], tipoServicios: 'GENERALES' });
      expect(((await service.ranking(generales.id, actores.admin)) as any).participantes[0].valor).toBe(2);

      const todos = await retoDirecto({ sucursalesIds: [solo.id], tipoServicios: 'TODOS' });
      expect(((await service.ranking(todos.id, actores.admin)) as any).participantes[0].valor).toBe(3);

      const especificos = await retoDirecto({ sucursalesIds: [solo.id], tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [otroGeneral.id] });
      expect(((await service.ranking(especificos.id, actores.admin)) as any).participantes[0].valor).toBe(1);
    });

    it('bahías: compiten todas las de las agencias elegidas', async () => {
      const ag = await env.agencia('A-BAHIAS', { regionId: costa.id });
      const b1 = await env.bahia('RB1', ag.id);
      const b2 = await env.bahia('RB2', ag.id);
      await lavado(b2.id, ids.luis, -3);
      const reto = await retoDirecto({ tipoReto: 'BAHIA', sucursalesIds: [ag.id] });

      const r: any = await service.ranking(reto.id, actores.admin);
      expect(r.participantes.map((p: any) => [p.nombre, p.detalle, p.valor])).toEqual([
        [b2.nombre, ag.nombre, 1],
        [b1.nombre, ag.nombre, 0],
      ]);
    });

    it('bahías: muestra quién hizo sus servicios (de más a menos) o, si no tiene, quién está asignado hoy', async () => {
      const ag = await env.agencia('A-PERSONAS', { regionId: costa.id });
      const conServicios = await env.bahia('PB1', ag.id);
      const sinServicios = await env.bahia('PB2', ag.id);
      await lavado(conServicios.id, ids.luis, -5);
      await lavado(conServicios.id, ids.pedro, -4);
      await lavado(conServicios.id, ids.pedro, -3);
      await env.prisma.bahia.update({ where: { id: sinServicios.id }, data: { operadorActualId: ids.sara } });
      await env.prisma.bahiaOperador.create({ data: { bahiaId: sinServicios.id, operadorId: ids.sara } });
      const reto = await retoDirecto({ tipoReto: 'BAHIA', sucursalesIds: [ag.id] });

      const r: any = await service.ranking(reto.id, actores.admin);
      expect(r.participantes[0].personas).toEqual([
        { id: ids.pedro, nombre: 'pedro Mora', servicios: 2 }, // la cédula pegada al apellido se quita
        { id: ids.luis, nombre: 'luis Prueba', servicios: 1 },
      ]);
      expect(r.participantes[1].personas).toEqual([{ id: ids.sara, nombre: 'sara Prueba', servicios: null }]);
    });

    it('pulidores: solo especiales completados, y un servicio compartido cuenta para cada asignado', async () => {
      // Pulidores propios de esta prueba: así no se mezclan con los servicios de las demás.
      const movil = await env.usuario('pul-movil', 'PULIDOR', { name: 'Moni', regionId: costa.id });
      const fijo = await env.usuario('pul-fijo', 'PULIDOR', { name: 'Fabi', agenciaId: a1.id });
      await env.servicioEspecial({ operadorId: movil.id, asignados: [movil.id, fijo.id], fechaFin: instante(-3), precio: 50 });
      await env.servicioEspecial({ operadorId: movil.id, estado: 'En Proceso', fechaFin: null }); // no cuenta
      const reto = await retoDirecto({
        tipoReto: 'PULIDOR',
        tipoServicios: 'ESPECIALES',
        pulidoresIds: [movil.id, fijo.id],
        regiones: [],
        sucursalesIds: [],
      });

      const r: any = await service.ranking(reto.id, actores.admin);
      expect(r.participantes.map((p: any) => [p.nombre, p.valor, p.detalle]).sort()).toEqual(
        [
          ['Moni Prueba', 1, 'Pulidor móvil'],
          ['Fabi Prueba', 1, a1.nombre],
        ].sort(),
      );
    });

    it('no expone el ranking de un reto fuera del alcance del usuario', async () => {
      const deSierra = await retoDirecto({ regiones: [sierra.nombre], sucursalesIds: [] });
      await expect(service.ranking(deSierra.id, actores.lia)).rejects.toThrow(/No tienes acceso/);
      // Un reto privado de pulidores (sin región ni agencias) tampoco: antes su ranking lo podía abrir cualquiera.
      const privado = await retoDirecto({ regiones: [], sucursalesIds: [], tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', pulidoresIds: [ids.ana] });
      await expect(service.ranking(privado.id, actores.lia)).rejects.toThrow(/No tienes acceso/);
      await expect(service.ranking(privado.id, actores.ana)).resolves.toBeDefined();
    });
  });

  describe('cerrar', () => {
    it('lo cierran su creador o alguien con alcance nacional; el ganador sale del ranking', async () => {
      const ag = await env.agencia('A-CIERRE', { regionId: costa.id });
      const bahia = await env.bahia('B-CIERRE', ag.id);
      await lavado(bahia.id, ids.luis, -3);
      const reto = await retoDirecto({ sucursalesIds: [ag.id], creadoPorId: ids.coord });

      const r: any = await service.cerrar({ id: reto.id, ganadorNombre: 'Otro', resultado: 'Bien' } as any, actores.coord);
      expect(r).toMatchObject({
        estado: 'FINALIZADO',
        ganadorNombre: ag.nombre,
        resultado: 'Bien',
        cerradoPorId: ids.coord,
        ganadores: [{ participanteId: ag.id, nombre: ag.nombre, valor: 1, posicion: 1 }],
      });
      expect((await enBase(reto.id)).estado).toBe('FINALIZADO');

      const delJefe = await retoDirecto({ creadoPorId: ids.coord });
      await expect(service.cerrar({ id: delJefe.id } as any, actores.jefe)).resolves.toMatchObject({ estado: 'FINALIZADO' });

      const ajeno = await retoDirecto({ creadoPorId: ids.lia });
      await expect(service.cerrar({ id: ajeno.id } as any, actores.coord)).rejects.toThrow(/creador o alguien con alcance nacional/);
      expect((await enBase(ajeno.id)).estado).toBe('ACTIVO');
    });

    it('sin servicios no hay ganador', async () => {
      const ag = await env.agencia('A-VACIA', { regionId: costa.id });
      const reto = await retoDirecto({ sucursalesIds: [ag.id] });
      await expect(service.cerrar({ id: reto.id } as any, actores.admin)).resolves.toMatchObject({ ganadorNombre: null, ganadores: [] });
    });

    it('no permite cerrar un reto ya finalizado ni uno inexistente', async () => {
      const cerrado = await retoDirecto({ estado: 'FINALIZADO' });
      await expect(service.cerrar({ id: cerrado.id } as any, actores.admin)).rejects.toThrow(/ya fue cerrado/);
      await expect(service.cerrar({ id: '00000000-0000-4000-8000-000000000000' } as any, actores.admin)).rejects.toThrow(/no encontrado/);
    });
  });
});
