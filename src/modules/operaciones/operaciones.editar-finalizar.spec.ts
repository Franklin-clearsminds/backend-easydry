import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OperacionesService } from './operaciones.service.js';
import { ServiciosEspecialesService } from './servicios-especiales.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: en Servicios cada cambio de una OT tiene su casilla.
 *  - «Editar OT» corrige vehículo y cliente (en todos los servicios de la OT); «Finalizar OT» cambia el estado y sube la evidencia;
 *  - quien tiene «Registrar OT» también puede finalizar;
 *  - las observaciones las cambia cualquiera de las tres;
 *  - «Editar OT especial» corrige un servicio especial mientras no esté completado ni cancelado.
 */
describe('Servicios: editar y finalizar una OT son permisos distintos (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let especiales: ServiciosEspecialesService;
  let bahia: any, lavador: any, s1: any, s2: any;
  const ot = (sufijo: string) => `${env.marca}-OT-${sufijo}`.toUpperCase();
  const dto = (servicioCatalogoId: number, ordenTrabajoOT: string) =>
    ({ placa: 'ABC-1234', modelo: 'Corolla', marca: 'Toyota', color: 'Rojo', cliente: 'Cliente Uno', servicioCatalogoId, bahiaId: bahia.id, ordenTrabajoOT, fotoIngresoUrl: 'https://x/ingreso.mp4' }) as any;
  /** Quien llama, con exactamente estos permisos y alcance nacional. */
  const con = (...capacidades: string[]) => ({ id: 'u', role: { namerol: 'ROL_DE_PRUEBA', capacidades, ambito: 'GLOBAL' } });
  const fila = (id: string) => env.prisma.servicioLavado.findUniqueOrThrow({ where: { id } });
  const nuevaOT = async (sufijo: string, dosServicios = false) => {
    const a: any = await service.create(dto(s1.id, ot(sufijo)), lavador.id, con('servicios.generales.crear'));
    const b: any = dosServicios ? await service.create(dto(s2.id, ot(sufijo)), lavador.id, con('servicios.generales.agregar')) : null;
    return { a: (Array.isArray(a) ? a[0] : a).id as string, b: b ? ((Array.isArray(b) ? b[0] : b).id as string) : null };
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never);
    especiales = new ServiciosEspecialesService(env.prisma as never);
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

  describe('evidencia de inicio', () => {
    it('sin evidencia de ingreso no se registra (ni se inicia) la OT', async () => {
      const sin = { ...dto(s1.id, ot('sin-evidencia')), fotoIngresoUrl: undefined };

      await expect(service.create(sin, lavador.id, con('servicios.generales.crear'))).rejects.toBeInstanceOf(BadRequestException);
      expect(await env.prisma.servicioLavado.count({ where: { ordenTrabajoOT: ot('sin-evidencia') } })).toBe(0);
    });

    it('un servicio agregado a una OT que ya tiene evidencia de ingreso la hereda', async () => {
      await nuevaOT('hereda');
      const agregado = { ...dto(s2.id, ot('hereda')), fotoIngresoUrl: undefined };

      await expect(service.create(agregado, lavador.id, con('servicios.generales.agregar'))).resolves.toBeDefined();
    });
  });

  describe('editar los datos de la OT', () => {
    it('con «Editar OT» corrige placa, marca, modelo, color y cliente de todos los servicios de la OT', async () => {
      const { a, b } = await nuevaOT('edita', true);

      await service.update(a, { id: a, placa: 'xyz-9999', marca: 'Honda', modelo: 'Civic', color: 'Azul', cliente: 'Cliente Dos' } as any, false, con('servicios.generales.editar'));

      for (const id of [a, b!]) {
        const f = await fila(id);
        expect([f.placa, f.marca, f.modelo, f.color, f.cliente]).toEqual(['XYZ-9999', 'Honda', 'Civic', 'Azul', 'Cliente Dos']);
      }
    });

    it('sin «Editar OT» no corrige los datos, aunque pueda finalizar o registrar', async () => {
      const { a } = await nuevaOT('sin-editar');

      await expect(
        service.update(a, { id: a, placa: 'OTRA-111' } as any, false, con('servicios.generales.finalizar', 'servicios.generales.crear')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((await fila(a)).placa).toBe('ABC-1234');
    });

    it('mandar los mismos datos que ya tiene no exige «Editar OT»', async () => {
      const { a } = await nuevaOT('mismos');

      await expect(
        service.update(a, { id: a, placa: 'abc-1234', modelo: 'Corolla', marca: 'Toyota' } as any, false, con('servicios.generales.finalizar')),
      ).resolves.toBeDefined();
    });

    it('la placa y el modelo no pueden quedar vacíos', async () => {
      const { a } = await nuevaOT('vacios');

      await expect(service.update(a, { id: a, placa: '  ' } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.update(a, { id: a, modelo: '' } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una OT aprobada solo la corrige un administrador (el servidor lo sigue exigiendo)', async () => {
      const { a } = await nuevaOT('aprobada');
      await env.prisma.servicioLavado.update({ where: { id: a }, data: { estado: 'APROBADO' } });

      await expect(service.update(a, { id: a, color: 'Negro' } as any, false, con('servicios.generales.editar'))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('finalizar la OT', () => {
    it('con solo «Editar OT» no puede finalizar', async () => {
      const { a } = await nuevaOT('fin-sin');

      await expect(
        service.update(a, { id: a, estado: 'FINALIZADO', fotoSalidaUrl: 'https://x/salida.mp4' } as any, false, con('servicios.generales.editar')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((await fila(a)).estado).not.toBe('FINALIZADO');
    });

    it('con «Finalizar OT» finaliza', async () => {
      const { a } = await nuevaOT('fin-con');

      await service.update(a, { id: a, estado: 'FINALIZADO', fotoSalidaUrl: 'https://x/salida.mp4' } as any, false, con('servicios.generales.finalizar'));

      expect((await fila(a)).estado).toBe('FINALIZADO');
    });

    it('«Registrar OT» no incluye finalizar: son casillas distintas', async () => {
      const { a } = await nuevaOT('fin-crear');

      await expect(
        service.update(a, { id: a, estado: 'FINALIZADO', fotoSalidaUrl: 'https://x/salida.mp4' } as any, false, con('servicios.generales.crear')),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect((await fila(a)).estado).not.toBe('FINALIZADO');
    });
  });

  describe('observaciones', () => {
    it('las cambia quien edita o quien finaliza; registrar, anular o solo ver no basta', async () => {
      const { a } = await nuevaOT('obs');

      for (const permiso of ['servicios.generales.editar', 'servicios.generales.finalizar']) {
        await service.update(a, { id: a, observaciones: `con ${permiso}` } as any, false, con(permiso));
        expect((await fila(a)).observaciones).toBe(`con ${permiso}`);
      }
      for (const permiso of ['servicios.generales.crear', 'servicios.generales.anular', 'servicios.ver']) {
        await expect(service.update(a, { id: a, observaciones: 'sin permiso' } as any, false, con(permiso))).rejects.toBeInstanceOf(ForbiddenException);
      }
    });
  });

  describe('servicios especiales', () => {
    const nuevoEspecial = async (estado = 'Pendiente') => (await env.servicioEspecial({ estado, fechaFin: null })).id as string;
    const especial = (id: string) => env.prisma.servicioEspecial.findUniqueOrThrow({ where: { id } });

    it('«Editar OT especial» corrige vehículo, cliente, prioridad y observaciones', async () => {
      const id = await nuevoEspecial();

      await especiales.editar(
        { id, placa: 'esp-0001', marca: 'Kia', modelo: 'Rio', color: 'Gris', cliente: 'Cliente Especial', prioridad: 'Alta', observaciones: 'Rayón lateral' } as any,
        con('servicios.especiales.editar'),
      );

      const f = await especial(id);
      expect([f.placa, f.marca, f.modelo, f.color, f.cliente, f.clienteNombre, f.prioridad, f.observaciones]).toEqual([
        'ESP-0001', 'Kia', 'Rio', 'Gris', 'Cliente Especial', 'Cliente Especial', 'Alta', 'Rayón lateral',
      ]);
    });

    it('no se edita un servicio especial completado ni cancelado', async () => {
      for (const estado of ['Completado', 'Cancelado']) {
        const id = await nuevoEspecial(estado);
        await expect(especiales.editar({ id, placa: 'NUEVA-1' } as any, con('servicios.especiales.editar'))).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('sin video de inicio no se puede iniciar un servicio especial', async () => {
      const id = await nuevoEspecial();

      await expect(especiales.iniciar({ id } as any, con('servicios.especiales.operar'))).rejects.toBeInstanceOf(BadRequestException);
      expect((await especial(id)).estado).toBe('Pendiente');
    });

    it('con el video de inicio se inicia', async () => {
      const id = (await env.servicioEspecial({ estado: 'Pendiente', fechaFin: null, operadorId: lavador.id, asignados: [lavador.id] })).id as string;

      await especiales.iniciar({ id, videoInicialUrl: 'https://x/inicio.mp4' } as any, con('servicios.especiales.operar'));

      expect((await especial(id)).estado).toBe('En Proceso');
    });

    it('la placa no puede quedar vacía', async () => {
      const id = await nuevoEspecial();
      await expect(especiales.editar({ id, placa: ' ' } as any, con('servicios.especiales.editar'))).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
