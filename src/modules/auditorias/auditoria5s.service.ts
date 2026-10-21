import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CacheService, huella } from '../../common/cache/cache.service.js';
import { agenciasConLider } from './lideres-agencia.js';
import { columnasSimples, combinarWhere, paginacionListado, whereBusqueda } from '../../common/utils/data-grid.helpers.js';
import { listarPaginable } from '../../common/utils/listado-paginable.js';
import { buildDataGridResponse } from '../../common/dto/data-grid.dto.js';
import { resolverAlcance, whereAgencias, whereSobreAgencia } from '../../common/permisos/alcance.js';
import { rolDeUsuario } from '../../common/permisos/alias-roles.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { hoyEcuador } from '../retos/retos.reglas.js';
import {
  CompararDto,
  GuardarAuditoria5sDto,
  ListAccionesDto,
  ListAuditorias5sDto,
  ResumenAuditorias5sDto,
  RespuestaDto,
  SeguimientoAccionDto,
  VerificarAccionDto,
} from './dto/auditoria5s.dto.js';
import {
  AREAS_5S,
  AREA_GENERAL,
  CATEGORIAS_IDS,
  ESTADOS_ACCION_ABIERTA,
  ESTADOS_RESULTADO_5S,
  ETIQUETA_AREA,
  FORMATOS,
  FORMATOS_5S,
  TRANSICIONES_ACCION,
  calcularResultado,
  codigoAccion,
  correlativoDeCodigo,
  criteriosSinEvaluar,
  esCriterioValido,
  esPuntajeValido,
  estadoAccionEfectivo,
  formatearCodigo,
  formatoDe,
  prioridadDePuntaje,
  puntajeEfectivo,
  puntajeMaximoCategoria,
  semaforoDe,
  variacion,
  type Formato5s,
  type FormatoId,
} from './auditoria5s.reglas.js';

type Tx = Prisma.TransactionClient;

