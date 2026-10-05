import { describe, expect, it, vi } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function servicio(estado = 'FINALIZADO', extra: Record<string, unknown> = {}) {
  return {
    id: 's1', estado, deletedAt: null, version: 1, operadorId: 'lav-1', placa: 'ABC-123', ordenTrabajoOT: 'OT-1',
    observaciones: null, observacionGerente: null,
    bahia: { agenciaId: 'a1', agencia: { id: 'a1', regionId: 'r1', nombre: 'Uno', codigo: 'A1' } },
    consumos: [], evidencias: [], catalogo: {}, operador: { id: 'lav-1' },
    ...extra,
  };
}

function armar(svc: any = servicio()) {
  const prisma: any = {
    servicioLavado: {
      findFirst: vi.fn().mockResolvedValue(svc),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...svc, ...a.data })),
    },
    agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', regionId: 'r1', nombre: 'Uno' }) },
    user: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([{ id: 'lider-1' }]),
    },
    auditoriaDecision: { create: vi.fn().mockResolvedValue({}) },
    evidenciaServicio: { create: vi.fn().mockResolvedValue({}) },
  };
  const notifications = {
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
    resolverDestinatariosPorRol: vi.fn().mockResolvedValue(['admin-1', 'super-1']),
  };
  const service = new OperacionesService(prisma, notifications as any, new DecisionesService(prisma));
  return { prisma, notifications, service };
}

describe('OperacionesService — notificación de decisión de servicio', () => {
  it('al aprobar, avisa al operador + líder de la agencia + admin/super admin/supervisor', async () => {
    const { prisma, notifications, service } = armar();
    await service.aprobarServicio('s1', 'ok', usuario('ADMIN'));

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { estado: 1, agenciaId: 'a1', role: { namerol: 'LIDER' } },
      select: { id: true },
    });
    expect(notifications.resolverDestinatariosPorRol).toHaveBeenCalledWith({
      global: ['ADMIN', 'SUPER_ADMIN'],
      regionales: ['SUPERVISOR'],
      regionId: 'r1',
    });
    const [ids, , body] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(expect.arrayContaining(['lav-1', 'lider-1', 'admin-1', 'super-1']));
    expect(body).toContain('aprobado');
  });

  it('al rechazar, el mensaje dice "rechazado"', async () => {
    const { notifications, service } = armar();
    await service.rechazarServicio('s1', 'Falta evidencia', usuario('ADMIN'));
    const [, , body] = notifications.notificarUsuarios.mock.calls[0];
    expect(body).toContain('rechazado');
  });

  it('al anular (softDelete con actor), el mensaje dice "anulado"', async () => {
    const { notifications, service } = armar(servicio('FINALIZADO'));
    await service.softDelete('s1', 'Duplicado', true, usuario('ADMIN'));
    const [, , body] = notifications.notificarUsuarios.mock.calls[0];
    expect(body).toContain('anulado');
  });

  it('softDelete sin actor (uso interno) no notifica', async () => {
    const { notifications, service } = armar(servicio('FINALIZADO', { consumos: [] }));
    await service.softDelete('s1', undefined, false);
    expect(notifications.notificarUsuarios).not.toHaveBeenCalled();
  });
});
