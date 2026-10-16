import { Prisma, ServiceStatus } from '@prisma/client';
import { textoBusqueda } from '../../common/utils/data-grid.helpers.js';
import type { Alcance } from '../../common/permisos/alcance.js';
import type { Termino, ValorFiltro } from '../archivado/archivo-lector.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { mezclarPagina, trozos } from '../archivado/mezcla.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;

/** Los parámetros de `OperacionesService.findAll` que afectan a qué filas salen. */
export interface ParamsServicios {
  agenciaId?: string;
  sucursalId?: string;
  regionId?: string;
  estado?: string;
  search?: string;
  bahiaId?: string;
  operadorId?: string;
  servicioId?: number;
  clienteId?: string;
  agenciaNombre?: string;
  bahiaNombre?: string;
  operadorNombre?: string;
  clienteNombre?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

/** Columnas por las que se puede ordenar y que existen tal cual en el archivo. */
const COLUMNA_ARCHIVO: Record<string, string> = {
  fecha: 'horaIngreso',
  createdAt: 'createdAt',
  ot: 'ordenTrabajoOT',
  placa: 'placa',
  modelo: 'modelo',
  cliente: 'cliente',
};
const TIMESTAMPS = ['horaIngreso', 'createdAt'];

const noTodas = (v?: string) => (v && v !== 'Todas' && v !== 'TODAS' ? v : undefined);

/**
 * El orden REAL de los valores del enum `ServiceStatus` en la base. Postgres ordena un enum por el orden en que se fueron
 * añadiendo sus valores (migración tras migración), que no tiene por qué coincidir con el de `schema.prisma`. Se lee una vez.
 */
let ordenEstadosEnBase: Promise<string[]> | null = null;

/**
 * La parte archivada del listado de servicios de lavado (`servicios/list`): aplica a las filas de Parquet el mismo alcance por rol,
 * los mismos filtros, la misma búsqueda, el mismo orden y el mismo resumen por estado que la consulta de la base, y las devuelve con
 * la forma completa de Prisma (bahía con su agencia, catálogo con sus recetas, operador y operadores asignados) para que el
 * serializador y el cliente no noten diferencia.
 *
 * Lo archivado nunca incluye servicios sin decidir (EN_ESPERA, EN_PROCESO, FINALIZADO), así que esos estados no devuelven nada.
 */
export class ServiciosArchivo {
  /** Orden de los estados; solo se carga cuando se ordena por estado. */
  private ordenEstados: string[] = Object.values(ServiceStatus);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  private rango(p: ParamsServicios): { desde?: Date; hasta?: Date } {
    const valida = (v?: string) => {
      const d = v ? new Date(v) : null;
      return d && !Number.isNaN(d.getTime()) ? d : undefined;
    };
    const hasta = valida(p.fechaHasta);
    // La base filtra con "menor o igual" y el archivo con "menor": se suma un milisegundo.
    return { desde: valida(p.fechaDesde), hasta: hasta ? new Date(hasta.getTime() + 1) : undefined };
  }

  private palabras(texto?: string): string[] {
    return (textoBusqueda(texto)?.split(' ') ?? []).slice(0, 5);
  }

  /** Estados que pide el filtro. Mismas reglas que `findAll` (no se toca nada si el estado no es reconocible). */
  private estados(estado?: string): { estados?: string[]; aprobadoPorNulo?: boolean } {
    if (!estado || estado === 'Todos' || estado === 'TODOS') return {};
    const st = String(estado).toUpperCase().trim();
    if (st === 'EN_PROCESO' || st === 'EN PROCESO') return { estados: ['EN_ESPERA', 'EN_PROCESO'] };
    if (st === 'POR_APROBAR' || st === 'POR APROBAR' || st === 'FALTAN DE APROBAR') return { estados: ['FINALIZADO'], aprobadoPorNulo: true };
    if (st === 'APROBADO' || st === 'APROBADOS') return { estados: ['APROBADO'] };
    if (st === 'FINALIZADO' || st === 'REALIZADO' || st === 'REALIZADOS') return { estados: ['FINALIZADO', 'APROBADO'] };
    if (st === 'RECHAZADO' || st === 'RECHAZADOS') return { estados: ['RECHAZADO'] };
    if (st === 'CANCELADO' || st === 'CANCELADOS') return { estados: ['CANCELADO'] };
    if (['EN_ESPERA', 'FINALIZADO'].includes(st)) return { estados: [st] };
    return {};
  }

