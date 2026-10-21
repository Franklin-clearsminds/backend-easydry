/**
 * Utilidades comunes de paginación, orden y búsqueda en el servidor para todos los listados.
 *
 * Reglas acordadas:
 *  - 25 filas por defecto y 100 como máximo por petición (un valor mayor se recorta, no da error,
 *    para no romper a los clientes que hoy piden 200).
 *  - El orden solo puede pedirse por columnas de una lista permitida por cada listado.
 *  - El orden siempre incluye un desempate por `id`, para que las páginas no repitan ni salten filas.
 *  - La búsqueda de texto separa palabras: cada palabra debe aparecer en alguno de los campos indicados.
 */

export const PAGE_SIZE_DEFECTO = 25;
export const PAGE_SIZE_MAX = 100;
export const BUSQUEDA_MIN_CARACTERES = 2;

export interface EntradaPaginacion {
  page?: number | string | null;
  pageSize?: number | string | null;
}

export interface Paginacion {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Normaliza page/pageSize: enteros ≥ 1, tamaño recortado al máximo y valores raros a los por defecto. */
export function resolverPaginacion(
  entrada: EntradaPaginacion = {},
  opciones: { defecto?: number; max?: number } = {},
): Paginacion {
  const max = Math.max(1, opciones.max ?? PAGE_SIZE_MAX);
  const defecto = Math.min(Math.max(1, opciones.defecto ?? PAGE_SIZE_DEFECTO), max);

  const entero = (valor: unknown, porDefecto: number): number => {
    const n = Math.floor(Number(valor));
    return Number.isFinite(n) && n >= 1 ? n : porDefecto;
  };

  const page = entero(entrada.page, 1);
  const pageSize = Math.min(entero(entrada.pageSize, defecto), max);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** true si el cliente pidió modo paginado (envió `page` o `pageSize`). Sin ellos, el listado responde como antes (arreglo, hasta 100). */
export function esConsultaPaginada(dto: EntradaPaginacion | null | undefined): boolean {
  return (dto?.page !== undefined && dto?.page !== null) || (dto?.pageSize !== undefined && dto?.pageSize !== null);
}

/** Paginación de un listado con modo heredado: modo paginado usa 25 por defecto; el heredado, hasta 100 (el máximo). */
export function paginacionListado(dto: EntradaPaginacion | null | undefined): Paginacion & { paginado: boolean } {
  const paginado = esConsultaPaginada(dto);
  const pag = resolverPaginacion(dto ?? {}, paginado ? {} : { defecto: PAGE_SIZE_MAX });
  return { ...pag, paginado };
}

/** Cómo se ordena cada columna pública: recibe la dirección y devuelve el `orderBy` de Prisma. */
export type OrdenColumnas = Record<string, (dir: 'asc' | 'desc') => Record<string, unknown>>;

/**
 * Convierte `sortField`/`sortOrder` del cliente en un `orderBy` seguro. Si la columna no está en la lista
 * permitida se usa el orden por defecto (sin error). Siempre agrega el desempate por `id`.
 */
export function resolverOrden(
  sortField: string | null | undefined,
  sortOrder: string | null | undefined,
  columnas: OrdenColumnas,
  defecto: { campo: string; dir: 'asc' | 'desc' },
  desempate: string | null = 'id',
): Record<string, unknown>[] {
  const pedida = sortField && Object.prototype.hasOwnProperty.call(columnas, sortField) ? sortField : null;
  const campo = pedida ?? defecto.campo;
  const dir: 'asc' | 'desc' = pedida
    ? (String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc')
    : defecto.dir;

  const construir = columnas[campo];
  if (!construir) {
    throw new Error(`La columna por defecto "${campo}" no está en la lista de columnas ordenables.`);
  }
  const orden = [construir(dir)];
  if (desempate && !(desempate in orden[0])) orden.push({ [desempate]: dir });
  return orden;
}

/**
 * La columna y la dirección que `resolverOrden` terminaría usando. Sirve a quien debe ordenar también filas que no salen de
 * Prisma (por ejemplo las archivadas a Parquet) con el mismo criterio que el cliente pidió.
 */
export function resolverCampoOrden(
  sortField: string | null | undefined,
  sortOrder: string | null | undefined,
  columnas: OrdenColumnas,
  defecto: { campo: string; dir: 'asc' | 'desc' },
): { campo: string; dir: 'asc' | 'desc' } {
  const pedida = sortField && Object.prototype.hasOwnProperty.call(columnas, sortField) ? sortField : null;
  return { campo: pedida ?? defecto.campo, dir: pedida ? (String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc') : defecto.dir };
}

/**
 * Igual que `resolverOrden` pero para SQL crudo: devuelve el texto de `ORDER BY`. `columnas` asocia el nombre público
 * con una expresión SQL fija escrita en el código (nunca con texto del cliente); una columna desconocida usa el orden
 * por defecto. Los nulos van al final en ambas direcciones y `desempate` (una expresión SQL) mantiene estables las páginas.
 */
export function resolverOrdenSql(
  sortField: string | null | undefined,
  sortOrder: string | null | undefined,
  columnas: Record<string, string>,
  defecto: { campo: string; dir: 'asc' | 'desc' },
  desempate: string | null = null,
): string {
  const pedida = sortField && Object.prototype.hasOwnProperty.call(columnas, sortField) ? sortField : null;
  const campo = pedida ?? defecto.campo;
  const expresion = columnas[campo];
  if (!expresion) {
    throw new Error(`La columna por defecto "${campo}" no está en la lista de columnas ordenables.`);
  }
  const dir: 'ASC' | 'DESC' = pedida
    ? (String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC')
    : (defecto.dir === 'asc' ? 'ASC' : 'DESC');
  const partes = [`${expresion} ${dir} NULLS LAST`];
  if (desempate && desempate !== expresion) partes.push(`${desempate} ${dir}`);
  return partes.join(', ');
}

/** Patrón seguro para `ILIKE '%texto%'`: escapa `%`, `_` y `\` para que el texto del cliente no actúe como comodín. */
export function patronContiene(texto: string): string {
  return `%${String(texto).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Atajo para columnas simples: `{ fecha: 'createdAt' }` → orderBy `{ createdAt: dir }`; admite rutas `a.b`. */
export function columnasSimples(mapa: Record<string, string>): OrdenColumnas {
  const columnas: OrdenColumnas = {};
  for (const [publico, ruta] of Object.entries(mapa)) {
    columnas[publico] = (dir) => anidar(ruta.split('.'), dir);
  }
  return columnas;
}

function anidar(partes: string[], valor: unknown): Record<string, unknown> {
  return partes.reduceRight<unknown>((acc, parte) => ({ [parte]: acc }), valor) as Record<string, unknown>;
}

/** Texto de búsqueda limpio, o `undefined` si es vacío o demasiado corto. */
export function textoBusqueda(texto: unknown, minimo = BUSQUEDA_MIN_CARACTERES): string | undefined {
  const limpio = String(texto ?? '').trim().replace(/\s+/g, ' ');
  return limpio.length >= minimo ? limpio.slice(0, 100) : undefined;
}

/**
 * `where` de Prisma para búsqueda de texto: cada palabra (máx. 5) debe aparecer, sin distinguir
 * mayúsculas, en alguno de los campos. Los campos pueden ser rutas de relaciones (`cliente.nombre`).
 */
export function whereBusqueda(campos: string[], texto: unknown, minimo = BUSQUEDA_MIN_CARACTERES): Record<string, unknown> | undefined {
  const limpio = textoBusqueda(texto, minimo);
  if (!limpio || !campos.length) return undefined;
  const palabras = limpio.split(' ').slice(0, 5);
  return {
    AND: palabras.map((palabra) => ({
      OR: campos.map((campo) => anidar(campo.split('.'), { contains: palabra, mode: 'insensitive' })),
    })),
  };
}

/** Une varios `where` ignorando los vacíos. */
export function combinarWhere(...partes: Array<Record<string, unknown> | undefined | null>): Record<string, unknown> {
  const validas = partes.filter((p): p is Record<string, unknown> => !!p && Object.keys(p).length > 0);
  if (!validas.length) return {};
  return validas.length === 1 ? validas[0] : { AND: validas };
}

// -----------------------------------------------------------------------------
// Orden por grupos ("no atendidas" primero) con paginación real en el servidor
// -----------------------------------------------------------------------------

export interface GrupoOrden {
  /** Condición completa del grupo (ya incluye los filtros generales). */
  where: Record<string, unknown>;
  /** Orden dentro del grupo. */
  orderBy: unknown[];
}

/**
 * Pagina una lista ordenada por GRUPOS consecutivos (por ejemplo: sin atender → en proceso → cerradas) sin traer
 * todo a memoria: cuenta cada grupo y pide solo la ventana [skip, skip+take) repartida entre los grupos que
 * la cubren. Los grupos no deben solaparse.
 */
export async function paginarPorGrupos<T>(
  grupos: GrupoOrden[],
  skip: number,
  take: number,
  contar: (where: Record<string, unknown>) => Promise<number>,
  buscar: (where: Record<string, unknown>, orderBy: unknown[], skip: number, take: number) => Promise<T[]>,
): Promise<{ items: T[]; total: number; conteos: number[] }> {
  const conteos = await Promise.all(grupos.map((g) => contar(g.where)));
  const total = conteos.reduce((a, b) => a + b, 0);
  const items: T[] = [];
  const finVentana = skip + take;

  let inicioGrupo = 0;
  for (let i = 0; i < grupos.length; i++) {
    const finGrupo = inicioGrupo + conteos[i];
    const desde = Math.max(skip, inicioGrupo) - inicioGrupo;
    const hasta = Math.min(finVentana, finGrupo) - inicioGrupo;
    if (hasta > desde) {
      items.push(...(await buscar(grupos[i].where, grupos[i].orderBy, desde, hasta - desde)));
    }
    inicioGrupo = finGrupo;
    if (inicioGrupo >= finVentana) break;
  }
  return { items, total, conteos };
}

/**
 * Rango de fechas para Prisma. Un `hasta` de solo día (AAAA-MM-DD) incluye todo ese día; las fechas
 * inválidas se ignoran en vez de lanzar error.
 */
export function rangoFechas(desde?: string | null, hasta?: string | null): { gte?: Date; lte?: Date } | undefined {
  const rango: { gte?: Date; lte?: Date } = {};
  // Una fecha sola (AAAA-MM-DD) es un día de Ecuador (UTC-5): «desde» abre a las 00:00 y «hasta» incluye todo ese día.
  const soloDia = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const d = desde ? new Date(soloDia(desde) ? `${desde}T00:00:00.000-05:00` : desde) : null;
  if (d && !Number.isNaN(d.getTime())) rango.gte = d;
  if (hasta) {
    const h = new Date(soloDia(hasta) ? `${hasta}T23:59:59.999-05:00` : hasta);
    if (!Number.isNaN(h.getTime())) rango.lte = h;
  }
  return rango.gte || rango.lte ? rango : undefined;
}

// -----------------------------------------------------------------------------
// Opciones para selectores con buscador y scroll infinito
// -----------------------------------------------------------------------------

export interface OpcionSelector {
  /** Identificador que se guarda al elegir. */
  value: string;
  /** Texto principal que se muestra. */
  label: string;
  /** Texto secundario opcional (código, región, correo…). */
  sublabel?: string;
}

// -----------------------------------------------------------------------------
// Filtro, orden y página sobre filas YA calculadas en el servidor (resúmenes con estados derivados)
// -----------------------------------------------------------------------------

/** Minúsculas y sin tildes, para comparar texto sin distinguir "Crítico" de "critico". */
export function normalizarTexto(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** ¿Cada palabra del texto (máx. 5, mínimo 2 letras en total) aparece en alguno de los campos? Sin texto útil, todo coincide. */
export function coincidePalabras(texto: unknown, campos: unknown[]): boolean {
  const limpio = textoBusqueda(texto);
  if (!limpio) return true;
  const pajar = normalizarTexto(campos.filter((c) => c !== null && c !== undefined).join(' '));
  return limpio.split(' ').slice(0, 5).every((palabra) => pajar.includes(normalizarTexto(palabra)));
}

/** Cómo se obtiene el valor ordenable de cada columna pública. */
export type ColumnasFila<T> = Record<string, (fila: T) => string | number | boolean | null | undefined>;

/**
 * Ordena (sin modificar la lista original) por una columna de la lista permitida; una columna desconocida usa el orden por
 * defecto. Texto sin distinguir tildes ni mayúsculas, números como números, nulos al final y desempate estable.
 */
export function ordenarFilas<T>(
  filas: T[],
  sortField: string | null | undefined,
  sortOrder: string | null | undefined,
  columnas: ColumnasFila<T>,
  defecto: { campo: string; dir: 'asc' | 'desc' },
  desempate?: (fila: T) => string | number,
): T[] {
  const pedida = sortField && Object.prototype.hasOwnProperty.call(columnas, sortField) ? sortField : null;
  const campo = pedida ?? defecto.campo;
  const valor = columnas[campo];
  if (!valor) throw new Error(`La columna por defecto "${campo}" no está en la lista de columnas ordenables.`);
  const dir = pedida ? (String(sortOrder).toLowerCase() === 'asc' ? 1 : -1) : defecto.dir === 'asc' ? 1 : -1;

  const comparar = (a: unknown, b: unknown): number => {
    if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1; // nulos al final siempre
    if (b === null || b === undefined) return -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
    if (typeof a === 'boolean' && typeof b === 'boolean') return (Number(a) - Number(b)) * dir;
    return String(a).localeCompare(String(b), 'es', { sensitivity: 'base', numeric: true }) * dir;
  };
  return [...filas].sort((x, y) => {
    const c = comparar(valor(x), valor(y));
    if (c !== 0) return c;
    if (!desempate) return 0;
    return comparar(desempate(x), desempate(y));
  });
}

/** Página de una lista ya filtrada y ordenada. */
export function paginarLista<T>(filas: T[], pag: { skip: number; take: number }): T[] {
  return filas.slice(pag.skip, pag.skip + pag.take);
}
