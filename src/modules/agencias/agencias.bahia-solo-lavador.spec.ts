import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/** Integración con la base real (sin mocks): la bahía es solo para el rol LAVADOR. */
describe('La bahía es solo para lavadores (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let agencia: any;
  let bahia: any;
  let admin: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);
    agencia = await env.agencia('A1', { numeroBahias: 1, maxLavadoresPorBahia: 1 });
    bahia = await env.bahia('B1', agencia.id);
    admin = await env.usuario('admin', 'ADMIN');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('asignarOperadorABahia rechaza a un pulidor y no deja ninguna asignación', async () => {
    const pulidor = await env.usuario('pulidor', 'PULIDOR', { agenciaId: agencia.id });
    await expect(
      service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: pulidor.id } as any, admin.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await env.prisma.bahiaOperador.count({ where: { bahiaId: bahia.id } })).toBe(0);
    expect((await env.prisma.bahia.findUniqueOrThrow({ where: { id: bahia.id } })).operadorActualId).toBeNull();
  });

  it('asignarOperadorABahia sí asigna a un lavador', async () => {
    const lavador = await env.usuario('lavador-ok', 'LAVADOR', { agenciaId: agencia.id });
    await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: lavador.id } as any, admin.id);
    expect(await env.prisma.bahiaOperador.count({ where: { bahiaId: bahia.id, operadorId: lavador.id, activo: true } })).toBe(1);
    // Se libera para no afectar a las siguientes pruebas.
    await service.asignarOperadorABahia({ bahiaId: bahia.id, operadorId: null } as any, admin.id);
  });

  it('updateOperador no cambia el rol: si llega uno distinto lo ignora y el lavador conserva su bahía', async () => {
    const otra = await env.bahia('B2', agencia.id);
    const lavador = await env.usuario('lavador-cambia', 'LAVADOR', { agenciaId: agencia.id });
    await service.asignarOperadorABahia({ bahiaId: otra.id, operadorId: lavador.id } as any, admin.id);

    await service.updateOperador({ id: lavador.id, rol: 'PULIDOR', bahiaId: otra.id } as any, admin.id);

    const usuario = await env.prisma.user.findUniqueOrThrow({ where: { id: lavador.id }, include: { role: true } });
    expect(usuario.role.namerol).toBe('LAVADOR');
    expect(await env.prisma.bahiaOperador.count({ where: { operadorId: lavador.id, activo: true } })).toBe(1);
    await service.asignarOperadorABahia({ bahiaId: otra.id, operadorId: null } as any, admin.id);
  });
});
