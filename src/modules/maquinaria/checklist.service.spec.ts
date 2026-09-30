import { describe, expect, it, vi } from 'vitest';
import { ChecklistService } from './checklist.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';

const usuario = (namerol: string, extra: Record<string, unknown> = {}) => {
  const r = ROLES_BASE.find((x) => x.namerol === namerol)!;
  return { id: `id-${namerol}`, name: 'Ana', lastname: namerol, roleDetails: { namerol, capacidades: r.capacidades, ambito: r.ambito }, ...extra };
};

const PLANTILLA = {
  id: 'p1', tipo: 'PREVENTIVO', version: 2,
  pasos: [
    { orden: 1, texto: 'Desconectar y bloquear el equipo', obligatorio: true },
    { orden: 2, texto: 'Anotar observaciones', obligatorio: false },
  ],
};

function armar(respuestas: any[] = [], plantilla: any = PLANTILLA) {
  const almacen = [...respuestas];
  const tx: any = {
    checklistPlantilla: {
      findFirst: vi.fn().mockResolvedValue({ version: 1 }),
      updateMany: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockImplementation(async (a: any) => ({ id: 'nueva', ...a.data })),
    },
  };
  const prisma: any = {
    checklistPlantilla: { findFirst: vi.fn().mockResolvedValue(plantilla), findMany: vi.fn().mockResolvedValue([plantilla]) },
    checklistRespuesta: {
      findMany: vi.fn().mockImplementation(async () => [...almacen]),
      createMany: vi.fn().mockImplementation(async ({ data }: any) => {
        data.forEach((d: any, i: number) => almacen.push({ id: `r${i + 1}`, completado: false, ...d }));
        return { count: data.length };
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => almacen.find((r) => r.id === where.id) ?? null),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const fila = almacen.find((r) => r.id === where.id);
        Object.assign(fila, data);
        return { ...fila };
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };
  return { prisma, tx, service: new ChecklistService(prisma) };
}

describe('plantillas de checklist', () => {
  it('guardar crea una versión nueva y desactiva la anterior, con los pasos en orden', async () => {
    const { tx, service } = armar();
    const r: any = await service.guardarPlantilla({ tipo: 'preventivo', pasos: [{ texto: 'Revisar fugas' }, { texto: 'Probar en vacío', obligatorio: false }] }, usuario('COORD_MANTENIMIENTO'));
    expect(tx.checklistPlantilla.updateMany).toHaveBeenCalledWith({ where: { tipo: 'PREVENTIVO', activa: true }, data: { activa: false } });
    expect(r.version).toBe(2);
    expect(r.creadaPorId).toBe('id-COORD_MANTENIMIENTO');
    expect(r.pasos.create).toEqual([
      { orden: 1, texto: 'Revisar fugas', obligatorio: true },
      { orden: 2, texto: 'Probar en vacío', obligatorio: false },
    ]);
  });

  it('valida el tipo, la cantidad y el texto de los pasos', async () => {
    const { service } = armar();
    const a = usuario('ADMIN');
    await expect(service.guardarPlantilla({ tipo: 'OTRO', pasos: [{ texto: 'Algo' }] }, a)).rejects.toThrow(/PREVENTIVO o CORRECTIVO/);
    await expect(service.guardarPlantilla({ tipo: 'PREVENTIVO', pasos: [] }, a)).rejects.toThrow(/al menos un paso/);
    await expect(service.guardarPlantilla({ tipo: 'PREVENTIVO', pasos: Array.from({ length: 31 }, () => ({ texto: 'Paso válido' })) }, a)).rejects.toThrow(/hasta 30/);
    await expect(service.guardarPlantilla({ tipo: 'PREVENTIVO', pasos: [{ texto: 'ok' }] }, a)).rejects.toThrow(/paso 1/);
  });
});

describe('checklist de una orden', () => {
  it('la primera vez copia los pasos de la plantilla activa, con su versión, y las siguientes no repiten', async () => {
    const { prisma, service } = armar();
    const c = await service.obtenerDeMantenimiento('m1', 'PREVENTIVO');
    expect(c.pasos).toHaveLength(2);
    expect(c.pasos[0]).toMatchObject({ mantenimientoId: 'm1', plantillaVersion: 2, texto: 'Desconectar y bloquear el equipo', obligatorio: true });
    expect(c).toMatchObject({ requerido: true, obligatoriosPendientes: 1, completo: false });
    await service.obtenerDeMantenimiento('m1', 'PREVENTIVO');
    expect(prisma.checklistRespuesta.createMany).toHaveBeenCalledTimes(1);
  });

  it('sin plantilla para el tipo no se exige nada', async () => {
    const { service } = armar([], null);
    const c = await service.obtenerDeMantenimiento('m1', 'CORRECTIVO');
    expect(c).toMatchObject({ pasos: [], requerido: false, completo: true });
    await expect(service.exigirCompleto('m1', 'CORRECTIVO')).resolves.toBeUndefined();
  });

  it('marcar guarda quién y cuándo; desmarcar los borra', async () => {
    const { service } = armar();
    await service.obtenerDeMantenimiento('m1', 'PREVENTIVO');
    const hecho: any = await service.marcar({ mantenimientoId: 'm1', pasoId: 'r1', completado: true, observacion: ' ok ' }, usuario('TECNICO'));
    expect(hecho).toMatchObject({ completado: true, observacion: 'ok', marcadoPorId: 'id-TECNICO', marcadoPorNombre: 'Ana TECNICO' });
    expect(hecho.marcadoEn).toBeInstanceOf(Date);
    const deshecho: any = await service.marcar({ mantenimientoId: 'm1', pasoId: 'r1', completado: false }, usuario('TECNICO'));
    expect(deshecho).toMatchObject({ completado: false, marcadoPorId: null, marcadoEn: null });
  });

  it('un paso de otra orden no se puede marcar', async () => {
    const { service } = armar();
    await service.obtenerDeMantenimiento('m1', 'PREVENTIVO');
    await expect(service.marcar({ mantenimientoId: 'm2', pasoId: 'r1', completado: true }, usuario('TECNICO'))).rejects.toThrow(/no encontrado/);
  });

  it('no se cierra la orden con pasos obligatorios sin marcar; con los obligatorios hechos sí (el opcional no bloquea)', async () => {
    const { service } = armar();
    await expect(service.exigirCompleto('m1', 'PREVENTIVO')).rejects.toThrow(/faltan pasos obligatorios[\s\S]*1\. Desconectar/);
    await service.marcar({ mantenimientoId: 'm1', pasoId: 'r1', completado: true }, usuario('TECNICO'));
    await expect(service.exigirCompleto('m1', 'PREVENTIVO')).resolves.toBeUndefined();
  });

  it('solo el técnico asignado o un administrador marcan, y no una orden ya ejecutada', () => {
    const { service } = armar();
    expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'id-TECNICO', estado: 'PENDIENTE' }, usuario('TECNICO'))).not.toThrow();
    expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'otro', estado: 'PENDIENTE' }, usuario('ADMIN'))).not.toThrow();
    expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'otro', estado: 'PENDIENTE' }, usuario('TECNICO'))).toThrow(/técnico asignado/);
    expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'otro', estado: 'PENDIENTE' }, usuario('COORD_MANTENIMIENTO'))).toThrow(/técnico asignado/);
    expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'id-TECNICO', estado: 'FINALIZADO' }, usuario('TECNICO'))).toThrow(/ya fue ejecutado/);
  });
});
