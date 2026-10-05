import { describe, expect, it, vi } from 'vitest';
import { InventarioService } from './inventario.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function armar() {
  const prisma: any = {
    agencia: {
      findUnique: vi.fn().mockImplementation(async (a: any) => (a.where.id === 'a-r1' ? { regionId: 'r1' } : { regionId: 'r-otra' })),
      findMany: vi.fn().mockResolvedValue([{ id: 'a-r1' }]),
    },
    bodega: { findMany: vi.fn().mockResolvedValue([{ id: 'b-r1' }]) },
    user: { findUnique: vi.fn() },
    alertaStock: { findUnique: vi.fn(), update: vi.fn().mockImplementation(async (a: any) => a.data) },
    movimientoInventario: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new InventarioService(prisma as never) };
}

describe('agenciaEnAlcance', () => {
  it('un usuario de agencia queda siempre en la suya, aunque el cliente mande otra', async () => {
    const { service } = armar();
    const lider = usuario('LIDER', { agenciaId: 'a1' });
    await expect(service.agenciaEnAlcance(lider, undefined)).resolves.toBe('a1');
    await expect(service.agenciaEnAlcance(lider, 'a1')).resolves.toBe('a1');
    await expect(service.agenciaEnAlcance(lider, 'a-ajena')).rejects.toThrow(/alcance/);
  });

  it('quien actúa por región solo elige agencias de su región', async () => {
    const { service } = armar();
    const asistente = usuario('ASISTENTE_BODEGA', { bodega: { regionId: 'r1' } });
    await expect(service.agenciaEnAlcance(asistente, 'a-r1')).resolves.toBe('a-r1');
    await expect(service.agenciaEnAlcance(asistente, 'a-otra-region')).rejects.toThrow(/tu región/);
    await expect(service.agenciaEnAlcance(asistente, undefined)).resolves.toBeUndefined();
  });

  it('administradores y bodega nacional eligen cualquiera; sin datos de ámbito no se puede', async () => {
    const { service } = armar();
    await expect(service.agenciaEnAlcance(usuario('ADMIN'), 'cualquiera')).resolves.toBe('cualquiera');
    await expect(service.agenciaEnAlcance(usuario('COORD_BODEGA'), undefined)).resolves.toBeUndefined();
    await expect(service.agenciaEnAlcance(usuario('LIDER'), 'a1')).rejects.toThrow(/asignada/);
    await expect(service.agenciaEnAlcance(usuario('TECNICO'), 'a1')).rejects.toThrow(/asignada/);
  });
});

describe('pulidorEnAlcance', () => {
  it('el pulidor solo ve su propio kit', async () => {
    const { service } = armar();
    const p = usuario('PULIDOR', { regionId: 'r1' });
    await expect(service.pulidorEnAlcance(p, undefined)).resolves.toBe('id-PULIDOR');
    await expect(service.pulidorEnAlcance(p, 'id-PULIDOR')).resolves.toBe('id-PULIDOR');
    await expect(service.pulidorEnAlcance(p, 'otro')).rejects.toThrow(/insumos propio/);
  });

  it('otros roles ven el kit de pulidores de su alcance', async () => {
    const { prisma, service } = armar();
    prisma.user.findUnique.mockResolvedValue({ agenciaId: 'a1', regionId: 'r1', agencia: { regionId: 'r1' } });
    await expect(service.pulidorEnAlcance(usuario('COORD_SERVICIOS_ESPECIALES'), 'p2')).resolves.toBe('p2');
    await expect(service.pulidorEnAlcance(usuario('ASISTENTE_BODEGA', { bodega: { regionId: 'r1' } }), 'p2')).resolves.toBe('p2');
    await expect(service.pulidorEnAlcance(usuario('ASISTENTE_BODEGA', { bodega: { regionId: 'r-otra' } }), 'p2')).rejects.toThrow(/alcance/);
    await expect(service.pulidorEnAlcance(usuario('LIDER', { agenciaId: 'a9' }), 'p2')).rejects.toThrow(/alcance/);
  });
});

