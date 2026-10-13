import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el servicio de notificaciones es el real y escribe en `Notification`.
 * Los avisos también llegan a los administradores reales de la base; el entorno los borra al cerrar.
 *
 * Mundo: Agencia A1 de la región R1, un coordinador de servicios especiales, un administrador, un supervisor de R1 y
 * varios pulidores de R1, cada uno con insumos en su kit (la creación y la reasignación lo exigen).
 */
describe('ServiciosEspecialesService — notificaciones (base real)', () => {
  let env: Entorno;
  let service: ServiciosEspecialesService;
  let a1: any;
  let region: any;
  let insumo: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  let n = 0;

  const dtoBase = (extra: Record<string, unknown> = {}) =>
    ({
      ordenTrabajoOT: `${env.marca}-se-ot-${++n}`,
      tipoServicio: 'Pulido',
      agenciaId: a1.id,
      operadorId: ids.pulA,
      vehiculoInfo: { placa: 'XYZ-999' },
      recetaInsumos: [{ insumoId: insumo.id, cantidad: 0 }],
      ...extra,
    }) as any;
  /** Un servicio especial ya existente, listo para reasignar o cerrar. */
  const existente = async (estado: string, extra: Record<string, unknown> = {}) =>
    (
      await env.servicioEspecial({
        estado,
        agenciaId: a1.id,
        regionId: region.id,
        operadorId: ids.pulA,
        fechaFin: null,
        datos: { recetaInsumos: [{ insumoId: insumo.id, cantidad: 0 }], fechaInicio: new Date(), ...extra },
      })
    ).id;
  /** Espera los avisos (el envío es "fire-and-forget") de una entidad. */
  const avisos = async (servicioId: string) => {
    const filas = await env.esperar(async () => {
      const f = await env.prisma.notification.findMany({ where: { entidadTipo: 'SERVICIO_ESPECIAL', entidadId: servicioId } });
      return f.length ? f : null;
    });
    return { filas, destinatarios: new Set(filas.map((f) => f.userId)) };
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new ServiciosEspecialesService(env.prisma as never, new DecisionesService(env.prisma as never), env.notificaciones());

    region = await env.region('R1');
    const otraRegion = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: region.id });
    insumo = await env.insumo('KIT');

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('coord', 'COORD_SERVICIOS_ESPECIALES');
    await crear('admin', 'ADMIN');
    await crear('supervisorR1', 'SUPERVISOR', { regionId: region.id });
    await crear('supervisorR2', 'SUPERVISOR', { regionId: otraRegion.id });
    for (const p of ['pulA', 'pulB', 'pulC']) {
      await crear(p, 'PULIDOR', { regionId: region.id });
      await env.stock({ insumoId: insumo.id, tipoUbicacion: 'PULIDOR_MOVIL', pulidorId: ids[p], cantidad: 50 });
    }
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('notificación de asignación', () => {
    it('create(): avisa al pulidor asignado cuando no es quien crea la OT', async () => {
      const d = dtoBase();
      await service.create(d, ids.coord, actores.coord);
      const id = d.ordenTrabajoOT.toUpperCase();
      env.rastrear('ServicioEspecial', id);

      const { filas, destinatarios } = await avisos(id);
      expect([...destinatarios]).toEqual([ids.pulA]);
      expect(filas[0].titulo).toContain('Nuevo servicio especial');
      expect(filas[0].tipo).toBe('SERVICIO_ESPECIAL_ASIGNADO');
    });

    it('create(): no se notifica a sí mismo si el pulidor se autoasigna', async () => {
      // Quien actúa tiene el mismo id que el pulidor asignado (el servicio compara ids).
      const d = dtoBase({ operadorId: ids.pulB });
      await service.create(d, ids.pulB, { ...actores.coord, id: ids.pulB });
      const id = d.ordenTrabajoOT.toUpperCase();
      env.rastrear('ServicioEspecial', id);
      await new Promise((ok) => setTimeout(ok, 500));
      expect(await env.prisma.notification.count({ where: { entidadTipo: 'SERVICIO_ESPECIAL', entidadId: id } })).toBe(0);
    });

    it('reasignar(): avisa a los nuevos pulidores asignados', async () => {
      const id = await existente('Pendiente');
      await service.reasignar({ id, operadoresIds: [ids.pulB, ids.pulC] } as any, actores.admin);

      const { filas, destinatarios } = await avisos(id);
      expect([...destinatarios].sort()).toEqual([ids.pulB, ids.pulC].sort());
      expect(filas[0].titulo).toContain('reasignado');
      expect(filas[0].tipo).toBe('SERVICIO_ESPECIAL_ASIGNADO');
    });
  });

  describe('notificación de cierre', () => {
    it('completar(): avisa a admin/super admin/coord especiales/supervisor de la región', async () => {
      const id = await existente('En Proceso');
      await service.completar({ id } as any, actores.admin);

      const { filas, destinatarios } = await avisos(id);
      for (const clave of ['admin', 'coord', 'supervisorR1']) expect(destinatarios.has(ids[clave])).toBe(true);
      expect(destinatarios.has(ids.supervisorR2)).toBe(false); // supervisor de otra región
      expect(destinatarios.has(ids.pulA)).toBe(false);
      expect(filas[0].titulo).toContain('completado');
      expect(filas[0].tipo).toBe('SERVICIO_ESPECIAL_CERRADO');
    });

    it('softDelete() con actor (anulación real): avisa el cierre como "cancelado"', async () => {
      const id = await existente('En Proceso');
      await service.softDelete(id, 'Cliente canceló', actores.admin);
      const { filas } = await avisos(id);
      expect(filas[0].titulo).toContain('cancelado');
    });

    it('softDelete() sin actor (uso interno) no notifica', async () => {
      const id = await existente('En Proceso');
      await service.softDelete(id);
      await new Promise((ok) => setTimeout(ok, 500));
      expect(await env.prisma.notification.count({ where: { entidadTipo: 'SERVICIO_ESPECIAL', entidadId: id } })).toBe(0);
    });
  });
});
