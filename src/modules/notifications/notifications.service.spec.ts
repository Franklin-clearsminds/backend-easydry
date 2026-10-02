import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NotificationsService } from './notifications.service.js';
import { NotificationsGateway } from './notifications.gateway.js';

function build() {
  const prisma: any = {
    syncDevice: { findMany: vi.fn().mockResolvedValue([]) },
    notification: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const gateway = { emitToUsers: vi.fn() } as unknown as NotificationsGateway;
  const service = new NotificationsService(prisma, gateway);
  return { service, prisma, gateway };
}

describe('NotificationsService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: () => Promise.resolve({}) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('notificarUsuarios', () => {
    it('sin opts.tipo, solo manda push: no persiste ni emite por WS', async () => {
      const { service, prisma, gateway } = build();
      await service.notificarUsuarios(['u1'], 'Título', 'Cuerpo');
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(gateway.emitToUsers).not.toHaveBeenCalled();
    });

    it('con opts.tipo, persiste una notificación por usuario y emite por WS', async () => {
      const { service, prisma, gateway } = build();
      await service.notificarUsuarios(['u1', 'u2'], 'Título', 'Cuerpo', { x: 1 }, {
        tipo: 'INCIDENTE_NUEVO', entidadTipo: 'MAQUINARIA', entidadId: 'm1',
      });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'u1', tipo: 'INCIDENTE_NUEVO', titulo: 'Título', mensaje: 'Cuerpo', data: { x: 1 }, entidadTipo: 'MAQUINARIA', entidadId: 'm1' },
          { userId: 'u2', tipo: 'INCIDENTE_NUEVO', titulo: 'Título', mensaje: 'Cuerpo', data: { x: 1 }, entidadTipo: 'MAQUINARIA', entidadId: 'm1' },
        ],
      });
      expect(gateway.emitToUsers).toHaveBeenCalledWith(['u1', 'u2'], 'notification:new', expect.objectContaining({
        tipo: 'INCIDENTE_NUEVO', entidadId: 'm1', leida: false,
      }));
    });

    it('deduplica ids repetidos', async () => {
      const { service, prisma } = build();
      await service.notificarUsuarios(['u1', 'u1'], 'T', 'B', undefined, { tipo: 'STOCK_CRITICO' });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: 'u1' })] });
    });

    it('nunca lanza: si falla la persistencia, solo se loguea (no rompe el flujo del caller)', async () => {
      const { service, prisma } = build();
      prisma.notification.createMany.mockRejectedValue(new Error('db caída'));
      await expect(
        service.notificarUsuarios(['u1'], 'T', 'B', undefined, { tipo: 'STOCK_CRITICO' }),
      ).resolves.toBeUndefined();
    });

    it('lista vacía: no hace ninguna consulta', async () => {
      const { service, prisma } = build();
      await service.notificarUsuarios([], 'T', 'B');
      expect(prisma.syncDevice.findMany).not.toHaveBeenCalled();
    });
  });

  describe('notificarCoordinadorRegion', () => {
    it('reenvía opts a notificarUsuarios', async () => {
      const { service, prisma } = build();
      prisma.user.findMany.mockResolvedValue([{ id: 'coord-1' }]);
      await service.notificarCoordinadorRegion({
        regionId: 'costa', title: 'T', body: 'B',
        opts: { tipo: 'MANTENIMIENTO_VENCIDO', entidadTipo: 'MAQUINARIA', entidadId: 'm1' },
      });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 'coord-1', tipo: 'MANTENIMIENTO_VENCIDO' })],
      });
    });

    it('sin regionId, no hace nada', async () => {
      const { service, prisma } = build();
      await service.notificarCoordinadorRegion({ regionId: null, title: 'T', body: 'B' });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('notificarAlertaStock', () => {
    it('delega en notificarUsuarios con tipo STOCK_CRITICO (ya no duplica la consulta de push)', async () => {
      const { service, prisma } = build();
      prisma.user.findMany.mockResolvedValue([{ id: 'bod-1' }]);
      await service.notificarAlertaStock({ insumoNombre: 'Shampoo', nivel: 'CRITICO', entidadId: 'ins-1' });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ userId: 'bod-1', tipo: 'STOCK_CRITICO', entidadId: 'ins-1' })],
      });
    });
  });

  describe('lectura (siempre filtrada por userId)', () => {
    it('list incluye el userId en el where', async () => {
      const { service, prisma } = build();
      await service.list({} as never, 'u1');
      const where = prisma.notification.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
    });

    it('marcarLeida filtra por id Y userId (no puede marcar notificaciones ajenas)', async () => {
      const { service, prisma } = build();
      await service.marcarLeida('n1', 'u1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        data: expect.objectContaining({ leida: true }),
      });
    });

    it('marcarTodasLeidas filtra por userId y leida:false', async () => {
      const { service, prisma } = build();
      await service.marcarTodasLeidas('u1');
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', leida: false },
        data: expect.objectContaining({ leida: true }),
      });
    });

    it('resumen cuenta solo las no leídas del usuario', async () => {
      const { service, prisma } = build();
      prisma.notification.count.mockResolvedValue(3);
      const r = await service.resumen('u1');
      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: 'u1', leida: false } });
      expect(r).toEqual({ success: true, pendientes: 3 });
    });
  });
});
