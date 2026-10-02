import { describe, expect, it, vi } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

function servicio(estado = 'FINALIZADO', extra: Record<string, unknown> = {}) {
  return {
    id: 's1', estado, deletedAt: null, version: 1, operadorId: 'lav', observaciones: null, observacionGerente: null,
    bahia: { agenciaId: 'a1', agencia: { id: 'a1', regionId: 'r1', nombre: 'Uno', codigo: 'A1' } },
    consumos: [], evidencias: [], catalogo: {}, operador: { id: 'lav' },
    ...extra,
  };
}

/** `conAprobador`: la agencia a1 tiene un usuario APROBADOR activo. */
function armar(svc: any = servicio(), conAprobador = false) {
  const prisma: any = {
    servicioLavado: {
      findFirst: vi.fn().mockResolvedValue(svc),
      update: vi.fn().mockImplementation(async (a: any) => ({ ...svc, ...a.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]),
      count: vi.fn().mockResolvedValue(0),
    },
    agencia: { findUnique: vi.fn().mockResolvedValue({ id: 'a1', regionId: 'r1', nombre: 'Uno' }) },
    user: { count: vi.fn().mockResolvedValue(conAprobador ? 1 : 0) },
    auditoriaDecision: { create: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    evidenciaServicio: { create: vi.fn().mockResolvedValue({}) },
    bahia: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, service: new OperacionesService(prisma, undefined, new DecisionesService(prisma)) };
}
const auditoria = (prisma: any) => prisma.auditoriaDecision.create.mock.calls.map((c: any) => c[0].data);

describe('aprobar y rechazar — quién decide', () => {
  it('el aprobador de la agencia aprueba como TITULAR y queda registrado con su id y la regla', async () => {
    const { prisma, service } = armar(servicio(), true);
    await service.aprobarServicio('s1', 'ok', usuario('APROBADOR', { agenciaId: 'a1' }));
    const data = prisma.servicioLavado.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ estado: 'APROBADO', decididoPorId: 'id-APROBADOR', reglaDecision: 'TITULAR', aprobadoPor: 'Ana APROBADOR' });
    expect(auditoria(prisma)[0]).toMatchObject({ entidad: 'SERVICIO_LAVADO', accion: 'APROBAR', usuarioId: 'id-APROBADOR', regla: 'TITULAR', agenciaId: 'a1' });
  });

  it('un aprobador no puede decidir sobre otra agencia', async () => {
    const { prisma, service } = armar(servicio(), true);
    await expect(service.aprobarServicio('s1', undefined, usuario('APROBADOR', { agenciaId: 'a9' }))).rejects.toThrow(/tu agencia/);
    expect(prisma.servicioLavado.update).not.toHaveBeenCalled();
  });

  it('si la agencia tiene aprobador, ni ADMIN, ni SUPER_ADMIN ni SUPERVISOR pueden aprobar', async () => {
    for (const rol of ['ADMIN', 'SUPER_ADMIN']) {
      const { service } = armar(servicio(), true);
      await expect(service.aprobarServicio('s1', undefined, usuario(rol))).rejects.toThrow(/aprobador designado/);
    }
    const { service } = armar(servicio(), true);
    await expect(service.aprobarServicio('s1', undefined, usuario('SUPERVISOR', { regionId: 'r1' }))).rejects.toThrow(/aprobador designado/);
  });

  it('si la agencia NO tiene aprobador, ADMIN, SUPER_ADMIN y el SUPERVISOR de su región aprueban como RESPALDO', async () => {
    for (const u of [usuario('ADMIN'), usuario('SUPER_ADMIN'), usuario('SUPERVISOR', { regionId: 'r1' })]) {
      const { prisma, service } = armar(servicio(), false);
      await service.aprobarServicio('s1', undefined, u);
      expect(prisma.servicioLavado.update.mock.calls[0][0].data.reglaDecision).toBe('RESPALDO');
      expect(auditoria(prisma)[0].regla).toBe('RESPALDO');
    }
  });

  it('un supervisor de otra región no aprueba, aunque la agencia no tenga aprobador', async () => {
    const { service } = armar(servicio(), false);
    await expect(service.aprobarServicio('s1', undefined, usuario('SUPERVISOR', { regionId: 'r-otra' }))).rejects.toThrow(/tu región/);
  });

  it('ningún otro rol aprueba ni rechaza (líder, coordinadores, bodega…)', async () => {
    for (const rol of ['LIDER', 'COORD_SERVICIOS_ESPECIALES', 'COORD_BODEGA', 'JEFE_COMERCIAL', 'LAVADOR', 'PULIDOR']) {
      const { service } = armar(servicio(), false);
      await expect(service.aprobarServicio('s1', undefined, usuario(rol, { agenciaId: 'a1' }))).rejects.toThrow(/no puede aprobar/);
    }
  });

  it('solo se aprueba lo finalizado y no anulado', async () => {
    await expect(armar(servicio('EN_PROCESO')).service.aprobarServicio('s1', undefined, usuario('ADMIN'))).rejects.toThrow(/finalizados/);
    await expect(armar(servicio('FINALIZADO', { deletedAt: new Date() })).service.aprobarServicio('s1', undefined, usuario('ADMIN'))).rejects.toThrow(/anulado/);
  });

  it('rechazar exige motivo, usa la misma regla y lo deja registrado', async () => {
    const { prisma, service } = armar(servicio(), true);
    await expect(service.rechazarServicio('s1', ' no ', usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/motivo es obligatorio/);
    await service.rechazarServicio('s1', 'Falta foto de salida', usuario('APROBADOR', { agenciaId: 'a1' }));
    expect(prisma.servicioLavado.update.mock.calls[0][0].data).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'Falta foto de salida', decididoPorId: 'id-APROBADOR' });
    expect(auditoria(prisma)[0]).toMatchObject({ accion: 'RECHAZAR', motivo: 'Falta foto de salida', regla: 'TITULAR' });
  });
});

