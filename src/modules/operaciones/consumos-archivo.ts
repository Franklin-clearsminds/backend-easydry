import { Prisma } from '@prisma/client';
import type { Termino, ValorFiltro } from '../archivado/archivo-lector.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { trozos } from '../archivado/mezcla.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;

/** Los parámetros de `listConsumosPorServicio` que afectan a qué líneas salen. */
export interface ParamsConsumos {
  agenciaId?: string;
  busqueda?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

/**
 * Una línea de consumo se guarda en el archivo del servicio al que pertenece, que se particiona por la fecha de ESE servicio. La
 * línea suele crearse el mismo día, pero puede crearse después (un consumo pendiente que se sincroniza más tarde): por eso los
 * archivos se buscan con esta holgura alrededor del rango pedido.
 */
const HOLGURA_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Las líneas de consumo archivadas para la pantalla "consumo por orden de trabajo": aplica a las de Parquet el mismo rango de
 * fechas, la misma búsqueda y el mismo filtro de agencia que la consulta de la base, y las devuelve con la forma de Prisma (insumo
 * y servicio con lo que la pantalla agrupa: OT, placa, catálogo, agencia y operador).
 */
export class ConsumosArchivo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  private rango(p: ParamsConsumos): { desde?: Date; hasta?: Date } {
    // Mismas fechas que la consulta de la base: de las 00:00 del día inicial a las 23:59:59.999 del final, en hora local.
    return {
      desde: p.fechaDesde ? new Date(`${p.fechaDesde}T00:00:00`) : undefined,
      hasta: p.fechaHasta ? new Date(new Date(`${p.fechaHasta}T23:59:59.999`).getTime() + 1) : undefined, // el archivo filtra con "menor": +1 ms
    };
  }

  private async padres(tabla: 'servicio_lavado' | 'servicio_especial', rango: { desde?: Date; hasta?: Date }, filtros: Record<string, ValorFiltro>, grupos: Termino[][]): Promise<Fila[]> {
    const r = await this.historico.listarArchivo({
      tabla,
      desde: rango.desde ? new Date(rango.desde.getTime() - HOLGURA_MS) : undefined,
      hasta: rango.hasta ? new Date(rango.hasta.getTime() + HOLGURA_MS) : undefined,
      filtros,
      grupos,
    });
    return r?.filas ?? [];
  }

  /** Líneas de consumo de servicios de lavado archivadas, con la forma de `consumoServicio.findMany({ include })`. */
  async generales(p: ParamsConsumos, limite: number): Promise<Fila[]> {
    const rango = this.rango(p);
    const grupos: Termino[][] = [];
    if (p.busqueda) {
      const [insumos, catalogos] = await Promise.all([
        this.prisma.insumo.findMany({ where: { nombre: { contains: p.busqueda, mode: 'insensitive' } }, select: { id: true } }),
        this.prisma.catalogoServicio.findMany({ where: { nombre: { contains: p.busqueda, mode: 'insensitive' } }, select: { id: true } }),
      ]);
      const padres = await this.padres('servicio_lavado', rango, {}, [[{ columna: 'ordenTrabajoOT', contiene: p.busqueda }, { columna: 'placa', contiene: p.busqueda }, { columna: 'servicioCatalogoId', igual: catalogos.map((c) => c.id as unknown as string) }]]);
      grupos.push([{ columna: 'insumoNombre', contiene: p.busqueda }, { columna: 'insumoId', igual: insumos.map((i) => i.id) }, { columna: 'servicioId', igual: padres.map((x) => String(x.id)) }]);
    }
    const lineas = await this.historico.listarHijos({
      hijo: 'consumo_servicio',
      columnaFecha: 'createdAt',
      ...rango,
      holguraMs: HOLGURA_MS,
      filtros: p.agenciaId ? { agenciaId: p.agenciaId } : {},
      grupos,
      ordenPor: [{ columna: 'createdAt', dir: 'desc' }],
      limite,
    });
    if (!lineas.length) return [];
    const [insumos, servicios] = await Promise.all([this.insumosDe(lineas), this.serviciosGenerales(lineas, rango)]);
    return lineas.map((l) => ({
      ...l,
      cantidadUsada: new Prisma.Decimal(l.cantidadUsada as number),
      insumo: insumos.get(String(l.insumoId)) ?? null,
      servicio: servicios.get(String(l.servicioId)) ?? null,
    }));
  }

