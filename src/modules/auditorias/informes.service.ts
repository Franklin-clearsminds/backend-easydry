import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService } from '../../common/cache/cache.service.js';
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
  SeguimientoPlanDto,
} from './dto/informes.dto.js';
import { AprobarInformeDto, FirmarInformeDto, ValidarSelloDto } from './dto/sellos.dto.js';
import { SellosService } from './sellos.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import {
  CALIFICACIONES,
  ESTADOS_RESULTADO,
  FIRMAS_INFORME,
  MAX_FIRMA_CARACTERES,
  TIPO_FIRMA_JEFE,
  TIPO_FIRMA_RECEPCION,
  cargoDeRol,
  correlativoDe,
  esEditable,
  esImagenDataUrl,
  estadoPlanEfectivo,
  faltantesParaGuardar,
  formatearNumero,
  huellaContenido,
  nombreNormalizado,
  periodoDe,
  puedePasarA,
  type EstadoInforme,
} from './informes.reglas.js';

type Tx = Prisma.TransactionClient;

const SIN_RESULTADOS = { id: { in: [] as string[] } };
const PUNTOS_CALIFICACION: Record<string, number> = { EXCELENTE: 4, BUENO: 3, REGULAR: 2, MALO: 1 };
const ESTADOS_CON_PLANES_VISIBLES = ['GUARDADO'];
const ESTADOS_PLAN_ABIERTO = ['PENDIENTE', 'EN_PROCESO'];

