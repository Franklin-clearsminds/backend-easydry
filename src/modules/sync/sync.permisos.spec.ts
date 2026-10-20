import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { permisoRequeridoPorMutacion } from './sync-permisos.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

describe('permiso exigido a cada acción de sincronización (puro)', () => {
  it.each([
    ['servicio_lavado', 'CREATE', ['servicios.generales.crear']],
    ['work_order', 'CREATE', ['servicios.generales.crear']],
    ['servicio_lavado', 'UPDATE', ['servicios.generales.editar', 'servicios.generales.finalizar']],
    ['servicio_lavado', 'COMPLETE', ['servicios.generales.finalizar']],
    ['servicio_especial', 'CREATE', ['servicios.especiales.crear']],
    ['special_service', 'COMPLETE', ['servicios.especiales.finalizar']],
    ['special_service', 'UPDATE', ['servicios.especiales.operar', 'servicios.especiales.reasignar', 'servicios.especiales.editar']],
  ])('%s %s exige %j', (entidad, accion, codigos) => {
    expect(permisoRequeridoPorMutacion(entidad, accion)?.codigos).toEqual(codigos);
  });

  it('una entidad que no se sincroniza no exige permiso adicional (la propia rama la rechaza)', () => {
    expect(permisoRequeridoPorMutacion('incidente', 'CREATE')).toBeNull();
    expect(permisoRequeridoPorMutacion('cualquier_cosa', 'CREATE')).toBeNull();
  });

  it('la acción por omisión es CREATE', () => {
    expect(permisoRequeridoPorMutacion('servicio_lavado', '')?.codigos).toEqual(['servicios.generales.crear']);
  });
});

/**
 * Integración con la base real: lo que el celular sube sin conexión se rechaza si el rol ya no tiene el permiso de esa acción,
 * y el rechazo queda en la bandeja de errores con su motivo (Q15).
 */
describe('sincronización: permisos por acción (base real)', () => {
  let env: Entorno;
  let service: SyncService;
  let sinPermiso: { id: string };
  let conPermiso: { id: string };

  const mutacion = (sufijo: string, entity: string, action: string) => ({
    mutationId: `${env.marca}-${sufijo}`,
    clientUuid: `${env.marca}-cli-${sufijo}`,
    entity,
    action,
    timestamp: Date.now(),
    data: {},
  });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new SyncService(
      env.prisma as never,
      new OperacionesService(env.prisma as never),
      new ServiciosEspecialesService(env.prisma as never),
      env.storage(),
    );
    // Un pulidor puede ejecutar especiales pero no crear órdenes generales; un líder, al revés.
    sinPermiso = await env.usuario('pulidor', 'PULIDOR');
    conPermiso = await env.usuario('lider', 'LIDER');
  });

  afterAll(async () => {
    await env.prisma.syncDeadLetterQueue.deleteMany({ where: { mutationId: { startsWith: env.marca } } });
    await env.cerrar();
  });

  it('sin el permiso de la acción, se rechaza como «Sin permiso» y queda en la bandeja de errores', async () => {
    const r: any = await service.processPush({ deviceId: `${env.marca}-d1`, mutations: [mutacion('a', 'servicio_lavado', 'CREATE')] }, sinPermiso.id);

    expect(r.results[0].status).toBe('DEAD_LETTER');
    expect(r.results[0].error).toMatch(/^Sin permiso: tu rol ya no puede registrar órdenes de servicio/);
    const fila = await env.prisma.syncDeadLetterQueue.findUnique({ where: { mutationId: `${env.marca}-a` } });
    expect(fila?.errorMotivo).toMatch(/^SIN_PERMISO:/);
    expect(fila?.usuarioId).toBe(sinPermiso.id);
  });

  it('el rechazo de una acción no frena el resto de la cola', async () => {
    const r: any = await service.processPush(
      { deviceId: `${env.marca}-d2`, mutations: [mutacion('b1', 'servicio_lavado', 'CREATE'), mutacion('b2', 'servicio_lavado', 'CREATE')] },
      sinPermiso.id,
    );
    expect(r.results.map((x: any) => x.status)).toEqual(['DEAD_LETTER', 'DEAD_LETTER']);
    expect(r.processed).toBe(2);
  });

  it('con el permiso de la acción pasa la comprobación (puede fallar después por datos, pero no por permiso)', async () => {
    const r: any = await service.processPush({ deviceId: `${env.marca}-d3`, mutations: [mutacion('c', 'servicio_lavado', 'CREATE')] }, conPermiso.id);

    expect(r.results[0].error ?? '').not.toMatch(/Sin permiso/);
  });

  it('quitar el permiso apaga la acción: el mismo líder, sin «Registrar OT», es rechazado', async () => {
    const rol = await env.prisma.role.findFirstOrThrow({ where: { users: { some: { id: conPermiso.id } } } });
    const original = rol.capacidades;
    try {
      await env.prisma.role.update({
        where: { id: rol.id },
        data: { capacidades: original.filter((c) => c !== 'servicios.generales.crear') },
      });
      const r: any = await service.processPush({ deviceId: `${env.marca}-d4`, mutations: [mutacion('d', 'servicio_lavado', 'CREATE')] }, conPermiso.id);
      expect(r.results[0].status).toBe('DEAD_LETTER');
      expect(r.results[0].error).toMatch(/Sin permiso/);
    } finally {
      await env.prisma.role.update({ where: { id: rol.id }, data: { capacidades: original } });
    }
  });
});
