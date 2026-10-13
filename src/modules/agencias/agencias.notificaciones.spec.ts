import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el servicio de notificaciones es el real y escribe en la tabla
 * `Notification`. Los avisos también llegan a los administradores reales de la base; el entorno los borra al
 * cerrar (por `entidadId`). No hay dispositivos con token push, así que no sale ninguna llamada a Expo.
 */
describe('AgenciasService — notificación de cambios de usuario (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let agencia: any;
  let region: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never, env.notificaciones());
    region = await env.region('R1');
    agencia = await env.agencia('Uno', { regionId: region.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  /** El envío es "fire-and-forget": se espera a que aparezcan los avisos de ese usuario. */
  const avisos = (usuarioId: string, minimo = 1) =>
    env.esperar(async () => {
      const filas = await env.prisma.notification.findMany({ where: { entidadId: usuarioId, tipo: 'USUARIO_ACTUALIZADO' } });
      return filas.length >= minimo ? filas : null;
    });

  it('toggleEstadoUsuario: avisa al propio usuario y a los administradores', async () => {
    const ana = await env.usuario('ana', 'LIDER', { agenciaId: agencia.id, name: 'Ana' });
    await service.toggleEstadoUsuario({ usuarioId: ana.id, estado: 0 } as any);

    const filas = await avisos(ana.id, 2);
    const destinatarios = new Set(filas.map((f) => f.userId));
    expect(destinatarios.has(ana.id)).toBe(true);
    // Solo los administradores reales: otros archivos de prueba, en paralelo, crean y borran sus propios ADMIN (@prueba.local).
    const admins = await env.prisma.user.findMany({
      where: { role: { namerol: { in: ['ADMIN', 'SUPER_ADMIN'] }, estado: 1 }, estado: 1, NOT: { email: { endsWith: '@prueba.local' } } },
      select: { id: true },
    });
    for (const a of admins) expect(destinatarios.has(a.id)).toBe(true);
    expect(filas[0].titulo).toContain('desactivada');
    expect(filas[0].entidadTipo).toBe('USUARIO');
  });

  it('asignarUsuario (transferencia): avisa al usuario transferido con el nombre de la agencia', async () => {
    const luis = await env.usuario('luis', 'LIDER', { name: 'Luis' });
    await service.asignarUsuario({ usuarioId: luis.id, agenciaId: agencia.id } as any);

    const filas = await avisos(luis.id);
    expect(filas.some((f) => f.userId === luis.id)).toBe(true);
    const suyo = filas.find((f) => f.userId === luis.id)!;
    expect(suyo.titulo).toContain('asignación');
    expect(suyo.mensaje).toContain(agencia.nombre);
  });

  it('updateUsuario: el cambio de rol dispara la notificación', async () => {
    const eva = await env.usuario('eva', 'LIDER', { agenciaId: agencia.id, name: 'Eva' });
    const aprobador = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'APROBADOR' } });
    await service.updateUsuario({ id: eva.id, roleId: aprobador.id } as any);

    const filas = await avisos(eva.id);
    const suyo = filas.find((f) => f.userId === eva.id)!;
    expect(suyo.titulo).toContain('actualizada');
    expect(suyo.mensaje).toContain('APROBADOR');
  });

  it('updateUsuario: sin cambio de rol ni estado, no notifica', async () => {
    const uma = await env.usuario('uma', 'LIDER', { agenciaId: agencia.id, name: 'Uma' });
    await service.updateUsuario({ id: uma.id, name: 'Uma', lastname: 'Nueva' } as any);
    // Se da tiempo a que un envío tardío aparezca; no debe aparecer ninguno.
    await new Promise((ok) => setTimeout(ok, 500));
    expect(await env.prisma.notification.count({ where: { entidadId: uma.id } })).toBe(0);
  });
});
