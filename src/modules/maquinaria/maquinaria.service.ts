import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService, type InspectedEvidence } from '../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CacheService } from '../../common/cache/cache.service.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { normalizarRol, ROLES_LIDER_AGENCIA } from '../../common/permisos/alias-roles.js';
import {
  columnasSimples,
  combinarWhere,
  paginarPorGrupos,
  rangoFechas,
  resolverOrden,
  resolverPaginacion,
  whereBusqueda,
} from '../../common/utils/data-grid.helpers.js';
import {
  CreateMaquinariaDto,
  UpdateMaquinariaDto,
  ListMaquinariaDto,
  ReportarIncidenteDto,
  ResolverIncidenteDto,
  ListIncidentesDto,
  RegistrarMantenimientoDto,
  EjecutarMantenimientoDto,
  ListMantenimientosDto,
  AsignarIncidenteDto,
  AsignarMantenimientoDto,
  TransferirMaquinariaDto,
  ListMovimientosMaquinariaDto,
} from './dto/maquinaria.dto.js';
import {
  AgregarEvidenciaDto,
  AsignarOperadorDto,
  ConfigurarVentanaDto,
  DetalleMaquinariaDto,
  EditarIncidenteDto,
  EditarLimpiezaDto,
  EditarMantenimientoDto,
  EliminarLimpiezaDto,
  EvidenciaInputDto,
  ExportarLimpiezasDto,
  HistorialMaquinariaDto,
  ListLimpiezasDto,
  PaginacionDto,
  RegistrarLimpiezaDto,
  SetActivaMaquinariaDto,
  type TipoEventoMaquinaria,
} from './dto/trazabilidad.dto.js';
import {
  Actor,
  addDays,
  assertRegion,
  esAdmin,
  esCoordComercial,
  esCoordMantenimiento,
  esCoordServiciosEspeciales,
  esSupervisor,
  esOperador,
  esLider,
  esRolPropio,
  esTecnico,
  ROL,
  ROLES_OPERADOR,
  startOfDay,
} from './maquinaria.permisos.js';
import {
  limpiezaAtrasada as limpiezaAtrasadaUtil,
  reglaLimpieza as reglaLimpiezaUtil,
} from '../../common/utils/limpieza-maquinaria.js';

type Tx = Prisma.TransactionClient;

/** Máquina con la agencia/región en la que está ahora. */
interface MaquinaCtx {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  agenciaId: string | null;
  bahiaId: string | null;
  operadorAsignadoId: string | null;
  ventanaAdelantoDias: number;
  estadoOperativo: string;
  agencia: { id: string; nombre: string; regionId: string | null } | null;
}

interface EvidenciaVerificada extends InspectedEvidence {
  url: string;
  descripcion: string | null;
}

const SIN_REGION = '__sin_region__';
const NADA = '__ninguno__';
/** Columnas por las que se puede ordenar la lista de incidencias (nombre público → campo de la base). */
const ORDEN_INCIDENTES = columnasSimples({
  fecha: 'fechaReporte',
  solucion: 'fechaSolucion',
  estado: 'estado',
  gravedad: 'gravedad',
  titulo: 'titulo',
  maquina: 'maquinaria.codigo',
  agencia: 'maquinaria.agencia.nombre',
  reportadoPor: 'reportadoPor.name',
  tecnico: 'tecnicoAsignado.name',
});

/** Columnas por las que se puede ordenar la lista de mantenimientos. */
const ORDEN_MANTENIMIENTOS = columnasSimples({
  fecha: 'fechaProgramada',
  ejecucion: 'fechaEjecucion',
  estado: 'estado',
  tipo: 'tipo',
  maquina: 'maquinaria.codigo',
  agencia: 'maquinaria.agencia.nombre',
  tecnico: 'tecnico.name',
});

const CAMPOS_BUSQUEDA_INCIDENTES = [
  'titulo', 'descripcion', 'maquinaria.codigo', 'maquinaria.nombre',
  'reportadoPor.name', 'reportadoPor.lastname', 'tecnicoAsignado.name', 'tecnicoAsignado.lastname',
];
const CAMPOS_BUSQUEDA_MANTENIMIENTOS = [
  'observaciones', 'maquinaria.codigo', 'maquinaria.nombre', 'tecnico.name', 'tecnico.lastname',
];
const MAX_MULTIMEDIA = 10;

@Injectable()
export class MaquinariaService {
  private readonly logger = new Logger(MaquinariaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    /** Guarda un rato el conteo de limpiezas atrasadas (badge de alerta). Sin él, cada visita lo recalcula. */
    @Optional() private readonly cache?: CacheService,
  ) {}

  // ==============================================================
  // Utilidades comunes
  // ==============================================================

  private readonly includeMaquinaCtx = {
    agencia: { select: { id: true, nombre: true, regionId: true } },
  } as const;

  private async cargarMaquina(id: string): Promise<MaquinaCtx> {
    const m = await this.prisma.maquinaria.findUnique({
      where: { id },
      include: this.includeMaquinaCtx,
    });
    if (!m) throw new NotFoundException(`Equipo ${id} no encontrado`);
    return m as unknown as MaquinaCtx;
  }

  private regionDe(m: MaquinaCtx): string | null {
    return m.agencia?.regionId ?? null;
  }

  private assertActiva(m: MaquinaCtx): void {
    if (!m.activa) {
      throw new BadRequestException(`La máquina ${m.codigo} está desactivada y no acepta nuevos registros.`);
    }
  }

  /** Línea de tiempo: nunca se edita ni se borra (también protegido con un trigger en la base). */
  private async registrarEvento(
    tx: Tx,
    m: Pick<MaquinaCtx, 'id' | 'agenciaId' | 'agencia'>,
    tipo: TipoEventoMaquinaria,
    actorId: string | null,
    entidadId?: string | null,
    datos?: Record<string, unknown>,
  ): Promise<void> {
    await tx.maquinariaEvento.create({
      data: {
        maquinariaId: m.id,
        tipo,
        actorId,
        agenciaId: m.agenciaId ?? null,
        regionId: m.agencia?.regionId ?? null,
        entidadId: entidadId ?? null,
        datos: datos ? (JSON.parse(JSON.stringify(datos)) as Prisma.InputJsonValue) : undefined,
      },
    });
  }

