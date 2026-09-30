import { describe, expect, it } from 'vitest';
import { buildDataGridResponse } from '../dto/data-grid.dto.js';
import {
  coincidePalabras,
  columnasSimples,
  combinarWhere,
  normalizarTexto,
  ordenarFilas,
  paginarLista,
  patronContiene,
  resolverOrden,
  resolverOrdenSql,
  resolverPaginacion,
  textoBusqueda,
  whereBusqueda,
} from './data-grid.helpers.js';

describe('resolverPaginacion', () => {
  it('usa 25 por defecto y calcula skip/take', () => {
    expect(resolverPaginacion({})).toEqual({ page: 1, pageSize: 25, skip: 0, take: 25 });
    expect(resolverPaginacion({ page: 3, pageSize: 50 })).toEqual({ page: 3, pageSize: 50, skip: 100, take: 50 });
  });

  it('recorta a 100 (sin error) lo que pidan de más, incluso los 200 de clientes antiguos', () => {
    expect(resolverPaginacion({ pageSize: 200 }).pageSize).toBe(100);
    expect(resolverPaginacion({ pageSize: 5000 }).take).toBe(100);
  });

  it('corrige valores inválidos', () => {
    expect(resolverPaginacion({ page: 0, pageSize: -3 })).toMatchObject({ page: 1, pageSize: 25 });
    expect(resolverPaginacion({ page: 'abc', pageSize: null })).toMatchObject({ page: 1, pageSize: 25 });
    expect(resolverPaginacion({ page: '2', pageSize: '10' })).toMatchObject({ page: 2, pageSize: 10, skip: 10 });
    expect(resolverPaginacion({ page: 2.9 }).page).toBe(2);
  });

  it('permite otro tamaño por defecto y otro máximo por listado', () => {
    expect(resolverPaginacion({}, { defecto: 20 }).pageSize).toBe(20);
    expect(resolverPaginacion({ pageSize: 60 }, { max: 50 }).pageSize).toBe(50);
  });
});

