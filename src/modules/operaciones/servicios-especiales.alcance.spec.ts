import { describe, expect, it, vi } from 'vitest';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

const especial = (extra: Record<string, unknown> = {}) => ({
  id: 'e1', estado: 'Pendiente', deletedAt: null, version: 1, observaciones: null, agenciaId: 'a1', regionId: 'r1', operadorId: 'pul-9',
  recetaInsumos: null, tipoServicio: 'Pulido', agencia: { id: 'a1', regionId: 'r1' }, operador: null, region: null,
  ...extra,
});

function armar(item: any = especial()) {
  const prisma: any = {
    servicioEspecial: {
      findFirst: vi.fn().mockResolvedValue(item),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...item, ...a.data })),
      create: vi.fn().mockImplementation(async (a: any) => ({ ...a.data })),
    },
    servicioLavado: { findFirst: vi.fn().mockResolvedValue(null) },
    agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', regionId: 'r1' }) },
    user: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    stockUbicacion: { findMany: vi.fn().mockResolvedValue([]) },
    auditoriaDecision: { create: vi.fn().mockResolvedValue({}) },
  };
  return { prisma, service: new ServiciosEspecialesService(prisma, new DecisionesService(prisma)) };
}
const whereDe = (prisma: any) => JSON.stringify(prisma.servicioEspecial.findMany.mock.calls[0][0].where);

