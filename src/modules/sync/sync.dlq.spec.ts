import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): la cola de errores de sincronización (DLQ).
 *
 * Mundo: un error en la cola por cada usuario (líder, pulidor, aprobador, técnico, admin y super admin).
 */
describe('cola de errores de sincronización (DLQ) — base real', () => {
  let env: Entorno;
  let service: SyncService;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  const errores: Record<string, string> = {}; // rol → id del error en la cola
  const ROLES = ['LIDER', 'PULIDOR', 'APROBADOR', 'TECNICO', 'ADMIN', 'SUPER_ADMIN'];

  /** De los errores listados, los que pertenecen a esta prueba (la cola real tiene otros). */
  const propios = (r: any) =>
    r.items
      .filter((i: any) => i.mutationId.startsWith(env.marca))
      .map((i: any) => i.mutationId.replace(`${env.marca}-`, ''))
      .sort();

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new SyncService(
      env.prisma as never,
      new OperacionesService(env.prisma as never),
      new ServiciosEspecialesService(env.prisma as never),
      env.storage(),
    );
    for (const rol of ROLES) {
      const u = await env.usuario(rol.toLowerCase(), rol);
      ids[rol] = u.id;
      actores[rol] = await env.actor(u.id);
      const fila = await env.prisma.syncDeadLetterQueue.create({
        data: {
          mutationId: `${env.marca}-${rol}`,
          clientUuid: `${env.marca}-cli-${rol}`,
          entityType: 'servicio_lavado',
          payload: {},
          errorMotivo: 'prueba',
          usuarioId: u.id,
        },
      });
      errores[rol] = fila.id;
      env.rastrear('SyncDeadLetterQueue', fila.id);
    }
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('cada usuario ve solo los errores de su propia sincronización', async () => {
    for (const rol of ['LIDER', 'PULIDOR', 'APROBADOR', 'TECNICO']) {
      expect(propios(await service.listDeadLetterQueue(false, actores[rol]))).toEqual([rol]);
    }
  });

  it('administradores y súper administradores ven los de todos', async () => {
    for (const rol of ['ADMIN', 'SUPER_ADMIN']) {
      expect(propios(await service.listDeadLetterQueue(false, actores[rol]))).toEqual([...ROLES].sort());
    }
  });

  it('sin usuario no se ve ningún error', async () => {
    const r: any = await service.listDeadLetterQueue();
    expect(r.items).toEqual([]);
  });

  it('resolver un error deja registrado quién lo hizo', async () => {
    const r: any = await service.resolveDeadLetterItem(errores.LIDER, true, actores.ADMIN);
    expect(r).toMatchObject({ success: true, id: errores.LIDER, resuelto: true });
    expect((await env.prisma.syncDeadLetterQueue.findUniqueOrThrow({ where: { id: errores.LIDER } })).resuelto).toBe(true);
    const registro = await env.prisma.auditoriaDecision.findFirstOrThrow({ where: { entidad: 'SYNC_DLQ', entidadId: errores.LIDER } });
    expect(registro).toMatchObject({ accion: 'RESOLVER', usuarioId: ids.ADMIN, rol: 'ADMIN' });
  });

  it('un error que no existe no se puede resolver', async () => {
    await expect(service.resolveDeadLetterItem('00000000-0000-4000-8000-000000000000', true, actores.ADMIN)).rejects.toThrow(/no encontrado/);
  });
});
