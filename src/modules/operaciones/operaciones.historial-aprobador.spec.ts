import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: el aprobador solo ve el historial de servicios de los últimos 30 días.
 * Una agencia con una bahía y tres servicios: de hace 5 días, de hace 25 y de hace 45. Se compara contra el supervisor de la región,
 * que no tiene ese límite.
 */
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

describe('historial de servicios del aprobador (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let bahiaId: string;
  const placas: Record<string, string> = {};
  const actores: Record<string, any> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);
    const region = await env.region('R-HIST');
    const agencia = await env.agencia('A-HIST', { regionId: region.id });
    const bahia = await env.bahia('B-HIST', agencia.id);
    bahiaId = bahia.id;
    const catalogo = await env.catalogo('C-HIST');
    const operador = await env.usuario('operador-hist', 'LAVADOR', { agenciaId: agencia.id });
    for (const [clave, dias] of [['reciente', 5], ['medio', 25], ['viejo', 45]] as const) {
      const s = await env.servicioLavado({ bahiaId: bahia.id, operadorId: operador.id, catalogoId: catalogo.id, estado: 'FINALIZADO', horaIngreso: hace(dias) } as never);
      placas[clave] = s.placa;
    }
    actores.aprobador = await env.actor((await env.usuario('aprobador-hist', 'APROBADOR', { agenciaId: agencia.id })).id);
    actores.supervisor = await env.actor((await env.usuario('supervisor-hist', 'SUPERVISOR', { regionId: region.id })).id);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const placasDe = async (actor: any, extra: Record<string, unknown> = {}) => {
    const r: any = await service.findAll({ bahiaId, ...extra } as never, actor);
    return (r.items ?? r.data).map((x: any) => x.placa).sort();
  };

  it('sin pedir fechas, el aprobador ve solo los últimos 30 días y el supervisor ve todo', async () => {
    expect(await placasDe(actores.aprobador)).toEqual([placas.reciente, placas.medio].sort());
    expect(await placasDe(actores.supervisor)).toEqual(Object.values(placas).sort());
  });

  it('si el aprobador pide una fecha más antigua, se le sube al límite de 30 días', async () => {
    const desde = hace(90).toISOString().slice(0, 10);
    expect(await placasDe(actores.aprobador, { fechaDesde: desde })).toEqual([placas.reciente, placas.medio].sort());
  });

  it('si pide una fecha dentro de los 30 días, se respeta', async () => {
    const desde = hace(10).toISOString().slice(0, 10);
    expect(await placasDe(actores.aprobador, { fechaDesde: desde })).toEqual([placas.reciente]);
  });
});