  /** Las condiciones de todo lo que no es el estado, o `null` si el alcance no deja ver nada. */
  private async condiciones(p: ParamsServicios, alcance: Alcance, usuarioId: string | undefined, rango: { desde?: Date; hasta?: Date }): Promise<{ filtros: Record<string, ValorFiltro>; grupos: Termino[][] } | null> {
    const filtros: Record<string, ValorFiltro> = { deletedAt: null };
    const grupos: Termino[][] = [];
    const y = (columna: string, igual: ValorFiltro) => grupos.push([{ columna, igual }]);

    // 1. Alcance del usuario. Un id de agencia o región del cliente solo acota dentro de él.
    const pideAgencia = [p.agenciaId, p.sucursalId].find((v) => noTodas(v));
    const pideRegion = noTodas(p.regionId);
    let operadorPropioId: string | undefined;
    switch (alcance.tipo) {
      case 'GLOBAL':
        if (pideAgencia) filtros.agenciaId = pideAgencia;
        else if (pideRegion) filtros.regionId = pideRegion;
        break;
      case 'REGION':
        filtros.regionId = alcance.regionId;
        if (pideAgencia) y('agenciaId', pideAgencia);
        break;
      case 'AGENCIA':
        filtros.agenciaId = alcance.agenciaId;
        break;
      case 'PROPIO':
        operadorPropioId = usuarioId;
        break;
      default:
        return null;
    }

    // 2. Filtros adicionales.
    if (p.bahiaId) {
      const ids = String(p.bahiaId).split(',').map((v) => v.trim()).filter(Boolean);
      if (ids.length) y('bahiaId', ids);
    }
    if (p.servicioId !== undefined && p.servicioId !== null && String(p.servicioId) !== '' && Number.isInteger(Number(p.servicioId))) y('servicioCatalogoId', Number(p.servicioId));
    const igual = (valor: string) => ({ equals: valor.trim(), mode: 'insensitive' as const });
    if (p.clienteId) y('agenciaId', (await this.prisma.agencia.findMany({ where: { clienteId: p.clienteId }, select: { id: true } })).map((a) => a.id));
    if (p.agenciaNombre?.trim()) y('agenciaId', (await this.prisma.agencia.findMany({ where: { nombre: igual(p.agenciaNombre) }, select: { id: true } })).map((a) => a.id));
    if (p.bahiaNombre?.trim()) y('bahiaId', (await this.prisma.bahia.findMany({ where: { nombre: igual(p.bahiaNombre) }, select: { id: true } })).map((b) => b.id));
    if (p.clienteNombre?.trim()) y('agenciaId', (await this.prisma.agencia.findMany({ where: { cliente: { nombre: igual(p.clienteNombre) } }, select: { id: true } })).map((a) => a.id));

    for (const palabra of this.palabras(p.operadorNombre)) y('operadorId', await this.usuariosQueContienen(palabra));

    // Un lavador solo ve sus servicios (los que hizo o en los que fue asignado): no puede pedir los de otro.
    const operadorFiltro = operadorPropioId || p.operadorId;
    if (operadorFiltro) {
      const asignados = await this.historico.idsDePadresPorHijo({ tabla: 'servicio_lavado', hijo: 'servicio_lavado_operador', desde: rango.desde, hasta: rango.hasta, filtros: { operadorId: operadorFiltro } });
      grupos.push([{ columna: 'operadorId', igual: operadorFiltro }, { columna: 'id', igual: asignados }]);
    }

    // 3. Búsqueda: cada palabra (máx. 5) debe aparecer en alguno de estos campos, o en el nombre del operador.
    for (const palabra of this.palabras(p.search)) {
      grupos.push([
        { columna: 'placa', contiene: palabra },
        { columna: 'modelo', contiene: palabra },
        { columna: 'marca', contiene: palabra },
        { columna: 'cliente', contiene: palabra },
        { columna: 'ordenTrabajoOT', contiene: palabra },
        { columna: 'operadorId', igual: await this.usuariosQueContienen(palabra) },
      ]);
    }
    return { filtros, grupos };
  }

  private async usuariosQueContienen(palabra: string): Promise<string[]> {
    const usuarios = await this.prisma.user.findMany({ where: { OR: [{ name: { contains: palabra, mode: 'insensitive' } }, { lastname: { contains: palabra, mode: 'insensitive' } }] }, select: { id: true } });
    return usuarios.map((u) => u.id);
  }

