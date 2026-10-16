import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el servicio de notificaciones es el real y escribe en `Notification`.
 * Los avisos también llegan a los administradores reales de la base; el entorno los borra al cerrar.
 *
 * Mundo: Agencia A1 (región R1, sin aprobador, así un administrador puede decidir) con su líder, su backup y su lavador;
 * un supervisor de R1, otro de R2, un administrador y un lavador de otra agencia.
 */
describe('OperacionesService — notificación de decisión de servicio (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let bahia: any;
  let catalogo: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  const servicio = async (estado: any = 'FINALIZADO') =>
    (await env.servicioLavado({ bahiaId: bahia.id, operadorId: ids.lavador, catalogoId: catalogo.id, estado })).id;
  /** Espera los avisos (el envío es "fire-and-forget") y devuelve las filas y a quién llegaron. */
  const avisos = async (servicioId: string) => {
    const filas = await env.esperar(async () => {
      const f = await env.prisma.notification.findMany({ where: { entidadTipo: 'SERVICIO_LAVADO', entidadId: servicioId } });
      return f.length ? f : null;
    });
    return { filas, destinatarios: new Set(filas.map((f) => f.userId)) };
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never, env.notificaciones(), new DecisionesService(env.prisma as never));

    const r1 = await env.region('R1');
    const r2 = await env.region('R2');
    const a1 = await env.agencia('A1', { regionId: r1.id });
    const a2 = await env.agencia('A2', { regionId: r2.id });
    bahia = await env.bahia('B1', a1.id);
    catalogo = await env.catalogo('LAVADO');

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('admin', 'ADMIN');
    await crear('lider', 'LIDER', { agenciaId: a1.id });
    await crear('backup', 'BACKUP', { agenciaId: a1.id });
    await crear('lavador', 'LAVADOR', { agenciaId: a1.id });
    await crear('supervisorR1', 'SUPERVISOR', { regionId: r1.id });
    await crear('supervisorR2', 'SUPERVISOR', { regionId: r2.id });
    await crear('lavadorOtraAgencia', 'LAVADOR', { agenciaId: a2.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('al aprobar, avisa al operador + líder y backup de la agencia + admin/super admin/supervisor de la región', async () => {
    const id = await servicio();
    await service.aprobarServicio(id, 'ok', actores.admin);

    const { filas, destinatarios } = await avisos(id);
    for (const clave of ['lavador', 'lider', 'backup', 'admin', 'supervisorR1']) expect(destinatarios.has(ids[clave])).toBe(true);
    expect(destinatarios.has(ids.supervisorR2)).toBe(false); // supervisor de otra región
    expect(destinatarios.has(ids.lavadorOtraAgencia)).toBe(false);
    expect(filas[0].mensaje).toContain('aprobado');
    expect(filas[0].tipo).toBe('SERVICIO_DECIDIDO');
  });

  it('al rechazar, el mensaje dice "rechazado"', async () => {
    const id = await servicio();
    await service.rechazarServicio(id, 'Falta evidencia', actores.admin);
    const { filas } = await avisos(id);
    expect(filas[0].mensaje).toContain('rechazado');
  });

  it('al anular (softDelete con actor), el mensaje dice "anulado"', async () => {
    const id = await servicio('FINALIZADO');
    await service.softDelete(id, 'Duplicado', true, actores.admin);
    const { filas } = await avisos(id);
    expect(filas[0].mensaje).toContain('anulado');
  });

  it('softDelete sin actor (uso interno) no notifica', async () => {
    const id = await servicio('FINALIZADO');
    await service.softDelete(id, undefined, false);
    await new Promise((ok) => setTimeout(ok, 500));
    expect(await env.prisma.notification.count({ where: { entidadTipo: 'SERVICIO_LAVADO', entidadId: id } })).toBe(0);
  });
});