  /** Líneas de consumo de servicios especiales archivadas, con la forma de `consumoServicioEspecial.findMany({ include })`. */
  async especiales(p: ParamsConsumos, limite: number): Promise<Fila[]> {
    const rango = this.rango(p);
    const grupos: Termino[][] = [];
    // El filtro de agencia y la búsqueda dependen de datos del servicio padre: se resuelven primero en sus archivos.
    if (p.agenciaId) {
      const padres = await this.padres('servicio_especial', rango, { agenciaId: p.agenciaId }, []);
      grupos.push([{ columna: 'servicioEspecialId', igual: padres.map((x) => String(x.id)) }]);
    }
    if (p.busqueda) {
      const insumos = await this.prisma.insumo.findMany({ where: { nombre: { contains: p.busqueda, mode: 'insensitive' } }, select: { id: true } });
      const padres = await this.padres('servicio_especial', rango, {}, [
        ['codigoSE', 'ordenTrabajoOT', 'placa', 'tipoServicio'].map((columna): Termino => ({ columna, contiene: p.busqueda! })),
      ]);
      grupos.push([{ columna: 'insumoNombre', contiene: p.busqueda }, { columna: 'insumoId', igual: insumos.map((i) => i.id) }, { columna: 'servicioEspecialId', igual: padres.map((x) => String(x.id)) }]);
    }
    const lineas = await this.historico.listarHijos({ hijo: 'consumo_servicio_especial', columnaFecha: 'createdAt', ...rango, holguraMs: HOLGURA_MS, grupos, ordenPor: [{ columna: 'createdAt', dir: 'desc' }], limite });
    if (!lineas.length) return [];
    const [insumos, servicios] = await Promise.all([this.insumosDe(lineas), this.serviciosEspeciales(lineas, rango)]);
    return lineas.map((l) => ({
      ...l,
      cantidadUsada: new Prisma.Decimal(l.cantidadUsada as number),
      insumo: insumos.get(String(l.insumoId)) ?? null,
      servicioEspecial: servicios.get(String(l.servicioEspecialId)) ?? null,
    }));
  }

  private async insumosDe(lineas: Fila[]): Promise<Map<string, Fila>> {
    const m = new Map<string, Fila>();
    for (const lote of trozos([...new Set(lineas.map((l) => String(l.insumoId)))])) {
      for (const i of await this.prisma.insumo.findMany({ where: { id: { in: lote } }, select: { id: true, nombre: true, codigoSKU: true, unidadMedida: { select: { simbolo: true } } } })) {
        m.set(i.id, { nombre: i.nombre, codigoSKU: i.codigoSKU, unidadMedida: i.unidadMedida });
      }
    }
    return m;
  }

  private ventanaDe(lineas: Fila[]): { desde?: Date; hasta?: Date } {
    const t = lineas.map((l) => (l.createdAt as Date).getTime());
    return { desde: new Date(Math.min(...t)), hasta: new Date(Math.max(...t) + 1) };
  }

  private async serviciosGenerales(lineas: Fila[], _rango: { desde?: Date; hasta?: Date }): Promise<Map<string, Fila>> {
    const ids = [...new Set(lineas.map((l) => String(l.servicioId)))];
    const padres = await this.padres('servicio_lavado', this.ventanaDe(lineas), {}, [[{ columna: 'id', igual: ids }]]);
    const [catalogos, bahias, usuarios] = await Promise.all([
      this.prisma.catalogoServicio.findMany({ where: { id: { in: [...new Set(padres.map((x) => Number(x.servicioCatalogoId)))] } }, select: { id: true, nombre: true } }),
      this.prisma.bahia.findMany({ where: { id: { in: [...new Set(padres.map((x) => String(x.bahiaId)))] } }, select: { id: true, agencia: { select: { nombre: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(padres.map((x) => String(x.operadorId)))] } }, select: { id: true, name: true, lastname: true } }),
    ]);
    const cat = new Map(catalogos.map((c) => [c.id, c.nombre]));
    const bah = new Map(bahias.map((b) => [b.id, b.agencia]));
    const usu = new Map(usuarios.map((u) => [u.id, { name: u.name, lastname: u.lastname }]));
    return new Map(
      padres.map((x) => [
        String(x.id),
        {
          id: x.id,
          ordenTrabajoOT: x.ordenTrabajoOT,
          placa: x.placa,
          catalogo: cat.has(Number(x.servicioCatalogoId)) ? { nombre: cat.get(Number(x.servicioCatalogoId)) } : null,
          bahia: bah.has(String(x.bahiaId)) ? { agencia: bah.get(String(x.bahiaId)) } : null,
          operador: usu.get(String(x.operadorId)) ?? null,
        },
      ]),
    );
  }

  private async serviciosEspeciales(lineas: Fila[], _rango: { desde?: Date; hasta?: Date }): Promise<Map<string, Fila>> {
    const ids = [...new Set(lineas.map((l) => String(l.servicioEspecialId)))];
    const padres = await this.padres('servicio_especial', this.ventanaDe(lineas), {}, [[{ columna: 'id', igual: ids }]]);
    const [agencias, usuarios] = await Promise.all([
      this.prisma.agencia.findMany({ where: { id: { in: [...new Set(padres.map((x) => x.agenciaId).filter(Boolean) as string[])] } }, select: { id: true, nombre: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(padres.map((x) => x.operadorId).filter(Boolean) as string[])] } }, select: { id: true, name: true, lastname: true } }),
    ]);
    const ag = new Map(agencias.map((a) => [a.id, { nombre: a.nombre }]));
    const usu = new Map(usuarios.map((u) => [u.id, { name: u.name, lastname: u.lastname }]));
    return new Map(
      padres.map((x) => [
        String(x.id),
        {
          id: x.id,
          codigoSE: x.codigoSE,
          ordenTrabajoOT: x.ordenTrabajoOT,
          tipoServicio: x.tipoServicio,
          placa: x.placa,
          agencia: x.agenciaId ? (ag.get(String(x.agenciaId)) ?? null) : null,
          operador: x.operadorId ? (usu.get(String(x.operadorId)) ?? null) : null,
        },
      ]),
    );
  }
}
