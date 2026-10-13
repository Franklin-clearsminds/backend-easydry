import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { CreateInsumoDto, ListInsumosDto, UpdateInsumoDto } from './dto/insumos.dto.js';
import { cumpleNivel, nivelStock } from './stock-nivel.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

describe('nivelStock', () => {
  it('agotado, bajo mínimo, moderado y óptimo (misma regla que la pantalla)', () => {
    expect(nivelStock(0, 10, 30)).toBe('agotado');
    expect(nivelStock(-2, 10, 30)).toBe('agotado');
    expect(nivelStock(10, 10, 30)).toBe('bajo_minimo');
    expect(nivelStock(11, 10, 30)).toBe('moderado');
    expect(nivelStock(29.9, 10, 30)).toBe('moderado');
    expect(nivelStock(30, 10, 30)).toBe('optimo');
  });

  it('sin óptimo definido toma el doble del mínimo (o 10)', () => {
    expect(nivelStock(15, 10, null)).toBe('moderado'); // óptimo = 20
    expect(nivelStock(20, 10, null)).toBe('optimo');
    expect(nivelStock(5, 0, 0)).toBe('moderado'); // sin mínimo: óptimo = 10
    expect(nivelStock('5', '3', undefined)).toBe('moderado'); // óptimo = 6, y los textos numéricos cuentan
    expect(nivelStock('7', '3', undefined)).toBe('optimo');
  });

  it('alerta_total incluye agotado y bajo mínimo (antes solo agotado por un error de la pantalla)', () => {
    expect(cumpleNivel('agotado', 'alerta_total')).toBe(true);
    expect(cumpleNivel('bajo_minimo', 'alerta_total')).toBe(true);
    expect(cumpleNivel('moderado', 'alerta_total')).toBe(false);
    expect(cumpleNivel('optimo', 'optimo')).toBe(true);
  });
});

/**
 * Integración con la base real (sin mocks) para `listInsumos`. Mundo de la prueba, todo creado aquí:
 *
 *  Insumos I1…I4 (mínimo 10, óptimo 30), SKU `marca-SKU-In`, creados en ese orden. Stock en la BODEGA CENTRAL (la real,
 *  que es única en el sistema; solo se agregan filas de stock de estos insumos): I1=0 (agotado) · I2=8 (bajo mínimo)
 *  · I3=20 (moderado) · I4=50 (óptimo). I1 e I2 son QUIMICOS_LAVADO y del tipo LIQUIDO; I3 e I4, CERAS_SELLADORES y SOLIDO.
 *  Agencia A1 (Lía LIDER): I1 con stock 4 y mínimo 3 en la agencia · I2 por la receta del servicio S5 de la sede.
 *  Bodega propia (Asistente): I1 con stock 3.
 * Todo se consulta con `search: marca`: la base real tiene sus propios insumos.
 */
