import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { resolverAlcance } from '../../common/permisos/alcance.js';
import { FUNCION, rolConFuncion } from '../../common/permisos/funciones.js';
import type { EditarAjusteDto, EditarHorarioDto } from './dto/rrhh.dto.js';
import { diaComoFecha, fechaEnEcuador, personaEnAlcance, whereUsuariosEnAlcance } from './rrhh.reglas.js';
import {
  AJUSTE_POR_DEFECTO,
  HORARIO_POR_DEFECTO,
  aMinutos,
  evaluarDia,
  indiceDiaSemana,
  sumarDias,
  validarAjuste,
  validarSemana,
  versionVigente,
  ventanasDe,
  type AjusteHorario,
  type DiaHorario,
  type EvaluacionDia,
  type SemanaHorario,
} from './rrhh.horarios.js';

const dia = (d: Date) => d.toISOString().slice(0, 10);
const nombreDe = (u: { name?: string | null; lastname?: string | null } | null | undefined) => `${u?.name ?? ''} ${u?.lastname ?? ''}`.trim();

interface VersionHorario { id: string; userId: string; vigenteDesde: Date; dias: unknown; motivo: string; actorId: string; createdAt: Date }
interface VersionAjuste { id: string; vigenteDesde: Date; toleranciaMin: number; ventanaMin: number; motivo: string; actorId: string; createdAt: Date }
export interface MarcaDia { userId: string; tipo: string; fechaDia: Date; marcadaEn: Date }
export type FilaEvaluacion = EvaluacionDia & { userId: string; dia: string };

const semanaDe = (v: { dias: unknown } | null | undefined): SemanaHorario => (v && Array.isArray(v.dias) ? (v.dias as SemanaHorario) : HORARIO_POR_DEFECTO);
const ajusteDe = (v: VersionAjuste | null): AjusteHorario | null => (v ? { toleranciaMin: v.toleranciaMin, ventanaMin: v.ventanaMin } : null);

/**
 * Horarios del personal y ajuste general de timbradas. Todo cambio crea una versión nueva que rige desde mañana (nunca desde hoy ni hacia
 * atrás), con motivo y quién lo hizo; los días pasados se evalúan siempre con la versión que regía ese día. Solo ADMIN y SUPER_ADMIN editan.
 */
