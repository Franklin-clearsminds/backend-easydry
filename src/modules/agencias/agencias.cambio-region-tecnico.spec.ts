import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Un técnico (o coordinador de mantenimiento) con trabajo abierto no se puede mover de región sin reasignarlo
 * antes: si no, ese mantenimiento o incidente queda con un tecnicoId que ya nadie ve (scopeMantenimientos /
 * scopeIncidentes solo protegen la visibilidad del propio técnico, no la del resto del equipo de su región
 * anterior). Ver conversación con el usuario del 2026-09-30.
 */
describe('cambio de región de un técnico con trabajo abierto (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let costa: any;
  let sierra: any;
  let maquina: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    costa = await env.region('COSTA');
    sierra = await env.region('SIERRA');
    maquina = await env.maquinaria('M1');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const regionDe = async (id: string) => (await env.prisma.user.findUniqueOrThrow({ where: { id } })).regionId;
  const mantenimiento = (tecnicoId: string, estado: string) =>
    env.prisma.mantenimientoMaquinaria.create({ data: { maquinariaId: maquina.id, tecnicoId, estado } });
  const incidente = (reportadoPorId: string, tecnicoAsignadoId: string, estado: string) =>
    env.prisma.incidenteTecnico.create({
      data: { maquinariaId: maquina.id, reportadoPorId, tecnicoAsignadoId, estado, titulo: `${env.marca} falla`, descripcion: 'prueba' },
    });

  it('rechaza el cambio si tiene mantenimientos e incidentes sin terminar', async () => {
    const tecnico = await env.usuario('tec-varios', 'TECNICO', { regionId: costa.id });
    await mantenimiento(tecnico.id, 'PENDIENTE');
    await mantenimiento(tecnico.id, 'EN_PROCESO');
    await mantenimiento(tecnico.id, 'PENDIENTE');
    await mantenimiento(tecnico.id, 'FINALIZADO'); // lo terminado no cuenta
    await incidente(tecnico.id, tecnico.id, 'ABIERTO');
    await incidente(tecnico.id, tecnico.id, 'RESUELTO'); // tampoco

    await expect(service.updateUsuario({ id: tecnico.id, regionId: sierra.id } as any)).rejects.toThrow(
      /3 mantenimientos y 1 incidente.*Reasígnalos antes de cambiarlo de región/,
    );
    expect(await regionDe(tecnico.id)).toBe(costa.id);
  });

  it('rechaza el cambio con un solo mantenimiento abierto (singular correcto en el mensaje)', async () => {
    const tecnico = await env.usuario('tec-uno', 'TECNICO', { regionId: costa.id });
    await mantenimiento(tecnico.id, 'EN_PROCESO');
    await expect(service.updateUsuario({ id: tecnico.id, regionId: sierra.id } as any)).rejects.toThrow(/tiene 1 mantenimiento sin terminar/);
    expect(await regionDe(tecnico.id)).toBe(costa.id);
  });

  it('permite el cambio de región cuando no tiene trabajo abierto', async () => {
    const tecnico = await env.usuario('tec-libre', 'TECNICO', { regionId: costa.id });
    await mantenimiento(tecnico.id, 'FINALIZADO');
    await expect(service.updateUsuario({ id: tecnico.id, regionId: sierra.id } as any)).resolves.toBeDefined();
    expect(await regionDe(tecnico.id)).toBe(sierra.id);
  });

  it('no bloquea guardar al técnico si la región no cambia (solo se le edita el nombre)', async () => {
    const tecnico = await env.usuario('tec-nombre', 'TECNICO', { regionId: costa.id });
    for (let i = 0; i < 5; i++) await mantenimiento(tecnico.id, 'PENDIENTE'); // aunque tenga trabajo abierto...
    // ...no importa: no se está tocando la región.
    await expect(service.updateUsuario({ id: tecnico.id, name: 'Nuevo Nombre' } as any)).resolves.toBeDefined();
    const enBase = await env.prisma.user.findUniqueOrThrow({ where: { id: tecnico.id } });
    expect(enBase.name).toBe('Nuevo Nombre');
    expect(enBase.regionId).toBe(costa.id);
  });

  it('un COORD_MANTENIMIENTO con trabajo abierto tampoco puede cambiarse de región', async () => {
    const coord = await env.usuario('coord', 'COORD_MANTENIMIENTO', { regionId: costa.id });
    await incidente(coord.id, coord.id, 'ABIERTO');
    await incidente(coord.id, coord.id, 'EN_PROCESO');
    await expect(service.updateUsuario({ id: coord.id, regionId: sierra.id } as any)).rejects.toThrow(/2 incidentes sin terminar/);
    expect(await regionDe(coord.id)).toBe(costa.id);
  });
});
