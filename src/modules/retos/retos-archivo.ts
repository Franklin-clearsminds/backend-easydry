import type { Termino } from '../archivado/archivo-lector.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;

/**
 * Los archivos se eligen por la fecha del EVENTO del servicio (ingreso en lavado; fecha programada o de creación en especiales), no por
 * la de su cierre que usan los retos. Un servicio termina poco después de su evento: estas holguras cubren esa distancia al leer.
 */
const HOLGURA_LAVADO_MS = 30 * 24 * 60 * 60 * 1000;
const HOLGURA_ESPECIAL_MS = 90 * 24 * 60 * 60 * 1000;

export interface FiltroServiciosReto {
  desde: Date;
  hasta: Date;
  catalogoIds?: number[];
  regiones: string[];
  marcas: string[];
  sucursalesIds: string[];
}

/**
 * Los servicios ya archivados que cuentan para un reto: los mismos criterios que la consulta de la base (estado final bueno, no
 * anulados, cierre dentro de las fechas, catálogo y lugar del reto), con la misma forma de fila que `serviciosDelReto` consume.
 * Los retos cerrados hace más de 12 meses recalculan su avance con esto; si no, perderían los servicios que ya se archivaron.
 */
export class RetosArchivo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  /** Agencias que cumplen región, cliente y sucursales a la vez (o `null` si el reto no limita por agencia). */
  private async agenciasDelReto(f: FiltroServiciosReto): Promise<string[] | null> {
    const and: any[] = [];
    if (f.regiones.length) and.push({ regionRel: { nombre: { in: f.regiones } } });
    if (f.marcas.length) and.push({ cliente: { nombre: { in: f.marcas } } });
    if (f.sucursalesIds.length) and.push({ id: { in: f.sucursalesIds } });
    if (!and.length) return null;
    return (await this.prisma.agencia.findMany({ where: { AND: and }, select: { id: true } })).map((a) => a.id);
  }

  /** Servicios de lavado APROBADOS archivados, con la forma de `servicioLavado.findMany({ select })` de los retos. */
  async lavados(f: FiltroServiciosReto): Promise<Fila[]> {
    const agencias = await this.agenciasDelReto(f);
    if (agencias && !agencias.length) return [];
    const r = await this.historico.listarArchivo({
      tabla: 'servicio_lavado',
      desde: new Date(f.desde.getTime() - HOLGURA_LAVADO_MS),
      hasta: f.hasta, // el servicio termina después de ingresar: su ingreso siempre es anterior al fin del reto
      filtros: { estado: 'APROBADO', deletedAt: null, ...(f.catalogoIds ? { servicioCatalogoId: f.catalogoIds } : {}), ...(agencias ? { agenciaId: agencias } : {}) },
    });
    const filas = (r?.filas ?? []).filter((s) => s.horaSalida && (s.horaSalida as Date) >= f.desde && (s.horaSalida as Date) < f.hasta);
    if (!filas.length) return [];
    const hijos = await this.historico.hijosDe({ tabla: 'servicio_lavado', hijo: 'servicio_lavado_operador', idsPadre: filas.map((s) => String(s.id)), desde: new Date(f.desde.getTime() - HOLGURA_LAVADO_MS), hasta: f.hasta });
    return filas.map((s) => ({
      placa: s.placa,
      precio: s.precio,
      horaSalida: s.horaSalida,
      operadorId: s.operadorId,
      bahiaId: s.bahiaId,
      bahia: { agenciaId: s.agenciaId ?? null },
      operadoresAsignados: hijos.filter((h) => h.servicioId === s.id).map((h) => ({ operadorId: h.operadorId })),
    }));
  }

  /** Servicios especiales Completados archivados, con la forma de `servicioEspecial.findMany({ select })` de los retos. */
  async especiales(f: FiltroServiciosReto): Promise<Fila[]> {
    const grupos: Termino[][] = [];
    let enRegion: ((s: Fila) => boolean) | null = null;
    if (f.regiones.length) {
      const [agencias, regiones] = await Promise.all([
        this.prisma.agencia.findMany({ where: { regionRel: { nombre: { in: f.regiones } } }, select: { id: true } }),
        this.prisma.region.findMany({ where: { nombre: { in: f.regiones } }, select: { id: true } }),
      ]);
      const ag = new Set(agencias.map((a) => a.id));
      const rg = new Set(regiones.map((x) => x.id));
      // Un pulidor móvil no tiene agencia: su servicio se ubica por la región donde lo hizo.
      grupos.push([{ columna: 'agenciaId', igual: [...ag] }, { columna: 'regionId', igual: [...rg] }]);
      enRegion = (s) => (s.agenciaId ? ag.has(String(s.agenciaId)) : !!s.regionId && rg.has(String(s.regionId)));
    }
    if (f.marcas.length) {
      const agencias = await this.prisma.agencia.findMany({ where: { cliente: { nombre: { in: f.marcas } } }, select: { id: true } });
      grupos.push([{ columna: 'agenciaId', igual: agencias.map((a) => a.id) }]);
    }
    if (f.sucursalesIds.length) grupos.push([{ columna: 'agenciaId', igual: f.sucursalesIds }]);

    const ventana = { desde: new Date(f.desde.getTime() - HOLGURA_ESPECIAL_MS), hasta: new Date(f.hasta.getTime() + HOLGURA_ESPECIAL_MS) };
    const r = await this.historico.listarArchivo({
      tabla: 'servicio_especial',
      ...ventana,
      filtros: { estado: 'Completado', deletedAt: null, ...(f.catalogoIds ? { servicioCatalogoId: f.catalogoIds } : {}) },
      grupos,
    });
    const filas = (r?.filas ?? []).filter((s) => s.fechaFin && (s.fechaFin as Date) >= f.desde && (s.fechaFin as Date) < f.hasta && (!enRegion || enRegion(s)));
    if (!filas.length) return [];
    const hijos = await this.historico.hijosDe({ tabla: 'servicio_especial', hijo: 'servicio_especial_operador', idsPadre: filas.map((s) => String(s.id)), ...ventana });
    return filas.map((s) => ({
      placa: s.placa,
      precio: s.precio,
      fechaFin: s.fechaFin,
      operadorId: s.operadorId,
      bahiaId: s.bahiaId,
      agenciaId: s.agenciaId,
      operadoresAsignados: hijos.filter((h) => h.servicioId === s.id).map((h) => ({ operadorId: h.operadorId })),
    }));
  }
}
