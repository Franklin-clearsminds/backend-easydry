import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OperacionesService } from './operaciones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: «Registrar OT» y «Agregar servicios a una OT» son dos botones con dos permisos. El servidor mira si
 * la OT ya existe para saber cuál de los dos se está usando, así que con uno solo no se puede hacer lo del otro.
 */
describe('Servicios: registrar una OT y agregar a una existente son permisos distintos (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let bahia: any, lavador: any, s1: any, s2: any;
  const ot = (sufijo: string) => `${env.marca}-OT-${sufijo}`.toUpperCase();
  const dto = (servicioCatalogoId: number, ordenTrabajoOT: string) =>
    ({ placa: 'ABC-1234', modelo: 'Corolla', servicioCatalogoId, bahiaId: bahia.id, ordenTrabajoOT, fotoIngresoUrl: 'https://x/ingreso.mp4' }) as any;
  /** Quien llama, con exactamente estos permisos y alcance nacional (para que el alcance de agencia no estorbe). */
  const con = (...capacidades: string[]) => ({ id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades, ambito: 'GLOBAL' } });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);
    const region = await env.region('R1');
    const a1 = await env.agencia('A1', { regionId: region.id });
    bahia = await env.bahia('B1', a1.id);
    s1 = await env.catalogo('S1', { precio: 10 });
    s2 = await env.catalogo('S2', { precio: 20 });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [s1.id, s2.id] } });
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: a1.id });
    await env.prisma.bahiaOperador.create({ data: { bahiaId: bahia.id, operadorId: lavador.id } });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('sin «Registrar OT» no se puede abrir una OT nueva, aunque tenga «Agregar servicios»', async () => {
    await expect(service.create(dto(s1.id, ot('nueva-sin')), lavador.id, con('servicios.generales.agregar'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('nueva-sin') } })).toBe(0);
  });

  it('con «Registrar OT» abre una OT nueva', async () => {
    const creado: any = await service.create(dto(s1.id, ot('nueva-con')), lavador.id, con('servicios.generales.crear'));

    expect(creado.id).toBeTruthy();
  });

  it('con solo «Registrar OT» no puede agregar un servicio a una OT que ya existe', async () => {
    await service.create(dto(s1.id, ot('existe-1')), lavador.id, con('servicios.generales.crear'));

    await expect(service.create(dto(s2.id, ot('existe-1')), lavador.id, con('servicios.generales.crear'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('existe-1') } })).toBe(1);
  });

  it('con «Agregar servicios» sí puede ampliar una OT que ya existe', async () => {
    await service.create(dto(s1.id, ot('existe-2')), lavador.id, con('servicios.generales.crear'));

    const segundo: any = await service.create(dto(s2.id, ot('existe-2')), lavador.id, con('servicios.generales.agregar'));

    expect(segundo.id).toBeTruthy();
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('existe-2') } })).toBe(2);
  });

  it('el número de OT se compara sin distinguir mayúsculas', async () => {
    await service.create(dto(s1.id, ot('mayus')), lavador.id, con('servicios.generales.crear'));

    await expect(service.create(dto(s2.id, ot('mayus').toLowerCase()), lavador.id, con('servicios.generales.crear'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una OT anulada ya no cuenta como existente: registrar de nuevo con ese número solo exige «Registrar OT»', async () => {
    const creado: any = await service.create(dto(s1.id, ot('anulada')), lavador.id, con('servicios.generales.crear'));
    await env.prisma.servicioLavado.update({ where: { id: creado.id }, data: { estado: 'CANCELADO' } });

    await expect(service.create(dto(s1.id, ot('anulada')), lavador.id, con('servicios.generales.crear'))).resolves.toBeDefined();
  });
});
