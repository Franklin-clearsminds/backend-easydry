import { FUNCION, rolConFuncion } from '../../common/permisos/funciones.js';
import { describe, expect, it, vi } from 'vitest';
import { MaintenanceCronService } from './maintenance-cron.service.js';

const DAY = 86_400_000;

/** Miércoles (3) o sábado (6) más próximo hacia atrás, para que los tests no dependan del día real. */
function miercolesOSabado(desde = new Date()): Date {
  const d = new Date(desde);
  while (d.getDay() !== 3 && d.getDay() !== 6) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function build(prismaOver: Record<string, any> = {}) {
  const prisma: any = {
    syncOutboxAudit: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    mantenimientoMaquinaria: { findMany: vi.fn().mockResolvedValue([]) },
    maquinaria: { findMany: vi.fn().mockResolvedValue([]) },
    limpiezaMaquinaria: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    notification: { findFirst: vi.fn().mockResolvedValue(null) },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    ...prismaOver,
  };
  const notifications = {
    notificarCoordinadorRegion: vi.fn().mockResolvedValue(undefined),
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MaintenanceCronService(prisma, notifications as never);
  return { service, prisma, notifications };
}

describe('MaintenanceCronService', () => {
  describe('recordatorioLimpiezaDelDia', () => {
    it('avisa al pulidor asignado si hoy le toca y todavía no registró', async () => {
      const { service, prisma, notifications } = build({
        maquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'm1', codigo: 'MQ-01', nombre: 'Hidro', agenciaId: null, operadorAsignadoId: 'pul-1', agencia: null },
          ]),
        },
      });
      const r = await service.recordatorioLimpiezaDelDia();
      expect(notifications.notificarUsuarios).toHaveBeenCalledWith(
        ['pul-1'], expect.stringContaining('MQ-01'), expect.any(String),
        expect.objectContaining({ type: 'LIMPIEZA_RECORDATORIO' }),
        { tipo: 'LIMPIEZA_RECORDATORIO', entidadTipo: 'MAQUINARIA', entidadId: 'm1' },
      );
      expect(r).toEqual({ count: 1 });
    });

    it('no avisa si la máquina ya tiene registro de limpieza hoy', async () => {
      const { service, notifications } = build({
        maquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'm1', codigo: 'MQ-01', nombre: 'Hidro', agenciaId: null, operadorAsignadoId: 'pul-1', agencia: null },
          ]),
        },
        limpiezaMaquinaria: { findMany: vi.fn().mockResolvedValue([{ maquinariaId: 'm1' }]), groupBy: vi.fn() },
      });
      await service.recordatorioLimpiezaDelDia();
      expect(notifications.notificarUsuarios).not.toHaveBeenCalled();
    });

    it('avisa al líder de la agencia cuando la regla es de agencia y hoy es miércoles o sábado', async () => {
      const diaDebido = miercolesOSabado();
      vi.useFakeTimers();
      vi.setSystemTime(diaDebido);
      try {
        const { service, prisma, notifications } = build({
          maquinaria: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'm1', codigo: 'MQ-01', nombre: 'Hidro', agenciaId: 'ag-1', operadorAsignadoId: null, agencia: { regionId: 'costa' } },
            ]),
          },
          user: { findMany: vi.fn().mockResolvedValue([{ id: 'lider-1' }]) },
        });
        await service.recordatorioLimpiezaDelDia();
        expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: expect.objectContaining({ agenciaId: 'ag-1', role: rolConFuncion(FUNCION.LIDER_AGENCIA) }),
        }));
        expect(notifications.notificarUsuarios).toHaveBeenCalledWith(['lider-1'], expect.any(String), expect.any(String), expect.any(Object), expect.any(Object));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('escalarLimpiezaAtrasada', () => {
    it('escala al coordinador de mantenimiento la primera vez que detecta el atraso', async () => {
      const { service, prisma, notifications } = build({
        maquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'm1', codigo: 'MQ-01', nombre: 'Hidro', agenciaId: null, operadorAsignadoId: 'pul-1', agencia: null },
          ]),
        },
        limpiezaMaquinaria: {
          findMany: vi.fn(),
          groupBy: vi.fn().mockResolvedValue([{ maquinariaId: 'm1', _max: { fecha: new Date(Date.now() - 2 * DAY) } }]),
        },
        notification: { findFirst: vi.fn().mockResolvedValue(null) },
      });
      const r = await service.escalarLimpiezaAtrasada();
      expect(notifications.notificarCoordinadorRegion).toHaveBeenCalledWith(expect.objectContaining({
        opts: { tipo: 'LIMPIEZA_ATRASADA', entidadTipo: 'MAQUINARIA', entidadId: 'm1' },
      }));
      expect(r).toEqual({ count: 1 });
    });

    it('no duplica si ya se avisó este mismo episodio de atraso', async () => {
      const { service, notifications } = build({
        maquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'm1', codigo: 'MQ-01', nombre: 'Hidro', agenciaId: null, operadorAsignadoId: 'pul-1', agencia: null },
          ]),
        },
        limpiezaMaquinaria: {
          findMany: vi.fn(),
          groupBy: vi.fn().mockResolvedValue([{ maquinariaId: 'm1', _max: { fecha: new Date(Date.now() - 2 * DAY) } }]),
        },
        notification: { findFirst: vi.fn().mockResolvedValue({ id: 'notif-ya-avisada' }) },
      });
      const r = await service.escalarLimpiezaAtrasada();
      expect(notifications.notificarCoordinadorRegion).not.toHaveBeenCalled();
      expect(r).toEqual({ count: 0 });
    });

    it('no hace nada si ninguna máquina candidata está atrasada', async () => {
      const { service, notifications } = build({
        maquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'm1', codigo: 'MQ-01', nombre: 'Hidro', agenciaId: null, operadorAsignadoId: 'pul-1', agencia: null },
          ]),
        },
        limpiezaMaquinaria: {
          findMany: vi.fn(),
          groupBy: vi.fn().mockResolvedValue([{ maquinariaId: 'm1', _max: { fecha: new Date() } }]), // limpiada hoy
        },
      });
      const r = await service.escalarLimpiezaAtrasada();
      expect(notifications.notificarCoordinadorRegion).not.toHaveBeenCalled();
      expect(r).toEqual({ count: 0 });
    });
  });

  describe('verificarMantenimientosVencidos (existente, con el nuevo opts)', () => {
    it('pasa opts.tipo MANTENIMIENTO_VENCIDO a notificarCoordinadorRegion', async () => {
      const { service, notifications } = build({
        mantenimientoMaquinaria: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'mt1', maquinariaId: 'm1', fechaProgramada: new Date(Date.now() - DAY), maquinaria: { codigo: 'MQ-01', nombre: 'Hidro', agencia: { regionId: 'costa' } } },
          ]),
        },
      });
      await service.verificarMantenimientosVencidos();
      expect(notifications.notificarCoordinadorRegion).toHaveBeenCalledWith(expect.objectContaining({
        opts: { tipo: 'MANTENIMIENTO_VENCIDO', entidadTipo: 'MAQUINARIA', entidadId: 'm1' },
      }));
    });
  });
});
