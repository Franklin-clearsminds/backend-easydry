import { describe, expect, it, vi } from 'vitest';
import { InventarioService } from './inventario.service.js';

/**
 * `notificarConfirmacionDespacho` es privado: se prueba directo (sin pasar por todo el flujo SQL de
 * `confirmarRecepcion`) porque es la pieza nueva de esta sesión y el resto del método es un flujo de
 * SQL crudo ya existente y no relacionado con la notificación.
 */
function armar() {
  const prisma: any = {
    agencia: { findUnique: vi.fn().mockResolvedValue({ regionId: 'r1' }) },
    bodega: { findUnique: vi.fn().mockResolvedValue({ regionId: 'r2' }) },
  };
  const notifications = {
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
    resolverDestinatariosPorRol: vi.fn().mockResolvedValue(['admin-1', 'coord-bod-1']),
  };
  const service = new InventarioService(prisma, notifications as any) as any;
  return { prisma, notifications, service };
}

const movimiento = { id: 'mov-1', numeroGuia: 'GUI-001', usuarioDespachaId: 'desp-1' };

describe('InventarioService.notificarConfirmacionDespacho', () => {
  it('despacho recibido: avisa a quien despachó + admin/super admin/coord bodega/asistente bodega/supervisor de la región de origen (agencia)', async () => {
    const { prisma, notifications, service } = armar();
    await service.notificarConfirmacionDespacho(movimiento, 'RECIBIDO', 'ag-origen', null, '');

    expect(prisma.agencia.findUnique).toHaveBeenCalledWith({ where: { id: 'ag-origen' }, select: { regionId: true } });
    expect(notifications.resolverDestinatariosPorRol).toHaveBeenCalledWith({
      global: ['ADMIN', 'SUPER_ADMIN', 'COORD_BODEGA'],
      regionales: ['ASISTENTE_BODEGA', 'SUPERVISOR'],
      regionId: 'r1',
    });
    const [ids, titulo, body] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(expect.arrayContaining(['desp-1', 'admin-1', 'coord-bod-1']));
    expect(titulo).toContain('recibido');
    expect(body).toContain('GUI-001');
  });

  it('origen bodega (no agencia): resuelve la región desde la bodega', async () => {
    const { prisma, notifications, service } = armar();
    await service.notificarConfirmacionDespacho(movimiento, 'RECIBIDO', null, 'bod-origen', '');
    expect(prisma.bodega.findUnique).toHaveBeenCalledWith({ where: { id: 'bod-origen' }, select: { regionId: true } });
    expect(notifications.resolverDestinatariosPorRol.mock.calls[0][0].regionId).toBe('r2');
  });

  it('despacho rechazado: el mensaje incluye el motivo', async () => {
    const { notifications, service } = armar();
    await service.notificarConfirmacionDespacho(movimiento, 'RECHAZADO', 'ag-origen', null, 'Producto dañado');
    const [, titulo, body] = notifications.notificarUsuarios.mock.calls[0];
    expect(titulo).toContain('rechazado');
    expect(body).toContain('Producto dañado');
  });

  it('sin usuarioDespachaId no debería invocarse (lo valida el caller), pero si se invoca igual no revienta', async () => {
    const { notifications, service } = armar();
    await service.notificarConfirmacionDespacho({ ...movimiento, usuarioDespachaId: null }, 'RECIBIDO', 'ag-origen', null, '');
    const [ids] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).not.toContain(null);
  });
});