describe('servicios especiales — lectura por alcance', () => {
  it('el pulidor fijo ve los de su agencia; el móvil, solo los que tiene asignados', async () => {
    const a = armar();
    await a.service.findAll({} as any, usuario('PULIDOR', { agenciaId: 'a1', regionId: 'r1' }));
    expect(whereDe(a.prisma)).toContain('"agenciaId":"a1"');
    const b = armar();
    await b.service.findAll({} as any, usuario('PULIDOR', { regionId: 'r1' }));
    expect(whereDe(b.prisma)).toContain('"operadorId":"id-PULIDOR"');
  });

  it('el coordinador ve toda la red; el supervisor, su región; el aprobador, su agencia', async () => {
    const a = armar();
    await a.service.findAll({ agenciaId: 'a5' } as any, usuario('COORD_SERVICIOS_ESPECIALES'));
    expect(whereDe(a.prisma)).toContain('"agenciaId":"a5"');
    const b = armar();
    await b.service.findAll({} as any, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(whereDe(b.prisma)).toContain('"regionId":"r1"');
    const c = armar();
    await c.service.findAll({ agenciaId: 'a-ajena' } as any, usuario('APROBADOR', { agenciaId: 'a1' }));
    expect(whereDe(c.prisma)).toContain('"agenciaId":"a1"');
    expect(whereDe(c.prisma)).not.toContain('a-ajena');
  });

  it('sin datos de su ámbito no ve nada', async () => {
    const a = armar();
    await a.service.findAll({} as any, usuario('APROBADOR'));
    expect(whereDe(a.prisma)).toContain('"id":{"in":[]}');
  });

  it('el detalle exige que el servicio esté en su alcance', async () => {
    const { service } = armar();
    await expect(service.findOne('e1', usuario('APROBADOR', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
    await expect(service.findOne('e1', usuario('PULIDOR', { regionId: 'r1' }))).rejects.toThrow(/alcance/);
    await expect(service.findOne('e1', usuario('PULIDOR', { regionId: 'r1', id: 'pul-9' }))).resolves.toBeDefined();
    await expect(service.findOne('e1', usuario('SUPERVISOR', { regionId: 'r1' }))).resolves.toBeDefined();
    await expect(service.findOne('e1', usuario('COORD_SERVICIOS_ESPECIALES'))).resolves.toBeDefined();
  });
});

describe('servicios especiales — anular (no se borra)', () => {
  it('exige motivo y deja registrado quién, cuándo y por qué', async () => {
    const { prisma, service } = armar();
    await expect(service.softDelete('e1', '', usuario('COORD_SERVICIOS_ESPECIALES'))).rejects.toThrow(/motivo es obligatorio/);
    await service.softDelete('e1', 'Cliente canceló', usuario('COORD_SERVICIOS_ESPECIALES'));
    const data = prisma.servicioEspecial.update.mock.calls[0][0].data;
    expect(data.estado).toBe('Cancelado');
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(prisma.auditoriaDecision.create.mock.calls[0][0].data).toMatchObject({ entidad: 'SERVICIO_ESPECIAL', accion: 'ANULAR', motivo: 'Cliente canceló', usuarioId: 'id-COORD_SERVICIOS_ESPECIALES' });
  });

  it('el aprobador solo anula los de su agencia; uno ya anulado no se anula otra vez', async () => {
    await expect(armar().service.softDelete('e1', 'Duplicado', usuario('APROBADOR', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
    await expect(armar().service.softDelete('e1', 'Duplicado', usuario('APROBADOR', { agenciaId: 'a1' }))).resolves.toBeDefined();
    await expect(armar(especial({ deletedAt: new Date() })).service.softDelete('e1', 'Otra vez', usuario('ADMIN'))).rejects.toThrow(/ya está anulado/);
  });
});

describe('servicios especiales — reasignar', () => {
  it('solo a un pulidor activo de la misma región; sin comprobar nombres de rol sueltos', async () => {
    const a = armar();
    a.prisma.user.findUnique.mockResolvedValue({ estado: 1, regionId: 'r1', agencia: null, role: { namerol: 'LIDER' } });
    await expect(a.service.reasignar({ id: 'e1', operadorId: 'u2' } as any, usuario('COORD_SERVICIOS_ESPECIALES'))).rejects.toThrow(/pulidor activo/);
    const b = armar();
    b.prisma.user.findUnique.mockResolvedValue({ estado: 1, regionId: 'r-otra', agencia: null, role: { namerol: 'PULIDOR' } });
    await expect(b.service.reasignar({ id: 'e1', operadorId: 'u2' } as any, usuario('COORD_SERVICIOS_ESPECIALES'))).rejects.toThrow(/misma región/);
  });

  it('un servicio ya finalizado no se reasigna', async () => {
    const { service } = armar(especial({ estado: 'Completado' }));
    await expect(service.reasignar({ id: 'e1', operadorId: null } as any, usuario('COORD_SERVICIOS_ESPECIALES'))).rejects.toThrow(/finalizado o cancelado/);
  });

  it('si la agencia tiene pulidor fijo activo, no se puede reasignar a otro pulidor', async () => {
    const a = armar();
    a.prisma.user.findFirst.mockResolvedValue({ id: 'fijo-1' }); // la agencia a1 tiene un fijo
    await expect(a.service.reasignar({ id: 'e1', operadorId: 'movil-2' } as any, usuario('COORD_SERVICIOS_ESPECIALES')))
      .rejects.toThrow(/pulidor fijo asignado permanentemente/);
  });
});

describe('servicios especiales — pulidores y stock', () => {
  it('la lista de pulidores se acota al alcance: el aprobador no puede pedir otra agencia', async () => {
    const { prisma, service } = armar();
    await service.listarPulidoresPorRegion('r-ajena', 'a-ajena', usuario('APROBADOR', { agenciaId: 'a1' }));
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.agenciaId).toBe('a1');
    expect(JSON.stringify(where)).not.toContain('a-ajena');
    const b = armar();
    await b.service.listarPulidoresPorRegion('r-ajena', undefined, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(JSON.stringify(b.prisma.user.findMany.mock.calls[0][0].where)).toContain('r1');
    expect(JSON.stringify(b.prisma.user.findMany.mock.calls[0][0].where)).not.toContain('r-ajena');
  });

  it('el stock de un pulidor lo ve él, o quien tenga alcance sobre él', async () => {
    const propio = armar();
    await expect(propio.service.obtenerStockPulidor('id-PULIDOR', usuario('PULIDOR', { regionId: 'r1' }))).resolves.toEqual([]);
    const ajeno = armar();
    ajeno.prisma.user.findUnique.mockResolvedValue({ id: 'p2', agenciaId: 'a1', regionId: 'r1', agencia: { regionId: 'r1' } });
    await expect(ajeno.service.obtenerStockPulidor('p2', usuario('PULIDOR', { regionId: 'r1' }))).rejects.toThrow(/tu propio kit/);
    await expect(ajeno.service.obtenerStockPulidor('p2', usuario('COORD_SERVICIOS_ESPECIALES'))).resolves.toEqual([]);
    await expect(ajeno.service.obtenerStockPulidor('p2', usuario('APROBADOR', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
  });
});
