import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Al técnico solo le deben salir las incidencias y mantenimientos que le asignó el coordinador de mantenimiento de su
 * región — no todos los de la región. El coordinador (quien asigna) sigue viendo todo lo de su región. Ver conversación
 * con el usuario del 2026-09-30.
 *
 * Mundo: región COSTA con la máquina M1; el técnico T1, otro técnico T2 y el coordinador de COSTA; y una máquina en SIERRA.
 *  Mantenimientos: m-t1 (de T1) · m-t2 (de T2) · m-coord (del coordinador) · m-sierra (de otra región)
 *  Incidencias:    i-t1 (asignada a T1) · i-t2 (a T2) · i-coord (al coordinador) · i-sin (sin asignar) · i-sierra (otra región)
 */
describe('el técnico solo ve lo que le asignaron a él (no toda su región) — base real', () => {
  let env: Entorno;
  let service: MaquinariaService;
  let tecnico: Actor;
  let coord: Actor;
  const m: Record<string, string> = {};
  const i: Record<string, string> = {};

  const idsDe = (r: any, mapa: Record<string, string>) => r.data.map((x: any) => Object.entries(mapa).find(([, id]) => id === x.id)?.[0]).sort();

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new MaquinariaService(env.prisma as never, env.storage(), env.notificaciones());

    const costa = await env.region('COSTA');
    const sierra = await env.region('SIERRA');
    const aCosta = await env.agencia('COSTA', { regionId: costa.id });
    const aSierra = await env.agencia('SIERRA', { regionId: sierra.id });
    const mCosta = await env.maquinaria('COSTA', { agenciaId: aCosta.id });
    const mSierra = await env.maquinaria('SIERRA', { agenciaId: aSierra.id });

    const t1 = await env.usuario('t1', 'TECNICO', { regionId: costa.id });
    const t2 = await env.usuario('t2', 'TECNICO', { regionId: costa.id });
    const coordUsuario = await env.usuario('coord', 'COORD_MANTENIMIENTO', { regionId: costa.id });
    const sierraTecnico = await env.usuario('t-sierra', 'TECNICO', { regionId: sierra.id });
    tecnico = { id: t1.id, rol: 'TECNICO', regionId: costa.id, agenciaId: null };
    coord = { id: coordUsuario.id, rol: 'COORD_MANTENIMIENTO', regionId: costa.id, agenciaId: null };

    const mantenimiento = async (clave: string, maquina: any, tecnicoId: string) => {
      m[clave] = (await env.prisma.mantenimientoMaquinaria.create({ data: { maquinariaId: maquina.id, tecnicoId, estado: 'PENDIENTE', fechaProgramada: new Date() } })).id;
    };
    await mantenimiento('m-t1', mCosta, t1.id);
    await mantenimiento('m-t2', mCosta, t2.id);
    await mantenimiento('m-coord', mCosta, coordUsuario.id);
    await mantenimiento('m-sierra', mSierra, sierraTecnico.id);

    const incidente = async (clave: string, maquina: any, tecnicoAsignadoId: string | null) => {
      i[clave] = (
        await env.prisma.incidenteTecnico.create({
          data: { maquinariaId: maquina.id, reportadoPorId: t2.id, titulo: `${env.marca} ${clave}`, descripcion: 'prueba', estado: tecnicoAsignadoId ? 'EN_PROCESO' : 'ABIERTO', tecnicoAsignadoId },
        })
      ).id;
    };
    await incidente('i-t1', mCosta, t1.id);
    await incidente('i-t2', mCosta, t2.id);
    await incidente('i-coord', mCosta, coordUsuario.id);
    await incidente('i-sin', mCosta, null);
    await incidente('i-sierra', mSierra, sierraTecnico.id);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('listMantenimientos: el técnico solo ve los suyos, no los de su región', async () => {
    const r: any = await service.listMantenimientos({ pageSize: 50 } as never, tecnico);
    expect(idsDe(r, m)).toEqual(['m-t1']);
  });

  it('listIncidentes: el técnico solo ve las asignadas a él, no las de su región', async () => {
    const r: any = await service.listIncidentes({ pageSize: 50 } as never, tecnico);
    expect(idsDe(r, i)).toEqual(['i-t1']);
  });

  it('el coordinador de mantenimiento sigue viendo todo lo de su región (además de lo suyo propio)', async () => {
    const r: any = await service.listMantenimientos({ pageSize: 50 } as never, coord);
    expect(idsDe(r, m)).toEqual(['m-coord', 'm-t1', 'm-t2']); // los de COSTA; no el de SIERRA
  });

  it('el coordinador de mantenimiento sigue viendo todos los incidentes de su región (además de los suyos)', async () => {
    const r: any = await service.listIncidentes({ pageSize: 50 } as never, coord);
    expect(idsDe(r, i)).toEqual(['i-coord', 'i-sin', 'i-t1', 'i-t2']); // los de COSTA; no el de SIERRA
  });
});