@Injectable()
export class HorariosService {
  private readonly logger = new Logger(HorariosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private hoy(ahora = new Date()) {
    const f = fechaEnEcuador(ahora);
    return { dia: f.dia, minuto: f.hora * 60 + f.minuto };
  }

  // ───────────────────────── Lo que rige un día ─────────────────────────

  /** Horario del día y ajuste vigente para una persona: lo que necesita la timbrada. */
  async contextoDe(userId: string, diaStr: string): Promise<{ dia: DiaHorario; ajuste: AjusteHorario }> {
    const [versiones, ajustes] = await Promise.all([
      this.prisma.horarioPersona.findMany({ where: { userId, vigenteDesde: { lte: diaComoFecha(diaStr) } } }),
      this.prisma.ajusteHorario.findMany({ where: { vigenteDesde: { lte: diaComoFecha(diaStr) } } }),
    ]);
    const semana = semanaDe(versionVigente(versiones, diaStr));
    return { dia: semana[indiceDiaSemana(diaStr)], ajuste: ajusteDe(versionVigente(ajustes, diaStr)) ?? AJUSTE_POR_DEFECTO };
  }

  /** Lo que la pantalla de timbrar muestra: el horario de hoy, las ventanas y el ajuste. */
  async resumenHoy(userId: string, ahora = new Date()) {
    const h = this.hoy(ahora);
    const { dia: d, ajuste } = await this.contextoDe(userId, h.dia);
    return { dia: h.dia, horario: d, ajuste, ventanas: d.trabaja ? ventanasDe(d, ajuste) : null };
  }

  // ───────────────────────── Evaluación ─────────────────────────

  /**
   * Evalúa cada día del rango (hasta hoy) de cada persona con el horario y el ajuste que regían ese día. Si no se pasan las marcas, las busca.
   * Los días anteriores a que existan ajustes, o a que la persona existiera, quedan «sin horario».
   */
  async evaluar(personas: Array<{ id: string; createdAt: Date }>, desde: Date, hasta: Date, marcas?: MarcaDia[], ahora = new Date()): Promise<FilaEvaluacion[]> {
    if (!personas.length) return [];
    const h = this.hoy(ahora);
    const ultimo = dia(hasta) > h.dia ? h.dia : dia(hasta);
    const primero = dia(desde);
    if (primero > ultimo) return [];
    const ids = personas.map((p) => p.id);
    const [versiones, ajustes, marcasDb] = await Promise.all([
      this.prisma.horarioPersona.findMany({ where: { userId: { in: ids }, vigenteDesde: { lte: diaComoFecha(ultimo) } } }),
      this.prisma.ajusteHorario.findMany({ where: { vigenteDesde: { lte: diaComoFecha(ultimo) } } }),
      marcas ? Promise.resolve(marcas) : this.prisma.timbrada.findMany({ where: { userId: { in: ids }, fechaDia: { gte: diaComoFecha(primero), lte: diaComoFecha(ultimo) } }, select: { userId: true, tipo: true, fechaDia: true, marcadaEn: true } }),
    ]);

    const versionesPorPersona = new Map<string, VersionHorario[]>();
    for (const v of versiones as VersionHorario[]) versionesPorPersona.set(v.userId, [...(versionesPorPersona.get(v.userId) ?? []), v]);
    const minutoDeMarca = new Map<string, number>(); // userId|dia|tipo → minuto del día
    for (const m of marcasDb) {
      const f = fechaEnEcuador(m.marcadaEn);
      minutoDeMarca.set(`${m.userId}|${dia(m.fechaDia)}|${m.tipo}`, f.hora * 60 + f.minuto);
    }

    const filas: FilaEvaluacion[] = [];
    for (const p of personas) {
      const creada = fechaEnEcuador(p.createdAt).dia;
      const propias = versionesPorPersona.get(p.id) ?? [];
      for (let d = primero; d <= ultimo; d = sumarDias(d, 1)) {
        const ajuste = ajusteDe(versionVigente(ajustes as VersionAjuste[], d));
        const semana = semanaDe(versionVigente(propias, d));
        const aplica = ajuste && d >= creada;
        filas.push({
          userId: p.id,
          dia: d,
          ...evaluarDia({
            dia: aplica ? semana[indiceDiaSemana(d)] : null,
            ajuste: aplica ? ajuste : null,
            entradaMin: minutoDeMarca.get(`${p.id}|${d}|ENTRADA`) ?? null,
            salidaMin: minutoDeMarca.get(`${p.id}|${d}|SALIDA`) ?? null,
            ahoraMin: d === h.dia ? h.minuto : null,
          }),
        });
      }
    }
    return filas;
  }

  // ───────────────────────── Consultas ─────────────────────────

  /** Horario vigente hoy y el cambio programado (si lo hay) de una persona. */
  private async vista(userId: string) {
    const h = this.hoy();
    const versiones = (await this.prisma.horarioPersona.findMany({ where: { userId }, orderBy: [{ vigenteDesde: 'desc' }, { createdAt: 'desc' }] })) as VersionHorario[];
    const vigente = versionVigente(versiones, h.dia);
    const futuras = versiones.filter((v) => dia(v.vigenteDesde) > h.dia);
    const proxima = versionVigente(futuras, '9999-12-31');
    return {
      semana: semanaDe(vigente),
      vigenteDesde: vigente ? dia(vigente.vigenteDesde) : null,
      porDefecto: !vigente,
      proximoCambio: proxima ? { vigenteDesde: dia(proxima.vigenteDesde), semana: semanaDe(proxima) } : null,
    };
  }

  async ajusteVista() {
    const h = this.hoy();
    const ajustes = (await this.prisma.ajusteHorario.findMany({ orderBy: [{ vigenteDesde: 'desc' }, { createdAt: 'desc' }] })) as VersionAjuste[];
    const vigente = ajusteDe(versionVigente(ajustes, h.dia)) ?? AJUSTE_POR_DEFECTO;
    const futura = versionVigente(ajustes.filter((a) => dia(a.vigenteDesde) > h.dia), '9999-12-31');
    return { ...vigente, proximoCambio: futura ? { vigenteDesde: dia(futura.vigenteDesde), toleranciaMin: futura.toleranciaMin, ventanaMin: futura.ventanaMin } : null };
  }

  async mio(user: any) {
    return { ...(await this.vista(String(user.id))), ajuste: await this.ajusteVista() };
  }

  /** Personas de mi alcance que timbran, con su horario vigente y el cambio programado. */
  async equipo(user: any) {
    const alcance = resolverAlcance(user);
    const personas = await this.prisma.user.findMany({
      where: { ...(whereUsuariosEnAlcance(alcance) as object), estado: 1, role: { capacidades: { has: 'rrhh.timbrar' } } },
      select: { id: true, name: true, lastname: true, createdAt: true, role: { select: { namerol: true } } },
      orderBy: [{ name: 'asc' }, { lastname: 'asc' }],
    });
    const h = this.hoy();
    const versiones = (await this.prisma.horarioPersona.findMany({ where: { userId: { in: personas.map((p) => p.id) } } })) as VersionHorario[];
    const porPersona = new Map<string, VersionHorario[]>();
    for (const v of versiones) porPersona.set(v.userId, [...(porPersona.get(v.userId) ?? []), v]);
    return {
      personas: personas.map((p) => {
        const propias = porPersona.get(p.id) ?? [];
        const vigente = versionVigente(propias, h.dia);
        const proxima = versionVigente(propias.filter((v) => dia(v.vigenteDesde) > h.dia), '9999-12-31');
        return {
          id: p.id,
          nombre: nombreDe(p),
          rol: p.role?.namerol ?? '',
          semana: semanaDe(vigente),
          porDefecto: !vigente,
          proximoCambio: proxima ? { vigenteDesde: dia(proxima.vigenteDesde), semana: semanaDe(proxima) } : null,
        };
      }),
      ajuste: await this.ajusteVista(),
    };
  }

  private async personaEnMiAlcance(userId: string, user: any) {
    const persona = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, lastname: true, estado: true, agenciaId: true, regionId: true, agencia: { select: { regionId: true } }, bodega: { select: { regionId: true } }, role: { select: { capacidades: true } } },
    });
    if (!persona) throw new NotFoundException('La persona no existe.');
    if (!personaEnAlcance(resolverAlcance(user), persona)) throw new ForbiddenException('Esta persona está fuera de tu alcance.');
    return persona;
  }

  /** Historial de cambios de horario de una persona, del más reciente al más antiguo, con el horario anterior de cada cambio. */
  async historial(userId: string, user: any) {
    await this.personaEnMiAlcance(userId, user);
    const versiones = (await this.prisma.horarioPersona.findMany({ where: { userId }, orderBy: [{ vigenteDesde: 'asc' }, { createdAt: 'asc' }] })) as VersionHorario[];
    const actores = await this.nombresDe(versiones.map((v) => v.actorId));
    return versiones
      .map((v, i) => ({
        id: v.id,
        creadoEn: v.createdAt,
        actor: actores.get(v.actorId) ?? v.actorId,
        vigenteDesde: dia(v.vigenteDesde),
        motivo: v.motivo,
        dias: semanaDe(v),
        anterior: i === 0 ? HORARIO_POR_DEFECTO : semanaDe(versiones[i - 1]),
      }))
      .reverse();
  }

  async historialAjustes() {
    const ajustes = (await this.prisma.ajusteHorario.findMany({ orderBy: [{ vigenteDesde: 'asc' }, { createdAt: 'asc' }] })) as VersionAjuste[];
    const actores = await this.nombresDe(ajustes.map((a) => a.actorId));
    return ajustes
      .map((a, i) => ({
        id: a.id,
        creadoEn: a.createdAt,
        actor: actores.get(a.actorId) ?? (a.actorId === 'sistema' ? 'Sistema' : a.actorId),
        vigenteDesde: dia(a.vigenteDesde),
        motivo: a.motivo,
        toleranciaMin: a.toleranciaMin,
        ventanaMin: a.ventanaMin,
        anterior: i === 0 ? null : { toleranciaMin: ajustes[i - 1].toleranciaMin, ventanaMin: ajustes[i - 1].ventanaMin },
      }))
      .reverse();
  }

  private async nombresDe(ids: string[]): Promise<Map<string, string>> {
    const unicos = [...new Set(ids.filter((i) => i && i !== 'sistema'))];
    if (!unicos.length) return new Map();
    const usuarios = await this.prisma.user.findMany({ where: { id: { in: unicos } }, select: { id: true, name: true, lastname: true } });
    return new Map(usuarios.map((u) => [u.id, nombreDe(u)]));
  }

  // ───────────────────────── Edición ─────────────────────────

  /** Guarda un horario nuevo para una persona: rige desde mañana, con motivo, y deja la versión anterior intacta en el historial. */
  async editar(dto: EditarHorarioDto, user: any) {
    const error = validarSemana(dto.dias);
    if (error) throw new BadRequestException(error);
    const motivo = (dto.motivo ?? '').trim();
    if (motivo.length < 5) throw new BadRequestException('Escribe el motivo del cambio (mínimo 5 caracteres).');
    const persona = await this.personaEnMiAlcance(dto.userId, user);
    if (!persona.role?.capacidades?.includes('rrhh.timbrar')) throw new BadRequestException('Esta persona no timbra, así que no tiene horario.');
    const desde = sumarDias(this.hoy().dia, 1);
    const dias = dto.dias.map((d) => ({ trabaja: d.trabaja, entrada: d.entrada, salida: d.salida }));
    await this.prisma.horarioPersona.create({ data: { userId: dto.userId, vigenteDesde: diaComoFecha(desde), dias, motivo, actorId: String(user.id) } });
    return { ...(await this.vista(dto.userId)), mensaje: `El nuevo horario de ${nombreDe(persona)} rige desde el ${desde}.` };
  }

  async editarAjuste(dto: EditarAjusteDto, user: any) {
    const error = validarAjuste(dto);
    if (error) throw new BadRequestException(error);
    const motivo = (dto.motivo ?? '').trim();
    if (motivo.length < 5) throw new BadRequestException('Escribe el motivo del cambio (mínimo 5 caracteres).');
    const desde = sumarDias(this.hoy().dia, 1);
    await this.prisma.ajusteHorario.create({ data: { vigenteDesde: diaComoFecha(desde), toleranciaMin: dto.toleranciaMin, ventanaMin: dto.ventanaMin, motivo, actorId: String(user.id) } });
    return { ...(await this.ajusteVista()), mensaje: `El nuevo ajuste rige desde el ${desde}.` };
  }

  // ───────────────────────── Alertas ─────────────────────────

  private async administradores(): Promise<string[]> {
    const admins = await this.prisma.user.findMany({ where: { estado: 1, role: rolConFuncion(FUNCION.ADMINISTRADOR) }, select: { id: true } });
    return admins.map((a) => a.id);
  }

  /** Avisa a la persona y a los administradores, una sola vez por persona, día y situación. */
  private async avisar(persona: { id: string; name?: string | null; lastname?: string | null }, diaStr: string, codigo: 'SALIDA_SIN_ENTRADA' | 'ENTRADA_SIN_SALIDA' | 'SIN_MARCA', titulo: string, paraPersona: string, paraAdmins: string): Promise<boolean> {
    try {
      // La entidad es la persona; el día y la situación van en `data.clave`, que es lo que evita avisar dos veces lo mismo.
      const clave = `${diaStr}:${codigo}`;
      if (await this.prisma.notification.findFirst({ where: { tipo: 'HORARIO_INCIDENCIA', entidadId: persona.id, data: { path: ['clave'], equals: clave } }, select: { id: true } })) return false;
      const opts = { tipo: 'HORARIO_INCIDENCIA' as const, entidadTipo: 'USUARIO', entidadId: persona.id };
      const data = { userId: persona.id, dia: diaStr, codigo, clave };
      const admins = (await this.administradores()).filter((id) => id !== persona.id);
      await this.notifications.notificarUsuarios([persona.id], titulo, paraPersona, data, opts);
      if (admins.length) await this.notifications.notificarUsuarios(admins, titulo, paraAdmins.replace('{nombre}', nombreDe(persona)), data, opts);
      return true;
    } catch (e: any) {
      this.logger.warn(`No se pudo avisar la incidencia de horario: ${e?.message || e}`);
      return false;
    }
  }

  /** Al registrar una salida sin haber marcado la entrada. */
  async avisarSalidaSinEntrada(userId: string, diaStr: string): Promise<void> {
    const persona = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, lastname: true } });
    if (!persona) return;
    await this.avisar(
      persona, diaStr, 'SALIDA_SIN_ENTRADA', 'Salida sin entrada registrada',
      `Marcaste tu salida del ${diaStr} sin haber marcado tu entrada. El día queda incompleto y un administrador debe revisarlo.`,
      `{nombre} marcó su salida del ${diaStr} sin haber marcado su entrada. El día queda incompleto.`,
    );
  }

  /**
   * Revisión periódica del día en curso: avisa de quien ya no puede marcar su entrada (terminó la ventana y no hay marcas) y de quien marcó
   * su entrada pero ya no puede marcar su salida. Una sola vez por persona, día y situación. `soloIds` acota la revisión (para las pruebas).
   */
  async revisarIncidencias(ahora = new Date(), soloIds?: string[]): Promise<number> {
    const h = this.hoy(ahora);
    const personas = await this.prisma.user.findMany({
      where: { estado: 1, role: { capacidades: { has: 'rrhh.timbrar' } }, ...(soloIds ? { id: { in: soloIds } } : {}) },
      select: { id: true, name: true, lastname: true, createdAt: true },
    });
    if (!personas.length) return 0;
    const marcas = await this.prisma.timbrada.findMany({ where: { fechaDia: diaComoFecha(h.dia), userId: { in: personas.map((p) => p.id) } }, select: { userId: true, tipo: true, fechaDia: true, marcadaEn: true } });
    const porPersona = new Map<string, Set<string>>();
    for (const m of marcas) porPersona.set(m.userId, (porPersona.get(m.userId) ?? new Set()).add(m.tipo));

    const [versiones, ajustes] = await Promise.all([
      this.prisma.horarioPersona.findMany({ where: { userId: { in: personas.map((p) => p.id) }, vigenteDesde: { lte: diaComoFecha(h.dia) } } }),
      this.prisma.ajusteHorario.findMany({ where: { vigenteDesde: { lte: diaComoFecha(h.dia) } } }),
    ]);
    const ajuste = ajusteDe(versionVigente(ajustes as VersionAjuste[], h.dia));
    if (!ajuste) return 0;
    // El día en que se activan los horarios nadie tuvo el día completo para marcar: las alertas empiezan al día siguiente.
    const activacion = (ajustes as VersionAjuste[]).map((x) => dia(x.vigenteDesde)).sort()[0];
    if (h.dia <= activacion) return 0;

    let avisadas = 0;
    for (const p of personas) {
      if (fechaEnEcuador(p.createdAt).dia > h.dia) continue;
      const d = semanaDe(versionVigente((versiones as VersionHorario[]).filter((v) => v.userId === p.id), h.dia))[indiceDiaSemana(h.dia)];
      if (!d.trabaja) continue;
      const tipos = porPersona.get(p.id) ?? new Set<string>();
      if (tipos.size === 0 && h.minuto > aMinutos(d.entrada) + ajuste.ventanaMin) {
        if (await this.avisar(p, h.dia, 'SIN_MARCA', 'Día sin marcas',
          `No registraste ninguna marca hoy (${h.dia}): la ventana para marcar tu entrada ya terminó.`,
          `{nombre} no registró ninguna marca hoy (${h.dia}) y la ventana de entrada ya terminó.`)) avisadas++;
      } else if (tipos.has('ENTRADA') && !tipos.has('SALIDA') && h.minuto > aMinutos(d.salida) + ajuste.ventanaMin) {
        if (await this.avisar(p, h.dia, 'ENTRADA_SIN_SALIDA', 'Entrada sin salida',
          `Marcaste tu entrada hoy (${h.dia}) pero no tu salida, y la ventana para marcarla ya terminó. El día queda incompleto.`,
          `{nombre} marcó su entrada hoy (${h.dia}) pero no su salida, y la ventana ya terminó. El día queda incompleto.`)) avisadas++;
      }
    }
    return avisadas;
  }
}
