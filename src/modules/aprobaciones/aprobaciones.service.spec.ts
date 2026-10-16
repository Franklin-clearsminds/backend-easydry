import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AprobacionesService } from './aprobaciones.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Datos de partida, creados por esta prueba:
 *
 *  Región R1 ── Agencia A1 (CON aprobador): Paula (APROBADOR) · Lía (LIDER)
 *            └─ Agencia A2 (SIN aprobador): Lara (LIDER)
 *  Región R2 ── Agencia A3
 *  Supervisor R1 · Admin · Líder sin agencia
 *
 * Todo se busca con `search: marca` para no mezclar con las solicitudes reales de la base.
 */
describe('AprobacionesService (base real)', () => {
  let env: Entorno;
  let service: AprobacionesService;
  let a1: any;
  let a2: any;
  let a3: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AprobacionesService(env.prisma as never, new DecisionesService(env.prisma as never));

    const r1 = await env.region('R1');
    const r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, { name: clave, ...opts });
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('paula', 'APROBADOR', { agenciaId: a1.id });
    await crear('lia', 'LIDER', { agenciaId: a1.id });
    await crear('lara', 'LIDER', { agenciaId: a2.id });
    await crear('supR1', 'SUPERVISOR', { regionId: r1.id });
    await crear('admin', 'ADMIN');
    await crear('sinSede', 'LIDER');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  /** Crea una solicitud real; `titulo` lleva la marca para poder buscarla. */
  const solicitud = async (titulo: string, solicitanteId: string, agenciaId: string | null, extra: Record<string, unknown> = {}) => {
    const s = await env.prisma.solicitudAprobacion.create({
      data: { tipo: 'AJUSTE_MERMA', titulo: `${env.marca} ${titulo}`, solicitanteId, agenciaId, ...extra },
    });
    env.rastrear('SolicitudAprobacion', s.id);
    return s;
  };
  const titulosDe = (r: any) => r.items.map((i: any) => i.titulo.replace(`${env.marca} `, '')).sort();

  describe('list — alcance', () => {
    let delA1: any;
    let delA2: any;
    let propiaA2: any;

    beforeAll(async () => {
      delA1 = await solicitud('de A1', ids.lia, a1.id);
      delA2 = await solicitud('de A2', ids.lara, a2.id);
      propiaA2 = await solicitud('propia en A2', ids.paula, a2.id);
    });

    it('el aprobador ve las de su agencia y las que hizo él, aunque pida otra agencia', async () => {
      const r: any = await service.list({ agenciaId: a2.id, search: env.marca } as any, actores.paula);
      expect(titulosDe(r)).toEqual(['de A1', 'propia en A2']); // no ve 'de A2', que es de otra agencia y no la hizo él
      expect(r.items.map((i: any) => i.id)).not.toContain(delA2.id);
    });

    it('el supervisor ve su región; un administrador ve todo y puede acotar por agencia', async () => {
      const sup: any = await service.list({ search: env.marca } as any, actores.supR1);
      expect(titulosDe(sup)).toEqual(['de A1', 'de A2', 'propia en A2']);

      const adminTodo: any = await service.list({ search: env.marca } as any, actores.admin);
      expect(titulosDe(adminTodo)).toEqual(['de A1', 'de A2', 'propia en A2']);
      const adminA2: any = await service.list({ agenciaId: a2.id, search: env.marca } as any, actores.admin);
      expect(titulosDe(adminA2)).toEqual(['de A2', 'propia en A2']);
    });

    it('sin agencia asignada solo ve las propias', async () => {
      const propia = await solicitud('del sin sede', ids.sinSede, null);
      const r: any = await service.list({ search: env.marca } as any, actores.sinSede);
      expect(r.items.map((i: any) => i.id)).toEqual([propia.id]);
    });

    it('la búsqueda no pisa el alcance', async () => {
      await solicitud('merma grande de A2', ids.lara, a2.id);
      const r: any = await service.list({ search: `${env.marca} merma` } as any, actores.paula);
      expect(r.items).toEqual([]); // la única que coincide es de A2 y Paula no la ve
    });
  });

  describe('solicitar', () => {
    const dto = (extra: Record<string, unknown> = {}) => ({ tipo: 'AJUSTE_MERMA', titulo: `${env.marca} nueva`, ...extra }) as any;

    it('un usuario de agencia solicita siempre para la suya', async () => {
      const r: any = await service.solicitar(dto({ agenciaId: a3.id }), actores.lia);
      env.rastrear('SolicitudAprobacion', r.data.id);
      const enBase = await env.prisma.solicitudAprobacion.findUniqueOrThrow({ where: { id: r.data.id } });
      expect(enBase).toMatchObject({ agenciaId: a1.id, solicitanteId: ids.lia, estado: 'PENDIENTE' });
    });

    it('el supervisor solo solicita para agencias de su región', async () => {
      await expect(service.solicitar(dto({ agenciaId: a3.id }), actores.supR1)).rejects.toThrow(/tu región/);
      const ok: any = await service.solicitar(dto({ agenciaId: a2.id }), actores.supR1);
      env.rastrear('SolicitudAprobacion', ok.data.id);
      expect(ok.data.agencia.id).toBe(a2.id);
    });

    it('sin agencia asignada no puede solicitar', async () => {
      await expect(service.solicitar(dto(), actores.sinSede)).rejects.toThrow(/agencia asignada/);
      expect(await env.prisma.solicitudAprobacion.count({ where: { solicitanteId: ids.sinSede, titulo: { contains: 'nueva' } } })).toBe(0);
    });
  });

  describe('decidir', () => {
    const auditoria = (solicitudId: string) =>
      env.prisma.auditoriaDecision.findFirst({ where: { entidad: 'SOLICITUD', entidadId: solicitudId } });

    it('el aprobador de la agencia aprueba como titular y queda registrado', async () => {
      const s = await solicitud('para aprobar', ids.lia, a1.id);
      await service.aprobar({ solicitudId: s.id, notas: 'ok' } as any, actores.paula);

      const enBase = await env.prisma.solicitudAprobacion.findUniqueOrThrow({ where: { id: s.id } });
      expect(enBase).toMatchObject({ estado: 'APROBADO', aprobadorId: ids.paula });
      expect(enBase.fechaDecision).not.toBeNull();
      expect(await auditoria(s.id)).toMatchObject({ accion: 'APROBAR', regla: 'TITULAR', usuarioId: ids.paula, agenciaId: a1.id });
    });

    it('nadie decide una solicitud que hizo él mismo', async () => {
      const s = await solicitud('propia de Paula', ids.paula, a1.id);
      await expect(service.aprobar({ solicitudId: s.id } as any, actores.paula)).rejects.toThrow(/que hiciste tú/);
      expect((await env.prisma.solicitudAprobacion.findUniqueOrThrow({ where: { id: s.id } })).estado).toBe('PENDIENTE');
    });

    it('un administrador no decide si la agencia tiene aprobador; sí si no lo tiene (respaldo)', async () => {
      const conAprobador = await solicitud('en A1', ids.lia, a1.id);
      await expect(service.aprobar({ solicitudId: conAprobador.id } as any, actores.admin)).rejects.toThrow(/aprobador designado/);
      expect((await env.prisma.solicitudAprobacion.findUniqueOrThrow({ where: { id: conAprobador.id } })).estado).toBe('PENDIENTE');

      const sinAprobador = await solicitud('en A2', ids.lara, a2.id);
      await service.aprobar({ solicitudId: sinAprobador.id } as any, actores.admin);
      expect((await auditoria(sinAprobador.id))?.regla).toBe('RESPALDO');
      expect((await env.prisma.solicitudAprobacion.findUniqueOrThrow({ where: { id: sinAprobador.id } })).estado).toBe('APROBADO');
    });

    it('una solicitud sin agencia solo la decide un administrador', async () => {
      const a = await solicitud('sin agencia 1', ids.lia, null);
      await expect(service.aprobar({ solicitudId: a.id } as any, actores.paula)).rejects.toThrow(/solo un administrador/);
      const b = await solicitud('sin agencia 2', ids.lia, null);
      await expect(service.aprobar({ solicitudId: b.id } as any, actores.admin)).resolves.toBeDefined();
      expect((await auditoria(b.id))?.regla).toBe('ADMIN');
    });

    it('rechazar exige motivo; una solicitud ya decidida no se decide otra vez', async () => {
      const s = await solicitud('para rechazar', ids.lia, a1.id);
      await expect(service.rechazar({ solicitudId: s.id } as any, actores.paula)).rejects.toThrow(/motivo es obligatorio/);

      const yaAprobada = await solicitud('ya aprobada', ids.lia, a1.id, { estado: 'APROBADO' });
      await expect(
        service.rechazar({ solicitudId: yaAprobada.id, motivoRechazo: 'No procede' } as any, actores.paula),
      ).rejects.toThrow(/ya se encuentra/);

      await service.rechazar({ solicitudId: s.id, motivoRechazo: 'No procede' } as any, actores.paula);
      expect(await env.prisma.solicitudAprobacion.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({
        estado: 'RECHAZADO',
        motivoRechazo: 'No procede',
      });
    });
  });
});
