import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListTiposProductoDto } from './dto/tipo-producto.dto.js';
import { ListUnidadesDto } from './dto/unidades.dto.js';
import { ListPresentacionesDto } from './dto/presentaciones.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): los catálogos de tipos de producto, unidades de medida y presentaciones.
 * Cada catálogo tiene tres filas propias con un orden conocido; se consulta siempre con `search: marca`.
 * Los insumos que las presentaciones necesitan los crea un segundo entorno, para que su unidad de medida no se cuele
 * en el listado de unidades.
 */
interface Caso {
  nombre: string;
  dto: new () => object;
  columna: string;
  heredado: () => string[];
  porColumna: () => string[];
  llamar: (dto: Record<string, unknown>) => Promise<any>;
}

describe('catálogos de inventario (base real)', () => {
  let env: Entorno;
  let envInsumos: Entorno;
  let service: InventarioService;
  const ids: Record<string, string[]> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    envInsumos = await abrirEntorno();
    service = new InventarioService(env.prisma as never);

    // Tipos A, B, C con 0, 2 y 1 insumos.
    const tipos = [await env.tipoProducto('A'), await env.tipoProducto('B'), await env.tipoProducto('C')];
    ids.tipos = tipos.map((t) => t.id);
    await envInsumos.insumo('b1', { tipoProductoId: tipos[1].id });
    await envInsumos.insumo('b2', { tipoProductoId: tipos[1].id });
    await envInsumos.insumo('c1', { tipoProductoId: tipos[2].id });

    // Unidades U1 (VOLUMEN, 'z', activa), U2 (MASA, 'a'), U3 (VOLUMEN, 'm', inactiva).
    const unidad = async (c: string, tipo: string, simbolo: string, estado = 1) => {
      const u = await env.prisma.unidadMedida.create({ data: { codigo: `${env.marca}-${c}`, nombre: `${env.marca} ${c}`, simbolo, tipo, estado, factorBase: 1 } });
      env.rastrear('UnidadMedida', u.id);
      return u;
    };
    const unidades = [await unidad('U1', 'VOLUMEN', 'z'), await unidad('U2', 'MASA', 'a'), await unidad('U3', 'VOLUMEN', 'm', 0)];
    ids.unidades = unidades.map((u) => u.id);

    // Presentaciones P1, P2, P3 de los insumos ZETA, ALFA y MU (en ese orden de creación).
    const insumos = [await envInsumos.insumo('ZETA'), await envInsumos.insumo('ALFA'), await envInsumos.insumo('MU')];
    ids.presentaciones = [];
    for (const [i, insumo] of insumos.entries()) {
      const p = await env.prisma.presentacionInsumo.create({
        data: { insumoId: insumo.id, nombre: `${env.marca} Pres ${i + 1}`, unidadId: unidades[0].id, cantidad: 1, factorAUnidadBase: 1 },
      });
      ids.presentaciones.push(p.id);
    }
    ids.insumosDePresentacion = insumos.map((x) => x.id);
  });

  afterAll(async () => {
    await envInsumos.cerrar();
    await env.cerrar();
  });

  const casos = (): Caso[] => [
    {
      nombre: 'tipos de producto',
      dto: ListTiposProductoDto,
      columna: 'nombre',
      heredado: () => ids.tipos,
      porColumna: () => ids.tipos,
      llamar: (d) => service.listTiposProducto(d as any),
    },
    {
      nombre: 'unidades de medida',
      dto: ListUnidadesDto,
      columna: 'simbolo',
      heredado: () => ids.unidades, // por código: U1, U2, U3
      porColumna: () => [ids.unidades[1], ids.unidades[2], ids.unidades[0]], // a, m, z
      llamar: (d) => service.listUnidades(d as any),
    },
    {
      nombre: 'presentaciones',
      dto: ListPresentacionesDto,
      columna: 'insumo',
      heredado: () => ids.presentaciones, // por nombre: P1, P2, P3
      porColumna: () => [ids.presentaciones[1], ids.presentaciones[2], ids.presentaciones[0]], // insumos ALFA, MU, ZETA
      llamar: (d) => service.listPresentaciones(d as any),
    },
  ];

  const listar = (c: Caso, dto: Record<string, unknown>) => c.llamar({ search: env.marca, ...dto });
  const idsDe = (r: any) => (Array.isArray(r) ? r : r.items).map((f: any) => String(f.id));

  for (const nombre of ['tipos de producto', 'unidades de medida', 'presentaciones']) {
    describe(`catálogo de ${nombre}`, () => {
      const caso = () => casos().find((c) => c.nombre === nombre)!;

      it('modo heredado (sin página): arreglo, mismo orden de siempre', async () => {
        const c = caso();
        const r = await listar(c, {});
        expect(Array.isArray(r)).toBe(true);
        expect(idsDe(r)).toEqual(c.heredado());
      });

      it('modo paginado: formato estándar, recorta a 100 y reparte en páginas', async () => {
        const c = caso();
        const p2: any = await listar(c, { page: 2, pageSize: 2, sortField: c.columna, sortOrder: 'asc' });
        expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 2, totalPages: 2, hasNextPage: false, hasPrevPage: true });
        expect(p2.items).toHaveLength(1);
        const grande: any = await listar(c, { pageSize: 200 });
        expect(grande.pageSize).toBe(100);
      });

      it('ordena solo por columnas permitidas', async () => {
        const c = caso();
        const r = await listar(c, { page: 1, sortField: c.columna, sortOrder: 'asc' });
        expect(idsDe(r)).toEqual(c.porColumna());
        const hostil = await listar(c, { page: 1, sortField: 'passwordHash; DROP', sortOrder: 'asc' });
        expect(idsDe(hostil).sort()).toEqual([...c.porColumna()].sort()); // no falla: cae al orden por defecto
      });

      it('el conteo usa los mismos filtros que la página', async () => {
        const c = caso();
        const r: any = await listar(c, { page: 1, search: `${env.marca} zzqq` });
        expect(r).toMatchObject({ total: 0 });
        expect(r.items).toEqual([]);
        const ok: any = await listar(c, { page: 1 });
        expect(ok.total).toBe(3);
      });

      it('una búsqueda de una letra se ignora', async () => {
        const c = caso();
        await env.reintentar(async () => {
          const sinBusqueda: any = await c.llamar({ page: 1 });
          const unaLetra: any = await c.llamar({ page: 1, search: 'a' });
          expect(unaLetra.total).toBe(sinBusqueda.total);
        });
      });

      it('el DTO no fija page/pageSize y valida', async () => {
        const dtoClase = caso().dto;
        const vacio: any = plainToInstance(dtoClase as any, {});
        expect(vacio.page).toBeUndefined();
        expect(vacio.pageSize).toBeUndefined();
        expect(await validate(vacio)).toHaveLength(0);
        const con: any = plainToInstance(dtoClase as any, { page: '2', pageSize: 200, sortField: 'nombre', sortOrder: 'asc', search: 'ab' });
        expect(await validate(con)).toHaveLength(0);
        expect(con.page).toBe(2);
      });
    });
  }

  describe('filtros propios de cada catálogo', () => {
    it('tipos: la cantidad de insumos es ordenable', async () => {
      const r: any = await service.listTiposProducto({ page: 1, search: env.marca, sortField: 'insumos', sortOrder: 'desc' } as any);
      expect(idsDe(r)).toEqual([ids.tipos[1], ids.tipos[2], ids.tipos[0]]); // 2, 1 y 0 insumos
    });

    it('unidades: filtra por familia y estado', async () => {
      const r: any = await service.listUnidades({ search: env.marca, tipo: 'VOLUMEN', estado: 1 } as any);
      expect(idsDe(r)).toEqual([ids.unidades[0]]); // U1: VOLUMEN y activa (U3 es VOLUMEN pero inactiva)
    });

    it('presentaciones: filtra por insumo (lo que usa el modal del producto)', async () => {
      const r: any = await service.listPresentaciones({ insumoId: ids.insumosDePresentacion[1] } as any);
      expect(idsDe(r)).toEqual([ids.presentaciones[1]]);
    });
  });
});
