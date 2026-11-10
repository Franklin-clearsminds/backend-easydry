import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UbicacionesService } from './ubicaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/** Integración con la base real: ubicación y radio de timbrada de agencias y bodegas. */
describe('UbicacionesService (base real)', () => {
  let env: Entorno;
  let service: UbicacionesService;
  let agencia: { id: string; nombre: string };
  let ajena: { id: string };
  let bodega: { id: string };
  let bodegaAjena: { id: string };
  let admin: any;
  let supervisor: any;
  const punto = { latitud: -0.1807, longitud: -78.4678 };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new UbicacionesService(env.prisma as never);
    const region = await env.region('ubi');
    const otraRegion = await env.region('ubi2');
    agencia = await env.agencia('ubi-a', { regionId: region.id });
    ajena = await env.agencia('ubi-b', { regionId: otraRegion.id });
    bodega = await env.bodega('ubi-b1', { regionId: region.id });
    bodegaAjena = await env.bodega('ubi-b2', { regionId: otraRegion.id });
    admin = await env.actor((await env.usuario('admin', 'ADMIN')).id);
    supervisor = await env.actor((await env.usuario('sup', 'SUPERVISOR', { regionId: region.id })).id);
  });

  afterAll(async () => {
    await env.prisma.ubicacionCambio.deleteMany({ where: { sitioId: { in: [agencia.id, ajena.id, bodega.id, bodegaAjena.id] } } });
    await env.cerrar();
  });

  it('una agencia nueva empieza sin ubicación y con el radio por defecto (100 m)', async () => {
    const lista = await service.listar(admin);
    expect(lista.find((s) => s.id === agencia.id)).toMatchObject({ tipo: 'AGENCIA', latitud: null, longitud: null, radioM: 100 });
    expect(lista.find((s) => s.id === bodega.id)).toMatchObject({ tipo: 'BODEGA', latitud: null, longitud: null, radioM: 100 });
  });

  it('guarda la ubicación de una agencia (el radio ya no se configura)', async () => {
    const r = await service.guardar({ sitioTipo: 'AGENCIA', sitioId: agencia.id, ...punto }, admin);
    expect(r).toMatchObject({ tipo: 'AGENCIA', id: agencia.id, latitud: punto.latitud, longitud: punto.longitud, radioM: 100 });
    expect(await env.prisma.agencia.findUniqueOrThrow({ where: { id: agencia.id }, select: { latitud: true, radioTimbradaM: true } })).toEqual({ latitud: punto.latitud, radioTimbradaM: 100 });
  });

  it('guarda la de una bodega', async () => {
    const r = await service.guardar({ sitioTipo: 'BODEGA', sitioId: bodega.id, ...punto }, admin);
    expect(r).toMatchObject({ tipo: 'BODEGA', radioM: 100 });
  });

  it('cada cambio queda en la bitácora con el valor anterior', async () => {
    await service.guardar({ sitioTipo: 'AGENCIA', sitioId: agencia.id, latitud: -1, longitud: -2 }, admin);
    const cambios = await env.prisma.ubicacionCambio.findMany({ where: { sitioId: agencia.id }, orderBy: { createdAt: 'asc' } });
    expect(cambios).toHaveLength(2);
    expect(cambios[0]).toMatchObject({ sitioTipo: 'AGENCIA', sitioNombre: agencia.nombre, actorId: admin.id, antes: { latitud: null, longitud: null, radioM: 100 }, despues: { latitud: punto.latitud, longitud: punto.longitud, radioM: 100 } });
    expect(cambios[1]).toMatchObject({ antes: { latitud: punto.latitud, longitud: punto.longitud, radioM: 100 }, despues: { latitud: -1, longitud: -2, radioM: 100 } });
  });

  it('un radio enviado se ignora: queda el valor fijo', async () => {
    expect((await service.guardar({ sitioTipo: 'AGENCIA', sitioId: agencia.id, ...punto, radioM: 400 }, admin)).radioM).toBe(100);
  });

  it('quitar la ubicación deja el sitio sin referencia y con el radio por defecto', async () => {
    const r = await service.quitar({ sitioTipo: 'AGENCIA', sitioId: agencia.id }, admin);
    expect(r).toMatchObject({ latitud: null, longitud: null, radioM: 100 });
  });

  it('un sitio que no existe se rechaza', async () => {
    await expect(service.guardar({ sitioTipo: 'AGENCIA', sitioId: '00000000-0000-4000-8000-000000000000', ...punto }, admin)).rejects.toThrow('La agencia no existe.');
    await expect(service.guardar({ sitioTipo: 'BODEGA', sitioId: '00000000-0000-4000-8000-000000000000', ...punto }, admin)).rejects.toThrow('La bodega no existe.');
  });

  it('quien no es nacional solo toca los sitios de su región', async () => {
    await expect(service.guardar({ sitioTipo: 'AGENCIA', sitioId: ajena.id, ...punto }, supervisor)).rejects.toThrow('fuera de tu alcance');
    await expect(service.guardar({ sitioTipo: 'BODEGA', sitioId: bodegaAjena.id, ...punto }, supervisor)).rejects.toThrow('fuera de tu alcance');
    expect((await service.guardar({ sitioTipo: 'BODEGA', sitioId: bodega.id, ...punto }, supervisor)).id).toBe(bodega.id);
    const ids = (await service.listar(supervisor)).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([agencia.id, bodega.id]));
    expect(ids).not.toContain(ajena.id);
    expect(ids).not.toContain(bodegaAjena.id);
  });
});
