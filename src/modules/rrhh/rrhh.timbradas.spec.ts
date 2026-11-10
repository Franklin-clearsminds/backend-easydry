import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TimbradasService } from './timbradas.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: timbradas. El almacenamiento es un doble (la prueba no sube nada al bucket) que aplica la misma
 * regla de carpeta que el real: la foto debe estar en `rrhh/timbradas/<usuario>/`.
 * El reloj se simula solo en `Date`, porque la hora de la marca la pone el servidor.
 */
const QUITO = { latitud: -0.1807, longitud: -78.4678 };
const M = 1 / 111_320;
const aMetros = (m: number) => ({ latitud: QUITO.latitud + m * M, longitud: QUITO.longitud });
/** 08:30 y 17:30 en Ecuador (UTC-5). Un día fijo, lejos de cualquier marca real. */
const OCHO_Y_MEDIA = new Date('2031-03-10T13:30:00Z');
const CINCO_Y_MEDIA = new Date('2031-03-10T22:30:00Z');
let fotos = 0;

describe('TimbradasService (base real)', () => {
  let env: Entorno;
  let service: TimbradasService;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  const marcas: Record<string, any> = {};
  let agencia: { id: string; nombre: string };
  let agenciaSinUbicacion: { id: string };
  let otraAgencia: { id: string };
  let bodega: { id: string; nombre: string };
  const storage = {
    inspectEvidence: vi.fn(async (url: string, opts?: { prefix: string }) => {
      if (opts && !url.startsWith(opts.prefix)) throw new BadRequestException('La evidencia no pertenece a la carpeta de esta máquina.');
      return { key: url, kind: 'IMAGEN', mimeType: 'image/jpeg', sizeBytes: 1000 };
    }),
  };

  /** Una foto nueva de cámara de esta persona (clave única). */
  const foto = (clave: string) => `rrhh/timbradas/${ids[clave]}/2031-03/foto-${++fotos}.jpg`;
  const marcar = (clave: string, extra: Record<string, unknown> = {}) =>
    service.registrar({ fotoUrl: foto(clave), origen: 'APP', ...aMetros(20), precisionM: 15, ...extra } as never, actores[clave]);
  const a = (hora: Date) => vi.setSystemTime(hora);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new TimbradasService(env.prisma as never, storage as never, env.notificaciones());

    const region = await env.region('RRHH');
    agencia = await env.agencia('rrhh-a', { regionId: region.id });
    agenciaSinUbicacion = await env.agencia('rrhh-sin', { regionId: region.id });
    otraAgencia = await env.agencia('rrhh-otra');
    bodega = await env.bodega('rrhh-b', { regionId: region.id });
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { ...QUITO, radioTimbradaM: 100 } });
    await env.prisma.bodega.update({ where: { id: bodega.id }, data: { latitud: QUITO.latitud - 0.1, longitud: QUITO.longitud, radioTimbradaM: 80 } });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await crear('lavador', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await crear('lavador2', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await crear('lavadorSinUb', 'LAVADOR', { agenciaId: agenciaSinUbicacion.id, regionId: region.id });
    await crear('lavadorOtra', 'LAVADOR', { agenciaId: otraAgencia.id });
    await crear('asistente', 'ASISTENTE_BODEGA', { bodegaId: bodega.id, regionId: region.id });
    await crear('tecnico', 'TECNICO', { regionId: region.id });
    await crear('lider', 'LIDER', { agenciaId: agencia.id, regionId: region.id });
    await crear('supervisor', 'SUPERVISOR', { regionId: region.id });
    await crear('admin', 'ADMIN');
    await crear('superAdmin', 'SUPER_ADMIN');
    for (const clave of Object.keys(ids)) actores[clave] = await env.actor(ids[clave]);
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterAll(async () => {
    vi.useRealTimers();
    await env.prisma.timbrada.deleteMany({ where: { userId: { in: Object.values(ids) } } });
    await env.cerrar();
  });

  afterEach(() => a(OCHO_Y_MEDIA));

  it('la entrada de las 08:30 dentro del radio queda verificada con su distancia', async () => {
    a(OCHO_Y_MEDIA);
    const r = await marcar('lavador');
    marcas.entrada = r;
    expect(r).toMatchObject({ tipo: 'ENTRADA', verificacion: 'VERIFICADA', radioM: 100, sitio: { tipo: 'AGENCIA', nombre: agencia.nombre } });
    expect(r.distanciaM).toBeGreaterThan(19);
    expect(r.distanciaM).toBeLessThan(21);
    const fila = await env.prisma.timbrada.findUniqueOrThrow({ where: { id: r.id } });
    expect(fila).toMatchObject({ userId: ids.lavador, origen: 'APP', agenciaId: agencia.id, bodegaId: null, precisionM: 15 });
    expect(fila.fechaDia.toISOString().slice(0, 10)).toBe('2031-03-10');
    expect(fila.marcadaEn.toISOString()).toBe(OCHO_Y_MEDIA.toISOString());
  });

  it('repetir la entrada del mismo día se rechaza', async () => {
    a(OCHO_Y_MEDIA);
    await expect(marcar('lavador')).rejects.toThrow('Ya registraste tu entrada de hoy.');
  });

  it('desde las 12:00 es Salida, y una sola por día', async () => {
    a(CINCO_Y_MEDIA);
    const r = await marcar('lavador');
    expect(r.tipo).toBe('SALIDA');
    await expect(marcar('lavador')).rejects.toThrow('Ya registraste tu salida de hoy.');
    const dia = await env.prisma.timbrada.findMany({ where: { userId: ids.lavador }, orderBy: { marcadaEn: 'asc' } });
    expect(dia.map((t) => t.tipo)).toEqual(['ENTRADA', 'SALIDA']);
  });

  it('al pasar la medianoche de Ecuador empieza un día nuevo', async () => {
    a(new Date('2031-03-11T13:30:00Z'));
    const r = await marcar('lavador');
    expect(r.tipo).toBe('ENTRADA');
    const fila = await env.prisma.timbrada.findUniqueOrThrow({ where: { id: r.id } });
    expect(fila.fechaDia.toISOString().slice(0, 10)).toBe('2031-03-11');
  });

  it('lejos del radio se rechaza con la distancia y no queda registrada', async () => {
    a(OCHO_Y_MEDIA);
    await expect(marcar('lavador2', aMetros(300))).rejects.toMatchObject({ response: { codigo: 'LEJOS', message: expect.stringMatching(/Estás a 300 m de .* 100 m o menos/) } });
    expect(await env.prisma.timbrada.count({ where: { userId: ids.lavador2 } })).toBe(0);
  });

  it('una lectura de GPS demasiado vaga se rechaza aunque esté cerca', async () => {
    await expect(marcar('lavador2', { precisionM: 250 })).rejects.toMatchObject({ response: { codigo: 'PRECISION' } });
    await expect(marcar('lavador2', { precisionM: undefined })).rejects.toMatchObject({ response: { codigo: 'PRECISION' } });
    expect(await env.prisma.timbrada.count({ where: { userId: ids.lavador2 } })).toBe(0);
  });

  it('sin ubicación se rechaza para quien debe validarla', async () => {
    await expect(marcar('lavador2', { latitud: undefined, longitud: undefined })).rejects.toMatchObject({ response: { codigo: 'FALTA_UBICACION' } });
  });

  it('la misma foto no sirve para dos marcas', async () => {
    const compartida = foto('lavador2');
    await service.registrar({ fotoUrl: compartida, origen: 'WEB', ...aMetros(10), precisionM: 20 } as never, actores.lavador2);
    a(CINCO_Y_MEDIA);
    await expect(service.registrar({ fotoUrl: compartida, origen: 'WEB', ...aMetros(10), precisionM: 20 } as never, actores.lavador2)).rejects.toThrow(/ya se usó/);
  });

  it('la foto debe ser de la carpeta de quien timbra', async () => {
    a(OCHO_Y_MEDIA);
    await expect(
      service.registrar({ fotoUrl: `rrhh/timbradas/${ids.lavador}/2031-03/ajena.jpg`, origen: 'APP', ...aMetros(10), precisionM: 10 } as never, actores.lavadorSinUb),
    ).rejects.toThrow();
  });

  it('una evidencia que no es imagen no sirve como foto', async () => {
    storage.inspectEvidence.mockResolvedValueOnce({ key: 'x', kind: 'VIDEO', mimeType: 'video/mp4', sizeBytes: 10 } as never);
    await expect(service.registrar({ fotoUrl: `rrhh/timbradas/${ids.lavadorSinUb}/x.mp4`, origen: 'APP' } as never, actores.lavadorSinUb)).rejects.toThrow('debe ser una foto');
  });

  it('con la agencia sin ubicación se acepta solo con foto, queda sin referencia y se avisa a los administradores', async () => {
    a(OCHO_Y_MEDIA);
    const r = await service.registrar({ fotoUrl: foto('lavadorSinUb'), origen: 'APP' } as never, actores.lavadorSinUb);
    expect(r.verificacion).toBe('SIN_REFERENCIA');
    expect(r.mensaje).toMatch(/solo con foto/);
    const aviso = await env.esperar(() => env.prisma.notification.findFirst({ where: { tipo: 'UBICACION_FALTANTE', entidadId: agenciaSinUbicacion.id } }));
    expect(aviso.titulo).toBe('Falta la ubicación de un sitio');
  });

  it('el personal de bodega se valida contra la ubicación y el radio de su bodega', async () => {
    a(OCHO_Y_MEDIA);
    const enBodega = { latitud: QUITO.latitud - 0.1, longitud: QUITO.longitud };
    const r = await marcar('asistente', { ...enBodega, precisionM: 10 });
    expect(r).toMatchObject({ verificacion: 'VERIFICADA', radioM: 100, sitio: { tipo: 'BODEGA', nombre: bodega.nombre } });
    const fila = await env.prisma.timbrada.findUniqueOrThrow({ where: { id: r.id } });
    expect(fila).toMatchObject({ bodegaId: bodega.id, agenciaId: null });
    // en la agencia, que no es su sitio, no vale
    a(CINCO_Y_MEDIA);
    await expect(marcar('asistente', { ...QUITO, precisionM: 10 })).rejects.toMatchObject({ response: { codigo: 'LEJOS' } });
  });

  it('los demás roles timbran dentro del radio de cualquier agencia con ubicación, aunque no sea la suya', async () => {
    a(OCHO_Y_MEDIA);
    const r = await service.registrar({ fotoUrl: foto('tecnico'), origen: 'WEB', ...aMetros(150), precisionM: 20 } as never, actores.tecnico);
    expect(r).toMatchObject({ verificacion: 'VERIFICADA', radioM: 200, sitio: { tipo: 'AGENCIA' } });
    const fila = await env.prisma.timbrada.findUniqueOrThrow({ where: { id: r.id } });
    expect(fila.agenciaId).not.toBeNull();
    expect(fila.bodegaId).toBeNull();
    // lejos de toda agencia, sin ubicación o con GPS vago, no vale
    a(CINCO_Y_MEDIA);
    await expect(service.registrar({ fotoUrl: foto('tecnico'), origen: 'WEB', latitud: 10, longitud: 20, precisionM: 20 } as never, actores.tecnico)).rejects.toMatchObject({ response: { codigo: 'LEJOS' } });
    await expect(service.registrar({ fotoUrl: foto('tecnico'), origen: 'WEB' } as never, actores.tecnico)).rejects.toMatchObject({ response: { codigo: 'FALTA_UBICACION' } });
    await expect(marcar('supervisor', { precisionM: 5000 })).rejects.toMatchObject({ response: { codigo: 'PRECISION' } });
  });

  it('el líder, el backup y el auxiliar se validan en su agencia, no en otra', async () => {
    a(OCHO_Y_MEDIA);
    const enOtraAgencia = { latitud: QUITO.latitud + 0.5, longitud: QUITO.longitud };
    await env.prisma.agencia.update({ where: { id: otraAgencia.id }, data: { ...enOtraAgencia } });
    try {
      await expect(marcar('lider', { ...enOtraAgencia, precisionM: 10 })).rejects.toMatchObject({ response: { codigo: 'LEJOS' } });
      // el supervisor, en cambio, vale en cualquier agencia
      expect(await marcar('supervisor', { ...enOtraAgencia, precisionM: 10 })).toMatchObject({ verificacion: 'VERIFICADA' });
    } finally {
      await env.prisma.agencia.update({ where: { id: otraAgencia.id }, data: { latitud: null, longitud: null } });
    }
  });

  it('ADMIN y SUPER_ADMIN no timbran', async () => {
    await expect(marcar('admin')).rejects.toThrow('Los administradores no timbran.');
    await expect(marcar('superAdmin')).rejects.toThrow('Los administradores no timbran.');
    await expect(service.estado(actores.admin)).rejects.toThrow('Los administradores no timbran.');
  });

  it('estado: la hora del servidor, lo marcado hoy y si hay que mandar ubicación', async () => {
    a(CINCO_Y_MEDIA);
    const conUbicacion = await service.estado(actores.lavador);
    expect(conUbicacion).toMatchObject({ dia: '2031-03-10', tipoActual: 'SALIDA', exigeUbicacion: true, precisionMaxM: 120 });
    expect(conUbicacion.marcasHoy.map((m) => m.tipo)).toEqual(['ENTRADA', 'SALIDA']);
    expect(conUbicacion.sitios).toEqual([{ tipo: 'AGENCIA', nombre: agencia.nombre, radioM: 100, tieneUbicacion: true }]);
    expect(conUbicacion.modo).toBe('AGENCIA_ASIGNADA');
    expect(await service.estado(actores.asistente)).toMatchObject({ modo: 'BODEGA', exigeUbicacion: true });
    expect(await service.estado(actores.tecnico, 'WEB')).toMatchObject({ modo: 'CUALQUIER_AGENCIA', exigeUbicacion: true, radioM: 200, sitios: [] });
    expect((await service.estado(actores.lavadorSinUb)).exigeUbicacion).toBe(false);
  });

  it('mias devuelve solo mis marcas', async () => {
    const r = await service.mias({ desde: '2031-03-01', hasta: '2031-03-31' }, actores.lavador);
    expect(r.filas.length).toBe(3);
    expect(new Set(r.filas.map((f) => f.userId))).toEqual(new Set([ids.lavador]));
    expect(r.filas.every((f) => f.sitio?.nombre === agencia.nombre)).toBe(true);
  });

  it('un rango de más de 93 días o invertido se rechaza', async () => {
    await expect(service.mias({ desde: '2031-01-01', hasta: '2031-06-30' }, actores.lavador)).rejects.toThrow(/93 días/);
    await expect(service.mias({ desde: '2031-03-10', hasta: '2031-03-01' }, actores.lavador)).rejects.toThrow(/inicial/);
  });

  it('equipo: el líder ve solo su agencia; el supervisor, su región; el administrador, todo', async () => {
    const rango = { desde: '2031-03-01', hasta: '2031-03-31' };
    const lider = await service.equipo(rango, actores.lider);
    const idsLider = new Set(lider.filas.map((f) => f.userId));
    expect(idsLider.has(ids.lavador)).toBe(true);
    expect(idsLider.has(ids.lavadorSinUb)).toBe(false); // otra agencia de la misma región
    expect(idsLider.has(ids.lavadorOtra)).toBe(false);

    const sup = await service.equipo(rango, actores.supervisor);
    const idsSup = new Set(sup.filas.map((f) => f.userId));
    expect(idsSup.has(ids.lavador)).toBe(true);
    expect(idsSup.has(ids.lavadorSinUb)).toBe(true);
    expect(idsSup.has(ids.asistente)).toBe(true); // por la región de su bodega
    expect(idsSup.has(ids.tecnico)).toBe(true);

    await marcar('lavadorOtra', { ...QUITO }).catch(() => undefined); // otra agencia sin ubicación: solo foto
    const admin = await service.equipo(rango, actores.admin);
    expect(admin.personas.length).toBeGreaterThan(sup.personas.length);
    const soloUno = await service.equipo({ ...rango, userId: ids.lavador }, actores.admin);
    expect(new Set(soloUno.filas.map((f) => f.userId))).toEqual(new Set([ids.lavador]));
  });

  it('nadie puede editar ni borrar una timbrada desde el servicio', () => {
    const publicos = Object.getOwnPropertyNames(TimbradasService.prototype).filter((n) => n !== 'constructor');
    expect(publicos.filter((n) => /editar|actualizar|borrar|eliminar|update|delete/i.test(n))).toEqual([]);
  });
});