  /** `null` si el archivo no interviene (ningún lote toca el rango o el alcance no deja ver nada): se sigue solo con la base. */
  async consultar(p: { params: ParamsServicios; alcance: Alcance; usuarioId?: string; campo: string; dir: 'asc' | 'desc'; skip: number; take: number }): Promise<{ filas: Fila[]; total: number } | null> {
    const rango = this.rango(p.params);
    const base = await this.condiciones(p.params, p.alcance, p.usuarioId, rango);
    if (!base) return null;
    const { estados, aprobadoPorNulo } = this.estados(p.params.estado);
    const grupos = [...base.grupos];
    if (estados) grupos.push([{ columna: 'estado', igual: estados }]);
    if (aprobadoPorNulo) grupos.push([{ columna: 'aprobadoPor', igual: null }]);

    if (p.campo === 'estado') this.ordenEstados = await this.leerOrdenEstados();
    const columna = COLUMNA_ARCHIVO[p.campo];
    const resultado = await this.historico.listarArchivo({
      tabla: 'servicio_lavado',
      ...rango,
      filtros: base.filtros,
      grupos,
      // Orden por una columna del archivo: basta leer las primeras filas. Por estado o por nombre (servicio, operador, agencia, bahía) hay que
      // leer todas las que cumplen el filtro, ponerles nombre y ordenar aquí.
      ordenPor: columna ? [{ columna, dir: p.dir }] : undefined,
      limite: columna ? p.skip + p.take : undefined,
    });
    if (!resultado) return null;
    return { filas: await this.enriquecer(resultado.filas, rango), total: resultado.total };
  }

