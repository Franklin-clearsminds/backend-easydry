import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InventarioService } from './inventario.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: lo que no llega en una recepción parcial queda retenido como «faltante» y la bodega de origen decide
 * si lo devuelve al stock o lo da de baja. Solo la bodega de origen (su región) puede resolverlo, y una sola vez.
 */
describe('Faltantes de envíos recibidos de forma parcial (base real)', () => {
  let env: Entorno;
  let service: any;
  let regionOrigen: any, regionAjena: any, bodegaOrigen: any, insumo: any, stock: any;
  let admin: any, asistente: any, ajeno: any;
  const faltantesCreados: string[] = [];
  const con = (u: any, ambito: string, extra: Record<string, unknown> = {}) => ({ id: u.id, role: { namerol: 'ROL_DE_PRUEBA', capacidades: ['envios.faltantes'], ambito }, ...extra });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never, env.notificaciones()) as any;
    regionOrigen = await env.region('ORIGEN');
    regionAjena = await env.region('AJENA');
    bodegaOrigen = await env.bodega('ORIGEN', { regionId: regionOrigen.id });
    insumo = await env.insumo('FALT');
    stock = await env.stock({ insumoId: insumo.id, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: bodegaOrigen.id, cantidad: 100 });
    admin = await env.usuario('admin', 'ADMIN');
    asistente = await env.usuario('asist', 'ASISTENTE_BODEGA', { regionId: regionOrigen.id });
    ajeno = await env.usuario('ajeno', 'ASISTENTE_BODEGA', { regionId: regionAjena.id });
  });

  afterAll(async () => {
    if (faltantesCreados.length) await env.prisma.$executeRawUnsafe(`DELETE FROM "FaltanteDespacho" WHERE "id" = ANY($1::text[])`, faltantesCreados);
    await env.cerrar();
  });

  const nuevoFaltante = async (cantidadBase = 4) => {
    const m = await env.movimiento({ usuarioDespachaId: admin.id, origenBodegaId: bodegaOrigen.id });
    const id = randomUUID();
    faltantesCreados.push(id);
    await env.prisma.$executeRawUnsafe(
      `INSERT INTO "FaltanteDespacho" ("id","movimientoId","numeroGuia","insumoId","cantidadUnd","cantidadBase","origenBodegaId","motivoRecepcion")
       VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,'llegó roto')`,
      id, m.id, m.numeroGuia, insumo.id, cantidadBase, cantidadBase, bodegaOrigen.id,
    );
    return id;
  };
  const stockActual = async () => Number((await env.prisma.stockUbicacion.findUniqueOrThrow({ where: { id: stock.id } })).cantidadActual);
  const estado = async (id: string) => (await env.prisma.$queryRawUnsafe<any[]>(`SELECT "estado","resolucion" FROM "FaltanteDespacho" WHERE "id" = $1`, id))[0];

  it('devolver al stock suma lo retenido al origen y cierra el faltante', async () => {
    const id = await nuevoFaltante(4);
    const antes = await stockActual();

    await service.resolverFaltanteDespacho({ id, resolucion: 'DEVOLVER', observacion: 'Estaba sano, se regresa a la bodega' }, con(asistente, 'REGION', { regionId: regionOrigen.id }));

    expect(await stockActual()).toBe(antes + 4);
    expect(await estado(id)).toEqual({ estado: 'RESUELTO', resolucion: 'DEVOLVER' });
  });

  it('dar de baja no devuelve stock y deja constancia como merma en el kardex', async () => {
    const id = await nuevoFaltante(3);
    const antes = await stockActual();

    await service.resolverFaltanteDespacho({ id, resolucion: 'BAJA', observacion: 'Llegó dañado por el transporte' }, con(admin, 'GLOBAL'));

    expect(await stockActual()).toBe(antes);
    expect(await estado(id)).toEqual({ estado: 'RESUELTO', resolucion: 'BAJA' });
    const kardex = await env.prisma.kardexMovimiento.findMany({ where: { insumoId: insumo.id, tipoMovimiento: 'AJUSTE_MERMA' } });
    expect(kardex.some((k) => Number(k.cantidad) === -3)).toBe(true);
  });

  it('un faltante ya resuelto no se puede resolver otra vez (no se devuelve el stock dos veces)', async () => {
    const id = await nuevoFaltante(2);
    const u = con(admin, 'GLOBAL');
    await service.resolverFaltanteDespacho({ id, resolucion: 'DEVOLVER', observacion: 'Se regresa a la bodega' }, u);
    const despues = await stockActual();

    await expect(service.resolverFaltanteDespacho({ id, resolucion: 'DEVOLVER', observacion: 'Se regresa a la bodega' }, u)).rejects.toBeInstanceOf(BadRequestException);
    expect(await stockActual()).toBe(despues);
  });

  it('exige explicar qué pasó (mínimo 10 caracteres)', async () => {
    const id = await nuevoFaltante();
    await expect(service.resolverFaltanteDespacho({ id, resolucion: 'BAJA', observacion: 'roto' }, con(admin, 'GLOBAL'))).rejects.toBeInstanceOf(BadRequestException);
    expect((await estado(id)).estado).toBe('PENDIENTE');
  });

  it('solo la región de origen ve y resuelve el faltante', async () => {
    const id = await nuevoFaltante();
    const deOtraRegion = con(ajeno, 'REGION', { regionId: regionAjena.id });

    await expect(service.resolverFaltanteDespacho({ id, resolucion: 'BAJA', observacion: 'Intento desde otra región' }, deOtraRegion)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.listFaltantesDespacho({}, deOtraRegion)).some((f: any) => f.id === id)).toBe(false);
    expect((await service.listFaltantesDespacho({}, con(asistente, 'REGION', { regionId: regionOrigen.id }))).some((f: any) => f.id === id)).toBe(true);
  });

  it('una resolución distinta de devolver o baja se rechaza', async () => {
    const id = await nuevoFaltante();
    await expect(service.resolverFaltanteDespacho({ id, resolucion: 'OTRA', observacion: 'Resolución inválida aquí' }, con(admin, 'GLOBAL'))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el aviso a la bodega de origen llega a su región y no a otra', async () => {
    const m = await env.movimiento({ usuarioDespachaId: admin.id, origenBodegaId: bodegaOrigen.id });
    await service.notificarFaltantesDespacho({ ...m, usuarioDespachaId: admin.id }, null, bodegaOrigen.id, 'llegó roto');

    const filas = await env.esperar(async () => {
      const f = await env.prisma.notification.findMany({ where: { entidadTipo: 'MOVIMIENTO_INVENTARIO', entidadId: m.id } });
      return f.length ? f : null;
    });
    const destinatarios = new Set(filas.map((f) => f.userId));
    expect(destinatarios.has(asistente.id)).toBe(true);
    expect(destinatarios.has(ajeno.id)).toBe(false);
    expect(filas[0].tipo).toBe('DESPACHO_FALTANTE');
  });
});
