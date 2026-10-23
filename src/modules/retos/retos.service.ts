import { BadRequestException, ForbiddenException, Injectable, Logger, Optional, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { CacheService } from '../../common/cache/cache.service.js';
import { RetosArchivo } from './retos-archivo.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CerrarRetoDto, CreateRetoDto, ListRetosDto, UpdateRetoDto } from './dto/retos.dto.js';
import { columnasSimples, combinarWhere, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
import {
  CATEGORIA_POR_PARTICIPANTE,
  TIPOS_SERVICIO_POR_PARTICIPANTE,
  calcularRanking,
  fuentesDeServicios,
  hoyEcuador,
  rangoReto,
  serviciosPorPersona,
  type FilaRanking,
  type MetricaReto,
  type ModoGanador,
  type ParticipanteReto,
  type ParticipanteRanking,
  type ServicioContado,
  type TipoServicioReto,
} from './retos.reglas.js';

const ROLES_PULIDOR = ['PULIDOR'];
const ROLES_LAVADOR = ['LAVADOR', 'AUXILIAR'];

/** "Todas" (o nada) significa sin filtro. */
function filtroLista(valores: string[] | null | undefined): string[] {
  const lista = (valores || []).map((v) => String(v).trim()).filter(Boolean);
  return lista.some((v) => v.toLowerCase() === 'todas') ? [] : lista;
}

@Injectable()
export class RetosService {
  private readonly logger = new Logger(RetosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly historico?: HistoricoService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  async list(dto: ListRetosDto, user: any) {
    const where: any = {};

    if (dto.vigencia) {
      // Con `vigencia` (pantalla de retos) se ignoran los indicadores antiguos.
      if (dto.vigencia === 'ACTIVOS') {
        where.estado = 'ACTIVO';
      } else if (dto.vigencia === 'VENCIDOS') {
        where.fechaFin = { lt: hoyEcuador() };
      }
    } else if (dto.soloActivos !== false && !dto.incluirTodos) {
      where.estado = 'ACTIVO';
    }

    // Quien actúa en todo el país (administradores, jefe comercial) ve todos los retos; el resto, los de su región o agencia.
    if (resolverAlcance(user).tipo !== 'GLOBAL') {
      const regionNombre = String(user?.region?.nombre || '').trim();
      const agenciaId = String(user?.agenciaId || '').trim();
      const userId = String(user?.id || '').trim();
      const visibility: any[] = [
        {
          AND: [
            { regiones: { isEmpty: true } },
            { sucursalesIds: { isEmpty: true } },
            { pulidoresIds: { isEmpty: true } },
            { lavadoresIds: { isEmpty: true } },
          ],
        },
        { regiones: { has: 'Todas' } },
      ];
      if (regionNombre) visibility.push({ regiones: { has: regionNombre } });
      if (agenciaId) visibility.push({ sucursalesIds: { has: agenciaId } });
      if (userId) visibility.push({ pulidoresIds: { has: userId } }, { lavadoresIds: { has: userId } });
      where.AND = [...(where.AND || []), { OR: visibility }];
    }

    const filtros = combinarWhere(where, whereBusqueda(['titulo', 'descripcion', 'premio'], dto.search));
    return listarPaginable(dto, {
      where: filtros,
      columnas: columnasSimples({ titulo: 'titulo', inicio: 'fechaInicio', fin: 'fechaFin', estado: 'estado', fecha: 'fechaInicio' }),
      ordenHeredado: [{ fechaInicio: 'desc' }, { createdAt: 'desc' }],
      mapear: (items) => this.enriquecerRetos(items),
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.reto.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: { catalogoServicio: { select: { nombre: true } } },
        }),
      contar: (w) => this.prisma.reto.count({ where: w }),
    });
  }

  async create(dto: CreateRetoDto, user: any) {
    // El permiso «retos.crear» ya se exigió en el controlador. El alcance regional se valida también para lo elegido
    // (agencias, bahías y personas), sin confiar en la lista enviada por el cliente.
    const alcance = resolverAlcance(user);
    const tipoReto: ParticipanteReto = dto.tipoReto || 'AGENCIA';
    const tipoServicios: TipoServicioReto = dto.tipoServicios || TIPOS_SERVICIO_POR_PARTICIPANTE[tipoReto][0];
    const metrica: MetricaReto = dto.metrica || 'SERVICIOS';
    const modoGanador: ModoGanador = dto.modoGanador || 'RANKING';
    const regiones = this.cleanList(dto.regiones);
    const marcas = this.cleanList(dto.marcas);
    const sucursalesIds = this.cleanList(dto.sucursalesIds);
    const pulidoresIds = tipoReto === 'PULIDOR' ? this.cleanList(dto.pulidoresIds) : [];
    const lavadoresIds = tipoReto === 'LAVADOR' ? this.cleanList(dto.lavadoresIds) : [];

    if (!TIPOS_SERVICIO_POR_PARTICIPANTE[tipoReto].includes(tipoServicios)) {
      throw new BadRequestException(
        tipoReto === 'LAVADOR'
          ? 'Los lavadores solo compiten con servicios generales.'
          : 'Los pulidores solo compiten con servicios especiales.',
      );
    }

    const catalogoServicioIds = tipoServicios === 'ESPECIFICOS'
      ? [...new Set([...(dto.catalogoServicioIds || []), ...(dto.catalogoServicioId ? [dto.catalogoServicioId] : [])])]
      : [];
    if (tipoServicios === 'ESPECIFICOS') {
      if (!catalogoServicioIds.length) throw new BadRequestException('Selecciona uno o varios servicios a contar.');
      const categoria = CATEGORIA_POR_PARTICIPANTE[tipoReto];
      const validos = await this.prisma.catalogoServicio.count({
        where: { id: { in: catalogoServicioIds }, estado: 'Activo', ...(categoria ? { categoria } : {}) },
      });
      if (validos !== catalogoServicioIds.length) {
        throw new BadRequestException(
          categoria
            ? `Uno o varios servicios no existen, están inactivos o no son ${categoria === 'GENERAL' ? 'generales' : 'especiales'}.`
            : 'Uno o varios servicios seleccionados no existen o están inactivos.',
        );
      }
    }

    const cantidadGanadores = modoGanador === 'RANKING' ? Math.max(1, Math.floor(dto.cantidadGanadores ?? 1)) : 1;
    const meta = modoGanador === 'META' ? Number(dto.meta) : null;
    if (modoGanador === 'META' && !(meta! > 0)) {
      throw new BadRequestException('Indica la meta que hay que alcanzar.');
    }
    if (meta !== null && metrica !== 'MONTO' && !Number.isInteger(meta)) {
      throw new BadRequestException('La meta de servicios o autos debe ser un número entero.');
    }

    let regionId: string | null = null;
    if (alcance.tipo !== 'GLOBAL') {
      if (alcance.tipo !== 'REGION') {
        throw new ForbiddenException('Tu usuario no tiene una región asignada para crear retos.');
      }
      const miRegion = String(user?.region?.nombre || '').trim();
      if (!miRegion) throw new ForbiddenException('Tu usuario no tiene una región asignada para crear retos.');
      if (regiones.length === 0 || regiones.some((r) => r.toLowerCase() !== miRegion.toLowerCase())) {
        throw new ForbiddenException(`Solo puedes crear retos para tu región (${miRegion}).`);
      }
      regionId = alcance.regionId;
    }

    if (sucursalesIds.length) {
      const propias = await this.prisma.agencia.count({ where: { id: { in: sucursalesIds }, ...(regionId ? { regionId } : {}) } });
      if (propias !== sucursalesIds.length) {
        throw new ForbiddenException(regionId ? 'Algunas agencias no pertenecen a tu región.' : 'Algunas agencias no existen.');
      }
    }
    const personas = tipoReto === 'PULIDOR' ? pulidoresIds : lavadoresIds;
    if (personas.length) {
      const encontradas = await this.prisma.user.count({ where: this.wherePersonas(tipoReto as 'LAVADOR' | 'PULIDOR', { regionId, regiones, marcas, ids: personas }) });
      if (encontradas !== personas.length) {
        throw new ForbiddenException(`Algunos ${tipoReto === 'PULIDOR' ? 'pulidores' : 'lavadores'} no pertenecen a tu alcance o no están activos.`);
      }
    }

    const inicio = new Date(dto.fechaInicio);
    const fin = new Date(dto.fechaFin);
    if (fin < inicio) {
      throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio.');
    }

    return this.prisma.reto.create({
      data: {
        titulo: dto.titulo.trim(),
        descripcion: dto.descripcion?.trim() || null,
        premio: dto.premio?.trim() || null,
        fechaInicio: inicio,
        fechaFin: fin,
        regiones,
        marcas,
        sucursalesIds,
        pulidoresIds,
        lavadoresIds,
        tipoReto,
        tipoServicios,
        metrica,
        modoGanador,
        cantidadGanadores,
        meta,
        estado: dto.estado || 'ACTIVO',
        catalogoServicioId: catalogoServicioIds[0] ?? null,
        catalogoServicioIds,
        creadoPorId: user?.id ? String(user.id) : null,
        creadorNombre: String(user?.nombre || `${user?.name || ''} ${user?.lastname || ''}`).trim() || null,
        creadorRol: this.roleCode(user) || null,
      },
    });
  }

  /**
   * Ranking del reto. Las posiciones son siempre las de toda la competencia; a quien ve por región o agencia solo se le
   * muestran las agencias o bahías de su alcance (con su posición real). Las personas se ven todas.
   */
  async ranking(id: string, user: any) {
    const reto = await this.prisma.reto.findUnique({ where: { id } });
    if (!reto) throw new NotFoundException('Reto no encontrado.');
    if (!this.esVisibleParaUsuario(reto, user)) {
      throw new ForbiddenException('No tienes acceso al ranking de este reto.');
    }
    const filas = await this.calcularRankingReto(reto);
    const alcance = resolverAlcance(user);
    const tipo = this.tipoReto(reto);
    const visibles = tipo === 'AGENCIA' || tipo === 'BAHIA'
      ? filas.filter((f) =>
          alcance.tipo === 'GLOBAL' ||
          (alcance.tipo === 'REGION' && f.regionId === alcance.regionId) ||
          (alcance.tipo === 'AGENCIA' && f.agenciaId === alcance.agenciaId))
      : filas;
    return {
      tipoReto: tipo,
      metrica: reto.metrica,
      modoGanador: reto.modoGanador,
      cantidadGanadores: reto.cantidadGanadores,
      meta: reto.meta !== null && reto.meta !== undefined ? Number(reto.meta) : null,
      participantes: visibles.map(({ agenciaId: _a, regionId: _r, ...fila }) => fila),
    };
  }

  /** Lavadores o pulidores que quien crea el reto puede elegir (los de su alcance). */
  async personas(tipo: 'LAVADOR' | 'PULIDOR', user: any) {
    const alcance = resolverAlcance(user);
    let where: any;
    if (alcance.tipo === 'GLOBAL') where = this.wherePersonas(tipo, {});
    else if (alcance.tipo === 'REGION') where = this.wherePersonas(tipo, { regionId: alcance.regionId });
    else if (alcance.tipo === 'AGENCIA') where = { ...this.wherePersonas(tipo, {}), agenciaId: alcance.agenciaId };
    else return [];

    const personas = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        lastname: true,
        region: { select: { nombre: true } },
        agencia: { select: { id: true, nombre: true, regionRel: { select: { nombre: true } }, cliente: { select: { nombre: true } } } },
      },
      orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
    });
    return personas.map((p: any) => ({
      id: p.id,
      nombre: `${p.name} ${p.lastname}`.trim(),
      regionNombre: p.agencia?.regionRel?.nombre || p.region?.nombre || '',
      agenciaId: p.agencia?.id || '',
      agenciaNombre: p.agencia?.nombre || (tipo === 'PULIDOR' ? 'Pulidor móvil' : 'Sin agencia'),
      clienteNombre: p.agencia?.cliente?.nombre || '',
    }));
  }

  /** Compatibilidad: lista de pulidores para el modal anterior. */
  pulidores(user: any) {
    return this.personas('PULIDOR', user);
  }

  // ---------------------------------------------------------------------------
  // Cálculo del ranking
  // ---------------------------------------------------------------------------

  private tipoReto(reto: any): ParticipanteReto {
    return (['AGENCIA', 'BAHIA', 'LAVADOR', 'PULIDOR'].includes(reto.tipoReto) ? reto.tipoReto : 'AGENCIA') as ParticipanteReto;
  }

  private async calcularRankingReto(reto: any): Promise<FilaRanking[]> {
    const tipo = this.tipoReto(reto);
    const [participantes, servicios] = await Promise.all([this.participantesDelReto(reto, tipo), this.serviciosDelReto(reto, tipo)]);
    const filas = calcularRanking(participantes, servicios, {
      metrica: (reto.metrica || 'SERVICIOS') as MetricaReto,
      modoGanador: (reto.modoGanador || 'RANKING') as ModoGanador,
      cantidadGanadores: reto.cantidadGanadores ?? 1,
      meta: reto.meta !== null && reto.meta !== undefined ? Number(reto.meta) : null,
    });
    return tipo === 'BAHIA' ? this.agregarLavadoresDeBahia(filas, servicios) : filas;
  }

  /**
   * Quién trabajó en cada bahía: los que hicieron sus servicios del reto (con cuántos cada uno, de más a menos). Si una
   * bahía aún no tiene servicios, se muestra a quien está asignado a ella hoy.
   */
  private async agregarLavadoresDeBahia(filas: FilaRanking[], servicios: ServicioContado[]): Promise<FilaRanking[]> {
    const porBahia = serviciosPorPersona(servicios);
    const sinServicios = filas.filter((f) => !porBahia.get(f.participanteId)?.size).map((f) => f.participanteId);
    const asignados = new Map<string, string[]>();
    if (sinServicios.length) {
      const bahias = await this.prisma.bahia.findMany({
        where: { id: { in: sinServicios } },
        select: { id: true, operadorActualId: true, operadores: { where: { activo: true }, select: { operadorId: true } } },
      });
      for (const b of bahias as any[]) {
        asignados.set(b.id, [...new Set([...(b.operadores || []).map((o: any) => o.operadorId), b.operadorActualId].filter(Boolean))] as string[]);
      }
    }

    const ids = new Set<string>([...[...porBahia.values()].flatMap((m) => [...m.keys()]), ...[...asignados.values()].flat()]);
    const usuarios = ids.size
      ? await this.prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, lastname: true } })
      : [];
    // Algunos nombres de lavadores traen la cédula pegada: "Juan Pérez (CI: ...)".
    const nombre = new Map<string, string>(
      (usuarios as any[]).map((u) => [u.id, `${u.name} ${u.lastname}`.replace(/\s*\(CI:[^)]*\)\s*$/i, '').trim()]),
    );

    return filas.map((f) => {
      const hechos = porBahia.get(f.participanteId);
      const personas = hechos?.size
        ? [...hechos.entries()]
            .map(([id, n]) => ({ id, nombre: nombre.get(id) || 'Sin nombre', servicios: n }))
            .sort((a, b) => b.servicios - a.servicios || a.nombre.localeCompare(b.nombre))
        : (asignados.get(f.participanteId) || []).map((id) => ({ id, nombre: nombre.get(id) || 'Sin nombre', servicios: null }));
      return { ...f, personas };
    });
  }

  /** Filtro de agencias según dónde se juega el reto (región, cliente y agencias elegidas). */
  private whereAgenciasReto(reto: any): any {
    const regiones = filtroLista(reto.regiones);
    const marcas = filtroLista(reto.marcas);
    const filtros: any[] = [];
    if (regiones.length) filtros.push({ regionRel: { nombre: { in: regiones } } });
    if (marcas.length) filtros.push({ cliente: { nombre: { in: marcas } } });
    if (reto.sucursalesIds?.length) filtros.push({ id: { in: reto.sucursalesIds } });
    return filtros.length ? { AND: filtros } : {};
  }

  private whereRolPersona(tipo: 'LAVADOR' | 'PULIDOR') {
    return { namerol: { in: tipo === 'PULIDOR' ? ROLES_PULIDOR : ROLES_LAVADOR } };
  }

  /** Personas activas de un tipo dentro de un ámbito (región del creador, regiones y clientes del reto, ids elegidos). */
  private wherePersonas(
    tipo: 'LAVADOR' | 'PULIDOR',
    f: { regionId?: string | null; regiones?: string[]; marcas?: string[]; sucursalesIds?: string[]; ids?: string[] },
  ): any {
    const and: any[] = [];
    if (f.regionId) and.push({ OR: [{ regionId: f.regionId }, { agencia: { regionId: f.regionId } }] });
    const regiones = filtroLista(f.regiones);
    if (regiones.length) {
      and.push({ OR: [{ region: { nombre: { in: regiones } } }, { agencia: { regionRel: { nombre: { in: regiones } } } }] });
    }
    const marcas = filtroLista(f.marcas);
    if (marcas.length) and.push({ agencia: { cliente: { nombre: { in: marcas } } } });
    if (f.sucursalesIds?.length) and.push({ agenciaId: { in: f.sucursalesIds } });
    return {
      estado: 1,
      role: this.whereRolPersona(tipo),
      ...(f.ids?.length ? { id: { in: f.ids } } : {}),
      ...(and.length ? { AND: and } : {}),
    };
  }

  /** Todos los que compiten, aunque todavía no tengan servicios (aparecen con 0). */
  private async participantesDelReto(reto: any, tipo: ParticipanteReto): Promise<ParticipanteRanking[]> {
    const agencias = this.whereAgenciasReto(reto);

    if (tipo === 'AGENCIA') {
      const rows = await this.prisma.agencia.findMany({
        where: agencias,
        select: { id: true, nombre: true, regionId: true },
        orderBy: { nombre: 'asc' },
      });
      return rows.map((a: any) => ({ id: a.id, nombre: a.nombre, agenciaId: a.id, regionId: a.regionId }));
    }

    if (tipo === 'BAHIA') {
      const rows = await this.prisma.bahia.findMany({
        where: { agencia: agencias },
        select: { id: true, nombre: true, agenciaId: true, agencia: { select: { nombre: true, regionId: true } } },
        orderBy: { nombre: 'asc' },
      });
      return rows.map((b: any) => ({
        id: b.id, nombre: b.nombre, detalle: b.agencia?.nombre, agenciaId: b.agenciaId, regionId: b.agencia?.regionId,
      }));
    }

    const ids: string[] = (tipo === 'PULIDOR' ? reto.pulidoresIds : reto.lavadoresIds) || [];
    const rows = await this.prisma.user.findMany({
      where: ids.length
        ? { id: { in: ids }, estado: 1, role: this.whereRolPersona(tipo) }
        : this.wherePersonas(tipo, { regiones: reto.regiones, marcas: reto.marcas, sucursalesIds: reto.sucursalesIds }),
      select: { id: true, name: true, lastname: true, agenciaId: true, regionId: true, agencia: { select: { nombre: true } } },
      orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
    });
    return rows.map((u: any) => ({
      id: u.id,
      nombre: `${u.name} ${u.lastname}`.trim(),
      detalle: u.agencia?.nombre || (tipo === 'PULIDOR' ? 'Pulidor móvil' : undefined),
      agenciaId: u.agenciaId,
      regionId: u.regionId,
    }));
  }

  /**
   * Servicios que cuentan: generales FINALIZADO o APROBADO y especiales Completado, no borrados, terminados dentro de las
   * fechas del reto (hora de Ecuador) y en el lugar elegido. Un servicio con varios operadores cuenta completo para cada uno.
   */
  private async serviciosDelReto(reto: any, tipo: ParticipanteReto): Promise<ServicioContado[]> {
    const { desde, hasta } = rangoReto(new Date(reto.fechaInicio), new Date(reto.fechaFin));
    const fuentes = fuentesDeServicios((reto.tipoServicios || 'TODOS') as TipoServicioReto);
    const catalogo = reto.tipoServicios === 'ESPECIFICOS' && reto.catalogoServicioIds?.length
      ? { servicioCatalogoId: { in: reto.catalogoServicioIds } }
      : {};
    const agencias = this.whereAgenciasReto(reto);
    const personas = (s: { operadorId?: string | null; operadoresAsignados?: { operadorId: string }[] }) =>
      [s.operadorId, ...(s.operadoresAsignados || []).map((o) => o.operadorId)].filter(Boolean) as string[];

    const contados: ServicioContado[] = [];
    const archivo = this.historico ? new RetosArchivo(this.prisma, this.historico) : null;
    const filtroArchivo = {
      desde, hasta, regiones: filtroLista(reto.regiones), marcas: filtroLista(reto.marcas), sucursalesIds: (reto.sucursalesIds || []) as string[],
      catalogoIds: reto.tipoServicios === 'ESPECIFICOS' && reto.catalogoServicioIds?.length ? (reto.catalogoServicioIds as number[]) : undefined,
    };

    if (fuentes.generales && tipo !== 'PULIDOR') {
      const lavados = await this.prisma.servicioLavado.findMany({
        where: {
          estado: { in: ['FINALIZADO', 'APROBADO'] },
          deletedAt: null,
          horaSalida: { gte: desde, lt: hasta },
          ...catalogo,
          ...(Object.keys(agencias).length ? { bahia: { agencia: agencias } } : {}),
        },
        select: {
          placa: true, precio: true, horaSalida: true, operadorId: true, bahiaId: true,
          bahia: { select: { agenciaId: true } },
          operadoresAsignados: { select: { operadorId: true } },
        },
      });
      for (const s of [...(lavados as any[]), ...(archivo ? await archivo.lavados(filtroArchivo) : [])]) {
        const participantes = tipo === 'AGENCIA' ? [s.bahia?.agenciaId] : tipo === 'BAHIA' ? [s.bahiaId] : personas(s);
        contados.push({ participantes: participantes.filter(Boolean), placa: s.placa || '', monto: Number(s.precio || 0), fin: s.horaSalida, operadores: personas(s) });
      }
    }

    if (fuentes.especiales && tipo !== 'LAVADOR') {
      const regiones = filtroLista(reto.regiones);
      const marcas = filtroLista(reto.marcas);
      const and: any[] = [];
      // Un pulidor móvil no tiene agencia: su servicio se ubica por la región donde lo hizo.
      if (regiones.length) {
        and.push({ OR: [{ agencia: { regionRel: { nombre: { in: regiones } } } }, { agenciaId: null, region: { nombre: { in: regiones } } }] });
      }
      if (marcas.length) and.push({ agencia: { cliente: { nombre: { in: marcas } } } });
      if (reto.sucursalesIds?.length) and.push({ agenciaId: { in: reto.sucursalesIds } });
      const especiales = await this.prisma.servicioEspecial.findMany({
        where: {
          estado: 'Completado',
          deletedAt: null,
          fechaFin: { gte: desde, lt: hasta },
          ...catalogo,
          ...(and.length ? { AND: and } : {}),
        },
        select: {
          placa: true, precio: true, fechaFin: true, operadorId: true, bahiaId: true, agenciaId: true,
          operadoresAsignados: { select: { operadorId: true } },
        },
      });
      for (const s of [...(especiales as any[]), ...(archivo ? await archivo.especiales(filtroArchivo) : [])]) {
        const participantes = tipo === 'AGENCIA' ? [s.agenciaId] : tipo === 'BAHIA' ? [s.bahiaId] : personas(s);
        contados.push({ participantes: participantes.filter(Boolean), placa: s.placa || '', monto: Number(s.precio || 0), fin: s.fechaFin, operadores: personas(s) });
      }
    }

    return contados;
  }

  private async enriquecerRetos(retos: any[]) {
    const serviciosIds = [...new Set(retos.flatMap((reto) =>
      reto.catalogoServicioIds?.length ? reto.catalogoServicioIds : reto.catalogoServicioId ? [reto.catalogoServicioId] : [],
    ))];
    const personasIds = [...new Set(retos.flatMap((reto) => [...(reto.pulidoresIds || []), ...(reto.lavadoresIds || [])]))];
    const [servicios, personas] = await Promise.all([
      serviciosIds.length
        ? this.prisma.catalogoServicio.findMany({ where: { id: { in: serviciosIds } }, select: { id: true, nombre: true } })
        : [],
      personasIds.length
        ? this.prisma.user.findMany({ where: { id: { in: personasIds } }, select: { id: true, name: true, lastname: true } })
        : [],
    ]);
    const servicioPorId = new Map<number, any>(servicios.map((servicio: any) => [servicio.id, servicio]));
    const personaPorId = new Map<string, any>(personas.map((p: any) => [p.id, p]));
    return retos.map((reto) => ({
      ...reto,
      meta: reto.meta !== null && reto.meta !== undefined ? Number(reto.meta) : null,
      catalogoServicios: (reto.catalogoServicioIds?.length
        ? reto.catalogoServicioIds
        : reto.catalogoServicioId ? [reto.catalogoServicioId] : []
      ).map((servicioId: number) => servicioPorId.get(servicioId)).filter(Boolean),
      pulidores: (reto.pulidoresIds || []).map((id: string) => personaPorId.get(id)).filter(Boolean),
      lavadores: (reto.lavadoresIds || []).map((id: string) => personaPorId.get(id)).filter(Boolean),
    }));
  }

  // ---------------------------------------------------------------------------
  // Cierre y baja
  // ---------------------------------------------------------------------------

  /** Editan, cierran o eliminan un reto su creador o quien actúa en todo el país (administradores, jefe comercial). */
  private asegurarPuedeGestionar(reto: { creadoPorId: string | null }, user: any, accion: 'editar' | 'cerrar' | 'eliminar'): void {
    const esCreador = !!reto.creadoPorId && String(reto.creadoPorId) === String(user?.id || '');
    if (!esCreador && resolverAlcance(user).tipo !== 'GLOBAL') {
      throw new ForbiddenException(`Solo el creador o alguien con alcance nacional puede ${accion} este reto.`);
    }
  }

  /** Corrige título, descripción, premio y vigencia de un reto que sigue activo. Quien lo edita: su creador o alcance nacional. */
  async actualizar(dto: UpdateRetoDto, user: any) {
    const existing = await this.prisma.reto.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('Reto no encontrado.');
    this.asegurarPuedeGestionar(existing, user, 'editar');
    if (existing.estado !== 'ACTIVO') {
      throw new BadRequestException('Solo se puede editar un reto activo: uno cerrado ya tiene su ganador registrado.');
    }

    const data: Record<string, unknown> = {};
    if (dto.titulo !== undefined) {
      const titulo = dto.titulo.trim();
      if (!titulo) throw new BadRequestException('El título del reto no puede quedar vacío.');
      data['titulo'] = titulo;
    }
    if (dto.descripcion !== undefined) data['descripcion'] = dto.descripcion.trim() || null;
    if (dto.premio !== undefined) data['premio'] = dto.premio.trim() || null;

    const inicio = dto.fechaInicio ? new Date(dto.fechaInicio) : existing.fechaInicio;
    const fin = dto.fechaFin ? new Date(dto.fechaFin) : existing.fechaFin;
    if (dto.fechaInicio) data['fechaInicio'] = inicio;
    if (dto.fechaFin) data['fechaFin'] = fin;
    if (fin < inicio) throw new BadRequestException('La fecha de fin no puede ser anterior a la fecha de inicio.');
    // Un reto activo con fecha fin pasada se cerraría solo esa madrugada: para terminarlo antes, se usa «Cerrar reto».
    if (dto.fechaFin && fin < hoyEcuador()) {
      throw new BadRequestException('La fecha de fin no puede ser anterior a hoy. Para terminar el reto ahora, ciérralo.');
    }
    if (Object.keys(data).length === 0) return existing;

    return this.prisma.reto.update({ where: { id: existing.id }, data });
  }

  async delete(id: string, user: any) {
    const existing = await this.prisma.reto.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Reto no encontrado.');
    this.asegurarPuedeGestionar(existing, user, 'eliminar');
    await this.prisma.reto.delete({ where: { id } });
    return { success: true, id };
  }

  /** Cierre manual (antes o después de la fecha fin). El ganador sale del ranking, igual que en el cierre automático. */
  async cerrar(dto: CerrarRetoDto, user: any) {
    const existing = await this.prisma.reto.findUnique({ where: { id: dto.id } });
    if (!existing) throw new NotFoundException('Reto no encontrado.');
    this.asegurarPuedeGestionar(existing, user, 'cerrar');
    if (existing.estado === 'FINALIZADO') {
      throw new BadRequestException('Este reto ya fue cerrado.');
    }
    return this.finalizar(existing, user?.id ? String(user.id) : null, dto.resultado?.trim() || null);
  }

  @Cron('10 0 * * *', { name: 'cerrar-retos-vencidos', timeZone: 'America/Guayaquil' })
  async programado_cerrarVencidos(): Promise<void> {
    // Con varias instancias del servidor, solo una la ejecuta (candado en Redis con vencimiento propio).
    const tarea = async () => {
      await this.cerrarVencidos();
    };
    if (this.cache) await this.cache.unaVez('cron:cerrarVencidos', 3600, tarea);
    else await tarea();
  }

  /** Cada madrugada (hora de Ecuador) se cierran los retos cuya fecha fin ya pasó. */
  async cerrarVencidos(): Promise<number> {
    const vencidos = await this.prisma.reto.findMany({ where: { estado: 'ACTIVO', fechaFin: { lt: hoyEcuador() } } });
    let cerrados = 0;
    for (const reto of vencidos) {
      try {
        await this.finalizar(reto, null, 'Cerrado automáticamente al vencer.');
        cerrados += 1;
      } catch (err) {
        this.logger.error(`No se pudo cerrar el reto ${reto.id}: ${(err as Error).message}`);
      }
    }
    if (cerrados) this.logger.log(`Retos vencidos cerrados: ${cerrados}`);
    return cerrados;
  }

  protected async finalizar(reto: any, cerradoPorId: string | null, resultado: string | null) {
    const ganadores = (await this.calcularRankingReto(reto))
      .filter((f) => f.gana)
      .map(({ participanteId, nombre, valor, posicion }) => ({ participanteId, nombre, valor, posicion }));
    const cerrado = await this.prisma.reto.update({
      where: { id: reto.id },
      data: {
        estado: 'FINALIZADO',
        ganadores,
        ganadorNombre: ganadores.length ? ganadores.map((g) => g.nombre).join(', ') : null,
        resultado,
        cerradoPorId,
        cerradoEn: new Date(),
      },
    });
    void this.notificarCierreReto(cerrado);
    return cerrado;
  }

  /** Avisa el cierre de un reto: admin/super admin, jefe comercial (nacional) y el coordinador
   * comercial + supervisor de las regiones del reto (o de todo el país si no tenía región). */
  private async notificarCierreReto(reto: { id: string; titulo: string; ganadorNombre: string | null; regiones: string[] }): Promise<void> {
    if (!this.notifications) return;
    const nacional = reto.regiones.length === 0 || reto.regiones.some((r) => r.trim().toLowerCase() === 'todas');
    let regionIds: string[] | 'TODAS' = 'TODAS';
    if (!nacional) {
      const regiones = await this.prisma.region.findMany({ where: { nombre: { in: reto.regiones } }, select: { id: true } });
      regionIds = regiones.map((r) => r.id);
    }
    const ids = await this.notifications.resolverDestinatariosPorRol({
      global: ['ADMIN', 'SUPER_ADMIN', 'JEFE_COMERCIAL'],
      regionales: ['COORD_COMERCIAL', 'SUPERVISOR'],
      regionId: regionIds,
    });
    if (!ids.length) return;
    void this.notifications.notificarUsuarios(
      ids,
      'Reto cerrado',
      reto.ganadorNombre ? `"${reto.titulo}" cerró. Ganador: ${reto.ganadorNombre}.` : `"${reto.titulo}" cerró.`,
      { type: 'RETO_CERRADO', retoId: reto.id },
      { tipo: 'RETO_CERRADO', entidadTipo: 'RETO', entidadId: reto.id },
    );
  }

  private roleCode(user: any): string {
    return rolDeUsuario(user);
  }

  /** Misma regla que el listado: así el ranking de un reto nunca se ve donde el reto no aparece. */
  private esVisibleParaUsuario(
    reto: { regiones: string[]; sucursalesIds: string[]; pulidoresIds?: string[]; lavadoresIds?: string[] },
    user: any,
  ): boolean {
    if (resolverAlcance(user).tipo === 'GLOBAL') return true;
    const pulidores = reto.pulidoresIds || [];
    const lavadores = reto.lavadoresIds || [];
    if (!reto.regiones.length && !reto.sucursalesIds.length && !pulidores.length && !lavadores.length) return true;
    if (reto.regiones.includes('Todas')) return true;
    const regionNombre = String(user?.region?.nombre || '').trim();
    const agenciaId = String(user?.agenciaId || '').trim();
    const userId = String(user?.id || '').trim();
    return Boolean(
      (regionNombre && reto.regiones.includes(regionNombre)) ||
      (agenciaId && reto.sucursalesIds.includes(agenciaId)) ||
      (userId && (pulidores.includes(userId) || lavadores.includes(userId))),
    );
  }

  private cleanList(values?: string[]): string[] {
    return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))];
  }
}
