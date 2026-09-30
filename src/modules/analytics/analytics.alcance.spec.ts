import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function armar() {
  const prisma: any = {
    servicioLavado: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    incidenteTecnico: { count: vi.fn().mockResolvedValue(0) },
    alertaStock: { count: vi.fn().mockResolvedValue(0) },
    maquinaria: { groupBy: vi.fn().mockResolvedValue([]) },
    consumoServicio: { findMany: vi.fn().mockResolvedValue([]) },
    agencia: { findMany: vi.fn().mockResolvedValue([{ id: 'a1' }]) },
  };
  return { prisma, service: new AnalyticsService(prisma) };
}
const dondeServicios = (prisma: any) => JSON.stringify(prisma.servicioLavado.findMany.mock.calls[0][0].where);

describe('dashboard — alcance', () => {
  it('cada rol ve solo su agencia o su región; el cliente solo acota dentro de su alcance', async () => {
    const a = armar();
    await a.service.getDashboardMetrics({ agenciaId: 'a-ajena' } as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(dondeServicios(a.prisma)).toContain('"id":"a1"');
    expect(dondeServicios(a.prisma)).not.toContain('a-ajena');

    const b = armar();
    await b.service.getDashboardMetrics({ regionId: 'r-ajena' } as any, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(dondeServicios(b.prisma)).toContain('"regionId":"r1"');
    expect(dondeServicios(b.prisma)).not.toContain('r-ajena');
  });

  it('administradores y jefe comercial ven todo el país o lo que pidan', async () => {
    const a = armar();
    await a.service.getDashboardMetrics({} as any, usuario('JEFE_COMERCIAL'));
    expect(dondeServicios(a.prisma)).not.toContain('agencia');
    const b = armar();
    await b.service.getDashboardMetrics({ regionId: 'r2' } as any, usuario('ADMIN'));
    expect(dondeServicios(b.prisma)).toContain('"regionId":"r2"');
  });

  it('un rol de agencia sin agencia no ve nada, en ninguna de las consultas', async () => {
    const { prisma, service } = armar();
    await service.getDashboardMetrics({ agenciaId: 'a1' } as any, usuario('APROBADOR'));
    expect(dondeServicios(prisma)).toContain('"id":{"in":[]}');
    expect(JSON.stringify(prisma.incidenteTecnico.count.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
    expect(JSON.stringify(prisma.alertaStock.count.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
    expect(JSON.stringify(prisma.maquinaria.groupBy.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
  });
});

describe('consumo de químicos — alcance', () => {
  it('se limita a las agencias de su alcance', async () => {
    const a = armar();
    await a.service.getConsumoQuimicos({ agenciaId: 'a-ajena' } as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(a.prisma.agencia.findMany.mock.calls[0][0].where).toEqual({ id: 'a1' });
    expect(a.prisma.consumoServicio.findMany.mock.calls[0][0].where.agenciaId).toEqual({ in: ['a1'] });
    const b = armar();
    await b.service.getConsumoQuimicos({} as any, usuario('ADMIN'));
    expect(b.prisma.consumoServicio.findMany.mock.calls[0][0].where).not.toHaveProperty('agenciaId');
  });
});
