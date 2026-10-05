import { describe, expect, it, vi } from 'vitest';
import { AprobacionesService } from './aprobaciones.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function armar(solicitud: any = null, conAprobador = true) {
  const prisma: any = {
    solicitudAprobacion: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(solicitud),
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'n1', ...a.data })),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...solicitud, ...a.data })),
    },
    agencia: { findUnique: vi.fn().mockResolvedValue({ regionId: 'r1' }) },
    user: { count: vi.fn().mockResolvedValue(conAprobador ? 1 : 0) },
    auditoriaDecision: { create: vi.fn().mockResolvedValue({}) },
  };
  return { prisma, service: new AprobacionesService(prisma, new DecisionesService(prisma)) };
}
const pendiente = (extra: Record<string, unknown> = {}) => ({
  id: 'sol1', estado: 'PENDIENTE', tipo: 'AJUSTE_MERMA', solicitanteId: 'otro', agenciaId: 'a1', descripcion: null,
  agencia: { id: 'a1', regionId: 'r1' }, ...extra,
});
const whereDe = (prisma: any) => JSON.stringify(prisma.solicitudAprobacion.findMany.mock.calls[0][0].where);

describe('AprobacionesService.list — alcance', () => {
  it('el aprobador ve las de su agencia y las que hizo él, aunque pida otra agencia', async () => {
    const { prisma, service } = armar();
    await service.list({ agenciaId: 'a-ajena' } as any, usuario('APROBADOR', { agenciaId: 'a1' }));
    const w = whereDe(prisma);
    expect(w).toContain('"agenciaId":"a1"');
    expect(w).toContain('"solicitanteId":"id-APROBADOR"');
    expect(w).not.toContain('a-ajena');
  });

  it('el supervisor ve su región; un administrador ve todo y puede acotar por agencia', async () => {
    const a = armar();
    await a.service.list({} as any, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(whereDe(a.prisma)).toContain('"regionId":"r1"');
    const b = armar();
    await b.service.list({ agenciaId: 'a7' } as any, usuario('ADMIN'));
    expect(whereDe(b.prisma)).toContain('"agenciaId":"a7"');
  });

  it('sin agencia asignada solo ve las propias', async () => {
    const { prisma, service } = armar();
    await service.list({} as any, usuario('LIDER'));
    expect(whereDe(prisma)).toBe('{"solicitanteId":"id-LIDER"}');
  });

  it('la búsqueda no pisa el alcance', async () => {
    const { prisma, service } = armar();
    await service.list({ search: 'merma' } as any, usuario('APROBADOR', { agenciaId: 'a1' }));
    const where = prisma.solicitudAprobacion.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.AND[0].OR[0].titulo.contains).toBe('merma');
  });
});

describe('AprobacionesService.solicitar', () => {
  it('un usuario de agencia solicita siempre para la suya', async () => {
    const { prisma, service } = armar();
    await service.solicitar({ tipo: 'AJUSTE_MERMA', titulo: 't', agenciaId: 'a-ajena' } as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(prisma.solicitudAprobacion.create.mock.calls[0][0].data).toMatchObject({ agenciaId: 'a1', solicitanteId: 'id-LIDER' });
  });

  it('el supervisor solo solicita para agencias de su región', async () => {
    const { prisma, service } = armar();
    prisma.agencia.findUnique.mockResolvedValue({ regionId: 'r-otra' });
    await expect(service.solicitar({ tipo: 'X', titulo: 't', agenciaId: 'a9' } as any, usuario('SUPERVISOR', { regionId: 'r1' }))).rejects.toThrow(/tu región/);
  });

  it('sin agencia asignada no puede solicitar', async () => {
    const { service } = armar();
    await expect(service.solicitar({ tipo: 'X', titulo: 't' } as any, usuario('LIDER'))).rejects.toThrow(/agencia asignada/);
  });
});

describe('AprobacionesService — decidir', () => {
  it('el aprobador de la agencia aprueba como titular y queda registrado', async () => {
    const { prisma, service } = armar(pendiente());
    await service.aprobar({ solicitudId: 'sol1', notas: 'ok' } as any, usuario('APROBADOR', { agenciaId: 'a1' }));
    expect(prisma.solicitudAprobacion.update.mock.calls[0][0].data).toMatchObject({ estado: 'APROBADO', aprobadorId: 'id-APROBADOR' });
    expect(prisma.auditoriaDecision.create.mock.calls[0][0].data).toMatchObject({ entidad: 'SOLICITUD', accion: 'APROBAR', regla: 'TITULAR' });
  });

  it('nadie decide una solicitud que hizo él mismo', async () => {
    const { service } = armar(pendiente({ solicitanteId: 'id-APROBADOR' }));
    await expect(service.aprobar({ solicitudId: 'sol1' } as any, usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/que hiciste tú/);
  });

  it('un administrador no decide si la agencia tiene aprobador; sí si no lo tiene (respaldo)', async () => {
    await expect(armar(pendiente(), true).service.aprobar({ solicitudId: 'sol1' } as any, usuario('ADMIN'))).rejects.toThrow(/aprobador designado/);
    const { prisma, service } = armar(pendiente(), false);
    await service.aprobar({ solicitudId: 'sol1' } as any, usuario('ADMIN'));
    expect(prisma.auditoriaDecision.create.mock.calls[0][0].data.regla).toBe('RESPALDO');
  });

  it('una solicitud sin agencia solo la decide un administrador', async () => {
    const sinAgencia = pendiente({ agencia: null, agenciaId: null });
    await expect(armar(sinAgencia).service.aprobar({ solicitudId: 'sol1' } as any, usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/solo un administrador/);
    await expect(armar(sinAgencia).service.aprobar({ solicitudId: 'sol1' } as any, usuario('ADMIN'))).resolves.toBeDefined();
  });

  it('rechazar exige motivo; una solicitud ya decidida no se decide otra vez', async () => {
    await expect(armar(pendiente()).service.rechazar({ solicitudId: 'sol1' } as any, usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/motivo es obligatorio/);
    await expect(armar(pendiente({ estado: 'APROBADO' })).service.rechazar({ solicitudId: 'sol1', motivoRechazo: 'No procede' } as any, usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/ya se encuentra/);
    const { prisma, service } = armar(pendiente());
    await service.rechazar({ solicitudId: 'sol1', motivoRechazo: 'No procede' } as any, usuario('APROBADOR', { agenciaId: 'a1' }));
    expect(prisma.solicitudAprobacion.update.mock.calls[0][0].data).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'No procede' });
  });
});
