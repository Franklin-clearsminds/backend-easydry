import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el servidor es la fuente de verdad de la OT duplicada y de la bahía
 * ocupada (la web ya no lo adivina con las últimas filas cargadas).
 *
 * Mundo: Agencia A1 con la bahía B1, un lavador vinculado y dos servicios de catálogo (S1, S2) habilitados en A1.
 */
describe('OT duplicada y bahía ocupada — validación en el servidor (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let a1: any, bahia: any, lavador: any, s1: any, s2: any, coordEspeciales: any;
  const ot = (sufijo: string) => `${env.marca}-OT-${sufijo}`.toUpperCase();
  const dto = (servicioCatalogoId: number, extra: Record<string, unknown>) =>
    ({ placa: 'ABC-1234', modelo: 'Corolla', servicioCatalogoId, bahiaId: bahia.id, ...extra }) as any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);
    const region = await env.region('R1');
    a1 = await env.agencia('A1', { regionId: region.id });
    bahia = await env.bahia('B1', a1.id);
    s1 = await env.catalogo('S1', { precio: 10 });
    s2 = await env.catalogo('S2', { precio: 20 });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [s1.id, s2.id] } });
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: a1.id });
    await env.prisma.bahiaOperador.create({ data: { bahiaId: bahia.id, operadorId: lavador.id } });
    coordEspeciales = await env.actor((await env.usuario('coord', 'COORD_SERVICIOS_ESPECIALES')).id);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('una OT puede ampliarse con otro servicio del MISMO vehículo', async () => {
    await service.create(dto(s1.id, { ordenTrabajoOT: ot('mismo') }), lavador.id);
    const segundo: any = await service.create(dto(s2.id, { ordenTrabajoOT: ot('mismo'), placa: 'abc 1234' }), lavador.id); // misma placa, otro formato
    expect(segundo.id).toBeTruthy();
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('mismo') } })).toBe(2);
  });

  it('rechaza una OT que pertenece a otro vehículo', async () => {
    await service.create(dto(s1.id, { ordenTrabajoOT: ot('ajena') }), lavador.id);
    await expect(service.create(dto(s2.id, { ordenTrabajoOT: ot('ajena'), placa: 'ZZZ-9999' }), lavador.id)).rejects.toThrow(/pertenece al vehículo ABC-1234/);
    expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('ajena') } })).toBe(1);
  });

  it('rechaza repetir el mismo servicio dentro de la OT', async () => {
    await service.create(dto(s1.id, { ordenTrabajoOT: ot('repetida') }), lavador.id);
    await expect(service.create(dto(s1.id, { ordenTrabajoOT: ot('repetida') }), lavador.id)).rejects.toThrow(/ya está registrado en la OT/);
  });

  it('compara la OT sin distinguir mayúsculas y también encuentra una OT antigua entre muchas', async () => {
    await service.create(dto(s1.id, { ordenTrabajoOT: ot('antigua') }), lavador.id);
    // 101 servicios más recientes de otras OT: la validación sigue viendo la antigua (la web solo veía 100).
    for (let i = 0; i < 101; i++) {
      await env.servicioLavado({ bahiaId: bahia.id, operadorId: lavador.id, catalogoId: s2.id, ordenTrabajoOT: ot(`relleno-${i}`), horaIngreso: new Date(Date.now() + (i + 1) * 1000) });
    }
    await expect(service.create(dto(s1.id, { ordenTrabajoOT: ot('antigua').toLowerCase() }), lavador.id)).rejects.toThrow(/ya está registrado en la OT/);
  });

  it('la OT de un servicio especial es independiente de la de lavado, pero no se repite entre especiales', async () => {
    const especiales = new ServiciosEspecialesService(env.prisma as never);
    const numero = ot('especial');
    await service.create(dto(s1.id, { ordenTrabajoOT: numero }), lavador.id); // ya existe como lavado
    const datos = { ordenTrabajoOT: numero, placa: 'ESP-0001', tipoServicio: 'Pulido', agenciaId: a1.id } as any;
    const creado: any = await especiales.create(datos, coordEspeciales.id, coordEspeciales).catch((e: Error) => e);
    // Si faltan campos propios del especial el error NO debe ser el de OT duplicada con el lavado.
    if (creado instanceof Error) expect(creado.message).not.toMatch(/ya se encuentra registrada/);
    else {
      env.rastrear('ServicioEspecial', creado.id);
      await expect(especiales.create({ ...datos, placa: 'ESP-0002' }, coordEspeciales.id, coordEspeciales)).rejects.toThrow(/ya se encuentra registrada en el sistema/);
    }
  });

  it('una bahía con otro vehículo en proceso avisa pero no bloquea, y queda anotado en las observaciones', async () => {
    const otra = await env.bahia('B2', a1.id);
    await env.prisma.bahiaOperador.create({ data: { bahiaId: otra.id, operadorId: lavador.id } });
    await env.servicioLavado({ bahiaId: otra.id, operadorId: lavador.id, catalogoId: s1.id, estado: 'EN_PROCESO', placa: 'OCU-0001', horaSalida: null });

    const creado: any = await service.create(
      dto(s2.id, { ordenTrabajoOT: ot('bahia'), placa: 'NUE-0001', bahiaId: otra.id, estado: 'EN_PROCESO' }),
      lavador.id,
    );

    const fila = await env.prisma.servicioLavado.findUniqueOrThrow({ where: { id: creado.id } });
    expect(fila.observaciones).toMatch(/ALERTA: la bahía .* ya tenía en proceso al vehículo OCU-0001/);
    // Y el listado de bahías informa de la ocupación antes de crear.
    expect(await env.prisma.servicioLavado.count({ where: { bahiaId: otra.id, estado: 'EN_PROCESO' } })).toBe(2);
  });

  it('si la agencia no permite varias OT por bahía, una bahía ocupada rechaza la OT nueva (pero no al ampliar la misma OT ni en la sincronización)', async () => {
    const lider = await env.actor((await env.usuario('lider-bahia', 'LIDER', { agenciaId: a1.id })).id);
    const exclusiva = await env.bahia('B3', a1.id);
    await env.prisma.bahiaOperador.create({ data: { bahiaId: exclusiva.id, operadorId: lavador.id } });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { permiteVariasOtPorBahia: false } });
    try {
      const enBahia = { bahiaId: exclusiva.id, estado: 'EN_PROCESO', fotoIngresoUrl: 'https://bucket.test/servicios/generales/exclusiva/ingreso.mp4' }; // un actor siempre aporta la evidencia de ingreso
      await service.create(dto(s1.id, { ...enBahia, ordenTrabajoOT: ot('exclusiva'), placa: 'EXC-0001' }), lavador.id, lider);

      // Otra OT, otro vehículo, misma bahía: se rechaza y no se crea nada.
      const otra = dto(s2.id, { ...enBahia, ordenTrabajoOT: ot('exclusiva-2'), placa: 'EXC-0002' });
      await expect(service.create(otra, lavador.id, lider)).rejects.toThrow(/no permite más de una OT por bahía/);
      expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('exclusiva-2') } })).toBe(0);

      // Ampliar la MISMA OT del mismo vehículo con otro servicio no es conflicto.
      const ampliada: any = await service.create(dto(s2.id, { ...enBahia, ordenTrabajoOT: ot('exclusiva'), placa: 'EXC-0001' }), lavador.id, lider);
      expect(ampliada.id).toBeTruthy();

      // La sincronización de la app (sin actor) nunca se rechaza aquí: sus datos ya existen en el teléfono.
      const sincronizada: any = await service.create(otra, lavador.id);
      expect(sincronizada.id).toBeTruthy();

      // Con la opción activada vuelve a ser solo informativo.
      await env.prisma.agencia.update({ where: { id: a1.id }, data: { permiteVariasOtPorBahia: true } });
      const permitida: any = await service.create(dto(s1.id, { ...enBahia, ordenTrabajoOT: ot('exclusiva-3'), placa: 'EXC-0003' }), lavador.id, lider);
      expect(permitida.id).toBeTruthy();
    } finally {
      await env.prisma.agencia.update({ where: { id: a1.id }, data: { permiteVariasOtPorBahia: true } });
    }
  });
});
