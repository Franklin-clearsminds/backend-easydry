import { describe, expect, it, vi } from 'vitest';
import { RolesService } from './roles.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const superAdmin = { id: 'sa', roleId: 'r-sa', roleDetails: { namerol: 'SUPER_ADMIN', capacidades: [], ambito: 'GLOBAL' } };
const admin = (() => {
  const r = ROLES_BASE.find((x) => x.namerol === 'ADMIN')!;
  // Un administrador al que se le dio el permiso de gestionar roles (no lo trae de fábrica).
  return { id: 'ad', roleId: 'r-admin', roleDetails: { namerol: 'ADMIN', capacidades: [...r.capacidades, 'roles.gestionar'], ambito: 'GLOBAL' } };
})();
const supervisor = (() => {
  const r = ROLES_BASE.find((x) => x.namerol === 'SUPERVISOR')!;
  return { id: 'su', roleId: 'r-sup', roleDetails: { namerol: 'SUPERVISOR', capacidades: [...r.capacidades, 'roles.gestionar'], ambito: 'REGION' } };
})();

function armar(rol: any = null, usuarios = 0) {
  const prisma = {
    role: {
      findUnique: vi.fn().mockImplementation(async (a: any) => (a.where.namerol ? null : rol)),
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'nuevo', ...a.data, fechaCreacion: new Date(), fechaModificacion: new Date() })),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...rol, ...a.data, fechaCreacion: new Date(), fechaModificacion: new Date() })),
      delete: vi.fn().mockResolvedValue({}),
    },
    moduloSistema: { findMany: vi.fn().mockImplementation(async (a: any) => (a.where?.codigo?.in ?? []).filter((c: string) => c !== 'inexistente').map((codigo: string) => ({ codigo }))) },
  };
  if (rol) rol._count = { users: usuarios };
  return { prisma, service: new RolesService(prisma as never) };
}
const oficial = (namerol: string) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `r-${namerol}`, namerol, esSistema: true, permisos: r.modulos, capacidades: r.capacidades, ambito: r.ambito, estado: 1 };
};

describe('RolesService — crear', () => {
  it('crea un rol nuevo con sus permisos, ámbito y acciones para la web', async () => {
    const { prisma, service } = armar();
    const r = await service.create({ namerol: 'inspector zona', capacidades: ['servicios.ver', 'agencias.ver'], ambito: 'REGION', permisos: ['dashboard'] } as any, superAdmin);
    const data = prisma.role.create.mock.calls[0][0].data;
    expect(data.namerol).toBe('INSPECTOR_ZONA');
    expect(data.esSistema).toBe(false);
    expect(data.capacidades).toEqual(['servicios.ver', 'agencias.ver']);
    expect(data.acciones.verTodosServicios).toBe(true);
    expect(r.ambito).toBe('REGION');
  });

  it('rechaza permisos que no existen, módulos desconocidos y ámbito inválido', async () => {
    const { service } = armar();
    await expect(service.create({ namerol: 'ROL_X', capacidades: ['inventado.todo'] } as any, superAdmin)).rejects.toThrow(/Permisos desconocidos/);
    await expect(service.create({ namerol: 'ROL_X', permisos: ['inexistente'] } as any, superAdmin)).rejects.toThrow(/Módulos desconocidos/);
    await expect(service.create({ namerol: 'ROL_X', ambito: 'MUNDIAL' } as any, superAdmin)).rejects.toThrow(/Ámbito inválido/);
  });

  it('rechaza nombres reservados, alias antiguos, mal formados o repetidos', async () => {
    const { service } = armar();
    await expect(service.create({ namerol: 'SUPER_ADMIN' } as any, superAdmin)).rejects.toThrow(/reservado/);
    await expect(service.create({ namerol: 'GERENTE' } as any, superAdmin)).rejects.toThrow(/alias antiguo/);
    await expect(service.create({ namerol: 'a' } as any, superAdmin)).rejects.toThrow(/3 a 40/);
    const repetido = armar();
    repetido.prisma.role.findUnique.mockResolvedValue({ id: 'x' });
    await expect(repetido.service.create({ namerol: 'ROL_X' } as any, superAdmin)).rejects.toThrow(/ya existe/);
  });

  it('quien no es SUPER_ADMIN no puede otorgar permisos ni un ámbito que su propio rol no tiene', async () => {
    const { prisma, service } = armar();
    await expect(service.create({ namerol: 'ROL_X', capacidades: ['compras.registrar'] } as any, supervisor)).rejects.toThrow(/no tiene/);
    await expect(service.create({ namerol: 'ROL_X', capacidades: ['servicios.ver'], ambito: 'GLOBAL' } as any, supervisor)).rejects.toThrow(/ámbito más amplio/);
    expect(prisma.role.create).not.toHaveBeenCalled();
    await expect(service.create({ namerol: 'ROL_X', capacidades: ['servicios.ver'], ambito: 'REGION' } as any, supervisor)).resolves.toBeDefined();
  });
});

