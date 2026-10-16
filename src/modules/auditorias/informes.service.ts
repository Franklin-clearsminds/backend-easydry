import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { agenciasConLider } from './lideres-agencia.js';
import { columnasSimples, combinarWhere, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { paginacionListado } from '../../common/utils/data-grid.helpers.js';
import { resolverAlcance, whereAgencias, whereSobreAgencia, type Alcance } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { hoyEcuador } from '../retos/retos.reglas.js';
import {
  ActividadDto,
  GuardarInformeDto,
  ListInformesDto,
  ListPlanesDto,
  NovedadDto,
  PlanAccionDto,
  RevisarInformeDto,
  SeguimientoPlanDto,
} from './dto/informes.dto.js';
import {
  CALIFICACIONES,
  ESTADOS_RESULTADO,
  cargoDeRol,
  correlativoDe,
  esEditable,
  estadoPlanEfectivo,
  faltantesParaEnviar,
  formatearNumero,
  periodoDe,
  puedePasarA,
  type EstadoInforme,
} from './informes.reglas.js';

type Tx = Prisma.TransactionClient;

const SIN_RESULTADOS = { id: { in: [] as string[] } };
const PUNTOS_CALIFICACION: Record<string, number> = { EXCELENTE: 4, BUENO: 3, REGULAR: 2, MALO: 1 };
const ESTADOS_CON_PLANES_VISIBLES = ['EN_REVISION', 'APROBADO', 'CERRADO'];
const ESTADOS_PLAN_ABIERTO = ['PENDIENTE', 'EN_PROCESO'];

const dia = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const fechaDia = (s?: string | null): Date | null => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`) : null);
const texto = (s: string | undefined | null): string => String(s ?? '').trim();
const lista = (a: string[] | undefined | null): string[] => (a ?? []).map((x) => String(x).trim()).filter(Boolean);

@Injectable()
export class InformesInspeccionService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── Alcance y permisos sobre un informe ─────────────────────────

  /**
   * Qué informes ve el usuario: los de su ámbito (país, región o agencia) que no estén eliminados. Quien no puede auditar
   * (líder, lavador, pulidor) ve solo el resultado: los informes ya aprobados o cerrados.
   */
  private whereVisible(user: any): Record<string, unknown> {
    const alcance = resolverAlcance(user);
    return combinarWhere(
      { deletedAt: null },
      whereSobreAgencia(alcance, 'agenciaId', 'agencia'),
      this.soloResultado(user) ? { estado: { in: [...ESTADOS_RESULTADO] } } : undefined,
    );
  }

  private soloResultado(user: any): boolean {
    return !tienePermiso(user, 'informes.crear') && !tienePermiso(user, 'informes.revisar');
  }

  private esAdmin(user: any): boolean {
    return ['ADMIN', 'SUPER_ADMIN'].includes(rolDeUsuario(user));
  }

  /** Qué puede hacer el usuario con este informe, calculado en el servidor para que la web y la app no repitan las reglas. */
  private permisosSobre(i: { estado: string; inspectorId: string }, user: any) {
    const esAutor = i.inspectorId === user?.id;
    const revisor = tienePermiso(user, 'informes.revisar');
    const crea = tienePermiso(user, 'informes.crear');
    const puedeEditar = esEditable(i.estado) && ((esAutor && crea) || revisor);
    return {
      puedeEditar,
      puedeEnviar: puedeEditar,
      puedeCalificar: puedeEditar && tienePermiso(user, 'informes.firmar'),
      puedeRevisar: i.estado === 'EN_REVISION' && revisor && (!esAutor || this.esAdmin(user)),
      puedeReabrir: i.estado === 'RECHAZADO' && ((esAutor && crea) || revisor),
      puedeCerrar: i.estado === 'APROBADO' && revisor,
      puedeEliminar: esEditable(i.estado) && tienePermiso(user, 'informes.eliminar') && (esAutor || revisor),
      puedeSeguimiento: ['APROBADO', 'CERRADO'].includes(i.estado) && tienePermiso(user, 'informes.seguimiento'),
    };
  }

  private async cargar(id: string, user: any) {
    const informe = await this.prisma.informeInspeccion.findFirst({
      where: combinarWhere({ id }, this.whereVisible(user)) as Prisma.InformeInspeccionWhereInput,
      include: this.incluirDetalle(),
    });
    if (!informe) throw new NotFoundException('No existe el informe o está fuera de tu alcance.');
    return informe;
  }

  private incluirDetalle() {
    return {
      agencia: { select: { id: true, codigo: true, nombre: true } },
      inspector: { select: { id: true, name: true, lastname: true } },
      novedades: { orderBy: [{ orden: 'asc' }, { registradaEn: 'asc' }] },
      actividades: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] },
      planes: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] },
      historial: { orderBy: { createdAt: 'desc' } },
    } satisfies Prisma.InformeInspeccionInclude;
  }

  // ───────────────────────── Listados ─────────────────────────

  async list(dto: ListInformesDto, user: any) {
    const filtros: Record<string, unknown> = {};
    if (dto.agenciaId) filtros.agenciaId = dto.agenciaId;
    if (dto.inspectorId) filtros.inspectorId = dto.inspectorId;
    if (dto.estado) filtros.estado = dto.estado;
    if (dto.calificacion) filtros.calificacion = dto.calificacion;
    if (dto.desde || dto.hasta) {
      filtros.fecha = { ...(dto.desde ? { gte: fechaDia(dto.desde) } : {}), ...(dto.hasta ? { lte: fechaDia(dto.hasta) } : {}) };
    }
    const where = combinarWhere(this.whereVisible(user), filtros, whereBusqueda(['numero', 'asunto'], dto.search));

    return listarPaginable(dto, {
      where,
      columnas: columnasSimples({
        numero: 'numero',
        agencia: 'agencia.nombre',
        fecha: 'fecha',
        responsable: 'inspector.name',
        destinatario: 'destinatarioNombre',
        asunto: 'asunto',
        estado: 'estado',
        calificacion: 'calificacion',
      }),
      ordenHeredado: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      mapear: (items) => items.map((i) => this.aFila(i)),
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.informeInspeccion.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: {
            agencia: { select: { id: true, nombre: true } },
            inspector: { select: { id: true, name: true, lastname: true } },
            _count: { select: { novedades: true, planes: true } },
          },
        }),
      contar: (w) => this.prisma.informeInspeccion.count({ where: w }),
    });
  }

  private aFila(i: any) {
    return {
      id: i.id,
      numero: i.numero,
      numeroMensual: i.numeroMensual,
      agenciaId: i.agenciaId,
      agenciaNombre: i.agencia?.nombre ?? '',
      inspectorId: i.inspectorId,
      inspectorNombre: `${i.inspector?.name ?? ''} ${i.inspector?.lastname ?? ''}`.trim(),
      destinatarioNombre: i.destinatarioNombre,
      fecha: dia(i.fecha),
      fechaVisita: i.fechaVisita?.toISOString() ?? null,
      tipoInspeccion: i.tipoInspeccion,
      asunto: i.asunto,
      estado: i.estado,
      calificacion: i.calificacion,
      totalNovedades: i._count?.novedades ?? 0,
      totalPlanes: i._count?.planes ?? 0,
      createdAt: i.createdAt?.toISOString(),
      updatedAt: i.updatedAt?.toISOString(),
    };
  }

  /** Indicadores del dashboard de auditorías y de las tarjetas del listado, siempre dentro del alcance del usuario. */
  async resumen(user: any) {
    const visible = this.whereVisible(user) as Prisma.InformeInspeccionWhereInput;
    const hoy = hoyEcuador();
    const periodoActual = hoy.toISOString().slice(0, 7);
    const planesBase: Prisma.InformePlanAccionWhereInput = {
      informe: combinarWhere(visible, { estado: { in: ESTADOS_CON_PLANES_VISIBLES } }) as Prisma.InformeInspeccionWhereInput,
    };

    const [total, esteMes, porEstado, porCalificacion, porAgenciaCalif, porPeriodo, planesAbiertos, planesVencidos, recientes, proximos] = await Promise.all([
      this.prisma.informeInspeccion.count({ where: visible }),
      this.prisma.informeInspeccion.count({ where: combinarWhere(visible, { periodo: periodoActual }) as Prisma.InformeInspeccionWhereInput }),
      this.prisma.informeInspeccion.groupBy({ by: ['estado'], where: visible, _count: { _all: true } }),
      this.prisma.informeInspeccion.groupBy({ by: ['calificacion'], where: combinarWhere(visible, { calificacion: { not: null } }) as Prisma.InformeInspeccionWhereInput, _count: { _all: true } }),
      this.prisma.informeInspeccion.groupBy({ by: ['agenciaId', 'calificacion'], where: visible, _count: { _all: true } }),
      this.prisma.informeInspeccion.groupBy({ by: ['periodo'], where: visible, _count: { _all: true }, orderBy: { periodo: 'desc' }, take: 6 }),
      this.prisma.informePlanAccion.count({ where: { ...planesBase, estado: { in: ESTADOS_PLAN_ABIERTO } } }),
      this.prisma.informePlanAccion.count({ where: { ...planesBase, estado: { in: ESTADOS_PLAN_ABIERTO }, fechaCompromiso: { lt: hoy } } }),
      this.prisma.informeInspeccion.findMany({
        where: visible,
        orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
        take: 6,
        include: {
          agencia: { select: { id: true, nombre: true } },
          inspector: { select: { id: true, name: true, lastname: true } },
          _count: { select: { novedades: true, planes: true } },
        },
      }),
      this.prisma.informePlanAccion.findMany({
        where: { ...planesBase, estado: { in: ESTADOS_PLAN_ABIERTO } },
        orderBy: [{ fechaCompromiso: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 8,
        include: { informe: { select: { id: true, numero: true, agencia: { select: { nombre: true } } } } },
      }),
    ]);

    const conteo = (estado: string) => porEstado.find((e) => e.estado === estado)?._count._all ?? 0;
    const agenciasIds = [...new Set(porAgenciaCalif.map((r) => r.agenciaId))];
    const agencias = agenciasIds.length
      ? await this.prisma.agencia.findMany({ where: { id: { in: agenciasIds } }, select: { id: true, nombre: true } })
      : [];
    const porAgencia = agenciasIds
      .map((agenciaId) => {
        const filas = porAgenciaCalif.filter((r) => r.agenciaId === agenciaId);
        const totalAgencia = filas.reduce((n, r) => n + r._count._all, 0);
        const calificadas = filas.filter((r) => r.calificacion && PUNTOS_CALIFICACION[r.calificacion]);
        const n = calificadas.reduce((acc, r) => acc + r._count._all, 0);
        const puntos = calificadas.reduce((acc, r) => acc + PUNTOS_CALIFICACION[r.calificacion as string] * r._count._all, 0);
        return {
          agenciaId,
          agenciaNombre: agencias.find((a) => a.id === agenciaId)?.nombre ?? '',
          total: totalAgencia,
          promedio: n ? Math.round((puntos / n) * 100) / 100 : null,
        };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    return {
      total,
      esteMes,
      pendientesAprobacion: conteo('EN_REVISION'),
      aprobados: conteo('APROBADO') + conteo('CERRADO'),
      planesPendientes: planesAbiertos,
      planesVencidos,
      porEstado: porEstado.map((e) => ({ estado: e.estado, total: e._count._all })),
      porCalificacion: CALIFICACIONES.map((c) => ({ calificacion: c, total: porCalificacion.find((r) => r.calificacion === c)?._count._all ?? 0 })),
      porAgencia,
      porPeriodo: porPeriodo.map((p) => ({ periodo: p.periodo, total: p._count._all })).reverse(),
      recientes: recientes.map((i) => this.aFila(i)),
      proximosPlanes: proximos.map((p) => ({
        id: p.id,
        informeId: p.informeId,
        informeNumero: p.informe.numero,
        agenciaNombre: p.informe.agencia.nombre,
        problema: p.problema,
        prioridad: p.prioridad,
        estado: estadoPlanEfectivo(p, hoy),
        fechaCompromiso: dia(p.fechaCompromiso),
        personaResponsable: p.personaResponsable,
      })),
    };
  }

  async listPlanes(dto: ListPlanesDto, user: any) {
    const visible = this.whereVisible(user) as Prisma.InformeInspeccionWhereInput;
    const hoy = hoyEcuador();
    const filtros: Prisma.InformePlanAccionWhereInput = {
      informe: combinarWhere(visible, { estado: { in: ESTADOS_CON_PLANES_VISIBLES } }) as Prisma.InformeInspeccionWhereInput,
      ...(dto.agenciaId ? { agenciaId: dto.agenciaId } : {}),
    };
    if (dto.estado === 'ABIERTOS') filtros.estado = { in: ESTADOS_PLAN_ABIERTO };
    else if (dto.estado === 'VENCIDO') Object.assign(filtros, { estado: { in: ESTADOS_PLAN_ABIERTO }, fechaCompromiso: { lt: hoy } });
    else if (dto.estado) filtros.estado = dto.estado;

    const { page, pageSize, skip, take } = paginacionListado(dto);
    const [items, total] = await Promise.all([
      this.prisma.informePlanAccion.findMany({
        where: filtros,
        orderBy: [{ fechaCompromiso: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        skip,
        take,
        include: { informe: { select: { id: true, numero: true, agencia: { select: { nombre: true } } } } },
      }),
      this.prisma.informePlanAccion.count({ where: filtros }),
    ]);
    return buildDataGridResponse(
      items.map((p) => ({
        ...this.aPlan(p, hoy),
        informeId: p.informeId,
        informeNumero: p.informe.numero,
        agenciaNombre: p.informe.agencia.nombre,
      })),
      total,
      page,
      pageSize,
    );
  }

  /** Agencias del alcance del usuario y quienes elaboraron informes dentro de él: para los filtros y el formulario. */
  async opciones(user: any) {
    const alcance = resolverAlcance(user);
    const agencias = await agenciasConLider(this.prisma, await this.prisma.agencia.findMany({
      where: { estado: 1, ...whereAgencias(alcance) } as Prisma.AgenciaWhereInput,
      select: { id: true, codigo: true, nombre: true },
      orderBy: { nombre: 'asc' },
    }));
    const informes = await this.prisma.informeInspeccion.findMany({
      where: this.whereVisible(user) as Prisma.InformeInspeccionWhereInput,
      distinct: ['inspectorId'],
      select: { inspector: { select: { id: true, name: true, lastname: true } } },
    });
    const responsables = informes
      .map((i) => ({ id: i.inspector.id, nombre: `${i.inspector.name} ${i.inspector.lastname}`.trim() }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { agencias, responsables };
  }

  /** A quién se puede dirigir un informe (PARA): personal activo del ámbito, sin correos ni teléfonos. */
  async destinatarios(user: any) {
    const alcance = resolverAlcance(user);
    const donde = this.whereUsuariosDelAlcance(alcance);
    const usuarios = await this.prisma.user.findMany({
      where: { estado: 1, role: { namerol: { not: 'LAVADOR' } }, ...donde },
      select: { id: true, name: true, lastname: true, agenciaId: true, role: { select: { namerol: true } } },
      orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
      take: 300,
    });
    // Un líder o un pulidor fijo tienen agencia: al elegirlos, el formulario marca su agencia. El pulidor móvil no tiene (opera en su región).
    return usuarios.map((u) => ({
      id: u.id,
      nombre: `${u.name} ${u.lastname}`.trim(),
      cargo: u.role.namerol === 'PULIDOR' ? (u.agenciaId ? 'Pulidor fijo' : 'Pulidor móvil') : cargoDeRol(u.role.namerol),
      rol: u.role.namerol,
      agenciaId: u.agenciaId,
    }));
  }

  private whereUsuariosDelAlcance(a: Alcance): Prisma.UserWhereInput {
    switch (a.tipo) {
      case 'GLOBAL':
        return {};
      case 'REGION':
        return { OR: [{ regionId: a.regionId }, { agencia: { regionId: a.regionId } }] };
      case 'AGENCIA':
        return { agenciaId: a.agenciaId };
      default:
        return SIN_RESULTADOS;
    }
  }

  // ───────────────────────── Detalle ─────────────────────────

  async detail(id: string, user: any) {
    return this.aDetalle(await this.cargar(id, user), user);
  }

  private aPlan(p: any, hoy: Date) {
    return {
      id: p.id,
      problema: p.problema,
      accionRequerida: p.accionRequerida,
      areaResponsable: p.areaResponsable,
      personaResponsable: p.personaResponsable,
      fechaCompromiso: dia(p.fechaCompromiso),
      prioridad: p.prioridad,
      estado: p.estado,
      estadoEfectivo: estadoPlanEfectivo(p, hoy),
      observaciones: p.observaciones,
      evidenciaCumplimiento: p.evidenciaCumplimiento ?? [],
      completadoEn: p.completadoEn?.toISOString() ?? null,
    };
  }

  private aDetalle(i: any, user: any) {
    const hoy = hoyEcuador();
    return {
      id: i.id,
      numero: i.numero,
      numeroMensual: i.numeroMensual,
      periodo: i.periodo,
      estado: i.estado,
      agencia: i.agencia,
      inspectorId: i.inspectorId,
      inspectorNombre: `${i.inspector?.name ?? ''} ${i.inspector?.lastname ?? ''}`.trim(),
      destinatarioId: i.destinatarioId,
      destinatarioNombre: i.destinatarioNombre,
      fecha: dia(i.fecha),
      fechaVisita: i.fechaVisita?.toISOString() ?? null,
      tipoInspeccion: i.tipoInspeccion,
      asunto: i.asunto,
      antecedentes: i.antecedentes,
      desarrollo: i.desarrollo,
      actividadesGeneral: i.actividadesGeneral,
      planesGeneral: i.planesGeneral,
      observacionesJefeTaller: i.observacionesJefeTaller,
      calificacion: i.calificacion,
      calificadoPorNombre: i.calificadoPorNombre,
      calificadoEn: i.calificadoEn?.toISOString() ?? null,
      motivoRechazo: i.motivoRechazo,
      enviadoEn: i.enviadoEn?.toISOString() ?? null,
      aprobadoEn: i.aprobadoEn?.toISOString() ?? null,
      cerradoEn: i.cerradoEn?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      novedades: i.novedades.map((n: any) => ({
        id: n.id,
        titulo: n.titulo,
        descripcion: n.descripcion,
        categoria: n.categoria,
        prioridad: n.prioridad,
        area: n.area,
        fotos: n.fotos ?? [],
        estadoSeguimiento: n.estadoSeguimiento,
        registradaEn: n.registradaEn.toISOString(),
      })),
      actividades: i.actividades.map((a: any) => ({
        id: a.id,
        nombre: a.nombre,
        descripcion: a.descripcion,
        responsable: a.responsable,
        fecha: dia(a.fecha),
        resultado: a.resultado,
        observaciones: a.observaciones,
        fotos: a.fotos ?? [],
      })),
      planes: i.planes.map((p: any) => this.aPlan(p, hoy)),
      historial: i.historial.map((h: any) => ({
        id: h.id,
        accion: h.accion,
        estadoAnterior: h.estadoAnterior,
        estadoNuevo: h.estadoNuevo,
        usuarioNombre: h.usuarioNombre,
        rol: h.rol,
        detalle: h.detalle,
        createdAt: h.createdAt.toISOString(),
      })),
      permisos: this.permisosSobre(i, user),
    };
  }

  // ───────────────────────── Crear y editar (borrador) ─────────────────────────

  async create(dto: GuardarInformeDto, user: any) {
    const agencia = await this.agenciaEnAlcance(dto.agenciaId, user);
    const fecha = texto(dto.fecha) || hoyEcuador().toISOString().slice(0, 10);
    const periodo = periodoDe(fecha);
    const rol = rolDeUsuario(user);
    const nombre = texto(user?.nombre) || `${user?.name ?? ''} ${user?.lastname ?? ''}`.trim();

    for (let intento = 0; intento < 5; intento++) {
      try {
        const creado = await this.prisma.$transaction(async (tx) => {
          const { numero, numeroMensual } = await this.siguientesNumeros(tx, agencia.id, periodo, Number(fecha.slice(0, 4)));
          const informe = await tx.informeInspeccion.create({
            data: {
              numero,
              numeroMensual,
              periodo,
              agenciaId: agencia.id,
              inspectorId: user.id,
              ...(await this.camposGenerales(dto, user, { esNuevo: true, fecha })),
            } as Prisma.InformeInspeccionUncheckedCreateInput,
          });
          await this.sincronizarHijos(tx, informe.id, agencia.id, dto);
          await this.registrar(tx, informe.id, user, 'CREADO', null, 'BORRADOR', `Informe ${numero} creado para ${agencia.nombre}.`);
          if (informe.calificacion) await this.registrar(tx, informe.id, user, 'CALIFICADO', null, null, `Calificación: ${informe.calificacion}.`);
          return informe.id;
        });
        return this.detail(creado, user);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && intento < 4) continue; // otro informe tomó el número
        throw e;
      }
    }
    throw new ConflictException('No se pudo asignar el número del informe. Inténtalo de nuevo.');
  }

  async update(dto: GuardarInformeDto, user: any) {
    if (!dto.id) throw new BadRequestException('Falta el informe a guardar.');
    const actual = await this.cargar(dto.id, user);
    if (!this.permisosSobre(actual, user).puedeEditar) {
      throw new ForbiddenException(esEditable(actual.estado) ? 'Solo quien elaboró el informe puede editarlo.' : 'El informe ya no es un borrador: su contenido no se puede modificar.');
    }
    const agenciaId = dto.agenciaId === actual.agenciaId ? actual.agenciaId : (await this.agenciaEnAlcance(dto.agenciaId, user)).id;
    const fecha = texto(dto.fecha) || dia(actual.fecha)!;
    const periodo = periodoDe(fecha);

    await this.prisma.$transaction(async (tx) => {
      const cambiaNumeracion = periodo !== actual.periodo || agenciaId !== actual.agenciaId;
      const numeros = cambiaNumeracion ? await this.siguientesNumeros(tx, agenciaId, periodo, Number(fecha.slice(0, 4)), actual.numero) : null;
      const campos = await this.camposGenerales(dto, user, { esNuevo: false, fecha, actual });
      await tx.informeInspeccion.update({
        where: { id: actual.id },
        data: {
          agenciaId,
          periodo,
          ...(numeros ? { numeroMensual: numeros.numeroMensual } : {}),
          ...campos,
        },
      });
      await this.sincronizarHijos(tx, actual.id, agenciaId, dto);
      const calificacionCambio = dto.calificacion && dto.calificacion !== actual.calificacion && tienePermiso(user, 'informes.firmar');
      if (calificacionCambio) await this.registrar(tx, actual.id, user, 'CALIFICADO', null, null, `Calificación: ${dto.calificacion}.`);
    });
    return this.detail(actual.id, user);
  }

  /** Campos del encabezado y de los textos. Las observaciones del jefe de taller y la calificación solo las registra quien puede firmar. */
  private async camposGenerales(
    dto: GuardarInformeDto,
    user: any,
    ctx: { esNuevo: boolean; fecha: string; actual?: any },
  ): Promise<Record<string, any>> {
    const puedeCalificar = tienePermiso(user, 'informes.firmar');
    const destinatario = dto.destinatarioId
      ? await this.prisma.user.findUnique({ where: { id: dto.destinatarioId }, select: { id: true, name: true, lastname: true } })
      : null;
    const calificacionNueva = puedeCalificar ? dto.calificacion : undefined;
    const calificacionCambia = !!calificacionNueva && calificacionNueva !== ctx.actual?.calificacion;
    const nombreActor = texto(user?.nombre) || `${user?.name ?? ''} ${user?.lastname ?? ''}`.trim();
    return {
      destinatarioId: destinatario?.id ?? (dto.destinatarioId ? undefined : null),
      destinatarioNombre: destinatario ? `${destinatario.name} ${destinatario.lastname}`.trim() : texto(dto.destinatarioNombre),
      fecha: fechaDia(ctx.fecha)!,
      fechaVisita: dto.fechaVisita ? new Date(dto.fechaVisita) : ctx.esNuevo ? new Date() : undefined,
      tipoInspeccion: dto.tipoInspeccion ?? (ctx.esNuevo ? 'RUTINA' : undefined),
      asunto: texto(dto.asunto),
      antecedentes: texto(dto.antecedentes),
      desarrollo: texto(dto.desarrollo),
      actividadesGeneral: texto(dto.actividadesGeneral),
      planesGeneral: texto(dto.planesGeneral),
      ...(puedeCalificar && dto.observacionesJefeTaller !== undefined ? { observacionesJefeTaller: texto(dto.observacionesJefeTaller) } : {}),
      ...(calificacionCambia
        ? { calificacion: calificacionNueva, calificadoPorId: user.id, calificadoPorNombre: nombreActor, calificadoEn: new Date() }
        : {}),
    };
  }

  private async agenciaEnAlcance(agenciaId: string, user: any) {
    const alcance = resolverAlcance(user);
    const agencia = await this.prisma.agencia.findFirst({
      where: { AND: [{ id: agenciaId, estado: 1 }, whereAgencias(alcance)] } as Prisma.AgenciaWhereInput,
      select: { id: true, nombre: true },
    });
    if (!agencia) throw new ForbiddenException('La agencia no existe, está inactiva o está fuera de tu alcance.');
    return agencia;
  }

  /** INF-AAAA-NNNN (consecutivo del año) y el correlativo mensual de la agencia. Una colisión la resuelve el reintento de `create`. */
  private async siguientesNumeros(tx: Tx, agenciaId: string, periodo: string, anio: number, numeroActual?: string) {
    const ultimoMensual = await tx.informeInspeccion.aggregate({ where: { agenciaId, periodo }, _max: { numeroMensual: true } });
    const numeroMensual = (ultimoMensual._max.numeroMensual ?? 0) + 1;
    if (numeroActual) return { numero: numeroActual, numeroMensual };
    const prefijo = `INF-${anio}-`;
    const ultimo = await tx.informeInspeccion.findFirst({ where: { numero: { startsWith: prefijo } }, orderBy: { numero: 'desc' }, select: { numero: true } });
    return { numero: formatearNumero(anio, correlativoDe(ultimo?.numero) + 1), numeroMensual };
  }

  /** Novedades, actividades y planes: lo que viene sin `id` se crea, lo que trae un `id` conocido se actualiza y lo que falta se elimina. */
  private async sincronizarHijos(tx: Tx, informeId: string, agenciaId: string, dto: GuardarInformeDto) {
    if (dto.novedades) await this.sincronizarNovedades(tx, informeId, dto.novedades);
    if (dto.actividades) await this.sincronizarActividades(tx, informeId, dto.actividades);
    if (dto.planes) await this.sincronizarPlanes(tx, informeId, agenciaId, dto.planes);
    else await tx.informePlanAccion.updateMany({ where: { informeId }, data: { agenciaId } });
  }

  private async sincronizarNovedades(tx: Tx, informeId: string, items: NovedadDto[]) {
    const existentes = new Set((await tx.informeNovedad.findMany({ where: { informeId }, select: { id: true } })).map((x) => x.id));
    const conservar = items.filter((i) => i.id && existentes.has(i.id)).map((i) => i.id as string);
    await tx.informeNovedad.deleteMany({ where: { informeId, id: { notIn: conservar } } });
    for (const [orden, n] of items.entries()) {
      const data = {
        titulo: texto(n.titulo),
        descripcion: texto(n.descripcion),
        categoria: n.categoria ?? 'OTROS',
        prioridad: n.prioridad ?? 'MEDIA',
        area: texto(n.area),
        fotos: lista(n.fotos),
        estadoSeguimiento: n.estadoSeguimiento ?? 'ABIERTA',
        orden,
      };
      if (n.id && existentes.has(n.id)) await tx.informeNovedad.update({ where: { id: n.id }, data });
      else await tx.informeNovedad.create({ data: { ...data, informeId } });
    }
  }

  private async sincronizarActividades(tx: Tx, informeId: string, items: ActividadDto[]) {
    const existentes = new Set((await tx.informeActividad.findMany({ where: { informeId }, select: { id: true } })).map((x) => x.id));
    const conservar = items.filter((i) => i.id && existentes.has(i.id)).map((i) => i.id as string);
    await tx.informeActividad.deleteMany({ where: { informeId, id: { notIn: conservar } } });
    for (const [orden, a] of items.entries()) {
      const data = {
        nombre: texto(a.nombre),
        descripcion: texto(a.descripcion),
        responsable: texto(a.responsable),
        fecha: fechaDia(a.fecha),
        resultado: texto(a.resultado),
        observaciones: texto(a.observaciones),
        fotos: lista(a.fotos),
        orden,
      };
      if (a.id && existentes.has(a.id)) await tx.informeActividad.update({ where: { id: a.id }, data });
      else await tx.informeActividad.create({ data: { ...data, informeId } });
    }
  }

  private async sincronizarPlanes(tx: Tx, informeId: string, agenciaId: string, items: PlanAccionDto[]) {
    const existentes = new Set((await tx.informePlanAccion.findMany({ where: { informeId }, select: { id: true } })).map((x) => x.id));
    const conservar = items.filter((i) => i.id && existentes.has(i.id)).map((i) => i.id as string);
    await tx.informePlanAccion.deleteMany({ where: { informeId, id: { notIn: conservar } } });
    for (const [orden, p] of items.entries()) {
      const estado = p.estado ?? 'PENDIENTE';
      const data = {
        agenciaId,
        problema: texto(p.problema),
        accionRequerida: texto(p.accionRequerida),
        areaResponsable: texto(p.areaResponsable),
        personaResponsable: texto(p.personaResponsable),
        fechaCompromiso: fechaDia(p.fechaCompromiso),
        prioridad: p.prioridad ?? 'MEDIA',
        estado,
        observaciones: texto(p.observaciones),
        evidenciaCumplimiento: lista(p.evidenciaCumplimiento),
        completadoEn: estado === 'COMPLETADO' ? new Date() : null,
        orden,
      };
      if (p.id && existentes.has(p.id)) await tx.informePlanAccion.update({ where: { id: p.id }, data });
      else await tx.informePlanAccion.create({ data: { ...data, informeId } });
    }
  }

  // ───────────────────────── Flujo de estados ─────────────────────────

  async enviar(id: string, user: any) {
    const informe = await this.cargar(id, user);
    if (!this.permisosSobre(informe, user).puedeEnviar) {
      throw new ForbiddenException(esEditable(informe.estado) ? 'Solo quien elaboró el informe puede enviarlo a revisión.' : 'Solo un informe en borrador se envía a revisión.');
    }
    const faltan = faltantesParaEnviar({
      asunto: informe.asunto,
      destinatarioNombre: informe.destinatarioNombre,
      desarrollo: informe.desarrollo,
      novedades: informe.novedades.length,
      calificacion: informe.calificacion,
    });
    if (faltan.length) throw new BadRequestException(`Antes de enviarlo a revisión completa: ${faltan.join(', ')}.`);
    await this.cambiarEstado(informe, 'EN_REVISION', user, 'ENVIADO_REVISION', 'Enviado a revisión.', { enviadoEn: new Date(), motivoRechazo: null });
    return this.detail(id, user);
  }

  async revisar(dto: RevisarInformeDto, user: any) {
    const informe = await this.cargar(dto.id, user);
    if (informe.estado !== 'EN_REVISION') throw new ConflictException('El informe no está en revisión.');
    if (!tienePermiso(user, 'informes.revisar')) throw new ForbiddenException('Tu rol no puede revisar informes.');
    if (informe.inspectorId === user.id && !this.esAdmin(user)) throw new ForbiddenException('No puedes revisar tu propio informe.');
    if (dto.decision === 'RECHAZAR') {
      const motivo = texto(dto.motivo);
      if (!motivo) throw new BadRequestException('Indica el motivo del rechazo.');
      await this.cambiarEstado(informe, 'RECHAZADO', user, 'RECHAZADO', motivo, { motivoRechazo: motivo });
    } else {
      await this.cambiarEstado(informe, 'APROBADO', user, 'APROBADO', texto(dto.motivo) || 'Revisión aprobada: informe aprobado.', { motivoRechazo: null, aprobadoEn: new Date() });
    }
    return this.detail(dto.id, user);
  }

  async reabrir(id: string, user: any) {
    const informe = await this.cargar(id, user);
    if (!this.permisosSobre(informe, user).puedeReabrir) throw new ForbiddenException('No puedes reabrir este informe.');
    await this.cambiarEstado(informe, 'BORRADOR', user, 'REABIERTO', 'Reabierto para corregirlo.');
    return this.detail(id, user);
  }

  async cerrar(id: string, user: any) {
    const informe = await this.cargar(id, user);
    if (!this.permisosSobre(informe, user).puedeCerrar) throw new ForbiddenException('Solo un informe aprobado lo cierra quien revisa.');
    await this.cambiarEstado(informe, 'CERRADO', user, 'CERRADO', 'Informe cerrado.', { cerradoEn: new Date() });
    return this.detail(id, user);
  }

  async eliminar(id: string, user: any) {
    const informe = await this.cargar(id, user);
    if (!this.permisosSobre(informe, user).puedeEliminar) throw new ForbiddenException('Solo se puede eliminar un borrador, y solo con permiso para ello.');
    await this.prisma.$transaction(async (tx) => {
      await tx.informeInspeccion.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.registrar(tx, id, user, 'ELIMINADO', informe.estado, null, `Borrador ${informe.numero} eliminado.`);
    });
    return { success: true };
  }

  /** Cambia el estado verificando la transición y deja el rastro en el historial. */
  private async cambiarEstado(
    informe: { id: string; estado: string },
    nuevo: EstadoInforme,
    user: any,
    accion: string,
    detalle: string,
    extra: Prisma.InformeInspeccionUncheckedUpdateInput = {},
  ) {
    if (!puedePasarA(informe.estado, nuevo)) throw new ConflictException(`Un informe ${informe.estado} no puede pasar a ${nuevo}.`);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.informeInspeccion.updateMany({ where: { id: informe.id, estado: informe.estado }, data: { estado: nuevo, ...extra } as Prisma.InformeInspeccionUpdateManyMutationInput });
      if (r.count === 0) throw new ConflictException('El informe cambió mientras lo procesabas. Actualiza e inténtalo de nuevo.');
      await this.registrar(tx, informe.id, user, accion, informe.estado, nuevo, detalle);
    });
  }

  // ───────────────────────── Seguimiento de planes ─────────────────────────

  async seguimientoPlan(dto: SeguimientoPlanDto, user: any) {
    const plan = await this.prisma.informePlanAccion.findFirst({
      where: { id: dto.planId, informe: this.whereVisible(user) as Prisma.InformeInspeccionWhereInput },
      include: { informe: { select: { id: true, estado: true, inspectorId: true } } },
    });
    if (!plan) throw new NotFoundException('No existe el plan de acción o está fuera de tu alcance.');
    if (!this.permisosSobre(plan.informe, user).puedeSeguimiento) {
      throw new ForbiddenException('El seguimiento de los planes se registra cuando el informe ya salió de revisión.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.informePlanAccion.update({
        where: { id: plan.id },
        data: {
          estado: dto.estado,
          ...(dto.observaciones !== undefined ? { observaciones: texto(dto.observaciones) } : {}),
          ...(dto.evidenciaCumplimiento ? { evidenciaCumplimiento: lista(dto.evidenciaCumplimiento) } : {}),
          completadoEn: dto.estado === 'COMPLETADO' ? plan.completadoEn ?? new Date() : null,
        },
      });
      if (dto.estado !== plan.estado) {
        await this.registrar(tx, plan.informeId, user, 'SEGUIMIENTO_PLAN', null, null, `Plan «${plan.problema.slice(0, 60)}»: ${plan.estado} → ${dto.estado}.`);
      }
    });
    return this.detail(plan.informeId, user);
  }

  private async registrar(tx: Tx, informeId: string, user: any, accion: string, anterior: string | null, nuevo: string | null, detalle?: string) {
    await tx.informeHistorial.create({
      data: {
        informeId,
        accion,
        estadoAnterior: anterior,
        estadoNuevo: nuevo,
        usuarioId: String(user.id),
        usuarioNombre: texto(user?.nombre) || `${user?.name ?? ''} ${user?.lastname ?? ''}`.trim(),
        rol: rolDeUsuario(user),
        detalle: detalle ?? null,
      },
    });
  }
}