describe('aprobar todos', () => {
  it('exige indicar la agencia: nunca aprueba todo el país', async () => {
    const { prisma, service } = armar();
    await expect(service.aprobarTodosServicios(usuario('ADMIN'), undefined)).rejects.toThrow(/Indica la agencia/);
    expect(prisma.servicioLavado.updateMany).not.toHaveBeenCalled();
  });

  it('solo toca la agencia indicada, registra a quien decidió y deja un registro por servicio', async () => {
    const { prisma, service } = armar(servicio(), true);
    const r = await service.aprobarTodosServicios(usuario('APROBADOR', { agenciaId: 'a1' }), 'a1');
    expect(prisma.servicioLavado.findMany.mock.calls[0][0].where.bahia).toEqual({ agenciaId: 'a1' });
    expect(prisma.servicioLavado.updateMany.mock.calls[0][0].data).toMatchObject({ decididoPorId: 'id-APROBADOR', reglaDecision: 'TITULAR' });
    expect(prisma.auditoriaDecision.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(r.aprobadosCount).toBe(2);
  });

  it('un aprobador no cierra otra agencia y un administrador no cierra una que tiene aprobador', async () => {
    await expect(armar(servicio(), true).service.aprobarTodosServicios(usuario('APROBADOR', { agenciaId: 'a9' }), 'a1')).rejects.toThrow(/tu agencia/);
    await expect(armar(servicio(), true).service.aprobarTodosServicios(usuario('ADMIN'), 'a1')).rejects.toThrow(/aprobador designado/);
  });
});

describe('anular', () => {
  it('exige motivo y guarda quién, cuándo y por qué', async () => {
    const { prisma, service } = armar(servicio('EN_PROCESO'));
    await expect(service.softDelete('s1', '', true, usuario('LIDER', { agenciaId: 'a1' }))).rejects.toThrow(/motivo es obligatorio/);
    await service.softDelete('s1', 'Vehículo equivocado', true, usuario('LIDER', { agenciaId: 'a1' }));
    const data = prisma.servicioLavado.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ estado: 'CANCELADO', anuladoPorId: 'id-LIDER', motivoAnulacion: 'Vehículo equivocado' });
    expect(data.anuladoEn).toBeInstanceOf(Date);
    expect(auditoria(prisma)[0]).toMatchObject({ accion: 'ANULAR', motivo: 'Vehículo equivocado', agenciaId: 'a1' });
  });

  it('antes de aprobar anulan el líder y el aprobador de su agencia; no el de otra agencia ni el supervisor', async () => {
    for (const u of [usuario('LIDER', { agenciaId: 'a1' }), usuario('APROBADOR', { agenciaId: 'a1' })]) {
      const { prisma, service } = armar(servicio('FINALIZADO'));
      await service.softDelete('s1', 'Duplicado', true, u);
      expect(prisma.servicioLavado.update).toHaveBeenCalled();
    }
    await expect(armar().service.softDelete('s1', 'Duplicado', true, usuario('LIDER', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
    await expect(armar().service.softDelete('s1', 'Duplicado', true, usuario('SUPERVISOR', { regionId: 'r1' }))).rejects.toThrow(/no puede anular/);
  });

  it('un servicio aprobado solo lo anula un administrador', async () => {
    await expect(armar(servicio('APROBADO')).service.softDelete('s1', 'Error', true, usuario('LIDER', { agenciaId: 'a1' }))).rejects.toThrow(/solo lo puede anular un administrador/);
    await expect(armar(servicio('APROBADO')).service.softDelete('s1', 'Error', true, usuario('APROBADOR', { agenciaId: 'a1' }))).rejects.toThrow(/solo lo puede anular un administrador/);
    const { prisma, service } = armar(servicio('APROBADO'));
    await service.softDelete('s1', 'Error de digitación', true, usuario('ADMIN'));
    expect(auditoria(prisma)[0]).toMatchObject({ accion: 'ANULAR', regla: 'ADMIN' });
  });

  it('un servicio ya anulado no se vuelve a anular', async () => {
    await expect(armar(servicio('CANCELADO', { deletedAt: new Date() })).service.softDelete('s1', 'Otra vez', true, usuario('ADMIN'))).rejects.toThrow(/ya está anulado/);
  });
});

describe('editar servicios', () => {
  it('un servicio aprobado solo lo edita un administrador, con motivo, y queda registrado', async () => {
    await expect(armar(servicio('APROBADO')).service.update('s1', { id: 's1', observaciones: 'x' } as any, false, usuario('LIDER', { agenciaId: 'a1' }))).rejects.toThrow(/solo lo puede editar un administrador/);
    const { prisma, service } = armar(servicio('APROBADO'));
    await expect(service.update('s1', { id: 's1', observaciones: 'x' } as any, false, usuario('ADMIN'))).rejects.toThrow(/motivo es obligatorio/);
    await service.update('s1', { id: 's1', observaciones: 'Corregido', motivoCorreccion: 'Placa mal digitada' } as any, false, usuario('ADMIN'));
    expect(prisma.servicioLavado.update.mock.calls[0][0].data).not.toHaveProperty('motivoCorreccion');
    expect(auditoria(prisma)[0]).toMatchObject({ accion: 'EDITAR_APROBADO', motivo: 'Placa mal digitada' });
  });

  it('por editar no se puede aprobar, rechazar ni anular: tienen sus propias acciones', async () => {
    for (const estado of ['APROBADO', 'RECHAZADO', 'CANCELADO']) {
      const { prisma, service } = armar(servicio('FINALIZADO'));
      await expect(service.update('s1', { id: 's1', estado } as any, false, usuario('ADMIN'))).rejects.toThrow(/acción correspondiente/);
      expect(prisma.servicioLavado.update).not.toHaveBeenCalled();
    }
  });

  it('el líder solo edita servicios de su agencia', async () => {
    await expect(armar(servicio('EN_PROCESO')).service.update('s1', { id: 's1', observaciones: 'x' } as any, false, usuario('LIDER', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
  });

  it('al finalizar ya no se aprueba solo, aunque la agencia no tenga aprobador', async () => {
    const svc = servicio('EN_PROCESO', { consumos: [{ id: 'c' }] });
    const { prisma, service } = armar(svc, false);
    await service.update('s1', { id: 's1', estado: 'FINALIZADO', fotoSalidaUrl: 'evidencia.jpg' } as any, false, usuario('LIDER', { agenciaId: 'a1' }));
    const data = prisma.servicioLavado.update.mock.calls[0][0].data;
    expect(data.estado).toBe('FINALIZADO');
    expect(data).not.toHaveProperty('aprobadoPor');
  });

  it('no se puede finalizar sin evidencia de salida (foto o vídeo), llamando directo al endpoint', async () => {
    const { prisma, service } = armar(servicio('EN_PROCESO', { consumos: [{ id: 'c' }] }));
    await expect(
      service.update('s1', { id: 's1', estado: 'FINALIZADO' } as any, false, usuario('LIDER', { agenciaId: 'a1' })),
    ).rejects.toThrow(/evidencia de salida/);
    expect(prisma.servicioLavado.update).not.toHaveBeenCalled();
  });

  it('la evidencia ya guardada en el servicio alcanza (no hace falta reenviarla al finalizar)', async () => {
    const { prisma, service } = armar(servicio('EN_PROCESO', { consumos: [{ id: 'c' }], fotoSalidaUrl: 'ya-subida.jpg' }));
    await service.update('s1', { id: 's1', estado: 'FINALIZADO' } as any, false, usuario('LIDER', { agenciaId: 'a1' }));
    expect(prisma.servicioLavado.update).toHaveBeenCalledTimes(1);
  });

  it('el offline sync puede finalizar sin evidencia en el payload (su propio flujo la maneja aparte)', async () => {
    const { prisma, service } = armar(servicio('EN_PROCESO', { consumos: [{ id: 'c' }] }));
    await service.update('s1', { id: 's1', estado: 'FINALIZADO' } as any, true, usuario('LIDER', { agenciaId: 'a1' }));
    expect(prisma.servicioLavado.update).toHaveBeenCalledTimes(1);
  });

  it('un servicio ya FINALIZADO no vuelve a exigir evidencia (no es la primera transición)', async () => {
    const { prisma, service } = armar(servicio('FINALIZADO', { consumos: [{ id: 'c' }], fotoSalidaUrl: 'ya-subida.jpg' }));
    await service.update('s1', { id: 's1', estado: 'FINALIZADO', observaciones: 'retoque' } as any, false, usuario('ADMIN'));
    expect(prisma.servicioLavado.update).toHaveBeenCalledTimes(1);
  });
});

describe('ver un servicio', () => {
  it('el detalle exige que el servicio esté en el alcance del usuario', async () => {
    const { service } = armar();
    await expect(service.findOne('s1', usuario('LIDER', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
    await expect(service.findOne('s1', usuario('SUPERVISOR', { regionId: 'r-otra' }))).rejects.toThrow(/alcance/);
    await expect(service.findOne('s1', usuario('APROBADOR', { agenciaId: 'a1' }))).resolves.toBeDefined();
    await expect(service.findOne('s1', usuario('SUPERVISOR', { regionId: 'r1' }))).resolves.toBeDefined();
    await expect(service.findOne('s1', usuario('ADMIN'))).resolves.toBeDefined();
  });
});

describe('listado: qué puede decidir cada usuario', () => {
  function armarLista(finalizados: any[], conAprobador: boolean) {
    const { prisma, service } = armar(servicio(), conAprobador);
    prisma.servicioLavado.findMany.mockResolvedValue(finalizados);
    prisma.servicioLavado.count.mockResolvedValue(finalizados.length);
    prisma.user.findMany = vi.fn().mockResolvedValue(conAprobador ? [{ agenciaId: 'a1' }] : []);
    return { service };
  }
  const fila = () => ({
    id: 's1', estado: 'FINALIZADO', deletedAt: null, operadorId: 'lav', horaIngreso: new Date(), createdAt: new Date(), updatedAt: new Date(),
    bahia: { id: 'b1', nombre: 'Bahía 1', agenciaId: 'a1', agencia: { id: 'a1', nombre: 'Uno', codigo: 'A1', regionId: 'r1' } },
    catalogo: { id: 1, nombre: 'Lavado', recetas: [] }, operador: { id: 'lav', name: 'L', lastname: 'V' }, consumos: [], evidencias: [],
  });

  it('con aprobador: solo él puede decidir; el administrador y el supervisor no', async () => {
    const a: any = await armarLista([fila()], true).service.findAll({}, usuario('APROBADOR', { agenciaId: 'a1' }));
    expect(a.items[0]).toMatchObject({ puedeDecidir: true, agenciaSinAprobador: false });
    const b: any = await armarLista([fila()], true).service.findAll({}, usuario('ADMIN'));
    expect(b.items[0]).toMatchObject({ puedeDecidir: false, agenciaSinAprobador: false });
    const c: any = await armarLista([fila()], true).service.findAll({}, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(c.items[0].puedeDecidir).toBe(false);
  });

  it('sin aprobador: puede decidir el administrador y el supervisor de la región (no el de otra)', async () => {
    const a: any = await armarLista([fila()], false).service.findAll({}, usuario('ADMIN'));
    expect(a.items[0]).toMatchObject({ puedeDecidir: true, agenciaSinAprobador: true });
    const b: any = await armarLista([fila()], false).service.findAll({}, usuario('SUPERVISOR', { regionId: 'r1' }));
    expect(b.items[0].puedeDecidir).toBe(true);
    const c: any = await armarLista([fila()], false).service.findAll({}, usuario('SUPERVISOR', { regionId: 'r-otra' }));
    expect(c.items[0].puedeDecidir).toBe(false); // (en la base ni siquiera le llegaría: el filtro por región lo excluye)
  });
});

describe('historial de decisiones', () => {
  it('devuelve el registro de un servicio dentro del alcance y lo niega fuera de él', async () => {
    const { prisma, service } = armar(servicio('APROBADO'));
    prisma.auditoriaDecision.findMany = vi.fn().mockResolvedValue([{ accion: 'APROBAR', usuarioNombre: 'Ana', regla: 'TITULAR' }]);
    const r = await service.historialDecisiones('s1', usuario('APROBADOR', { agenciaId: 'a1' }));
    expect(r).toHaveLength(1);
    expect(prisma.auditoriaDecision.findMany.mock.calls[0][0].where).toEqual({ entidad: 'SERVICIO_LAVADO', entidadId: 's1' });
    await expect(service.historialDecisiones('s1', usuario('LIDER', { agenciaId: 'a9' }))).rejects.toThrow(/alcance/);
  });
});
