import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * El auxiliar del líder es un lavador de una bahía con las capacidades del líder: agencia y bahía obligatorias y uno solo por agencia.
 */
describe('auxiliar del líder (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let region: any;
  let agencia: any;
  let otra: any;
  let bahia1: any;
  let bahia2: any;
  let bahiaAjena: any;
  let admin: any;

  const datos = (clave: string, extra: Record<string, unknown> = {}) => ({
    name: 'ROSA',
    lastname: 'AUXILIAR',
    email: `${env.marca}-${clave}@prueba.local`,
    password: 'Auxiliar#Bahia9x7',
    rolNombre: 'AUXILIAR',
    agenciaId: agencia.id,
    bahiaId: bahia1.id,
    ...extra,
  });
  const actor = () => ({ id: admin.id, role: { namerol: 'SUPER_ADMIN', ambito: 'GLOBAL' }, roleDetails: { namerol: 'SUPER_ADMIN' } });
  const bahiaActiva = async (userId: string) =>
    (await env.prisma.bahiaOperador.findFirst({ where: { operadorId: userId, activo: true } }))?.bahiaId ?? null;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    region = await env.region('RA');
    agencia = await env.agencia('AUX', { regionId: region.id });
    otra = await env.agencia('AUX2', { regionId: region.id });
    bahia1 = await env.bahia('A1', agencia.id);
    bahia2 = await env.bahia('A2', agencia.id);
    bahiaAjena = await env.bahia('B1', otra.id);
    admin = await env.usuario('aux-admin', 'SUPER_ADMIN');
  });

  afterAll(async () => {
    await env.prisma.historialAsignacionBahia.deleteMany({ where: { bahiaId: { in: [bahia1.id, bahia2.id, bahiaAjena.id] } } });
    await env.cerrar();
  });

  it('exige agencia y bahía, y que la bahía sea de esa agencia', async () => {
    await expect(service.createUsuario(datos('sin-bahia', { bahiaId: undefined }) as any, actor())).rejects.toThrow(/bahía asignada/);
    await expect(service.createUsuario(datos('sin-agencia', { agenciaId: undefined }) as any, actor())).rejects.toThrow(/agencia asignada/);
    await expect(service.createUsuario(datos('ajena', { bahiaId: bahiaAjena.id }) as any, actor())).rejects.toThrow(/no pertenece a la agencia/);
    expect(await env.prisma.user.count({ where: { email: { startsWith: env.marca }, role: { namerol: 'AUXILIAR' } } })).toBe(0);
  });

  it('al crearlo queda asignado como operador de su bahía', async () => {
    const creado: any = await service.createUsuario(datos('primero') as any, actor());
    env.rastrear('User', creado.user.id);
    expect(await bahiaActiva(creado.user.id)).toBe(bahia1.id);
    const enBase = await env.prisma.user.findUniqueOrThrow({ where: { id: creado.user.id }, include: { role: true } });
    expect(enBase.role.namerol).toBe('AUXILIAR');
    expect(enBase.agenciaId).toBe(agencia.id);
  });

  it('una agencia solo puede tener un auxiliar: el segundo se bloquea y nombra al que ya existe', async () => {
    const d = datos('segundo', { bahiaId: bahia2.id });
    await expect(service.createUsuario(d as any, actor())).rejects.toThrow(/ya tiene un auxiliar \(ROSA AUXILIAR\)/);
    expect(await env.prisma.user.count({ where: { email: d.email } })).toBe(0);
  });

  it('un lavador pasa a auxiliar con su bahía, y cambiarlo de bahía reasigna sin duplicar', async () => {
    const lav = await env.usuario('lav-aux', 'LAVADOR', { agenciaId: otra.id });
    const rol = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'AUXILIAR' } });
    // Otra agencia: no tiene auxiliar y su bahía es la ajena.
    await expect(service.updateUsuario({ id: lav.id, roleId: rol.id } as any, actor())).rejects.toThrow(/bahía asignada/);
    await service.updateUsuario({ id: lav.id, roleId: rol.id, bahiaId: bahiaAjena.id } as any, actor());
    expect(await bahiaActiva(lav.id)).toBe(bahiaAjena.id);
    await service.updateUsuario({ id: lav.id, name: 'Rosa Maria' } as any, actor());
    expect(await bahiaActiva(lav.id)).toBe(bahiaAjena.id);
    expect(await env.prisma.bahiaOperador.count({ where: { operadorId: lav.id, activo: true } })).toBe(1);
  });

  it('el teléfono es opcional al crear un usuario, incluso un auxiliar o un líder', async () => {
    const lider: any = await service.createUsuario({ ...datos('sin-telefono-lider'), rolNombre: 'LIDER', bahiaId: undefined } as any, actor());
    env.rastrear('User', lider.user.id);
    expect((await env.prisma.user.findUniqueOrThrow({ where: { id: lider.user.id } })).telefono).toBeNull();
    await expect(service.createUsuario({ ...datos('tel-malo'), rolNombre: 'LIDER', bahiaId: undefined, telefono: '123' } as any, actor())).rejects.toThrow(/celular/i);
  });

  it('el auxiliar tiene las mismas capacidades que el líder', async () => {
    const [aux, lider] = await Promise.all([
      env.prisma.role.findUniqueOrThrow({ where: { namerol: 'AUXILIAR' } }),
      env.prisma.role.findUniqueOrThrow({ where: { namerol: 'LIDER' } }),
    ]);
    expect([...aux.capacidades].sort()).toEqual([...lider.capacidades].sort());
    expect(aux.ambito).toBe('AGENCIA');
  });
});
