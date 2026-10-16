import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListMovimientosGlobalesDto } from './dto/movimiento-operacion.dto.js';
import { ListKardexDto } from './dto/kardex.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): movimientos globales y Kardex.
 *
 * Mundo de la prueba:
 *  Insumos JABON y CERA · tipos de movimiento ENTRADA y CONSUMO · Bodega propia (con su Asistente) · Agencia A1
 *  Movimientos globales g1…g5 (el número es la fecha: g1 es el más antiguo, g5 el más reciente):
 *    g1 ENTRADA  JABON  en la bodega            registró Admin
 *    g2 CONSUMO  CERA   en la agencia A1        registró Admin
 *    g3 ENTRADA  JABON  sin ubicación           registró Coord. Bodega
 *    g4 CONSUMO  JABON  en la bodega central    registró Admin
 *    g5 ENTRADA  CERA   en la bodega            registró Asistente
 *  Kardex k1…k5 con las mismas ubicaciones, tipos y responsables.
 * Todo se consulta con `search: marca`: las tablas reales tienen cientos de movimientos.
 */
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

describe('InventarioService: movimientos globales y Kardex (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let jabon: any;
  let cera: any;
  let entrada: any;
  let consumo: any;
  let bodega: any;
  let a1: any;
  const ids: Record<string, string> = {};
  const g: Record<string, string> = {}; // movimientos globales
  const k: Record<string, string> = {}; // kardex

  const nombresG = (r: any) => (Array.isArray(r) ? r : r.items).map((x: any) => Object.entries(g).find(([, id]) => id === x.id)?.[0]);
  const nombresK = (r: any) => r.items.map((x: any) => Object.entries(k).find(([, id]) => id === x.id)?.[0]);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);

    a1 = await env.agencia('A1');
    bodega = await env.bodega('PROPIA');
    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await crear('admin', 'ADMIN');
    await crear('coord', 'COORD_BODEGA');
    await crear('asistente', 'ASISTENTE_BODEGA', { bodegaId: bodega.id });
    await crear('asistenteSinBodega', 'ASISTENTE_BODEGA');

    jabon = await env.insumo('JABON');
    cera = await env.insumo('CERA');
    const tipo = async (c: string, nombre: string, esEntrada: boolean) => {
      const t = await env.prisma.tipoMovimientoInventario.create({ data: { codigo: `${env.marca}-${c}`, nombre: `${env.marca} ${nombre}`, esEntrada } });
      env.rastrear('TipoMovimientoInventario', t.id);
      return t;
    };
    entrada = await tipo('ENT', 'Entrada', true);
    consumo = await tipo('CON', 'Consumo', false);

    const unidadId = (await env.prisma.insumo.findUniqueOrThrow({ where: { id: jabon.id } })).unidadMedidaId;
    const global = async (clave: string, tipoId: string, insumoId: string, ubicacionId: string | null, responsableId: string, dias: number, stockNuevo: number) => {
      const m = await env.prisma.movimientoInventarioGlobal.create({
        data: {
          numeroComprobante: `${env.marca}-MOV-${clave}`,
          tipoMovimientoId: tipoId,
          insumoId,
          cantidad: 1,
          unidadId,
          cantidadBase: 1,
          stockAnterior: 0,
          stockNuevo,
          ubicacionId,
          responsableId,
          fechaMovimiento: hace(dias),
        },
      });
      g[clave] = m.id;
    };
    await global('g1', entrada.id, jabon.id, bodega.id, ids.admin, 5, 50);
    await global('g2', consumo.id, cera.id, a1.id, ids.admin, 4, 20);
    await global('g3', entrada.id, jabon.id, null, ids.coord, 3, 40);
    await global('g4', consumo.id, jabon.id, 'BODEGA_CENTRAL', ids.admin, 2, 30);
    await global('g5', entrada.id, cera.id, bodega.id, ids.asistente, 1, 10);

    const kardex = async (clave: string, insumoId: string, ubicacionId: string, tipoMovimiento: string, usuarioId: string, dias: number) => {
      const x = await env.prisma.kardexMovimiento.create({
        data: { insumoId, ubicacionId, tipoMovimiento, cantidad: 1, stockAnterior: 0, stockPosterior: 1, usuarioId, fecha: hace(dias) },
      });
      k[clave] = x.id;
    };
    await kardex('k1', jabon.id, bodega.id, 'COMPRA_INGRESO', ids.admin, 5);
    await kardex('k2', cera.id, a1.id, 'CONSUMO_SERVICIO', ids.admin, 4);
    await kardex('k3', jabon.id, bodega.id, 'AJUSTE_MERMA', ids.coord, 3);
    await kardex('k4', jabon.id, 'BODEGA_CENTRAL', 'DESPACHO_SALIDA', ids.admin, 2);
    await kardex('k5', cera.id, bodega.id, 'COMPRA_INGRESO', ids.asistente, 1);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('listMovimientosGlobales (Kardex global)', () => {
    const lista = (dto: Record<string, unknown>, usuarioId?: string) =>
      service.listMovimientosGlobales({ search: env.marca, ...dto } as any, usuarioId);

    it('sin tamaño de página (cliente antiguo) devuelve hasta 100, no 20', async () => {
      const r: any = await lista({});
      expect(r.pageSize).toBe(100);
      expect(r.items).toHaveLength(5);
    });

    it('los DTO ya no fijan page/pageSize/sortField por su cuenta y validan', async () => {
      for (const Clase of [ListMovimientosGlobalesDto, ListKardexDto]) {
        const dto: any = plainToInstance(Clase as any, {});
        expect(dto.pageSize).toBeUndefined();
        expect(dto.page).toBeUndefined();
        expect(dto.sortField).toBeUndefined();
        expect(await validate(dto)).toHaveLength(0);
        const con: any = plainToInstance(Clase as any, { pageSize: 200, page: 2 });
        expect(await validate(con)).toHaveLength(0);
      }
    });

    it('pagina en el servidor y recorta a 100', async () => {
      const r: any = await lista({ page: 2, pageSize: 2 });
      expect(r).toMatchObject({ total: 5, page: 2, pageSize: 2, totalPages: 3, hasNextPage: true });
      expect(r.items).toHaveLength(2);
      expect(((await lista({ pageSize: 200 })) as any).pageSize).toBe(100);
    });

    it('ordena por fecha desc con desempate por id y solo por columnas permitidas', async () => {
      expect(nombresG(await lista({}))).toEqual(['g5', 'g4', 'g3', 'g2', 'g1']); // el más reciente primero
      // Por producto (nombre del insumo): CERA (g2, g5) antes que JABON (g1, g3, g4).
      const porProducto = nombresG(await lista({ sortField: 'producto', sortOrder: 'asc' }));
      expect(porProducto.slice(0, 2).sort()).toEqual(['g2', 'g5']);
      expect(porProducto.slice(2).sort()).toEqual(['g1', 'g3', 'g4']);
      // Por stock nuevo ascendente: g5 (10), g2 (20), g4 (30), g3 (40), g1 (50).
      expect(nombresG(await lista({ sortField: 'stockNuevo', sortOrder: 'asc' }))).toEqual(['g5', 'g2', 'g4', 'g3', 'g1']);
      // Una columna que no está permitida no se usa: queda el orden por defecto.
      expect(nombresG(await lista({ sortField: 'evidenciasUrls; DROP TABLE', sortOrder: 'asc' }))).toEqual(['g5', 'g4', 'g3', 'g2', 'g1']);
    });

    it('busca por palabras en comprobante, insumo, responsable y más', async () => {
      expect(nombresG(await lista({ search: `${env.marca} jabon` })).sort()).toEqual(['g1', 'g3', 'g4']);
      expect(nombresG(await lista({ search: `${env.marca}-MOV-g2` }))).toEqual(['g2']);
      expect(nombresG(await lista({ search: `${env.marca} ${env.marca}asistente` }))).toEqual(['g5']); // por el nombre del responsable
    });

    it('una búsqueda de una sola letra se ignora', async () => {
      await env.reintentar(async () => {
        const sinBusqueda: any = await service.listMovimientosGlobales({ page: 1 } as any);
        const unaLetra: any = await service.listMovimientosGlobales({ page: 1, search: 'a' } as any);
        expect(unaLetra.total).toBe(sinBusqueda.total);
      });
    });

    it('aplica insumo, tipo, ubicación y rango de fechas en el servidor', async () => {
      expect(nombresG(await lista({ insumoId: cera.id })).sort()).toEqual(['g2', 'g5']);
      expect(nombresG(await lista({ tipoMovimientoId: consumo.id })).sort()).toEqual(['g2', 'g4']);
      expect(nombresG(await lista({ ubicacionId: bodega.id })).sort()).toEqual(['g1', 'g5']);
      // Del día -4 al día -2: g2, g3 y g4. Con un "hasta" de solo día, ese día entra completo.
      // `hace()` se evalúa de nuevo aquí, algo después de crear las filas: el margen debe cubrir lo que tarde la prueba (con la máquina
      // cargada pasa de 1 segundo) y seguir dejando fuera las filas vecinas, que están a un día de distancia.
      const desde = hace(4).toISOString();
      const hasta = hace(2).toISOString().slice(0, 10);
      expect(nombresG(await lista({ fechaDesde: new Date(hace(4).getTime() - 10 * 60_000).toISOString(), fechaHasta: hasta })).sort()).toEqual(['g2', 'g3', 'g4']);
      void desde;
    });

    it('una fecha inválida se ignora en vez de romper la consulta', async () => {
      expect(nombresG(await lista({ fechaDesde: 'no-es-fecha' }))).toHaveLength(5);
    });

    it('un rol global no recibe filtro de ubicación', async () => {
      expect(nombresG(await lista({}, ids.admin))).toHaveLength(5);
    });

    it('el coordinador de bodega conserva su alcance por ubicación (y sus propios movimientos)', async () => {
      // Ve la bodega central, lo que no tiene ubicación y lo que él mismo registró: g3 (sin ubicación, suyo) y g4 (central).
      expect(nombresG(await lista({}, ids.coord)).sort()).toEqual(['g3', 'g4']);
      expect(nombresG(await lista({ tipoMovimientoId: entrada.id }, ids.coord))).toEqual(['g3']); // el tipo se combina con el alcance
    });

    it('el asistente de bodega solo ve su bodega y lo que él registró; sin bodega, nada', async () => {
      expect(nombresG(await lista({}, ids.asistente)).sort()).toEqual(['g1', 'g5']);
      expect(nombresG(await lista({}, ids.asistenteSinBodega))).toEqual([]);
    });

    it('el resumen cuenta por tipo con los mismos filtros pero sin el de tipo', async () => {
      const r: any = await lista({ incluirResumen: true, tipoMovimientoId: entrada.id, insumoId: jabon.id });
      expect(nombresG(r).sort()).toEqual(['g1', 'g3']);
      expect(r.resumen).toEqual({ porTipo: { [entrada.id]: 2, [consumo.id]: 1 }, total: 3 }); // el resumen suma todos los tipos del insumo
    });

    it('sin incluirResumen no devuelve el resumen', async () => {
      expect(((await lista({})) as any).resumen).toBeUndefined();
    });
  });

  describe('listKardex (kardex/list)', () => {
    const lista = (dto: Record<string, unknown>, usuarioId?: string) =>
      service.listKardex({ search: env.marca, ...dto } as any, usuarioId);

    it('hasta 100 sin tamaño, recorta a 100 y conserva la forma de respuesta', async () => {
      const r: any = await lista({});
      expect(r).toMatchObject({ total: 5, pageSize: 100 });
      expect(r.items).toBe(r.data);
      expect(((await lista({ pageSize: 200, page: 2 })) as any).pageSize).toBe(100);
    });

    it('orden por fecha desc por defecto; createdAt equivale a fecha; campo malicioso ignorado', async () => {
      expect(nombresK(await lista({}))).toEqual(['k5', 'k4', 'k3', 'k2', 'k1']);
      expect(nombresK(await lista({ sortField: 'createdAt', sortOrder: 'asc' }))).toEqual(['k1', 'k2', 'k3', 'k4', 'k5']);
      const porInsumo = nombresK(await lista({ sortField: 'insumo', sortOrder: 'asc' }));
      expect(porInsumo.slice(0, 2).sort()).toEqual(['k2', 'k5']); // CERA antes que JABON
      expect(nombresK(await lista({ sortField: 'insumoId; x', sortOrder: 'asc' }))).toEqual(['k5', 'k4', 'k3', 'k2', 'k1']);
    });

    it('filtros y búsqueda', async () => {
      expect(nombresK(await lista({ insumoId: jabon.id })).sort()).toEqual(['k1', 'k3', 'k4']);
      expect(nombresK(await lista({ ubicacionId: bodega.id })).sort()).toEqual(['k1', 'k3', 'k5']);
      expect(nombresK(await lista({ tipoMovimiento: 'COMPRA_INGRESO' })).sort()).toEqual(['k1', 'k5']);
      expect(nombresK(await lista({ fechaDesde: hace(3.5).toISOString() })).sort()).toEqual(['k3', 'k4', 'k5']);
      expect(nombresK(await lista({ search: `${env.marca} cera` })).sort()).toEqual(['k2', 'k5']);
      // El total usa los mismos filtros que la página.
      const filtrado: any = await lista({ page: 1, tipoMovimiento: 'COMPRA_INGRESO' });
      expect(filtrado.total).toBe(2);
    });

    it('sin usuario o con un admin: sin restricción de ubicación', async () => {
      expect(nombresK(await lista({}))).toHaveLength(5);
      expect(nombresK(await lista({}, ids.admin))).toHaveLength(5);
    });

    it('el asistente de bodega solo ve el Kardex de su propia bodega y lo que él registró (antes veía todas)', async () => {
      // Su bodega: k1, k3, k5. Y lo que él registró: k5. No ve el de la agencia ni el de la bodega central.
      expect(nombresK(await lista({}, ids.asistente)).sort()).toEqual(['k1', 'k3', 'k5']);
    });

    it('un asistente sin bodega asignada no ve nada del Kardex', async () => {
      expect(nombresK(await lista({}, ids.asistenteSinBodega))).toEqual([]);
    });

    it('expone el nombre de la ubicación además del id (agencia y bodega)', async () => {
      const r: any = await lista({}, ids.admin);
      const deAgencia = r.items.find((x: any) => x.id === k.k2);
      expect(deAgencia.ubicacionId).toBe(a1.id);
      expect(deAgencia.ubicacionNombre).toContain(a1.nombre);
      const deBodega = r.items.find((x: any) => x.id === k.k1);
      expect(deBodega.ubicacionNombre).toContain(bodega.nombre);
    });
  });
});
