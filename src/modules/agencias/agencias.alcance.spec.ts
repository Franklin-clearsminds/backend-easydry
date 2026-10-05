import { describe, expect, it, vi } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

const BAHIA = { id: 'b1', agenciaId: 'a1', activa: true, agencia: { id: 'a1', regionId: 'r1' } };
const AGENCIA = { id: 'a1', regionId: 'r1', bahias: [], usuarios: [{ id: 'u1', email: 'x@y.com', name: 'Ana', lastname: 'P', estado: 1, role: { namerol: 'LIDER' } }], stocks: [], alertas: [], cliente: null, regionRel: null };

function armar() {
  const prisma: any = {
    agencia: { findUnique: vi.fn().mockResolvedValue(AGENCIA) },
    bahia: {
      findUnique: vi.fn().mockResolvedValue(BAHIA),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...BAHIA, ...a.data })),
    },
    bahiaOperador: { findMany: vi.fn().mockResolvedValue([{ id: 'x', operador: { id: 'o1', name: 'Luis', email: 'l@x.com' } }]) },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u1', estado: 1, roleId: 'r1', role: { namerol: 'LIDER' } }) },
    historialAsignacionBahia: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
  };
  return { prisma, service: new AgenciasService(prisma) };
}

describe('detalle de agencia', () => {
  it('cada rol solo ve el detalle de agencias de su alcance', async () => {
    const { service } = armar();
    await expect(service.detailAgencia('a1', usuario('LIDER', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
    await expect(service.detailAgencia('a1', usuario('SUPERVISOR', { regionId: 'r-otra' }))).rejects.toThrow(/alcance/);
    await expect(service.detailAgencia('a1', usuario('LIDER'))).rejects.toThrow(/alcance/);
    await expect(service.detailAgencia('a1', usuario('LIDER', { agenciaId: 'a1' }))).resolves.toBeDefined();
    await expect(service.detailAgencia('a1', usuario('SUPERVISOR', { regionId: 'r1' }))).resolves.toBeDefined();
    await expect(service.detailAgencia('a1', usuario('ADMIN'))).resolves.toBeDefined();
  });

  it('solo el administrador recibe los correos del personal', async () => {
    const { service } = armar();
    const lider: any = await service.detailAgencia('a1', usuario('LIDER', { agenciaId: 'a1' }));
    expect(lider.usuarios[0]).not.toHaveProperty('email');
    expect(lider.usuarios[0].name).toBe('Ana');
    const admin: any = await service.detailAgencia('a1', usuario('ADMIN'));
    expect(admin.usuarios[0].email).toBe('x@y.com');
  });
});

describe('bahías: lectura y edición dentro del alcance', () => {
  it('la lista de bahías se acota a la agencia o región del usuario', async () => {
    const a = armar();
    await a.service.listBahias({} as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(JSON.stringify(a.prisma.bahia.findMany.mock.calls[0][0].where)).toContain('"agenciaId":"a1"');
    const b = armar();
    await b.service.listBahias({} as any, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(JSON.stringify(b.prisma.bahia.findMany.mock.calls[0][0].where)).toContain('"agencia":{"regionId":"r1"}');
    const c = armar();
    await c.service.listBahias({} as any, usuario('LIDER'));
    expect(JSON.stringify(c.prisma.bahia.findMany.mock.calls[0][0].where)).toContain('"id":{"in":[]}');
  });

  it('el líder edita, activa y asigna solo en bahías de su agencia', async () => {
    const { prisma, service } = armar();
    const ajeno = usuario('LIDER', { agenciaId: 'a9' });
    await expect(service.updateBahia({ id: 'b1', nombre: 'X' } as any, ajeno)).rejects.toThrow(/alcance/);
    await expect(service.toggleActivaBahia({ id: 'b1' } as any, ajeno)).rejects.toThrow(/alcance/);
    await expect(service.asignarOperadorABahia({ bahiaId: 'b1', operadorId: 'o1' } as any, 'x', ajeno)).rejects.toThrow(/alcance/);
    await expect(service.desasignarOperadorDeBahia({ bahiaId: 'b1', operadorId: 'o1' } as any, 'x', ajeno)).rejects.toThrow(/alcance/);
    expect(prisma.bahia.update).not.toHaveBeenCalled();
    const propio = usuario('LIDER', { agenciaId: 'a1' });
    await expect(service.updateBahia({ id: 'b1', nombre: 'Nueva' } as any, propio)).resolves.toBeDefined();
    await expect(service.toggleActivaBahia({ id: 'b1' } as any, propio)).resolves.toBeDefined();
  });

  it('el supervisor edita bahías solo de su región', async () => {
    const { service } = armar();
    await expect(service.updateBahia({ id: 'b1', nombre: 'X' } as any, usuario('SUPERVISOR', { regionId: 'r-otra' }))).rejects.toThrow(/alcance/);
    await expect(service.updateBahia({ id: 'b1', nombre: 'X' } as any, usuario('SUPERVISOR', { regionId: 'r1' }))).resolves.toBeDefined();
  });

  it('los operadores de una bahía se leen solo dentro del alcance y sin correo para quien no es administrador', async () => {
    const { service } = armar();
    await expect(service.listarOperadoresDeBahia('b1', usuario('LIDER', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
    const l: any = await service.listarOperadoresDeBahia('b1', usuario('LIDER', { agenciaId: 'a1' }));
    expect(l[0].operador).not.toHaveProperty('email');
    const a: any = await service.listarOperadoresDeBahia('b1', usuario('ADMIN'));
    expect(a[0].operador.email).toBe('l@x.com');
  });

  it('el historial de asignaciones solo incluye bahías de su alcance', async () => {
    const { prisma, service } = armar();
    await service.obtenerHistorialAsignaciones({} as any, usuario('LIDER', { agenciaId: 'a1' }));
    expect(JSON.stringify(prisma.historialAsignacionBahia.findMany.mock.calls[0][0].where)).toContain('"agenciaId":"a1"');
    await service.obtenerHistorialAsignaciones({} as any, usuario('ADMIN'));
    expect(JSON.stringify(prisma.historialAsignacionBahia.findMany.mock.calls[1][0].where)).not.toContain('agenciaId');
  });
});

describe('editar una agencia', () => {
  it('el supervisor solo edita agencias de su región y no puede moverlas de región ni cambiar cliente o estado', async () => {
    const { service } = armar();
    const sup = usuario('SUPERVISOR', { regionId: 'r1' });
    await expect(service.updateAgencia({ id: 'a1', nombre: 'X' } as any, usuario('SUPERVISOR', { regionId: 'r-otra' }))).rejects.toThrow(/alcance/);
    await expect(service.updateAgencia({ id: 'a1', regionId: 'r2' } as any, sup)).rejects.toThrow(/solo para administradores/);
    await expect(service.updateAgencia({ id: 'a1', clienteId: 'c2' } as any, sup)).rejects.toThrow(/solo para administradores/);
    await expect(service.updateAgencia({ id: 'a1', estado: 0 } as any, sup)).rejects.toThrow(/solo para administradores/);
  });
});

describe('asignar usuarios', () => {
  it('un usuario pertenece a una sola agencia: agenciasIds se rechaza', async () => {
    const { service } = armar();
    await expect(service.asignarUsuario({ usuarioId: 'u1', agenciasIds: ['a1', 'a2'] } as any)).rejects.toThrow(/una sola agencia/);
  });
});
