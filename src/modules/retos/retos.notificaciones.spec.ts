import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetosService } from './retos.service.js';
import { hoyEcuador } from './retos.reglas.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el servicio de notificaciones es el real y escribe en `Notification`.
 * Los avisos de cierre también llegan a los administradores reales de la base; el entorno los borra al cerrar.
 * Solo se comprueba la presencia/ausencia de los usuarios de esta prueba (no se exige una lista exacta, porque la
 * base real tiene sus propios administradores y supervisores).
 */
const DIA = 24 * 60 * 60 * 1000;
const fecha = (dias: number) => new Date(hoyEcuador().getTime() + dias * DIA);

describe('RetosService.cerrar — notificación (base real)', () => {
  let env: Entorno;
  let service: RetosService;
  let costa: any;
  let sierra: any;
  let general: any;
  const ids: Record<string, string> = {};
  let admin: any;
  let n = 0;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new RetosService(env.prisma as never, env.notificaciones());

    costa = await env.region('COSTA');
    sierra = await env.region('SIERRA');
    general = await env.catalogo('GENERAL');

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await crear('admin', 'ADMIN');
    await crear('jefe', 'JEFE_COMERCIAL');
    await crear('coordCosta', 'COORD_COMERCIAL', { regionId: costa.id });
    await crear('supCosta', 'SUPERVISOR', { regionId: costa.id });
    await crear('supSierra', 'SUPERVISOR', { regionId: sierra.id });
    await crear('lavador', 'LAVADOR');
    admin = await env.actor(ids.admin);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const reto = async (regiones: string[], conServicio = false) => {
    // Cada reto compite con su propia agencia: así uno con servicios no le da ganador al que no tiene.
    const ag = await env.agencia(`R${++n}`, { regionId: costa.id });
    if (conServicio) {
      const b = await env.bahia(`R${n}`, ag.id);
      await env.servicioLavado({ bahiaId: b.id, operadorId: ids.lavador, catalogoId: general.id, horaSalida: new Date(fecha(-3).getTime() + 17 * 60 * 60 * 1000) });
    }
    const r = await env.prisma.reto.create({
      data: {
        titulo: `${env.marca} Reto de Octubre ${n}`,
        fechaInicio: fecha(-10),
        fechaFin: fecha(20),
        regiones,
        sucursalesIds: [ag.id],
        tipoServicios: 'GENERALES',
        creadoPorId: ids.admin,
      } as never,
    });
    env.rastrear('Reto', r.id);
    return { ...r, agencia: ag };
  };
  /** Espera los avisos de cierre de un reto (el envío es "fire-and-forget") y devuelve a quién llegaron. */
  const avisos = async (retoId: string) => {
    const filas = await env.esperar(async () => {
      const f = await env.prisma.notification.findMany({ where: { entidadTipo: 'RETO', entidadId: retoId } });
      return f.length ? f : null;
    });
    return { filas, destinatarios: new Set(filas.map((f) => f.userId)) };
  };

  it('reto sin regiones (nacional): avisa a administradores, jefe comercial y a los regionales de todas las regiones', async () => {
    const r = await reto([], true);
    await service.cerrar({ id: r.id } as any, admin);
    const { filas, destinatarios } = await avisos(r.id);
    for (const clave of ['admin', 'jefe', 'coordCosta', 'supCosta', 'supSierra']) expect(destinatarios.has(ids[clave])).toBe(true);
    expect(destinatarios.has(ids.lavador)).toBe(false); // un lavador nunca recibe el aviso
    expect(filas[0].titulo).toBe('Reto cerrado');
    expect(filas[0].mensaje).toContain(`Ganador: ${r.agencia.nombre}`);
  });

  it('reto con "Todas" en regiones: también se trata como nacional', async () => {
    const r = await reto(['Todas']);
    await service.cerrar({ id: r.id } as any, admin);
    const { destinatarios } = await avisos(r.id);
    expect(destinatarios.has(ids.supCosta)).toBe(true);
    expect(destinatarios.has(ids.supSierra)).toBe(true);
  });

  it('reto con regiones específicas: avisa a los regionales de esas regiones y no a los de otras', async () => {
    const r = await reto([costa.nombre]);
    await service.cerrar({ id: r.id } as any, admin);
    const { destinatarios } = await avisos(r.id);
    expect(destinatarios.has(ids.coordCosta)).toBe(true);
    expect(destinatarios.has(ids.supCosta)).toBe(true);
    expect(destinatarios.has(ids.supSierra)).toBe(false); // otra región
    expect(destinatarios.has(ids.admin)).toBe(true); // los globales siempre
    expect(destinatarios.has(ids.jefe)).toBe(true);
  });

  it('sin ganador, el mensaje no menciona ganador', async () => {
    const r = await reto([costa.nombre]); // sin servicios
    await service.cerrar({ id: r.id } as any, admin);
    const { filas } = await avisos(r.id);
    expect(filas[0].mensaje).not.toContain('Ganador');
    expect(filas[0].mensaje).toContain(r.titulo);
  });
});