describe('listInsumos (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let central: { id: string };
  let a1: any;
  let bodegaPropia: any;
  let tipoLiquido: any;
  let tipoSolido: any;
  let servicioSede: any;
  const insumos: any[] = [];
  const actores: Record<string, any> = {};

  const nombres = (r: any) => (Array.isArray(r) ? r : r.items).map((i: any) => String(i.codigoSKU).replace(`${env.marca}-SKU-`, ''));
  const lista = (dto: Record<string, unknown>, actor: any = actores.admin) => service.listInsumos({ search: env.marca, ...dto } as any, actor);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);

    central = await env.prisma.bodega.findFirstOrThrow({ where: { tipo: 'CENTRAL' }, select: { id: true } });
    a1 = await env.agencia('A1');
    bodegaPropia = await env.bodega('PROPIA');
    tipoLiquido = await env.tipoProducto('LIQUIDO');
    tipoSolido = await env.tipoProducto('SOLIDO');
    servicioSede = await env.catalogo('S5');
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { servicioIds: [servicioSede.id], tieneServiciosEspeciales: false } });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      actores[clave] = await env.actor((await env.usuario(clave, rol, opts)).id);
    };
    await crear('admin', 'ADMIN');
    await crear('lia', 'LIDER', { agenciaId: a1.id });
    await crear('asistente', 'ASISTENTE_BODEGA', { bodegaId: bodegaPropia.id });

    const nuevo = async (n: number, categoria: string, tipo: any, stockCentral: number) => {
      const i = await env.insumo(`I${n}`, { categoria, tipoProductoId: tipo.id });
      await env.prisma.insumo.update({ where: { id: i.id }, data: { stockMinimoBodega: 10, stockOptimoBodega: 30 } });
      await env.stock({ insumoId: i.id, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: central.id, cantidad: stockCentral });
      insumos.push(i);
    };
    await nuevo(1, 'QUIMICOS_LAVADO', tipoLiquido, 0);
    await nuevo(2, 'QUIMICOS_LAVADO', tipoLiquido, 8);
    await nuevo(3, 'CERAS_SELLADORES', tipoSolido, 20);
    await nuevo(4, 'CERAS_SELLADORES', tipoSolido, 50);

    await env.stock({ insumoId: insumos[0].id, tipoUbicacion: 'AGENCIA', agenciaId: a1.id, cantidad: 4, minima: 3 });
    await env.prisma.recetaInsumo.create({
      data: {
        catalogoServicioId: servicioSede.id,
        insumoId: insumos[1].id,
        cantidadUsada: 1,
        unidadConsumoId: (await env.prisma.insumo.findUniqueOrThrow({ where: { id: insumos[1].id } })).unidadMedidaId,
      },
    });
    await env.stock({ insumoId: insumos[0].id, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: bodegaPropia.id, cantidad: 3 });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('modo heredado (sin página)', () => {
    it('arreglo con tope de 100, orden por SKU y los datos completos de siempre', async () => {
      const r: any = await lista({});
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBeLessThanOrEqual(100);
      expect(nombres(r)).toEqual(['I1', 'I2', 'I3', 'I4']); // por SKU
      for (const clave of ['stocks', 'recetas', 'presentaciones']) expect(r[0]).toHaveProperty(clave);
      // El stock de un administrador es el de la bodega central.
      expect(r.map((i: any) => i.stockActual)).toEqual([0, 8, 20, 50]);
      expect(r[2]).toMatchObject({ bodegaIdStock: central.id });
    });

    it('conserva la búsqueda y los filtros de antes', async () => {
      expect(nombres(await lista({ categoria: 'CERAS_SELLADORES' }))).toEqual(['I3', 'I4']);
      expect(nombres(await lista({ tipoProductoId: tipoLiquido.id }))).toEqual(['I1', 'I2']);
      await env.prisma.insumo.update({ where: { id: insumos[3].id }, data: { estado: 0 } });
      expect(nombres(await lista({ estado: 0 }))).toEqual(['I4']);
      expect(nombres(await lista({ estado: 1 }))).toEqual(['I1', 'I2', 'I3']);
      await env.prisma.insumo.update({ where: { id: insumos[3].id }, data: { estado: 1 } });
      expect(nombres(await service.listInsumos({ search: `${env.marca}-SKU-I3` } as any, actores.admin))).toEqual(['I3']);
    });

    it('un rol de sede ve solo los insumos de su agencia, con el stock y el mínimo de allí', async () => {
      const r: any = await lista({}, actores.lia);
      // I1 por tener stock en la sede; I2 por la receta de un servicio de la sede. I3 e I4 no son de la sede.
      expect(nombres(r)).toEqual(['I1', 'I2']);
      expect(r[0]).toMatchObject({ stockActual: 4, stockMinimoAgencia: 3 });
    });

    it('un rol de sede siempre ve SU agencia, aunque el cliente mande otro agenciaId (nunca amplía su alcance)', async () => {
      const otra = await env.agencia('A-AJENA');
      const r: any = await lista({ agenciaId: otra.id }, actores.lia);
      expect(nombres(r)).toEqual(['I1', 'I2']); // los de la sede de Lía, no los de la otra agencia
    });

    it('una agencia inexistente no devuelve nada', async () => {
      expect(await lista({ agenciaId: 'no-existe' })).toEqual([]);
    });
  });

  describe('modo paginado', () => {
    it('página liviana: sin stocks por ubicación, recetas ni presentaciones; formato estándar', async () => {
      const r: any = await lista({ page: 1, pageSize: 2, sortField: 'nombre', sortOrder: 'asc' });
      expect(r).toMatchObject({ total: 4, page: 1, pageSize: 2, totalPages: 2, hasNextPage: true });
      expect(r.items).toHaveLength(2);
      for (const clave of ['stocks', 'recetas', 'presentaciones']) expect(r.items[0]).not.toHaveProperty(clave);
      for (const clave of ['tipoProducto', 'unidadMedida']) expect(r.items[0]).toHaveProperty(clave);
      expect(r.items.map((i: any) => i.stockActual)).toEqual([0, 8]);
    });

    it('recorta a 100 y solo ordena por columnas permitidas', async () => {
      expect(((await lista({ pageSize: 200 })) as any).pageSize).toBe(100);
      expect(nombres(await lista({ page: 1, sortField: 'tipo', sortOrder: 'desc' })).slice(0, 2).sort()).toEqual(['I3', 'I4']); // SOLIDO > LIQUIDO
      const defecto = nombres(await lista({ page: 1 }));
      expect(nombres(await lista({ page: 1, sortField: 'imagenUrl; DROP', sortOrder: 'asc' }))).toEqual(defecto);
      expect(defecto).toEqual(['I4', 'I3', 'I2', 'I1']); // lo más reciente primero
    });

    it('busca por palabras en nombre, SKU y descripción; una letra se ignora; filtros en el servidor', async () => {
      const r: any = await lista({ page: 1, search: `${env.marca} insumo i2`, estado: 1, tipoProductoId: tipoLiquido.id });
      expect(nombres(r)).toEqual(['I2']);
      expect(r.total).toBe(1); // el total usa los mismos filtros
      await env.reintentar(async () => {
        const sin: any = await service.listInsumos({ page: 1 } as any, actores.admin);
        const unaLetra: any = await service.listInsumos({ page: 1, search: 'a' } as any, actores.admin);
        expect(unaLetra.total).toBe(sin.total);
      });
    });

    it('el asistente de bodega siempre ve el stock de SU bodega, aunque pida otra', async () => {
      const r: any = await lista({ page: 1, bodegaId: central.id }, actores.asistente);
      const i1 = r.items.find((i: any) => i.codigoSKU.endsWith('-I1'));
      expect(i1.stockActual).toBe(3); // el de su bodega, no el de la central que pidió
      expect(i1.bodegaIdStock).toBe(bodegaPropia.id);
    });

    it('modo sede: el stock y el mínimo salen de la agencia', async () => {
      const r: any = await lista({ page: 1 }, actores.lia);
      expect(nombres(r).sort()).toEqual(['I1', 'I2']);
      expect(r.items.find((i: any) => i.codigoSKU.endsWith('-I1'))).toMatchObject({ stockActual: 4, stockMinimoAgencia: 3 });
    });
  });

  describe('nivel de stock y orden por stock (paginado)', () => {
    it('filtra por nivel con el stock de la bodega y cuenta solo lo que coincide', async () => {
      const r: any = await lista({ page: 1, nivelStock: 'moderado' });
      expect(r.total).toBe(1);
      expect(nombres(r)).toEqual(['I3']);
      expect(nombres(await lista({ page: 1, nivelStock: 'optimo' }))).toEqual(['I4']);
      expect(nombres(await lista({ page: 1, nivelStock: 'agotado' }))).toEqual(['I1']);
    });

    it('alerta_total = agotado + bajo mínimo', async () => {
      const r: any = await lista({ page: 1, nivelStock: 'alerta_total', sortField: 'stock', sortOrder: 'asc' });
      expect(r.total).toBe(2);
      expect(nombres(r)).toEqual(['I1', 'I2']);
    });

    it('ordena por stock y por gravedad de alerta, y pagina sobre ese orden', async () => {
      const asc: any = await lista({ page: 1, pageSize: 2, sortField: 'stock', sortOrder: 'asc' });
      expect(nombres(asc)).toEqual(['I1', 'I2']);
      expect(asc).toMatchObject({ total: 4, totalPages: 2, hasNextPage: true });
      expect(nombres(await lista({ page: 2, pageSize: 2, sortField: 'stock', sortOrder: 'asc' }))).toEqual(['I3', 'I4']);
      expect(nombres(await lista({ page: 1, sortField: 'alerta', sortOrder: 'asc' }))).toEqual(['I1', 'I2', 'I3', 'I4']);
      expect(nombres(await lista({ page: 1, sortField: 'stock', sortOrder: 'desc' }))).toEqual(['I4', 'I3', 'I2', 'I1']);
    });

    it('si ningún insumo cumple devuelve una página vacía', async () => {
      // Con I2 solamente (bajo mínimo), pedir "agotado" no encuentra nada.
      const r: any = await service.listInsumos({ page: 1, search: `${env.marca}-SKU-I2`, nivelStock: 'agotado' } as any, actores.admin);
      expect(r).toMatchObject({ total: 0, items: [], totalPages: 1, hasNextPage: false });
    });
  });
});

