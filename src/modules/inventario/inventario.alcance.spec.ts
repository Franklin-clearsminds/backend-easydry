import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventarioService } from './inventario.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Mundo de la prueba, todo creado aquí:
 *
 *  Región R1 ── Agencia A1 (Lía LIDER · Pulidor fijo Paco · Pulidor Pepa) · Agencia A2 (Lara LIDER) · Bodega B-R1 (Asistente R1)
 *  Región R2 ── Agencia A3 · Bodega B-R2 (Asistente R2)
 *  Sin ámbito: Admin, Coord. Bodega, Coord. Servicios Especiales, Técnico, un líder sin agencia, un pulidor móvil sin sede.
 */
describe('InventarioService: alcance por rol (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let r1: any;
  let r2: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let bodR1: any;
  let bodR2: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);

    r1 = await env.region('R1');
    r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    bodR1 = await env.bodega('R1', { regionId: r1.id });
    bodR2 = await env.bodega('R2', { regionId: r2.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('lia', 'LIDER', { agenciaId: a1.id });
    await crear('lara', 'LIDER', { agenciaId: a2.id });
    await crear('liderSinAgencia', 'LIDER');
    await crear('paco', 'PULIDOR', { agenciaId: a1.id });
    await crear('pepa', 'PULIDOR', { agenciaId: a1.id });
    await crear('movil', 'PULIDOR'); // sin agencia ni región
    await crear('asistenteR1', 'ASISTENTE_BODEGA', { bodegaId: bodR1.id });
    await crear('asistenteR2', 'ASISTENTE_BODEGA', { bodegaId: bodR2.id });
    await crear('admin', 'ADMIN');
    await crear('coordBodega', 'COORD_BODEGA');
    await crear('coordEsp', 'COORD_SERVICIOS_ESPECIALES', { regionId: r1.id });
    await crear('coordEspR2', 'COORD_SERVICIOS_ESPECIALES', { regionId: r2.id });
    await crear('tecnico', 'TECNICO');
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('agenciaEnAlcance', () => {
    it('un usuario de agencia queda siempre en la suya, aunque el cliente mande otra', async () => {
      await expect(service.agenciaEnAlcance(actores.lia, undefined)).resolves.toBe(a1.id);
      await expect(service.agenciaEnAlcance(actores.lia, a1.id)).resolves.toBe(a1.id);
      await expect(service.agenciaEnAlcance(actores.lia, a2.id)).rejects.toThrow(/alcance/);
    });

    it('quien actúa por región solo elige agencias de su región', async () => {
      await expect(service.agenciaEnAlcance(actores.asistenteR1, a1.id)).resolves.toBe(a1.id);
      await expect(service.agenciaEnAlcance(actores.asistenteR1, a3.id)).rejects.toThrow(/tu región/);
      await expect(service.agenciaEnAlcance(actores.asistenteR1, undefined)).resolves.toBeUndefined();
    });

    it('administradores y bodega nacional eligen cualquiera; sin datos de ámbito no se puede', async () => {
      await expect(service.agenciaEnAlcance(actores.admin, 'cualquiera')).resolves.toBe('cualquiera');
      await expect(service.agenciaEnAlcance(actores.coordBodega, undefined)).resolves.toBeUndefined();
      await expect(service.agenciaEnAlcance(actores.liderSinAgencia, a1.id)).rejects.toThrow(/asignada/);
      await expect(service.agenciaEnAlcance(actores.tecnico, a1.id)).rejects.toThrow(/asignada/);
    });
  });

  describe('pulidorEnAlcance', () => {
    it('el pulidor solo ve su propio kit', async () => {
      await expect(service.pulidorEnAlcance(actores.paco, undefined)).resolves.toBe(ids.paco);
      await expect(service.pulidorEnAlcance(actores.paco, ids.paco)).resolves.toBe(ids.paco);
      await expect(service.pulidorEnAlcance(actores.paco, ids.pepa)).rejects.toThrow(/insumos propio/);
    });

    it('otros roles ven el kit de pulidores de su alcance', async () => {
      await expect(service.pulidorEnAlcance(actores.coordEsp, ids.pepa)).resolves.toBe(ids.pepa); // Pepa está en su región R1
      await expect(service.pulidorEnAlcance(actores.coordEspR2, ids.pepa)).rejects.toThrow(/alcance/); // el coordinador es solo regional
      await expect(service.pulidorEnAlcance(actores.asistenteR1, ids.pepa)).resolves.toBe(ids.pepa); // Pepa está en la región R1
      await expect(service.pulidorEnAlcance(actores.asistenteR2, ids.pepa)).rejects.toThrow(/alcance/); // otra región
      await expect(service.pulidorEnAlcance(actores.lara, ids.pepa)).rejects.toThrow(/alcance/); // otra agencia
      await expect(service.pulidorEnAlcance(actores.lia, ids.pepa)).resolves.toBe(ids.pepa); // su misma agencia
    });
  });

  describe('listMovimientos (historial de movimientos)', () => {
    const guias: Record<string, string> = {};
    const verMovimientos = async (actor: any) => {
      const r: any[] = await service.listMovimientos({ numeroGuia: env.marca } as any, actor);
      return r.map((m) => Object.entries(guias).find(([, id]) => id === m.id)?.[0]).sort();
    };

    beforeAll(async () => {
      const crear = async (clave: string, opts: Record<string, unknown>) => {
        guias[clave] = (await env.movimiento({ usuarioDespachaId: ids.admin, ...opts } as never)).id;
      };
      await crear('origenA1', { origenAgenciaId: a1.id });
      await crear('destinoA1', { destinoAgenciaId: a1.id });
      await crear('kitDeLia', { destinoPulidorId: ids.lia });
      await crear('origenBodegaR1', { origenBodegaId: bodR1.id });
      await crear('destinoBodegaR1', { destinoBodegaId: bodR1.id });
      await crear('origenA3', { origenAgenciaId: a3.id });
      await crear('kitDelTecnico', { destinoPulidorId: ids.tecnico });
    });

    it('los administradores ven todo, con tope de 100', async () => {
      expect(await verMovimientos(actores.admin)).toEqual(
        ['destinoA1', 'destinoBodegaR1', 'kitDeLia', 'kitDelTecnico', 'origenA1', 'origenA3', 'origenBodegaR1'],
      );
      const sinFiltro: any[] = await service.listMovimientos({} as any, actores.admin);
      expect(sinFiltro.length).toBeLessThanOrEqual(100);
    });

    it('una agencia ve lo que salió o llegó a ella, y lo que se le despachó a su kit', async () => {
      expect(await verMovimientos(actores.lia)).toEqual(['destinoA1', 'kitDeLia', 'origenA1']);
    });

    it('una región ve lo de sus agencias y bodegas', async () => {
      expect(await verMovimientos(actores.asistenteR1)).toEqual(['destinoA1', 'destinoBodegaR1', 'origenA1', 'origenBodegaR1']);
    });

    it('sin ámbito solo ve lo despachado a su propio kit', async () => {
      expect(await verMovimientos(actores.tecnico)).toEqual(['kitDelTecnico']);
    });
  });

  describe('atenderAlerta', () => {
    it('solo alertas de su alcance: el asistente las de su región, el líder las de su agencia', async () => {
      const insumo = await env.insumo('ALERTA');
      const alerta = (agenciaId: string) =>
        env.prisma.alertaStock.create({ data: { insumoId: insumo.id, agenciaId, usuarioEmisorId: ids.admin, mensaje: 'poco stock' } });
      const enR1 = await alerta(a1.id);
      const enR2 = await alerta(a3.id);

      await expect(service.atenderAlerta({ id: enR1.id, estado: 'RESUELTO' } as any, actores.asistenteR1)).resolves.toBeDefined();
      const resuelta = await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: enR1.id } });
      expect(resuelta.estado).toBe('RESUELTO');
      expect(resuelta.fechaAtencion).not.toBeNull();

      await expect(service.atenderAlerta({ id: enR2.id, estado: 'RESUELTO' } as any, actores.asistenteR1)).rejects.toThrow(/tu región/);
      expect((await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: enR2.id } })).estado).toBe('PENDIENTE'); // sin cambios

      await expect(service.atenderAlerta({ id: enR2.id, estado: 'RESUELTO' } as any, actores.coordBodega)).resolves.toBeDefined();
      await expect(service.atenderAlerta({ id: enR1.id, estado: 'EN_PROCESO' } as any, actores.lara)).rejects.toThrow(/alcance/); // otra agencia
    });
  });

  describe('registrarCompra — convierte a unidad base, igual que un despacho', () => {
    const stockCentral = (insumoId: string) => env.prisma.stockUbicacion.findFirst({ where: { insumoId, tipoUbicacion: 'BODEGA_CENTRAL' } });

    it('una compra de 10 envases (contenidoNeto=4) queda como 40 en unidad base, no como 10', async () => {
      const cera = await env.insumo('CERA-GALON');
      await env.prisma.insumo.update({ where: { id: cera.id }, data: { contenidoNeto: 4 } });

      const m: any = await service.registrarCompra(
        { numeroGuia: `${env.marca}-C1`, proveedorNombre: 'Proveedor X', detalles: [{ insumoId: cera.id, cantidadEnviada: 10, costoUnitarioUSD: 5 }] } as any,
        ids.admin,
      );
      env.rastrear('MovimientoInventario', m.id);

      expect(Number((await stockCentral(cera.id))?.cantidadActual)).toBe(40);
      const kardex = await env.prisma.kardexMovimiento.findFirstOrThrow({ where: { insumoId: cera.id } });
      expect(kardex).toMatchObject({ tipoMovimiento: 'COMPRA_INGRESO' });
      expect([Number(kardex.cantidad), Number(kardex.stockAnterior), Number(kardex.stockPosterior)]).toEqual([40, 0, 40]);
      // El detalle del movimiento (guía) sigue en envases/unidades, como en un despacho.
      const detalle = await env.prisma.movimientoDetalle.findFirstOrThrow({ where: { movimientoId: m.id } });
      expect([Number(detalle.cantidadEnviada), Number(detalle.cantidadRecibida)]).toEqual([10, 10]);
    });

    it('suma sobre stock existente también en unidad base', async () => {
      const cera = await env.insumo('CERA-EXISTENTE');
      await env.prisma.insumo.update({ where: { id: cera.id }, data: { contenidoNeto: 4 } });
      await env.stock({ insumoId: cera.id, tipoUbicacion: 'BODEGA_CENTRAL', cantidad: 8 });

      const m: any = await service.registrarCompra(
        { numeroGuia: `${env.marca}-C2`, proveedorNombre: 'Proveedor X', detalles: [{ insumoId: cera.id, cantidadEnviada: 2 }] } as any,
        ids.admin,
      );
      env.rastrear('MovimientoInventario', m.id);

      // 8 (previo) + 2 envases × 4 = 16
      expect(Number((await stockCentral(cera.id))?.cantidadActual)).toBe(16);
      const kardex = await env.prisma.kardexMovimiento.findFirstOrThrow({ where: { insumoId: cera.id } });
      expect([Number(kardex.stockAnterior), Number(kardex.stockPosterior), Number(kardex.cantidad)]).toEqual([8, 16, 8]);
    });
  });

  describe('crearAlerta — alcance por rol', () => {
    let insumo: any;
    beforeAll(async () => {
      insumo = await env.insumo('ALERTA-CREAR');
    });

    it('el pulidor móvil (sin agencia ni región) crea la alerta de su propio kit, sin Forbidden', async () => {
      const alerta: any = await service.crearAlerta({ insumoId: insumo.id, nivel: 'CRITICO' } as any, actores.movil);
      expect(alerta.pulidorId).toBe(ids.movil);
      expect(alerta.agenciaId).toBeNull();
      expect((await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: alerta.id } })).pulidorId).toBe(ids.movil);
    });

    it('el pulidor fijo liga la alerta a su kit y, de paso, a su agencia', async () => {
      const alerta: any = await service.crearAlerta({ insumoId: insumo.id, nivel: 'BAJO' } as any, actores.paco);
      expect(alerta).toMatchObject({ pulidorId: ids.paco, agenciaId: a1.id });
    });

    it('el líder sigue emitiendo solo para su agencia (sin pulidorId) y no puede mandar otra', async () => {
      const alerta: any = await service.crearAlerta({ insumoId: insumo.id, nivel: 'BAJO', agenciaId: a1.id } as any, actores.lia);
      expect(alerta).toMatchObject({ agenciaId: a1.id, pulidorId: null });

      const antes = await env.prisma.alertaStock.count({ where: { insumoId: insumo.id } });
      await expect(service.crearAlerta({ insumoId: insumo.id, nivel: 'BAJO', agenciaId: a2.id } as any, actores.lia)).rejects.toThrow(/alcance/);
      expect(await env.prisma.alertaStock.count({ where: { insumoId: insumo.id } })).toBe(antes);
    });
  });
});
