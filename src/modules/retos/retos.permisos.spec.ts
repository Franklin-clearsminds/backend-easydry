import { describe, expect, it, vi } from 'vitest';
import { RetosService } from './retos.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return {
    id: `id-${namerol}`,
    name: 'Ana',
    lastname: namerol,
    roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito },
    ...extra,
  };
};

function armar(existente: any = null, enRegion = 1) {
  const prisma: any = {
    reto: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'r1', ...a.data })),
      findUnique: vi.fn().mockResolvedValue(existente),
      delete: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...existente, ...a.data })),
    },
    agencia: { count: vi.fn().mockResolvedValue(enRegion), findMany: vi.fn().mockResolvedValue([]) },
    bahia: { count: vi.fn().mockResolvedValue(enRegion), findMany: vi.fn().mockResolvedValue([]) },
    catalogoServicio: {
      count: vi.fn().mockImplementation(async ({ where }: any) => where.id.in.length),
      findMany: vi.fn().mockResolvedValue([]),
    },
    user: { count: vi.fn().mockResolvedValue(enRegion), findMany: vi.fn().mockResolvedValue([]) },
    servicioLavado: { findMany: vi.fn().mockResolvedValue([]) },
    servicioEspecial: { findMany: vi.fn().mockResolvedValue([]) },
    region: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma, service: new RetosService(prisma) };
}
const dto = (extra: Record<string, unknown> = {}) =>
  ({ titulo: 'Reto', fechaInicio: '2026-10-01', fechaFin: '2026-10-31', ...extra }) as any;
const creado = (prisma: any) => prisma.reto.create.mock.calls[0][0].data;

