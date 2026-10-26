import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import { actorFromUser, type Actor } from './maquinaria.permisos.js';
import { funcionesDeUsuario } from '../../common/permisos/funciones.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Un rol creado desde «Roles y permisos» con los mismos permisos, ámbito y funciones que un rol oficial debe comportarse
 * igual, aunque se llame distinto. Aquí se clona cada rol oficial de maquinaria, se pone al usuario clon en el mismo lugar
 * que el oficial y se compara lo que ve en cada listado.
 *
 * Mundo: región COSTA (agencia A-COSTA, máquinas M-COSTA y M-PROPIA, esta última a nombre del usuario) y región SIERRA
 * (A-SIERRA, M-SIERRA); incidencias y mantenimientos asignados a distintas personas, en ambas regiones.
 */
const OFICIALES = ['TECNICO', 'COORD_MANTENIMIENTO', 'SUPERVISOR', 'LIDER', 'PULIDOR', 'ADMIN'] as const;

describe('un rol personalizado con los permisos de uno oficial se comporta igual (maquinaria, base real)', () => {
  let env: Entorno;
  let service: MaquinariaService;
  const pares: Record<string, { oficial: Actor; clon: Actor; oficialUser: any; clonUser: any }> = {};

  const idsDe = (r: any) => (r.data as any[]).map((x) => x.id).sort();

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new MaquinariaService(env.prisma as never, env.storage(), env.notificaciones());

    const costa = await env.region('COSTA');
    const sierra = await env.region('SIERRA');
    const aCosta = await env.agencia('A-COSTA', { regionId: costa.id });
    const aSierra = await env.agencia('A-SIERRA', { regionId: sierra.id });

    // Usuario clon: mismo rol copiado (permisos, ámbito, funciones) con otro nombre, y mismo lugar que el oficial.
    const lugar = (rol: string) =>
      rol === 'LIDER' ? { agenciaId: aCosta.id, regionId: costa.id } : rol === 'ADMIN' ? {} : { regionId: costa.id };
    const clonRoles: Record<string, string> = {};
    for (const nombre of OFICIALES) {
      const base = await env.prisma.role.findUniqueOrThrow({ where: { namerol: nombre } });
      const clon = await env.prisma.role.create({
        data: {
          namerol: `${env.marca}-CLON-${nombre}`,
          descripcion: `Copia de ${nombre} para pruebas`,
          estado: 1,
          permisos: base.permisos,
          acciones: base.acciones,
          capacidades: base.capacidades,
          ambito: base.ambito,
        },
      });
      env.rastrear('Role', clon.id);
      clonRoles[nombre] = clon.namerol;
    }
    for (const nombre of OFICIALES) {
      const oficial = await env.usuario(`of-${nombre}`, nombre, lugar(nombre));
      const clon = await env.usuario(`cl-${nombre}`, clonRoles[nombre], lugar(nombre));
      const oficialUser = await env.actor(oficial.id);
      const clonUser = await env.actor(clon.id);
      pares[nombre] = { oficial: actorFromUser(oficialUser), clon: actorFromUser(clonUser), oficialUser, clonUser };
    }

    const mCosta = await env.maquinaria('M-COSTA', { agenciaId: aCosta.id });
    const mSierra = await env.maquinaria('M-SIERRA', { agenciaId: aSierra.id });
    // Máquinas a nombre de cada usuario (las ve el pulidor/operador dueño), en ambos lados del par.
    for (const nombre of OFICIALES) {
      await env.maquinaria(`propia-of-${nombre}`, { agenciaId: aCosta.id, operadorAsignadoId: pares[nombre].oficial.id });
      await env.maquinaria(`propia-cl-${nombre}`, { agenciaId: aCosta.id, operadorAsignadoId: pares[nombre].clon.id });
    }

    const reportante = pares.LIDER.oficial.id;
    const incidente = async (clave: string, maquinariaId: string, tecnicoAsignadoId: string | null) =>
      env.prisma.incidenteTecnico.create({
        data: { maquinariaId, reportadoPorId: reportante, titulo: `${env.marca} ${clave}`, descripcion: 'prueba', estado: tecnicoAsignadoId ? 'EN_PROCESO' : 'ABIERTO', tecnicoAsignadoId },
      });
    const mantenimiento = async (maquinariaId: string, tecnicoId: string) =>
      env.prisma.mantenimientoMaquinaria.create({ data: { maquinariaId, tecnicoId, estado: 'PENDIENTE', fechaProgramada: new Date() } });
    for (const nombre of ['TECNICO', 'COORD_MANTENIMIENTO'] as const) {
      await incidente(`i-of-${nombre}`, mCosta.id, pares[nombre].oficial.id);
      await incidente(`i-cl-${nombre}`, mCosta.id, pares[nombre].clon.id);
      await mantenimiento(mCosta.id, pares[nombre].oficial.id);
      await mantenimiento(mCosta.id, pares[nombre].clon.id);
    }
    await incidente('i-sin', mCosta.id, null);
    // Asignado a un técnico aunque la máquina sea de otra región: lo sigue viendo quien lo tiene asignado.
    for (const lado of ['oficial', 'clon'] as const) {
      await incidente(`i-sierra-${lado}`, mSierra.id, pares.TECNICO[lado].id);
      await mantenimiento(mSierra.id, pares.TECNICO[lado].id);
    }
  });

  afterAll(async () => {
    await env.cerrar();
  });

  for (const nombre of OFICIALES) {
    describe(nombre, () => {
      it('tiene las mismas funciones y el mismo alcance que el rol oficial', () => {
        const { oficialUser, clonUser } = pares[nombre];
        expect([...funcionesDeUsuario(clonUser)].sort()).toEqual([...funcionesDeUsuario(oficialUser)].sort());
        expect(resolverAlcance(clonUser).tipo).toBe(resolverAlcance(oficialUser).tipo);
        expect(clonUser.roleDetails.capacidades).toEqual(oficialUser.roleDetails.capacidades);
      });

      // Cada uno ve lo suyo (su propio usuario cambia), así que se compara cuántos ve y de qué tipo, no los mismos ids.
      it('ve la misma cantidad de máquinas, incidencias y mantenimientos', async () => {
        const { oficial, clon } = pares[nombre];
        const [mo, mc] = [await service.list({ pageSize: 200 } as never, oficial), await service.list({ pageSize: 200 } as never, clon)];
        const [io, ic] = [await service.listIncidentes({ pageSize: 200 } as never, oficial), await service.listIncidentes({ pageSize: 200 } as never, clon)];
        const [no, nc] = [await service.listMantenimientos({ pageSize: 200 } as never, oficial), await service.listMantenimientos({ pageSize: 200 } as never, clon)];
        const propias = (r: any, id: string) => (r.data as any[]).filter((x) => x.operadorAsignadoId === id || x.tecnicoAsignadoId === id || x.tecnicoId === id).length;
        expect((mc.data as any[]).length - propias(mc, clon.id)).toBe((mo.data as any[]).length - propias(mo, oficial.id));
        expect((ic.data as any[]).length - propias(ic, clon.id)).toBe((io.data as any[]).length - propias(io, oficial.id));
        expect((nc.data as any[]).length - propias(nc, clon.id)).toBe((no.data as any[]).length - propias(no, oficial.id));
        expect(propias(ic, clon.id)).toBe(propias(io, oficial.id));
        expect(propias(nc, clon.id)).toBe(propias(no, oficial.id));
        expect(propias(mc, clon.id)).toBe(propias(mo, oficial.id));
      });
    });
  }

  it('el técnico clon solo ve lo que le asignaron (como el oficial)', async () => {
    const { clon } = pares.TECNICO;
    const r: any = await service.listIncidentes({ pageSize: 200 } as never, clon);
    expect(idsDe(r).length).toBeGreaterThan(0);
    for (const x of r.data) expect(x.tecnicoAsignadoId).toBe(clon.id);
  });
});
