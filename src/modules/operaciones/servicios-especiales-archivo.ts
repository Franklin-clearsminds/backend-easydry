import { Prisma } from '@prisma/client';
import { textoBusqueda } from '../../common/utils/data-grid.helpers.js';
import type { Alcance } from '../../common/permisos/alcance.js';
import type { Termino, ValorFiltro } from '../archivado/archivo-lector.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { mezclarPagina, trozos } from '../archivado/mezcla.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Fila = Record<string, any>;

/** Los parámetros de `ServiciosEspecialesService.findAll` que afectan a qué filas salen. */
export interface ParamsEspeciales {
  regionId?: string;
  agenciaId?: string;
  sucursalId?: string;
  operadorId?: string;
  estado?: string;
  tipoServicio?: string;
  search?: string;
  fechaDesde?: string;
  fechaHasta?: string;
}

/** Columnas por las que se puede ordenar y que existen tal cual en el archivo. */
const COLUMNA_ARCHIVO: Record<string, string> = {
  fecha: 'createdAt',
  ot: 'ordenTrabajoOT',
  placa: 'placa',
  servicio: 'tipoServicio',
  estado: 'estado',
  tiempoPausa: 'tiempoPausaTotalSeg',
  tiempoEfectivo: 'tiempoEfectivoSeg',
};
const NUMERICAS = ['tiempoPausaTotalSeg', 'tiempoEfectivoSeg'];

const neutro = (v?: string) => (v && v !== 'Todas' && v !== 'TODAS' ? v : undefined);

/**
 * La parte archivada del listado de servicios especiales (`servicios-especiales/list`): aplica a las filas de Parquet el mismo
 * alcance por rol, los mismos filtros, la misma búsqueda, el mismo orden y el mismo resumen por estado que la consulta de la base, y
 * las devuelve con la forma de Prisma (agencia, región, operador y operadores asignados incluidos).
 *
 * Ojo: este listado filtra y ordena por `createdAt`, no por la fecha del evento (programada o creación) con la que se particionó el
 * archivo. Por eso se lee en todos los lotes y se filtra por esa columna; si no, un servicio creado en enero pero programado para
 * marzo quedaría en el lote de marzo y una búsqueda por enero no lo encontraría.
 */
