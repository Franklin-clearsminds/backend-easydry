import { describe, expect, it, vi } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';

const admin = { id: 'admin-1', name: 'Admin', lastname: 'EasyDry', role: { namerol: 'ADMIN' }, roleDetails: { namerol: 'ADMIN', capacidades: [], ambito: 'GLOBAL' } };

function armar() {
  const prisma: any = {
    servicioEspecial: {
      findFirst: vi.fn().mockResolvedValue(null), // sin OT duplicada
      findUnique: vi.fn(),
      create: vi.fn().mockImplementation(async (a: any) => ({ ...a.data })),
      update: vi.fn().mockImplementation(async (a: any) => ({ id: a.where.id, ...a.data })),
    },
    agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', regionId: 'r1' }) },
    user: {
      findUnique: vi.fn().mockResolvedValue({ estado: 1, regionId: 'r1', agencia: null, role: { namerol: 'PULIDOR' } }),
      findFirst: vi.fn().mockResolvedValue(null), // sin pulidor fijo
    },
    stockUbicacion: { findMany: vi.fn().mockResolvedValue([{ insumoId: 'ins1', cantidadActual: 50, insumo: { id: 'ins1', nombre: 'Cera' } }]) },
    catalogoServicio: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue(null) },
    auditoriaDecision: { create: vi.fn().mockResolvedValue({}) },
  };
  const notifications = {
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
    resolverDestinatariosPorRol: vi.fn().mockResolvedValue(['admin-1', 'super-1', 'coord-esp-1']),
  };
  const service = new ServiciosEspecialesService(prisma, new DecisionesService(prisma), notifications as any);
  return { prisma, notifications, service };
}

const dtoBase = (extra: Record<string, unknown> = {}) => ({
  ordenTrabajoOT: 'SE-OT-1',
  tipoServicio: 'Pulido',
  agenciaId: 'a1',
  operadorId: 'pul-1',
  vehiculoInfo: { placa: 'XYZ-999' },
  recetaInsumos: [{ insumoId: 'ins1', cantidad: 0 }],
  ...extra,
}) as any;

describe('ServiciosEspecialesService — notificación de asignación', () => {
  it('create(): avisa al pulidor asignado cuando no es quien crea la OT', async () => {
    const { notifications, service } = armar();
    await service.create(dtoBase(), admin.id, admin);
    expect(notifications.notificarUsuarios).toHaveBeenCalledWith(
      ['pul-1'],
      expect.stringContaining('Nuevo servicio especial'),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ tipo: 'SERVICIO_ESPECIAL_ASIGNADO' }),
    );
  });

  it('create(): no se notifica a sí mismo si el pulidor se autoasigna', async () => {
    const { notifications, service } = armar();
    const pulidor = { id: 'pul-1', name: 'Pedro', lastname: 'P', role: { namerol: 'PULIDOR' }, roleDetails: { namerol: 'PULIDOR', capacidades: [], ambito: 'AGENCIA' }, agenciaId: 'a1' };
    await service.create(dtoBase({ operadorId: undefined }), 'pul-1', pulidor);
    expect(notifications.notificarUsuarios).not.toHaveBeenCalled();
  });

  it('reasignar(): avisa al nuevo pulidor asignado', async () => {
    const { prisma, notifications, service } = armar();
    prisma.servicioEspecial.findFirst.mockResolvedValue({
      id: 'se1', version: 1, estado: 'Pendiente', agenciaId: 'a1', regionId: 'r1', operadorId: 'pul-viejo',
      recetaInsumos: [{ insumoId: 'ins1', cantidad: 0 }], tipoServicio: 'Pulido', placa: 'XYZ-999',
      agencia: { id: 'a1', regionId: 'r1' },
    });
    await service.reasignar({ id: 'se1', operadorId: 'pul-nuevo' } as any, admin);
    expect(notifications.notificarUsuarios).toHaveBeenCalledWith(
      ['pul-nuevo'],
      expect.stringContaining('reasignado'),
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ tipo: 'SERVICIO_ESPECIAL_ASIGNADO' }),
    );
  });
});

describe('ServiciosEspecialesService — notificación de cierre', () => {
  function servicioActivo(extra: Record<string, unknown> = {}) {
    return {
      id: 'se1', version: 1, estado: 'En Proceso', agenciaId: 'a1', regionId: 'r1', operadorId: 'pul-1',
      tipoServicio: 'Pulido', placa: 'XYZ-999', ordenTrabajoOT: 'SE-OT-1', recetaInsumos: null,
      tiempoPausaTotalSeg: 0, historialPausas: [], fechaInicio: new Date(),
      ...extra,
    };
  }

  it('completar(): avisa a admin/super admin/coord especiales/supervisor de la región', async () => {
    const { prisma, notifications, service } = armar();
    const item = servicioActivo();
    prisma.servicioEspecial.findFirst.mockResolvedValue(item);
    prisma.servicioEspecial.update.mockImplementation(async (a: any) => ({ ...item, ...a.data }));
    await service.completar({ id: 'se1' } as any, admin);
    expect(notifications.resolverDestinatariosPorRol).toHaveBeenCalledWith({
      global: ['ADMIN', 'SUPER_ADMIN', 'COORD_SERVICIOS_ESPECIALES'],
      regionales: ['SUPERVISOR'],
      regionId: 'r1',
    });
    const [ids, titulo] = notifications.notificarUsuarios.mock.calls[0];
    expect(ids).toEqual(['admin-1', 'super-1', 'coord-esp-1']);
    expect(titulo).toContain('completado');
  });

  it('softDelete() con actor (anulación real): avisa el cierre como "cancelado"', async () => {
    const { prisma, notifications, service } = armar();
    const item = servicioActivo({ deletedAt: null });
    prisma.servicioEspecial.findFirst.mockResolvedValue(item);
    prisma.servicioEspecial.update.mockImplementation(async (a: any) => ({ ...item, ...a.data }));
    await service.softDelete('se1', 'Cliente canceló', admin);
    const [, titulo] = notifications.notificarUsuarios.mock.calls[0];
    expect(titulo).toContain('cancelado');
  });

  it('softDelete() sin actor (uso interno) no notifica', async () => {
    const { prisma, notifications, service } = armar();
    prisma.servicioEspecial.findFirst.mockResolvedValue(servicioActivo({ deletedAt: null }));
    await service.softDelete('se1');
    expect(notifications.notificarUsuarios).not.toHaveBeenCalled();
  });
});
