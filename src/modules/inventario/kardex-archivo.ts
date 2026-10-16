import { Prisma } from '@prisma/client';
import { textoBusqueda } from '../../common/utils/data-grid.helpers.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { mezclarPagina } from '../archivado/mezcla.js';
import type { Termino } from '../archivado/archivo-lector.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;

/** Alcance por ubicación ya resuelto por `resolverFiltroUbicacionKardex`. */
export interface AlcanceKardex {
  mode: 'ALL' | 'FILTER' | 'NONE';
  ubicacionIds?: string[];
  incluirSinUbicacion?: boolean;
  responsableId?: string;
}

/** Columnas por las que se puede ordenar y que existen tal cual en el archivo. */
const COLUMNA_ARCHIVO: Record<string, string> = {
  fecha: 'fecha',
  createdAt: 'fecha',
  ubicacion: 'ubicacionId',
  tipo: 'tipoMovimiento',
  tipoMovimiento: 'tipoMovimiento',
  cantidad: 'cantidad',
  stockAnterior: 'stockAnterior',
  stockPosterior: 'stockPosterior',
  costoUnitario: 'costoUnitario',
  costoTotal: 'costoTotal',
};
const CAMPOS_DECIMALES = ['cantidad', 'stockAnterior', 'stockPosterior', 'costoUnitario', 'costoTotal'] as const;
const LOTE = 1000;
const trozos = <T>(xs: T[], n = LOTE): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/**
 * La parte archivada del listado de Kardex (`kardex/list`): aplica a las filas de Parquet los mismos filtros, la misma búsqueda de
 * texto, el mismo alcance por ubicación y el mismo orden que la consulta de la base, y las devuelve con la forma de Prisma
 * (insumo y usuario incluidos, cantidades como Decimal) para que se mezclen con las de la base sin que el cliente note nada.
 */
export class KardexArchivo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  /** `null` si el archivo no interviene (ningún lote toca el rango o el rol no ve nada): se sigue solo con la base. */
  async consultar(p: {
    dto: { insumoId?: string; ubicacionId?: string; tipoMovimiento?: string; search?: string };
    alcance: AlcanceKardex;
    desde: Date | null;
    hasta: Date | null;
    campo: string;
    dir: 'asc' | 'desc';
    skip: number;
    take: number;
  }): Promise<{ filas: Fila[]; total: number } | null> {
    if (p.alcance.mode === 'NONE') return null;

    const grupos: Termino[][] = [];
    if (p.alcance.mode === 'FILTER') {
      grupos.push([
        { columna: 'ubicacionId', igual: p.alcance.ubicacionIds ?? [] },
        ...(p.alcance.incluirSinUbicacion ? [{ columna: 'ubicacionId', igual: null } as Termino] : []),
        ...(p.alcance.responsableId ? [{ columna: 'usuarioId', igual: p.alcance.responsableId } as Termino] : []),
      ]);
    }
    // Búsqueda: cada palabra (máx. 5) debe aparecer en alguno de estos campos. Insumo y usuario viven en los maestros: se
    // buscan allí y se pasan como ids.
    for (const palabra of (textoBusqueda(p.dto.search)?.split(' ') ?? []).slice(0, 5)) {
      const [insumos, usuarios] = await Promise.all([
        this.prisma.insumo.findMany({ where: { OR: [{ nombre: { contains: palabra, mode: 'insensitive' } }, { codigoSKU: { contains: palabra, mode: 'insensitive' } }] }, select: { id: true } }),
        this.prisma.user.findMany({ where: { OR: [{ name: { contains: palabra, mode: 'insensitive' } }, { lastname: { contains: palabra, mode: 'insensitive' } }] }, select: { id: true } }),
      ]);
      grupos.push([
        { columna: 'tipoMovimiento', contiene: palabra },
        { columna: 'referenciaId', contiene: palabra },
        { columna: 'ubicacionId', contiene: palabra },
        { columna: 'insumoId', igual: insumos.map((i) => i.id) },
        { columna: 'usuarioId', igual: usuarios.map((u) => u.id) },
      ]);
    }

    const columna = COLUMNA_ARCHIVO[p.campo];
    const resultado = await this.historico.listarArchivo({
      tabla: 'kardex_movimiento',
      desde: p.desde ?? undefined,
      // La base filtra con "menor o igual" y el archivo con "menor": se suma un milisegundo.
      hasta: p.hasta ? new Date(p.hasta.getTime() + 1) : undefined,
      filtros: {
        ...(p.dto.insumoId ? { insumoId: p.dto.insumoId } : {}),
        ...(p.dto.ubicacionId ? { ubicacionId: p.dto.ubicacionId } : {}),
        ...(p.dto.tipoMovimiento ? { tipoMovimiento: p.dto.tipoMovimiento } : {}),
      },
      grupos,
      // Orden por una columna del archivo: basta leer las primeras filas. Por nombre (insumo, sku, usuario) hay que leer todas
      // las que cumplen el filtro, ponerles nombre y ordenar aquí.
      ordenPor: columna ? [{ columna, dir: p.dir }] : undefined,
      limite: columna ? p.skip + p.take : undefined,
    });
    if (!resultado) return null;
    return { filas: await this.enriquecer(resultado.filas), total: resultado.total };
  }

  /** Mezcla filas de la base y del archivo con el orden pedido y devuelve la página [skip, skip + take). */
  mezclar(deBase: Fila[], archivo: Fila[], campo: string, dir: 'asc' | 'desc', skip: number, take: number): Fila[] {
    const valor = (f: Fila): number | string | null => {
      switch (campo) {
        case 'insumo': return f.insumo?.nombre ?? null;
        case 'sku': return f.insumo?.codigoSKU ?? null;
        case 'usuario': return f.usuario?.name ?? null;
        case 'fecha':
        case 'createdAt': return (f.fecha as Date).getTime();
        default: {
          const v = f[COLUMNA_ARCHIVO[campo] ?? 'fecha'];
          return v === null || v === undefined ? null : (CAMPOS_DECIMALES as readonly string[]).includes(COLUMNA_ARCHIVO[campo]) ? Number(v) : (v as string);
        }
      }
    };
    return mezclarPagina([...deBase, ...archivo], valor, dir, skip, take);
  }

  /** Les pone insumo y usuario (de los maestros) y convierte las cantidades a Decimal, como las devuelve Prisma. */
  private async enriquecer(filas: Fila[]): Promise<Fila[]> {
    const insumos = new Map<string, Fila>();
    for (const lote of trozos([...new Set(filas.map((f) => String(f.insumoId)))])) {
      for (const i of await this.prisma.insumo.findMany({ where: { id: { in: lote } }, select: { id: true, codigoSKU: true, nombre: true, categoria: true, unidadMedida: { select: { simbolo: true } } } })) insumos.set(i.id, i);
    }
    const usuarios = new Map<string, Fila>();
    for (const lote of trozos([...new Set(filas.map((f) => f.usuarioId).filter(Boolean) as string[])])) {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: lote } }, select: { id: true, name: true, lastname: true, email: true } })) usuarios.set(u.id, u);
    }
    return filas.map((f) => {
      const salida: Fila = { ...f, insumo: insumos.get(String(f.insumoId)) ?? null, usuario: f.usuarioId ? (usuarios.get(f.usuarioId) ?? null) : null };
      for (const campo of CAMPOS_DECIMALES) salida[campo] = f[campo] === null || f[campo] === undefined ? null : new Prisma.Decimal(f[campo]);
      return salida;
    });
  }
}
