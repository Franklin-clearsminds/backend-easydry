import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventarioService } from './inventario.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el servicio de notificaciones es el real y escribe en `Notification`.
 *
 * `notificarConfirmacionDespacho` es privado: se prueba directo (sin pasar por todo el flujo SQL de `confirmarRecepcion`)
 * porque es la pieza nueva de esa sesión y el resto del método es un flujo de SQL crudo ya existente y no relacionado
 * con la notificación. Los avisos también llegan a los administradores reales de la base; el entorno los borra al cerrar.
 */
describe('InventarioService.notificarConfirmacionDespacho (base real)', () => {
  let env: Entorno;
  let service: any;
  let regionOrigen: any;
  let regionBodega: any;
  let agenciaOrigen: any;
  let bodegaOrigen: any;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never, env.notificaciones()) as any;

    regionOrigen = await env.region('ORIGEN');
    regionBodega = await env.region('BODEGA');
    agenciaOrigen = await env.agencia('ORIGEN', { regionId: regionOrigen.id });
    bodegaOrigen = await env.bodega('ORIGEN', { regionId: regionBodega.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await crear('despacha', 'LIDER', { agenciaId: agenciaOrigen.id });
    await crear('admin', 'ADMIN');
    await crear('coordBodega', 'COORD_BODEGA');
    await crear('asistenteOrigen', 'ASISTENTE_BODEGA', { regionId: regionOrigen.id });
    await crear('supervisorOrigen', 'SUPERVISOR', { regionId: regionOrigen.id });
    await crear('supervisorBodega', 'SUPERVISOR', { regionId: regionBodega.id });
    await crear('lavador', 'LAVADOR', { agenciaId: agenciaOrigen.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  /** Un movimiento real; los avisos se guardan con su id como `entidadId`. */
  const nuevoMovimiento = async () => ({
    ...(await env.movimiento({ usuarioDespachaId: ids.despacha, origenAgenciaId: agenciaOrigen.id })),
    usuarioDespachaId: ids.despacha as string | null,
  });
  /** Espera los avisos (el envío es "fire-and-forget") y devuelve las filas y a quién llegaron. */
  const avisos = async (movimientoId: string) => {
    const filas = await env.esperar(async () => {
      const f = await env.prisma.notification.findMany({ where: { entidadTipo: 'MOVIMIENTO_INVENTARIO', entidadId: movimientoId } });
      return f.length ? f : null;
    });
    return { filas, destinatarios: new Set(filas.map((f) => f.userId)) };
  };

  it('despacho recibido: avisa a quien despachó, a admin/super admin/coord bodega y a asistente/supervisor de la región de origen (agencia)', async () => {
    const m = await nuevoMovimiento();
    await service.notificarConfirmacionDespacho(m, 'RECIBIDO', agenciaOrigen.id, null, '');

    const { filas, destinatarios } = await avisos(m.id);
    const faltan = ['despacha', 'admin', 'coordBodega', 'asistenteOrigen', 'supervisorOrigen'].filter((c) => !destinatarios.has(ids[c]));
    expect(faltan).toEqual([]);
    expect(destinatarios.has(ids.supervisorBodega)).toBe(false); // supervisor de otra región
    expect(destinatarios.has(ids.lavador)).toBe(false);
    expect(filas[0].titulo).toContain('recibido');
    expect(filas[0].mensaje).toContain(m.numeroGuia);
    expect(filas[0].tipo).toBe('DESPACHO_CONFIRMADO');
  });

  it('origen bodega (no agencia): resuelve la región desde la bodega', async () => {
    const m = { ...(await env.movimiento({ usuarioDespachaId: ids.despacha, origenBodegaId: bodegaOrigen.id })), usuarioDespachaId: ids.despacha as string | null };
    await service.notificarConfirmacionDespacho(m, 'RECIBIDO', null, bodegaOrigen.id, '');

    const { destinatarios } = await avisos(m.id);
    expect(destinatarios.has(ids.supervisorBodega)).toBe(true); // la región de la bodega
    expect(destinatarios.has(ids.supervisorOrigen)).toBe(false); // la región de la agencia no
  });

  it('despacho rechazado: el mensaje incluye el motivo', async () => {
    const m = await nuevoMovimiento();
    await service.notificarConfirmacionDespacho(m, 'RECHAZADO', agenciaOrigen.id, null, 'Producto dañado');

    const { filas } = await avisos(m.id);
    expect(filas[0].titulo).toContain('rechazado');
    expect(filas[0].mensaje).toContain('Producto dañado');
  });

  it('sin usuarioDespachaId no debería invocarse (lo valida el caller), pero si se invoca igual no revienta', async () => {
    const m = await nuevoMovimiento();
    await expect(
      service.notificarConfirmacionDespacho({ ...m, usuarioDespachaId: null }, 'RECIBIDO', agenciaOrigen.id, null, ''),
    ).resolves.toBeUndefined();

    const { destinatarios } = await avisos(m.id);
    expect(destinatarios.has(ids.despacha)).toBe(false); // nadie despachó: no se le avisa a nadie por ese concepto
    expect(destinatarios.has(ids.admin)).toBe(true); // el resto de destinatarios sí
  });
});
