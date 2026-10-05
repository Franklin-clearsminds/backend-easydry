import { describe, expect, it, vi } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';

/**
 * Al técnico solo le deben salir las incidencias y mantenimientos que le asignó el coordinador de
 * mantenimiento de su región — no todos los de la región. El coordinador (quien asigna) sigue viendo
 * todo lo de su región. Ver conversación con el usuario del 2026-09-30.
 */
const tecnico: Actor = { id: 'tec-1', rol: 'TECNICO', regionId: 'costa', agenciaId: null };
const coordCosta: Actor = { id: 'coord-costa', rol: 'COORD_MANTENIMIENTO', regionId: 'costa', agenciaId: null };

function servicioConCapturaDeWhere(modelo: 'incidenteTecnico' | 'mantenimientoMaquinaria') {
  const wheres: unknown[] = [];
  const count = vi.fn(async ({ where }: any) => { wheres.push(where); return 0; });
  const findMany = vi.fn(async ({ where }: any) => { wheres.push(where); return []; });
  const prisma = { [modelo]: { count, findMany } };
  const service = new MaquinariaService(prisma as never, {} as never, {} as never);
  return { service, wheres };
}

describe('el técnico solo ve lo que le asignaron a él (no toda su región)', () => {
  it('listMantenimientos: filtra por tecnicoId, no por región', async () => {
    const { service, wheres } = servicioConCapturaDeWhere('mantenimientoMaquinaria');
    await service.listMantenimientos({ pageSize: 10 } as never, tecnico);
    for (const w of wheres) {
      const json = JSON.stringify(w);
      expect(json).toContain('"tecnicoId":"tec-1"');
      expect(json).not.toMatch(/regionId/);
    }
  });

  it('listIncidentes: filtra por tecnicoAsignadoId, no por región', async () => {
    const { service, wheres } = servicioConCapturaDeWhere('incidenteTecnico');
    await service.listIncidentes({ pageSize: 10 } as never, tecnico);
    for (const w of wheres) {
      const json = JSON.stringify(w);
      expect(json).toContain('"tecnicoAsignadoId":"tec-1"');
      expect(json).not.toMatch(/regionId/);
    }
  });

  it('el coordinador de mantenimiento sigue viendo todo lo de su región (además de lo suyo propio)', async () => {
    const { service, wheres } = servicioConCapturaDeWhere('mantenimientoMaquinaria');
    await service.listMantenimientos({ pageSize: 10 } as never, coordCosta);
    const json = JSON.stringify(wheres[0]);
    expect(json).toContain('"regionId":"costa"');
    expect(json).toContain('"tecnicoId":"coord-costa"');
  });

  it('el coordinador de mantenimiento sigue viendo todos los incidentes de su región (además de los suyos)', async () => {
    const { service, wheres } = servicioConCapturaDeWhere('incidenteTecnico');
    await service.listIncidentes({ pageSize: 10 } as never, coordCosta);
    const json = JSON.stringify(wheres[0]);
    expect(json).toContain('"regionId":"costa"');
    expect(json).toContain('"tecnicoAsignadoId":"coord-costa"');
  });
});
