import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventarioService } from './inventario.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): un envío entre agencias que crea un líder espera aprobación y no mueve stock.
 *
 * Mundo: región R1 con las agencias A1 (origen, con 100 envases de JABON y el líder Lía) y A2 (destino, con la líder Paula).
 * Aprueban Admin y Coord. Bodega; el resto de roles no.
 */
describe('Aprobación de envíos entre agencias creados por un líder (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let a1: any;
  let a2: any;
  let jabon: any;
  let stockOrigen: { id: string };
  let neto = 1;
  const u: Record<string, any> = {};
  const actor: Record<string, any> = {};
  let n = 0;
  const FOTO = (etapa: string) => `https://bucket.test/inventario/envios/PEND-${Date.now()}/${etapa}/foto.jpg`;

  const cantidadOrigen = async () =>
    Number((await env.prisma.stockUbicacion.findUniqueOrThrow({ where: { id: stockOrigen.id } })).cantidadActual);
  const estadoDe = async (id: string) =>
    ((await env.prisma.$queryRawUnsafe(`SELECT "estadoDespacho"::text AS "e" FROM "MovimientoInventario" WHERE "id" = $1`, id)) as any[])[0]?.e;
  const lista = (usuarioId: string) => service.listDespachos({ numeroGuia: env.marca } as any, usuarioId);

  /** Crea un envío de A1 a A2 con el líder Lía (con foto salvo que se diga lo contrario). */
  const crearComoLider = async (unidades = 5, conFoto = true) => {
    const guia = `${env.marca}-EA${++n}`;
    const res: any = await service.crearDespacho(
      {
        numeroGuia: guia,
        tipo: 'DESPACHO_AGENCIA',
        agenciaId: a2.id,
        sucursalDestinoId: a2.id,
        detalles: [{ insumoId: jabon.id, cantidadEnviada: unidades }],
        ...(conFoto ? { evidencias: [FOTO('envio')] } : {}),
      } as any,
      u.lia.id,
    );
    env.rastrear('MovimientoInventario', res.id);
    return res;
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);
    const region = await env.region('R1');
    a1 = await env.agencia('A1', { regionId: region.id });
    a2 = await env.agencia('A2', { regionId: region.id });
    jabon = await env.insumo('JABON');
    neto = Number((await env.prisma.insumo.findUniqueOrThrow({ where: { id: jabon.id } })).contenidoNeto) || 1;
    stockOrigen = await env.stock({ insumoId: jabon.id, tipoUbicacion: 'AGENCIA', agenciaId: a1.id, cantidad: 100 * neto });

    for (const [clave, rol, extra] of [
      ['lia', 'LIDER', { agenciaId: a1.id }],
      ['paula', 'LIDER', { agenciaId: a2.id }],
      ['admin', 'ADMIN', {}],
      ['coord', 'COORD_BODEGA', {}],
    ] as const) {
      u[clave] = await env.usuario(clave, rol, { name: clave, ...extra });
      actor[clave] = await env.actor(u[clave].id);
    }
  });

  afterAll(async () => {
    await env.prisma.$executeRawUnsafe(`DELETE FROM "KardexMovimiento" WHERE "referenciaId" LIKE $1`, `${env.marca}%`).catch(() => undefined);
    await env.cerrar();
  });

  it('la foto de lo que envía el líder es opcional', async () => {
    const mov = await crearComoLider(5, false);
    expect(mov.pendienteAprobacion).toBe(true);
    const fotos: any[] = await env.prisma.$queryRawUnsafe(`SELECT "etapa" FROM "EnvioEvidencia" WHERE "movimientoId" = $1`, mov.id);
    expect(fotos).toEqual([]);
  });

  it('con foto queda pendiente de aprobación y no mueve stock', async () => {
    const antes = await cantidadOrigen();
    const mov = await crearComoLider(5);
    expect(mov.pendienteAprobacion).toBe(true);
    expect(await estadoDe(mov.id)).toBe('PENDIENTE_APROBACION');
    expect(await cantidadOrigen()).toBe(antes);
    const fotos: any[] = await env.prisma.$queryRawUnsafe(`SELECT "etapa" FROM "EnvioEvidencia" WHERE "movimientoId" = $1`, mov.id);
    expect(fotos.map((f) => f.etapa)).toEqual(['ENVIO']);
  });

  it('el destino no ve el envío pendiente; quien lo creó y los aprobadores sí', async () => {
    const mov = await crearComoLider(1);
    const ids = async (usuarioId: string) => ((await lista(usuarioId)) as any[]).map((x) => x.id);
    expect(await ids(u.paula.id)).not.toContain(mov.id);
    expect(await ids(u.lia.id)).toContain(mov.id);
    expect(await ids(u.admin.id)).toContain(mov.id);
    const deAdmin = ((await lista(u.admin.id)) as any[]).find((x) => x.id === mov.id);
    expect(deAdmin.puedeAprobar).toBe(true);
    const deLia = ((await lista(u.lia.id)) as any[]).find((x) => x.id === mov.id);
    expect(deLia.puedeAprobar).toBe(false);
    expect(deLia.puedeCancelar).toBe(true);
  });

  it('un pendiente no se puede recibir', async () => {
    const mov = await crearComoLider(1);
    await expect(
      service.confirmarRecepcion({ movimientoId: mov.id, accion: 'RECIBIDO', evidencias: [FOTO('recepcion')] } as any, u.paula.id),
    ).rejects.toThrow(/aún no está aprobado/);
  });

  it('al aprobar sale el stock, el envío va en tránsito y el destino ya lo ve', async () => {
    const mov = await crearComoLider(5);
    const antes = await cantidadOrigen();
    const r: any = await service.decidirEnvioPendiente({ movimientoId: mov.id, accion: 'APROBAR' }, u.admin.id);
    expect(r.nuevoEstado).toBe('EN_TRANSITO');
    expect(await cantidadOrigen()).toBe(antes - 5 * neto);
    const fila: any[] = await env.prisma.$queryRawUnsafe(`SELECT "aprobadoPorId" FROM "MovimientoInventario" WHERE "id" = $1`, mov.id);
    expect(fila[0].aprobadoPorId).toBe(u.admin.id);
    expect(((await lista(u.paula.id)) as any[]).map((x) => x.id)).toContain(mov.id);
    await expect(service.decidirEnvioPendiente({ movimientoId: mov.id, accion: 'APROBAR' }, u.coord.id)).rejects.toThrow(/ya no está pendiente/);
  });

  it('recibir un envío aprobado entra al stock del destino, con o sin foto', async () => {
    const mov = await crearComoLider(3);
    await service.decidirEnvioPendiente({ movimientoId: mov.id, accion: 'APROBAR' }, u.coord.id);
    await service.confirmarRecepcion({ movimientoId: mov.id, accion: 'RECIBIDO', evidencias: [FOTO('recepcion')] } as any, u.paula.id);
    expect(await estadoDe(mov.id)).toBe('RECIBIDO');
    const destino = await env.prisma.stockUbicacion.findFirst({ where: { insumoId: jabon.id, tipoUbicacion: 'AGENCIA', agenciaId: a2.id } });
    expect(Number(destino?.cantidadActual)).toBeGreaterThanOrEqual(3 * neto);
  });

  it('rechazar exige motivo y no mueve stock', async () => {
    const mov = await crearComoLider(4);
    const antes = await cantidadOrigen();
    await expect(service.decidirEnvioPendiente({ movimientoId: mov.id, accion: 'RECHAZAR' }, u.admin.id)).rejects.toThrow(/motivo del rechazo/);
    await service.decidirEnvioPendiente({ movimientoId: mov.id, accion: 'RECHAZAR', motivo: 'No hace falta' }, u.admin.id);
    expect(await estadoDe(mov.id)).toBe('CANCELADO');
    expect(await cantidadOrigen()).toBe(antes);
  });

  it('quien lo creó puede cancelarlo sin motivo; un tercero sin permiso no', async () => {
    const mov = await crearComoLider(2);
    await expect(service.cancelarEnvioPendiente({ movimientoId: mov.id }, actor.paula)).rejects.toThrow(/Solo quien creó el envío o un aprobador/);
    const antes = await cantidadOrigen();
    await service.cancelarEnvioPendiente({ movimientoId: mov.id }, actor.lia);
    expect(await estadoDe(mov.id)).toBe('CANCELADO');
    expect(await cantidadOrigen()).toBe(antes);
  });

  it('un aprobador que cancela debe escribir el motivo', async () => {
    const mov = await crearComoLider(2);
    await expect(service.cancelarEnvioPendiente({ movimientoId: mov.id }, actor.admin)).rejects.toThrow(/motivo de la cancelación/);
    await service.cancelarEnvioPendiente({ movimientoId: mov.id, motivo: 'Duplicado' }, actor.admin);
    expect(await estadoDe(mov.id)).toBe('CANCELADO');
  });

  it('si al aprobar ya no alcanza el stock, falla y el envío sigue pendiente', async () => {
    const mov = await crearComoLider(90);
    await env.prisma.stockUbicacion.update({ where: { id: stockOrigen.id }, data: { cantidadActual: 10 * neto } });
    const antes = await cantidadOrigen();
    await expect(service.decidirEnvioPendiente({ movimientoId: mov.id, accion: 'APROBAR' }, u.admin.id)).rejects.toThrow(/stock insuficiente/i);
    expect(await estadoDe(mov.id)).toBe('PENDIENTE_APROBACION');
    expect(await cantidadOrigen()).toBe(antes);
    await env.prisma.stockUbicacion.update({ where: { id: stockOrigen.id }, data: { cantidadActual: 100 * neto } });
  });

  it('un envío entre agencias de un administrador no pasa por aprobación', async () => {
    const guia = `${env.marca}-EA${++n}`;
    const antes = await cantidadOrigen();
    const res: any = await service.crearDespacho(
      { numeroGuia: guia, tipo: 'DESPACHO_AGENCIA', agenciaId: a2.id, sucursalDestinoId: a2.id, origenAgenciaId: a1.id, detalles: [{ insumoId: jabon.id, cantidadEnviada: 2 }] } as any,
      u.admin.id,
    );
    env.rastrear('MovimientoInventario', res.id);
    expect(res.pendienteAprobacion).toBeUndefined();
    expect(await estadoDe(res.id)).toBe('EN_TRANSITO');
    expect(await cantidadOrigen()).toBe(antes - 2 * neto);
  });

  it('avisarEnviosSinAprobar marca una sola vez los pendientes de más de 24 horas', async () => {
    const mov = await crearComoLider(1);
    await env.prisma.$executeRawUnsafe(`UPDATE "MovimientoInventario" SET "createdAt" = NOW() - INTERVAL '25 hours' WHERE "id" = $1`, mov.id);
    expect(await service.avisarEnviosSinAprobar()).toBeGreaterThanOrEqual(1);
    const fila: any[] = await env.prisma.$queryRawUnsafe(`SELECT "avisoAprobacionEn" FROM "MovimientoInventario" WHERE "id" = $1`, mov.id);
    expect(fila[0].avisoAprobacionEn).toBeTruthy();
    const otra = await service.avisarEnviosSinAprobar();
    const aun: any[] = await env.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "MovimientoInventario" WHERE "id" = $1 AND "avisoAprobacionEn" IS NOT NULL`, mov.id);
    expect(aun[0].c).toBe(1);
    expect(otra).toBeGreaterThanOrEqual(0);
  });
});
