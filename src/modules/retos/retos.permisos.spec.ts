import { describe, expect, it, vi } from 'vitest';
import { RetosService } from './retos.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function armar(existente: any = null, agenciasEnRegion = 1) {
  const prisma: any = {
    reto: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'r1', ...a.data })),
      findUnique: vi.fn().mockResolvedValue(existente),
      delete: vi.fn().mockResolvedValue({}),
    },
    agencia: { count: vi.fn().mockResolvedValue(agenciasEnRegion) },
  };
  return { prisma, service: new RetosService(prisma) };
}
const dto = (extra: Record<string, unknown> = {}) => ({ titulo: 'Reto', fechaInicio: '2026-10-01', fechaFin: '2026-10-31', ...extra }) as any;

describe('RetosService.create', () => {
  it('administradores y jefe comercial crean retos nacionales o de cualquier región', async () => {
    for (const rol of ['SUPER_ADMIN', 'ADMIN', 'JEFE_COMERCIAL']) {
      const { prisma, service } = armar();
      await service.create(dto({ regiones: ['Costa', 'Sierra'] }), usuario(rol));
      expect(prisma.reto.create.mock.calls[0][0].data.regiones).toEqual(['Costa', 'Sierra']);
    }
  });

  it('el coordinador comercial solo crea retos para su región', async () => {
    const yo = usuario('COORD_COMERCIAL', { regionId: 'r1', region: { nombre: 'Costa' } });
    const { prisma, service } = armar();
    await service.create(dto({ regiones: ['costa'] }), yo);
    expect(prisma.reto.create).toHaveBeenCalled();
    await expect(armar().service.create(dto({ regiones: ['Sierra'] }), yo)).rejects.toThrow(/tu región/);
    await expect(armar().service.create(dto({ regiones: ['Costa', 'Sierra'] }), yo)).rejects.toThrow(/tu región/);
    await expect(armar().service.create(dto({ regiones: [] }), yo)).rejects.toThrow(/tu región/);
    await expect(armar().service.create(dto({ regiones: ['Todas'] }), yo)).rejects.toThrow(/tu región/);
  });

  it('el coordinador solo elige agencias de su región y necesita tener región', async () => {
    const yo = usuario('COORD_COMERCIAL', { regionId: 'r1', region: { nombre: 'Costa' } });
    await expect(armar(null, 0).service.create(dto({ regiones: ['Costa'], sucursalesIds: ['a9'] }), yo)).rejects.toThrow(/no pertenecen a tu región/);
    await expect(armar().service.create(dto({ regiones: ['Costa'] }), usuario('COORD_COMERCIAL'))).rejects.toThrow(/región asignada/);
  });

  it('rechaza fechas al revés', async () => {
    await expect(armar().service.create(dto({ fechaInicio: '2026-11-01', fechaFin: '2026-10-01' }), usuario('ADMIN'))).rejects.toThrow(/fecha de fin/);
  });
});

describe('RetosService.list', () => {
  it('administradores y jefe comercial ven todos; el resto solo los de su región o agencia', async () => {
    for (const rol of ['ADMIN', 'JEFE_COMERCIAL']) {
      const { prisma, service } = armar();
      await service.list({} as any, usuario(rol));
      expect(JSON.stringify(prisma.reto.findMany.mock.calls[0][0].where)).not.toContain('sucursalesIds');
    }
    const { prisma, service } = armar();
    await service.list({} as any, usuario('LIDER', { agenciaId: 'a1', region: { nombre: 'Costa' } }));
    const txt = JSON.stringify(prisma.reto.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"sucursalesIds":{"has":"a1"}');
    expect(txt).toContain('"regiones":{"has":"Costa"}');
  });
});

describe('RetosService.delete', () => {
  it('lo elimina su creador o un administrador; nadie más', async () => {
    const mio = { id: 'r1', creadoPorId: 'id-COORD_COMERCIAL' };
    await expect(armar(mio).service.delete('r1', usuario('COORD_COMERCIAL'))).resolves.toMatchObject({ success: true });
    await expect(armar(mio).service.delete('r1', usuario('ADMIN'))).resolves.toMatchObject({ success: true });
    await expect(armar(mio).service.delete('r1', usuario('JEFE_COMERCIAL'))).rejects.toThrow(/creador o un administrador/);
  });
});
