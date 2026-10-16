import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { StockResumenAgenciasDto, StockResumenBodegasDto, StockResumenPulidoresDto } from './dto/stock-resumen.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): los resúmenes de stock por agencia, por kit de pulidor y por bodega.
 *
 * Mundo de la prueba, todo creado aquí:
 *  Insumos I1 "Jabón neutro" · I2 "Cera líquida" · I3 "Pulidor abrasivo" · I4 "Ácido cítrico"  (mínimo agencia 2)
 *  Región R1 ── Agencia UNO (región "Norte", servicio S1 con I1+I2) · DOS ("Norte", S1) · TRES ("Sur", servicio S3 con I4)
 *               Stock en agencias: UNO I1=0 sin stock, I2=10 · DOS I1=3, I2=1 crítico · TRES I4=5
 *               Kits: Ana (pulidora fija en UNO) I3=0, I4=9 · Beto (pulidor móvil de R1) I3=8
 *               (S2 es un servicio ESPECIAL con la receta de I3: por eso I3 pertenece a los kits)
 *  Región R2 ── Agencia CUATRO (para comprobar que el alcance regional la deja fuera)
 *  Región RB ── Agencia BODEGUERA (servicio SB con I1…I4) y la Bodega B propia: I1=0 · I2=8 · I3=11 · I4=50 (mín. 10, óptimo 30)
 * Los resúmenes por agencia y por kit se piden con un usuario de la región R1, así solo se ve este mundo.
 * Los kits también incluyen los insumos de servicios especiales REALES de la base (en cero): por eso en los kits solo se
 * comprueban los insumos propios y no los totales de la red.
 */
