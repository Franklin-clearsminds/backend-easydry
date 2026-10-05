import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RetosService } from './retos.service.js';
import { ListRetosDto } from './dto/retos.dto.js';

const construir = () => {
  const prisma = { reto: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } };
  return { prisma, service: new RetosService(prisma as never) };
};
const admin = { role: 'SUPER_ADMIN' };
const lavador = { role: 'LAVADOR', agenciaId: 'a1', region: { nombre: 'Norte' } };

describe('RetosService.list — vigencia', () => {
  it('ACTIVOS: solo estado ACTIVO (el valor por defecto de la pantalla)', async () => {
    const { prisma, service } = construir();
    await service.list({ page: 1, vigencia: 'ACTIVOS' } as any, admin);
    expect(prisma.reto.findMany.mock.calls[0][0].where).toEqual({ estado: 'ACTIVO' });
  });

  it('VENCIDOS: los que ya pasaron su fecha de fin, sea cual sea su estado', async () => {
    const { prisma, service } = construir();
    await service.list({ page: 1, vigencia: 'VENCIDOS' } as any, admin);
    const where = prisma.reto.findMany.mock.calls[0][0].where;
    expect(where).not.toHaveProperty('estado');
    expect(where.fechaFin.lt).toBeInstanceOf(Date);
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    expect(where.fechaFin.lt.getTime()).toBe(hoy.getTime());
  });

  it('TODOS: sin filtro de estado ni de fecha', async () => {
    const { prisma, service } = construir();
    await service.list({ page: 1, vigencia: 'TODOS' } as any, admin);
    expect(prisma.reto.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('un rol que no es administrador sigue viendo solo lo visible para su región y sucursal, con cualquier vigencia', async () => {
    const { prisma, service } = construir();
    await service.list({ page: 1, vigencia: 'TODOS', search: 'verano' } as any, lavador);
    const txt = JSON.stringify(prisma.reto.findMany.mock.calls[0][0].where);
    expect(txt).toContain('"sucursalesIds":{"has":"a1"}');
    expect(txt).toContain('"regiones":{"has":"Norte"}');
    expect(txt).toContain('"titulo":{"contains":"verano"');
  });

  it('sin vigencia se conservan los indicadores antiguos (soloActivos / incluirTodos)', async () => {
    const { prisma, service } = construir();
    await service.list({} as any, admin);
    expect(prisma.reto.findMany.mock.calls[0][0].where).toEqual({ estado: 'ACTIVO' });
    await service.list({ incluirTodos: true, soloActivos: false } as any, admin);
    expect(prisma.reto.findMany.mock.calls[1][0].where).toEqual({});
  });

  it('el DTO acepta solo las tres vigencias', async () => {
    expect(await validate(plainToInstance(ListRetosDto, { vigencia: 'VENCIDOS', page: 1 }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListRetosDto, { vigencia: 'otra' }))).length).toBeGreaterThan(0);
  });
});
