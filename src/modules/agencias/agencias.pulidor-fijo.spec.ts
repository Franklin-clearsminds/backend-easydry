import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Cada agencia solo puede tener un pulidor fijo (decisión de producto, 2026-09-29): un Excel o un formulario
 * que intente asignar un segundo pulidor con `agenciaId` a una sede que ya tiene uno debe rechazarse, no
 * aceptarse en silencio.
 */
describe('un pulidor fijo por agencia (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let region: any;
  let conFijo: any; // agencia que ya tiene su pulidor fijo
  let vacia: any; // agencia sin pulidor fijo
  let fijo: any; // el pulidor fijo de `conFijo`

  const datosNuevo = (clave: string, agenciaId: string) => ({
    name: 'CHRISTIAN',
    lastname: 'GRANDA',
    email: `${env.marca}-${clave}@prueba.local`,
    password: 'Pulidor#Fijo9x7',
    rolNombre: 'PULIDOR',
    agenciaId,
  });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    region = await env.region('R1');
    conFijo = await env.agencia('CON', { regionId: region.id });
    vacia = await env.agencia('VACIA', { regionId: region.id });
    fijo = await env.usuario('fijo', 'PULIDOR', { agenciaId: conFijo.id, name: 'MOISES', lastname: 'TUMIPAMBA' });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('createUsuario: rechaza asignar un segundo pulidor fijo a una agencia que ya tiene uno', async () => {
    const d = datosNuevo('segundo', conFijo.id);
    await expect(service.createUsuario(d as any)).rejects.toThrow(/ya tiene un pulidor fijo asignado/);
    expect(await env.prisma.user.count({ where: { email: d.email } })).toBe(0);
  });

  it('createUsuario: permite crear el pulidor fijo cuando la agencia no tiene ninguno', async () => {
    const d = datosNuevo('primero', vacia.id);
    const creado: any = await service.createUsuario(d as any);
    env.rastrear('User', creado.id);
    const enBase = await env.prisma.user.findUniqueOrThrow({ where: { email: d.email }, include: { role: true } });
    expect(enBase.agenciaId).toBe(vacia.id);
    expect(enBase.role.namerol).toBe('PULIDOR');
  });

  it('updateUsuario: rechaza mover un pulidor a una agencia que ya tiene otro fijo distinto', async () => {
    const movil = await env.usuario('movil', 'PULIDOR', { regionId: region.id });
    await expect(service.updateUsuario({ id: movil.id, agenciaId: conFijo.id } as any)).rejects.toThrow(/ya tiene un pulidor fijo asignado/);
    expect((await env.prisma.user.findUniqueOrThrow({ where: { id: movil.id } })).agenciaId).toBeNull();
  });

  it('updateUsuario: no se bloquea a sí mismo al reguardar sin cambiar de agencia', async () => {
    await expect(service.updateUsuario({ id: fijo.id, name: 'Moises Eduardo' } as any)).resolves.toBeDefined();
    const enBase = await env.prisma.user.findUniqueOrThrow({ where: { id: fijo.id } });
    expect(enBase.name).toBe('Moises Eduardo');
    expect(enBase.agenciaId).toBe(conFijo.id);
  });
});
