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

  describe('flujo real de recepción', () => {
    let superAdmin: any, agenciaDestino: any, insumoFlujo: any, stockOrigen: any;
    const enBase = async (id: string) => Number((await env.prisma.stockUbicacion.findUniqueOrThrow({ where: { id } })).cantidadActual);

    /** Despacho en tránsito: el stock del origen ya está descontado (100) y el kardex guarda lo reservado (10). */
    const despacho = async () => {
      const m = await env.movimiento({
        usuarioDespachaId: admin.id,
        origenBodegaId: bodegaOrigen.id,
        destinoAgenciaId: agenciaDestino.id,
        detalle: { insumoId: insumoFlujo.id, cantidadEnviada: 10 },
      });
      await env.prisma.kardexMovimiento.create({
        data: { insumoId: insumoFlujo.id, ubicacionId: bodegaOrigen.id, tipoMovimiento: 'DESPACHO_SALIDA', cantidad: -10, stockAnterior: 110, stockPosterior: 100, referenciaId: m.numeroGuia },
      });
      return m;
    };
    const faltantesDe = (movimientoId: string) =>
      env.prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "FaltanteDespacho" WHERE "movimientoId" = $1`, movimientoId);

    beforeAll(async () => {
      superAdmin = await env.usuario('superflujo', 'SUPER_ADMIN');
      agenciaDestino = await env.agencia('DEST', { regionId: regionOrigen.id });
      insumoFlujo = await env.insumo('FLUJO');
      stockOrigen = await env.stock({ insumoId: insumoFlujo.id, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: bodegaOrigen.id, cantidad: 100 });
    });

    it('rechazar un envío no devuelve el stock: queda retenido para que la bodega de origen decida', async () => {
      const m = await despacho();

      await service.confirmarRecepcion({ movimientoId: m.numeroGuia, accion: 'RECHAZADO', motivo: 'Llegó mojado' }, superAdmin.id);

      expect(await enBase(stockOrigen.id)).toBe(100);
      const f = await faltantesDe(m.id);
      faltantesCreados.push(...f.map((x) => x.id));
      expect(f).toHaveLength(1);
      expect(Number(f[0].cantidadBase)).toBe(10);
      expect(f[0].estado).toBe('PENDIENTE');
      expect(f[0].motivoRecepcion).toContain('Llegó mojado');

      await service.resolverFaltanteDespacho({ id: f[0].id, resolucion: 'DEVOLVER', observacion: 'Estaba sano, vuelve a bodega' }, con(admin, 'GLOBAL'));
      expect(await enBase(stockOrigen.id)).toBe(110);
    });

    it('recibe o rechaza quien pertenece a la agencia destino; el de otra agencia no puede', async () => {
      const m = await despacho();
      const otraAgencia = await env.agencia('OTRA', { regionId: regionOrigen.id });
      const intruso = await env.usuario('intruso', 'LIDER', { agenciaId: otraAgencia.id });

      await expect(service.confirmarRecepcion({ movimientoId: m.numeroGuia, accion: 'RECHAZADO', motivo: 'No me corresponde' }, intruso.id)).rejects.toBeInstanceOf(ForbiddenException);
      const lider = await env.usuario('lider-dest', 'LIDER', { agenciaId: agenciaDestino.id });
      await service.confirmarRecepcion({ movimientoId: m.numeroGuia, accion: 'RECHAZADO', motivo: 'Llegó averiado' }, lider.id);
      const f = await faltantesDe(m.id);
      faltantesCreados.push(...f.map((x) => x.id));
      expect(f).toHaveLength(1);
    });

    it('guarda las fotos opcionales del rechazo, las muestra en el listado y rechaza fotos que no son de envíos', async () => {
      const m = await despacho();
      const foto = `https://bucket.s3.amazonaws.com/inventario/envios/${m.numeroGuia}/rechazo/1_foto_envio_a.jpg`;

      await expect(service.confirmarRecepcion({ movimientoId: m.numeroGuia, accion: 'RECHAZADO', motivo: 'Roto', evidencias: ['https://otro.com/foto.jpg'] }, superAdmin.id)).rejects.toBeInstanceOf(BadRequestException);
      await service.confirmarRecepcion({ movimientoId: m.numeroGuia, accion: 'RECHAZADO', motivo: 'Roto', evidencias: [foto] }, superAdmin.id);

      const f = await faltantesDe(m.id);
      faltantesCreados.push(...f.map((x) => x.id));
      const lista = await service.listFaltantesDespacho({}, con(admin, 'GLOBAL'));
      expect(lista.find((x: any) => x.id === f[0].id).evidenciasRecepcion).toEqual([foto]);
    });

    it('al resolver, el faltante pasa al historial con quién, cuándo y qué decidió, y la alerta de incidencia desaparece', async () => {
      const m = await despacho();
      await service.confirmarRecepcion({ movimientoId: m.numeroGuia, accion: 'RECHAZADO', motivo: 'Derrame en tránsito' }, superAdmin.id);
      const f = (await faltantesDe(m.id))[0];
      faltantesCreados.push(f.id);
      const alertaAntes = await env.prisma.alertaStock.findMany({ where: { mensaje: { startsWith: `Incidencia envío ${m.numeroGuia}` } } });
      expect(alertaAntes.length).toBeGreaterThan(0);
      const fotoResolucion = `https://bucket.s3.amazonaws.com/inventario/envios/${m.numeroGuia}/resolucion/2_foto_envio_b.jpg`;

      await service.resolverFaltanteDespacho({ id: f.id, resolucion: 'BAJA', observacion: 'Se derramó, se da de baja', evidencias: [fotoResolucion] }, con(admin, 'GLOBAL'));

      expect((await service.listFaltantesDespacho({}, con(admin, 'GLOBAL'))).some((x: any) => x.id === f.id)).toBe(false); // ya no está pendiente
      const historial = (await service.listFaltantesDespacho({ estado: 'RESUELTO' }, con(admin, 'GLOBAL'))).find((x: any) => x.id === f.id);
      expect(historial.resolucion).toBe('BAJA');
      expect(historial.observacionResolucion).toBe('Se derramó, se da de baja');
      expect(historial.resueltoPorNombre).toBeTruthy();
      expect(historial.evidenciasResolucion).toEqual([fotoResolucion]);
      const alertaDespues = await env.prisma.alertaStock.findMany({ where: { mensaje: { startsWith: `Incidencia envío ${m.numeroGuia}` } } });
      expect(alertaDespues.every((a) => a.estado === 'RESUELTO')).toBe(true);
    });

    it('recibir de forma parcial suma lo recibido al destino y retiene lo que faltó', async () => {
      const m = await despacho();
      const detalle = await env.prisma.movimientoDetalle.findFirstOrThrow({ where: { movimientoId: m.id } });

      await service.confirmarRecepcion(
        { movimientoId: m.numeroGuia, accion: 'RECIBIDO', observaciones: 'Llegaron 7 de 10', cantidadesRecibidas: [{ detalleId: detalle.id, cantidadRecibida: 7 }] },
        superAdmin.id,
      );

      const f = await faltantesDe(m.id);
      faltantesCreados.push(...f.map((x) => x.id));
      expect(f).toHaveLength(1);
      expect(Number(f[0].cantidadUnd)).toBe(3);
      expect(f[0].estado).toBe('PENDIENTE');
      const destino = await env.prisma.stockUbicacion.findFirst({ where: { insumoId: insumoFlujo.id, agenciaId: agenciaDestino.id } });
      expect(Number(destino?.cantidadActual)).toBe(7);
    });
  });
});
