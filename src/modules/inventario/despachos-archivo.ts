import { Prisma } from '@prisma/client';
import type { Termino, ValorFiltro } from '../archivado/archivo-lector.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { mezclarPagina, trozos } from '../archivado/mezcla.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;

/** Los despachos que se archivan salen de un estado final; los demás (en tránsito, pendientes) nunca están en el archivo. */
const ESTADOS_ARCHIVADOS = ['RECIBIDO', 'RECHAZADO', 'CANCELADO'];
const TIPOS_DESPACHO = ['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'DESPACHO_BODEGA'];

/** Lo que el listado de despachos necesita saber del contexto de quien consulta (ver `contextoDespachos`). */
export interface ContextoArchivoDespachos {
  estado: string | null;
  guia: string | null;
  desde: Date | null;
  hasta: Date | null;
  /** Agencia destino a la que se limita el listado: sus ids y los textos (sin escapar) que pueden aparecer en las rutas. */
  agencia: { ids: string[]; terminos: string[] } | null;
  pulidorId: string | null;
  regional: { usuarioId: string; bodegaId: string | null; terminos: string[] } | null;
  palabras: string[];
}

/** Columnas por las que se puede ordenar y que existen tal cual en el archivo (solo fechas). */
const COLUMNA_ARCHIVO: Record<string, string> = { fecha: 'fechaDespacho', recepcion: 'fechaRecepcion' };

/**
 * La parte archivada del listado de despachos (`despachos/list`): aplica a las filas de Parquet el mismo alcance, los mismos filtros,
 * la misma búsqueda y el mismo orden que la consulta SQL de la base, y las devuelve con las mismas columnas. Los detalles de cada
 * despacho (insumos y cantidades) se leen del archivo de su mismo lote.
 *
 * Los despachos en tránsito o pendientes nunca están archivados: si el filtro de estado pide solo esos, ni se mira el archivo (es lo
 * que ocurre en los usos internos, que solo buscan despachos pendientes).
 */
export class DespachosArchivo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  private async condiciones(ctx: ContextoArchivoDespachos, sinEstado: boolean): Promise<{ filtros: Record<string, ValorFiltro>; grupos: Termino[][] } | null> {
    if (!sinEstado && ctx.estado && !ESTADOS_ARCHIVADOS.includes(ctx.estado)) return null; // pide solo lo que nunca se archiva

    const filtros: Record<string, ValorFiltro> = { tipo: TIPOS_DESPACHO, ...(!sinEstado && ctx.estado ? { estadoDespacho: ctx.estado } : {}) };
    const grupos: Termino[][] = [];
    const contiene = (columna: string, terminos: string[]): Termino[] => terminos.map((t) => ({ columna, contiene: t }));

    if (ctx.guia) grupos.push([{ columna: 'numeroGuia', contiene: ctx.guia }]);
    // También los despachos que SALEN de la agencia, no solo los que llegan.
    if (ctx.agencia) {
      grupos.push([
        { columna: 'destinoAgenciaId', igual: ctx.agencia.ids },
        ...contiene('destinoUbicacion', ctx.agencia.terminos),
        { columna: 'origenAgenciaId', igual: ctx.agencia.ids },
        ...contiene('origenUbicacion', ctx.agencia.terminos),
      ]);
    }
    if (ctx.pulidorId) grupos.push([{ columna: 'usuarioRecibeId', igual: ctx.pulidorId }, { columna: 'destinoPulidorId', igual: ctx.pulidorId }]);
    if (ctx.regional) {
      grupos.push([
        { columna: 'usuarioDespachaId', igual: ctx.regional.usuarioId },
        { columna: 'usuarioRecibeId', igual: ctx.regional.usuarioId },
        ...(ctx.regional.bodegaId ? [{ columna: 'destinoBodegaId', igual: ctx.regional.bodegaId } as Termino, { columna: 'origenBodegaId', igual: ctx.regional.bodegaId } as Termino] : []),
        ...contiene('destinoUbicacion', ctx.regional.terminos),
        ...contiene('origenUbicacion', ctx.regional.terminos),
      ]);
    }
    // Cada palabra debe aparecer en la guía, el origen, el destino, algún responsable o algún insumo del envío.
    for (const palabra of ctx.palabras) {
      const [usuarios, insumos] = await Promise.all([
        this.prisma.user.findMany({ where: { OR: [{ name: { contains: palabra, mode: 'insensitive' } }, { lastname: { contains: palabra, mode: 'insensitive' } }] }, select: { id: true } }),
        this.prisma.insumo.findMany({ where: { OR: [{ nombre: { contains: palabra, mode: 'insensitive' } }, { codigoSKU: { contains: palabra, mode: 'insensitive' } }] }, select: { id: true } }),
      ]);
      const ids = usuarios.map((u) => u.id);
      const conInsumo = insumos.length ? await this.historico.idsDePadresPorHijo({ tabla: 'movimiento_inventario', hijo: 'movimiento_detalle', filtros: { insumoId: insumos.map((i) => i.id) } }) : [];
      grupos.push([
        { columna: 'numeroGuia', contiene: palabra },
        { columna: 'destinoUbicacion', contiene: palabra },
        { columna: 'origenUbicacion', contiene: palabra },
        { columna: 'usuarioDespachaId', igual: ids },
        { columna: 'usuarioRecibeId', igual: ids },
        { columna: 'id', igual: conInsumo },
      ]);
    }
    return { filtros, grupos };
  }

  /** `null` si el archivo no interviene (ningún lote toca el rango o el filtro pide solo estados nunca archivados). */
  async consultar(p: { ctx: ContextoArchivoDespachos; campo: string; dir: 'asc' | 'desc'; skip: number; take: number }): Promise<{ filas: Fila[]; total: number; detalles: Fila[] } | null> {
    const base = await this.condiciones(p.ctx, false);
    if (!base) return null;
    const columna = COLUMNA_ARCHIVO[p.campo];
    const resultado = await this.historico.listarArchivo({
      tabla: 'movimiento_inventario',
      desde: p.ctx.desde ?? undefined,
      // La base filtra con "menor o igual" y el archivo con "menor": se suma un milisegundo.
      hasta: p.ctx.hasta ? new Date(p.ctx.hasta.getTime() + 1) : undefined,
      filtros: base.filtros,
      grupos: base.grupos,
      ordenPor: columna ? [{ columna, dir: p.dir, nulosAlFinal: true }] : undefined,
      limite: columna ? p.skip + p.take : undefined,
    });
    if (!resultado) return null;
    return { filas: resultado.filas, total: resultado.total, detalles: [] };
  }

  /** Contadores por estado con todos los filtros salvo el de estado (para las tarjetas), o `null` si el archivo no interviene. */
  async resumen(ctx: ContextoArchivoDespachos): Promise<Record<string, number> | null> {
    const base = await this.condiciones(ctx, true);
    if (!base) return null;
    return this.historico.contarPorArchivo({
      tabla: 'movimiento_inventario',
      columna: 'estadoDespacho',
      desde: ctx.desde ?? undefined,
      hasta: ctx.hasta ? new Date(ctx.hasta.getTime() + 1) : undefined,
      filtros: base.filtros,
      grupos: base.grupos,
    });
  }

  /** Mezcla filas de la base y del archivo con el orden pedido y devuelve la página [skip, skip + take). */
  mezclar(deBase: Fila[], archivo: Fila[], campo: string, dir: 'asc' | 'desc', skip: number, take: number): Fila[] {
    const valor = (f: Fila): number | string | null => {
      switch (campo) {
        case 'guia': return f.numeroGuia ?? null;
        case 'estado': return f.estadoDespacho ?? null;
        case 'origen': return f.origenUbicacion ?? null;
        case 'destino': return f.destinoUbicacion ?? null;
        case 'recepcion': return f.fechaRecepcion ? (f.fechaRecepcion as Date).getTime() : null;
        default: return (f.fechaDespacho as Date).getTime();
      }
    };
    // Este listado pone los nulos al final en ambos sentidos.
    return mezclarPagina([...deBase, ...archivo], valor, dir, skip, take, true);
  }

  /** Los detalles (insumo y cantidades) de los despachos archivados de la página, con la forma que arma `armarDespachos`. */
  async detallesDe(filas: Fila[], ctx: ContextoArchivoDespachos): Promise<Fila[]> {
    if (!filas.length) return [];
    const detalles = await this.historico.hijosDe({
      tabla: 'movimiento_inventario',
      hijo: 'movimiento_detalle',
      idsPadre: filas.map((f) => String(f.id)),
      desde: ctx.desde ?? undefined,
      hasta: ctx.hasta ? new Date(ctx.hasta.getTime() + 1) : undefined,
    });
    const insumos = new Map<string, Fila>();
    for (const lote of trozos([...new Set(detalles.map((d) => String(d.insumoId)))])) {
      for (const i of await this.prisma.insumo.findMany({ where: { id: { in: lote } }, select: { id: true, codigoSKU: true, nombre: true, unidadMedida: true } })) insumos.set(i.id, i);
    }
    const decimal = (v: unknown) => (v === null || v === undefined ? null : new Prisma.Decimal(v as number));
    return detalles.map((d) => ({
      ...d,
      cantidadEnviada: decimal(d.cantidadEnviada),
      cantidadRecibida: decimal(d.cantidadRecibida),
      costoUnitarioUSD: decimal(d.costoUnitarioUSD),
      subtotalUSD: decimal(d.subtotalUSD),
      insumo: insumos.get(String(d.insumoId)) ?? null,
    }));
  }
}