describe('listMovimientos (historial de movimientos)', () => {
  const donde = (prisma: any) => JSON.stringify(prisma.movimientoInventario.findMany.mock.calls[0][0].where);

  it('los administradores ven todo, con tope de 100', async () => {
    const { prisma, service } = armar();
    await service.listMovimientos({} as any, usuario('ADMIN'));
    expect(donde(prisma)).toBe('{}');
    expect(prisma.movimientoInventario.findMany.mock.calls[0][0].take).toBe(100);
  });

  it('una agencia ve lo que salió o llegó a ella, y lo que se le despachó a su kit', async () => {
    const { prisma, service } = armar();
    await service.listMovimientos({} as any, usuario('LIDER', { agenciaId: 'a1' }));
    const w = donde(prisma);
    expect(w).toContain('"origenAgenciaId":"a1"');
    expect(w).toContain('"destinoAgenciaId":"a1"');
    expect(w).toContain('"destinoPulidorId":"id-LIDER"');
  });

  it('una región ve lo de sus agencias y bodegas', async () => {
    const { prisma, service } = armar();
    await service.listMovimientos({} as any, usuario('ASISTENTE_BODEGA', { bodega: { regionId: 'r1' } }));
    const w = donde(prisma);
    expect(w).toContain('"origenAgenciaId":{"in":["a-r1"]}');
    expect(w).toContain('"destinoBodegaId":{"in":["b-r1"]}');
  });

  it('sin ámbito solo ve lo despachado a su propio kit', async () => {
    const { prisma, service } = armar();
    await service.listMovimientos({} as any, usuario('TECNICO'));
    expect(donde(prisma)).toBe('{"destinoPulidorId":"id-TECNICO"}');
  });
});

describe('atenderAlerta', () => {
  it('solo alertas de su alcance: el asistente las de su región, el líder las de su agencia', async () => {
    const asistente = usuario('ASISTENTE_BODEGA', { bodega: { regionId: 'r1' } });
    const a = armar();
    a.prisma.alertaStock.findUnique.mockResolvedValue({ id: 'al', agenciaId: 'a-r1', mensaje: '' });
    await expect(a.service.atenderAlerta({ id: 'al', estado: 'RESUELTO' } as any, asistente)).resolves.toBeDefined();
    const b = armar();
    b.prisma.alertaStock.findUnique.mockResolvedValue({ id: 'al', agenciaId: 'a-otra-region', mensaje: '' });
    await expect(b.service.atenderAlerta({ id: 'al', estado: 'RESUELTO' } as any, asistente)).rejects.toThrow(/tu región/);
    expect(b.prisma.alertaStock.update).not.toHaveBeenCalled();
    const c = armar();
    c.prisma.alertaStock.findUnique.mockResolvedValue({ id: 'al', agenciaId: 'a-r1', mensaje: '' });
    await expect(c.service.atenderAlerta({ id: 'al', estado: 'RESUELTO' } as any, usuario('COORD_BODEGA'))).resolves.toBeDefined();
  });
});