const dia = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const fechaDia = (s?: string | null): Date | null => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00.000Z`) : null);
const texto = (s: string | undefined | null): string => String(s ?? '').trim();
const lista = (a: string[] | undefined | null): string[] => (a ?? []).map((x) => String(x).trim()).filter(Boolean);
const nombreDe = (u: { name?: string | null; lastname?: string | null } | null | undefined): string => `${u?.name ?? ''} ${u?.lastname ?? ''}`.trim();
const nombreActor = (user: any): string => texto(user?.nombre) || nombreDe(user);
const EDITABLES = ['BORRADOR', 'EN_PROCESO'];
const nombreArea = (a: string) => ETIQUETA_AREA[a as keyof typeof ETIQUETA_AREA] ?? a;

/** Comentarios por cada S: solo las cinco S conocidas y texto limpio. */
function limpiarComentarios(c: Record<string, string> | undefined | null): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const id of CATEGORIAS_IDS) {
    const t = texto(c?.[id]).slice(0, 4000);
    if (t) salida[id] = t;
  }
  return salida;
}

@Injectable()
export class Auditoria5sService {
  constructor(
    private readonly prisma: PrismaService,
    /** Guarda un rato el resumen de las auditorías 5S. Sin él, cada visita lo recalcula. */
    @Optional() private readonly cache?: CacheService,
  ) {}

  /** Los catálogos de los tres formatos son únicos y viven aquí: los clientes los leen y no los copian. */
  catalogo() {
    return {
      areas: AREAS_5S.map((id) => ({ id, nombre: ETIQUETA_AREA[id] })),
      formatos: FORMATOS_5S.map((id) => {
        const f = FORMATOS[id];
        return {
          id: f.id,
          nombre: f.nombre,
          descripcion: f.descripcion,
          tipo: f.tipo,
          maxCriterio: f.maxCriterio,
          escala: f.escala,
          nota: f.nota ?? null,
          puntajeMaximo: f.criterios.length * f.maxCriterio,
          categorias: f.categorias.map((c) => ({ ...c, maximo: puntajeMaximoCategoria(f, c.id), criterios: f.criterios.filter((x) => x.categoria === c.id) })),
        };
      }),
      semaforo: [
        { id: 'VERDE', regla: 'Cumplimiento mayor o igual al 90 %' },
        { id: 'AMARILLO', regla: 'Cumplimiento desde 75 % hasta menos del 90 %' },
        { id: 'ROJO', regla: 'Cumplimiento inferior al 75 %' },
      ],
    };
  }

  // ───────────────────────── Alcance y permisos ─────────────────────────

  /** Auditorías del ámbito del usuario; quien no puede auditar (líder, lavador, pulidor) ve solo las finalizadas o cerradas. */
  private whereVisible(user: any): Record<string, unknown> {
    return combinarWhere(
      { deletedAt: null },
      whereSobreAgencia(resolverAlcance(user), 'agenciaId', 'agencia'),
      this.soloResultado(user) ? { estado: { in: [...ESTADOS_RESULTADO_5S] } } : undefined,
    );
  }

  private soloResultado(user: any): boolean {
    return !tienePermiso(user, 'inspecciones.crear') && !tienePermiso(user, 'inspecciones.verificar');
  }

  private permisosSobre(a: { estado: string; auditorId: string }, user: any) {
    const esAutor = a.auditorId === user?.id;
    const verifica = tienePermiso(user, 'inspecciones.verificar');
    const editable = EDITABLES.includes(a.estado) && ((esAutor && tienePermiso(user, 'inspecciones.crear')) || verifica);
    const final = (ESTADOS_RESULTADO_5S as readonly string[]).includes(a.estado);
    return {
      puedeEditar: editable,
      puedeFinalizar: editable,
      puedeEliminar: EDITABLES.includes(a.estado) && tienePermiso(user, 'inspecciones.eliminar') && (esAutor || verifica),
      puedeCerrar: a.estado === 'FINALIZADA' && verifica,
      puedeSeguimiento: final && tienePermiso(user, 'inspecciones.acciones'),
      puedeVerificar: final && verifica,
    };
  }

  private incluirDetalle() {
    return {
      agencia: { select: { id: true, codigo: true, nombre: true } },
      auditor: { select: { id: true, name: true, lastname: true } },
      respuestas: true,
      acciones: { orderBy: { criterio: 'asc' } },
      historial: { orderBy: { createdAt: 'desc' } },
    } satisfies Prisma.Auditoria5sInclude;
  }

  private async cargar(id: string, user: any) {
    const a = await this.prisma.auditoria5s.findFirst({
      where: combinarWhere({ id }, this.whereVisible(user)) as Prisma.Auditoria5sWhereInput,
      include: this.incluirDetalle(),
    });
    if (!a) throw new NotFoundException('No existe la auditoría o está fuera de tu alcance.');
    return a;
  }

  // ───────────────────────── Listados ─────────────────────────

  async list(dto: ListAuditorias5sDto, user: any) {
    const filtros: Record<string, unknown> = {};
    if (dto.agenciaId) filtros.agenciaId = dto.agenciaId;
    if (dto.auditorId) filtros.auditorId = dto.auditorId;
    if (dto.area) filtros.area = dto.area;
    if (dto.formato) filtros.formato = dto.formato;
    if (dto.estado) filtros.estado = dto.estado;
    if (dto.semaforo) filtros.semaforo = dto.semaforo;
    if (dto.desde || dto.hasta) filtros.fecha = { ...(dto.desde ? { gte: fechaDia(dto.desde) } : {}), ...(dto.hasta ? { lte: fechaDia(dto.hasta) } : {}) };
    const where = combinarWhere(this.whereVisible(user), filtros, whereBusqueda(['codigo', 'agencia.nombre'], dto.search));

    return listarPaginable(dto, {
      where,
      columnas: columnasSimples({ codigo: 'codigo', agencia: 'agencia.nombre', fecha: 'fecha', auditor: 'auditor.name', area: 'area', formato: 'formato', puntaje: 'puntaje', porcentaje: 'porcentaje', semaforo: 'semaforo', estado: 'estado' }),
      ordenHeredado: [{ fecha: 'desc' }, { createdAt: 'desc' }],
      mapear: (items) => items.map((a) => this.aFila(a)),
      buscar: ({ where: w, orderBy, skip, take }) =>
        this.prisma.auditoria5s.findMany({
          where: w,
          orderBy,
          skip,
          take,
          include: {
            agencia: { select: { id: true, nombre: true } },
            auditor: { select: { id: true, name: true, lastname: true } },
            respuestas: { select: { criterio: true, puntaje: true } },
            acciones: { select: { estado: true } },
          },
        }),
      contar: (w) => this.prisma.auditoria5s.count({ where: w }),
    });
  }

  private aFila(a: any) {
    const formato = formatoDe(a.formato);
    const r = calcularResultado(formato, a.respuestas ?? []);
    const final = (ESTADOS_RESULTADO_5S as readonly string[]).includes(a.estado);
    return {
      id: a.id,
      codigo: a.codigo,
      formato: formato.id,
      formatoNombre: formato.nombre,
      grupoId: a.grupoId,
      agenciaId: a.agenciaId,
      agenciaNombre: a.agencia?.nombre ?? '',
      auditorId: a.auditorId,
      auditorNombre: nombreDe(a.auditor),
      area: a.area,
      areaNombre: nombreArea(a.area),
      fecha: dia(a.fecha),
      estado: a.estado,
      puntaje: final ? a.puntaje : r.puntaje,
      puntajeMaximo: r.puntajeMaximo,
      porcentaje: final ? a.porcentaje : r.porcentaje,
      /** En un borrador el semáforo es solo orientativo: el definitivo se fija al finalizar. */
      semaforo: final ? a.semaforo : r.evaluados ? r.semaforo : null,
      evaluados: r.evaluados,
      totalCriterios: r.total,
      accionesAbiertas: (a.acciones ?? []).filter((x: any) => (ESTADOS_ACCION_ABIERTA as readonly string[]).includes(x.estado)).length,
      accionesTotal: (a.acciones ?? []).length,
    };
  }

  async resumen(dto: ResumenAuditorias5sDto, user: any) {
    if (!this.cache) return this.calcularResumen(dto, user);
    return this.cache.obtenerOCalcular(`auditoria5s:resumen:${user?.id ?? 'anonimo'}:${huella(dto ?? {})}`, 60, () => this.calcularResumen(dto, user));
  }

  private async calcularResumen(dto: ResumenAuditorias5sDto, user: any) {
    const visible = combinarWhere(this.whereVisible(user), dto.formato ? { formato: dto.formato } : undefined) as Prisma.Auditoria5sWhereInput;
    const finalizadas = combinarWhere(visible, { estado: { in: [...ESTADOS_RESULTADO_5S] } }) as Prisma.Auditoria5sWhereInput;
    const hoy = hoyEcuador();
    const inicioMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    const accionesBase: Prisma.Auditoria5sAccionWhereInput = { auditoria: visible };
    const formatos: FormatoId[] = dto.formato ? [dto.formato as FormatoId] : [...FORMATOS_5S];

    const [total, delMes, realizadas, filas, abiertas, ...porFormato] = await Promise.all([
      this.prisma.auditoria5s.count({ where: visible }),
      this.prisma.auditoria5s.count({ where: combinarWhere(visible, { fecha: { gte: inicioMes } }) as Prisma.Auditoria5sWhereInput }),
      this.prisma.auditoria5s.count({ where: finalizadas }),
      this.prisma.auditoria5s.findMany({
        where: finalizadas,
        orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
        take: 1000,
        select: { agenciaId: true, area: true, formato: true, fecha: true, porcentaje: true, agencia: { select: { nombre: true } } },
      }),
      this.prisma.auditoria5sAccion.count({ where: { ...accionesBase, estado: { in: [...ESTADOS_ACCION_ABIERTA] } } }),
      // Los números de pregunta se repiten entre formatos: se agrupa por separado en cada uno.
      ...formatos.map((f) =>
        this.prisma.auditoria5sRespuesta.groupBy({
          by: ['criterio', 'puntaje'],
          where: { auditoria: combinarWhere(finalizadas, { formato: f }) as Prisma.Auditoria5sWhereInput, puntaje: { not: null } },
          _count: { _all: true },
        }),
      ),
    ]);

    const media = (valores: number[]) => (valores.length ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10 : null);

    // Cada agencia se mide por su última auditoría de cada área y formato.
    const ultima = new Map<string, (typeof filas)[number]>();
    for (const f of filas) {
      const k = `${f.agenciaId}|${f.area}|${f.formato}`;
      if (!ultima.has(k)) ultima.set(k, f);
    }
    const porAgenciaMap = new Map<string, { nombre: string; valores: number[] }>();
    for (const f of ultima.values()) {
      const e = porAgenciaMap.get(f.agenciaId) ?? { nombre: f.agencia.nombre, valores: [] };
      e.valores.push(f.porcentaje ?? 0);
      porAgenciaMap.set(f.agenciaId, e);
    }
    const porAgencia = [...porAgenciaMap.entries()]
      .map(([agenciaId, e]) => {
        const porcentaje = media(e.valores) ?? 0;
        return { agenciaId, agenciaNombre: e.nombre, porcentaje, semaforo: semaforoDe(porcentaje) };
      })
      .sort((a, b) => b.porcentaje - a.porcentaje);

    const porPeriodo = new Map<string, number[]>();
    for (const f of filas) {
      const p = dia(f.fecha)!.slice(0, 7);
      porPeriodo.set(p, [...(porPeriodo.get(p) ?? []), f.porcentaje ?? 0]);
    }
    const evolucion = [...porPeriodo.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([periodo, v]) => ({ periodo, auditorias: v.length, promedio: media(v) }));

    // Promedio de cumplimiento por cada S (en %, comparable entre formatos).
    const suma = new Map<string, { ratio: number; n: number }>();
    formatos.forEach((id, k) => {
      const f = FORMATOS[id];
      for (const g of porFormato[k]) {
        const crit = f.criterios.find((c) => c.numero === g.criterio);
        const ef = puntajeEfectivo(f, g.criterio, g.puntaje);
        if (!crit || ef === null) continue;
        const e = suma.get(crit.categoria) ?? { ratio: 0, n: 0 };
        e.ratio += (ef / f.maxCriterio) * g._count._all;
        e.n += g._count._all;
        suma.set(crit.categoria, e);
      }
    });
    const porS = FORMATOS.SI_NO_50.categorias.map((cat) => {
      const e = suma.get(cat.id);
      return { categoria: cat.id, nombre: cat.nombre, traduccion: cat.traduccion, porcentaje: e && e.n ? Math.round((e.ratio / e.n) * 1000) / 10 : 0 };
    });

    return {
      total,
      realizadas,
      delMes,
      promedioGeneral: media(filas.map((f) => f.porcentaje ?? 0)),
      agenciasVerde: porAgencia.filter((a) => a.semaforo === 'VERDE').length,
      agenciasAmarillo: porAgencia.filter((a) => a.semaforo === 'AMARILLO').length,
      agenciasRojo: porAgencia.filter((a) => a.semaforo === 'ROJO').length,
      accionesPendientes: abiertas,
      porAgencia: porAgencia.slice(0, 12),
      evolucion,
      porS,
    };
  }

  /** Agencias del alcance y auditores que hicieron auditorías dentro de él. */
  async opciones(user: any) {
    const agencias = await agenciasConLider(this.prisma, await this.prisma.agencia.findMany({
      where: { estado: 1, ...whereAgencias(resolverAlcance(user)) } as Prisma.AgenciaWhereInput,
      select: { id: true, codigo: true, nombre: true },
      orderBy: { nombre: 'asc' },
    }));
    const filas = await this.prisma.auditoria5s.findMany({
      where: this.whereVisible(user) as Prisma.Auditoria5sWhereInput,
      distinct: ['auditorId'],
      select: { auditor: { select: { id: true, name: true, lastname: true } } },
    });
    const auditores = filas.map((f) => ({ id: f.auditor.id, nombre: nombreDe(f.auditor) })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    return { agencias, auditores };
  }

  // ───────────────────────── Detalle ─────────────────────────

  async detail(id: string, user: any) {
    const a = await this.cargar(id, user);
    const visible = this.whereVisible(user);
    const [hermanas, anterior] = await Promise.all([
      a.grupoId
        ? this.prisma.auditoria5s.findMany({
            where: combinarWhere(visible, { grupoId: a.grupoId }) as Prisma.Auditoria5sWhereInput,
            orderBy: { codigo: 'asc' },
            select: { id: true, codigo: true, formato: true, estado: true },
          })
        : Promise.resolve([{ id: a.id, codigo: a.codigo, formato: a.formato, estado: a.estado }]),
      // La anterior del mismo formato, agencia y área (para la comparación del formato de 25 criterios y el historial).
      this.prisma.auditoria5s.findFirst({
        where: combinarWhere(visible, {
          agenciaId: a.agenciaId,
          area: a.area,
          formato: a.formato,
          estado: { in: [...ESTADOS_RESULTADO_5S] },
          id: { not: a.id },
          OR: [{ fecha: { lt: a.fecha } }, { fecha: a.fecha, createdAt: { lt: a.createdAt } }],
        }) as Prisma.Auditoria5sWhereInput,
        orderBy: [{ fecha: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, codigo: true, fecha: true, puntaje: true, porcentaje: true, semaforo: true },
      }),
    ]);
    return this.aDetalle(a, user, hermanas, anterior);
  }

  private aDetalle(a: any, user: any, hermanas: { id: string; codigo: string; formato: string; estado: string }[], anterior: any) {
    const hoy = hoyEcuador();
    const formato = formatoDe(a.formato);
    const resultado = calcularResultado(formato, a.respuestas);
    const final = (ESTADOS_RESULTADO_5S as readonly string[]).includes(a.estado);
    const accionPorCriterio = new Map<number, any>(a.acciones.map((x: any) => [x.criterio, x]));
    const resultadoFinal = final ? { ...resultado, puntaje: a.puntaje ?? resultado.puntaje, porcentaje: a.porcentaje ?? resultado.porcentaje, semaforo: a.semaforo ?? resultado.semaforo } : resultado;
    return {
      id: a.id,
      codigo: a.codigo,
      estado: a.estado,
      formato: formato.id,
      formatoNombre: formato.nombre,
      grupoId: a.grupoId,
      hermanas: hermanas.map((h) => ({ ...h, formatoNombre: formatoDe(h.formato).nombre })),
      agencia: a.agencia,
      auditorId: a.auditorId,
      auditorNombre: nombreDe(a.auditor),
      responsableAgencia: a.responsableAgencia,
      equipoPersona: a.equipoPersona,
      area: a.area,
      areaNombre: nombreArea(a.area),
      fecha: dia(a.fecha),
      comentarios: a.comentarios,
      comentariosCategoria: (a.comentariosCategoria ?? {}) as Record<string, string>,
      finalizadaEn: a.finalizadaEn?.toISOString() ?? null,
      cerradaEn: a.cerradaEn?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      // Finalizada: lo fijado al finalizar. Antes: el cálculo del momento (orientativo hasta tener todos los criterios).
      resultado: resultadoFinal,
      /** Puntuación de la auditoría anterior del mismo formato, agencia y área, y la diferencia (+/−). */
      anterior: anterior
        ? { id: anterior.id, codigo: anterior.codigo, fecha: dia(anterior.fecha), puntaje: anterior.puntaje, porcentaje: anterior.porcentaje, semaforo: anterior.semaforo, diferencia: variacion(resultadoFinal.puntaje, anterior.puntaje) }
        : null,
      criterios: formato.criterios.map((c) => {
        const r = a.respuestas.find((x: any) => x.criterio === c.numero);
        const accion = accionPorCriterio.get(c.numero);
        const efectivo = puntajeEfectivo(formato, c.numero, r?.puntaje ?? null);
        return {
          numero: c.numero,
          categoria: c.categoria,
          descripcion: c.descripcion,
          favorable: c.favorable ?? null,
          puntajeMaximo: formato.maxCriterio,
          /** Lo guardado: el puntaje; en SI/NO, 1 = SI y 0 = NO. */
          puntaje: r?.puntaje ?? null,
          /** Lo que vale para el cálculo (en SI/NO, 1 si la respuesta es la favorable). */
          puntajeEfectivo: efectivo,
          cumple: efectivo === null ? null : efectivo >= formato.maxCriterio,
          hallazgo: r?.hallazgo ?? '',
          observaciones: r?.observaciones ?? '',
          accionCorrectiva: r?.accionCorrectiva ?? '',
          responsable: r?.responsable ?? '',
          fechaCompromiso: dia(r?.fechaCompromiso),
          fotos: r?.fotos ?? [],
          /** Estado del hallazgo: el de su acción correctiva, si la tiene. */
          estadoAccion: accion ? estadoAccionEfectivo(accion, hoy) : null,
        };
      }),
      acciones: a.acciones.map((x: any) => this.aAccion(x, hoy, formato)),
      historial: a.historial.map((h: any) => ({
        id: h.id,
        accion: h.accion,
        estadoAnterior: h.estadoAnterior,
        estadoNuevo: h.estadoNuevo,
        usuarioNombre: h.usuarioNombre,
        rol: h.rol,
        detalle: h.detalle,
        createdAt: h.createdAt.toISOString(),
      })),
      permisos: this.permisosSobre(a, user),
    };
  }

  private aAccion(x: any, hoy: Date, formato: Formato5s) {
    const c = formato.criterios.find((k) => k.numero === x.criterio);
    return {
      id: x.id,
      codigo: x.codigo,
      auditoriaId: x.auditoriaId,
      criterio: x.criterio,
      categoria: c?.categoria ?? null,
      criterioDescripcion: c?.descripcion ?? '',
      hallazgo: x.hallazgo,
      accion: x.accion,
      responsable: x.responsable,
      fechaCompromiso: dia(x.fechaCompromiso),
      prioridad: x.prioridad,
      estado: x.estado,
      estadoEfectivo: estadoAccionEfectivo(x, hoy),
      evidenciaInicial: x.evidenciaInicial ?? [],
      evidenciaCorreccion: x.evidenciaCorreccion ?? [],
      observaciones: x.observaciones,
      cerradaEn: x.cerradaEn?.toISOString() ?? null,
      verificadaPorNombre: x.verificadaPorNombre,
    };
  }

  // ───────────────────────── Crear, guardar y finalizar ─────────────────────────

  /**
   * Crea una auditoría por cada formato elegido para la visita. Todas comparten los datos de la visita (agencia, área, fecha,
   * responsable…) y un mismo `grupoId`, pero se guardan, puntúan y finalizan por separado. Devuelve la primera.
   */
  async create(dto: GuardarAuditoria5sDto, user: any) {
    const agencia = await this.agenciaEnAlcance(dto.agenciaId, user);
    const formatos = [...new Set((dto.formatos?.length ? dto.formatos : ['LISTA_20']) as FormatoId[])];
    const fecha = texto(dto.fecha) || hoyEcuador().toISOString().slice(0, 10);
    const grupoId = randomUUID();
    const ids: string[] = [];
    for (const formatoId of formatos) {
      ids.push(await this.crearUna(dto, user, agencia, formatoDe(formatoId), fecha, grupoId, formatos.length === 1));
    }
    return this.detail(ids[0], user);
  }

  private async crearUna(dto: GuardarAuditoria5sDto, user: any, agencia: { id: string; nombre: string }, formato: Formato5s, fecha: string, grupoId: string, conRespuestas: boolean): Promise<string> {
    for (let intento = 0; intento < 5; intento++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const codigo = await this.siguienteCodigo(tx, Number(fecha.slice(0, 4)));
          const a = await tx.auditoria5s.create({
            data: {
              codigo,
              agenciaId: agencia.id,
              auditorId: user.id,
              area: dto.area ?? AREA_GENERAL,
              formato: formato.id,
              grupoId,
              fecha: fechaDia(fecha)!,
              responsableAgencia: texto(dto.responsableAgencia),
              equipoPersona: texto(dto.equipoPersona),
              comentarios: texto(dto.comentarios),
              comentariosCategoria: limpiarComentarios(dto.comentariosCategoria),
            },
          });
          const evaluadas = conRespuestas ? await this.guardarRespuestas(tx, a.id, formato, dto.respuestas) : 0;
          if (evaluadas) await tx.auditoria5s.update({ where: { id: a.id }, data: { estado: 'EN_PROCESO' } });
          await this.registrar(tx, a.id, user, 'CREADA', null, evaluadas ? 'EN_PROCESO' : 'BORRADOR', `Auditoría ${codigo} · ${formato.nombre} (${nombreArea(dto.area ?? AREA_GENERAL)}) en ${agencia.nombre}.`);
          return a.id;
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && intento < 4) continue; // otro código ganó el número
        throw e;
      }
    }
    throw new ConflictException('No se pudo asignar el código de la auditoría. Inténtalo de nuevo.');
  }

  async update(dto: GuardarAuditoria5sDto, user: any) {
    if (!dto.id) throw new BadRequestException('Falta la auditoría a guardar.');
    const actual = await this.cargar(dto.id, user);
    if (!this.permisosSobre(actual, user).puedeEditar) {
      throw new ForbiddenException(EDITABLES.includes(actual.estado) ? 'Solo quien hizo la auditoría puede editarla.' : 'La auditoría ya está finalizada: sus puntuaciones no se pueden modificar.');
    }
    const formato = formatoDe(actual.formato);
    const agenciaId = dto.agenciaId === actual.agenciaId ? actual.agenciaId : (await this.agenciaEnAlcance(dto.agenciaId, user)).id;
    await this.prisma.$transaction(async (tx) => {
      const datosVisita = {
        agenciaId,
        ...(dto.area ? { area: dto.area } : {}),
        ...(dto.fecha ? { fecha: fechaDia(dto.fecha)! } : {}),
        ...(dto.responsableAgencia !== undefined ? { responsableAgencia: texto(dto.responsableAgencia) } : {}),
        ...(dto.equipoPersona !== undefined ? { equipoPersona: texto(dto.equipoPersona) } : {}),
      };
      await tx.auditoria5s.update({
        where: { id: actual.id },
        data: {
          ...datosVisita,
          ...(dto.comentarios !== undefined ? { comentarios: texto(dto.comentarios) } : {}),
          ...(dto.comentariosCategoria !== undefined ? { comentariosCategoria: limpiarComentarios(dto.comentariosCategoria) } : {}),
        },
      });
      // Los datos de la visita son los mismos para todos los formatos de esa visita: los que aún se pueden editar los siguen.
      if (actual.grupoId) {
        await tx.auditoria5s.updateMany({ where: { grupoId: actual.grupoId, id: { not: actual.id }, estado: { in: EDITABLES }, deletedAt: null }, data: datosVisita });
      }
      await this.guardarRespuestas(tx, actual.id, formato, dto.respuestas);
      const hay = await tx.auditoria5sRespuesta.count({ where: { auditoriaId: actual.id, puntaje: { not: null } } });
      const estado = hay ? 'EN_PROCESO' : 'BORRADOR';
      if (estado !== actual.estado) await tx.auditoria5s.update({ where: { id: actual.id }, data: { estado } });
    });
    return this.detail(actual.id, user);
  }

  /** Guarda (o actualiza) solo los criterios enviados, validándolos contra el catálogo del formato. Devuelve cuántos tienen puntaje. */
  private async guardarRespuestas(tx: Tx, auditoriaId: string, formato: Formato5s, respuestas: RespuestaDto[] | undefined): Promise<number> {
    let evaluadas = 0;
    for (const r of respuestas ?? []) {
      if (!esCriterioValido(formato, r.criterio)) throw new BadRequestException(`El criterio ${r.criterio} no existe en este formato (1 a ${formato.criterios.length}).`);
      const puntaje = typeof r.puntaje === 'number' ? r.puntaje : null;
      if (puntaje !== null && !esPuntajeValido(formato, puntaje)) {
        throw new BadRequestException(formato.tipo === 'SI_NO' ? `El criterio ${r.criterio} se responde con SI o NO.` : `El puntaje del criterio ${r.criterio} debe ir de 0 a ${formato.maxCriterio}.`);
      }
      if (puntaje !== null) evaluadas++;
      const data = {
        puntaje,
        hallazgo: texto(r.hallazgo),
        observaciones: texto(r.observaciones),
        accionCorrectiva: texto(r.accionCorrectiva),
        fotos: lista(r.fotos),
      };
      await tx.auditoria5sRespuesta.upsert({
        where: { auditoriaId_criterio: { auditoriaId, criterio: r.criterio } },
        create: { auditoriaId, criterio: r.criterio, ...data },
        update: data,
      });
    }
    return evaluadas;
  }

  /**
   * Finaliza la auditoría: exige todos los criterios evaluados, fija puntaje, porcentaje y semáforo (siempre calculados aquí, nunca
   * por el cliente) y abre una acción correctiva por cada criterio que no cumple y tenga hallazgo o acción registrada.
   */
  async finalizar(id: string, user: any) {
    const a = await this.cargar(id, user);
    if (!this.permisosSobre(a, user).puedeFinalizar) {
      throw new ForbiddenException(EDITABLES.includes(a.estado) ? 'Solo quien hizo la auditoría puede finalizarla.' : 'La auditoría ya está finalizada.');
    }
    const formato = formatoDe(a.formato);
    const faltan = criteriosSinEvaluar(formato, a.respuestas);
    if (faltan.length) throw new BadRequestException(`No se puede finalizar: faltan por evaluar ${faltan.length} criterio(s) (${faltan.join(', ')}).`);
    const r = calcularResultado(formato, a.respuestas);

    await this.prisma.$transaction(async (tx) => {
      const cambio = await tx.auditoria5s.updateMany({
        where: { id: a.id, estado: { in: EDITABLES } },
        data: { estado: 'FINALIZADA', puntaje: r.puntaje, porcentaje: r.porcentaje, semaforo: r.semaforo, finalizadaEn: new Date() },
      });
      if (cambio.count === 0) throw new ConflictException('La auditoría cambió mientras la finalizabas. Actualiza e inténtalo de nuevo.');
      let abiertas = 0;
      for (const resp of a.respuestas) {
        const efectivo = puntajeEfectivo(formato, resp.criterio, resp.puntaje);
        if (efectivo === null || efectivo >= formato.maxCriterio) continue;
        if (!resp.hallazgo.trim() && !resp.accionCorrectiva.trim()) continue;
        abiertas++;
        await tx.auditoria5sAccion.create({
          data: {
            codigo: codigoAccion(a.codigo, resp.criterio),
            auditoriaId: a.id,
            agenciaId: a.agenciaId,
            criterio: resp.criterio,
            hallazgo: resp.hallazgo,
            accion: resp.accionCorrectiva,
            // El responsable es la agencia auditada y la fecha es la del día en que se abre la acción.
            responsable: a.agencia?.nombre ?? '',
            fechaCompromiso: hoyEcuador(),
            prioridad: prioridadDePuntaje(formato, efectivo),
            evidenciaInicial: resp.fotos,
          },
        });
      }
      await this.registrar(tx, a.id, user, 'FINALIZADA', a.estado, 'FINALIZADA', `Puntaje ${r.puntaje}/${r.puntajeMaximo} (${r.porcentaje} %): ${r.semaforo}. ${abiertas} acción(es) correctiva(s) abierta(s).`);
    });
    return this.detail(id, user);
  }

  async cerrar(id: string, user: any) {
    const a = await this.cargar(id, user);
    if (!this.permisosSobre(a, user).puedeCerrar) throw new ForbiddenException('Solo una auditoría finalizada la cierra quien verifica.');
    const abiertas = a.acciones.filter((x) => (ESTADOS_ACCION_ABIERTA as readonly string[]).includes(x.estado)).length;
    if (abiertas) throw new ConflictException(`No se puede cerrar: quedan ${abiertas} acción(es) correctiva(s) sin cerrar.`);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.auditoria5s.updateMany({ where: { id, estado: 'FINALIZADA' }, data: { estado: 'CERRADA', cerradaEn: new Date() } });
      if (r.count === 0) throw new ConflictException('La auditoría cambió mientras la cerrabas. Actualiza e inténtalo de nuevo.');
      await this.registrar(tx, id, user, 'CERRADA', 'FINALIZADA', 'CERRADA', 'Auditoría cerrada: todas las acciones correctivas están verificadas.');
    });
    return this.detail(id, user);
  }

  async eliminar(id: string, user: any) {
    const a = await this.cargar(id, user);
    if (!this.permisosSobre(a, user).puedeEliminar) throw new ForbiddenException('Solo se puede eliminar una auditoría sin finalizar, y solo con permiso para ello.');
    await this.prisma.$transaction(async (tx) => {
      await tx.auditoria5s.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.registrar(tx, id, user, 'ELIMINADA', a.estado, null, `Auditoría ${a.codigo} eliminada.`);
    });
    return { success: true };
  }

  // ───────────────────────── Acciones correctivas ─────────────────────────

  async listAcciones(dto: ListAccionesDto, user: any) {
    const hoy = hoyEcuador();
    const filtros: Prisma.Auditoria5sAccionWhereInput = {
      auditoria: this.whereVisible(user) as Prisma.Auditoria5sWhereInput,
      ...(dto.agenciaId ? { agenciaId: dto.agenciaId } : {}),
      ...(dto.auditoriaId ? { auditoriaId: dto.auditoriaId } : {}),
    };
    if (dto.estado === 'ABIERTAS') filtros.estado = { in: [...ESTADOS_ACCION_ABIERTA] };
    else if (dto.estado) filtros.estado = dto.estado;

    const { page, pageSize, skip, take } = paginacionListado(dto);
    const [items, total] = await Promise.all([
      this.prisma.auditoria5sAccion.findMany({
        where: filtros,
        orderBy: [{ fechaCompromiso: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        skip,
        take,
        include: { auditoria: { select: { codigo: true, area: true, formato: true } }, agencia: { select: { nombre: true } } },
      }),
      this.prisma.auditoria5sAccion.count({ where: filtros }),
    ]);
    return buildDataGridResponse(
      items.map((x) => ({
        ...this.aAccion(x, hoy, formatoDe(x.auditoria.formato)),
        auditoriaCodigo: x.auditoria.codigo,
        formato: x.auditoria.formato,
        area: x.auditoria.area,
        areaNombre: nombreArea(x.auditoria.area),
        agenciaNombre: x.agencia.nombre,
      })),
      total,
      page,
      pageSize,
    );
  }

  private async cargarAccion(id: string, user: any) {
    const x = await this.prisma.auditoria5sAccion.findFirst({
      where: { id, auditoria: this.whereVisible(user) as Prisma.Auditoria5sWhereInput },
      include: { auditoria: { select: { id: true, estado: true, auditorId: true } } },
    });
    if (!x) throw new NotFoundException('No existe la acción correctiva o está fuera de tu alcance.');
    return x;
  }

  /** Seguimiento de la acción: no toca el puntaje de la auditoría. Quien lo da no la cierra: la manda a verificación. */
  async seguimientoAccion(dto: SeguimientoAccionDto, user: any) {
    const x = await this.cargarAccion(dto.id, user);
    if (!this.permisosSobre(x.auditoria, user).puedeSeguimiento) throw new ForbiddenException('El seguimiento se registra cuando la auditoría ya está finalizada.');
    if (x.estado === 'CERRADA') throw new ConflictException('La acción ya está cerrada.');
    if (dto.estado !== x.estado && !(TRANSICIONES_ACCION[x.estado] ?? []).includes(dto.estado)) {
      throw new ConflictException(`Una acción ${x.estado} no puede pasar a ${dto.estado}.`);
    }
    const evidencia = dto.evidenciaCorreccion ? lista(dto.evidenciaCorreccion) : x.evidenciaCorreccion;
    const observaciones = dto.observaciones !== undefined ? texto(dto.observaciones) : x.observaciones;
    if (dto.estado === 'EN_VERIFICACION' && !evidencia.length && !observaciones) {
      throw new BadRequestException('Para enviarla a verificación adjunta la evidencia de la corrección o describe lo que se hizo.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.auditoria5sAccion.update({ where: { id: x.id }, data: { estado: dto.estado, evidenciaCorreccion: evidencia, observaciones } });
      if (dto.estado !== x.estado) await this.registrar(tx, x.auditoriaId, user, 'ACCION_SEGUIMIENTO', null, null, `${x.codigo}: ${x.estado} → ${dto.estado}.`);
    });
    return this.detail(x.auditoriaId, user);
  }

  /** Una acción solo se cierra después de verificarla. */
  async verificarAccion(dto: VerificarAccionDto, user: any) {
    const x = await this.cargarAccion(dto.id, user);
    if (!this.permisosSobre(x.auditoria, user).puedeVerificar) throw new ForbiddenException('Tu rol no puede verificar acciones correctivas.');
    if (x.estado !== 'EN_VERIFICACION') throw new ConflictException('Solo se verifica una acción que está en verificación.');
    const motivo = texto(dto.motivo);
    if (dto.decision === 'DEVOLVER' && !motivo) throw new BadRequestException('Indica por qué se devuelve la acción.');
    await this.prisma.$transaction(async (tx) => {
      if (dto.decision === 'CERRAR') {
        await tx.auditoria5sAccion.update({
          where: { id: x.id },
          data: { estado: 'CERRADA', cerradaEn: new Date(), verificadaPorId: user.id, verificadaPorNombre: nombreActor(user) },
        });
        await this.registrar(tx, x.auditoriaId, user, 'ACCION_VERIFICADA', null, null, `${x.codigo}: corrección verificada y cerrada.`);
      } else {
        await tx.auditoria5sAccion.update({ where: { id: x.id }, data: { estado: 'EN_PROCESO', observaciones: [x.observaciones, `Devuelta: ${motivo}`].filter(Boolean).join('\n') } });
        await this.registrar(tx, x.auditoriaId, user, 'ACCION_SEGUIMIENTO', null, null, `${x.codigo}: devuelta a proceso. ${motivo}`);
      }
    });
    return this.detail(x.auditoriaId, user);
  }

  // ───────────────────────── Comparación histórica ─────────────────────────

  /** Auditorías finalizadas de una agencia, área y formato, de la más antigua a la más reciente, con la variación respecto a la anterior. */
  async comparar(dto: CompararDto, user: any) {
    const formato = formatoDe(dto.formato);
    const historia = await this.prisma.auditoria5s.findMany({
      where: combinarWhere(this.whereVisible(user), { agenciaId: dto.agenciaId, ...(dto.area ? { area: dto.area } : {}), formato: formato.id, estado: { in: [...ESTADOS_RESULTADO_5S] } }) as Prisma.Auditoria5sWhereInput,
      orderBy: [{ fecha: 'asc' }, { createdAt: 'asc' }],
      include: { respuestas: { select: { criterio: true, puntaje: true } }, acciones: { select: { estado: true } }, auditor: { select: { name: true, lastname: true } } },
    });
    let anterior: number | null = null;
    return historia.map((a) => {
      const r = calcularResultado(formato, a.respuestas);
      const puntaje = a.puntaje ?? r.puntaje;
      const fila = {
        id: a.id,
        codigo: a.codigo,
        fecha: dia(a.fecha),
        auditorNombre: nombreDe(a.auditor),
        puntaje,
        puntajeMaximo: r.puntajeMaximo,
        porcentaje: a.porcentaje ?? r.porcentaje,
        semaforo: a.semaforo ?? r.semaforo,
        variacion: variacion(puntaje, anterior),
        porCategoria: r.porCategoria.map((c) => ({ categoria: c.categoria, nombre: c.nombre, puntaje: c.puntaje, maximo: c.maximo })),
        accionesAbiertas: a.acciones.filter((x) => (ESTADOS_ACCION_ABIERTA as readonly string[]).includes(x.estado)).length,
        accionesCerradas: a.acciones.filter((x) => x.estado === 'CERRADA').length,
      };
      anterior = puntaje;
      return fila;
    });
  }

  // ───────────────────────── Apoyo ─────────────────────────

  private async agenciaEnAlcance(agenciaId: string, user: any) {
    const agencia = await this.prisma.agencia.findFirst({
      where: { AND: [{ id: agenciaId, estado: 1 }, whereAgencias(resolverAlcance(user))] } as Prisma.AgenciaWhereInput,
      select: { id: true, nombre: true },
    });
    if (!agencia) throw new ForbiddenException('La agencia no existe, está inactiva o está fuera de tu alcance.');
    return agencia;
  }

  private async siguienteCodigo(tx: Tx, anio: number): Promise<string> {
    const ultimo = await tx.auditoria5s.findFirst({ where: { codigo: { startsWith: `A5S-${anio}-` } }, orderBy: { codigo: 'desc' }, select: { codigo: true } });
    return formatearCodigo(anio, correlativoDeCodigo(ultimo?.codigo) + 1);
  }

  private async registrar(tx: Tx, auditoriaId: string, user: any, accion: string, anterior: string | null, nuevo: string | null, detalle?: string) {
    await tx.auditoria5sHistorial.create({
      data: { auditoriaId, accion, estadoAnterior: anterior, estadoNuevo: nuevo, usuarioId: String(user.id), usuarioNombre: nombreActor(user), rol: rolDeUsuario(user), detalle: detalle ?? null },
    });
  }
}
