import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { FUNCION, tieneFuncion } from '../../common/permisos/funciones.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import type { AdjuntoTareaDto, CancelarTareaDto, CompletarTareaDto, CrearTareaDto, ListarTareasDto, ReasignarTareaDto, RevisarTareaDto } from './dto/rrhh.dto.js';
import { MAX_ADJUNTOS, MAX_BYTES_ADJUNTO, NUMERO_TAREA, personaEnAlcance, tareaVencida, whereUsuariosEnAlcance } from './rrhh.reglas.js';

const AMBITO_PERSONA = { agenciaId: true, regionId: true, agencia: { select: { nombre: true, regionId: true } }, bodega: { select: { regionId: true } } } as const;

const INCLUIR_TAREA = {
  asignadoA: { select: { id: true, name: true, lastname: true, estado: true, ...AMBITO_PERSONA } },
  asignadoPor: { select: { id: true, name: true, lastname: true } },
  adjuntos: { orderBy: { createdAt: 'asc' } },
  historial: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TareaRrhhInclude;

type TareaCompleta = Prisma.TareaRrhhGetPayload<{ include: typeof INCLUIR_TAREA }>;

const nombreDe = (u: { name: string; lastname: string } | null | undefined) => (u ? `${u.name} ${u.lastname}`.trim() : '');

export interface DatosTareaDeInforme {
  informeId: string;
  novedadId: string;
  titulo: string;
  descripcion: string;
  asignadoAId: string;
}

/**
 * Tareas del personal. Toda tarea tiene un solo responsable (obligatorio), salvo las que nacen de una novedad de informe, donde
 * crearla es opcional. Estados: Pendiente → Completada → Revisada, más Cancelada. Asignan quienes tienen `rrhh.tareas.asignar` y
 * solo a personas dentro de su alcance; la revisa quien la asignó (o un administrador).
 */
@Injectable()
export class TareasService {
  private readonly logger = new Logger(TareasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────────────────── Reglas de acceso ─────────────────────────

  private esAdmin = (user: any) => tieneFuncion(user, FUNCION.ADMINISTRADOR);

  /** Puede ver la tarea: el responsable, quien la asignó, un administrador, o quien asigna tareas y la persona está en su alcance. */
  private puedeVer(user: any, t: TareaCompleta): boolean {
    const yo = String(user.id);
    if (t.asignadoAId === yo || t.asignadoPorId === yo || this.esAdmin(user)) return true;
    return tienePermiso(user, 'rrhh.tareas.asignar') && personaEnAlcance(resolverAlcance(user), t.asignadoA);
  }

  /** Revisa, cancela o reasigna: quien asignó la tarea o un administrador. */
  private puedeGestionar(user: any, t: TareaCompleta): boolean {
    return t.asignadoPorId === String(user.id) || this.esAdmin(user);
  }

  /** Valida a quién se asigna: activo, puede recibir tareas, está en el alcance de quien asigna y no es la misma persona. */
  async validarResponsable(user: any, asignadoAId: string) {
    if (asignadoAId === String(user.id)) throw new BadRequestException('No puedes asignarte una tarea a ti mismo.');
    const persona = await this.prisma.user.findUnique({
      where: { id: asignadoAId },
      select: { id: true, estado: true, name: true, lastname: true, role: { select: { capacidades: true } }, ...AMBITO_PERSONA },
    });
    if (!persona || persona.estado !== 1) throw new BadRequestException('La persona elegida no existe o está inactiva.');
    if (!persona.role?.capacidades?.includes('rrhh.tareas.propias')) throw new BadRequestException('Esa persona no recibe tareas de RRHH.');
    if (!personaEnAlcance(resolverAlcance(user), persona)) throw new ForbiddenException('Esa persona está fuera de tu alcance.');
    return persona;
  }

  // ───────────────────────── Adjuntos ─────────────────────────

  private async prepararAdjuntos(adjuntos: AdjuntoTareaDto[] | undefined, userId: string, etapa: 'ASIGNACION' | 'RESPUESTA') {
    const lista = adjuntos ?? [];
    if (lista.length > MAX_ADJUNTOS) throw new BadRequestException(`Máximo ${MAX_ADJUNTOS} archivos por tarea.`);
    const claves = new Set<string>();
    const resultado: Prisma.TareaAdjuntoCreateWithoutTareaInput[] = [];
    for (const a of lista) {
      const ins = await this.storage.inspectEvidence(a.url, { prefix: `rrhh/tareas/${userId}/`, sinLimiteDuracion: true });
      if (ins.sizeBytes > MAX_BYTES_ADJUNTO) throw new BadRequestException(`«${a.nombre}» pesa más de ${MAX_BYTES_ADJUNTO / 1024 / 1024} MB.`);
      if (claves.has(ins.key)) continue;
      claves.add(ins.key);
      resultado.push({ etapa, key: ins.key, nombre: a.nombre, mime: ins.mimeType, tamanioBytes: ins.sizeBytes, tipo: ins.kind, subidoPorId: userId });
    }
    return resultado;
  }

  // ───────────────────────── Presentación ─────────────────────────

  private async presentar(tareas: TareaCompleta[]) {
    const ahora = new Date();
    const informeIds = [...new Set(tareas.map((t) => t.informeId).filter(Boolean))] as string[];
    const actorIds = [...new Set(tareas.flatMap((t) => t.historial.map((h) => h.actorId)))];
    const [informes, actores] = await Promise.all([
      informeIds.length ? this.prisma.informeInspeccion.findMany({ where: { id: { in: informeIds } }, select: { id: true, numero: true } }) : [],
      actorIds.length ? this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, lastname: true } }) : [],
    ]);
    const numeroInforme = new Map(informes.map((i) => [i.id, i.numero]));
    const nombreActor = new Map(actores.map((a) => [a.id, nombreDe(a)]));
    return tareas.map((t) => ({
      id: t.id,
      numero: NUMERO_TAREA(t.numero),
      titulo: t.titulo,
      descripcion: t.descripcion,
      fechaLimite: t.fechaLimite,
      estado: t.estado,
      vencida: tareaVencida(t, ahora),
      asignadoA: { id: t.asignadoA.id, nombre: nombreDe(t.asignadoA), agencia: t.asignadoA.agencia?.nombre ?? null, activo: t.asignadoA.estado === 1 },
      asignadoPor: { id: t.asignadoPor.id, nombre: nombreDe(t.asignadoPor) },
      respuesta: t.respuesta,
      creadaEn: t.createdAt,
      completadaEn: t.completadaEn,
      revisadaEn: t.revisadaEn,
      canceladaEn: t.canceladaEn,
      motivoCancelacion: t.motivoCancelacion,
      origen: t.informeId ? { informeId: t.informeId, numero: numeroInforme.get(t.informeId) ?? null } : null,
      adjuntos: t.adjuntos.map((a) => ({ id: a.id, etapa: a.etapa, key: a.key, nombre: a.nombre, mime: a.mime, tamanioBytes: a.tamanioBytes, tipo: a.tipo })),
      historial: t.historial.map((h) => ({ id: h.id, accion: h.accion, actor: nombreActor.get(h.actorId) ?? '', detalle: h.detalle, fecha: h.createdAt })),
    }));
  }

  private async cargar(id: string): Promise<TareaCompleta> {
    const t = await this.prisma.tareaRrhh.findUnique({ where: { id }, include: INCLUIR_TAREA });
    if (!t) throw new NotFoundException('La tarea no existe.');
    return t;
  }

  private async presentarUna(id: string) {
    return (await this.presentar([await this.cargar(id)]))[0];
  }

  private avisar(userIds: string[], titulo: string, mensaje: string, tarea: { id: string; numero: number }, tipo: TipoNotificacion) {
    return this.notifications.notificarUsuarios(userIds, titulo, mensaje, { tareaId: tarea.id, numero: NUMERO_TAREA(tarea.numero) }, { tipo, entidadTipo: 'TAREA_RRHH', entidadId: tarea.id });
  }

  // ───────────────────────── Consultas ─────────────────────────

  private filtros(dto: ListarTareasDto): Prisma.TareaRrhhWhereInput {
    const ahora = new Date();
    return {
      ...(dto.estado ? { estado: dto.estado } : {}),
      ...(dto.soloVencidas ? { estado: 'PENDIENTE', fechaLimite: { lt: ahora } } : {}),
      ...(dto.asignadoAId ? { asignadoAId: dto.asignadoAId } : {}),
    };
  }

  /** Mis tareas: las que me asignaron. */
  async mias(dto: ListarTareasDto, user: any) {
    const tareas = await this.prisma.tareaRrhh.findMany({
      where: { ...this.filtros(dto), asignadoAId: String(user.id) },
      include: INCLUIR_TAREA,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return this.presentar(tareas);
  }

  /** Tareas que asigné yo y las de las personas de mi alcance (un administrador, todas). */
  async asignadas(dto: ListarTareasDto, user: any) {
    const alcance = resolverAlcance(user);
    const donde: Prisma.TareaRrhhWhereInput = this.esAdmin(user)
      ? {}
      : { OR: [{ asignadoPorId: String(user.id) }, { asignadoA: whereUsuariosEnAlcance(alcance) as Prisma.UserWhereInput }] };
    const tareas = await this.prisma.tareaRrhh.findMany({
      where: { AND: [donde, this.filtros(dto)] },
      include: INCLUIR_TAREA,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return this.presentar(tareas);
  }

  async detalle(id: string, user: any) {
    const t = await this.cargar(id);
    if (!this.puedeVer(user, t)) throw new ForbiddenException('No tienes acceso a esta tarea.');
    return (await this.presentar([t]))[0];
  }

  /** Personas a las que puedo asignar una tarea: activas, que reciben tareas, dentro de mi alcance y distintas de mí. */
  async asignables(user: any) {
    const alcance = resolverAlcance(user);
    const personas = await this.prisma.user.findMany({
      where: {
        AND: [whereUsuariosEnAlcance(alcance) as Prisma.UserWhereInput, { estado: 1, id: { not: String(user.id) }, role: { capacidades: { has: 'rrhh.tareas.propias' } } }],
      },
      select: { id: true, name: true, lastname: true, role: { select: { namerol: true } }, agencia: { select: { nombre: true } } },
      orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
      take: 1000,
    });
    return personas.map((p) => ({ id: p.id, nombre: nombreDe(p), rol: p.role?.namerol ?? '', agencia: p.agencia?.nombre ?? null }));
  }

  /** Tareas Pendientes cuyo responsable ya no está activo: alguien debe reasignarlas. */
  async sinResponsableActivo(user: any) {
    const alcance = resolverAlcance(user);
    const tareas = await this.prisma.tareaRrhh.findMany({
      where: { estado: 'PENDIENTE', asignadoA: { AND: [whereUsuariosEnAlcance(alcance) as Prisma.UserWhereInput, { estado: 0 }] } },
      include: INCLUIR_TAREA,
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return this.presentar(tareas);
  }

  // ───────────────────────── Acciones ─────────────────────────

  async crear(dto: CrearTareaDto, user: any) {
    const titulo = dto.titulo.trim();
    if (!titulo) throw new BadRequestException('El título es obligatorio.');
    const fechaLimite = dto.fechaLimite ? new Date(dto.fechaLimite) : null;
    if (fechaLimite && Number.isNaN(fechaLimite.getTime())) throw new BadRequestException('La fecha límite no es válida.');
    const persona = await this.validarResponsable(user, dto.asignadoAId);
    const adjuntos = await this.prepararAdjuntos(dto.adjuntos, String(user.id), 'ASIGNACION');

    const tarea = await this.prisma.tareaRrhh.create({
      data: {
        titulo,
        descripcion: dto.descripcion?.trim() ?? '',
        fechaLimite,
        asignadoAId: persona.id,
        asignadoPorId: String(user.id),
        agenciaId: persona.agenciaId ?? null,
        regionId: persona.regionId ?? persona.agencia?.regionId ?? persona.bodega?.regionId ?? null,
        adjuntos: { create: adjuntos },
        historial: { create: { accion: 'ASIGNADA', actorId: String(user.id), detalle: null } },
      },
    });
    await this.avisar([persona.id], 'Nueva tarea asignada', `${nombreDe(user)} te asignó «${titulo}».`, tarea, 'TAREA_ASIGNADA');
    return this.presentarUna(tarea.id);
  }

  /**
   * Tarea que nace de una novedad de informe. La llama el servicio de informes al guardar el informe. Idempotente por novedad:
   * guardar dos veces no duplica la tarea. El responsable debe estar en el alcance de quien guarda el informe.
   */
  async crearDesdeNovedad(datos: DatosTareaDeInforme, user: any, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const existente = await db.tareaRrhh.findUnique({ where: { novedadId: datos.novedadId }, select: { id: true } });
    if (existente) return existente;
    const persona = await this.validarResponsable(user, datos.asignadoAId);
    const tarea = await db.tareaRrhh.create({
      data: {
        titulo: (datos.titulo || datos.descripcion).trim().slice(0, 150) || 'Tarea de informe',
        descripcion: (datos.descripcion || datos.titulo).trim().slice(0, 2000),
        asignadoAId: persona.id,
        asignadoPorId: String(user.id),
        agenciaId: persona.agenciaId ?? null,
        regionId: persona.regionId ?? persona.agencia?.regionId ?? persona.bodega?.regionId ?? null,
        informeId: datos.informeId,
        novedadId: datos.novedadId,
        historial: { create: { accion: 'ASIGNADA', actorId: String(user.id), detalle: 'Desde un informe de inspección' } },
      },
    });
    return tarea;
  }

  /** Avisos de las tareas que nacieron de un informe: uno por tarea y uno del informe por responsable. */
  async avisarTareasDeInforme(tareaIds: string[], informe: { id: string; numero: string }, user: any) {
    if (!tareaIds.length) return;
    const tareas = await this.prisma.tareaRrhh.findMany({ where: { id: { in: tareaIds } }, select: { id: true, numero: true, titulo: true, asignadoAId: true } });
    for (const t of tareas) {
      await this.notifications.notificarUsuarios(
        [t.asignadoAId],
        'Nueva tarea desde un informe',
        `${nombreDe(user)} te asignó «${t.titulo}» desde el informe ${informe.numero}.`,
        { tareaId: t.id, numero: NUMERO_TAREA(t.numero), informeId: informe.id },
        { tipo: 'TAREA_ASIGNADA', entidadTipo: 'TAREA_RRHH', entidadId: t.id },
      );
    }
  }

  async completar(dto: CompletarTareaDto, user: any) {
    const t = await this.cargar(dto.id);
    if (t.asignadoAId !== String(user.id)) throw new ForbiddenException('Solo el responsable puede completar la tarea.');
    if (t.estado !== 'PENDIENTE') throw new BadRequestException('Solo se puede completar una tarea Pendiente.');
    const respuesta = dto.respuesta.trim();
    if (!respuesta) throw new BadRequestException('Escribe una respuesta.');
    const adjuntos = await this.prepararAdjuntos(dto.adjuntos, String(user.id), 'RESPUESTA');
    if (adjuntos.length === 0) throw new BadRequestException('Adjunta al menos una evidencia.');

    await this.prisma.tareaRrhh.update({
      where: { id: t.id },
      data: { estado: 'COMPLETADA', respuesta, completadaEn: new Date(), adjuntos: { create: adjuntos }, historial: { create: { accion: 'COMPLETADA', actorId: String(user.id), detalle: null } } },
    });
    await this.avisar([t.asignadoPorId], 'Tarea completada', `${nombreDe(t.asignadoA)} completó «${t.titulo}». Revísala.`, t, 'TAREA_COMPLETADA');
    return this.presentarUna(t.id);
  }

  async revisar(dto: RevisarTareaDto, user: any) {
    const t = await this.cargar(dto.id);
    if (!this.puedeGestionar(user, t)) throw new ForbiddenException('Solo quien asignó la tarea (o un administrador) puede revisarla.');
    if (t.estado !== 'COMPLETADA') throw new BadRequestException('Solo se puede revisar una tarea Completada.');
    if (dto.accion === 'APROBAR') {
      await this.prisma.tareaRrhh.update({
        where: { id: t.id },
        data: { estado: 'REVISADA', revisadaEn: new Date(), revisadaPorId: String(user.id), historial: { create: { accion: 'REVISADA', actorId: String(user.id), detalle: null } } },
      });
      await this.avisar([t.asignadoAId], 'Tarea aprobada', `«${t.titulo}» fue revisada y aprobada.`, t, 'TAREA_REVISADA');
    } else {
      const motivo = dto.motivo?.trim();
      if (!motivo) throw new BadRequestException('Escribe el motivo de la devolución.');
      await this.prisma.tareaRrhh.update({
        where: { id: t.id },
        data: { estado: 'PENDIENTE', completadaEn: null, historial: { create: { accion: 'DEVUELTA', actorId: String(user.id), detalle: motivo } } },
      });
      await this.avisar([t.asignadoAId], 'Tarea devuelta', `«${t.titulo}» volvió a Pendiente: ${motivo}`, t, 'TAREA_DEVUELTA');
    }
    return this.presentarUna(t.id);
  }

  async cancelar(dto: CancelarTareaDto, user: any) {
    const t = await this.cargar(dto.id);
    if (!this.puedeGestionar(user, t)) throw new ForbiddenException('Solo quien asignó la tarea (o un administrador) puede cancelarla.');
    if (t.estado !== 'PENDIENTE') throw new BadRequestException('Solo se puede cancelar una tarea Pendiente.');
    const motivo = dto.motivo?.trim() || null;
    await this.prisma.tareaRrhh.update({
      where: { id: t.id },
      data: { estado: 'CANCELADA', canceladaEn: new Date(), motivoCancelacion: motivo, historial: { create: { accion: 'CANCELADA', actorId: String(user.id), detalle: motivo } } },
    });
    await this.avisar([t.asignadoAId], 'Tarea cancelada', `«${t.titulo}» fue cancelada${motivo ? `: ${motivo}` : '.'}`, t, 'TAREA_CANCELADA');
    return this.presentarUna(t.id);
  }

  async reasignar(dto: ReasignarTareaDto, user: any) {
    const t = await this.cargar(dto.id);
    if (!this.puedeGestionar(user, t)) throw new ForbiddenException('Solo quien asignó la tarea (o un administrador) puede reasignarla.');
    if (t.estado !== 'PENDIENTE') throw new BadRequestException('Solo se puede reasignar una tarea Pendiente.');
    if (dto.asignadoAId === t.asignadoAId) throw new BadRequestException('La tarea ya está asignada a esa persona.');
    const nueva = await this.validarResponsable(user, dto.asignadoAId);
    await this.prisma.tareaRrhh.update({
      where: { id: t.id },
      data: {
        asignadoAId: nueva.id,
        agenciaId: nueva.agenciaId ?? null,
        regionId: nueva.regionId ?? nueva.agencia?.regionId ?? nueva.bodega?.regionId ?? null,
        vencidaAvisadaEn: null,
        historial: { create: { accion: 'REASIGNADA', actorId: String(user.id), detalle: `${nombreDe(t.asignadoA)} → ${nombreDe(nueva)}` } },
      },
    });
    await this.avisar([nueva.id], 'Tarea asignada', `${nombreDe(user)} te asignó «${t.titulo}».`, t, 'TAREA_REASIGNADA');
    if (t.asignadoA.estado === 1) await this.avisar([t.asignadoAId], 'Tarea reasignada', `«${t.titulo}» pasó a ${nombreDe(nueva)}.`, t, 'TAREA_REASIGNADA');
    return this.presentarUna(t.id);
  }

  // ───────────────────────── Tarea diaria ─────────────────────────

  /** Avisa, una sola vez, de las tareas Pendientes cuya fecha límite ya pasó: al responsable y a quien la asignó. */
  async avisarVencidas(ahora = new Date(), soloIds?: string[]): Promise<number> {
    const vencidas = await this.prisma.tareaRrhh.findMany({
      where: { estado: 'PENDIENTE', fechaLimite: { lt: ahora }, vencidaAvisadaEn: null, ...(soloIds ? { id: { in: soloIds } } : {}) },
      select: { id: true, numero: true, titulo: true, asignadoAId: true, asignadoPorId: true },
      take: 500,
    });
    for (const t of vencidas) {
      await this.prisma.tareaRrhh.update({ where: { id: t.id }, data: { vencidaAvisadaEn: ahora } });
      await this.avisar([t.asignadoAId, t.asignadoPorId], 'Tarea vencida', `«${t.titulo}» pasó su fecha límite y sigue Pendiente.`, t, 'TAREA_VENCIDA');
    }
    if (vencidas.length) this.logger.log(`[Cron] ${vencidas.length} tareas vencidas avisadas.`);
    return vencidas.length;
  }
}
