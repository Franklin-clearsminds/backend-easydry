import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

function armar(marcadas: string[]) {
  const prisma: any = {
    moduloSistema: {
      findMany: vi.fn().mockImplementation(async (a: any) =>
        a.where.codigo.in.filter((c: string) => marcadas.includes(c)).map((codigo: string) => ({ codigo }))),
    },
  };
  return { prisma, service: new AuthService(prisma, {} as never, {} as never, {} as never) };
}
const rol = (namerol: string) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { namerol, capacidades: r.capacidades };
};
const MARCADAS = ['dashboard', 'notificaciones', 'servicios', 'aprobaciones', 'operadores', 'maquinaria', 'taller-tecnico', 'inventario', 'envios', 'perfil'];

describe('acceso y pantallas de la app (infoApp)', () => {
  it('el líder entra a la app y ve solo sus pantallas marcadas para la app', async () => {
    const { service } = armar(MARCADAS);
    const info = await (service as any).infoApp(rol('LIDER'));
    expect(info.puedeUsarApp).toBe(true);
    expect(info.pantallasApp).toEqual(expect.arrayContaining(['servicios', 'inventario', 'operadores', 'perfil']));
    expect(info.pantallasApp).not.toContain('mapa-operativo');
  });

  it('una pantalla de la web que no está marcada para la app nunca aparece en el celular', async () => {
    const { service } = armar(['servicios']);
    const info = await (service as any).infoApp(rol('LIDER'));
    expect(info.pantallasApp).toEqual(['servicios']);
  });

  it('sin el permiso sync.usar no se entra a la app, aunque tenga pantallas', async () => {
    const { service } = armar(MARCADAS);
    const info = await (service as any).infoApp({ namerol: 'REPORTEROCUSTOM', capacidades: ['servicios.ver', 'inventario.ver'] });
    expect(info).toEqual({ puedeUsarApp: false, pantallasApp: [] });
  });

  it('el lavador (sin permisos) no entra y no consulta la base', async () => {
    const { prisma, service } = armar(MARCADAS);
    const info = await (service as any).infoApp(rol('LAVADOR'));
    expect(info).toEqual({ puedeUsarApp: false, pantallasApp: [] });
    expect(prisma.moduloSistema.findMany).not.toHaveBeenCalled();
  });

  it('el super admin entra y ve todas las pantallas marcadas', async () => {
    const { service } = armar(MARCADAS);
    const info = await (service as any).infoApp({ namerol: 'SUPER_ADMIN', capacidades: [] });
    expect(info.puedeUsarApp).toBe(true);
    expect(info.pantallasApp.sort()).toEqual([...MARCADAS].sort());
  });
});
