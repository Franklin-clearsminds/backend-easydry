import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: cada cambio de agencia de lavadores, líderes, pulidores, auxiliares y backups deja constancia con su
 * fecha y hora, quién lo hizo y por qué; y se ve solo dentro del alcance de quien consulta.
 *
 *  Región R1 ── A1 (Luis LAVADOR, Pia PULIDOR) · A2 (bahía B2)
 *  Región R2 ── A3
 *  Admin · Supervisor R1 · Supervisor R2 · Coordinador de servicios especiales R1
 */
describe('Agencias: historial de cambios de agencia (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let a1: any;
  let a2: any;
  let a3: any;
  let b2: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    const r1 = await env.region('R1');
    const r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    b2 = await env.bahia('B2', a2.id);

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('luis', 'LAVADOR', { agenciaId: a1.id, name: 'Luis' });
    await crear('pia', 'PULIDOR', { agenciaId: a1.id, name: 'Pia' });
    await crear('lalo', 'LAVADOR', { agenciaId: a3.id, name: 'Lalo' });
    await crear('admin', 'ADMIN');
    await crear('supR1', 'SUPERVISOR', { regionId: r1.id });
    await crear('supR2', 'SUPERVISOR', { regionId: r2.id });
    await crear('coordEsp', 'COORD_SERVICIOS_ESPECIALES', { regionId: r1.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const historialDe = (usuarioId: string) =>
    env.prisma.historialCambioAgencia.findMany({ where: { usuarioId }, orderBy: { createdAt: 'asc' } });

  it('exige el motivo para cambiar de agencia', async () => {
    await expect(service.updateUsuario({ id: ids.luis, agenciaId: a2.id } as any, actores.admin)).rejects.toThrow(/motivo/i);
    expect(await historialDe(ids.luis)).toHaveLength(0);
  });

  it('el administrador cambia de agencia a un lavador y queda con fecha y hora, origen, destino, quién y por qué', async () => {
    const antes = Date.now();
    await service.updateUsuario({ id: ids.luis, agenciaId: a2.id, motivo: 'Cubre vacaciones' } as any, actores.admin);
    const [h] = await historialDe(ids.luis);
    expect(h).toMatchObject({
      agenciaOrigenId: a1.id,
      agenciaDestinoId: a2.id,
      agenciaOrigenNombre: a1.nombre,
      agenciaDestinoNombre: a2.nombre,
      motivo: 'Cubre vacaciones',
      origen: 'CAMBIO',
      realizadoPorId: ids.admin,
    });
    expect(h.createdAt.getTime()).toBeGreaterThanOrEqual(antes - 1000); // guarda el instante exacto, no solo el día
  });

  it('asignarlo a una bahía de otra agencia también queda registrado, con el motivo', async () => {
    await service.asignarOperadorABahia({ bahiaId: b2.id, operadorId: ids.lalo, notas: 'Refuerzo en A2' } as any, ids.admin, actores.admin);
    const hist = await historialDe(ids.lalo);
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ agenciaOrigenId: a3.id, agenciaDestinoId: a2.id, origen: 'BAHIA', motivo: 'Refuerzo en A2' });
    const bahia = await env.prisma.historialAsignacionBahia.findFirst({ where: { operadorId: ids.lalo, bahiaId: b2.id } });
    expect(bahia?.motivo).toBe('Refuerzo en A2');
    expect(bahia?.fechaInicio).toBeInstanceOf(Date);
  });

  it('al sacarlo de la bahía queda el motivo de salida', async () => {
    await service.desasignarOperadorDeBahia({ bahiaId: b2.id, operadorId: ids.lalo, motivo: 'Fin del refuerzo' } as any, ids.admin, actores.admin);
    const fila = await env.prisma.historialAsignacionBahia.findFirst({ where: { operadorId: ids.lalo, bahiaId: b2.id } });
    expect(fila?.fechaFin).toBeInstanceOf(Date);
    expect(fila?.motivoFin).toBe('Fin del refuerzo');
  });

  it('un supervisor no puede cambiar de agencia a un pulidor aunque tenga acceso', async () => {
    await expect(service.updateUsuario({ id: ids.pia, agenciaId: a2.id, motivo: 'x' } as any, actores.supR1)).rejects.toThrow(/Admin/);
  });

  it('cada rol ve solo los cambios de su alcance; el coordinador de servicios especiales, solo de pulidores', async () => {
    await service.updateUsuario({ id: ids.pia, agenciaId: a2.id, motivo: 'Traslado' } as any, actores.admin);
    const nombres = async (actor: any) => {
      const r: any = await service.listHistorialCambiosAgencia({ page: 1, pageSize: 100 } as any, actor);
      return [...new Set((r.items ?? r.data ?? []).map((x: any) => x.usuario.name))].sort();
    };
    expect(await nombres(actores.admin)).toEqual(['Lalo', 'Luis', 'Pia']);
    expect(await nombres(actores.supR1)).toEqual(['Lalo', 'Luis', 'Pia']); // Lalo ahora trabaja en A2 (R1)
    expect(await nombres(actores.supR2)).toEqual([]);
    expect(await nombres(actores.coordEsp)).toEqual(['Pia']);
  });
});