export class ServiciosEspecialesArchivo {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historico: HistoricoService,
  ) {}

  private rango(p: ParamsEspeciales): { desde?: Date; hasta?: Date } {
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

  /** Estado que pide el filtro, con las mismas reglas que `findAll`. */
  private termino(estado?: string): Termino | null {
    if (!estado || estado === 'Todos' || estado === 'TODOS') return null;
    const q = estado.trim();
    if (q.toLowerCase() === 'en proceso') return { columna: 'estado', igual: ['En Proceso', 'EN_PROCESO', 'Pendiente', 'PENDIENTE'] };
    if (q.toLowerCase() === 'completado' || q.toLowerCase() === 'realizado') return { columna: 'estado', igual: ['Completado', 'FINALIZADO', 'COMPLETADO', 'Finalizado'] };
    return { columna: 'estado', igualInsensible: q };
  }

  private async usuariosQueContienen(palabra: string): Promise<string[]> {
    const usuarios = await this.prisma.user.findMany({ where: { OR: [{ name: { contains: palabra, mode: 'insensitive' } }, { lastname: { contains: palabra, mode: 'insensitive' } }] }, select: { id: true } });
    return usuarios.map((u) => u.id);
  }

  /** Las condiciones de todo lo que no es el estado, o `null` si el alcance no deja ver nada. */
  private async condiciones(p: ParamsEspeciales, alcance: Alcance, actor: { id?: string; esPulidor: boolean }): Promise<{ filtros: Record<string, ValorFiltro>; grupos: Termino[][] } | null> {
    const filtros: Record<string, ValorFiltro> = { deletedAt: null };
    const grupos: Termino[][] = [];
    const y = (columna: string, igual: ValorFiltro) => grupos.push([{ columna, igual }]);

    const propios = async () => {
      const asignados = await this.historico.idsDePadresPorHijo({ tabla: 'servicio_especial', hijo: 'servicio_especial_operador', filtros: { operadorId: actor.id ?? '' } });
      grupos.push([{ columna: 'operadorId', igual: actor.id ?? '' }, { columna: 'id', igual: asignados }]);
    };

    // 1. Alcance. Un pulidor solo ve los que tiene asignados, sin importar su ámbito.
    const pideRegion = neutro(p.regionId);
    const pideAgencia = neutro(p.agenciaId) || neutro(p.sucursalId);
    if (actor.esPulidor) {
      await propios();
    } else {
      switch (alcance.tipo) {
        case 'GLOBAL':
          if (pideRegion) filtros.regionId = pideRegion;
          if (pideAgencia) filtros.agenciaId = pideAgencia;
          break;
        case 'REGION': {
          // La región del propio servicio, o la de su agencia (los móviles zonales no tienen agencia).
          const agencias = await this.prisma.agencia.findMany({ where: { regionId: alcance.regionId }, select: { id: true } });
          grupos.push([{ columna: 'regionId', igual: alcance.regionId }, { columna: 'agenciaId', igual: agencias.map((a) => a.id) }]);
          if (pideAgencia) filtros.agenciaId = pideAgencia;
          break;
        }
        case 'AGENCIA':
          filtros.agenciaId = alcance.agenciaId;
          break;
        case 'PROPIO':
          await propios();
          break;
        default:
          return null;
      }
      if (p.operadorId) y('operadorId', p.operadorId);
    }

    // 2. Tipo de servicio (contiene, sin distinguir mayúsculas).
    if (p.tipoServicio && p.tipoServicio !== 'Todos' && p.tipoServicio !== 'TODOS') grupos.push([{ columna: 'tipoServicio', contiene: p.tipoServicio }]);

    // 3. Búsqueda: cada palabra (máx. 5) debe aparecer en alguno de estos campos, o en el nombre del operador.
    for (const palabra of this.palabras(p.search)) {
      grupos.push([
        ...['codigoSE', 'ordenTrabajoOT', 'placa', 'modelo', 'marca', 'clienteNombre', 'tipoServicio'].map((columna): Termino => ({ columna, contiene: palabra })),
        { columna: 'operadorId', igual: await this.usuariosQueContienen(palabra) },
      ]);
    }
    return { filtros, grupos };
  }

  /** `null` si el archivo no interviene (ningún lote o el alcance no deja ver nada): se sigue solo con la base. */
  async consultar(p: { params: ParamsEspeciales; alcance: Alcance; actor: { id?: string; esPulidor: boolean }; campo: string; dir: 'asc' | 'desc'; skip: number; take: number }): Promise<{ filas: Fila[]; total: number } | null> {
    const base = await this.condiciones(p.params, p.alcance, p.actor);
    if (!base) return null;
    const grupos = [...base.grupos];
    const estado = this.termino(p.params.estado);
    if (estado) grupos.push([estado]);

    const columna = COLUMNA_ARCHIVO[p.campo];
    const resultado = await this.historico.listarArchivo({
      tabla: 'servicio_especial',
      ...this.rango(p.params),
      columnaFecha: 'createdAt',
      filtros: base.filtros,
      grupos,
      // Orden por una columna del archivo: basta leer las primeras filas. Por nombre (agencia, región, operador) hay que leer todas
      // las que cumplen el filtro, ponerles nombre y ordenar aquí.
      ordenPor: columna ? [{ columna, dir: p.dir }] : undefined,
      limite: columna ? p.skip + p.take : undefined,
    });
    if (!resultado) return null;
    return { filas: await this.enriquecer(resultado.filas), total: resultado.total };
  }

  /** Servicios por estado con los mismos filtros pero SIN el de estado (el resumen de la pantalla), o `null` si no interviene. */
  async resumen(p: { params: ParamsEspeciales; alcance: Alcance; actor: { id?: string; esPulidor: boolean } }): Promise<Record<string, number> | null> {
    const base = await this.condiciones(p.params, p.alcance, p.actor);
    if (!base) return null;
    return this.historico.contarPorArchivo({ tabla: 'servicio_especial', columna: 'estado', ...this.rango(p.params), columnaFecha: 'createdAt', filtros: base.filtros, grupos: base.grupos });
  }

  /** Mezcla filas de la base y del archivo con el orden pedido y devuelve la página [skip, skip + take). */
  mezclar(deBase: Fila[], archivo: Fila[], campo: string, dir: 'asc' | 'desc', skip: number, take: number): Fila[] {
    const valor = (f: Fila): number | string | null => {
      switch (campo) {
        case 'agencia': return f.agencia?.nombre ?? null;
        case 'region': return f.region?.nombre ?? null;
        case 'operador': return f.operador?.name ?? null;
        default: {
          const col = COLUMNA_ARCHIVO[campo] ?? 'createdAt';
          const v = f[col];
          if (v === null || v === undefined) return null;
          return col === 'createdAt' ? (v as Date).getTime() : NUMERICAS.includes(col) ? Number(v) : (v as string);
        }
      }
    };
    return mezclarPagina([...deBase, ...archivo], valor, dir, skip, take);
  }

  /** Les pone agencia, región, operador y operadores asignados (de los maestros y del archivo) y convierte el precio a Decimal. */
  private async enriquecer(filas: Fila[]): Promise<Fila[]> {
    if (!filas.length) return [];
    const unicos = (campo: string) => [...new Set(filas.map((f) => f[campo]).filter(Boolean) as string[])];
    const agencias = new Map<string, Fila>();
    for (const lote of trozos(unicos('agenciaId'))) {
      for (const a of await this.prisma.agencia.findMany({ where: { id: { in: lote } }, select: { id: true, nombre: true, codigo: true } })) agencias.set(a.id, a);
    }
    const regiones = new Map<string, Fila>();
    for (const lote of trozos(unicos('regionId'))) {
      for (const r of await this.prisma.region.findMany({ where: { id: { in: lote } }, select: { id: true, nombre: true, codigo: true } })) regiones.set(r.id, r);
    }
    const asignaciones = (await this.historico.hijosDe({ tabla: 'servicio_especial', hijo: 'servicio_especial_operador', idsPadre: filas.map((f) => String(f.id)) })).sort(
      (a, b) => Number(a.orden) - Number(b.orden) || (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() || String(a.id).localeCompare(String(b.id)),
    );

    const usuarios = new Map<string, Fila>();
    const idsUsuarios = [...new Set([...unicos('operadorId'), ...asignaciones.map((a) => String(a.operadorId))])];
    for (const lote of trozos(idsUsuarios)) {
      for (const u of await this.prisma.user.findMany({ where: { id: { in: lote } }, select: { id: true, name: true, lastname: true, email: true, regionId: true } })) usuarios.set(u.id, u);
    }

    return filas.map((f) => {
      // `fechaEvento` es una columna derivada del archivo, no existe en la tabla: no debe salir.
      const { fechaEvento: _derivada, ...fila } = f;
      return {
        ...fila,
        precio: fila.precio === null || fila.precio === undefined ? null : new Prisma.Decimal(fila.precio),
        agencia: f.agenciaId ? (agencias.get(f.agenciaId) ?? null) : null,
        operador: f.operadorId ? (usuarios.get(f.operadorId) ?? null) : null,
        operadoresAsignados: asignaciones
          .filter((a) => a.servicioId === f.id)
          .map((a) => {
            const u = usuarios.get(String(a.operadorId));
            return { id: a.id, servicioId: a.servicioId, operadorId: a.operadorId, orden: a.orden, createdAt: a.createdAt, operador: u ? { id: u.id, name: u.name, lastname: u.lastname } : null };
          }),
        region: f.regionId ? (regiones.get(f.regionId) ?? null) : null,
      };
    });
  }

  /**
   * El detalle de UN servicio especial archivado, por su id, `clientUuid`, código de servicio u orden de trabajo, con la forma de
   * `findOneRaw` (agencia, región, operador y operadores asignados en orden). Solo para LEER: lo archivado es inmutable. `null` si
   * no está archivado.
   */
  async detalle(id: string): Promise<Fila | null> {
    const fila = await this.historico.buscarUno({
      tabla: 'servicio_especial',
      grupos: [[{ columna: 'id', igual: id }, { columna: 'clientUuid', igual: id }, { columna: 'codigoSE', igualInsensible: id }, { columna: 'ordenTrabajoOT', igualInsensible: id }]],
    });
    if (!fila) return null;
    const asignaciones = (await this.historico.hijosDeFila({ tabla: 'servicio_especial', hijo: 'servicio_especial_operador', id: String(fila.id), fechaEvento: fila.fechaEvento as Date })).sort(
      (a, b) => Number(a.orden) - Number(b.orden) || (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime() || String(a.id).localeCompare(String(b.id)),
    );
    const [agencia, region] = await Promise.all([
      fila.agenciaId ? this.prisma.agencia.findUnique({ where: { id: String(fila.agenciaId) } }) : null,
      fila.regionId ? this.prisma.region.findUnique({ where: { id: String(fila.regionId) } }) : null,
    ]);
    const usuarios = new Map<string, Fila>();
    for (const u of await this.prisma.user.findMany({
      where: { id: { in: [...new Set([...(fila.operadorId ? [String(fila.operadorId)] : []), ...asignaciones.map((a) => String(a.operadorId))])] } },
      select: { id: true, name: true, lastname: true, email: true, regionId: true },
    })) usuarios.set(u.id, u);

    // `fechaEvento` es una columna derivada del archivo, no existe en la tabla: no debe salir.
    const { fechaEvento: _derivada, ...servicio } = fila;
    return {
      ...servicio,
      precio: fila.precio === null || fila.precio === undefined ? null : new Prisma.Decimal(fila.precio as number),
      agencia,
      operador: fila.operadorId ? (usuarios.get(String(fila.operadorId)) ?? null) : null,
      operadoresAsignados: asignaciones.map((a) => {
        const u = usuarios.get(String(a.operadorId));
        return { id: a.id, servicioId: a.servicioId, operadorId: a.operadorId, orden: a.orden, createdAt: a.createdAt, operador: u ? { id: u.id, name: u.name, lastname: u.lastname } : null };
      }),
      region,
    };
  }
}