  private leerOrdenEstados(): Promise<string[]> {
    ordenEstadosEnBase ??= this.prisma
      .$queryRawUnsafe<Array<{ enumlabel: string }>>(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ServiceStatus' ORDER BY e.enumsortorder`)
      .then((filas) => filas.map((f) => f.enumlabel))
      .catch(() => {
        ordenEstadosEnBase = null;
        return Object.values(ServiceStatus) as string[];
      });
    return ordenEstadosEnBase;
  }

  /** Servicios por estado con los mismos filtros pero SIN el de estado (el resumen de la pantalla), o `null` si no interviene. */
  async resumen(p: { params: ParamsServicios; alcance: Alcance; usuarioId?: string }): Promise<Record<string, number> | null> {
    const rango = this.rango(p.params);
    const base = await this.condiciones(p.params, p.alcance, p.usuarioId, rango);
    if (!base) return null;
    return this.historico.contarPorArchivo({ tabla: 'servicio_lavado', columna: 'estado', ...rango, filtros: base.filtros, grupos: base.grupos });
  }

  /** Mezcla filas de la base y del archivo con el orden pedido y devuelve la página [skip, skip + take). */
  mezclar(deBase: Fila[], archivo: Fila[], campo: string, dir: 'asc' | 'desc', skip: number, take: number): Fila[] {
    const valor = (f: Fila): number | string | null => {
      switch (campo) {
        // `estado` es un enum de Postgres: se ordena por el orden del enum en la base, no por el texto.
        case 'estado': return this.ordenEstados.indexOf(f.estado);
        case 'servicio': return f.catalogo?.nombre ?? null;
        case 'operador': return f.operador?.name ?? null;
        case 'agencia': return f.bahia?.agencia?.nombre ?? null;
        case 'bahia': return f.bahia?.nombre ?? null;
        default: {
          const v = f[COLUMNA_ARCHIVO[campo] ?? 'horaIngreso'];
          return v === null || v === undefined ? null : TIMESTAMPS.includes(COLUMNA_ARCHIVO[campo] ?? 'horaIngreso') ? (v as Date).getTime() : (v as string);
        }
      }
    };
    return mezclarPagina([...deBase, ...archivo], valor, dir, skip, take);
  }

  /** Les pone bahía y agencia, catálogo con recetas, operador y operadores asignados (de los maestros y del archivo). */
  private async enriquecer(filas: Fila[], rango: { desde?: Date; hasta?: Date }): Promise<Fila[]> {
    if (!filas.length) return [];
    const bahias = new Map<string, Fila>();
    for (const lote of trozos([...new Set(filas.map((f) => String(f.bahiaId)))])) {
      for (const b of await this.prisma.bahia.findMany({ where: { id: { in: lote } }, include: { agencia: { select: { id: true, nombre: true, codigo: true, regionId: true } } } })) bahias.set(b.id, b);
    }
    const catalogos = new Map<number, Fila>();
    for (const lote of trozos([...new Set(filas.map((f) => Number(f.servicioCatalogoId)))])) {
      for (const c of await this.prisma.catalogoServicio.findMany({
        where: { id: { in: lote } },
        include: { recetas: { include: { insumo: { select: { codigoSKU: true, nombre: true } }, unidadConsumo: { select: { codigo: true, simbolo: true } } } } },
      })) catalogos.set(c.id, c);
    }
    const asignaciones = (await this.historico.hijosDe({ tabla: 'servicio_lavado', hijo: 'servicio_lavado_operador', idsPadre: filas.map((f) => String(f.id)), ...rango }))
      .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() || String(a.id).localeCompare(String(b.id)));

    const usuarios = new Map<string, Fila>();
    const idsUsuarios = [...new Set([...filas.map((f) => String(f.operadorId)), ...asignaciones.map((a) => String(a.operadorId))])];
    for (const lote of trozos(idsUsuarios)) {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: lote } }, select: { id: true, name: true, lastname: true, email: true } })) usuarios.set(u.id, u);
    }

    return filas.map((f) => ({
      ...f,
      bahia: bahias.get(String(f.bahiaId)) ?? null,
      catalogo: catalogos.get(Number(f.servicioCatalogoId)) ?? null,
      operador: usuarios.get(String(f.operadorId)) ?? null,
      operadoresAsignados: asignaciones
        .filter((a) => a.servicioId === f.id)
        .map((a) => ({ id: a.id, servicioId: a.servicioId, operadorId: a.operadorId, createdAt: a.createdAt, operador: usuarios.get(String(a.operadorId)) ?? null })),
    }));
  }

  /**
   * El detalle de UN servicio archivado, por su id o su `clientUuid`, con la misma forma que `findOneRaw` (bahía con su agencia,
   * catálogo con sus recetas, operador, operadores asignados, consumos y evidencias). Es solo para LEER: lo archivado es inmutable,
   * así que las rutas que modifican un servicio siguen sin encontrarlo, como debe ser. `null` si no está archivado.
   */
  async detalle(id: string): Promise<Fila | null> {
    const fila = await this.historico.buscarUno({ tabla: 'servicio_lavado', grupos: [[{ columna: 'id', igual: id }, { columna: 'clientUuid', igual: id }]] });
    if (!fila) return null;
    const fecha = fila.horaIngreso as Date;
    const hijos = (hijo: string) => this.historico.hijosDeFila({ tabla: 'servicio_lavado', hijo, id: String(fila.id), fechaEvento: fecha });
    const [consumos, evidencias, asignaciones] = await Promise.all([hijos('consumo_servicio'), hijos('evidencia_servicio'), hijos('servicio_lavado_operador')]);
    const porCreacion = (a: Fila, b: Fila) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() || String(a.id).localeCompare(String(b.id));

    const [bahia, catalogo] = await Promise.all([
      this.prisma.bahia.findUnique({ where: { id: String(fila.bahiaId) }, include: { agencia: true } }),
      this.prisma.catalogoServicio.findUnique({
        where: { id: Number(fila.servicioCatalogoId) },
        include: {
          recetas: {
            include: {
              insumo: { select: { id: true, codigoSKU: true, nombre: true, categoria: true, stockMinimoAgencia: true, costoUnitarioUSD: true, unidadMedida: { select: { simbolo: true } } } },
              unidadConsumo: { select: { codigo: true, simbolo: true, factorBase: true } },
            },
          },
        },
      }),
    ]);
    const usuarios = new Map<string, Fila>();
    for (const u of await this.prisma.user.findMany({
      where: { id: { in: [...new Set([String(fila.operadorId), ...asignaciones.map((a) => String(a.operadorId))])] } },
      select: { id: true, name: true, lastname: true, email: true },
    })) usuarios.set(u.id, u);
    const insumos = new Map<string, Fila>();
    for (const i of await this.prisma.insumo.findMany({ where: { id: { in: [...new Set(consumos.map((c) => String(c.insumoId)))] } }, select: { id: true, codigoSKU: true, nombre: true } })) insumos.set(i.id, { codigoSKU: i.codigoSKU, nombre: i.nombre });

    // `agenciaId` y `regionId` son columnas derivadas del archivo (se copian de la bahía al archivar): no existen en la tabla.
    const { agenciaId: _a, regionId: _r, ...servicio } = fila;
    return {
      ...servicio,
      precio: fila.precio === null || fila.precio === undefined ? null : new Prisma.Decimal(fila.precio as number),
      bahia,
      catalogo,
      operador: usuarios.get(String(fila.operadorId)) ?? null,
      operadoresAsignados: asignaciones.sort(porCreacion).map((a) => ({ ...a, operador: usuarios.get(String(a.operadorId)) ?? null })),
      consumos: consumos.sort(porCreacion).map((c) => ({ ...c, cantidadUsada: new Prisma.Decimal(c.cantidadUsada as number), insumo: insumos.get(String(c.insumoId)) ?? null })),
      evidencias: evidencias.sort((a, b) => (a.tomadaEn as Date).getTime() - (b.tomadaEn as Date).getTime() || String(a.id).localeCompare(String(b.id))),
    };
  }
}