  private norm(v: unknown): unknown {
    if (v === undefined || v === '') return null;
    if (v instanceof Date) return v.toISOString();
    if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function' && (v as { constructor?: { name?: string } }).constructor?.name === 'Decimal') {
      return String(v);
    }
    return v;
  }

  /** Cambios campo a campo: { campo: { antes, despues } } solo de lo que realmente cambió. */
  private diff(antes: Record<string, unknown>, despues: Record<string, unknown>, campos: string[]) {
    const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const campo of campos) {
      if (!(campo in despues) || despues[campo] === undefined) continue;
      const a = this.norm(antes[campo]);
      const d = this.norm(despues[campo]);
      if (JSON.stringify(a) !== JSON.stringify(d)) cambios[campo] = { antes: a, despues: d };
    }
    return cambios;
  }

  /** Paginación estándar: máx. 100 por petición; un cliente que no envía tamaño recibe hasta 100. */
  private pagina(dto: PaginacionDto) {
    const sinTamano = dto.pageSize === undefined || dto.pageSize === null;
    return resolverPaginacion(dto, sinTamano ? { defecto: 100 } : {});
  }

  /** Respuesta estándar de listados: formato común + `success` (que la web y la app de maquinaria ya leen). */
  private respuestaPagina<T>(items: T[], total: number, page: number, pageSize: number, extra: Record<string, unknown> = {}) {
    return { success: true, ...buildDataGridResponse(items, total, page, pageSize), ...extra };
  }

  private shortName(u?: { name?: string | null; lastname?: string | null } | null): string {
    return [u?.name, u?.lastname].filter(Boolean).join(' ');
  }

  // ==============================================================
  // Alcance de lo que cada rol puede ver
  // ==============================================================

  private scopeMaquinaria(actor: Actor): Prisma.MaquinariaWhereInput {
    if (esAdmin(actor) || actor.rol === ROL.COORD_BODEGA) return {};
    if (esCoordMantenimiento(actor) || esSupervisor(actor) || esTecnico(actor) || esCoordComercial(actor)) {
      return { agencia: { regionId: actor.regionId ?? SIN_REGION } };
    }
    if (esCoordServiciosEspeciales(actor)) return { operadorAsignado: { role: { namerol: 'PULIDOR' } } };
    // El líder supervisa toda su agencia: ve (y por tanto puede reportar, ver §reportarIncidente)
    // cualquier máquina de su sede, esté o no asignada a él por nombre. El pulidor sigue viendo solo
    // lo que tiene asignado a él personalmente, como su kit de insumos.
    if (esLider(actor)) return { agenciaId: actor.agenciaId ?? NADA };
    if (esOperador(actor)) return { operadorAsignadoId: actor.id };
    // Rol propio (creado desde Roles): manda el ámbito del rol, no su nombre.
    switch (actor.ambito) {
      case 'GLOBAL': return {};
      case 'REGION': return { agencia: { regionId: actor.regionId ?? SIN_REGION } };
      case 'AGENCIA': return { agenciaId: actor.agenciaId ?? NADA };
      case 'PROPIO': return { operadorAsignadoId: actor.id };
      default: return { id: NADA };
    }
  }

  private scopeIncidentes(actor: Actor): Prisma.IncidenteTecnicoWhereInput {
    if (esAdmin(actor)) return {};
    if (esCoordMantenimiento(actor)) {
      // El coordinador ve todo lo de su región (tiene que verlo para poder asignarlo), y además lo
      // que tiene asignado a su propio nombre aunque lo muevan de región después (ver bloqueo de
      // cambio de región con trabajo abierto en agencias.service.ts).
      return { OR: [
        { maquinaria: { agencia: { regionId: actor.regionId ?? SIN_REGION } } },
        { tecnicoAsignadoId: actor.id },
      ] };
    }
    if (esSupervisor(actor)) {
      return { maquinaria: { agencia: { regionId: actor.regionId ?? SIN_REGION } } };
    }
    if (esTecnico(actor)) {
      // El técnico solo ve las incidencias que el coordinador de mantenimiento de su región le
      // asignó a él por nombre, no todas las de la región (eso es del coordinador/supervisor).
      return { tecnicoAsignadoId: actor.id };
    }
    if (esCoordServiciosEspeciales(actor)) return { maquinaria: { operadorAsignado: { role: { namerol: 'PULIDOR' } } } };
    // Mismo criterio que scopeMaquinaria: el líder ve las incidencias de toda su agencia.
    if (esLider(actor)) return { maquinaria: { agenciaId: actor.agenciaId ?? NADA } };
    if (esOperador(actor)) {
      return { OR: [{ maquinaria: { operadorAsignadoId: actor.id } }, { reportadoPorId: actor.id }] };
    }
    // Rol propio (creado desde Roles): manda el ámbito del rol, no su nombre.
    switch (actor.ambito) {
      case 'GLOBAL': return {};
      case 'REGION': return { maquinaria: { agencia: { regionId: actor.regionId ?? SIN_REGION } } };
      case 'AGENCIA': return { maquinaria: { agenciaId: actor.agenciaId ?? NADA } };
      case 'PROPIO': return { OR: [{ maquinaria: { operadorAsignadoId: actor.id } }, { reportadoPorId: actor.id }] };
      default: return { id: NADA };
    }
  }

  private scopeMantenimientos(actor: Actor): Prisma.MantenimientoMaquinariaWhereInput {
    if (esAdmin(actor)) return {};
    if (esCoordMantenimiento(actor)) {
      // El coordinador ve todos los de su región (tiene que verlos para poder asignarlos), y además
      // los que tiene asignados a su propio nombre aunque lo muevan de región después (ver bloqueo
      // de cambio de región con trabajo abierto en agencias.service.ts).
      return { OR: [
        { maquinaria: { agencia: { regionId: actor.regionId ?? SIN_REGION } } },
        { tecnicoId: actor.id },
      ] };
    }
    if (esTecnico(actor)) {
      // El técnico solo ve los mantenimientos que el coordinador de mantenimiento de su región le
      // asignó a él por nombre, no todos los de la región. Al depender solo de tecnicoId (y no de
      // la región), tampoco pierde de vista su trabajo si lo mueven de región mientras lo tiene abierto.
      return { tecnicoId: actor.id };
    }
    // Mismo criterio que scopeMaquinaria: el pulidor ve los mantenimientos de lo que tiene asignado
    // a él, y el líder los de toda su agencia (ve y reporta cualquier máquina de su sede).
    if (esOperador(actor)) return { maquinaria: { operadorAsignadoId: actor.id } };
    if (esLider(actor)) return { maquinaria: { agenciaId: actor.agenciaId ?? NADA } };
    // Rol propio (creado desde Roles): manda el ámbito del rol, no su nombre.
    switch (actor.ambito) {
      case 'GLOBAL': return {};
      case 'REGION': return { maquinaria: { agencia: { regionId: actor.regionId ?? SIN_REGION } } };
      case 'AGENCIA': return { maquinaria: { agenciaId: actor.agenciaId ?? NADA } };
      case 'PROPIO': return { maquinaria: { operadorAsignadoId: actor.id } };
      default: return { id: NADA };
    }
  }

  /** Falla si el actor no puede ver esta máquina (mismo criterio que la lista). */
  private async assertPuedeVerMaquina(actor: Actor, maquinariaId: string): Promise<void> {
    const ok = await this.prisma.maquinaria.count({ where: { id: maquinariaId, ...this.scopeMaquinaria(actor) } });
    if (!ok) throw new ForbiddenException('No tienes acceso a esta máquina.');
  }

  /** Solo técnicos o el coordinador de mantenimiento, de la misma región de la máquina. */
  private async validarResponsable(userId: string, regionMaquina: string | null): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, estado: true, regionId: true, role: { select: { namerol: true } } },
    });
    if (!u || u.estado !== 1) throw new NotFoundException('El técnico indicado no existe o está inactivo.');
    const rolUsuario = normalizarRol(u.role.namerol);
    if (rolUsuario !== ROL.TECNICO && rolUsuario !== ROL.COORD_MANTENIMIENTO) {
      throw new BadRequestException('Solo se puede asignar a un técnico o al coordinador de mantenimiento.');
    }
    if (!regionMaquina || u.regionId !== regionMaquina) {
      throw new BadRequestException('El técnico debe pertenecer a la misma región que la máquina.');
    }
  }

  // ==============================================================
  // Evidencias (foto o video de 13 a 30 s, más un documento)
  // ==============================================================

  private exigirPermisoParaEvidencias(inputs: EvidenciaInputDto[], puedeSubirEvidencias: boolean): void {
    if (!puedeSubirEvidencias && inputs.length > 0) {
      throw new ForbiddenException('Tu rol no puede adjuntar evidencias a incidencias o mantenimientos.');
    }
  }

  private async verificarEvidencias(
    maquina: Pick<MaquinaCtx, 'codigo'>,
    inputs: EvidenciaInputDto[] | undefined,
    /**
     * `requiereMultimedia`: exige al menos 1 foto o video. `requiereDocumento`: exige exactamente 1
     * PDF. Son independientes: al reportar una falla solo se exige evidencia (foto/video) — el PDF
     * (informe de reparación) recién se exige al resolver la incidencia o cerrar el mantenimiento.
     */
    opts: { requiereMultimedia?: boolean; requiereDocumento?: boolean },
  ): Promise<EvidenciaVerificada[]> {
    const vistos = new Set<string>();
    const unicos = (inputs || []).filter((e) => {
      const url = String(e?.url || '').trim();
      if (!url || vistos.has(url)) return false;
      vistos.add(url);
      return true;
    });

    const prefix = this.storage.maquinariaPrefix(maquina.codigo);
    const verificadas: EvidenciaVerificada[] = [];
    for (const e of unicos) {
      const info = await this.storage.inspectEvidence(e.url, { prefix });
      if (info.kind === 'IMAGEN') void this.storage.generarVariantes(e.url);
      verificadas.push({ ...info, url: e.url, descripcion: e.descripcion?.trim() || null });
    }

    const multimedia = verificadas.filter((e) => e.kind !== 'DOCUMENTO').length;
    const documentos = verificadas.filter((e) => e.kind === 'DOCUMENTO').length;
    if (multimedia > MAX_MULTIMEDIA) {
      throw new BadRequestException(`Máximo ${MAX_MULTIMEDIA} fotos o videos por registro.`);
    }
    if (documentos > 1) {
      throw new BadRequestException('Solo se permite un documento por registro.');
    }
    if (opts.requiereMultimedia && multimedia < 1) {
      throw new BadRequestException('Adjunta al menos una foto o un video.');
    }
    if (opts.requiereDocumento && documentos !== 1) {
      throw new BadRequestException('Adjunta un documento (PDF).');
    }
    return verificadas;
  }

  private tipoEvidencia(kind: EvidenciaVerificada['kind'], contexto: 'INCIDENTE' | 'MANTENIMIENTO'): string {
    if (contexto === 'INCIDENTE') {
      return kind === 'VIDEO' ? 'VIDEO_INCIDENTE' : kind === 'DOCUMENTO' ? 'DOCUMENTO_INCIDENTE' : 'FOTO_INCIDENTE';
    }
    return kind === 'VIDEO' ? 'VIDEO' : kind === 'DOCUMENTO' ? 'DOCUMENTO' : 'FOTO';
  }

  private evidenciaData(
    e: EvidenciaVerificada,
    contexto: 'INCIDENTE' | 'MANTENIMIENTO',
    etapa: string,
    actorId: string,
  ) {
    return {
      tipo: this.tipoEvidencia(e.kind, contexto),
      url: e.url,
      descripcion: e.descripcion,
      etapa,
      s3Key: e.key,
      mimeType: e.mimeType,
      tamanoBytes: e.sizeBytes,
      duracionSeg: e.durationSeconds ?? null,
      subidoPorId: actorId,
      metadata: {
        kind: e.kind,
        mimeType: e.mimeType,
        sizeBytes: e.sizeBytes,
        ...(e.durationSeconds != null ? { durationSeconds: e.durationSeconds } : {}),
      } as Prisma.InputJsonValue,
    };
  }

  private resumenEvidencias(evs: EvidenciaVerificada[]) {
    return evs.map((e) => ({ key: e.key, kind: e.kind, sizeBytes: e.sizeBytes, durationSeconds: e.durationSeconds }));
  }

  // ==============================================================
  // MAQUINARIA
  // ==============================================================

  /**
   * La foto y la ficha técnica son imágenes que ya deben estar en S3, dentro de la carpeta de la máquina
   * (maquinaria/{codigo}/perfil/foto|ficha-tecnica/). No se guarda ninguna URL que no se haya verificado.
   */
  private async verificarImagenPerfil(
    codigo: string,
    url: string | null | undefined,
    carpeta: 'foto' | 'ficha-tecnica',
  ): Promise<void> {
    if (!url) return;
    const nombre = carpeta === 'foto' ? 'La foto de la máquina' : 'La ficha técnica';
    const info = await this.storage.inspectEvidence(url, {
      prefix: `${this.storage.maquinariaPrefix(codigo)}perfil/${carpeta}/`,
    });
    if (info.kind !== 'IMAGEN') {
      throw new BadRequestException(`${nombre} debe ser una imagen (JPG, PNG o WEBP).`);
    }
    void this.storage.generarVariantes(url);
  }

  private async conteosPendientes(ids: string[]) {
    if (!ids.length) {
      return {
        incidentes: new Map<string, number>(),
        mantenimientos: new Map<string, number>(),
        proximoMantenimiento: new Map<string, Date>(),
        ultimaLimpieza: new Map<string, Date>(),
      };
    }
    const [inc, man, proximo, limpieza] = await Promise.all([
      this.prisma.incidenteTecnico.groupBy({
        by: ['maquinariaId'],
        where: { maquinariaId: { in: ids }, estado: 'ABIERTO', tecnicoAsignadoId: null },
        _count: { _all: true },
      }),
      this.prisma.mantenimientoMaquinaria.groupBy({
        by: ['maquinariaId'],
        where: {
          maquinariaId: { in: ids },
          estado: { in: ['PENDIENTE', 'EN_PROCESO'] },
          fechaProgramada: { lt: new Date() },
        },
        _count: { _all: true },
      }),
      // Próximo mantenimiento por máquina (el más cercano, vencido o no): lo que ve el líder/pulidor
      // en "Mi Maquinaria" — solo la fecha, nada de costos ni repuestos.
      this.prisma.mantenimientoMaquinaria.groupBy({
        by: ['maquinariaId'],
        where: { maquinariaId: { in: ids }, estado: { in: ['PENDIENTE', 'EN_PROCESO'] } },
        _min: { fechaProgramada: true },
      }),
      this.prisma.limpiezaMaquinaria.groupBy({
        by: ['maquinariaId'],
        where: { maquinariaId: { in: ids } },
        _max: { fecha: true },
      }),
    ]);
    return {
      incidentes: new Map(inc.map((r) => [r.maquinariaId, r._count._all])),
      mantenimientos: new Map(man.map((r) => [r.maquinariaId, r._count._all])),
      proximoMantenimiento: new Map(
        proximo
          .filter((r) => r._min.fechaProgramada)
          .map((r) => [r.maquinariaId, r._min.fechaProgramada as Date]),
      ),
      ultimaLimpieza: new Map(
        limpieza
          .filter((r) => r._max.fecha)
          .map((r) => [r.maquinariaId, r._max.fecha as Date]),
      ),
    };
  }

  async list(dto: ListMaquinariaDto, actor: Actor) {
    const where: Prisma.MaquinariaWhereInput = { AND: [this.scopeMaquinaria(actor)] };
    const and = where.AND as Prisma.MaquinariaWhereInput[];

    if (dto.agenciaId) and.push({ agenciaId: dto.agenciaId });
    if (dto.bahiaId) and.push({ bahiaId: dto.bahiaId });
    if (dto.tipo) and.push({ tipo: dto.tipo });
    if (dto.estadoOperativo) and.push({ estadoOperativo: dto.estadoOperativo });
    if (dto.activa !== undefined) and.push({ activa: dto.activa });
    if (dto.operadorAsignadoId) and.push({ operadorAsignadoId: dto.operadorAsignadoId });
    if (dto.regionId) and.push({ agencia: { regionId: dto.regionId } });
    if (dto.clienteId) and.push({ agencia: { clienteId: dto.clienteId } });
    const igual = (valor: string) => ({ equals: valor.trim(), mode: 'insensitive' as const });
    if (dto.agenciaNombre) and.push({ agencia: { nombre: igual(dto.agenciaNombre) } });
    if (dto.bahiaNombre) and.push({ bahia: { nombre: igual(dto.bahiaNombre) } });
    if (dto.clienteNombre) and.push({ agencia: { cliente: { nombre: igual(dto.clienteNombre) } } });
    if (dto.regionNombre) {
      and.push({ agencia: { OR: [{ region: igual(dto.regionNombre) }, { regionRel: { nombre: igual(dto.regionNombre) } }] } });
    }
    const busqueda = whereBusqueda(['codigo', 'nombre', 'marca', 'modelo', 'serie'], dto.search);
    if (busqueda) and.push(busqueda as Prisma.MaquinariaWhereInput);

    // Los conteos de pendientes se calculan solo para las filas que se devuelven (antes, para todas las máquinas).
    const conPendientes = async (items: any[]) => {
      const pendientes = await this.conteosPendientes(items.map((i) => i.id));
      const ahora = new Date();
      return items.map((m) => {
        const regla = this.reglaLimpieza(m);
        return {
          ...m,
          incidentesNoAtendidos: pendientes.incidentes.get(m.id) ?? 0,
          mantenimientosVencidos: pendientes.mantenimientos.get(m.id) ?? 0,
          proximoMantenimiento: pendientes.proximoMantenimiento.get(m.id) ?? null,
          limpiezaRegla: regla,
          limpiezaAtrasada: this.limpiezaAtrasada(regla, pendientes.ultimaLimpieza.get(m.id) ?? null, ahora),
        };
      });
    };

    const resultado = await listarPaginable(dto, {
      where: where as Record<string, unknown>,
      columnas: columnasSimples({
        codigo: 'codigo',
        nombre: 'nombre',
        tipo: 'tipo',
        estado: 'estadoOperativo',
        agencia: 'agencia.nombre',
        bahia: 'bahia.nombre',
        fecha: 'createdAt',
      }),
      ordenHeredado: [{ codigo: 'asc' }],
      contar: (w) => this.prisma.maquinaria.count({ where: w }),
      mapear: conPendientes,
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.maquinaria.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: {
            agencia: { select: { id: true, nombre: true, codigo: true, regionId: true } },
            bahia: { select: { id: true, nombre: true, codigo: true } },
            operadorAsignado: { select: { id: true, name: true, lastname: true } },
            _count: {
              select: {
                incidentes: { where: { estado: { notIn: ['RESUELTO', 'CANCELADO'] } } },
                mantenimientos: true,
              },
            },
          },
        }),
    });

    // Sin página: la forma de siempre ({ success, total, data }), ahora con tope de 100.
    if (Array.isArray(resultado)) return { success: true, total: resultado.length, data: resultado };
    return { success: true, ...resultado };
  }

  /** Ficha completa de una máquina: base del modal con incidencias, movimientos y mantenimientos. */
  async detalle(dto: DetalleMaquinariaDto, actor: Actor) {
    await this.assertPuedeVerMaquina(actor, dto.id);
    const m = await this.prisma.maquinaria.findUnique({
      where: { id: dto.id },
      include: {
        agencia: { select: { id: true, nombre: true, codigo: true, regionId: true, tipoUbicacion: true } },
        bahia: { select: { id: true, nombre: true, codigo: true } },
        creadoPor: { select: { id: true, name: true, lastname: true } },
        desactivadoPor: { select: { id: true, name: true, lastname: true } },
        operadorAsignado: { select: { id: true, name: true, lastname: true } },
      },
    });
    if (!m) throw new NotFoundException(`Equipo ${dto.id} no encontrado`);

    const [pendientes, proximo, totales, ultimaLimpieza] = await Promise.all([
      this.conteosPendientes([m.id]),
      this.prisma.mantenimientoMaquinaria.findFirst({
        where: { maquinariaId: m.id, estado: { in: ['PENDIENTE', 'EN_PROCESO'] } },
        orderBy: { fechaProgramada: 'asc' },
        select: { id: true, fechaProgramada: true, estado: true },
      }),
      Promise.all([
        this.prisma.incidenteTecnico.count({ where: { maquinariaId: m.id } }),
        this.prisma.mantenimientoMaquinaria.count({ where: { maquinariaId: m.id } }),
        this.prisma.movimientoMaquinaria.count({ where: { maquinariaId: m.id } }),
      ]),
      this.prisma.limpiezaMaquinaria.findFirst({
        where: { maquinariaId: m.id },
        orderBy: { fecha: 'desc' },
        select: { fecha: true, fotos: true },
      }),
    ]);

    const reglaLimpieza = this.reglaLimpieza(m);
    return {
      success: true,
      data: {
        ...m,
        incidentesNoAtendidos: pendientes.incidentes.get(m.id) ?? 0,
        mantenimientosVencidos: pendientes.mantenimientos.get(m.id) ?? 0,
        proximoMantenimiento: proximo,
        totales: { incidentes: totales[0], mantenimientos: totales[1], movimientos: totales[2] },
        limpieza: {
          regla: reglaLimpieza,
          ultimaFecha: ultimaLimpieza?.fecha ?? null,
          ultimasFotos: ultimaLimpieza?.fotos ?? [],
          atrasada: this.limpiezaAtrasada(reglaLimpieza, ultimaLimpieza?.fecha ?? null, new Date()),
        },
      },
    };
  }

  async create(dto: CreateMaquinariaDto, actor: Actor) {
    const existing = await this.prisma.maquinaria.findUnique({ where: { codigo: dto.codigo } });
    if (existing) {
      throw new ConflictException(`Ya existe un equipo con el código ${dto.codigo}`);
    }
    if (dto.estadoOperativo === 'DE_BAJA') {
      throw new BadRequestException('Una máquina nueva no puede crearse dada de baja.');
    }

    await this.verificarImagenPerfil(dto.codigo, dto.fotoUrl, 'foto');
    await this.verificarImagenPerfil(dto.codigo, dto.fichaTecnicaUrl, 'ficha-tecnica');

    let agencia: { id: string; nombre: string; regionId: string | null } | null = null;
    if (dto.agenciaId) {
      agencia = await this.prisma.agencia.findUnique({
        where: { id: dto.agenciaId },
        select: { id: true, nombre: true, regionId: true },
      });
      if (!agencia) throw new NotFoundException('Agencia no encontrada');
    }
    if (dto.bahiaId) {
      const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.bahiaId } });
      if (!bahia || (dto.agenciaId && bahia.agenciaId !== dto.agenciaId)) {
        throw new BadRequestException('La bahía no pertenece a la agencia indicada.');
      }
    }

    const item = await this.prisma.$transaction(async (tx) => {
      const created = await tx.maquinaria.create({
        data: {
          codigo: dto.codigo,
          nombre: dto.nombre,
          tipo: dto.tipo,
          marca: dto.marca,
          modelo: dto.modelo,
          serie: dto.serie,
          estadoOperativo: dto.estadoOperativo || 'OPERATIVA',
          fotoUrl: dto.fotoUrl,
          fichaTecnicaUrl: dto.fichaTecnicaUrl,
          horasUso: dto.horasUso ?? 0,
          agenciaId: dto.agenciaId || undefined,
          bahiaId: dto.bahiaId || undefined,
          creadoPorId: actor.id,
        },
        include: {
          agencia: { select: { id: true, nombre: true, regionId: true } },
          bahia: { select: { id: true, nombre: true } },
        },
      });
      await this.registrarEvento(tx, created, 'MAQUINA_CREADA', actor.id, created.id, {
        codigo: created.codigo,
        nombre: created.nombre,
        tipo: created.tipo,
        agencia: created.agencia?.nombre ?? null,
        bahia: created.bahia?.nombre ?? null,
      });
      return created;
    });

    return { success: true, data: item };
  }

  private static readonly CAMPOS_EDITABLES = [
    'nombre', 'tipo', 'marca', 'modelo', 'serie', 'estadoOperativo', 'fotoUrl', 'fichaTecnicaUrl', 'horasUso',
    'ventanaAdelantoDias',
  ];

  async update(dto: UpdateMaquinariaDto, actor: Actor, permisos?: { editar: boolean; archivos: boolean }) {
    const existing = await this.cargarMaquina(dto.id);
    const actual = await this.prisma.maquinaria.findUniqueOrThrow({ where: { id: dto.id } });

    if (dto.estadoOperativo === 'DE_BAJA') {
      throw new BadRequestException('Para dar de baja una máquina usa la acción de desactivar.');
    }
    if (dto.estadoOperativo && !existing.activa) {
      throw new BadRequestException('La máquina está desactivada: actívala antes de cambiar su estado.');
    }
    const agenciaCambia = dto.agenciaId !== undefined && (dto.agenciaId || null) !== existing.agenciaId;
    const bahiaCambia = dto.bahiaId !== undefined && (dto.bahiaId || null) !== existing.bahiaId;
    if (agenciaCambia || bahiaCambia) {
      throw new BadRequestException('Para cambiar de agencia o bahía usa el movimiento (transferir), así queda trazabilidad.');
    }

    // Solo se verifica lo que cambia: las imágenes que ya estaban guardadas no se vuelven a exigir.
    if (dto.fotoUrl && dto.fotoUrl !== actual.fotoUrl) {
      await this.verificarImagenPerfil(existing.codigo, dto.fotoUrl, 'foto');
    }
    if (dto.fichaTecnicaUrl && dto.fichaTecnicaUrl !== actual.fichaTecnicaUrl) {
      await this.verificarImagenPerfil(existing.codigo, dto.fichaTecnicaUrl, 'ficha-tecnica');
    }

    const { id, agenciaId: _a, bahiaId: _b, ...cambiosDto } = dto;
    const cambios = this.diff(actual as unknown as Record<string, unknown>, cambiosDto, MaquinariaService.CAMPOS_EDITABLES);
    if (!Object.keys(cambios).length) {
      return { success: true, data: actual, sinCambios: true };
    }

    // Editar los datos y cambiar la foto o la ficha técnica son dos casillas distintas sobre el mismo endpoint.
    if (permisos) {
      const campos = Object.keys(cambios);
      const archivos = campos.filter((c) => c === 'fotoUrl' || c === 'fichaTecnicaUrl');
      if (campos.length > archivos.length && !permisos.editar) {
        throw new ForbiddenException('Tu rol no puede editar los datos de la máquina.');
      }
      if (archivos.length && !permisos.archivos) {
        throw new ForbiddenException('Tu rol no puede cambiar la foto ni la ficha técnica.');
      }
    }

    const data: Prisma.MaquinariaUpdateInput = {};
    for (const campo of Object.keys(cambios)) {
      (data as Record<string, unknown>)[campo] = (cambiosDto as Record<string, unknown>)[campo];
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.maquinaria.update({
        where: { id },
        data,
        include: {
          agencia: { select: { id: true, nombre: true, regionId: true } },
          bahia: { select: { id: true, nombre: true } },
        },
      });
      await this.registrarEvento(tx, u, 'MAQUINA_EDITADA', actor.id, id, { cambios });
      return u;
    });

    return { success: true, data: updated };
  }

  /** Activar / desactivar (desactivar equivale a dar de baja). Siempre queda quién, cuándo y por qué. */
  async setActiva(dto: SetActivaMaquinariaDto, actor: Actor) {
    const m = await this.cargarMaquina(dto.maquinariaId);
    if (m.activa === dto.activa) {
      throw new BadRequestException(dto.activa ? 'La máquina ya está activa.' : 'La máquina ya está desactivada.');
    }
    const motivo = dto.motivo?.trim() || null;
    if (!dto.activa && !motivo) {
      throw new BadRequestException('Indica el motivo para desactivar la máquina.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.maquinaria.update({
        where: { id: m.id },
        data: dto.activa
          ? {
              activa: true,
              estadoOperativo: 'OPERATIVA',
              desactivadoPorId: null,
              fechaDesactivacion: null,
              motivoDesactivacion: null,
            }
          : {
              activa: false,
              estadoOperativo: 'DE_BAJA',
              desactivadoPorId: actor.id,
              fechaDesactivacion: new Date(),
              motivoDesactivacion: motivo,
            },
        include: {
          agencia: { select: { id: true, nombre: true, regionId: true } },
          bahia: { select: { id: true, nombre: true } },
          desactivadoPor: { select: { id: true, name: true, lastname: true } },
        },
      });
      await this.registrarEvento(tx, u, dto.activa ? 'MAQUINA_ACTIVADA' : 'MAQUINA_DESACTIVADA', actor.id, m.id, {
        motivo,
        estadoAnterior: m.estadoOperativo,
      });
      return u;
    });

    if (!dto.activa && updated.agencia?.id) {
      const lideres = await this.prisma.user.findMany({
        where: { estado: 1, agenciaId: updated.agencia.id, role: { namerol: { in: [...ROLES_LIDER_AGENCIA] } } },
        select: { id: true },
      });
      const porRol = await this.notifications.resolverDestinatariosPorRol({
        global: ['ADMIN', 'SUPER_ADMIN'],
        regionales: ['COORD_MANTENIMIENTO', 'SUPERVISOR'],
        regionId: updated.agencia.regionId,
      });
      void this.notifications.notificarUsuarios(
        [...lideres.map((l) => l.id), ...porRol],
        `Máquina dada de baja: ${updated.codigo}`,
        `${updated.nombre} de la agencia "${updated.agencia.nombre}" quedó dada de baja. Motivo: ${motivo}`,
        { type: 'MAQUINA_DADA_DE_BAJA', maquinariaId: updated.id },
        { tipo: 'MAQUINA_DADA_DE_BAJA', entidadTipo: 'MAQUINARIA', entidadId: updated.id },
      );
    }

    return { success: true, data: updated };
  }

  async asignarOperador(dto: AsignarOperadorDto, actor: Actor) {
    const m = await this.cargarMaquina(dto.maquinariaId);
    assertRegion(actor, this.regionDe(m));
    this.assertActiva(m);

    const operadorId = dto.operadorId || null;
    if (operadorId) {
      const u = await this.prisma.user.findUnique({
        where: { id: operadorId },
        select: {
          id: true,
          estado: true,
          regionId: true,
          role: { select: { namerol: true } },
          agencia: { select: { regionId: true } },
        },
      });
      if (!u || u.estado !== 1) throw new NotFoundException('El usuario indicado no existe o está inactivo.');
      // Normalizado: cuentas viejas aún pueden tener el rol guardado como PULIDOR_FIJO/PULIDOR_MOVIL.
      if (!ROLES_OPERADOR.includes(normalizarRol(u.role.namerol))) {
        throw new BadRequestException('Solo se puede asignar la máquina a un pulidor (fijo o móvil).');
      }
      // Fuera de admin/super admin, solo se puede asignar a un pulidor de la propia región
      // (fijo: región de su agencia; móvil: su región directa).
      if (!esAdmin(actor)) {
        const regionPulidor = u.regionId ?? u.agencia?.regionId ?? null;
        if (!regionPulidor || regionPulidor !== actor.regionId) {
          throw new ForbiddenException('Solo puedes asignar máquinas a pulidores de tu región.');
        }
      }
    }
    if (operadorId === m.operadorAsignadoId) {
      throw new BadRequestException('La máquina ya está asignada a ese usuario.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.maquinaria.update({
        where: { id: m.id },
        data: { operadorAsignadoId: operadorId },
        include: { operadorAsignado: { select: { id: true, name: true, lastname: true } } },
      });
      await this.registrarEvento(tx, m, 'OPERADOR_ASIGNADO', actor.id, m.id, {
        anterior: m.operadorAsignadoId,
        nuevo: operadorId,
      });
      return u;
    });

    return { success: true, data: updated };
  }

  async configurarVentana(dto: ConfigurarVentanaDto, actor: Actor) {
    const m = await this.cargarMaquina(dto.maquinariaId);
    assertRegion(actor, this.regionDe(m));
    const dias = (dto.dias ?? 0) + (dto.semanas ?? 0) * 7;
    if (dias === m.ventanaAdelantoDias) {
      return { success: true, data: { id: m.id, ventanaAdelantoDias: dias }, sinCambios: true };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.maquinaria.update({ where: { id: m.id }, data: { ventanaAdelantoDias: dias } });
      await this.registrarEvento(tx, m, 'MAQUINA_EDITADA', actor.id, m.id, {
        cambios: { ventanaAdelantoDias: { antes: m.ventanaAdelantoDias, despues: dias } },
      });
    });
    return { success: true, data: { id: m.id, ventanaAdelantoDias: dias } };
  }

  // ==============================================================
  // INCIDENTES TÉCNICOS
  // ==============================================================

  private readonly includeIncidente = {
    maquinaria: {
      select: {
        id: true, codigo: true, nombre: true, tipo: true, activa: true,
        agencia: { select: { id: true, nombre: true, regionId: true } },
        operadorAsignado: {
          select: { id: true, agenciaId: true, agencia: { select: { nombre: true } } },
        },
      },
    },
    reportadoPor: { select: { id: true, name: true, lastname: true, email: true } },
    resueltoPor: { select: { id: true, name: true, lastname: true, email: true } },
    tecnicoAsignado: { select: { id: true, name: true, lastname: true, email: true } },
    destinoTaller: { select: { id: true, nombre: true, tipoUbicacion: true } },
    evidencias: { where: { activa: true }, orderBy: { creadaEn: 'asc' as const } },
  } as const;

  /** Una incidencia sin asignar es "No atendida", sin importar cuánto tiempo lleve. */
  private incidenteNoAtendido(i: { estado: string; tecnicoAsignadoId: string | null }): boolean {
    return i.estado === 'ABIERTO' && !i.tecnicoAsignadoId;
  }

  /**
   * La máquina puede estar registrada en una agencia (dato físico, a veces desactualizado) pero tener
   * un operador personal asignado (pulidor fijo o móvil). Cuando hay operador, su ubicación manda:
   * la agencia del pulidor fijo, o "Pulidor Móvil" si no tiene agencia fija (viaja por región).
   */
  private ubicacionIncidente<
    T extends {
      maquinaria?: {
        agencia?: { id: string; nombre: string; regionId: string | null } | null;
        operadorAsignado?: { id: string; agenciaId: string | null; agencia?: { nombre: string } | null } | null;
      } | null;
    },
  >(inc: T): T & { agenciaMostrada: string | null; esPulidorMovil: boolean } {
    const op = inc.maquinaria?.operadorAsignado;
    if (op) {
      if (op.agenciaId && op.agencia?.nombre) {
        return { ...inc, agenciaMostrada: op.agencia.nombre, esPulidorMovil: false };
      }
      return { ...inc, agenciaMostrada: null, esPulidorMovil: true };
    }
    return { ...inc, agenciaMostrada: inc.maquinaria?.agencia?.nombre ?? null, esPulidorMovil: false };
  }

  async reportarIncidente(dto: ReportarIncidenteDto, actor: Actor, puedeSubirEvidencias = true) {
    if (dto.clientUuid) {
      const previo = await this.prisma.incidenteTecnico.findUnique({
        where: { clientUuid: dto.clientUuid },
        include: this.includeIncidente,
      });
      if (previo) return { success: true, data: this.ubicacionIncidente(previo), duplicado: true };
    }

    const maquina = await this.cargarMaquina(dto.maquinariaId);
    this.assertActiva(maquina);
    // El operador asignado reporta lo suyo; el líder reporta cualquier máquina de su agencia (supervisa
    // toda la sede, no solo lo que quedó a su nombre); supervisor (su región) y coordinador de servicios
    // especiales (sus pulidores) también reportan, con el mismo alcance que usan para ver la máquina
    // (scopeMaquinaria).
    if (maquina.operadorAsignadoId !== actor.id) {
      if (esLider(actor) || esSupervisor(actor) || esCoordServiciosEspeciales(actor)) {
        await this.assertPuedeVerMaquina(actor, maquina.id);
      } else if (esRolPropio(actor)) {
        // Rol propio: reporta lo que su ámbito le deja ver (la misma lista que consulta).
        await this.assertPuedeVerMaquina(actor, maquina.id);
      } else {
        throw new ForbiddenException('Solo puedes reportar las máquinas que tienes asignadas.');
      }
    }

    const inputs: EvidenciaInputDto[] = [...(dto.evidencias || [])];
    if (dto.fotoEvidenciaUrl && !inputs.some((e) => e.url === dto.fotoEvidenciaUrl)) {
      inputs.unshift({ url: dto.fotoEvidenciaUrl });
    }
    this.exigirPermisoParaEvidencias(inputs, puedeSubirEvidencias);
    // Solo se exige evidencia al rol que tiene habilitada su subida; el PDF se pide al resolver.
    const evidencias = await this.verificarEvidencias(maquina, inputs, { requiereMultimedia: puedeSubirEvidencias });

    if (dto.destinoTallerId) {
      const taller = await this.prisma.agencia.findUnique({ where: { id: dto.destinoTallerId } });
      if (!taller) throw new NotFoundException('Taller destino no encontrado');
    }

    const gravedad = dto.gravedad || 'MEDIA';
    const primeraFoto = evidencias.find((e) => e.kind !== 'DOCUMENTO');

    // La hora del reporte es la del servidor: el reporte siempre se hace con conexión.
    const incidente = await this.prisma.$transaction(async (tx) => {
      const inc = await tx.incidenteTecnico.create({
        data: {
          clientUuid: dto.clientUuid || undefined,
          maquinariaId: maquina.id,
          reportadoPorId: actor.id,
          titulo: dto.titulo,
          descripcion: dto.descripcion,
          gravedad,
          estado: 'ABIERTO',
          fotoEvidenciaUrl: primeraFoto?.url,
          destinoTallerId: dto.destinoTallerId || undefined,
          fechaReporte: new Date(),
          evidencias: { create: evidencias.map((e) => this.evidenciaData(e, 'INCIDENTE', 'REPORTE', actor.id)) },
        },
        include: this.includeIncidente,
      });
      await this.registrarEvento(tx, maquina, 'INCIDENTE_REPORTADO', actor.id, inc.id, {
        titulo: inc.titulo,
        gravedad,
        reportadoEn: inc.fechaReporte,
        evidencias: this.resumenEvidencias(evidencias),
      });
      return inc;
    });

    // Solo el coordinador de mantenimiento de la región de la máquina recibe la alerta.
    void this.notifications.notificarCoordinadorRegion({
      regionId: this.regionDe(maquina),
      title: `Nueva incidencia: ${maquina.codigo}`,
      body: `${incidente.titulo} (Gravedad: ${gravedad})`,
      data: { type: 'INCIDENTE_NUEVO', incidenteId: incidente.id, maquinariaId: maquina.id },
      opts: { tipo: 'INCIDENTE_NUEVO', entidadTipo: 'MAQUINARIA', entidadId: maquina.id },
    });

    return { success: true, data: this.ubicacionIncidente(incidente) };
  }

  private async cargarIncidente(id: string) {
    const inc = await this.prisma.incidenteTecnico.findUnique({
      where: { id },
      include: { maquinaria: { include: this.includeMaquinaCtx } },
    });
    if (!inc) throw new NotFoundException(`Incidente ${id} no encontrado`);
    return inc;
  }

  async asignarIncidente(dto: AsignarIncidenteDto, actor: Actor) {
    const inc = await this.cargarIncidente(dto.incidenteId);
    const maquina = inc.maquinaria as unknown as MaquinaCtx;
    assertRegion(actor, this.regionDe(maquina));
    if (inc.estado === 'RESUELTO' || inc.estado === 'CANCELADO') {
      throw new BadRequestException('La incidencia ya está cerrada.');
    }

    const tecnicoId = dto.tecnicoId || actor.id;
    await this.validarResponsable(tecnicoId, this.regionDe(maquina));
    if (dto.destinoTallerId) {
      const taller = await this.prisma.agencia.findUnique({ where: { id: dto.destinoTallerId } });
      if (!taller) throw new NotFoundException('Taller destino no encontrado');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.incidenteTecnico.update({
        where: { id: inc.id },
        data: {
          tecnicoAsignadoId: tecnicoId,
          fechaAsignacion: new Date(),
          estado: 'EN_PROCESO',
          destinoTallerId: dto.destinoTallerId || inc.destinoTallerId,
        },
        include: this.includeIncidente,
      });
      await this.registrarEvento(tx, maquina, 'INCIDENTE_ASIGNADO', actor.id, inc.id, {
        anterior: inc.tecnicoAsignadoId,
        nuevo: tecnicoId,
        autoAsignado: tecnicoId === actor.id,
      });
      return u;
    });

    if (tecnicoId !== actor.id) {
      void this.notifications.notificarUsuarios(
        [tecnicoId],
        `Incidencia asignada: ${maquina.codigo}`,
        inc.titulo,
        { type: 'INCIDENTE_ASIGNADO', incidenteId: inc.id, maquinariaId: maquina.id },
        { tipo: 'INCIDENCIA_ASIGNADA', entidadTipo: 'MAQUINARIA', entidadId: maquina.id },
      );
    }
    return { success: true, data: this.ubicacionIncidente(updated) };
  }

  async resolverIncidente(dto: ResolverIncidenteDto, actor: Actor, puedeSubirEvidencias = true) {
    const inc = await this.cargarIncidente(dto.incidenteId);
    const maquina = inc.maquinaria as unknown as MaquinaCtx;
    if (inc.estado === 'RESUELTO' || inc.estado === 'CANCELADO') {
      throw new BadRequestException('La incidencia ya está cerrada.');
    }

    // Repara el técnico asignado, o el coordinador que decide hacerlo él mismo.
    let autoAsignar = false;
    if (inc.tecnicoAsignadoId !== actor.id) {
      if (esAdmin(actor)) {
        // admin / super admin pueden cerrar cualquier incidencia
      } else if (esCoordMantenimiento(actor) && !inc.tecnicoAsignadoId) {
        assertRegion(actor, this.regionDe(maquina));
        autoAsignar = true;
      } else {
        throw new ForbiddenException('Solo el técnico asignado puede reparar esta incidencia.');
      }
    }

    const nuevoEstado = dto.estado || 'RESUELTO';
    this.exigirPermisoParaEvidencias(dto.evidencias || [], puedeSubirEvidencias);
    // Al resolver (repararla de verdad), los roles habilitados deben adjuntar foto/video y PDF.
    // Si el permiso de evidencias está desactivado, se conserva la resolución sin adjuntos.
    const evidencias = nuevoEstado === 'RESUELTO' && puedeSubirEvidencias
      ? await this.verificarEvidencias(maquina, dto.evidencias, { requiereMultimedia: true, requiereDocumento: true })
      : await this.verificarEvidencias(maquina, dto.evidencias, {});
    if (nuevoEstado === 'RESUELTO' && dto.costoTotal == null) {
      throw new BadRequestException('El costo de la reparación es obligatorio para resolver la incidencia.');
    }

    const ahora = new Date();
    const solucion = dto.repuestosUtilizados
      ? `${dto.solucion}\nRepuestos: ${dto.repuestosUtilizados}`
      : dto.solucion;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (autoAsignar) {
        await this.registrarEvento(tx, maquina, 'INCIDENTE_ASIGNADO', actor.id, inc.id, {
          anterior: null,
          nuevo: actor.id,
          autoAsignado: true,
        });
      }
      const u = await tx.incidenteTecnico.update({
        where: { id: inc.id },
        data: {
          estado: nuevoEstado,
          solucion,
          ...(autoAsignar ? { tecnicoAsignadoId: actor.id, fechaAsignacion: ahora } : {}),
          ...(nuevoEstado === 'RESUELTO' ? { resueltoPorId: actor.id, fechaSolucion: ahora, costoTotal: dto.costoTotal } : {}),
          evidencias: {
            create: evidencias.map((e) => this.evidenciaData(e, 'INCIDENTE', 'REPARACION', actor.id)),
          },
        },
        include: this.includeIncidente,
      });
      await this.registrarEvento(
        tx,
        maquina,
        nuevoEstado === 'RESUELTO' ? 'INCIDENTE_REPARADO' : 'INCIDENTE_CANCELADO',
        actor.id,
        inc.id,
        {
          reportadoEn: inc.fechaReporte,
          reparadoEn: nuevoEstado === 'RESUELTO' ? ahora : null,
          minutosHastaReparar:
            nuevoEstado === 'RESUELTO' ? Math.round((ahora.getTime() - inc.fechaReporte.getTime()) / 60000) : null,
          evidencias: this.resumenEvidencias(evidencias),
        },
      );
      return u;
    });

    if (nuevoEstado === 'RESUELTO') {
      void this.notifications.notificarUsuarios(
        [inc.reportadoPorId],
        `Incidencia reparada: ${maquina.codigo}`,
        inc.titulo,
        { type: 'INCIDENTE_REPARADO', incidenteId: inc.id, maquinariaId: maquina.id },
        { tipo: 'INCIDENCIA_RESUELTA', entidadTipo: 'MAQUINARIA', entidadId: maquina.id },
      );
    }
    return { success: true, data: this.ubicacionIncidente(updated) };
  }

  async editarIncidente(dto: EditarIncidenteDto, actor: Actor) {
    const inc = await this.cargarIncidente(dto.incidenteId);
    const maquina = inc.maquinaria as unknown as MaquinaCtx;

    // El costo ya lo ingresó el técnico al resolver; corregirlo después es solo de admin o coordinador de mantenimiento.
    let campos = ['titulo', 'descripcion', 'gravedad', 'solucion', 'costoTotal'];
    if (esTecnico(actor)) {
      // El reparador solo corrige su propio trabajo.
      if (inc.tecnicoAsignadoId !== actor.id && inc.resueltoPorId !== actor.id) {
        throw new ForbiddenException('Solo puedes editar incidencias que tienes asignadas.');
      }
      campos = ['solucion'];
    } else {
      assertRegion(actor, this.regionDe(maquina));
    }

    const { incidenteId: _id, ...propuesta } = dto;
    const cambios = this.diff(inc as unknown as Record<string, unknown>, propuesta, campos);
    if (!Object.keys(cambios).length) {
      return { success: true, data: inc, sinCambios: true };
    }
    const data: Record<string, unknown> = {};
    for (const campo of Object.keys(cambios)) data[campo] = (propuesta as Record<string, unknown>)[campo];

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.incidenteTecnico.update({
        where: { id: inc.id },
        data: data as Prisma.IncidenteTecnicoUpdateInput,
        include: this.includeIncidente,
      });
      await this.registrarEvento(tx, maquina, 'INCIDENTE_EDITADO', actor.id, inc.id, { cambios });
      return u;
    });
    return { success: true, data: this.ubicacionIncidente(updated) };
  }

  async listIncidentes(dto: ListIncidentesDto, actor: Actor) {
    const filtros: Record<string, unknown>[] = [this.scopeIncidentes(actor) as Record<string, unknown>];
    if (dto.maquinariaId) filtros.push({ maquinariaId: dto.maquinariaId });
    if (dto.gravedad) filtros.push({ gravedad: dto.gravedad });
    if (dto.tecnicoId) filtros.push({ tecnicoAsignadoId: dto.tecnicoId });
    if (dto.agenciaId) filtros.push({ maquinaria: { agenciaId: dto.agenciaId } });
    if (dto.regionId) filtros.push({ maquinaria: { agencia: { regionId: dto.regionId } } });
    if (dto.clienteId) filtros.push({ maquinaria: { agencia: { clienteId: dto.clienteId } } });
    const rango = rangoFechas(dto.fechaDesde, dto.fechaHasta);
    if (rango) filtros.push({ fechaReporte: rango });

    const baseSinEstado = combinarWhere(...filtros, whereBusqueda(CAMPOS_BUSQUEDA_INCIDENTES, dto.search));
    const base = combinarWhere(
      baseSinEstado,
      dto.estado ? { estado: dto.estado } : undefined,
      dto.soloNoAtendidas ? { estado: 'ABIERTO', tecnicoAsignadoId: null } : undefined,
    );

    const { page, pageSize, skip, take } = this.pagina(dto);
    const contar = (where: Record<string, unknown>) => this.prisma.incidenteTecnico.count({ where: where as never });
    const buscar = (where: Record<string, unknown>, orderBy: unknown[], s: number, t: number) =>
      this.prisma.incidenteTecnico.findMany({
        where: where as never, orderBy: orderBy as never, skip: s, take: t, include: this.includeIncidente,
      });

    // Grupos en el orden acordado: sin atender → en proceso → cerradas. Dentro de cada uno, lo más reciente primero.
    const enOrden = [{ fechaReporte: 'desc' }, { id: 'desc' }];
    const grupoNoAtendidas = { estado: 'ABIERTO', tecnicoAsignadoId: null };
    const grupoEnProceso = { OR: [{ estado: 'EN_PROCESO' }, { estado: 'ABIERTO', tecnicoAsignadoId: { not: null } }] };
    const grupoCerradas = { NOT: [{ estado: 'ABIERTO' }, { estado: 'EN_PROCESO' }] };

    let items: Awaited<ReturnType<typeof buscar>>;
    let total: number;
    if (dto.sortField && Object.prototype.hasOwnProperty.call(ORDEN_INCIDENTES, dto.sortField)) {
      // Orden pedido por el usuario en una columna: manda sobre los grupos.
      const orden = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_INCIDENTES, { campo: 'fecha', dir: 'desc' });
      [items, total] = await Promise.all([buscar(base, orden, skip, take), contar(base)]);
    } else {
      const r = await paginarPorGrupos(
        [
          { where: combinarWhere(base, grupoNoAtendidas), orderBy: enOrden },
          { where: combinarWhere(base, grupoEnProceso), orderBy: enOrden },
          { where: combinarWhere(base, grupoCerradas), orderBy: enOrden },
        ],
        skip, take, contar, buscar,
      );
      items = r.items;
      total = r.total;
    }

    const extra: Record<string, unknown> = {};
    if (dto.incluirResumen) {
      const [noAtendidas, enProceso, cerradas] = await Promise.all([
        contar(combinarWhere(baseSinEstado, grupoNoAtendidas)),
        contar(combinarWhere(baseSinEstado, grupoEnProceso)),
        contar(combinarWhere(baseSinEstado, grupoCerradas)),
      ]);
      extra['resumen'] = { noAtendidas, enProceso, cerradas, total: noAtendidas + enProceso + cerradas };
    }

    return this.respuestaPagina(
      items.map((i) => ({ ...this.ubicacionIncidente(i), noAtendida: this.incidenteNoAtendido(i) })),
      total, page, pageSize, extra,
    );
  }

  // ==============================================================
  // MANTENIMIENTOS
  // ==============================================================

  private readonly includeMantenimiento = {
    maquinaria: {
      select: {
        id: true, codigo: true, nombre: true, tipo: true, ventanaAdelantoDias: true,
        agencia: { select: { id: true, nombre: true, regionId: true } },
      },
    },
    tecnico: { select: { id: true, name: true, lastname: true } },
    creadoPor: { select: { id: true, name: true, lastname: true } },
    ejecutadoPor: { select: { id: true, name: true, lastname: true } },
    evidencias: { where: { activa: true }, orderBy: { creadaEn: 'asc' as const } },
  } as const;

  /** Un mantenimiento sin ejecutar cuya fecha programada ya pasó es "No atendido". */
  private mantenimientoNoAtendido(m: { estado: string; fechaProgramada: Date | null }, ahora = new Date()): boolean {
    return m.estado !== 'FINALIZADO' && !!m.fechaProgramada && m.fechaProgramada.getTime() < ahora.getTime();
  }

  async registrarMantenimiento(dto: RegistrarMantenimientoDto, actor: Actor) {
    const maquina = await this.cargarMaquina(dto.maquinariaId);
    assertRegion(actor, this.regionDe(maquina));
    this.assertActiva(maquina);

    const tecnicoId = dto.tecnicoId || actor.id;
    await this.validarResponsable(tecnicoId, this.regionDe(maquina));
    const evidencias = await this.verificarEvidencias(maquina, dto.evidencias, {});

    const fechaProgramada = dto.fechaProgramada ? new Date(dto.fechaProgramada) : new Date();
    if (Number.isNaN(fechaProgramada.getTime())) throw new BadRequestException('Fecha programada inválida.');
    const frecuenciaDias = dto.frecuenciaDias != null ? Number(dto.frecuenciaDias) : 0;
    const proximo = dto.proximoMantenimiento
      ? new Date(dto.proximoMantenimiento)
      : frecuenciaDias > 0
        ? addDays(fechaProgramada, frecuenciaDias)
        : undefined;

    const mantenimiento = await this.prisma.$transaction(async (tx) => {
      const m = await tx.mantenimientoMaquinaria.create({
        data: {
          maquinariaId: maquina.id,
          tecnicoId,
          creadoPorId: actor.id,
          estado: 'PENDIENTE',
          observaciones: dto.observaciones,
          repuestosUsados: dto.repuestosUsados || undefined,
          costoTotal: dto.costoTotal ? dto.costoTotal : undefined,
          fechaMantenimiento: fechaProgramada,
          fechaProgramada,
          proximoMantenimiento: proximo,
          frecuenciaDias,
          evidencias: {
            create: evidencias.map((e) => this.evidenciaData(e, 'MANTENIMIENTO', 'PROGRAMACION', actor.id)),
          },
        },
        include: this.includeMantenimiento,
      });
      await this.registrarEvento(tx, maquina, 'MANTENIMIENTO_PROGRAMADO', actor.id, m.id, {
        programadoPara: fechaProgramada,
        frecuenciaDias,
        tecnicoId,
      });
      return m;
    });

    if (tecnicoId !== actor.id) {
      void this.notifications.notificarUsuarios(
        [tecnicoId],
        `Mantenimiento asignado: ${maquina.codigo}`,
        `Programado para ${fechaProgramada.toISOString().slice(0, 10)}`,
        { type: 'MANTENIMIENTO_ASIGNADO', mantenimientoId: mantenimiento.id, maquinariaId: maquina.id },
        { tipo: 'MANTENIMIENTO_ASIGNADO', entidadTipo: 'MAQUINARIA', entidadId: maquina.id },
      );
    }
    return { success: true, data: mantenimiento };
  }

  private async cargarMantenimiento(id: string) {
    const m = await this.prisma.mantenimientoMaquinaria.findUnique({
      where: { id },
      include: { maquinaria: { include: this.includeMaquinaCtx } },
    });
    if (!m) throw new NotFoundException(`Mantenimiento ${id} no encontrado`);
    return m;
  }

  async asignarMantenimiento(dto: AsignarMantenimientoDto, actor: Actor) {
    const m = await this.cargarMantenimiento(dto.mantenimientoId);
    const maquina = m.maquinaria as unknown as MaquinaCtx;
    assertRegion(actor, this.regionDe(maquina));
    if (m.estado === 'FINALIZADO') throw new BadRequestException('El mantenimiento ya fue ejecutado.');

    const tecnicoId = dto.tecnicoId || actor.id;
    await this.validarResponsable(tecnicoId, this.regionDe(maquina));

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.mantenimientoMaquinaria.update({
        where: { id: m.id },
        data: { tecnicoId, estado: 'EN_PROCESO' },
        include: this.includeMantenimiento,
      });
      await this.registrarEvento(tx, maquina, 'MANTENIMIENTO_ASIGNADO', actor.id, m.id, {
        anterior: m.tecnicoId,
        nuevo: tecnicoId,
        autoAsignado: tecnicoId === actor.id,
      });
      return u;
    });

    if (tecnicoId !== actor.id) {
      void this.notifications.notificarUsuarios(
        [tecnicoId],
        `Mantenimiento asignado: ${maquina.codigo}`,
        `Programado para ${(m.fechaProgramada ?? m.fechaMantenimiento).toISOString().slice(0, 10)}`,
        { type: 'MANTENIMIENTO_ASIGNADO', mantenimientoId: m.id, maquinariaId: maquina.id },
        { tipo: 'MANTENIMIENTO_ASIGNADO', entidadTipo: 'MAQUINARIA', entidadId: maquina.id },
      );
    }
    return { success: true, data: updated };
  }

  async ejecutarMantenimiento(dto: EjecutarMantenimientoDto, actor: Actor, puedeSubirEvidencias = true) {
    const existing = await this.cargarMantenimiento(dto.mantenimientoId);
    const maquina = existing.maquinaria as unknown as MaquinaCtx;
    if (existing.estado === 'FINALIZADO') throw new BadRequestException('El mantenimiento ya fue ejecutado.');
    this.assertActiva(maquina);
    if (existing.tecnicoId !== actor.id && !esAdmin(actor)) {
      throw new ForbiddenException('Solo el técnico asignado puede ejecutar este mantenimiento.');
    }

    // Ventana de adelanto configurada en la máquina: fuera de ella no se puede registrar (sin excepciones).
    const ahora = new Date();
    const programada = existing.fechaProgramada ?? existing.fechaMantenimiento;
    const desde = addDays(startOfDay(programada), -maquina.ventanaAdelantoDias);
    if (ahora.getTime() < desde.getTime()) {
      throw new BadRequestException(
        `Aún no se puede registrar: está programado para ${programada.toISOString().slice(0, 10)} y la máquina permite ` +
          `adelantarlo ${maquina.ventanaAdelantoDias} día(s). Podrá hacerse desde el ${desde.toISOString().slice(0, 10)}.`,
      );
    }

    // Los roles habilitados deben adjuntar foto/video y PDF; el costo siempre es obligatorio.
    this.exigirPermisoParaEvidencias(dto.evidencias || [], puedeSubirEvidencias);
    const evidencias = await this.verificarEvidencias(maquina, dto.evidencias, {
      requiereMultimedia: puedeSubirEvidencias,
      requiereDocumento: puedeSubirEvidencias,
    });
    if (dto.costoTotal == null) {
      throw new BadRequestException('El costo del mantenimiento es obligatorio para ejecutarlo.');
    }

    // El calendario no se corre: si toca cada 30 días y se hizo antes, el siguiente sigue en su fecha.
    const frecuenciaDias = Number(existing.frecuenciaDias || 0);
    let siguiente: Date | null = null;
    if (frecuenciaDias > 0) {
      siguiente = addDays(programada, frecuenciaDias);
      while (siguiente.getTime() <= ahora.getTime()) siguiente = addDays(siguiente, frecuenciaDias);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.mantenimientoMaquinaria.update({
        where: { id: existing.id },
        data: {
          estado: 'FINALIZADO',
          observaciones: dto.observaciones || existing.observaciones,
          costoTotal: dto.costoTotal,
          fechaProgramada: programada,
          fechaEjecucion: ahora,
          fechaMantenimiento: ahora,
          ejecutadoPorId: actor.id,
          proximoMantenimiento: siguiente ?? existing.proximoMantenimiento ?? undefined,
          evidencias: {
            create: evidencias.map((e) => this.evidenciaData(e, 'MANTENIMIENTO', 'EJECUCION', actor.id)),
          },
        },
        include: this.includeMantenimiento,
      });

      if (siguiente) {
        const yaExiste = await tx.mantenimientoMaquinaria.count({
          where: { maquinariaId: existing.maquinariaId, estado: { not: 'FINALIZADO' }, fechaProgramada: siguiente },
        });
        if (!yaExiste) {
          await tx.mantenimientoMaquinaria.create({
            data: {
              maquinariaId: existing.maquinariaId,
              tecnicoId: existing.tecnicoId,
              creadoPorId: existing.creadoPorId,
              estado: 'PENDIENTE',
              observaciones: existing.observaciones,
              fechaMantenimiento: siguiente,
              fechaProgramada: siguiente,
              proximoMantenimiento: addDays(siguiente, frecuenciaDias),
              frecuenciaDias,
            },
          });
        }
      }

      await this.registrarEvento(tx, maquina, 'MANTENIMIENTO_EJECUTADO', actor.id, existing.id, {
        programadoPara: programada,
        ejecutadoEn: ahora,
        diasDeAdelanto: Math.max(0, Math.round((startOfDay(programada).getTime() - startOfDay(ahora).getTime()) / 86400000)),
        siguienteProgramado: siguiente,
        evidencias: this.resumenEvidencias(evidencias),
      });
      return u;
    });

    return { success: true, data: updated };
  }

  async editarMantenimiento(dto: EditarMantenimientoDto, actor: Actor) {
    const m = await this.cargarMantenimiento(dto.mantenimientoId);
    const maquina = m.maquinaria as unknown as MaquinaCtx;

    let campos = ['tipo', 'observaciones', 'repuestosUsados', 'costoTotal', 'frecuenciaDias', 'fechaProgramada'];
    if (esTecnico(actor)) {
      if (m.tecnicoId !== actor.id && m.ejecutadoPorId !== actor.id) {
        throw new ForbiddenException('Solo puedes editar mantenimientos que tienes asignados.');
      }
      // El costo ya lo ingresó al ejecutar; corregirlo después es solo de admin o coordinador de mantenimiento.
      campos = ['observaciones', 'repuestosUsados'];
    } else {
      assertRegion(actor, this.regionDe(maquina));
    }
    if (dto.fechaProgramada !== undefined && m.estado === 'FINALIZADO') {
      throw new BadRequestException('No se puede reprogramar un mantenimiento ya ejecutado.');
    }

    const { mantenimientoId: _id, ...propuesta } = dto;
    const propuestaNorm: Record<string, unknown> = { ...propuesta };
    if (dto.fechaProgramada !== undefined) {
      const f = new Date(dto.fechaProgramada);
      if (Number.isNaN(f.getTime())) throw new BadRequestException('Fecha programada inválida.');
      propuestaNorm.fechaProgramada = f;
    }
    const cambios = this.diff(m as unknown as Record<string, unknown>, propuestaNorm, campos);
    if (!Object.keys(cambios).length) {
      return { success: true, data: m, sinCambios: true };
    }
    const data: Record<string, unknown> = {};
    for (const campo of Object.keys(cambios)) data[campo] = propuestaNorm[campo];
    if (data.fechaProgramada) data.fechaMantenimiento = data.fechaProgramada;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.mantenimientoMaquinaria.update({
        where: { id: m.id },
        data: data as Prisma.MantenimientoMaquinariaUpdateInput,
        include: this.includeMantenimiento,
      });
      await this.registrarEvento(tx, maquina, 'MANTENIMIENTO_EDITADO', actor.id, m.id, { cambios });
      return u;
    });
    return { success: true, data: updated };
  }

  async listMantenimientos(dto: ListMantenimientosDto, actor: Actor) {
    const ahora = new Date();
    const filtros: Record<string, unknown>[] = [this.scopeMantenimientos(actor) as Record<string, unknown>];
    if (dto.maquinariaId) filtros.push({ maquinariaId: dto.maquinariaId });
    if (dto.tecnicoId) filtros.push({ tecnicoId: dto.tecnicoId });
    if (dto.agenciaId) filtros.push({ maquinaria: { agenciaId: dto.agenciaId } });
    if (dto.regionId) filtros.push({ maquinaria: { agencia: { regionId: dto.regionId } } });
    if (dto.clienteId) filtros.push({ maquinaria: { agencia: { clienteId: dto.clienteId } } });
    const rango = rangoFechas(dto.fechaDesde, dto.fechaHasta);
    if (rango) filtros.push({ fechaProgramada: rango });

    const pendientes = { estado: { in: ['PENDIENTE', 'EN_PROCESO'] } };
    const grupoVencidos = { ...pendientes, fechaProgramada: { lt: ahora } };
    const grupoPendientes = { ...pendientes, OR: [{ fechaProgramada: null }, { fechaProgramada: { gte: ahora } }] };
    const grupoEjecutados = { NOT: pendientes };

    const baseSinEstado = combinarWhere(...filtros, whereBusqueda(CAMPOS_BUSQUEDA_MANTENIMIENTOS, dto.search));
    const base = combinarWhere(
      baseSinEstado,
      dto.estado ? { estado: dto.estado } : undefined,
      dto.soloNoAtendidos ? grupoVencidos : undefined,
    );

    const { page, pageSize, skip, take } = this.pagina(dto);
    const contar = (where: Record<string, unknown>) => this.prisma.mantenimientoMaquinaria.count({ where: where as never });
    const buscar = (where: Record<string, unknown>, orderBy: unknown[], s: number, t: number) =>
      this.prisma.mantenimientoMaquinaria.findMany({
        where: where as never, orderBy: orderBy as never, skip: s, take: t, include: this.includeMantenimiento,
      });

    // Vencidos → pendientes → ejecutados. Dentro de cada grupo, lo más reciente primero (los sin fecha, al final).
    const porProgramacion = [{ fechaProgramada: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];
    const porEjecucion = [{ fechaEjecucion: { sort: 'desc', nulls: 'last' } }, { fechaMantenimiento: 'desc' }, { id: 'desc' }];

    let items: Awaited<ReturnType<typeof buscar>>;
    let total: number;
    if (dto.sortField && Object.prototype.hasOwnProperty.call(ORDEN_MANTENIMIENTOS, dto.sortField)) {
      const orden = resolverOrden(dto.sortField, dto.sortOrder, ORDEN_MANTENIMIENTOS, { campo: 'fecha', dir: 'desc' });
      [items, total] = await Promise.all([buscar(base, orden, skip, take), contar(base)]);
    } else {
      const r = await paginarPorGrupos(
        [
          { where: combinarWhere(base, grupoVencidos), orderBy: porProgramacion },
          { where: combinarWhere(base, grupoPendientes), orderBy: porProgramacion },
          { where: combinarWhere(base, grupoEjecutados), orderBy: porEjecucion },
        ],
        skip, take, contar, buscar,
      );
      items = r.items;
      total = r.total;
    }

    const extra: Record<string, unknown> = {};
    if (dto.incluirResumen) {
      const [vencidos, pendientesN, ejecutados] = await Promise.all([
        contar(combinarWhere(baseSinEstado, grupoVencidos)),
        contar(combinarWhere(baseSinEstado, grupoPendientes)),
        contar(combinarWhere(baseSinEstado, grupoEjecutados)),
      ]);
      extra['resumen'] = { vencidos, pendientes: pendientesN, ejecutados, total: vencidos + pendientesN + ejecutados };
    }

    return this.respuestaPagina(
      items.map((m) => ({ ...m, noAtendido: this.mantenimientoNoAtendido(m, ahora) })),
      total, page, pageSize, extra,
    );
  }

  // ==============================================================
  // EVIDENCIAS ADICIONALES (se agregan o se reemplazan; nunca se borran)
  // ==============================================================

  async agregarEvidencia(dto: AgregarEvidenciaDto, actor: Actor) {
    let maquina: MaquinaCtx;
    let etapa: string;
    let entidadId: string;

    if (dto.entidad === 'INCIDENTE') {
      const inc = await this.cargarIncidente(dto.entidadId);
      maquina = inc.maquinaria as unknown as MaquinaCtx;
      entidadId = inc.id;
      etapa = dto.etapa || 'REPARACION';
      const esReportante = etapa === 'REPORTE' && inc.reportadoPorId === actor.id;
      const esReparador = etapa === 'REPARACION' && inc.tecnicoAsignadoId === actor.id;
      if (!esReportante && !esReparador) {
        if (esAdmin(actor) || esCoordMantenimiento(actor)) assertRegion(actor, this.regionDe(maquina));
        else throw new ForbiddenException('No puedes agregar evidencia a esta incidencia.');
      }
    } else {
      const m = await this.cargarMantenimiento(dto.entidadId);
      maquina = m.maquinaria as unknown as MaquinaCtx;
      entidadId = m.id;
      etapa = 'EJECUCION';
      if (m.tecnicoId !== actor.id) {
        if (esAdmin(actor) || esCoordMantenimiento(actor)) assertRegion(actor, this.regionDe(maquina));
        else throw new ForbiddenException('No puedes agregar evidencia a este mantenimiento.');
      }
    }

    const evidencias = await this.verificarEvidencias(maquina, dto.evidencias, {});
    if (!evidencias.length) throw new BadRequestException('No se recibió ninguna evidencia.');
    if (dto.reemplazaEvidenciaId && evidencias.length !== 1) {
      throw new BadRequestException('Para reemplazar una evidencia envía exactamente un archivo nuevo.');
    }

    const contexto = dto.entidad === 'INCIDENTE' ? 'INCIDENTE' : 'MANTENIMIENTO';
    const creadas = await this.prisma.$transaction(async (tx) => {
      const nuevas = [];
      for (const e of evidencias) {
        const data = this.evidenciaData(e, contexto, etapa, actor.id);
        if (dto.entidad === 'INCIDENTE') {
          nuevas.push(await tx.evidenciaIncidente.create({ data: { ...data, incidenteId: entidadId } }));
        } else {
          nuevas.push(await tx.evidenciaMantenimiento.create({ data: { ...data, mantenimientoId: entidadId } }));
        }
      }

      if (dto.reemplazaEvidenciaId) {
        const nueva = nuevas[0];
        const oculta = dto.entidad === 'INCIDENTE'
          ? await tx.evidenciaIncidente.updateMany({
              where: { id: dto.reemplazaEvidenciaId, incidenteId: entidadId, activa: true },
              data: { activa: false, reemplazadaPorId: nueva.id },
            })
          : await tx.evidenciaMantenimiento.updateMany({
              where: { id: dto.reemplazaEvidenciaId, mantenimientoId: entidadId, activa: true },
              data: { activa: false, reemplazadaPorId: nueva.id },
            });
        if (!oculta.count) throw new BadRequestException('La evidencia a reemplazar no existe o ya fue reemplazada.');
      }

      await this.registrarEvento(tx, maquina, 'EVIDENCIA_AGREGADA', actor.id, entidadId, {
        entidad: dto.entidad,
        etapa,
        reemplaza: dto.reemplazaEvidenciaId ?? null,
        evidencias: this.resumenEvidencias(evidencias),
      });
      return nuevas;
    });

    return { success: true, data: creadas };
  }

  // ==============================================================
  // LIMPIEZA (2x/semana para la maquinaria de agencia, diaria para la asignada a un pulidor)
  // ==============================================================

  /**
   * Regla vigente de una máquina, según a quién está asignada hoy (no según su tipo): con pulidor
   * asignado, diaria; si no, con agencia, 2x/semana (miércoles y sábado); sin ninguna de las dos
   * (p. ej. en un taller), no aplica ninguna regla.
   */
  private reglaLimpieza(m: Pick<MaquinaCtx, 'agenciaId' | 'operadorAsignadoId'>): 'AGENCIA' | 'PULIDOR' | null {
    return reglaLimpiezaUtil(m);
  }

  /** `true` si la última limpieza registrada es anterior al último día que tocaba cumplir la regla. */
  private limpiezaAtrasada(regla: 'AGENCIA' | 'PULIDOR' | null, ultimaFecha: Date | null, ahora: Date): boolean {
    return limpiezaAtrasadaUtil(regla, ultimaFecha, ahora);
  }

  /**
   * Quién puede registrar la limpieza de esta máquina hoy: únicamente el líder de su agencia o el
   * pulidor (fijo o móvil) asignado — quien de verdad la limpia. Ni admin ni super admin registran
   * limpiezas: solo auditan (con `limpiezas.ver`/`limpiezas.editar`) lo que estos registraron.
   */
  private assertPuedeLimpiar(actor: Actor, m: Pick<MaquinaCtx, 'agenciaId' | 'operadorAsignadoId'>, regla: 'AGENCIA' | 'PULIDOR' | null): void {
    if (regla === 'PULIDOR' && esOperador(actor) && actor.id === m.operadorAsignadoId) return;
    if (regla === 'AGENCIA' && esLider(actor) && actor.agenciaId === m.agenciaId) return;
    throw new ForbiddenException('No puedes registrar la limpieza de esta máquina.');
  }

  /**
   * Registra que se limpió la máquina en una fecha (hoy, si no se indica otra). Una fila por máquina
   * y día: si ya había una de ese día, las fotos nuevas se agregan a las que ya estaban (no las pisa).
   */
  async registrarLimpieza(dto: RegistrarLimpiezaDto, actor: Actor) {
    const maquina = await this.cargarMaquina(dto.maquinariaId);
    this.assertActiva(maquina);

    const regla = this.reglaLimpieza(maquina);
    if (!regla) {
      throw new BadRequestException('Esta máquina no tiene agencia ni pulidor asignado: no le aplica una regla de limpieza.');
    }
    this.assertPuedeLimpiar(actor, maquina, regla);

    let fecha = startOfDay(new Date());
    if (dto.fecha) {
      const parsed = new Date(`${dto.fecha}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Fecha inválida (usa AAAA-MM-DD).');
      fecha = parsed;
    }

    const fotos = await this.verificarEvidencias(maquina, dto.fotos, { requiereMultimedia: true });
    const urls = fotos.map((f) => f.url);

    const existente = await this.prisma.limpiezaMaquinaria.findUnique({
      where: { maquinariaId_fecha: { maquinariaId: maquina.id, fecha } },
    });

    const registro = await this.prisma.$transaction(async (tx) => {
      const data = existente
        ? await tx.limpiezaMaquinaria.update({
            where: { id: existente.id },
            data: {
              fotos: [...existente.fotos, ...urls],
              observaciones: dto.observaciones?.trim() || existente.observaciones,
            },
          })
        : await tx.limpiezaMaquinaria.create({
            data: {
              maquinariaId: maquina.id,
              fecha,
              tipo: regla,
              fotos: urls,
              observaciones: dto.observaciones?.trim() || null,
              registradoPorId: actor.id,
            },
          });
      await this.registrarEvento(tx, maquina, 'LIMPIEZA_REGISTRADA', actor.id, data.id, {
        tipo: regla,
        fecha: fecha.toISOString(),
        fotosAgregadas: urls.length,
        fotosTotal: data.fotos.length,
      });
      return data;
    });

    return { success: true, data: registro };
  }

  /** Historial de limpiezas de una máquina (o de todas dentro del alcance del actor), más reciente primero. */
  async listLimpiezas(dto: ListLimpiezasDto, actor: Actor) {
    const where: Prisma.LimpiezaMaquinariaWhereInput = {
      maquinaria: this.scopeMaquinaria(actor),
      ...(dto.maquinariaId ? { maquinariaId: dto.maquinariaId } : {}),
    };
    const { page, pageSize, skip, take } = this.pagina(dto);
    const [items, total] = await Promise.all([
      this.prisma.limpiezaMaquinaria.findMany({
        where,
        orderBy: { fecha: 'desc' },
        skip,
        take,
        include: {
          maquinaria: { select: { id: true, codigo: true, nombre: true } },
          registradoPor: { select: { id: true, name: true, lastname: true } },
        },
      }),
      this.prisma.limpiezaMaquinaria.count({ where }),
    ]);
    return this.respuestaPagina(items, total, page, pageSize);
  }

  private async cargarLimpieza(id: string) {
    const l = await this.prisma.limpiezaMaquinaria.findUnique({
      where: { id },
      include: {
        maquinaria: { include: this.includeMaquinaCtx },
        registradoPor: { select: { id: true, name: true, lastname: true } },
      },
    });
    if (!l) throw new NotFoundException(`Registro de limpieza ${id} no encontrado`);
    return l;
  }

  /**
   * Corrige las observaciones de un registro ya creado (fotos, fecha y tipo no se pueden editar).
   * Solo dentro del alcance de quien edita: admin/super admin, cualquiera; supervisor y coordinador
   * de mantenimiento, solo los de su región.
   */
  async editarLimpieza(dto: EditarLimpiezaDto, actor: Actor) {
    const limpieza = await this.cargarLimpieza(dto.limpiezaId);
    const maquina = limpieza.maquinaria as unknown as MaquinaCtx;
    assertRegion(actor, this.regionDe(maquina));

    if (dto.observaciones === undefined) {
      return { success: true, data: limpieza, sinCambios: true };
    }
    const nuevas = dto.observaciones.trim() || null;
    if (nuevas === limpieza.observaciones) {
      return { success: true, data: limpieza, sinCambios: true };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.limpiezaMaquinaria.update({
        where: { id: limpieza.id },
        data: { observaciones: nuevas },
        include: {
          maquinaria: { select: { id: true, codigo: true, nombre: true } },
          registradoPor: { select: { id: true, name: true, lastname: true } },
        },
      });
      await this.registrarEvento(tx, maquina, 'LIMPIEZA_EDITADA', actor.id, limpieza.id, {
        cambios: { observaciones: { antes: limpieza.observaciones, despues: nuevas } },
      });
      return u;
    });
    return { success: true, data: updated };
  }

  /**
   * Elimina un registro de limpieza (queda el evento en la línea de tiempo de la máquina, con una
   * instantánea de lo que tenía). Mismo alcance que editarLimpieza.
   */
  async eliminarLimpieza(dto: EliminarLimpiezaDto, actor: Actor) {
    const limpieza = await this.cargarLimpieza(dto.limpiezaId);
    const maquina = limpieza.maquinaria as unknown as MaquinaCtx;
    assertRegion(actor, this.regionDe(maquina));

    await this.prisma.$transaction(async (tx) => {
      await this.registrarEvento(tx, maquina, 'LIMPIEZA_ELIMINADA', actor.id, limpieza.id, {
        fecha: limpieza.fecha.toISOString(),
        tipo: limpieza.tipo,
        fotos: limpieza.fotos.length,
        observaciones: limpieza.observaciones,
        motivo: dto.motivo?.trim() || null,
      });
      await tx.limpiezaMaquinaria.delete({ where: { id: limpieza.id } });
    });
    return { success: true };
  }

  /** Historial completo (hasta 5000 filas) dentro del alcance del actor, para exportar a CSV desde el cliente. */
  async exportarLimpiezas(dto: ExportarLimpiezasDto, actor: Actor) {
    const where: Prisma.LimpiezaMaquinariaWhereInput = {
      maquinaria: this.scopeMaquinaria(actor),
      ...(dto.maquinariaId ? { maquinariaId: dto.maquinariaId } : {}),
    };
    const items = await this.prisma.limpiezaMaquinaria.findMany({
      where,
      orderBy: { fecha: 'desc' },
      take: 5000,
      include: {
        maquinaria: { select: { id: true, codigo: true, nombre: true } },
        registradoPor: { select: { id: true, name: true, lastname: true } },
      },
    });
    return { success: true, data: items };
  }

  /** Cuántas máquinas dentro del alcance del actor están atrasadas de limpieza (para el badge de alerta). */
  async resumenLimpiezas(actor: Actor) {
    if (!this.cache) return this.calcularResumenLimpiezas(actor);
    return this.cache.obtenerOCalcular(`maquinaria:limpiezas-resumen:${actor?.id ?? 'anonimo'}`, 45, () => this.calcularResumenLimpiezas(actor));
  }

  private async calcularResumenLimpiezas(actor: Actor) {
    const candidatas = await this.prisma.maquinaria.findMany({
      where: {
        ...this.scopeMaquinaria(actor),
        activa: true,
        OR: [{ agenciaId: { not: null } }, { operadorAsignadoId: { not: null } }],
      },
      select: { id: true, agenciaId: true, operadorAsignadoId: true },
    });
    if (!candidatas.length) return { success: true, pendientes: 0 };

    const pendientes = await this.conteosPendientes(candidatas.map((m) => m.id));
    const ahora = new Date();
    const atrasadas = candidatas.filter((m) =>
      this.limpiezaAtrasada(this.reglaLimpieza(m), pendientes.ultimaLimpieza.get(m.id) ?? null, ahora),
    ).length;
    return { success: true, pendientes: atrasadas };
  }

  // ==============================================================
  // MOVIMIENTOS (agencias, bahías y talleres)
  // ==============================================================

  async transferirMaquinaria(dto: TransferirMaquinariaDto, actor: Actor) {
    const maquina = await this.cargarMaquina(dto.maquinariaId);
    assertRegion(actor, this.regionDe(maquina));
    this.assertActiva(maquina);

    const destino = await this.prisma.agencia.findUnique({
      where: { id: dto.destinoAgenciaId },
      select: { id: true, nombre: true, tipoUbicacion: true, regionId: true },
    });
    if (!destino) throw new NotFoundException('Agencia o taller destino no encontrado');

    // Cambiar de región es exclusivo de admin/super admin; el coordinador y el técnico
    // solo mueven la máquina entre agencias o talleres de su propia región.
    if (!esAdmin(actor) && destino.regionId !== actor.regionId) {
      throw new ForbiddenException('No puedes mover esta máquina fuera de tu región.');
    }

    let destinoBahia: { id: string; nombre: string } | null = null;
    if (dto.destinoBahiaId) {
      const bahia = await this.prisma.bahia.findUnique({ where: { id: dto.destinoBahiaId } });
      if (!bahia || bahia.agenciaId !== dto.destinoAgenciaId) {
        throw new BadRequestException('La bahía no pertenece al destino indicado.');
      }
      destinoBahia = { id: bahia.id, nombre: bahia.nombre };
    }

    const destinoBahiaId = dto.destinoBahiaId || null;
    if (maquina.agenciaId === dto.destinoAgenciaId && maquina.bahiaId === destinoBahiaId) {
      throw new BadRequestException('La máquina ya está en esa ubicación.');
    }

    const origenBahia = maquina.bahiaId
      ? await this.prisma.bahia.findUnique({ where: { id: maquina.bahiaId }, select: { id: true, nombre: true } })
      : null;

    const resultado = await this.prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoMaquinaria.create({
        data: {
          maquinariaId: maquina.id,
          origenAgenciaId: maquina.agenciaId,
          destinoAgenciaId: dto.destinoAgenciaId,
          origenBahiaId: maquina.bahiaId,
          destinoBahiaId,
          motivo: dto.motivo,
          usuarioId: actor.id,
        },
      });
      const cambiaSedeOTaller = dto.destinoAgenciaId !== maquina.agenciaId || destino.tipoUbicacion !== 'AGENCIA';
      const updated = await tx.maquinaria.update({
        where: { id: maquina.id },
        data: {
          agenciaId: dto.destinoAgenciaId,
          bahiaId: destinoBahiaId,
          ...(cambiaSedeOTaller ? { operadorAsignadoId: null } : {}),
        },
        include: {
          agencia: { select: { id: true, nombre: true, tipoUbicacion: true, regionId: true } },
          bahia: { select: { id: true, nombre: true } },
        },
      });
      // El evento queda en la región/agencia de origen; el destino va en los datos.
      await this.registrarEvento(tx, maquina, 'MOVIMIENTO', actor.id, movimiento.id, {
        motivo: dto.motivo,
        origen: { agenciaId: maquina.agenciaId, agencia: maquina.agencia?.nombre ?? null, bahiaId: maquina.bahiaId, bahia: origenBahia?.nombre ?? null },
        destino: {
          agenciaId: destino.id,
          agencia: destino.nombre,
          tipoUbicacion: destino.tipoUbicacion,
          regionId: destino.regionId,
          bahiaId: destinoBahia?.id ?? null,
          bahia: destinoBahia?.nombre ?? null,
        },
      });
      return { maquinaria: updated, movimiento };
    });

    return { success: true, data: resultado };
  }

  async listMovimientos(dto: ListMovimientosMaquinariaDto, actor: Actor) {
    const where: Prisma.MovimientoMaquinariaWhereInput = {
      ...(dto.maquinariaId ? { maquinariaId: dto.maquinariaId } : {}),
      ...(esAdmin(actor) ? {} : { maquinaria: { agencia: { regionId: actor.regionId ?? SIN_REGION } } }),
    };
    const { page, pageSize, skip } = this.pagina(dto);

    const [total, items] = await Promise.all([
      this.prisma.movimientoMaquinaria.count({ where }),
      this.prisma.movimientoMaquinaria.findMany({
        where,
        include: {
          maquinaria: { select: { id: true, codigo: true, nombre: true } },
          origenAgencia: { select: { id: true, nombre: true, tipoUbicacion: true } },
          destinoAgencia: { select: { id: true, nombre: true, tipoUbicacion: true } },
          usuario: { select: { id: true, name: true, lastname: true } },
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    // Las bahías del movimiento no tienen relación en el esquema: se resuelven los nombres aquí.
    const bahiaIds = [...new Set(items.flatMap((i) => [i.origenBahiaId, i.destinoBahiaId]).filter((x): x is string => !!x))];
    const bahias = bahiaIds.length
      ? await this.prisma.bahia.findMany({ where: { id: { in: bahiaIds } }, select: { id: true, nombre: true, codigo: true } })
      : [];
    const porId = new Map(bahias.map((b) => [b.id, b]));
    const data = items.map((i) => ({
      ...i,
      origenBahia: i.origenBahiaId ? porId.get(i.origenBahiaId) ?? null : null,
      destinoBahia: i.destinoBahiaId ? porId.get(i.destinoBahiaId) ?? null : null,
    }));

    return this.respuestaPagina(data, total, page, pageSize);
  }

  async listTalleres(actor: Actor) {
    const items = await this.prisma.agencia.findMany({
      where: {
        tipoUbicacion: { in: ['TALLER_NACIONAL', 'TALLER_REGIONAL'] },
        estado: 1,
        ...(esAdmin(actor) ? {} : { regionId: actor.regionId ?? SIN_REGION }),
      },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        tipoUbicacion: true,
        region: true,
        regionId: true,
      },
      orderBy: [{ tipoUbicacion: 'asc' }, { nombre: 'asc' }],
    });
    return { success: true, data: items };
  }

  // ==============================================================
  // LÍNEA DE TIEMPO (trazabilidad completa de una máquina)
  // ==============================================================

  async historial(dto: HistorialMaquinariaDto, actor: Actor) {
    const m = await this.cargarMaquina(dto.maquinariaId);
    assertRegion(actor, this.regionDe(m));

    const where: Prisma.MaquinariaEventoWhereInput = { maquinariaId: m.id };
    if (dto.tipos?.length) where.tipo = { in: dto.tipos };
    if (dto.actorId) where.actorId = dto.actorId;
    if (dto.desde || dto.hasta) {
      const desde = dto.desde ? new Date(dto.desde) : undefined;
      const hasta = dto.hasta ? new Date(dto.hasta) : undefined;
      if ((desde && Number.isNaN(desde.getTime())) || (hasta && Number.isNaN(hasta.getTime()))) {
        throw new BadRequestException('Rango de fechas inválido.');
      }
      where.ocurridoEn = { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) };
    }

    const { page, pageSize, skip } = this.pagina(dto);
    const [total, eventos] = await Promise.all([
      this.prisma.maquinariaEvento.count({ where }),
      this.prisma.maquinariaEvento.findMany({
        where,
        include: { actor: { select: { id: true, name: true, lastname: true, role: { select: { namerol: true } } } } },
        orderBy: { ocurridoEn: 'desc' },
        skip,
        take: pageSize,
      }),
    ]);

    const data = eventos.map((e) => ({
      id: e.id,
      tipo: e.tipo,
      ocurridoEn: e.ocurridoEn,
      entidadId: e.entidadId,
      agenciaId: e.agenciaId,
      regionId: e.regionId,
      datos: e.datos,
      actor: e.actor
        ? { id: e.actor.id, nombre: this.shortName(e.actor), rol: e.actor.role?.namerol ?? null }
        : null,
    }));

    return this.respuestaPagina(data, total, page, pageSize, {
      maquinaria: { id: m.id, codigo: m.codigo, nombre: m.nombre },
    });
  }
}
