import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { HistoricoService } from '../archivado/historico.service.js';

type Fila = Record<string, any>;

const LOTE = 1000;
const MARGEN_LINEAS_MS = 90 * 86_400_000;
const trozos = <T>(xs: T[], n = LOTE): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/**
 * Suma a los reportes lo que ya se archivó a Parquet. Cada método devuelve las filas con la MISMA forma que devuelve hoy la
 * consulta de Prisma del reporte correspondiente (relaciones incluidas), para que el armado del reporte no cambie. Los nombres
 * (catálogo, operadores) se resuelven aquí con los maestros, que nunca se archivan, igual que al leer de la base.
 *
 * El ámbito del rol llega ya resuelto como `agenciaIds`/`ubicaciones` y se aplica también al archivo.
 */
@Injectable()
export class ReportesArchivoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  private leer(c: Parameters<HistoricoService['leerArchivo']>[0]): Promise<{ filas: Fila[]; hijos: Record<string, Fila[]> }> {
    return this.historico.leerArchivo(c) as Promise<{ filas: Fila[]; hijos: Record<string, Fila[]> }>;
  }

  private async usuarios(ids: Array<string | null | undefined>): Promise<Map<string, { name: string; lastname: string }>> {
    const unicos = [...new Set(ids.filter((i): i is string => !!i))];
    const mapa = new Map<string, { name: string; lastname: string }>();
    for (const lote of trozos(unicos)) {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: lote } }, select: { id: true, name: true, lastname: true } })) mapa.set(u.id, { name: u.name, lastname: u.lastname });
    }
    return mapa;
  }

  private porClave(filas: Fila[] | undefined, clave: string): Map<string, Fila[]> {
    const mapa = new Map<string, Fila[]>();
    for (const f of filas ?? []) mapa.set(String(f[clave]), [...(mapa.get(String(f[clave])) ?? []), f]);
    return mapa;
  }

  /** Servicios de lavado archivados, con la forma de `servicioLavado.findMany` en `serviciosGenerales` y en la productividad. */
  async serviciosGenerales(p: { agenciaIds: string[]; gte: Date; lt: Date; estado?: string; lavadorId?: string }): Promise<Fila[]> {
    const { filas, hijos } = await this.leer({
      tabla: 'servicio_lavado',
      desde: p.gte,
      hasta: p.lt,
      filtrosArchivo: { agenciaId: p.agenciaIds, deletedAt: null, ...(p.estado ? { estado: p.estado } : {}) },
      conHijos: true,
      orden: 'asc',
    });
    if (!filas.length) return [];
    const asignados = this.porClave(hijos.servicio_lavado_operador, 'servicioId');
    const visibles = p.lavadorId ? filas.filter((f) => f.operadorId === p.lavadorId || (asignados.get(String(f.id)) ?? []).some((a) => a.operadorId === p.lavadorId)) : filas;

    const nombres = await this.usuarios(visibles.flatMap((f) => [f.operadorId, ...(asignados.get(String(f.id)) ?? []).map((a) => a.operadorId)]));
    const catalogos = new Map<number, string>();
    for (const lote of trozos([...new Set(visibles.map((f) => Number(f.servicioCatalogoId)))])) {
      for (const c of await this.prisma.catalogoServicio.findMany({ where: { id: { in: lote } }, select: { id: true, nombre: true } })) catalogos.set(c.id, c.nombre);
    }
    const persona = (id: string) => nombres.get(id) ?? { name: '', lastname: '' };

    return visibles.map((f) => ({
      ...f,
      bahia: { agenciaId: f.agenciaId },
      catalogo: catalogos.has(Number(f.servicioCatalogoId)) ? { nombre: catalogos.get(Number(f.servicioCatalogoId)) } : null,
      operador: persona(f.operadorId),
      operadoresAsignados: (asignados.get(String(f.id)) ?? []).map((a) => ({ operadorId: a.operadorId, operador: persona(a.operadorId) })),
    }));
  }

  /** Servicios especiales archivados, con la forma de `servicioEspecial.findMany` (con `operadoresAsignados` si se piden). */
  async serviciosEspeciales(p: { agenciaIds: string[]; gte: Date; lt: Date; estado?: string; conOperadores?: boolean; pulidorId?: string }): Promise<Fila[]> {
    const { filas, hijos } = await this.leer({
      tabla: 'servicio_especial',
      desde: p.gte,
      hasta: p.lt,
      filtrosArchivo: { agenciaId: p.agenciaIds, deletedAt: null, ...(p.estado ? { estado: p.estado } : {}) },
      conHijos: !!p.conOperadores || !!p.pulidorId,
      orden: 'asc',
    });
    if (!p.conOperadores && !p.pulidorId) return filas;
    const asignados = this.porClave((hijos.servicio_especial_operador ?? []).slice().sort((a, b) => Number(a.orden) - Number(b.orden)), 'servicioId');
    const conAsignados: Fila[] = filas.map((f) => ({ ...f, operadoresAsignados: (asignados.get(String(f.id)) ?? []).map((a) => ({ operadorId: a.operadorId })) }));
    // El pulidor puede ser el responsable del servicio o uno de los asignados.
    return p.pulidorId ? conAsignados.filter((f) => f.operadorId === p.pulidorId || f.operadoresAsignados.some((a: { operadorId: string }) => a.operadorId === p.pulidorId)) : conAsignados;
  }

  /** Movimientos de kardex archivados, con la forma de `kardexMovimiento.findMany({ include: { usuario } })`. */
  async kardex(p: { insumoId: string; ubicaciones: string[]; gte: Date; lt: Date }): Promise<Fila[]> {
    const { filas } = await this.leer({ tabla: 'kardex_movimiento', desde: p.gte, hasta: p.lt, filtrosArchivo: { insumoId: p.insumoId, ubicacionId: p.ubicaciones }, orden: 'asc' });
    if (!filas.length) return [];
    const nombres = await this.usuarios(filas.map((f) => f.usuarioId));
    return filas.map((f) => ({ ...f, usuario: f.usuarioId ? (nombres.get(f.usuarioId) ?? null) : null }));
  }

  /**
   * Líneas de consumo de servicios generales archivadas en el periodo (la línea guarda la agencia donde se hizo el servicio). Los
   * archivos de las líneas se particionan por la fecha de SU servicio, que suele ser la misma: se leen con un margen por si la línea
   * se creó después.
   */
  async consumosGenerales(p: { agenciaIds: string[]; gte: Date; lt: Date }): Promise<Fila[]> {
    return (await this.historico.listarHijos({ hijo: 'consumo_servicio', columnaFecha: 'createdAt', desde: p.gte, hasta: p.lt, holguraMs: MARGEN_LINEAS_MS, filtros: { agenciaId: p.agenciaIds } })) as Fila[];
  }

  /**
   * Líneas de consumo de servicios especiales archivadas en el periodo, con la agencia y la región de su servicio (la línea guarda solo
   * al pulidor). Un servicio sin agencia (pulidor móvil) cuenta solo si se piden `regionIds` y `incluirSinAgencia`.
   */
  async consumosEspeciales(p: { agenciaIds: string[]; regionIds: string[]; incluirSinAgencia: boolean; gte: Date; lt: Date }): Promise<Fila[]> {
    const lineas = (await this.historico.listarHijos({ hijo: 'consumo_servicio_especial', columnaFecha: 'createdAt', desde: p.gte, hasta: p.lt, holguraMs: MARGEN_LINEAS_MS })) as Fila[];
    if (!lineas.length) return [];
    const tiempos = lineas.map((l) => (l.createdAt as Date).getTime());
    const desde = new Date(Math.min(...tiempos) - 180 * 86_400_000);
    const hasta = new Date(Math.max(...tiempos) + 30 * 86_400_000);
    const padres = new Map<string, { agenciaId: string | null; regionId: string | null }>();
    for (const lote of trozos([...new Set(lineas.map((l) => String(l.servicioEspecialId)))])) {
      const r = await this.historico.listarArchivo({ tabla: 'servicio_especial', desde, hasta, filtros: { id: lote } });
      for (const f of r?.filas ?? []) padres.set(String(f.id), { agenciaId: (f.agenciaId as string | null) ?? null, regionId: (f.regionId as string | null) ?? null });
    }
    return lineas
      .map((l) => ({ ...l, ...(padres.get(String(l.servicioEspecialId)) ?? { agenciaId: null, regionId: null }), _conPadre: padres.has(String(l.servicioEspecialId)) }))
      .filter((l) => l._conPadre && (l.agenciaId ? p.agenciaIds.includes(l.agenciaId as string) : p.incluirSinAgencia && !!l.regionId && p.regionIds.includes(l.regionId as string)));
  }
}