const dia = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const fechaDia = (s?: string | null): Date | null => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`) : null);
const texto = (s: string | undefined | null): string => String(s ?? '').trim();
const lista = (a: string[] | undefined | null): string[] => (a ?? []).map((x) => String(x).trim()).filter(Boolean);

@Injectable()
export class InformesInspeccionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellos: SellosService,
    /** Las firmas y el logo del jefe de taller se guardan cifrados en la base. */
    private readonly crypto: CryptoService,
    /** Guarda un rato el resumen de los informes. Sin él, cada visita lo recalcula. */
    @Optional() private readonly cache?: CacheService,
  ) {}

  // ───────────────────────── Alcance y permisos sobre un informe ─────────────────────────

  /**
   * Qué informes ve el usuario: los de su ámbito (país, región o agencia) que no estén eliminados. Quien no puede auditar
   * (líder, lavador, pulidor) ve solo el resultado: los informes ya guardados.
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
    return !tienePermiso(user, 'informes.crear') && !tienePermiso(user, 'informes.administrar');
  }

  private esAdmin(user: any): boolean {
    return ['ADMIN', 'SUPER_ADMIN'].includes(rolDeUsuario(user));
  }

  /** Qué puede hacer el usuario con este informe, calculado en el servidor para que la web y la app no repitan las reglas. */
  private permisosSobre(i: { estado: string; inspectorId: string; aprobadoEn?: Date | null }, user: any) {
    const esAutor = i.inspectorId === user?.id;
    const administra = tienePermiso(user, 'informes.administrar');
    const crea = tienePermiso(user, 'informes.crear');
    // Un informe es editable solo mientras es borrador, y por quien lo elaboró (o quien administra los de otros).
    const puedeEditar = esEditable(i.estado) && ((esAutor && crea) || administra);
    return {
      puedeEditar,
      puedeGuardar: puedeEditar,
      puedeCalificar: puedeEditar && tienePermiso(user, 'informes.firmar'),
      puedeFirmar: puedeEditar,
      puedeEliminar: esEditable(i.estado) && tienePermiso(user, 'informes.eliminar') && (esAutor || administra),
      puedeSeguimiento: i.estado === 'GUARDADO' && tienePermiso(user, 'informes.seguimiento'),
      // Aprobar (y firmar la recepción) es solo de un Admin o Super Admin, y solo de un informe guardado que aún no se aprobó.
      puedeAprobar: i.estado === 'GUARDADO' && !i.aprobadoEn && this.esAdmin(user) && tienePermiso(user, 'informes.aprobar'),
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
      firmas: true,
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
      aprobado: !!i.aprobadoEn,
      calificacion: i.calificacion,
      totalNovedades: i._count?.novedades ?? 0,
      totalPlanes: i._count?.planes ?? 0,
      createdAt: i.createdAt?.toISOString(),
      updatedAt: i.updatedAt?.toISOString(),
    };
  }

  /** Indicadores de las tarjetas del listado de informes, siempre dentro del alcance del usuario. */
  async resumen(user: any) {
    if (!this.cache) return this.calcularResumen(user);
    return this.cache.obtenerOCalcular(`informes:resumen:${user?.id ?? 'anonimo'}`, 60, () => this.calcularResumen(user));
  }

  private async calcularResumen(user: any) {
    const visible = this.whereVisible(user) as Prisma.InformeInspeccionWhereInput;
    const hoy = hoyEcuador();
    const periodoActual = hoy.toISOString().slice(0, 7);
    const planesBase: Prisma.InformePlanAccionWhereInput = {
      informe: combinarWhere(visible, { estado: { in: ESTADOS_CON_PLANES_VISIBLES } }) as Prisma.InformeInspeccionWhereInput,
    };

    const [total, esteMes, porEstado, porCalificacion, porAgenciaCalif, porPeriodo, planesAbiertos, recientes, proximos] = await Promise.all([
      this.prisma.informeInspeccion.count({ where: visible }),
      this.prisma.informeInspeccion.count({ where: combinarWhere(visible, { periodo: periodoActual }) as Prisma.InformeInspeccionWhereInput }),
      this.prisma.informeInspeccion.groupBy({ by: ['estado'], where: visible, _count: { _all: true } }),
      this.prisma.informeInspeccion.groupBy({ by: ['calificacion'], where: combinarWhere(visible, { calificacion: { not: null } }) as Prisma.InformeInspeccionWhereInput, _count: { _all: true } }),
      this.prisma.informeInspeccion.groupBy({ by: ['agenciaId', 'calificacion'], where: visible, _count: { _all: true } }),
      this.prisma.informeInspeccion.groupBy({ by: ['periodo'], where: visible, _count: { _all: true }, orderBy: { periodo: 'desc' }, take: 6 }),
      this.prisma.informePlanAccion.count({ where: { ...planesBase, estado: { in: ESTADOS_PLAN_ABIERTO } } }),
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

    const porAprobar = await this.prisma.informeInspeccion.count({ where: combinarWhere(visible, { estado: 'GUARDADO', aprobadoEn: null }) as Prisma.InformeInspeccionWhereInput });
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
      borradores: conteo('BORRADOR'),
      guardados: conteo('GUARDADO'),
      porAprobar,
      planesPendientes: planesAbiertos,
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
      guardadoEn: i.guardadoEn?.toISOString() ?? null,
      aprobadoEn: i.aprobadoEn?.toISOString() ?? null,
      aprobadoPorNombre: i.aprobadoPorNombre ?? null,
      jefeTallerPresente: i.jefeTallerPresente !== false,
      // El sello se muestra aunque haya que validarlo otra vez (validadoEn nulo): así se sabe quién debe firmar de nuevo.
      sello: i.selloNombre
        ? { id: i.selloId, nombre: i.selloNombre, logo: this.crypto.revelarEnReposo(i.selloLogo), validadoEn: i.selloValidadoEn?.toISOString() ?? null }
        : null,
      firmas: FIRMAS_INFORME.map((f) => {
        const firma = (i.firmas ?? []).find((x: any) => x.tipo === f.tipo && x.imagen);
        return {
          tipo: f.tipo,
          etiqueta: f.nombre,
          /** Falso para la del jefe de taller cuando no estuvo presente: no se pide. */
          requerida: true,
          firmada: !!firma && firma.vigente !== false,
          // Firmada antes de que cambiara el contenido: debe repetirla la misma persona.
          desactualizada: !!firma && firma.vigente === false,
          nombre: firma?.nombre ?? '',
          cargo: firma?.cargo ?? f.nombre,
          imagen: this.crypto.revelarEnReposo(firma?.imagen),
          firmadoEn: firma?.firmadoEn?.toISOString() ?? null,
        };
      }),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
      novedades: i.novedades.map((n: any) => ({
        id: n.id,
        titulo: n.titulo,
        descripcion: n.descripcion,
        categoria: n.categoria,
        area: n.area,
        fotos: n.fotos ?? [],
        registradaEn: n.registradaEn.toISOString(),
      })),
      actividades: i.actividades.map((a: any) => ({
        id: a.id,
        nombre: a.nombre,
        descripcion: a.descripcion,
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
      throw new ForbiddenException(esEditable(actual.estado) ? 'Solo quien elaboró el informe puede editarlo.' : 'El informe ya está guardado: no se puede modificar.');
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
      if (dto.jefeTallerPresente === false && actual.jefeTallerPresente !== false) {
        // Sin jefe de taller en la visita no hay contraseña que validar: se descarta el sello y la firma que hubiera (el taller firmará con nombre escrito).
        await tx.informeInspeccion.update({ where: { id: actual.id }, data: { selloId: null, selloNombre: null, selloLogo: null, selloValidadoEn: null } });
        await tx.informeFirma.deleteMany({ where: { informeId: actual.id, tipo: TIPO_FIRMA_JEFE } });
        await this.registrar(tx, actual.id, user, 'JEFE_AUSENTE', null, null, 'Se indicó que el jefe de taller no estuvo presente en la visita.');
      } else if (dto.jefeTallerPresente === true && actual.jefeTallerPresente === false) {
        await tx.informeFirma.deleteMany({ where: { informeId: actual.id, tipo: TIPO_FIRMA_JEFE } });
        await this.registrar(tx, actual.id, user, 'JEFE_PRESENTE', null, null, 'Se indicó que el jefe de taller sí estuvo presente: debe validar su contraseña y firmar.');
      }
      await this.anularFirmasDesactualizadas(tx, actual.id, user);
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
      ...(typeof dto.jefeTallerPresente === 'boolean' ? { jefeTallerPresente: dto.jefeTallerPresente } : {}),
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
        area: texto(n.area),
        fotos: lista(n.fotos),
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
    // El responsable de un plan es siempre la agencia del informe y su fecha es la del día en que se crea.
    const agencia = await tx.agencia.findUnique({ where: { id: agenciaId }, select: { nombre: true } });
    const creacion = { areaResponsable: '', personaResponsable: agencia?.nombre ?? '', fechaCompromiso: hoyEcuador() };
    for (const [orden, p] of items.entries()) {
      // Prioridad, estado y observaciones ya no se piden al crear el informe: quedan con el valor de la base (media, pendiente, vacío).
      // El seguimiento posterior a la aprobación sigue cambiando el estado y las observaciones.
      const data = {
        agenciaId,
        problema: texto(p.problema),
        accionRequerida: texto(p.accionRequerida),
        evidenciaCumplimiento: lista(p.evidenciaCumplimiento),
        orden,
      };
      if (p.id && existentes.has(p.id)) await tx.informePlanAccion.update({ where: { id: p.id }, data });
      else await tx.informePlanAccion.create({ data: { ...data, ...creacion, informeId } });
    }
  }

  // ───────────────────────── Flujo de estados ─────────────────────────

  /** Guarda el informe de forma definitiva: exige el contenido, la calificación, el jefe de taller validado y las cuatro firmas. */
  async guardar(id: string, user: any) {
    const informe = await this.cargar(id, user);
    if (!this.permisosSobre(informe, user).puedeGuardar) {
      throw new ForbiddenException(esEditable(informe.estado) ? 'Solo quien elaboró el informe puede guardarlo.' : 'El informe ya está guardado.');
    }
    const faltan = faltantesParaGuardar({
      asunto: informe.asunto,
      destinatarioNombre: informe.destinatarioNombre,
      desarrollo: informe.desarrollo,
      novedades: informe.novedades.length,
      calificacion: informe.calificacion,
      selloValidado: !!informe.selloValidadoEn && !!informe.selloNombre,
      jefePresente: informe.jefeTallerPresente !== false,
      firmadas: (informe.firmas ?? []).filter((f: any) => f.imagen && f.vigente !== false).map((f: any) => f.tipo),
    });
    if (faltan.length) throw new BadRequestException(`Antes de guardar el informe completa: ${faltan.join(', ')}.`);
    await this.cambiarEstado(informe, 'GUARDADO', user, 'GUARDADO', 'Informe firmado y guardado de forma definitiva.', { guardadoEn: new Date() });
    return this.detail(id, user);
  }

  /**
   * Aprueba un informe ya guardado. Solo un Admin o Super Admin: firma la recepción en pantalla y queda registrado quién y cuándo aprobó.
   * El contenido del informe no cambia; solo se agrega esa firma.
   */
  async aprobar(dto: AprobarInformeDto, user: any) {
    const informe = await this.cargar(dto.informeId, user);
    if (informe.estado !== 'GUARDADO') throw new ConflictException('Solo se aprueba un informe ya guardado.');
    if (informe.aprobadoEn) throw new ConflictException('El informe ya está aprobado.');
    if (!this.esAdmin(user) || !tienePermiso(user, 'informes.aprobar')) {
      throw new ForbiddenException('Solo un Admin o Super Admin aprueba los informes y firma la recepción.');
    }
    if (!esImagenDataUrl(dto.imagen, MAX_FIRMA_CARACTERES)) throw new BadRequestException('La firma no es una imagen válida.');
    const nombre = texto(user?.nombre) || `${user?.name ?? ''} ${user?.lastname ?? ''}`.trim();
    const huella = huellaContenido(informe);
    await this.prisma.$transaction(async (tx) => {
      const datos = { nombre, cargo: 'Recepción', imagen: this.crypto.protegerEnReposo(dto.imagen), firmadoEn: new Date(), registradoPorId: String(user.id), registradoPorNombre: nombre, vigente: true, contenidoHash: huella };
      await tx.informeFirma.upsert({
        where: { informeId_tipo: { informeId: informe.id, tipo: TIPO_FIRMA_RECEPCION } },
        create: { informeId: informe.id, tipo: TIPO_FIRMA_RECEPCION, ...datos },
        update: datos,
      });
      await tx.informeInspeccion.update({ where: { id: informe.id }, data: { aprobadoEn: new Date(), aprobadoPorId: String(user.id), aprobadoPorNombre: nombre } });
      await this.registrar(tx, informe.id, user, 'APROBADO', null, null, `Aprobado por ${nombre}, que firmó la recepción.`);
    });
    return this.detail(informe.id, user);
  }

  /**
   * Valida con su contraseña al jefe de taller que firma el informe. Es la puerta de la sección de firmas: guarda su nombre y su logo
   * en el informe. Si se cambia de jefe de taller, la firma del anterior se descarta.
   */
  async validarSello(dto: ValidarSelloDto, user: any) {
    const informe = await this.cargar(dto.informeId, user);
    if (!this.permisosSobre(informe, user).puedeCalificar) {
      throw new ForbiddenException(esEditable(informe.estado) ? 'Tu rol no puede validar al jefe de taller.' : 'El informe ya está guardado.');
    }
    if (informe.jefeTallerPresente === false) {
      throw new BadRequestException('Indicaste que el jefe de taller no estuvo presente: no hay contraseña que validar. Márcalo como presente si sí estuvo.');
    }
    // Una vez que un jefe de taller firmó, solo ese mismo puede volver a firmar: no se cambia por otro.
    const jefeFirmo = (informe.firmas ?? []).some((f: any) => f.tipo === TIPO_FIRMA_JEFE && f.imagen);
    if (jefeFirmo) {
      const mensaje = `Este informe ya lo firmó ${informe.selloNombre}: solo el mismo jefe de taller puede volver a firmarlo.`;
      if (informe.selloId) {
        if (informe.selloId !== dto.selloId) throw new ConflictException(mensaje);
      } else {
        // El sello original ya no existe (se borró): se acepta uno con el mismo nombre.
        const elegido = await this.prisma.selloJefeTaller.findUnique({ where: { id: dto.selloId }, select: { nombre: true, apellido: true } });
        if (!elegido || nombreNormalizado(`${elegido.nombre} ${elegido.apellido}`) !== nombreNormalizado(informe.selloNombre ?? '')) throw new ConflictException(mensaje);
      }
    }
    const sello = await this.sellos.verificar(dto.selloId, dto.password);
    const nombre = `${sello.nombre} ${sello.apellido}`.trim();
    await this.prisma.$transaction(async (tx) => {
      await tx.informeInspeccion.update({
        where: { id: informe.id },
        data: { selloId: sello.id, selloNombre: nombre, selloLogo: this.crypto.protegerEnReposo(sello.logo), selloValidadoEn: new Date() },
      });
      await this.registrar(tx, informe.id, user, 'SELLO_VALIDADO', null, null, `Jefe de taller validado: ${nombre}.`);
    });
    return this.detail(informe.id, user);
  }

  /** Registra una de las cuatro firmas capturadas en pantalla. Volver a firmar reemplaza la anterior mientras sea borrador. */
  async firmar(dto: FirmarInformeDto, user: any) {
    const informe = await this.cargar(dto.informeId, user);
    if (!this.permisosSobre(informe, user).puedeFirmar) {
      throw new ForbiddenException(esEditable(informe.estado) ? 'Solo quien elaboró el informe puede registrar las firmas.' : 'El informe ya está guardado: no se puede firmar.');
    }
    if (!esImagenDataUrl(dto.imagen, MAX_FIRMA_CARACTERES)) throw new BadRequestException('La firma no es una imagen válida.');
    const def = FIRMAS_INFORME.find((f) => f.tipo === dto.tipo)!;
    if (dto.tipo === TIPO_FIRMA_RECEPCION) {
      throw new BadRequestException('La firma de recepción la hace un Admin o Super Admin cuando aprueba el informe ya guardado.');
    }
    let nombre: string;
    // Si el jefe de taller estuvo, firma con su sello validado; si no estuvo, quien firma por el taller escribe su nombre y apellido.
    if (dto.tipo === TIPO_FIRMA_JEFE && informe.jefeTallerPresente !== false) {
      if (!informe.selloValidadoEn || !informe.selloNombre) throw new BadRequestException('Primero valida al jefe de taller con su contraseña, en el paso de calificación.');
      nombre = informe.selloNombre;
    } else {
      const anterior = (informe.firmas ?? []).find((f: any) => f.tipo === dto.tipo && f.imagen);
      const pedido = texto(dto.nombre);
      if (anterior) {
        // Quien firmó la primera vez es quien vuelve a firmar.
        if (pedido && nombreNormalizado(pedido) !== nombreNormalizado(anterior.nombre)) {
          throw new BadRequestException(`Debe volver a firmar quien firmó la primera vez como ${def.nombre.toLowerCase()}: ${anterior.nombre}.`);
        }
        nombre = anterior.nombre;
      } else {
        nombre = pedido;
        if (!nombre) throw new BadRequestException(`Indica el nombre de quien firma como ${def.nombre.toLowerCase()}.`);
      }
    }
    const huella = huellaContenido(informe);
    const firmante = texto(user?.nombre) || `${user?.name ?? ''} ${user?.lastname ?? ''}`.trim();
    await this.prisma.$transaction(async (tx) => {
      const datos = { nombre, cargo: def.nombre, imagen: this.crypto.protegerEnReposo(dto.imagen), firmadoEn: new Date(), registradoPorId: String(user.id), registradoPorNombre: firmante, vigente: true, contenidoHash: huella };
      await tx.informeFirma.upsert({
        where: { informeId_tipo: { informeId: informe.id, tipo: dto.tipo } },
        create: { informeId: informe.id, tipo: dto.tipo, ...datos },
        update: datos,
      });
      await this.registrar(tx, informe.id, user, 'FIRMADO', null, null, `Firma de ${def.nombre.toLowerCase()}: ${nombre}.`);
    });
    return this.detail(informe.id, user);
  }

  /**
   * Tras guardar un cambio, las firmas hechas sobre un contenido distinto dejan de ser vigentes y deben repetirlas las mismas personas. Si la del
   * jefe de taller se anula, también debe validar otra vez su contraseña. Guardar sin cambios no anula nada.
   */
  private async anularFirmasDesactualizadas(tx: Tx, informeId: string, user: any) {
    const completo = await tx.informeInspeccion.findUnique({
      where: { id: informeId },
      include: {
        novedades: { orderBy: [{ orden: 'asc' }, { registradaEn: 'asc' }] },
        actividades: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] },
        planes: { orderBy: [{ orden: 'asc' }, { id: 'asc' }] },
      },
    });
    if (!completo) return;
    const huella = huellaContenido(completo);
    const viejas = await tx.informeFirma.findMany({
      where: { informeId, imagen: { not: null }, vigente: true, OR: [{ contenidoHash: null }, { contenidoHash: { not: huella } }] },
      select: { id: true, tipo: true, nombre: true },
    });
    if (!viejas.length) return;
    await tx.informeFirma.updateMany({ where: { id: { in: viejas.map((f) => f.id) } }, data: { vigente: false } });
    if (viejas.some((f) => f.tipo === TIPO_FIRMA_JEFE)) await tx.informeInspeccion.update({ where: { id: informeId }, data: { selloValidadoEn: null } });
    await this.registrar(tx, informeId, user, 'FIRMAS_ANULADAS', null, null, `El contenido cambió: deben volver a firmar ${viejas.map((f) => f.nombre).join(', ')}.`);
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
      throw new ForbiddenException('El seguimiento de los planes se registra cuando el informe ya está guardado.');
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