describe('RolesService — editar', () => {
  it('SUPER_ADMIN es inmutable', async () => {
    const { service } = armar({ id: 'r-sa', namerol: 'SUPER_ADMIN', esSistema: true, capacidades: [] });
    await expect(service.update({ id: 'r-sa', estado: 0 } as any, superAdmin)).rejects.toThrow(/inmutable/);
  });

  it('un rol oficial puede cambiar de permisos pero no de nombre', async () => {
    const { prisma, service } = armar(oficial('LIDER'));
    await expect(service.update({ id: 'r-LIDER', namerol: 'OTRO_NOMBRE' } as any, superAdmin)).rejects.toThrow(/rol oficial/);
    await service.update({ id: 'r-LIDER', capacidades: ['servicios.ver'] } as any, superAdmin);
    const data = prisma.role.update.mock.calls[0][0].data;
    expect(data.capacidades).toEqual(['servicios.ver']);
    expect(data.acciones.registrarServicio).toBe(false);
  });

  it('el ámbito de un rol oficial no se puede cambiar: es una invariante, no una preferencia', async () => {
    // TECNICO llegó a tener ambito=PROPIO en producción por este mismo hueco; ahora está bloqueado.
    const { prisma, service } = armar(oficial('TECNICO'));
    await expect(service.update({ id: 'r-TECNICO', ambito: 'PROPIO' } as any, superAdmin)).rejects.toThrow(/ámbito de un rol oficial/);
    expect(prisma.role.update).not.toHaveBeenCalled();
    // Pedir el mismo ámbito que ya tiene no es "cambiarlo": no debe romper el resto del update.
    await expect(service.update({ id: 'r-TECNICO', ambito: 'REGION', capacidades: ['maquinaria.ver'] } as any, superAdmin)).resolves.toBeDefined();
  });

  it('un rol NO oficial sí puede cambiar de ámbito libremente (para SUPER_ADMIN)', async () => {
    const { prisma, service } = armar({ id: 'p', namerol: 'PERSONAL', esSistema: false, capacidades: [], ambito: 'AGENCIA' });
    await service.update({ id: 'p', ambito: 'REGION' } as any, superAdmin);
    expect(prisma.role.update.mock.calls[0][0].data.ambito).toBe('REGION');
  });

  it('un rol no puede editar el suyo ni uno con permisos que no tiene', async () => {
    const propio = armar({ ...oficial('ADMIN'), id: 'r-admin' });
    await expect(propio.service.update({ id: 'r-admin', estado: 0 } as any, admin)).rejects.toThrow(/tu propio rol/);
    const ajeno = armar(oficial('COORD_BODEGA'));
    await expect(ajeno.service.update({ id: 'r-COORD_BODEGA', estado: 0 } as any, supervisor)).rejects.toThrow(/no tiene/);
  });

  it('al editar solo se validan como otorgados los permisos nuevos', async () => {
    const rol = { ...oficial('SUPERVISOR'), id: 'otro' };
    const { service } = armar(rol);
    // el supervisor "gestionar roles" ya tenía todos los suyos; quitar permisos siempre está permitido
    await expect(service.update({ id: 'otro', capacidades: ['servicios.ver'] } as any, { ...supervisor, roleId: 'x' })).resolves.toBeDefined();
  });
});

describe('RolesService — eliminar', () => {
  it('los roles oficiales y SUPER_ADMIN no se eliminan', async () => {
    await expect(armar(oficial('LIDER')).service.delete('r-LIDER', superAdmin)).rejects.toThrow(/oficiales/);
    await expect(armar({ id: 'r-sa', namerol: 'SUPER_ADMIN', esSistema: true }).service.delete('r-sa', superAdmin)).rejects.toThrow(/SUPER_ADMIN/);
  });

  it('un rol con usuarios asignados no se elimina', async () => {
    const { prisma, service } = armar({ id: 'p', namerol: 'PERSONAL', esSistema: false, capacidades: [] }, 3);
    await expect(service.delete('p', superAdmin)).rejects.toThrow(/3 usuario/);
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('un rol propio sin usuarios se elimina de verdad (ya no se desactiva en silencio)', async () => {
    const { prisma, service } = armar({ id: 'p', namerol: 'PERSONAL', esSistema: false, capacidades: [] }, 0);
    await service.delete('p', superAdmin);
    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'p' } });
  });
});
