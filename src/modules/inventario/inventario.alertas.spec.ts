import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListAlertasDto } from './dto/alertas.dto.js';
import { ListStockBajoDto } from './dto/movimiento-operacion.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Una sola excepción, deliberada: `sincronizarNecesidadesAsignadas` se reemplaza por una función que solo anota que la
 * llamaron. Esa tarea de fondo recorre TODAS las agencias y pulidores reales y escribiría stock en cero y alertas en
 * ellos; lo que importa de ella aquí es CUÁNDO se dispara (roles, ventana de 2 minutos), no lo que escribe.
 *
 * Mundo de la prueba:
 *  Región R1 ── Agencia A1 (Lía LIDER · pulidor Paco) · Agencia A2 · Bodega B-R1 (asistente)
 *  Región R2 ── Agencia A3
 *  Alertas (insumo JABON salvo indicación): al1 A1 CRITICO pendiente · al2 A1 BAJO resuelta (CERA) · al3 A2 AGOTADO en proceso
 *               al4 A3 BAJO pendiente (CERA) · al5 kit de Paco CRITICO pendiente
 */
describe('InventarioService: alertas y stock bajo (base real)', () => {
  let env: Entorno;
  let r1: any;
  let r2: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let jabon: any;
  let cera: any;
  const al: Record<string, string> = {};
  const ids: Record<string, string> = {};

  /** Servicio nuevo (cada uno con su propia ventana de 2 minutos) y la lista de veces que se pidió sincronizar. */
  const servicio = () => {
    const service = new InventarioService(env.prisma as never);
    const sincronizaciones: string[] = [];
    (service as any).sincronizarNecesidadesAsignadas = async (usuarioId: string) => {
      sincronizaciones.push(usuarioId);
    };
    return { service, sincronizaciones };
  };
  const mias = (r: any) => (Array.isArray(r) ? r : r.items).map((a: any) => Object.entries(al).find(([, id]) => id === a.id)?.[0]).filter(Boolean);

  beforeAll(async () => {
    env = await abrirEntorno();
    r1 = await env.region('R1');
    r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { region: `Norte-${env.marca}` } });
    const bodR1 = await env.bodega('R1', { regionId: r1.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await crear('admin', 'ADMIN');
    await crear('coordBodega', 'COORD_BODEGA');
    await crear('lia', 'LIDER', { agenciaId: a1.id });
    await crear('paco', 'PULIDOR', { agenciaId: a1.id });
    await crear('asistente', 'ASISTENTE_BODEGA', { bodegaId: bodR1.id });

    jabon = await env.insumo('JABON');
    cera = await env.insumo('CERA');
    const alerta = async (clave: string, data: Record<string, unknown>) => {
      al[clave] = (await env.prisma.alertaStock.create({ data: { usuarioEmisorId: ids.admin, ...data } as never })).id;
    };
    await alerta('al1', { insumoId: jabon.id, agenciaId: a1.id, nivel: 'CRITICO', estado: 'PENDIENTE', mensaje: 'poco jabon' });
    await alerta('al2', { insumoId: cera.id, agenciaId: a1.id, nivel: 'BAJO', estado: 'RESUELTO' });
    await alerta('al3', { insumoId: jabon.id, agenciaId: a2.id, nivel: 'AGOTADO', estado: 'EN_PROCESO' });
    await alerta('al4', { insumoId: cera.id, agenciaId: a3.id, nivel: 'BAJO', estado: 'PENDIENTE' });
    await alerta('al5', { insumoId: jabon.id, agenciaId: a1.id, pulidorId: ids.paco, nivel: 'CRITICO', estado: 'PENDIENTE', mensaje: 'kit casi vacío' });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('listAlertas — modo heredado (sin página)', () => {
    it('arreglo con tope de 100, el orden de siempre, y sincroniza para roles de varias sedes', async () => {
      const { service, sincronizaciones } = servicio();
      const r = await service.listAlertas({} as any, ids.admin);
      expect(Array.isArray(r)).toBe(true);
      expect((r as any[]).length).toBeLessThanOrEqual(100);
      expect(sincronizaciones).toEqual([ids.admin]);
    });

    it('la sincronización se limita a una vez cada 2 minutos', async () => {
      const { service, sincronizaciones } = servicio();
      await service.listAlertas({} as any, ids.admin);
      await service.listAlertas({} as any, ids.admin);
      await service.listAlertas({} as any, ids.admin);
      expect(sincronizaciones).toHaveLength(1);
    });

    it('un líder solo ve su sede, en el orden de siempre (nivel y luego lo más reciente), y no dispara la sincronización', async () => {
      const { service, sincronizaciones } = servicio();
      const r = await service.listAlertas({ sucursalId: a2.id } as any, ids.lia); // pide otra sede: se ignora
      // De la sede A1: BAJO (al2) primero; luego los CRITICO, el más reciente primero (al5 se creó después que al1).
      expect(mias(r)).toEqual(['al2', 'al5', 'al1']);
      expect(sincronizaciones).toEqual([]);
    });
  });

  describe('listAlertas — modo paginado (no escribe)', () => {
    it('no sincroniza al listar y responde el formato estándar', async () => {
      const { service, sincronizaciones } = servicio();
      const r: any = await service.listAlertas({ page: 1, pageSize: 2, search: env.marca } as any, ids.admin);
      expect(sincronizaciones).toEqual([]);
      expect(r).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3, hasNextPage: true });
      expect(r.items).toHaveLength(2);
      expect(r.resumen).toBeUndefined();
    });

    it('ordena solo por columnas permitidas', async () => {
      const { service } = servicio();
      const r: any = await service.listAlertas({ page: 1, search: env.marca, sortField: 'agencia', sortOrder: 'desc' } as any, ids.admin);
      expect(r.items[0].agencia.nombre).toBe(a3.nombre); // la agencia A3 es la última alfabéticamente
      const hostil: any = await service.listAlertas({ page: 1, search: env.marca, sortField: 'usuarioEmisorId; x' } as any, ids.admin);
      expect(hostil.items).toHaveLength(5); // no falla: cae al orden por defecto
    });

    it('filtros: grupo de nivel (crítico incluye agotado), estado y solo activas; el conteo usa los mismos', async () => {
      const { service } = servicio();
      const critico: any = await service.listAlertas({ page: 1, search: env.marca, grupoNivel: 'CRITICO' } as any, ids.admin);
      expect(mias(critico).sort()).toEqual(['al1', 'al3', 'al5']); // CRITICO y AGOTADO
      expect(critico.total).toBe(3);

      const pendientesActivas: any = await service.listAlertas(
        { page: 1, search: env.marca, grupoNivel: 'CRITICO', estado: 'PENDIENTE', soloActivas: true } as any,
        ids.admin,
      );
      expect(mias(pendientesActivas).sort()).toEqual(['al1', 'al5']);
      expect(pendientesActivas.total).toBe(2);

      const bajo: any = await service.listAlertas({ page: 1, search: env.marca, grupoNivel: 'BAJO' } as any, ids.admin);
      expect(mias(bajo).sort()).toEqual(['al2', 'al4']);
    });

    it('busca por palabras en insumo, sede, región, kit del pulidor y mensaje', async () => {
      const { service } = servicio();
      const porInsumo: any = await service.listAlertas({ page: 1, search: `${env.marca} jabon` } as any, ids.admin);
      expect(mias(porInsumo).sort()).toEqual(['al1', 'al3', 'al5']);
      const porRegion: any = await service.listAlertas({ page: 1, search: `norte-${env.marca}` } as any, ids.admin);
      expect(mias(porRegion).sort()).toEqual(['al1', 'al2', 'al5']); // la región (texto) de A1
      const porMensaje: any = await service.listAlertas({ page: 1, search: `${env.marca} vacío` } as any, ids.admin);
      expect(mias(porMensaje)).toEqual(['al5']);
      const porPulidor: any = await service.listAlertas({ page: 1, search: `${env.marca} ${env.marca}paco` } as any, ids.admin);
      expect(mias(porPulidor)).toEqual(['al5']); // por el nombre del pulidor del kit
    });

    it('el alcance de un asistente sigue aplicándose junto con los filtros', async () => {
      const { service } = servicio();
      const r: any = await service.listAlertas({ page: 1, search: env.marca, grupoNivel: 'BAJO' } as any, ids.asistente);
      // La región R1 incluye A1 y A2 y a Paco; A3 (R2) queda fuera aunque su alerta sea de nivel BAJO.
      expect(mias(r)).toEqual(['al2']);
      const todo: any = await service.listAlertas({ page: 1, search: env.marca } as any, ids.asistente);
      expect(mias(todo).sort()).toEqual(['al1', 'al2', 'al3', 'al5']);
    });

    it('el resumen cuenta activas y críticas con el alcance y la búsqueda, sin filtros de nivel ni de estado', async () => {
      const { service } = servicio();
      const r: any = await service.listAlertas(
        { page: 1, search: env.marca, incluirResumen: true, estado: 'RESUELTO', grupoNivel: 'BAJO' } as any,
        ids.admin,
      );
      expect(mias(r)).toEqual(['al2']); // la página sí respeta los filtros…
      expect(r.resumen).toEqual({ total: 5, resueltas: 1, activas: 4, criticas: 3 }); // …el resumen no
    });
  });

  describe('sincronizarAlertas', () => {
    it('solo lo ejecutan los roles con vista de varias sedes; el líder no', async () => {
      const lider = servicio();
      expect(await lider.service.sincronizarAlertas(ids.lia)).toEqual({ sincronizado: false });
      expect(lider.sincronizaciones).toEqual([]);
      const coord = servicio();
      expect(await coord.service.sincronizarAlertas(ids.coordBodega)).toEqual({ sincronizado: true });
      expect(coord.sincronizaciones).toEqual([ids.coordBodega]);
    });

    it('respeta el límite de 2 minutos salvo con forzar', async () => {
      const { service, sincronizaciones } = servicio();
      expect((await service.sincronizarAlertas(ids.admin)).sincronizado).toBe(true);
      expect((await service.sincronizarAlertas(ids.admin)).sincronizado).toBe(false);
      expect((await service.sincronizarAlertas(ids.admin, true)).sincronizado).toBe(true);
      expect(sincronizaciones).toHaveLength(2);
    });
  });

  describe('listStockBajo (SQL)', () => {
    let service: InventarioService;
    let tipo: any;
    let bajo1: any;
    let bajo2: any;
    let muyBajo: any;
    let normal: any;

    beforeAll(async () => {
      service = servicio().service;
      tipo = await env.tipoProducto('SB');
      const insumo = async (s: string, stock: number, minimo: number, opts: Record<string, unknown> = {}) => {
        const i = await env.insumo(s, { tipoProductoId: tipo.id, ...opts });
        await env.prisma.insumo.update({ where: { id: i.id }, data: { stockActual: stock, stockMinimoBodega: minimo } });
        return i;
      };
      bajo1 = await insumo('SB-JABON', 1, 10); // déficit 9
      bajo2 = await insumo('SB-CERA', 3, 10); // déficit 7
      muyBajo = await insumo('SB-ESPUMA', 2, 20); // déficit 18
      normal = await insumo('SB-NORMAL', 50, 10); // no está bajo
      await insumo('SB-VIEJO', 0, 10, { estado: 0 }); // inactivo: no cuenta
    });

    const idsDe = (r: any) => r.items.map((i: any) => i.id);

    it('filtra y cuenta en la base de datos y devuelve la página en el orden del SQL', async () => {
      const r: any = await service.listStockBajo({ page: 1, pageSize: 2, search: env.marca, tipoProductoId: tipo.id } as any);
      // Más bajo primero (stockActual ascendente): bajo1 (1), muyBajo (2), bajo2 (3)…
      expect(r).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
      expect(idsDe(r)).toEqual([bajo1.id, muyBajo.id]);
      const p2: any = await service.listStockBajo({ page: 2, pageSize: 2, search: env.marca, tipoProductoId: tipo.id } as any);
      expect(idsDe(p2)).toEqual([bajo2.id]);
      expect([...idsDe(r), ...idsDe(p2)]).not.toContain(normal.id);
    });

    it('sin página devuelve la primera de 100 (antes 20) y el mismo formato', async () => {
      const r: any = await service.listStockBajo({ search: env.marca, tipoProductoId: tipo.id } as any);
      expect(r).toMatchObject({ page: 1, pageSize: 100, total: 3 });
      expect(Array.isArray(r.items)).toBe(true);
    });

    it('ordena solo por columnas permitidas y enlaza tipo y búsqueda como parámetros', async () => {
      const porDeficit: any = await service.listStockBajo({ page: 1, search: env.marca, sortField: 'deficit', sortOrder: 'desc', tipoProductoId: tipo.id } as any);
      expect(idsDe(porDeficit)).toEqual([muyBajo.id, bajo1.id, bajo2.id]); // déficit 18, 9 y 7
      const palabras: any = await service.listStockBajo({ page: 1, search: `${env.marca} jabon cera`, tipoProductoId: tipo.id } as any);
      expect(palabras.total).toBe(0); // "jabon" Y "cera" no están en el mismo insumo
      const unaPalabra: any = await service.listStockBajo({ page: 1, search: `${env.marca} jabon`, tipoProductoId: tipo.id } as any);
      expect(idsDe(unaPalabra)).toEqual([bajo1.id]);
      // Una columna ajena o un intento de inyección no rompe nada ni se ejecuta.
      const hostil: any = await service.listStockBajo({ page: 1, search: env.marca, tipoProductoId: tipo.id, sortField: 'nombre; DROP TABLE "Insumo"' } as any);
      expect(idsDe(hostil)).toEqual([bajo1.id, muyBajo.id, bajo2.id]);
      expect(await env.prisma.insumo.count({ where: { id: bajo1.id } })).toBe(1);
    });

    it('una página sin resultados devuelve vacío', async () => {
      const r: any = await service.listStockBajo({ page: 1, search: `${env.marca} zzqq`, tipoProductoId: tipo.id } as any);
      expect(r).toMatchObject({ total: 0, items: [] });
    });
  });

  describe('DTO de alertas y stock bajo', () => {
    it('no fijan page/pageSize y validan los nuevos campos', async () => {
      for (const Clase of [ListAlertasDto, ListStockBajoDto]) {
        const vacio: any = plainToInstance(Clase as any, {});
        expect(vacio.page).toBeUndefined();
        expect(vacio.pageSize).toBeUndefined();
        expect(await validate(vacio)).toHaveLength(0);
      }
      expect(await validate(plainToInstance(ListAlertasDto, { page: 1, grupoNivel: 'CRITICO', soloActivas: true, agenciaId: 'a', incluirResumen: true }))).toHaveLength(0);
      expect((await validate(plainToInstance(ListAlertasDto, { grupoNivel: 'otro' }))).length).toBeGreaterThan(0);
    });
  });

  describe('alertas resueltas al recibir un despacho', () => {
    /** Una agencia con su insumo en stock y una alerta abierta; devuelve cómo "recibir" cantidad en ella. */
    async function recepcion(stockPrevio: number, mensaje: string | null = 'Me falta shampoo') {
      const insumo = await env.insumo(`REC-${Math.random().toString(36).slice(2, 6)}`);
      const agencia = await env.agencia(`REC-${Math.random().toString(36).slice(2, 6)}`, { regionId: r1.id });
      await env.stock({ insumoId: insumo.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia.id, cantidad: stockPrevio });
      const alerta = await env.prisma.alertaStock.create({
        data: { insumoId: insumo.id, agenciaId: agencia.id, usuarioEmisorId: ids.admin, mensaje, estado: 'PENDIENTE' },
      });
      const { service } = servicio();
      const sumar = (destino: Record<string, string>, cantidad: number) =>
        (service as any).sumarStockDestino({ insumoId: insumo.id, cantidad, guia: 'G-1', usuarioId: ids.admin, ...destino });
      return { insumo, agencia, alerta, sumar };
    }

    it('la agencia: resuelve sus alertas abiertas con fecha y nota, sin tocar las del kit de un pulidor', async () => {
      const { insumo, agencia, alerta, sumar } = await recepcion(1);
      // Una alerta del kit de un pulidor del mismo insumo y agencia: no debe resolverse.
      const delKit = await env.prisma.alertaStock.create({
        data: { insumoId: insumo.id, agenciaId: agencia.id, pulidorId: ids.paco, usuarioEmisorId: ids.admin, estado: 'PENDIENTE' },
      });

      await sumar({ destinoAgenciaId: agencia.id }, 5);

      const resuelta = await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: alerta.id } });
      expect(resuelta.estado).toBe('RESUELTO');
      expect(resuelta.fechaAtencion).toBeInstanceOf(Date);
      expect(resuelta.mensaje).toBe('Me falta shampoo | Reabastecido mediante despacho guía G-1. Stock actual: 6');
      expect((await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: delKit.id } })).estado).toBe('PENDIENTE');
    });

    it('también resuelve las que ya iban DESPACHADO', async () => {
      const { alerta, sumar } = await recepcion(1);
      await env.prisma.alertaStock.update({ where: { id: alerta.id }, data: { estado: 'DESPACHADO' } });
      await sumar({ destinoAgenciaId: (await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: alerta.id } })).agenciaId! }, 5);
      expect((await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: alerta.id } })).estado).toBe('RESUELTO');
    });

    it('el pulidor: busca por su kit (pulidorId), no por quién emitió la alerta', async () => {
      const insumo = await env.insumo(`KIT-${Math.random().toString(36).slice(2, 6)}`);
      await env.stock({ insumoId: insumo.id, tipoUbicacion: 'PULIDOR_FIJO', pulidorId: ids.paco, cantidad: 0 });
      const alerta = await env.prisma.alertaStock.create({
        data: { insumoId: insumo.id, pulidorId: ids.paco, usuarioEmisorId: ids.admin, mensaje: null, estado: 'PENDIENTE' },
      });
      const { service } = servicio();
      await (service as any).sumarStockDestino({ insumoId: insumo.id, cantidad: 3, guia: 'G-1', usuarioId: ids.admin, destinoPulidorId: ids.paco });
      const resuelta = await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: alerta.id } });
      expect(resuelta.estado).toBe('RESUELTO');
      expect(resuelta.mensaje).toBe('Reabastecido mediante despacho guía G-1. Stock actual: 3');
    });

    it('si el stock sigue en el mínimo o por debajo, la alerta queda abierta', async () => {
      const { alerta, agencia, sumar } = await recepcion(0);
      await sumar({ destinoAgenciaId: agencia.id }, 2); // 0 + 2 = 2, y el mínimo de agencia es 2: sigue sin superarlo
      const sigue = await env.prisma.alertaStock.findUniqueOrThrow({ where: { id: alerta.id } });
      expect(sigue.estado).toBe('PENDIENTE');
      expect(sigue.fechaAtencion).toBeNull();
    });
  });
});
