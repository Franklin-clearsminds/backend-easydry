import { Prisma } from '@prisma/client';
import { textoBusqueda } from '../../common/utils/data-grid.helpers.js';
import type { Termino, ValorFiltro } from '../archivado/archivo-lector.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { mezclarPagina, trozos } from '../archivado/mezcla.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AlcanceKardex } from './kardex-archivo.js';

type Fila = Record<string, any>;

/** Columnas por las que se puede ordenar y que existen tal cual en el archivo (fechas, números y códigos). */
const COLUMNA_ARCHIVO: Record<string, string> = {
  fecha: 'fechaMovimiento',
  fechaMovimiento: 'fechaMovimiento',
  createdAt: 'createdAt',
  comprobante: 'numeroComprobante',
  cantidad: 'cantidad',
  cantidadBase: 'cantidadBase',
  stockAnterior: 'stockAnterior',
  stockNuevo: 'stockNuevo',
};
const TIMESTAMPS = ['fechaMovimiento', 'createdAt'];
const DECIMALES = ['cantidad', 'cantidadBase', 'stockAnterior', 'stockNuevo', 'cantidadContada'] as const;

/**
 * La parte archivada del listado de movimientos de inventario (`movimientos/globales`): aplica a las filas de Parquet el mismo
 * alcance por ubicación, los mismos filtros, la misma búsqueda de texto, el mismo orden y el mismo resumen por tipo que la consulta
 * de la base, y las devuelve con la forma de Prisma (insumo, tipo, unidad, presentación, motivo y responsable incluidos).
 *
 * Las rutas (origen y destino) ya vienen guardadas en cada fila, igual que en la base. Los textos libres (origen, destino) y los
 * nombres (producto, SKU, tipo, responsable) se ordenan aquí, en memoria, para que el orden coincida con el de la base.
 */