describe('resolverOrden', () => {
  const columnas = {
    ...columnasSimples({ fecha: 'createdAt', estado: 'estado', agencia: 'agencia.nombre' }),
  };
  const defecto = { campo: 'fecha', dir: 'desc' as const };

  it('ordena por la columna pedida y agrega el desempate por id', () => {
    expect(resolverOrden('estado', 'asc', columnas, defecto)).toEqual([{ estado: 'asc' }, { id: 'asc' }]);
  });

  it('soporta columnas de relaciones', () => {
    expect(resolverOrden('agencia', 'desc', columnas, defecto)).toEqual([{ agencia: { nombre: 'desc' } }, { id: 'desc' }]);
  });

  it('ignora columnas que no están permitidas y usa el orden por defecto (más reciente primero)', () => {
    expect(resolverOrden('passwordHash', 'asc', columnas, defecto)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(resolverOrden('__proto__', 'asc', columnas, defecto)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(resolverOrden(undefined, undefined, columnas, defecto)).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('una dirección inválida se toma como descendente', () => {
    expect(resolverOrden('estado', 'raro', columnas, defecto)[0]).toEqual({ estado: 'desc' });
  });

  it('no duplica el desempate cuando la columna ya es id', () => {
    const cols = columnasSimples({ id: 'id' });
    expect(resolverOrden('id', 'asc', cols, { campo: 'id', dir: 'asc' })).toEqual([{ id: 'asc' }]);
  });
});

describe('resolverOrdenSql', () => {
  const columnas = { fecha: 'm."fechaDespacho"', guia: 'm."numeroGuia"' };
  const defecto = { campo: 'fecha', dir: 'desc' as const };
  const id = 'm."id"';

  it('arma el ORDER BY con nulos al final y desempate', () => {
    expect(resolverOrdenSql('guia', 'asc', columnas, defecto, id)).toBe('m."numeroGuia" ASC NULLS LAST, m."id" ASC');
  });

  it('sin orden o con una columna no permitida usa el orden por defecto (más reciente primero)', () => {
    const esperado = 'm."fechaDespacho" DESC NULLS LAST, m."id" DESC';
    expect(resolverOrdenSql(undefined, undefined, columnas, defecto, id)).toBe(esperado);
    expect(resolverOrdenSql('numeroGuia; DROP TABLE x', 'asc', columnas, defecto, id)).toBe(esperado);
    expect(resolverOrdenSql('__proto__', 'asc', columnas, defecto, id)).toBe(esperado);
  });

  it('una dirección inválida se toma como descendente y el desempate es opcional', () => {
    expect(resolverOrdenSql('fecha', 'raro', columnas, defecto)).toBe('m."fechaDespacho" DESC NULLS LAST');
  });

  it('falla si la columna por defecto no existe (error del programador)', () => {
    expect(() => resolverOrdenSql(null, null, columnas, { campo: 'nada', dir: 'asc' })).toThrow();
  });
});

describe('patronContiene', () => {
  it('escapa los comodines del texto del cliente', () => {
    expect(patronContiene('ab')).toBe('%ab%');
    expect(patronContiene('50%_x\\')).toBe('%50\\%\\_x\\\\%');
  });
});

describe('búsqueda de texto', () => {
  it('ignora textos vacíos o demasiado cortos', () => {
    expect(textoBusqueda('   ')).toBeUndefined();
    expect(textoBusqueda('a')).toBeUndefined();
    expect(textoBusqueda('  ab  ')).toBe('ab');
    expect(whereBusqueda(['nombre'], 'a')).toBeUndefined();
    expect(whereBusqueda([], 'hola')).toBeUndefined();
  });

  it('cada palabra debe aparecer en alguno de los campos, sin distinguir mayúsculas', () => {
    const where = whereBusqueda(['name', 'cliente.nombre'], 'juan perez');
    expect(where).toEqual({
      AND: [
        { OR: [{ name: { contains: 'juan', mode: 'insensitive' } }, { cliente: { nombre: { contains: 'juan', mode: 'insensitive' } } }] },
        { OR: [{ name: { contains: 'perez', mode: 'insensitive' } }, { cliente: { nombre: { contains: 'perez', mode: 'insensitive' } } }] },
      ],
    });
  });

  it('limita a 5 palabras y a 100 caracteres', () => {
    const where = whereBusqueda(['a'], 'uno dos tres cuatro cinco seis siete') as { AND: unknown[] };
    expect(where.AND).toHaveLength(5);
    expect(textoBusqueda('x'.repeat(300))).toHaveLength(100);
  });

  it('combinarWhere ignora vacíos y une el resto', () => {
    expect(combinarWhere(undefined, {}, null)).toEqual({});
    expect(combinarWhere({ a: 1 })).toEqual({ a: 1 });
    expect(combinarWhere({ a: 1 }, undefined, { b: 2 })).toEqual({ AND: [{ a: 1 }, { b: 2 }] });
  });
});

describe('buildDataGridResponse', () => {
  it('devuelve items y el alias data con los mismos elementos', () => {
    const r = buildDataGridResponse([{ id: 1 }, { id: 2 }], 5, 1, 2);
    expect(r.items).toEqual(r.data);
    expect(r).toMatchObject({ total: 5, page: 1, pageSize: 2, totalPages: 3, hasNextPage: true, hasPrevPage: false });
  });

  it('marca la última página', () => {
    const r = buildDataGridResponse([{ id: 5 }], 5, 3, 2);
    expect(r).toMatchObject({ page: 3, totalPages: 3, hasNextPage: false, hasPrevPage: true });
  });

  it('con cero resultados hay una página y ninguna siguiente', () => {
    const r = buildDataGridResponse([], 0, 1, 25);
    expect(r).toMatchObject({ total: 0, totalPages: 1, hasNextPage: false, hasPrevPage: false });
  });
});

describe('filtro, orden y página en memoria', () => {
  const filas = [
    { id: 'a', nombre: 'Ácido cítrico', stock: 5, grav: 1, nota: null as string | null },
    { id: 'b', nombre: 'jabón neutro', stock: 20, grav: 3, nota: 'x' },
    { id: 'c', nombre: 'Cera', stock: 0, grav: 0, nota: 'y' },
    { id: 'd', nombre: 'cera líquida', stock: 20, grav: 3, nota: null },
  ];
  const columnas = { nombre: (f: (typeof filas)[number]) => f.nombre, stock: (f: (typeof filas)[number]) => f.stock, nota: (f: (typeof filas)[number]) => f.nota };
  const defecto = { campo: 'nombre', dir: 'asc' as const };

  it('normalizarTexto y coincidePalabras ignoran tildes y mayúsculas; una letra o vacío no filtra', () => {
    expect(normalizarTexto('Crítico ÁCIDO')).toBe('critico acido');
    expect(coincidePalabras('acido', ['Ácido cítrico'])).toBe(true);
    expect(coincidePalabras('cera liq', ['Cera', 'cera líquida'])).toBe(true);
    expect(coincidePalabras('cera jabon', ['Cera', 'cera líquida'])).toBe(false);
    expect(coincidePalabras('a', ['zzz'])).toBe(true);
    expect(coincidePalabras('', ['zzz'])).toBe(true);
    expect(coincidePalabras('xx', [null, undefined, 'xx'])).toBe(true);
  });

  it('ordena por la columna pedida sin alterar la original, con acentos y mayúsculas en su lugar', () => {
    const asc = ordenarFilas(filas, 'nombre', 'asc', columnas, defecto);
    expect(asc.map((f) => f.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(filas.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd']);
    // en empate (b y d con 20) el desempate sigue la misma dirección que el orden, igual que en SQL
    expect(ordenarFilas(filas, 'stock', 'desc', columnas, defecto, (f) => f.id).map((f) => f.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('usa el orden por defecto ante columnas desconocidas y manda los nulos al final en ambas direcciones', () => {
    expect(ordenarFilas(filas, 'pasword; x', 'desc', columnas, defecto).map((f) => f.id)).toEqual(['a', 'c', 'd', 'b']);
    expect(ordenarFilas(filas, 'nota', 'asc', columnas, defecto, (f) => f.id).map((f) => f.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(ordenarFilas(filas, 'nota', 'desc', columnas, defecto, (f) => f.id).map((f) => f.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(() => ordenarFilas(filas, null, null, columnas, { campo: 'nada', dir: 'asc' })).toThrow();
  });

  it('paginarLista recorta la ventana', () => {
    expect(paginarLista(filas, { skip: 1, take: 2 }).map((f) => f.id)).toEqual(['b', 'c']);
    expect(paginarLista(filas, { skip: 10, take: 5 })).toEqual([]);
  });
});
