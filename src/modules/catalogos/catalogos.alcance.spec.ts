import { describe, expect, it, vi } from 'vitest';
import { CatalogosService } from './catalogos.service.js';

const construir = (agencia: any = null, codigos: string[] = []) => {
  const prisma = {
    catalogoServicio: {
      findMany: vi.fn().mockImplementation(async (args: any) =>
        args?.select?.codigo ? codigos.map((codigo) => ({ codigo })) : [],
      ),
      count: vi.fn().mockResolvedValue(0),
    },
    agencia: { findUnique: vi.fn().mockResolvedValue(agencia) },
  };
  return { prisma, service: new CatalogosService(prisma as never) };
};
const sede = { nombre: 'Sede Norte', tieneServiciosEspeciales: true, servicioIds: [1, 2], serviciosNombres: ['Lavado Express'] };
const whereDe = (prisma: any) => prisma.catalogoServicio.findMany.mock.calls[0][0].where;

describe('CatalogosService.listServicios — alcance', () => {
  it('Admin y Súper Admin ven todo aunque tengan sede: no se consulta la agencia', async () => {
    for (const namerol of ['ADMIN', 'SUPER_ADMIN']) {
      const { prisma, service } = construir(sede);
      await service.listServicios({ page: 1 } as any, { namerol, agenciaId: 'a1' });
      expect(prisma.agencia.findUnique).not.toHaveBeenCalled();
      expect(JSON.stringify(whereDe(prisma))).not.toContain('"id"');
    }
  });

  it('cualquier otro rol con sede queda limitado a su sede, por id y por nombre', async () => {
    const { prisma, service } = construir(sede);
    const r: any = await service.listServicios({ page: 1 } as any, { namerol: 'LAVADOR', agenciaId: 'a1' });
    const txt = JSON.stringify(whereDe(prisma));
    expect(txt).toContain('"id":{"in":[1,2]}');
    expect(txt).toContain('"equals":"Lavado Express"');
    expect(r.agencia).toMatchObject({ nombre: 'Sede Norte', servicioIds: [1, 2], tieneServiciosEspeciales: true });
  });

  it('si la sede no atiende especiales solo se ven los generales', async () => {
    const { prisma, service } = construir({ ...sede, tieneServiciosEspeciales: false });
    await service.listServicios({ page: 1 } as any, { namerol: 'LAVADOR', agenciaId: 'a1' });
    expect(whereDe(prisma).categoria).toBe('GENERAL');
  });

  it('una sede sin servicios configurados no ve nada (nunca el catálogo global)', async () => {
    const { prisma, service } = construir({ ...sede, servicioIds: [], serviciosNombres: [] });
    await service.listServicios({ page: 1 } as any, { namerol: 'LAVADOR', agenciaId: 'a1' });
    expect(whereDe(prisma).id).toEqual({ in: [-1] });
  });

  it('un rol de sede sin agencia no ve nada; otro rol sin sede ve todo', async () => {
    const a = construir();
    await a.service.listServicios({ page: 1 } as any, { namerol: 'APROBADOR' });
    expect(whereDe(a.prisma).id).toEqual({ in: [-1] });
    const b = construir();
    await b.service.listServicios({ page: 1 } as any, { namerol: 'COORD_BODEGA' });
    expect(whereDe(b.prisma)).toEqual({});
  });

  it('la agencia del usuario manda: el cliente no puede pedir los servicios de otra sede', async () => {
    const { prisma, service } = construir(sede);
    await service.listServicios({ page: 1, agenciaId: 'a-ajena' } as any, { namerol: 'LAVADOR', agenciaId: 'a1' });
    expect(prisma.agencia.findUnique.mock.calls[0][0].where).toEqual({ id: 'a1' });
  });

  it('los alias antiguos de rol se tratan como el rol oficial', async () => {
    const { prisma, service } = construir(sede);
    await service.listServicios({ page: 1 } as any, { namerol: 'ADMINISTRADOR', agenciaId: 'a1' });
    expect(prisma.agencia.findUnique).not.toHaveBeenCalled(); // ADMINISTRADOR = ADMIN: ve todo
    await service.listServicios({ page: 1 } as any, { namerol: 'GERENTE', agenciaId: 'a1' });
    expect(prisma.agencia.findUnique).toHaveBeenCalled(); // GERENTE = APROBADOR: acotado a su sede
  });

  it('categoria admite varias separadas por coma (especiales + extras)', async () => {
    const { prisma, service } = construir();
    await service.listServicios({ page: 1, categoria: 'especial, extra' } as any, { namerol: 'ADMIN' });
    expect(whereDe(prisma).categoria).toEqual({ in: ['ESPECIAL', 'EXTRA'] });
  });
});

describe('CatalogosService.siguienteCodigo', () => {
  it('mayor número existente + 1 con ceros a la izquierda, sin depender de cuántos hay', async () => {
    const { service } = construir(null, ['SER-001', 'SER-007', 'SER-0010']);
    expect(await service.siguienteCodigo('GENERAL')).toEqual({ codigo: 'SER-011' });
  });

  it('especiales y extras usan ESP; sin códigos empieza en 001', async () => {
    const { prisma, service } = construir(null, []);
    expect(await service.siguienteCodigo('EXTRA')).toEqual({ codigo: 'ESP-001' });
    expect(prisma.catalogoServicio.findMany.mock.calls[0][0].where).toEqual({ codigo: { startsWith: 'ESP-' } });
  });
});