export class MovimientosGlobalesArchivo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  private async idsQueContienen(consulta: (palabra: string) => Promise<Array<{ id: string }>>, palabra: string): Promise<string[]> {
    return (await consulta(palabra)).map((x) => x.id);
  }

  /** Las condiciones de todo lo que no es el tipo, o `null` si el alcance no deja ver nada. */
  private async condiciones(p: { dto: { insumoId?: string; ubicacionId?: string; search?: string }; alcance: AlcanceKardex }): Promise<{ filtros: Record<string, ValorFiltro>; grupos: Termino[][] } | null> {
    if (p.alcance.mode === 'NONE') return null;
    const filtros: Record<string, ValorFiltro> = {
      ...(p.dto.insumoId ? { insumoId: p.dto.insumoId } : {}),
      ...(p.dto.ubicacionId ? { ubicacionId: p.dto.ubicacionId } : {}),
    };
    const grupos: Termino[][] = [];
    if (p.alcance.mode === 'FILTER') {
      grupos.push([
        { columna: 'ubicacionId', igual: p.alcance.ubicacionIds ?? [] },
        ...(p.alcance.incluirSinUbicacion ? [{ columna: 'ubicacionId', igual: null } as Termino] : []),
        ...(p.alcance.responsableId ? [{ columna: 'responsableId', igual: p.alcance.responsableId } as Termino] : []),
      ]);
    }
    // Búsqueda: cada palabra (máx. 5) debe aparecer en alguno de estos campos. Insumo, tipo, motivo y responsable viven en los
    // maestros: se buscan allí y se pasan como ids.
    for (const palabra of (textoBusqueda(p.dto.search)?.split(' ') ?? []).slice(0, 5)) {
      const contiene = { contains: palabra, mode: 'insensitive' as const };
      const [insumos, tipos, motivos, usuarios] = await Promise.all([
        this.idsQueContienen((w) => this.prisma.insumo.findMany({ where: { OR: [{ nombre: { contains: w, mode: 'insensitive' } }, { codigoSKU: { contains: w, mode: 'insensitive' } }] }, select: { id: true } }), palabra),
        this.idsQueContienen(() => this.prisma.tipoMovimientoInventario.findMany({ where: { nombre: contiene }, select: { id: true } }), palabra),
        this.idsQueContienen(() => this.prisma.motivoMovimientoInventario.findMany({ where: { nombre: contiene }, select: { id: true } }), palabra),
        this.idsQueContienen((w) => this.prisma.user.findMany({ where: { OR: [{ name: { contains: w, mode: 'insensitive' } }, { lastname: { contains: w, mode: 'insensitive' } }] }, select: { id: true } }), palabra),
      ]);
      grupos.push([
        ...['numeroComprobante', 'referencia', 'observaciones', 'origenUbicacion', 'destinoUbicacion'].map((columna): Termino => ({ columna, contiene: palabra })),
        { columna: 'insumoId', igual: insumos },
        { columna: 'tipoMovimientoId', igual: tipos },
        { columna: 'motivoId', igual: motivos },
        { columna: 'responsableId', igual: usuarios },
      ]);
    }
    return { filtros, grupos };
  }

  /** `null` si el archivo no interviene (ningún lote toca el rango o el rol no ve nada): se sigue solo con la base. */
  async consultar(p: {
    dto: { insumoId?: string; ubicacionId?: string; tipoMovimientoId?: string; search?: string };
    alcance: AlcanceKardex;
    desde: Date | null;
    hasta: Date | null;
    campo: string;
    dir: 'asc' | 'desc';
    skip: number;
    take: number;
  }): Promise<{ filas: Fila[]; total: number } | null> {
    const base = await this.condiciones(p);
    if (!base) return null;
    const grupos = [...base.grupos];
    if (p.dto.tipoMovimientoId) grupos.push([{ columna: 'tipoMovimientoId', igual: p.dto.tipoMovimientoId }]);

    const columna = COLUMNA_ARCHIVO[p.campo];
    const resultado = await this.historico.listarArchivo({
      tabla: 'movimiento_inventario_global',
      desde: p.desde ?? undefined,
      // La base filtra con "menor o igual" y el archivo con "menor": se suma un milisegundo.
      hasta: p.hasta ? new Date(p.hasta.getTime() + 1) : undefined,
      filtros: base.filtros,
      grupos,
      ordenPor: columna ? [{ columna, dir: p.dir }] : undefined,
      limite: columna ? p.skip + p.take : undefined,
    });
    if (!resultado) return null;
    return { filas: await this.enriquecer(resultado.filas), total: resultado.total };
  }

  /** Movimientos por tipo con los mismos filtros pero SIN el de tipo (el resumen de la pantalla), o `null` si no interviene. */
  async resumen(p: { dto: { insumoId?: string; ubicacionId?: string; search?: string }; alcance: AlcanceKardex; desde: Date | null; hasta: Date | null }): Promise<Record<string, number> | null> {
    const base = await this.condiciones(p);
    if (!base) return null;
    return this.historico.contarPorArchivo({
      tabla: 'movimiento_inventario_global',
      columna: 'tipoMovimientoId',
      desde: p.desde ?? undefined,
      hasta: p.hasta ? new Date(p.hasta.getTime() + 1) : undefined,
      filtros: base.filtros,
      grupos: base.grupos,
    });
  }

  /** Mezcla filas de la base y del archivo con el orden pedido y devuelve la página [skip, skip + take). */
  mezclar(deBase: Fila[], archivo: Fila[], campo: string, dir: 'asc' | 'desc', skip: number, take: number): Fila[] {
    const valor = (f: Fila): number | string | null => {
      switch (campo) {
        case 'producto': return f.insumo?.nombre ?? null;
        case 'sku': return f.insumo?.codigoSKU ?? null;
        case 'tipo': return f.tipoMovimiento?.nombre ?? null;
        case 'responsable': return f.responsable?.name ?? null;
        case 'ruta':
        case 'origen': return f.origenUbicacion ?? null;
        case 'destino': return f.destinoUbicacion ?? null;
        default: {
          const col = COLUMNA_ARCHIVO[campo] ?? 'fechaMovimiento';
          const v = f[col];
          if (v === null || v === undefined) return null;
          return TIMESTAMPS.includes(col) ? (v as Date).getTime() : (DECIMALES as readonly string[]).includes(col) ? Number(v) : (v as string);
        }
      }
    };
    return mezclarPagina([...deBase, ...archivo], valor, dir, skip, take);
  }

  /** Les pone insumo, tipo, unidad, presentación, motivo y responsable (de los maestros) y convierte las cantidades a Decimal. */
  private async enriquecer(filas: Fila[]): Promise<Fila[]> {
    if (!filas.length) return [];
    const unicos = (campo: string) => [...new Set(filas.map((f) => f[campo]).filter(Boolean) as string[])];
    const mapa = async <T extends { id: string }>(campo: string, buscar: (ids: string[]) => Promise<T[]>): Promise<Map<string, T>> => {
      const m = new Map<string, T>();
      for (const lote of trozos(unicos(campo))) for (const x of await buscar(lote)) m.set(x.id, x);
      return m;
    };
    const [insumos, tipos, unidades, presentaciones, motivos, responsables] = await Promise.all([
      mapa('insumoId', (ids) => this.prisma.insumo.findMany({ where: { id: { in: ids } }, select: { id: true, codigoSKU: true, nombre: true, unidadMedida: { select: { simbolo: true, nombre: true } } } })),
      mapa('tipoMovimientoId', (ids) => this.prisma.tipoMovimientoInventario.findMany({ where: { id: { in: ids } }, select: { id: true, codigo: true, nombre: true, esEntrada: true } })),
      mapa('unidadId', (ids) => this.prisma.unidadMedida.findMany({ where: { id: { in: ids } }, select: { id: true, simbolo: true, nombre: true } })),
      mapa('presentacionId', (ids) => this.prisma.presentacionInsumo.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, factorAUnidadBase: true } })),
      mapa('motivoId', (ids) => this.prisma.motivoMovimientoInventario.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, codigo: true } })),
      mapa('responsableId', (ids) => this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, lastname: true, email: true } })),
    ]);
    return filas.map((f) => {
      const salida: Fila = {
        ...f,
        insumo: insumos.get(f.insumoId) ?? null,
        tipoMovimiento: tipos.get(f.tipoMovimientoId) ?? null,
        unidad: unidades.get(f.unidadId) ?? null,
        presentacion: f.presentacionId ? (presentaciones.get(f.presentacionId) ?? null) : null,
        motivo: f.motivoId ? (motivos.get(f.motivoId) ?? null) : null,
        responsable: f.responsableId ? (responsables.get(f.responsableId) ?? null) : null,
      };
      for (const campo of DECIMALES) salida[campo] = f[campo] === null || f[campo] === undefined ? null : new Prisma.Decimal(f[campo]);
      return salida;
    });
  }
}