describe('registrarCompra — convierte a unidad base, igual que un despacho', () => {
  function armarCompra() {
    const prisma: any = {
      movimientoInventario: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async (a: any) => ({ id: 'm1', numeroGuia: a.data.numeroGuia, detalles: [] })),
      },
      insumo: { findUnique: vi.fn().mockResolvedValue({ id: 'ins1', nombre: 'Cera en galón', contenidoNeto: 4 }) },
      stockUbicacion: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async (a: any) => a.data),
        update: vi.fn(),
      },
      kardexMovimiento: { create: vi.fn() },
    };
    return { prisma, service: new InventarioService(prisma as never) };
  }

  it('una compra de 10 envases (contenidoNeto=4) queda como 40 en unidad base, no como 10', async () => {
    const { prisma, service } = armarCompra();
    await service.registrarCompra(
      { numeroGuia: 'G-1', proveedorNombre: 'Proveedor X', detalles: [{ insumoId: 'ins1', cantidadEnviada: 10, costoUnitarioUSD: 5 }] } as any,
      'u1',
    );

    expect(prisma.stockUbicacion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ insumoId: 'ins1', cantidadActual: 40 }) }),
    );
    expect(prisma.kardexMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cantidad: 40, stockAnterior: 0, stockPosterior: 40 }) }),
    );
    // El detalle del movimiento (guía) sigue en envases/unidades, como en un despacho.
    expect(prisma.movimientoInventario.create.mock.calls[0][0].data.detalles.create[0]).toMatchObject({
      insumoId: 'ins1',
      cantidadEnviada: 10,
      cantidadRecibida: 10,
    });
  });

  it('suma sobre stock existente también en unidad base', async () => {
    const { prisma, service } = armarCompra();
    prisma.stockUbicacion.findFirst.mockResolvedValue({ id: 'su1', cantidadActual: 8 });
    await service.registrarCompra(
      { numeroGuia: 'G-2', proveedorNombre: 'Proveedor X', detalles: [{ insumoId: 'ins1', cantidadEnviada: 2 }] } as any,
      'u1',
    );
    // 8 (previo) + 2 envases × 4 = 16
    expect(prisma.stockUbicacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'su1' }, data: { cantidadActual: { increment: 8 } } }),
    );
    expect(prisma.kardexMovimiento.create.mock.calls[0][0].data).toMatchObject({ stockAnterior: 8, stockPosterior: 16, cantidad: 8 });
  });
});

describe('crearAlerta — alcance por rol', () => {
  function armarAlerta() {
    const prisma: any = {
      insumo: { findUnique: vi.fn().mockResolvedValue({ id: 'ins1' }) },
      alertaStock: { create: vi.fn().mockImplementation(async (a: any) => a.data) },
    };
    return { prisma, service: new InventarioService(prisma as never) };
  }

  it('el pulidor móvil (sin agencia ni región) crea la alerta de su propio kit, sin Forbidden', async () => {
    const { prisma, service } = armarAlerta();
    const movil = usuario('PULIDOR'); // sin agenciaId ni regionId: antes lanzaba Forbidden vía agenciaEnAlcance
    const alerta: any = await service.crearAlerta({ insumoId: 'ins1', nivel: 'CRITICO' } as any, movil);
    expect(prisma.alertaStock.create.mock.calls[0][0].data).toMatchObject({ pulidorId: 'id-PULIDOR', agenciaId: undefined });
    expect(alerta.pulidorId).toBe('id-PULIDOR');
  });

  it('el pulidor fijo liga la alerta a su kit y, de paso, a su agencia', async () => {
    const { prisma, service } = armarAlerta();
    const fijo = usuario('PULIDOR', { agenciaId: 'a1' });
    await service.crearAlerta({ insumoId: 'ins1', nivel: 'BAJO' } as any, fijo);
    expect(prisma.alertaStock.create.mock.calls[0][0].data).toMatchObject({ pulidorId: 'id-PULIDOR', agenciaId: 'a1' });
  });

  it('el líder sigue emitiendo solo para su agencia (sin pulidorId) y no puede mandar otra', async () => {
    const { prisma, service } = armarAlerta();
    const lider = usuario('LIDER', { agenciaId: 'a1' });
    await service.crearAlerta({ insumoId: 'ins1', nivel: 'BAJO', agenciaId: 'a1' } as any, lider);
    expect(prisma.alertaStock.create.mock.calls[0][0].data).toMatchObject({ agenciaId: 'a1', pulidorId: undefined });
    await expect(
      service.crearAlerta({ insumoId: 'ins1', nivel: 'BAJO', agenciaId: 'a-ajena' } as any, lider),
    ).rejects.toThrow(/alcance/);
  });
});
