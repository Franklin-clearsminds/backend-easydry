import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): alcance por rol de los servicios especiales.
 *
 * Mundo de la prueba, todo creado aquí:
 *  Región R1 ── Agencia A1 (Aprobador) · Agencia A2 (con pulidor fijo Fabi)
 *  Región R2 ── Agencia A3 (otro Aprobador)
 *  Coordinador de servicios especiales · Admin · Supervisor de R1 · Aprobador sin agencia
 *  Pulidores de R1: Pablo (asignado al servicio base), Paco y Pepa (para crear/reasignar; solo Paco tiene insumos en su kit),
 *  Mario (móvil, sin asignaciones) · un pulidor de R2: Rita.
 *  Servicio base E (A1/R1, Pendiente, a cargo de Pablo).
 */
describe('servicios especiales — alcance por rol (base real)', () => {
  let env: Entorno;
  let service: ServiciosEspecialesService;
  let r1: any;
  let r2: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let a4: any;
  let insumo: any;
  let base: string; // id del servicio base E
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  let n = 0;

  const crearUsuario = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
    const u = await env.usuario(clave, rol, { name: clave, ...opts });
    ids[clave] = u.id;
    actores[clave] = await env.actor(u.id);
  };
  const nuevo = async (extra: Record<string, unknown> = {}) =>
    (
      await env.servicioEspecial({
        estado: 'Pendiente',
        agenciaId: a1.id,
        regionId: r1.id,
        operadorId: ids.pablo,
        asignados: [ids.pablo],
        fechaFin: null,
        datos: { recetaInsumos: [{ insumoId: insumo.id, cantidad: 0 }] },
        ...extra,
      })
    ).id;
  const filaDe = (id: string) => env.prisma.servicioEspecial.findUniqueOrThrow({ where: { id }, include: { operadoresAsignados: { orderBy: { orden: 'asc' } } } });
  const dtoCrear = (extra: Record<string, unknown> = {}) =>
    ({
      ordenTrabajoOT: `${env.marca}-al-${++n}`,
      tipoServicio: 'Pulido',
      vehiculoInfo: { placa: 'ABC-123', marca: 'Toyota', modelo: 'Yaris' },
      agenciaId: a1.id,
      regionId: r1.id,
      recetaInsumos: [{ insumoId: insumo.id, cantidad: 0 }],
      ...extra,
    }) as any;
  const vistos = async (query: Record<string, unknown>, actor: any) => {
    const r: any = await service.findAll({ regionId: undefined, ...query } as any, actor);
    return (Array.isArray(r) ? r : (r.items ?? r.data)).map((x: any) => x.id) as string[];
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new ServiciosEspecialesService(env.prisma as never, new DecisionesService(env.prisma as never));

    r1 = await env.region('R1');
    r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    a4 = await env.agencia('A4', { regionId: r1.id }); // agencia con su pulidor fijo, solo para la prueba de listados
    insumo = await env.insumo('KIT');

    await crearUsuario('coord', 'COORD_SERVICIOS_ESPECIALES');
    await crearUsuario('admin', 'ADMIN');
    await crearUsuario('supervisorR1', 'SUPERVISOR', { regionId: r1.id });
    await crearUsuario('aprobadorA1', 'APROBADOR', { agenciaId: a1.id });
    await crearUsuario('aprobadorA3', 'APROBADOR', { agenciaId: a3.id });
    await crearUsuario('aprobadorSinAgencia', 'APROBADOR');
    await crearUsuario('pablo', 'PULIDOR', { regionId: r1.id });
    await crearUsuario('paco', 'PULIDOR', { regionId: r1.id });
    await crearUsuario('pepa', 'PULIDOR', { regionId: r1.id });
    await crearUsuario('mario', 'PULIDOR', { regionId: r1.id });
    await crearUsuario('fabi', 'PULIDOR', { agenciaId: a2.id }); // pulidor fijo de A2
    await crearUsuario('rita', 'PULIDOR', { regionId: r2.id });
    await crearUsuario('aprobadorA4', 'APROBADOR', { agenciaId: a4.id });
    await crearUsuario('pulA4', 'PULIDOR', { agenciaId: a4.id });
    await crearUsuario('pulR2', 'PULIDOR', { regionId: r2.id });
    // Solo Pablo y Paco tienen insumos en su kit.
    for (const p of ['pablo', 'paco']) await env.stock({ insumoId: insumo.id, tipoUbicacion: 'PULIDOR_MOVIL', pulidorId: ids[p], cantidad: 50 });

    base = await nuevo();
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('lectura por alcance', () => {
    it('los pulidores fijos y móviles solo ven las órdenes que tienen asignadas', async () => {
      const deMario = await nuevo({ operadorId: ids.mario, asignados: [ids.mario] });
      const deFabi = await nuevo({ agenciaId: a2.id, operadorId: ids.fabi, asignados: [ids.fabi] });
      expect(await vistos({}, actores.mario)).toEqual([deMario]); // móvil
      expect(await vistos({}, actores.fabi)).toEqual([deFabi]); // fijo
      // Un servicio donde está entre los asignados (no como responsable principal) también cuenta.
      const compartido = await nuevo({ operadorId: ids.pablo, asignados: [ids.pablo, ids.mario] });
      expect((await vistos({}, actores.mario)).sort()).toEqual([deMario, compartido].sort());
    });

    it('un pulidor de alcance global también queda limitado a sus órdenes asignadas', async () => {
      const comoGlobal = { ...actores.pablo, roleDetails: { ...actores.pablo.roleDetails, ambito: 'GLOBAL' } };
      const propios = await vistos({}, comoGlobal);
      expect(propios).toContain(base);
      const filas = await env.prisma.servicioEspecial.findMany({ where: { id: { in: propios } }, include: { operadoresAsignados: true } });
      for (const f of filas) expect(f.operadorId === ids.pablo || f.operadoresAsignados.some((a) => a.operadorId === ids.pablo)).toBe(true);
    });

    it('el coordinador ve toda la red; el supervisor, su región; el aprobador, su agencia', async () => {
      const enA3 = await nuevo({ agenciaId: a3.id, regionId: r2.id, operadorId: ids.rita, asignados: [ids.rita] });
      expect(await vistos({ agenciaId: a3.id }, actores.coord)).toEqual([enA3]); // alcance nacional
      const supervisor = await vistos({}, actores.supervisorR1);
      expect(supervisor).toContain(base);
      expect(supervisor).not.toContain(enA3); // de otra región
      // El aprobador de A1 pide una agencia ajena y solo recibe lo de la suya.
      const aprobador = await vistos({ agenciaId: a3.id }, actores.aprobadorA1);
      expect(aprobador).toContain(base);
      expect(aprobador).not.toContain(enA3);
    });

    it('sin datos de su ámbito no ve nada', async () => {
      expect(await vistos({}, actores.aprobadorSinAgencia)).toEqual([]);
    });

    it('el detalle exige que el servicio esté en su alcance', async () => {
      await expect(service.findOne(base, actores.aprobadorA3)).rejects.toThrow(/alcance/); // otra agencia
      await expect(service.findOne(base, actores.mario)).rejects.toThrow(/alcance/); // pulidor no asignado
      await expect(service.findOne(base, actores.pablo)).resolves.toBeDefined(); // el asignado
      await expect(service.findOne(base, actores.supervisorR1)).resolves.toBeDefined();
      await expect(service.findOne(base, actores.coord)).resolves.toBeDefined();
    });
  });

  describe('creación multiasignada', () => {
    it('permite al coordinador asignar pulidores en orden y valida insumos solo al primero', async () => {
      const d = dtoCrear({ operadoresIds: [ids.paco, ids.pepa] }); // Pepa no tiene kit: no se le valida
      await service.create(d, ids.coord, actores.coord);
      const fila = await env.prisma.servicioEspecial.findFirstOrThrow({
        where: { codigoSE: d.ordenTrabajoOT.toUpperCase() },
        include: { operadoresAsignados: { orderBy: { orden: 'asc' } } },
      });
      env.rastrear('ServicioEspecial', fila.id);
      expect(fila.operadorId).toBe(ids.paco);
      expect(fila.operadoresAsignados.map((a) => [a.operadorId, a.orden])).toEqual([[ids.paco, 0], [ids.pepa, 1]]);
    });

    it('si el primer pulidor no tiene insumos en su kit, la OT no se crea', async () => {
      const d = dtoCrear({ operadoresIds: [ids.pepa, ids.paco] });
      await expect(service.create(d, ids.coord, actores.coord)).rejects.toThrow(/el pulidor no tiene insumos en su kit/);
      expect(await env.prisma.servicioEspecial.count({ where: { codigoSE: d.ordenTrabajoOT.toUpperCase() } })).toBe(0);
    });

    it('rechaza crear OTs a quien no tiene la casilla «Crear OT especial» (decide la casilla, no el nombre del rol)', async () => {
      const d = dtoCrear({ operadoresIds: [ids.paco] });
      const sinCasilla = {
        ...actores.paco,
        role: { ...actores.paco.role, capacidades: ['servicios.especiales.operar'] },
        roleDetails: { ...actores.paco.roleDetails, capacidades: ['servicios.especiales.operar'] },
      };
      await expect(service.create(d, ids.paco, sinCasilla)).rejects.toThrow(/no puede crear/);
      expect(await env.prisma.servicioEspecial.count({ where: { codigoSE: d.ordenTrabajoOT.toUpperCase() } })).toBe(0);
    });
  });

  describe('crear «para mí» y «asignarla a otro pulidor» son casillas distintas', () => {
    const PARA_MI = 'servicios.especiales.crear';
    const PARA_OTRO = 'servicios.especiales.asignar';
    /** El mismo usuario con exactamente estas casillas y este alcance. */
    const con = (base: any, capacidades: string[], ambito = 'REGION') => ({
      ...base,
      role: { ...base.role, capacidades },
      roleDetails: { ...base.roleDetails, capacidades, ambito },
    });
    const crear = async (dto: any, creador: string, actor: any) => {
      await service.create(dto, creador, actor);
      const fila = await env.prisma.servicioEspecial.findFirstOrThrow({
        where: { codigoSE: dto.ordenTrabajoOT.toUpperCase() },
        include: { operadoresAsignados: { orderBy: { orden: 'asc' } } },
      });
      env.rastrear('ServicioEspecial', fila.id);
      return fila;
    };

    it('solo «para mí»: sin elegir a nadie la OT queda a nombre del pulidor que la crea', async () => {
      const fila = await crear(dtoCrear(), ids.pablo, con(actores.pablo, [PARA_MI]));
      expect(fila.operadorId).toBe(ids.pablo);
      expect(fila.operadoresAsignados.map((a) => a.operadorId)).toEqual([ids.pablo]);
    });

    it('solo «para mí»: puede sumar a otros pulidores y él sigue siendo el responsable', async () => {
      const fila = await crear(dtoCrear({ operadoresIds: [ids.paco, ids.pablo] }), ids.pablo, con(actores.pablo, [PARA_MI]));
      expect(fila.operadoresAsignados.map((a) => [a.operadorId, a.orden])).toEqual([[ids.pablo, 0], [ids.paco, 1]]);
    });

    it('solo «para mí»: no puede crear una OT solo para otro pulidor', async () => {
      const d = dtoCrear({ operadoresIds: [ids.paco] });
      await expect(service.create(d, ids.pablo, con(actores.pablo, [PARA_MI]))).rejects.toThrow(/solo puede crear órdenes especiales para sí mismo/);
      expect(await env.prisma.servicioEspecial.count({ where: { codigoSE: d.ordenTrabajoOT.toUpperCase() } })).toBe(0);
    });

    it('solo «para mí»: quien no es pulidor no se la puede asignar a sí mismo', async () => {
      await expect(service.create(dtoCrear(), ids.coord, con(actores.coord, [PARA_MI], 'GLOBAL'))).rejects.toThrow(/pulidores activos/);
    });

    it('solo «asignarla a otro»: elige otro pulidor, pero no puede incluirse a sí mismo', async () => {
      const fila = await crear(dtoCrear({ operadoresIds: [ids.paco] }), ids.coord, con(actores.coord, [PARA_OTRO], 'GLOBAL'));
      expect(fila.operadorId).toBe(ids.paco);

      const d = dtoCrear({ operadoresIds: [ids.pablo, ids.paco] });
      await expect(service.create(d, ids.pablo, con(actores.pablo, [PARA_OTRO]))).rejects.toThrow(/para sí mismo/);
    });

    it('solo «asignarla a otro»: siempre debe haber un pulidor asignado', async () => {
      const d = dtoCrear();
      await expect(service.create(d, ids.coord, con(actores.coord, [PARA_OTRO], 'GLOBAL'))).rejects.toThrow(/al menos un pulidor/);
      expect(await env.prisma.servicioEspecial.count({ where: { codigoSE: d.ordenTrabajoOT.toUpperCase() } })).toBe(0);
    });

    it('con las dos casillas puede crearla para sí mismo o para otro', async () => {
      const propia = await crear(dtoCrear({ operadoresIds: [ids.pablo] }), ids.pablo, con(actores.pablo, [PARA_MI, PARA_OTRO]));
      expect(propia.operadorId).toBe(ids.pablo);
      const ajena = await crear(dtoCrear({ operadoresIds: [ids.paco] }), ids.pablo, con(actores.pablo, [PARA_MI, PARA_OTRO]));
      expect(ajena.operadorId).toBe(ids.paco);
    });

    it('con alcance de agencia solo puede asignársela a sí mismo, aunque tenga la casilla de asignar', async () => {
      const deAgencia = { ...con(actores.pablo, [PARA_MI, PARA_OTRO], 'AGENCIA'), agenciaId: a1.id };
      const d = dtoCrear({ operadoresIds: [ids.paco] });
      await expect(service.create(d, ids.pablo, deAgencia)).rejects.toThrow(/solo puedes asignarte a ti mismo/);
    });

    it('sin ninguna de las dos casillas no crea', async () => {
      await expect(service.create(dtoCrear(), ids.pablo, con(actores.pablo, ['servicios.especiales.operar']))).rejects.toThrow(/no puede crear/);
    });

    it('reasignar el pulidor (dentro de editar) exige la casilla de asignar a otro y nunca deja la OT sin pulidor', async () => {
      const id = await nuevo({ operadorId: ids.pablo, asignados: [ids.pablo] });

      await expect(service.reasignar({ id, operadoresIds: [ids.paco] } as any, con(actores.coord, ['servicios.especiales.editar'], 'GLOBAL'))).rejects.toThrow(/necesita «Crear OT especial y asignarla/);
      await expect(service.reasignar({ id, operadoresIds: [] } as any, con(actores.coord, ['servicios.especiales.editar', PARA_OTRO], 'GLOBAL'))).rejects.toThrow(/siempre debe tener un pulidor/);
      await service.reasignar({ id, operadoresIds: [ids.paco] } as any, con(actores.coord, ['servicios.especiales.editar', PARA_OTRO], 'GLOBAL'));
      expect((await filaDe(id)).operadorId).toBe(ids.paco);
    });
  });

  describe('anular (no se borra)', () => {
    it('exige motivo y deja registrado quién, cuándo y por qué', async () => {
      const id = await nuevo();
      await expect(service.softDelete(id, '', actores.coord)).rejects.toThrow(/motivo es obligatorio/);
      await service.softDelete(id, 'Cliente canceló', actores.coord);

      const fila = await filaDe(id);
      expect(fila.estado).toBe('Cancelado');
      expect(fila.deletedAt).toBeInstanceOf(Date);
      const [registro] = await env.prisma.auditoriaDecision.findMany({ where: { entidad: 'SERVICIO_ESPECIAL', entidadId: id } });
      expect(registro).toMatchObject({ accion: 'ANULAR', motivo: 'Cliente canceló', usuarioId: ids.coord });
    });

    it('el aprobador solo anula los de su agencia; uno ya anulado no se anula otra vez', async () => {
      const id = await nuevo();
      await expect(service.softDelete(id, 'Duplicado', actores.aprobadorA3)).rejects.toThrow(/alcance/);
      expect((await filaDe(id)).deletedAt).toBeNull();
      await expect(service.softDelete(id, 'Duplicado', actores.aprobadorA1)).resolves.toBeDefined();
      await expect(service.softDelete(id, 'Otra vez', actores.admin)).rejects.toThrow(/ya está anulado/);
    });
  });

  describe('reasignar', () => {
    it('solo a un pulidor activo de la misma región; sin comprobar nombres de rol sueltos', async () => {
      const id = await nuevo();
      await expect(service.reasignar({ id, operadorId: ids.supervisorR1 } as any, actores.coord)).rejects.toThrow(/pulidores activos/); // no es pulidor
      await expect(service.reasignar({ id, operadorId: ids.rita } as any, actores.coord)).rejects.toThrow(/misma región/); // pulidor de otra región
      expect((await filaDe(id)).operadorId).toBe(ids.pablo);
    });

    it('un servicio ya finalizado no se reasigna', async () => {
      const id = await nuevo({ estado: 'Completado' });
      await expect(service.reasignar({ id, operadorId: null } as any, actores.coord)).rejects.toThrow(/finalizado o cancelado/);
    });

    it('si la agencia tiene pulidor fijo activo, no se puede reasignar a otro pulidor', async () => {
      const id = await nuevo({ agenciaId: a2.id, operadorId: ids.fabi, asignados: [ids.fabi] });
      await expect(service.reasignar({ id, operadorId: ids.paco } as any, actores.coord)).rejects.toThrow(/pulidor fijo asignado permanentemente/);
      expect((await filaDe(id)).operadorId).toBe(ids.fabi);
    });

    it('reasigna a varios pulidores conservando el orden y valida el kit solo del primero', async () => {
      const id = await nuevo();
      await service.reasignar({ id, operadoresIds: [ids.paco, ids.pepa] } as any, actores.coord); // solo Paco tiene kit
      const fila = await filaDe(id);
      expect(fila.operadorId).toBe(ids.paco);
      expect(fila.operadoresAsignados.map((a) => [a.operadorId, a.orden])).toEqual([[ids.paco, 0], [ids.pepa, 1]]);
    });

    it('rechaza reasignar si el primer pulidor no tiene kit', async () => {
      const id = await nuevo();
      await expect(service.reasignar({ id, operadoresIds: [ids.pepa] } as any, actores.coord)).rejects.toThrow(
        /No se puede reasignar: el pulidor no tiene insumos en su kit/,
      );
      expect((await filaDe(id)).operadorId).toBe(ids.pablo); // sin cambios
    });
  });

  describe('pulidores y stock', () => {
    it('la lista de pulidores se acota al alcance: el aprobador no puede pedir otra agencia', async () => {
      const r: any[] = (await service.listarPulidoresPorRegion(r2.id, a3.id, actores.aprobadorA4)) as any[];
      const lista = r.map((p) => p.id);
      expect(lista).toContain(ids.pulA4); // el pulidor de SU agencia
      expect(lista).not.toContain(ids.mario); // y no los de otras agencias de la región
      expect(lista).not.toContain(ids.pulR2); // aunque pidió la región y la agencia de otro
      const delSupervisor: any[] = (await service.listarPulidoresPorRegion(r2.id, undefined, actores.supervisorR1)) as any[];
      const ids2 = delSupervisor.map((p) => p.id);
      expect(ids2).toContain(ids.mario); // pulidores de su región R1
      expect(ids2).not.toContain(ids.pulR2); // pidió R2, no la amplía
    });

    it('el stock de un pulidor lo ve él, o quien tenga alcance sobre él', async () => {
      const propio: any[] = (await service.obtenerStockPulidor(ids.pablo, actores.pablo)) as any[];
      expect(propio.length).toBeGreaterThan(0); // su kit tiene el insumo
      await expect(service.obtenerStockPulidor(ids.paco, actores.pablo)).rejects.toThrow(/tu propio kit/);
      await expect(service.obtenerStockPulidor(ids.paco, actores.coord)).resolves.toBeDefined();
      await expect(service.obtenerStockPulidor(ids.pulA4, actores.aprobadorA3)).rejects.toThrow(/alcance/);
    });
  });
});