describe('resúmenes de stock (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let r1: any;
  let ag: Record<string, any>;
  let bodegaB: any;
  let regionRB: any;
  let insumos: any[];
  const ids: Record<string, string> = {};

  const idAg = (r: any) => r.items.map((a: any) => a.agencia.id);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);

    r1 = await env.region('R1');
    const r2 = await env.region('R2');
    regionRB = await env.region('RB');
    const bodegaR1 = await env.bodega('R1', { regionId: r1.id });
    bodegaB = await env.bodega('B', { regionId: regionRB.id });

    // Insumos (nombres reales de dominio; el SKU y el nombre llevan la marca para poder buscarlos).
    const nuevo = async (n: number, nombre: string) => {
      const i = await env.insumo(`I${n}`);
      await env.prisma.insumo.update({ where: { id: i.id }, data: { nombre: `${env.marca} ${nombre}`, stockMinimoBodega: 10, stockOptimoBodega: 30 } });
      return { ...i, nombre: `${env.marca} ${nombre}` };
    };
    insumos = [await nuevo(1, 'Jabón neutro'), await nuevo(2, 'Cera líquida'), await nuevo(3, 'Pulidor abrasivo'), await nuevo(4, 'Ácido cítrico')];
    const [i1, i2, i3, i4] = insumos;
    const unidadId = (await env.prisma.insumo.findUniqueOrThrow({ where: { id: i1.id } })).unidadMedidaId;
    const receta = (catalogoServicioId: number, insumoId: string) =>
      env.prisma.recetaInsumo.create({ data: { catalogoServicioId, insumoId, cantidadUsada: 1, unidadConsumoId: unidadId } });

    const s1 = await env.catalogo('S1');
    const s2 = await env.catalogo('S2', { categoria: 'ESPECIAL' });
    const s3 = await env.catalogo('S3');
    const sB = await env.catalogo('SB');
    await receta(s1.id, i1.id);
    await receta(s1.id, i2.id);
    await receta(s2.id, i3.id);
    await receta(s3.id, i4.id);
    for (const i of insumos) await receta(sB.id, i.id);

    const agencia = async (clave: string, regionId: string, texto: string, servicioIds: number[]) => {
      const a = await env.agencia(clave, { regionId });
      await env.prisma.agencia.update({ where: { id: a.id }, data: { region: texto, servicioIds, tieneServiciosEspeciales: false } });
      return a;
    };
    ag = {
      uno: await agencia('UNO', r1.id, `Norte-${env.marca}`, [s1.id]),
      dos: await agencia('DOS', r1.id, `Norte-${env.marca}`, [s1.id]),
      tres: await agencia('TRES', r1.id, `Sur-${env.marca}`, [s3.id]),
      cuatro: await agencia('CUATRO', r2.id, `Sur-${env.marca}`, []),
      bodeguera: await agencia('BODEGUERA', regionRB.id, `Centro-${env.marca}`, [sB.id]),
    };

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await crear('coordMant', 'COORD_MANTENIMIENTO', { regionId: r1.id });
    await crear('asistenteR1', 'ASISTENTE_BODEGA', { bodegaId: bodegaR1.id });
    await crear('lider', 'LIDER', { agenciaId: ag.uno.id, regionId: r1.id });
    await crear('asistenteB', 'ASISTENTE_BODEGA', { bodegaId: bodegaB.id });
    await crear('ana', 'PULIDOR', { agenciaId: ag.uno.id, name: 'Ana', lastname: 'Paz' });
    await crear('beto', 'PULIDOR', { regionId: r1.id, name: 'Beto', lastname: 'Ruiz' });

    const stockAg = (a: any, i: any, cantidad: number) => env.stock({ insumoId: i.id, tipoUbicacion: 'AGENCIA', agenciaId: a.id, cantidad });
    await stockAg(ag.uno, i1, 0);
    await stockAg(ag.uno, i2, 10);
    await stockAg(ag.dos, i1, 3);
    await stockAg(ag.dos, i2, 1);
    await stockAg(ag.tres, i4, 5);
    const stockKit = (pulidor: string, tipo: 'PULIDOR_FIJO' | 'PULIDOR_MOVIL', i: any, cantidad: number) =>
      env.stock({ insumoId: i.id, tipoUbicacion: tipo, pulidorId: ids[pulidor], cantidad });
    await stockKit('ana', 'PULIDOR_FIJO', i3, 0);
    await stockKit('ana', 'PULIDOR_FIJO', i4, 9);
    await stockKit('beto', 'PULIDOR_MOVIL', i3, 8);
    for (const [i, cantidad] of [[i1, 0], [i2, 8], [i3, 11], [i4, 50]] as const) {
      await env.stock({ insumoId: i.id, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: bodegaB.id, cantidad });
    }
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('obtenerStockAgenciasResumen', () => {
    const resumen = (dto: Record<string, unknown>, usuario = 'coordMant') =>
      service.obtenerStockAgenciasResumen(dto as any, ids[usuario]) as Promise<any>;

    it('modo heredado: la respuesta de siempre, con todos los insumos de cada ficha', async () => {
      const r = await resumen({});
      expect(r).toMatchObject({ totalAgencias: 3, agenciasEnAlerta: 2, insumosCriticosTotal: 2 });
      expect(r.agencias).toHaveLength(3);
      const uno = r.agencias.find((a: any) => a.agencia.id === ag.uno.id);
      expect(uno).toMatchObject({ totalInsumos: 2, insumosCriticos: 1, tieneAlerta: true });
      expect(uno.insumos.map((i: any) => i.estado).sort()).toEqual(['Sin Stock', 'Óptimo']);
    });

    it('modo heredado por agencia (lo que usa la app móvil): una ficha con sus insumos', async () => {
      const r = await resumen({ agenciaId: ag.dos.id });
      expect(r.agencias).toHaveLength(1);
      expect(r.agencias[0].insumos).toHaveLength(2);
    });

    it('paginado sin agenciaId: fichas sin insumos, métricas de toda la zona y formato estándar', async () => {
      const r = await resumen({ page: 1, pageSize: 2 });
      expect(r).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
      expect(r.metricas).toEqual({ totalAgencias: 3, agenciasEnAlerta: 2, insumosCriticosTotal: 2 });
      expect(r.items.map((a: any) => a.agencia.nombre)).toEqual([ag.dos.nombre, ag.tres.nombre]); // alfabético: DOS, TRES, UNO
      expect(r.items[0]).not.toHaveProperty('insumos');
      expect(r.items[0]).toMatchObject({ totalInsumos: 2, insumosCriticos: 1, tieneAlerta: true });
    });

    it('filtra por estado de la sede y busca por sede, región o insumo', async () => {
      expect(idAg(await resumen({ page: 1, estadoUbicacion: 'alerta' }))).toEqual([ag.dos.id, ag.uno.id]); // alfabético por nombre
      expect(idAg(await resumen({ page: 1, estadoUbicacion: 'optimo' }))).toEqual([ag.tres.id]);
      expect(idAg(await resumen({ page: 1, search: `${env.marca} acido` }))).toEqual([ag.tres.id]); // sin tildes
      expect(((await resumen({ page: 1, search: `norte-${env.marca}` })) as any).total).toBe(2);
      expect(((await resumen({ page: 1, search: 'a' })) as any).total).toBe(3); // una letra se ignora
    });

    it('ordena solo por columnas permitidas', async () => {
      const porCriticos = idAg(await resumen({ page: 1, sortField: 'criticos', sortOrder: 'desc' }));
      expect(porCriticos.slice(0, 2).sort()).toEqual([ag.dos.id, ag.uno.id].sort()); // 1 y 1 críticos (el empate lo decide el id)
      expect(porCriticos[2]).toBe(ag.tres.id); // 0 críticos
      // Una columna que no está en la lista se ignora y se usa el orden por defecto (nombre ascendente).
      expect(idAg(await resumen({ page: 1, sortField: 'agencia.password', sortOrder: 'desc' }))).toEqual([ag.dos.id, ag.tres.id, ag.uno.id]);
    });

    it('paginado con agenciaId: la ficha y una página de SUS insumos, con búsqueda, estado y orden', async () => {
      const r = await resumen({ page: 1, pageSize: 1, agenciaId: ag.uno.id, sortField: 'estado', sortOrder: 'asc' });
      expect(r.agencia).toMatchObject({ agencia: { id: ag.uno.id }, totalInsumos: 2, tieneAlerta: true });
      expect(r.agencia).not.toHaveProperty('insumos');
      expect(r).toMatchObject({ total: 2, totalPages: 2, hasNextPage: true });
      expect(r.items[0]).toMatchObject({ insumoId: insumos[0].id, estado: 'Sin Stock' }); // el más grave primero
      const filtrado = await resumen({ page: 1, agenciaId: ag.uno.id, estado: 'optimo' });
      expect(filtrado.items.map((i: any) => i.insumoId)).toEqual([insumos[1].id]);
      const buscado = await resumen({ page: 1, agenciaId: ag.uno.id, search: 'jabon' });
      expect(buscado.items.map((i: any) => i.insumoId)).toEqual([insumos[0].id]);
    });

    it('una agencia fuera del alcance devuelve una página vacía, sin ficha', async () => {
      const r = await resumen({ page: 1, agenciaId: ag.cuatro.id }); // existe, pero está en otra región
      expect(r).toMatchObject({ total: 0, items: [], agencia: null });
    });

    it('el asistente de bodega sigue limitado a su región', async () => {
      const r = await resumen({ page: 1 }, 'asistenteR1');
      expect(idAg(r).sort()).toEqual([ag.dos.id, ag.tres.id, ag.uno.id].sort());
      expect(idAg(r)).not.toContain(ag.cuatro.id);
    });

    it('el coordinador de mantenimiento ve agencias de su región y los filtros del cliente solo pueden reducirla', async () => {
      expect(((await resumen({ page: 1, agenciaId: ag.cuatro.id })) as any).total).toBe(0); // pide una de otra región: nada
      expect(idAg(await resumen({ page: 1, region: `Sur-${env.marca}` }))).toEqual([ag.tres.id]); // filtra dentro de la suya (CUATRO también es "Sur", pero no es de su región)
    });

    it('el líder queda acotado a las agencias de su región (para poder despachar), no a toda la red', async () => {
      const r = await resumen({ page: 1 }, 'lider');
      expect(idAg(r).sort()).toEqual([ag.dos.id, ag.tres.id, ag.uno.id].sort());
    });
  });

  describe('obtenerStockPulidoresResumen', () => {
    const resumen = (dto: Record<string, unknown>, usuario = 'coordMant') =>
      service.obtenerStockPulidoresResumen(dto as any, ids[usuario]) as Promise<any>;
    const idsDe = (r: any) => r.items.map((p: any) => p.id);
    const mios = (ficha: any) => ficha.insumos.filter((i: any) => i.codigoSKU.startsWith(env.marca));

    it('modo heredado: kits con todos sus insumos', async () => {
      const r = await resumen({});
      expect(r.totalPulidores).toBe(2);
      const ana = r.pulidores.find((p: any) => p.id === ids.ana);
      expect(ana.insumos.length).toBeGreaterThan(0);
      // Los insumos propios de Ana: I3 (de la receta especial) sin stock e I4 con 9.
      expect(Object.fromEntries(mios(ana).map((i: any) => [i.insumoId, i.estado]))).toEqual({ [insumos[2].id]: 'Sin Stock', [insumos[3].id]: 'Óptimo' });
    });

    it('paginado: fichas sin insumos, con filtro por tipo y por estado', async () => {
      const r = await resumen({ page: 1, pageSize: 10 });
      expect(r).toMatchObject({ total: 2, page: 1 });
      expect(r.metricas.totalPulidores).toBe(2);
      expect(r.items[0]).not.toHaveProperty('insumos');
      expect(idsDe(await resumen({ page: 1, tipoPulidor: 'PULIDOR_MOVIL' }))).toEqual([ids.beto]);
      expect(idsDe(await resumen({ page: 1, tipoPulidor: 'PULIDOR_FIJO' }))).toEqual([ids.ana]);
      expect(idsDe(await resumen({ page: 1, estadoUbicacion: 'alerta' }))).toContain(ids.ana); // I3 en cero
      expect(idsDe(await resumen({ page: 1, search: 'ruiz' }))).toEqual([ids.beto]);
    });

    it('con pulidorId: la ficha y una página de los insumos de su kit', async () => {
      const r = await resumen({ page: 1, pulidorId: ids.ana, sortField: 'stock', sortOrder: 'asc' });
      expect(r.pulidor).toMatchObject({ id: ids.ana, tipoPulidor: 'PULIDOR_FIJO' });
      const stocks = r.items.map((i: any) => i.stockActual);
      expect(stocks).toEqual([...stocks].sort((a, b) => a - b));
      expect(r.total).toBe(r.items.length);
    });

    it('un pulidor solo ve su propio kit', async () => {
      const r = await resumen({ page: 1 }, 'beto');
      expect(idsDe(r)).toEqual([ids.beto]);
    });

    it('el coordinador de mantenimiento ve kits de su región sin poder sustituirla desde los filtros', async () => {
      expect((await resumen({ page: 1, regionId: 'region-ajena' })).total).toBe(0);
      expect((await resumen({ page: 1, pulidorId: '00000000-0000-4000-8000-000000000000' })).pulidor).toBeNull();
    });

    it('mantiene el alcance regional del asistente obtenido desde su bodega', async () => {
      const r = await resumen({ page: 1 }, 'asistenteR1');
      expect(idsDe(r).sort()).toEqual([ids.ana, ids.beto].sort());
    });
  });

  describe('obtenerStockBodegasResumen', () => {
    const resumen = (dto: Record<string, unknown>) => service.obtenerStockBodegasResumen(dto as any, ids.asistenteB) as Promise<any>;
    const idsDe = (r: any) => r.items.map((i: any) => i.insumoId);

    it('modo heredado: todos los insumos y las métricas de siempre', async () => {
      const r = await resumen({});
      expect(r.bodega.id).toBe(bodegaB.id); // un asistente solo ve la bodega asignada
      // Entre los insumos de esta bodega regional solo alertan los que usan los servicios de la región: los 4 propios.
      expect(r.metricas).toMatchObject({ insumosBajoMinimo: 3, insumosOptimos: 1 });
      await env.reintentar(async () => {
        const activos = await env.prisma.insumo.count({ where: { estado: 1 } });
        const r2 = await resumen({});
        expect(r2.metricas.totalInsumos).toBe(activos);
        expect(r2.metricas.insumosNoNecesarios).toBe(activos - 4);
      });
      const propios = r.insumos.filter((i: any) => i.codigoSKU.startsWith(env.marca));
      expect(Object.fromEntries(propios.map((i: any) => [i.insumoId, i.estado]))).toEqual({
        [insumos[0].id]: 'Agotado', // 0
        [insumos[1].id]: 'Crítico', // 8, hasta el mínimo (10)
        [insumos[2].id]: 'Bajo', // 11, hasta el umbral de alerta (10 + 20 % = 12)
        [insumos[3].id]: 'Óptimo', // 50
      });
    });

    it('paginado: página con búsqueda, estado y orden; las métricas cuentan todos los insumos', async () => {
      const r = await resumen({ page: 1, pageSize: 2, search: env.marca, sortField: 'estado', sortOrder: 'asc' });
      expect(r).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
      expect(r.insumos).toBe(r.items);
      expect(r.items.map((i: any) => i.estado)).toEqual(['Agotado', 'Crítico']);
      expect(r.metricas.insumosBajoMinimo).toBe(3); // las métricas no dependen de la página ni del filtro

      expect(idsDe(await resumen({ page: 1, search: env.marca, estado: 'critico' }))).toEqual([insumos[1].id]);
      expect(idsDe(await resumen({ page: 1, search: `${env.marca} acido` }))).toEqual([insumos[3].id]);
      expect(idsDe(await resumen({ page: 1, search: env.marca, sortField: 'stock', sortOrder: 'desc' }))).toEqual(
        [insumos[3].id, insumos[2].id, insumos[1].id, insumos[0].id], // 50, 11, 8 y 0
      );
    });
  });

  describe('DTO de los resúmenes', () => {
    it('no fijan page/pageSize y conservan los filtros que antes pasaban sin declarar', async () => {
      for (const Clase of [StockResumenAgenciasDto, StockResumenPulidoresDto, StockResumenBodegasDto]) {
        const vacio: any = plainToInstance(Clase as any, {});
        expect(vacio.page).toBeUndefined();
        expect(await validate(vacio)).toHaveLength(0);
      }
      const ag2: any = plainToInstance(StockResumenAgenciasDto, { agenciaId: 'a', region: 'Norte', page: '1', estadoUbicacion: 'alerta' });
      expect(await validate(ag2)).toHaveLength(0);
      expect(ag2).toMatchObject({ agenciaId: 'a', region: 'Norte', page: 1 });
      expect((await validate(plainToInstance(StockResumenAgenciasDto, { estadoUbicacion: 'raro' }))).length).toBeGreaterThan(0);
      expect((await validate(plainToInstance(StockResumenPulidoresDto, { tipoPulidor: 'otro' }))).length).toBeGreaterThan(0);
      expect(plainToInstance(StockResumenPulidoresDto, { pulidorId: 'p', regionId: 'r' })).toMatchObject({ pulidorId: 'p', regionId: 'r' });
      expect(plainToInstance(StockResumenBodegasDto, { bodegaId: 'b' })).toMatchObject({ bodegaId: 'b' });
    });
  });

  describe('insumos requeridos por servicios (agencia y kit de pulidor)', () => {
    // Datos ya calculados: se prueba solo la paginación en memoria, que no consulta la base.
    const insumosCalculados = [
      { id: 'i1', codigoSKU: 'SKU-1', nombre: 'Jabón', tipoProducto: 'Líquido', estado: 'AGOTADO', stockActual: 0, stockMinimo: 2, serviciosEstimados: 0, serviciosAsociados: [{ nombre: 'Lavado básico' }] },
      { id: 'i2', codigoSKU: 'SKU-2', nombre: 'Cera', tipoProducto: 'Líquido', estado: 'OPTIMO', stockActual: 30, stockMinimo: 2, serviciosEstimados: 12, serviciosAsociados: [{ nombre: 'Encerado' }, { nombre: 'Lavado básico' }] },
      { id: 'i3', codigoSKU: 'SKU-3', nombre: 'Ácido', tipoProducto: 'Químico', estado: 'BAJO', stockActual: 2, stockMinimo: 2, serviciosEstimados: 1, serviciosAsociados: [{ nombre: 'Pulido' }] },
      { id: 'i4', codigoSKU: 'SKU-4', nombre: 'Guantes', tipoProducto: 'Consumible', estado: 'NO_NECESARIO', stockActual: 5, stockMinimo: 1, serviciosEstimados: 0, serviciosAsociados: [] },
    ];
    const base = { agencia: { id: 'a1' }, resumen: { totalInsumosEnSede: 4, insumosAgotados: 1 }, insumos: insumosCalculados };
    const paginar = (dto: any) => (service as any).paginarInsumosServicios(base, dto);

    it('modo heredado: la respuesta de siempre (con el tope de 100)', () => {
      const r = paginar(undefined);
      expect(r.insumos).toHaveLength(4);
      expect(r.resumen).toBe(base.resumen);
      expect(paginar({})).toMatchObject({ insumos: insumosCalculados });
    });

    it('paginado: el resumen cuenta todos los insumos y la página trae solo una parte', () => {
      const r = paginar({ page: 1, pageSize: 2 });
      expect(r.resumen).toBe(base.resumen);
      expect(r).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
      expect(r.insumos.map((i: any) => i.id)).toEqual(['i3', 'i2']); // por nombre: Ácido, Cera
      expect(r.items).toBe(r.insumos);
    });

    it('filtra por estado, busca (también por servicio) y ordena por gravedad', () => {
      expect(paginar({ page: 1, estado: 'agotado' }).insumos.map((i: any) => i.id)).toEqual(['i1']);
      expect(paginar({ page: 1, search: 'encerado' }).insumos.map((i: any) => i.id)).toEqual(['i2']);
      expect(paginar({ page: 1, search: 'lavado basico' }).insumos.map((i: any) => i.id)).toEqual(['i2', 'i1']);
      expect(paginar({ page: 1, sortField: 'estado', sortOrder: 'asc' }).insumos.map((i: any) => i.id)).toEqual(['i1', 'i3', 'i2', 'i4']);
      expect(paginar({ page: 1, sortField: 'capacidad', sortOrder: 'desc' }).insumos[0].id).toBe('i2');
      expect(paginar({ page: 1, sortField: 'servicios', sortOrder: 'desc' }).insumos[0].id).toBe('i2');
      expect(paginar({ page: 1, sortField: 'stockActual; DROP', sortOrder: 'desc' }).insumos.map((i: any) => i.id)).toEqual(['i3', 'i2', 'i4', 'i1']);
    });

    it('obtenerInsumosServiciosAgencia entrega la página y conserva el resumen completo', async () => {
      // Una agencia propia con un servicio cuyas recetas usan I1, I2 y I3, cada uno con su stock y mínimo (2) en la sede.
      const regionSede = await env.region('SEDE-SERVICIOS'); // región propia: no cuenta como agencia más de R1
      const sede = await env.agencia('SEDE-SERVICIOS', { regionId: regionSede.id });
      const servicio = await env.catalogo('SERV-SEDE');
      const unidadId = (await env.prisma.insumo.findUniqueOrThrow({ where: { id: insumos[0].id } })).unidadMedidaId;
      for (const i of insumos.slice(0, 3)) {
        await env.prisma.recetaInsumo.create({ data: { catalogoServicioId: servicio.id, insumoId: i.id, cantidadUsada: 1, unidadConsumoId: unidadId } });
      }
      await env.prisma.agencia.update({ where: { id: sede.id }, data: { servicioIds: [servicio.id] } });
      for (const [i, cantidad] of [[insumos[0], 0], [insumos[1], 30], [insumos[2], 1]] as const) {
        await env.stock({ insumoId: i.id, tipoUbicacion: 'AGENCIA', agenciaId: sede.id, cantidad, minima: 2 });
      }

      const r: any = await service.obtenerInsumosServiciosAgencia(sede.id, undefined, { page: 1, pageSize: 2, sortField: 'estado', sortOrder: 'asc' } as any);
      expect(r.resumen).toMatchObject({ totalInsumosEnSede: 3, insumosAgotados: 1, insumosBajoMinimo: 1, insumosOptimos: 1 });
      expect(r).toMatchObject({ total: 3, totalPages: 2 });
      expect(r.insumos.map((i: any) => i.estado)).toEqual(['AGOTADO', 'BAJO']);
      const heredado: any = await service.obtenerInsumosServiciosAgencia(sede.id);
      expect(heredado.insumos).toHaveLength(3);
      expect(heredado.total).toBeUndefined();
    });

    it('el DTO conserva servicioIds y filtros, y no fija page/pageSize', async () => {
      const { InsumosServiciosDto } = await import('./dto/stock-resumen.dto.js');
      const dto: any = plainToInstance(InsumosServiciosDto, { agenciaId: 'a', servicioIds: [1, 2], estado: 'BAJO', page: '2' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toMatchObject({ agenciaId: 'a', servicioIds: [1, 2], estado: 'BAJO', page: 2 });
      expect(plainToInstance(InsumosServiciosDto, {}).page).toBeUndefined();
    });
  });

  describe('obtenerStockAgenciasResumen — otras agencias (líder)', () => {
    const resumen = (dto: Record<string, unknown>) => service.obtenerStockAgenciasResumen(dto as any, ids.coordMant) as Promise<any>;

    it('excluye la agencia propia de las fichas, pero no de las métricas', async () => {
      const r = await resumen({ page: 1, excluirAgenciaId: ag.uno.id });
      expect(idAg(r)).toEqual([ag.dos.id, ag.tres.id]);
      expect(r.total).toBe(2);
      expect(r.metricas.totalAgencias).toBe(3);
    });

    it('si la propia es la única no se excluye (la pantalla no queda vacía)', async () => {
      const r = await resumen({ page: 1, excluirAgenciaId: ag.tres.id, region: `Sur-${env.marca}` });
      expect(idAg(r)).toEqual([ag.tres.id]);
    });
  });
});
