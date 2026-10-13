import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: en Gestión de Lavadores cada botón tiene su permiso —editar datos, cambiar el rol, asignar a una
 * bahía y quitar de una bahía— y el servidor los exige por separado aunque el formulario los mande juntos. Además, dejar a un
 * lavador sin bahía («en reserva») funciona de verdad.
 */
describe('Gestión de Lavadores: permisos por botón (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let agencia: any;
  let bahia: any;
  let otraBahia: any;
  let admin: any;

  /** Quien llama, con exactamente estos permisos. */
  const con = (...capacidades: string[]) => ({ id: admin.id, role: { namerol: 'ROL_DE_PRUEBA', capacidades } });
  const bahiaActual = async (usuarioId: string) =>
    (await env.prisma.bahiaOperador.findFirst({ where: { operadorId: usuarioId, activo: true } }))?.bahiaId ?? null;

  /** Un lavador nuevo con su bahía ya asignada. */
  const lavadorEnBahia = async (sufijo: string) => {
    const l = await env.usuario(sufijo, 'LAVADOR', { agenciaId: agencia.id });
    await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: l.id } as any, admin.id);
    return l;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    agencia = await env.agencia('A1', { numeroBahias: 2, maxLavadoresPorBahia: 1 });
    bahia = await env.bahia('B1', agencia.id);
    otraBahia = await env.bahia('B2', agencia.id);
    admin = await env.usuario('admin', 'ADMIN');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('dejar a un lavador sin bahía (en reserva)', () => {
    it('con «Quitar de bahía» queda sin bahía, tanto con null como con cadena vacía', async () => {
      for (const vacio of [null, '']) {
        const l = await lavadorEnBahia(`reserva${vacio === null ? 'N' : 'V'}`);
        expect(await bahiaActual(l.id)).toBe(bahia.id);

        await service.updateOperador({ id: l.id, bahiaId: vacio } as any, admin.id, con('operadores.bahia.quitar'));

        expect(await bahiaActual(l.id)).toBeNull();
        expect((await env.prisma.bahia.findUniqueOrThrow({ where: { id: bahia.id } })).operadorActualId).toBeNull();
      }
    });

    it('sin «Quitar de bahía» el servidor lo rechaza y no cambia nada', async () => {
      const l = await lavadorEnBahia('sinQuitar');

      await expect(
        service.updateOperador({ id: l.id, bahiaId: null } as any, admin.id, con('operadores.editar', 'operadores.bahia.asignar')),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(await bahiaActual(l.id)).toBe(bahia.id);
      await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: null } as any, admin.id);
    });

    it('dejar sin bahía a quien ya estaba sin bahía no exige nada', async () => {
      const l = await env.usuario('yaEnReserva', 'LAVADOR', { agenciaId: agencia.id });

      await expect(service.updateOperador({ id: l.id, bahiaId: '' } as any, admin.id, con('operadores.rol'))).resolves.toBeDefined();
    });
  });

  describe('asignar a otra bahía', () => {
    it('con «Asignar a bahía» cambia de bahía', async () => {
      const l = await lavadorEnBahia('cambia');

      await service.updateOperador({ id: l.id, bahiaId: otraBahia.id } as any, admin.id, con('operadores.bahia.asignar'));

      expect(await bahiaActual(l.id)).toBe(otraBahia.id);
      await service.asignarOperadorABahia({ bahiaId: otraBahia.id, operadorId: null } as any, admin.id);
    });

    it('solo con «Quitar de bahía» no puede mover a otra bahía', async () => {
      const l = await lavadorEnBahia('soloQuitar');

      await expect(
        service.updateOperador({ id: l.id, bahiaId: otraBahia.id } as any, admin.id, con('operadores.bahia.quitar')),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(await bahiaActual(l.id)).toBe(bahia.id);
      await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: null } as any, admin.id);
    });

    it('mandar la bahía que ya tiene no cuenta como asignar', async () => {
      const l = await lavadorEnBahia('misma');

      await expect(
        service.updateOperador({ id: l.id, bahiaId: bahia.id } as any, admin.id, con('operadores.editar')),
      ).resolves.toBeDefined();
      await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: null } as any, admin.id);
    });

    it('«Asignar lavadores a bahía» de Gestión de Agencias también vale (es la misma acción en otra pantalla)', async () => {
      const l = await lavadorEnBahia('desdeAgencias');

      await service.updateOperador({ id: l.id, bahiaId: otraBahia.id } as any, admin.id, con('agencias.bahias.asignar'));

      expect(await bahiaActual(l.id)).toBe(otraBahia.id);
      await service.asignarOperadorABahia({ bahiaId: otraBahia.id, operadorId: null } as any, admin.id);
    });
  });

  describe('editar datos y cambiar el rol son dos permisos', () => {
    it('con solo «Cambiar rol» puede cambiar el rol pero no los datos', async () => {
      const l = await env.usuario('soloRol', 'LAVADOR', { agenciaId: agencia.id, name: 'Original' });

      await expect(service.updateOperador({ id: l.id, nombre: 'Otro Nombre' } as any, admin.id, con('operadores.rol'))).rejects.toBeInstanceOf(ForbiddenException);
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id } })).name).toBe('Original');

      await service.updateOperador({ id: l.id, rol: 'PULIDOR' } as any, admin.id, con('operadores.rol'));
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id }, include: { role: true } })).role.namerol).toBe('PULIDOR');
    });

    it('con solo «Editar datos» puede cambiar los datos pero no el rol', async () => {
      const l = await env.usuario('soloEditar', 'LAVADOR', { agenciaId: agencia.id, name: 'Original' });

      await expect(service.updateOperador({ id: l.id, rol: 'PULIDOR' } as any, admin.id, con('operadores.editar'))).rejects.toBeInstanceOf(ForbiddenException);
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id }, include: { role: true } })).role.namerol).toBe('LAVADOR');

      await service.updateOperador({ id: l.id, nombre: 'Nuevo Nombre' } as any, admin.id, con('operadores.editar'));
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id } })).name).toBe('Nuevo');
    });

    it('mandar el mismo rol que ya tiene no exige «Cambiar rol»', async () => {
      const l = await env.usuario('mismoRol', 'LAVADOR', { agenciaId: agencia.id });

      await expect(service.updateOperador({ id: l.id, rol: 'LAVADOR' } as any, admin.id, con('operadores.editar'))).resolves.toBeDefined();
    });

    it('sin ninguno de los permisos no cambia nada', async () => {
      const l = await env.usuario('ninguno', 'LAVADOR', { agenciaId: agencia.id, name: 'Intacto' });

      await expect(service.updateOperador({ id: l.id, nombre: 'Cambio Total', rol: 'PULIDOR' } as any, admin.id, con('operadores.ver'))).rejects.toBeInstanceOf(ForbiddenException);
      expect((await env.prisma.user.findUniqueOrThrow({ where: { id: l.id } })).name).toBe('Intacto');
    });
  });

  describe('registrar con bahía', () => {
    it('registrar a alguien con una bahía asignada exige «Asignar a bahía» además de «Registrar»', async () => {
      const dto = { nombre: 'Nuevo Lavador', cedula: '0999999999', rol: 'LAVADOR', agenciaId: agencia.id, bahiaId: bahia.id } as any;

      await expect(service.createOperador(dto, admin.id, con('operadores.registrar'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('registrar sin bahía (en reserva) solo exige «Registrar»', async () => {
      const dto = { nombre: 'Reserva Lavador', cedula: '0988888888', rol: 'LAVADOR', agenciaId: agencia.id } as any;

      const creado: any = await service.createOperador(dto, admin.id, con('operadores.registrar'));

      expect(creado.id).toBeTruthy();
      env.rastrear('User', creado.id);
    });
  });
});