describe('RetosService.create', () => {
  it('administradores y jefe comercial crean retos nacionales o de cualquier región', async () => {
    for (const rol of ['SUPER_ADMIN', 'ADMIN', 'JEFE_COMERCIAL']) {
      const { prisma, service } = armar();
      await service.create(dto({ regiones: ['Costa', 'Sierra'] }), usuario(rol));
      expect(creado(prisma).regiones).toEqual(['Costa', 'Sierra']);
    }
  });

  it('valores por defecto: agencias, todos los servicios, cantidad de servicios, gana el primero', async () => {
    const { prisma, service } = armar();
    await service.create(dto(), usuario('ADMIN'));
    expect(creado(prisma)).toMatchObject({
      tipoReto: 'AGENCIA', tipoServicios: 'TODOS', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 1, meta: null,
    });
  });

  it('el coordinador comercial solo crea retos para su región', async () => {
    const yo = usuario('COORD_COMERCIAL', { regionId: 'r1', region: { nombre: 'Costa' } });
    const { prisma, service } = armar();
    await service.create(dto({ regiones: ['costa'] }), yo);
    expect(prisma.reto.create).toHaveBeenCalled();
    for (const regiones of [['Sierra'], ['Costa', 'Sierra'], [], ['Todas']]) {
      await expect(armar().service.create(dto({ regiones }), yo)).rejects.toThrow(/tu región/);
    }
  });

  it('el coordinador solo elige agencias y personas de su región, y necesita tener región', async () => {
    const yo = usuario('COORD_COMERCIAL', { regionId: 'r1', region: { nombre: 'Costa' } });
    await expect(armar(null, 0).service.create(dto({ regiones: ['Costa'], sucursalesIds: ['a9'] }), yo)).rejects.toThrow(/no pertenecen a tu región/);
    await expect(
      armar(null, 0).service.create(dto({ regiones: ['Costa'], tipoReto: 'LAVADOR', lavadoresIds: ['l9'] }), yo),
    ).rejects.toThrow(/lavadores no pertenecen/);
    await expect(armar().service.create(dto({ regiones: ['Costa'] }), usuario('COORD_COMERCIAL'))).rejects.toThrow(/región asignada/);
  });

  it('rechaza fechas al revés', async () => {
    await expect(
      armar().service.create(dto({ fechaInicio: '2026-11-01', fechaFin: '2026-10-01' }), usuario('ADMIN')),
    ).rejects.toThrow(/fecha de fin/);
  });

  it('los lavadores solo compiten con servicios generales y los pulidores con especiales', async () => {
    await expect(armar().service.create(dto({ tipoReto: 'LAVADOR', tipoServicios: 'ESPECIALES' }), usuario('ADMIN'))).rejects.toThrow(/generales/);
    await expect(armar().service.create(dto({ tipoReto: 'PULIDOR', tipoServicios: 'TODOS' }), usuario('ADMIN'))).rejects.toThrow(/especiales/);
    const { prisma, service } = armar();
    await service.create(dto({ tipoReto: 'PULIDOR' }), usuario('ADMIN'));
    expect(creado(prisma)).toMatchObject({ tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', pulidoresIds: [] });
  });

  it('servicios específicos: exige elegir y, para personas, que sean de su categoría', async () => {
    await expect(armar().service.create(dto({ tipoServicios: 'ESPECIFICOS' }), usuario('ADMIN'))).rejects.toThrow(/uno o varios servicios/);
    const { prisma, service } = armar();
    await service.create(dto({ tipoReto: 'PULIDOR', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [26, 27] }), usuario('ADMIN'));
    expect(prisma.catalogoServicio.count.mock.calls[0][0].where).toMatchObject({ categoria: 'ESPECIAL' });
    expect(creado(prisma).catalogoServicioIds).toEqual([26, 27]);
    // Sin "específicos" no se guardan servicios sueltos.
    const otro = armar();
    await otro.service.create(dto({ tipoServicios: 'TODOS', catalogoServicioIds: [1] }), usuario('ADMIN'));
    expect(creado(otro.prisma).catalogoServicioIds).toEqual([]);
  });

  it('meta: obligatoria con META, entera salvo para monto', async () => {
    await expect(armar().service.create(dto({ modoGanador: 'META' }), usuario('ADMIN'))).rejects.toThrow(/meta/);
    await expect(armar().service.create(dto({ modoGanador: 'META', meta: 2.5 }), usuario('ADMIN'))).rejects.toThrow(/entero/);
    const { prisma, service } = armar();
    await service.create(dto({ modoGanador: 'META', metrica: 'MONTO', meta: 1500.5 }), usuario('ADMIN'));
    expect(creado(prisma)).toMatchObject({ modoGanador: 'META', meta: 1500.5, cantidadGanadores: 1 });
  });

  it('las listas de personas solo se guardan para su tipo de reto', async () => {
    const { prisma, service } = armar();
    await service.create(dto({ tipoReto: 'AGENCIA', pulidoresIds: ['p1'], lavadoresIds: ['l1'] }), usuario('ADMIN'));
    expect(creado(prisma)).toMatchObject({ pulidoresIds: [], lavadoresIds: [] });
  });
});

describe('RetosService.list', () => {
  it('administradores y jefe comercial ven todos; el resto solo los de su región, agencia o donde participa', async () => {
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
    expect(txt).toContain('"lavadoresIds":{"has":"id-LIDER"}');
  });
});

describe('RetosService.delete', () => {
  it('lo elimina su creador o alguien con alcance nacional; nadie más', async () => {
    const mio = { id: 'r1', creadoPorId: 'id-COORD_COMERCIAL' };
    await expect(armar(mio).service.delete('r1', usuario('COORD_COMERCIAL'))).resolves.toMatchObject({ success: true });
    await expect(armar(mio).service.delete('r1', usuario('ADMIN'))).resolves.toMatchObject({ success: true });
    await expect(armar(mio).service.delete('r1', usuario('JEFE_COMERCIAL'))).resolves.toMatchObject({ success: true });
    const ajeno = { id: 'r1', creadoPorId: 'otro' };
    await expect(
      armar(ajeno).service.delete('r1', usuario('COORD_COMERCIAL', { regionId: 'r1' })),
    ).rejects.toThrow(/creador o alguien con alcance nacional/);
  });
});

const retoBase = {
  id: 'r1',
  regiones: ['Todas'],
  marcas: ['Todas'],
  sucursalesIds: [],
  bahiasIds: [],
  pulidoresIds: [],
  lavadoresIds: [],
  fechaInicio: new Date('2026-10-01T00:00:00.000Z'),
  fechaFin: new Date('2026-10-31T00:00:00.000Z'),
  catalogoServicioIds: [],
  tipoReto: 'AGENCIA',
  tipoServicios: 'TODOS',
  metrica: 'SERVICIOS',
  modoGanador: 'RANKING',
  cantidadGanadores: 1,
  meta: null,
  estado: 'ACTIVO',
  creadoPorId: 'id-COORD_COMERCIAL',
  titulo: 'Reto',
};
const lavado = (agenciaId: string, fin: string, extra: Record<string, unknown> = {}) => ({
  placa: 'AAA-001', precio: 10, horaSalida: new Date(fin), operadorId: 'l1', bahiaId: `b-${agenciaId}`,
  bahia: { agenciaId }, operadoresAsignados: [], ...extra,
});

describe('RetosService.ranking', () => {
  it('agencias: suma generales y especiales, y desempata por quién llegó primero', async () => {
    const { prisma, service } = armar(retoBase);
    prisma.agencia.findMany.mockResolvedValue([
      { id: 'a1', nombre: 'Agencia Uno', regionId: 'costa' },
      { id: 'a2', nombre: 'Agencia Dos', regionId: 'sierra' },
    ]);
    prisma.servicioLavado.findMany.mockResolvedValue([
      lavado('a1', '2026-10-05T15:00:00Z'),
      lavado('a2', '2026-10-03T15:00:00Z'),
    ]);
    prisma.servicioEspecial.findMany.mockResolvedValue([
      { placa: 'X', precio: 0, fechaFin: new Date('2026-10-02T15:00:00Z'), operadorId: 'p1', bahiaId: 'b', agenciaId: 'a2', operadoresAsignados: [] },
      { placa: 'Y', precio: 0, fechaFin: new Date('2026-10-04T15:00:00Z'), operadorId: 'p1', bahiaId: 'b', agenciaId: 'a1', operadoresAsignados: [] },
    ]);

    const r = await service.ranking('r1', usuario('ADMIN'));
    expect(r.participantes.map((p: any) => [p.nombre, p.valor, p.posicion, p.gana])).toEqual([
      ['Agencia Dos', 2, 1, true],
      ['Agencia Uno', 2, 2, false],
    ]);
    expect(prisma.servicioLavado.findMany.mock.calls[0][0].where).toMatchObject({
      estado: { in: ['FINALIZADO', 'APROBADO'] },
      deletedAt: null,
      horaSalida: { gte: new Date('2026-10-01T05:00:00.000Z'), lt: new Date('2026-11-01T05:00:00.000Z') },
    });
  });

  it('quien ve por agencia solo ve su fila, con su posición real', async () => {
    const { prisma, service } = armar({ ...retoBase, regiones: ['Costa'] });
    prisma.agencia.findMany.mockResolvedValue([
      { id: 'a1', nombre: 'Agencia Uno', regionId: 'costa' },
      { id: 'a2', nombre: 'Agencia Dos', regionId: 'costa' },
    ]);
    prisma.servicioLavado.findMany.mockResolvedValue([lavado('a2', '2026-10-03T15:00:00Z')]);
    const r = await service.ranking('r1', usuario('LIDER', { agenciaId: 'a1', region: { nombre: 'Costa' } }));
    expect(r.participantes).toEqual([expect.objectContaining({ participanteId: 'a1', posicion: 2, valor: 0 })]);
  });

  it('servicios generales solamente: no lee especiales; servicios específicos filtra por catálogo', async () => {
    const generales = armar({ ...retoBase, tipoServicios: 'GENERALES' });
    await generales.service.ranking('r1', usuario('ADMIN'));
    expect(generales.prisma.servicioEspecial.findMany).not.toHaveBeenCalled();

    const especificos = armar({ ...retoBase, tipoServicios: 'ESPECIFICOS', catalogoServicioIds: [3] });
    await especificos.service.ranking('r1', usuario('ADMIN'));
    expect(especificos.prisma.servicioLavado.findMany.mock.calls[0][0].where.servicioCatalogoId).toEqual({ in: [3] });
    expect(especificos.prisma.servicioEspecial.findMany.mock.calls[0][0].where.servicioCatalogoId).toEqual({ in: [3] });
  });

  it('bahías: compiten todas las de las agencias elegidas, sin filtrar servicios por bahía', async () => {
    const { prisma, service } = armar({ ...retoBase, tipoReto: 'BAHIA', sucursalesIds: ['a1'] });
    prisma.bahia.findMany.mockResolvedValue([
      { id: 'b1', nombre: 'Bahía 01', agenciaId: 'a1', agencia: { nombre: 'Agencia Uno', regionId: 'costa' } },
      { id: 'b2', nombre: 'Bahía 02', agenciaId: 'a1', agencia: { nombre: 'Agencia Uno', regionId: 'costa' } },
    ]);
    prisma.servicioLavado.findMany.mockResolvedValue([lavado('a1', '2026-10-03T15:00:00Z', { bahiaId: 'b2' })]);
    const r = await service.ranking('r1', usuario('ADMIN'));
    expect(prisma.bahia.findMany.mock.calls[0][0].where).toEqual({ agencia: { AND: [{ id: { in: ['a1'] } }] } });
    expect(prisma.servicioLavado.findMany.mock.calls[0][0].where).not.toHaveProperty('bahiaId');
    expect(r.participantes.map((p: any) => [p.nombre, p.detalle, p.valor])).toEqual([
      ['Bahía 02', 'Agencia Uno', 1],
      ['Bahía 01', 'Agencia Uno', 0],
    ]);
  });

  it('bahías: muestra quién hizo sus servicios (de más a menos) o, si no tiene, quién está asignado hoy', async () => {
    const { prisma, service } = armar({ ...retoBase, tipoReto: 'BAHIA' });
    prisma.bahia.findMany
      .mockResolvedValueOnce([
        { id: 'b1', nombre: 'Bahía 01', agenciaId: 'a1', agencia: { nombre: 'Agencia Uno', regionId: 'costa' } },
        { id: 'b2', nombre: 'Bahía 02', agenciaId: 'a1', agencia: { nombre: 'Agencia Uno', regionId: 'costa' } },
      ])
      .mockResolvedValueOnce([{ id: 'b2', operadorActualId: 'l3', operadores: [{ operadorId: 'l3' }] }]);
    prisma.servicioLavado.findMany.mockResolvedValue([
      lavado('a1', '2026-10-03T15:00:00Z', { bahiaId: 'b1', operadorId: 'l1' }),
      lavado('a1', '2026-10-04T15:00:00Z', { bahiaId: 'b1', operadorId: 'l2' }),
      lavado('a1', '2026-10-05T15:00:00Z', { bahiaId: 'b1', operadorId: 'l2' }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'l1', name: 'Juan', lastname: 'Paz' },
      { id: 'l2', name: 'Pedro', lastname: 'Mora (CI: 1712345678)' },
      { id: 'l3', name: 'Luis', lastname: 'Vera' },
    ]);
    const r = await service.ranking('r1', usuario('ADMIN'));
    expect(r.participantes[0].personas).toEqual([
      { id: 'l2', nombre: 'Pedro Mora', servicios: 2 },
      { id: 'l1', nombre: 'Juan Paz', servicios: 1 },
    ]);
    expect(r.participantes[1].personas).toEqual([{ id: 'l3', nombre: 'Luis Vera', servicios: null }]);
  });

  it('pulidores: solo especiales completados, y un servicio compartido cuenta para cada asignado', async () => {
    const { prisma, service } = armar({ ...retoBase, tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', pulidoresIds: ['p1', 'p2'] });
    prisma.user.findMany.mockResolvedValue([
      { id: 'p1', name: 'Ana', lastname: 'Paz', agenciaId: null, regionId: 'r1', agencia: null },
      { id: 'p2', name: 'Luis', lastname: 'Mora', agenciaId: 'a1', regionId: 'r1', agencia: { nombre: 'Agencia Uno' } },
    ]);
    prisma.servicioEspecial.findMany.mockResolvedValue([
      { placa: 'X', precio: 50, fechaFin: new Date('2026-10-02T15:00:00Z'), operadorId: 'p1', bahiaId: null, agenciaId: null, operadoresAsignados: [{ operadorId: 'p1' }, { operadorId: 'p2' }] },
    ]);
    const r = await service.ranking('r1', usuario('ADMIN'));
    expect(prisma.servicioLavado.findMany).not.toHaveBeenCalled();
    expect(prisma.servicioEspecial.findMany.mock.calls[0][0].where).toMatchObject({ estado: 'Completado', deletedAt: null });
    expect(r.participantes.map((p: any) => [p.nombre, p.valor, p.detalle])).toEqual([
      ['Ana Paz', 1, 'Pulidor móvil'],
      ['Luis Mora', 1, 'Agencia Uno'],
    ]);
  });

  it('no expone el ranking de un reto fuera del alcance del usuario', async () => {
    const usuarioCosta = usuario('LIDER', { agenciaId: 'a1', region: { nombre: 'Costa' } });
    await expect(armar({ ...retoBase, regiones: ['Sierra'] }).service.ranking('r1', usuarioCosta)).rejects.toThrow(/No tienes acceso/);
    // Un reto privado de pulidores (sin región ni agencias) tampoco: antes su ranking lo podía abrir cualquiera.
    const privado = { ...retoBase, regiones: [], tipoReto: 'PULIDOR', pulidoresIds: ['p1'] };
    await expect(armar(privado).service.ranking('r1', usuarioCosta)).rejects.toThrow(/No tienes acceso/);
    await expect(armar(privado).service.ranking('r1', usuario('PULIDOR', { id: 'p1' }))).resolves.toBeDefined();
  });
});

describe('RetosService.cerrar', () => {
  it('lo cierran su creador o alguien con alcance nacional; el ganador sale del ranking', async () => {
    const { prisma, service } = armar(retoBase);
    prisma.agencia.findMany.mockResolvedValue([{ id: 'a1', nombre: 'Agencia Uno', regionId: 'costa' }]);
    prisma.servicioLavado.findMany.mockResolvedValue([lavado('a1', '2026-10-05T15:00:00Z')]);
    const r = await service.cerrar({ id: 'r1', ganadorNombre: 'Otro', resultado: 'Bien' } as any, usuario('COORD_COMERCIAL'));
    expect(r).toMatchObject({
      estado: 'FINALIZADO',
      ganadorNombre: 'Agencia Uno',
      resultado: 'Bien',
      ganadores: [{ participanteId: 'a1', nombre: 'Agencia Uno', valor: 1, posicion: 1 }],
    });
    await expect(armar(retoBase).service.cerrar({ id: 'r1' } as any, usuario('JEFE_COMERCIAL'))).resolves.toMatchObject({ estado: 'FINALIZADO' });
    await expect(
      armar({ ...retoBase, creadoPorId: 'otro' }).service.cerrar({ id: 'r1' } as any, usuario('COORD_COMERCIAL', { regionId: 'r1' })),
    ).rejects.toThrow(/creador o alguien con alcance nacional/);
  });

  it('sin servicios no hay ganador', async () => {
    await expect(armar(retoBase).service.cerrar({ id: 'r1' } as any, usuario('ADMIN'))).resolves.toMatchObject({ ganadorNombre: null, ganadores: [] });
  });

  it('no permite cerrar un reto ya finalizado ni uno inexistente', async () => {
    await expect(armar({ ...retoBase, estado: 'FINALIZADO' }).service.cerrar({ id: 'r1' } as any, usuario('ADMIN'))).rejects.toThrow(/ya fue cerrado/);
    await expect(armar(null).service.cerrar({ id: 'r1' } as any, usuario('ADMIN'))).rejects.toThrow(/no encontrado/);
  });
});

describe('RetosService.cerrarVencidos', () => {
  it('cierra solo los activos cuya fecha fin ya pasó (hora de Ecuador), sin usuario que cierre', async () => {
    const { prisma, service } = armar();
    prisma.reto.findMany.mockResolvedValue([retoBase, { ...retoBase, id: 'r2' }]);
    await expect(service.cerrarVencidos()).resolves.toBe(2);
    const where = prisma.reto.findMany.mock.calls[0][0].where;
    expect(where.estado).toBe('ACTIVO');
    expect(where.fechaFin.lt).toBeInstanceOf(Date);
    expect(prisma.reto.update.mock.calls[0][0].data).toMatchObject({ estado: 'FINALIZADO', cerradoPorId: null, resultado: 'Cerrado automáticamente al vencer.' });
  });

  it('si un reto falla, sigue con los demás', async () => {
    const { prisma, service } = armar();
    prisma.reto.findMany.mockResolvedValue([retoBase, { ...retoBase, id: 'r2' }]);
    prisma.reto.update.mockRejectedValueOnce(new Error('db caída'));
    await expect(service.cerrarVencidos()).resolves.toBe(1);
  });
});