describe('ListInsumosDto', () => {
  it('no fija page/pageSize, acepta niveles válidos y rechaza otros', async () => {
    const vacio: any = plainToInstance(ListInsumosDto, {});
    expect(vacio.page).toBeUndefined();
    expect(await validate(vacio)).toHaveLength(0);
    expect(await validate(plainToInstance(ListInsumosDto, { page: '2', pageSize: 50, nivelStock: 'alerta_total', sortField: 'stock', sortOrder: 'asc' }))).toHaveLength(0);
    expect((await validate(plainToInstance(ListInsumosDto, { nivelStock: 'inventado' }))).length).toBeGreaterThan(0);
  });
});

describe('categoria de insumo — @IsIn', () => {
  const base = { codigoSKU: 'SKU-1', nombre: 'Insumo', unidadMedidaId: 'u1', stockMinimoBodega: 1, stockMinimoAgencia: 1, stockOptimoBodega: 2 };

  it('CreateInsumoDto acepta una categoría válida del catálogo y rechaza cualquier otra', async () => {
    const valido = plainToInstance(CreateInsumoDto, { ...base, categoria: 'QUIMICOS_LAVADO' });
    expect(await validate(valido)).toHaveLength(0);

    const invalido = plainToInstance(CreateInsumoDto, { ...base, categoria: 'GENERAL' });
    const errores = await validate(invalido);
    expect(errores.some((e) => e.property === 'categoria')).toBe(true);
  });

  it('UpdateInsumoDto rechaza una categoría fuera del catálogo', async () => {
    const invalido = plainToInstance(UpdateInsumoDto, { id: 'i1', categoria: 'OTRA' });
    const errores = await validate(invalido);
    expect(errores.some((e) => e.property === 'categoria')).toBe(true);
  });
});
