import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ALMACEN_ARCHIVO, PREFIJO_ARCHIVO, type AlmacenArchivo } from './almacen.js';
import { TABLAS_ARCHIVABLES, TABLAS_PURGABLES, type Columna, type FilaTabla, type RangoFechas, type TablaArchivable, type TablaHija } from './archivado.tablas.js';
import { contarFilas, escribirParquet, leerIds, sha256 } from './parquet.js';

type Where = Record<string, unknown>;

export interface OpcionesCorrida {
  /** Por defecto es un simulacro: informa qué haría sin subir ni borrar nada. */
  simulacro?: boolean;
  ahora?: Date;
  /** Limita la corrida a estas tablas (nombre lógico). */
  tablas?: string[];
  /** Condición extra por tabla. Las pruebas la usan para tocar solo sus filas marcadas. */
  filtroExtra?: Record<string, Where>;
  filasPorParte?: number;
  /** Tablas a archivar. Por defecto `TABLAS_ARCHIVABLES`; las pruebas pueden pasar otras. */
  configuracion?: TablaArchivable[];
  /**
   * Solo se retoman los lotes pendientes con más de estos milisegundos (por defecto 10 minutos). Uno más reciente puede estar en
   * plena subida por otra corrida u otra instancia: tocarlo lo estropearía. Las pruebas de recuperación pasan 0.
   */
  retomarDespuesDe?: number;
  /** Solo se retoman lotes pendientes que dejaron estas corridas. Lo usan las pruebas de recuperación para no pisarse entre sí. */
  retomarDeCorridas?: string[];
  /**
   * Nombre del candado de esta corrida (por defecto uno solo para todo el archivado). Las pruebas que corren en paralelo contra la
   * misma base usan uno propio cada una para no bloquearse entre sí.
   */
  candado?: string;
}

export interface ResumenTabla {
  /** Filas que se archivarían (solo simulacro). */
  simuladas: number;
  archivadas: number;
  borradas: number;
  /** Archivos (lotes) subidos: un lote de una familia cuenta un archivo por tabla. */
  lotes: number;
  purgadas: number;
  errores: string[];
}

export interface ResultadoCorrida {
  corridaId: string;
  simulacro: boolean;
  estado: 'OK' | 'ERROR';
  tablas: Record<string, ResumenTabla>;
  /** Otra corrida (u otra instancia) tenía el candado: esta no hizo nada. */
  omitida?: boolean;
}

/** Aparecieron filas hijas después de leer el lote: borrar el padre las perdería. */
class HijasNuevasError extends Error {}

interface Archivo {
  tabla: string;
  columnas: Columna[];
  filas: FilaTabla[];
}

interface LoteBase {
  id: string;
  grupoId: string | null;
  clave: string;
  sha256: string;
  filas: number;
  tabla: string;
  anio: number;
  mes: number;
  parte: number;
  bytes: number;
  esquemaVersion: number;
  fechaMin: Date;
  fechaMax: Date;
}

const DIA_MS = 24 * 60 * 60 * 1000;
const FILAS_POR_PARTE = 100_000;
const FILAS_POR_PAGINA = 5_000;
const IDS_POR_LOTE = 1_000;
const RETOMAR_DESPUES_DE_MS = 10 * 60 * 1000;
const CANDADO_ARCHIVADO = 'archivado';
/** Cuánto dura el arriendo del candado sin renovarse. Se renueva en cada lote; si el proceso muere, vence solo. */
const CANDADO_TTL_SEG = 20 * 60;

/** Renueva el arriendo del candado; lanza si otra corrida lo tomó. Se llama antes de subir y antes de borrar. */
type Latido = () => Promise<void>;

const inicioMes = (f: Date) => new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1));
const mesSiguiente = (f: Date) => new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 1));
const dosDigitos = (n: number) => String(n).padStart(2, '0');
const trozos = <T>(xs: T[], n = IDS_POR_LOTE): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

@Injectable()
export class ArchivadoService {
  private readonly logger = new Logger(ArchivadoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ALMACEN_ARCHIVO) private readonly almacen: AlmacenArchivo,
  ) {}

  private delegado(modelo: string, cliente: any = this.prisma): any {
    return cliente[modelo];
  }

  /**
   * Una corrida del archivado. Orden de seguridad: primero retoma lo que quedó a medias, luego, por cada mes completo que ya
   * pasó la ventana, escribe el Parquet, lo sube, lo vuelve a leer y compara huella y filas, y SOLO entonces borra de la base.
   * Un error en una tabla no detiene a las demás; lo no verificado nunca se borra.
   */
  async ejecutar(opc: OpcionesCorrida = {}): Promise<ResultadoCorrida> {
    const simulacro = opc.simulacro ?? true;
    // Un simulacro no escribe nada: no necesita el candado y puede correr aunque haya una corrida real en curso.
    if (simulacro) return this.correr(opc, async () => undefined);

    // Una sola corrida real a la vez, aunque haya varias instancias del servidor (o dos disparos seguidos): dos corridas leerían las
    // mismas filas y las archivarían dos veces, y los reportes las contarían doble.
    const id = opc.candado ?? CANDADO_ARCHIVADO;
    const token = randomUUID();
    if (!(await this.adquirirCandado(id, token))) {
      this.logger.warn('[Archivado] Otra corrida (u otra instancia) ya está archivando: esta se omite.');
      return { corridaId: '', simulacro, estado: 'OK', omitida: true, tablas: {} };
    }
    try {
      await this.cerrarInterrumpidas();
      return await this.correr(opc, () => this.renovarCandado(id, token));
    } finally {
      await this.liberarCandado(id, token).catch(() => undefined);
    }
  }

  /**
   * El arriendo es una fila: se toma si está vencido o es nuestro, de forma atómica (una sola sentencia). Va con SQL directo y el
   * reloj de la base, no el de cada servidor, para que dos instancias con la hora desfasada no se pisen.
   */
  private async adquirirCandado(id: string, token: string): Promise<boolean> {
    await this.prisma.$executeRaw`INSERT INTO archivado_candado (id, propietario, hasta) VALUES (${id}, '', (now() AT TIME ZONE 'UTC') - interval '1 second') ON CONFLICT (id) DO NOTHING`;
    const filas = await this.prisma.$executeRaw`UPDATE archivado_candado SET propietario = ${token}, hasta = (now() AT TIME ZONE 'UTC') + ${CANDADO_TTL_SEG} * interval '1 second' WHERE id = ${id} AND (hasta < (now() AT TIME ZONE 'UTC') OR propietario = ${token})`;
    return filas === 1;
  }

  /**
   * Una corrida que sigue "en curso" después de una hora se interrumpió: el proceso se cayó sin cerrarla. Teniendo el candado, nadie
   * más puede estar corriendo de verdad, así que se cierra con el error que corresponde en vez de dejar la fila mintiendo para siempre.
   */
  private async cerrarInterrumpidas(): Promise<void> {
    await this.prisma.archivadoCorrida.updateMany({
      where: { estado: 'EN_CURSO', inicio: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
      data: { estado: 'ERROR', fin: new Date(), error: 'La corrida se interrumpió: el proceso terminó sin cerrarla.' },
    });
  }

  private async renovarCandado(id: string, token: string): Promise<void> {
    const filas = await this.prisma.$executeRaw`UPDATE archivado_candado SET hasta = (now() AT TIME ZONE 'UTC') + ${CANDADO_TTL_SEG} * interval '1 second' WHERE id = ${id} AND propietario = ${token}`;
    if (filas !== 1) throw new Error('Se perdió el candado del archivado (otra corrida lo tomó o venció): se detiene antes de tocar más datos.');
  }

  private async liberarCandado(id: string, token: string): Promise<void> {
    await this.prisma.$executeRaw`UPDATE archivado_candado SET hasta = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${id} AND propietario = ${token}`;
  }

  private async correr(opc: OpcionesCorrida, latido: Latido): Promise<ResultadoCorrida> {
    const simulacro = opc.simulacro ?? true;
    const ahora = opc.ahora ?? new Date();
    const configuracion = (opc.configuracion ?? TABLAS_ARCHIVABLES).filter((t) => !opc.tablas || opc.tablas.includes(t.tabla));
    const corrida = await this.prisma.archivadoCorrida.create({ data: { simulacro } });
    const tablas: Record<string, ResumenTabla> = {};
    const resumenDe = (t: string) => (tablas[t] ??= { simuladas: 0, archivadas: 0, borradas: 0, lotes: 0, purgadas: 0, errores: [] });
    const enAlcance = (t: string) => !opc.tablas || opc.tablas.includes(t);

    try {
      if (!simulacro) await this.retomarPendientes(configuracion, resumenDe, opc.retomarDespuesDe ?? RETOMAR_DESPUES_DE_MS, latido, opc.retomarDeCorridas);

      for (const cfg of configuracion) {
        const resumen = resumenDe(cfg.tabla);
        try {
          await this.archivarTabla(cfg, corrida.id, simulacro, ahora, opc, resumen, latido);
        } catch (e: any) {
          this.logger.error(`[Archivado] ${cfg.tabla}: ${e?.message ?? e}`);
          resumen.errores.push(String(e?.message ?? e));
        }
      }

      for (const cfg of TABLAS_PURGABLES.filter((t) => enAlcance(t.tabla))) {
        const resumen = resumenDe(cfg.tabla);
        try {
          const corte = new Date(ahora.getTime() - cfg.ventanaDias * DIA_MS);
          const where: Where = { AND: [cfg.donde(corte), opc.filtroExtra?.[cfg.tabla] ?? {}] };
          if (simulacro) resumen.simuladas += await this.delegado(cfg.modelo).count({ where });
          else {
            await latido();
            resumen.purgadas += (await this.delegado(cfg.modelo).deleteMany({ where })).count;
          }
        } catch (e: any) {
          this.logger.error(`[Archivado] purga ${cfg.tabla}: ${e?.message ?? e}`);
          resumen.errores.push(String(e?.message ?? e));
        }
      }
    } catch (e: any) {
      resumenDe('_corrida').errores.push(String(e?.message ?? e));
    }

    const errores = Object.entries(tablas).flatMap(([t, r]) => r.errores.map((m) => `${t}: ${m}`));
    const estado = errores.length ? 'ERROR' : 'OK';
    await this.prisma.archivadoCorrida.update({
      where: { id: corrida.id },
      data: { fin: new Date(), estado, resumen: tablas as never, error: errores.length ? errores.join('\n').slice(0, 4000) : null },
    });
    return { corridaId: corrida.id, simulacro, estado, tablas };
  }

  private async archivarTabla(cfg: TablaArchivable, corridaId: string, simulacro: boolean, ahora: Date, opc: OpcionesCorrida, resumen: ResumenTabla, latido: Latido) {
    const delegado = this.delegado(cfg.modelo);
    const fecha = cfg.columnaFecha;
    // Solo meses completos que ya pasaron la ventana.
    const corte = inicioMes(new Date(ahora.getTime() - cfg.ventanaDias * DIA_MS));
    // Sin límites no hay condición: con una fecha compuesta, un rango vacío descartaría las filas que tienen fecha programada.
    const enRango = (r: RangoFechas): Where =>
      !r.gte && !r.lt ? {} : cfg.fechaCompuesta ? cfg.fechaCompuesta.donde(r) : { [fecha]: { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } };
    const condiciones = (rango: RangoFechas = {}): Where => ({
      AND: [enRango({ lt: corte }), enRango(rango), cfg.filtro ?? {}, opc.filtroExtra?.[cfg.tabla] ?? {}],
    });
    const primeraFecha = async (where: Where): Promise<Date | null> => {
      if (cfg.fechaCompuesta) return cfg.fechaCompuesta.minimo(this.prisma, where);
      const fila = await delegado.findFirst({ where, orderBy: { [fecha]: 'asc' }, select: { [fecha]: true } });
      return fila ? (fila[fecha] as Date) : null;
    };

    let desde: Date | null = null;
    for (let vuelta = 0; vuelta < 1200; vuelta++) {
      const primera = await primeraFecha(condiciones(desde ? { gte: desde } : {}));
      if (!primera) return;
      const ini = inicioMes(primera);
      const fin = mesSiguiente(ini);
      const dentroDelMes = condiciones({ gte: ini, lt: fin });

      if (simulacro) {
        resumen.simuladas += await delegado.count({ where: dentroDelMes });
      } else {
        while (await this.archivarLote(cfg, dentroDelMes, ini, corridaId, opc.filasPorParte ?? FILAS_POR_PARTE, resumen, latido)) {
          // sigue con el resto del mes hasta que no quede nada
        }
      }
      desde = fin;
    }
  }

  /** Archiva hasta `max` filas del mes (y las de sus hijos). Devuelve false cuando ya no queda nada. */
  private async archivarLote(cfg: TablaArchivable, dentroDelMes: Where, ini: Date, corridaId: string, max: number, resumen: ResumenTabla, latido: Latido): Promise<boolean> {
    const filas = await this.leerFilas(cfg, dentroDelMes, max);
    if (!filas.length) return false;
    await latido(); // con el candado vigente antes de subir nada
    const idsPadre = filas.map((f) => String(f.id));
    // Con fecha compuesta se guarda la derivada en `columnaFecha`, para que quien lea el archivo filtre por la misma fecha.
    if (cfg.fechaCompuesta) for (const f of filas) f[cfg.columnaFecha] = cfg.fechaCompuesta.de(f);
    await cfg.enriquecer?.(this.prisma, filas);

    const archivos: Archivo[] = [{ tabla: cfg.tabla, columnas: cfg.columnas, filas }];
    const idsPorHijo = new Map<string, string[]>();
    for (const hijo of cfg.hijos ?? []) {
      const hijas = await this.leerHijas(hijo, idsPadre);
      idsPorHijo.set(hijo.modelo, hijas.map((f) => String(f.id)));
      if (hijas.length) archivos.push({ tabla: hijo.tabla, columnas: hijo.columnas, filas: hijas });
    }

    // Todos los archivos del lote comparten partición (la fecha del padre) y grupo: se verifican y se borran juntos.
    const fechas = filas.map((f) => (f[cfg.columnaFecha] as Date).getTime());
    const grupoId = randomUUID();
    const lotes: LoteBase[] = [];
    for (const a of archivos) lotes.push(await this.subir(a, cfg.esquemaVersion, ini, new Date(Math.min(...fechas)), new Date(Math.max(...fechas)), corridaId, grupoId));
    resumen.lotes += lotes.length;

    for (const lote of lotes) await this.verificar(lote);
    // Justo antes de borrar de la base: si otra corrida tomó el candado mientras se subía, no se borra nada (el lote queda verificado y
    // lo retoma después quien corresponda).
    await latido();
    await this.borrarFamilia(cfg, idsPadre, idsPorHijo, lotes.map((l) => l.id));
    resumen.archivadas += filas.length;
    resumen.borradas += filas.length;
    return true;
  }

  private async subir(a: Archivo, esquemaVersion: number, ini: Date, fechaMin: Date, fechaMax: Date, corridaId: string, grupoId: string): Promise<LoteBase> {
    const anio = ini.getUTCFullYear();
    const mes = ini.getUTCMonth() + 1;
    const parquet = escribirParquet(a.columnas, a.filas);
    const huella = sha256(parquet);

    // Primero se RESERVA la clave en la base y solo después se sube el archivo. La restricción única (tabla, clave) arbitra entre dos
    // corridas que quieran el mismo número de parte: la que pierde pide el siguiente. Al revés (subir y luego registrar), la perdedora
    // habría sobrescrito en el bucket el archivo de la ganadora antes de enterarse del choque.
    let lote: LoteBase | null = null;
    for (let intento = 0; !lote; intento++) {
      const maxParte = await this.prisma.archivadoLote.aggregate({ _max: { parte: true }, where: { tabla: a.tabla, anio, mes } });
      const parte = (maxParte._max.parte ?? 0) + 1;
      const clave = `${PREFIJO_ARCHIVO}/${a.tabla}/anio=${anio}/mes=${dosDigitos(mes)}/part-${String(parte).padStart(4, '0')}.parquet`;
      try {
        lote = await this.prisma.archivadoLote.create({
          data: { corridaId, grupoId, tabla: a.tabla, anio, mes, parte, clave, filas: a.filas.length, bytes: parquet.length, sha256: huella, esquemaVersion, fechaMin, fechaMax },
        });
      } catch (e: any) {
        if (e?.code !== 'P2002' || intento >= 25) throw e; // P2002: otro lote ya tiene ese número
      }
    }
    // Si la subida falla, el lote queda SUBIDO sin archivo: la siguiente corrida lo verifica, no lo encuentra y lo marca FALLIDO.
    await this.almacen.put(lote.clave, parquet, 'application/vnd.apache.parquet');
    return lote;
  }

  private async leerFilas(cfg: TablaArchivable, where: Where, max: number): Promise<FilaTabla[]> {
    const delegado = this.delegado(cfg.modelo);
    const filas: FilaTabla[] = [];
    let cursor: string | undefined;
    while (filas.length < max) {
      const take = Math.min(FILAS_POR_PAGINA, max - filas.length);
      const pagina: FilaTabla[] = await delegado.findMany({
        where,
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      filas.push(...pagina);
      if (pagina.length < take) break;
      cursor = String(pagina[pagina.length - 1].id);
    }
    return filas;
  }

  private async leerHijas(hijo: TablaHija, idsPadre: string[]): Promise<FilaTabla[]> {
    const filas: FilaTabla[] = [];
    for (const lote of trozos(idsPadre)) {
      filas.push(...(await this.delegado(hijo.modelo).findMany({ where: { [hijo.fk]: { in: lote } }, orderBy: { id: 'asc' } })));
    }
    return filas;
  }

  /** Marca como FALLIDO todo el grupo: lo escrito no sirve y las filas seguirán en la base para archivarse de nuevo. */
  private async marcarGrupoFallido(lote: { id: string; grupoId: string | null }) {
    await this.prisma.archivadoLote.updateMany({ where: lote.grupoId ? { grupoId: lote.grupoId } : { id: lote.id }, data: { estado: 'FALLIDO' } });
  }

  /** Vuelve a leer lo subido y compara huella y número de filas. Si no coincide, el grupo queda FALLIDO y no se borra nada. */
  private async verificar(lote: LoteBase) {
    const subido = await this.almacen.get(lote.clave);
    if (!subido || sha256(subido) !== lote.sha256 || contarFilas(subido) !== lote.filas) {
      await this.marcarGrupoFallido(lote);
      throw new Error(`El archivo ${lote.clave} no coincide con lo escrito: no se borró nada de la base.`);
    }
    const manifiesto = {
      tabla: lote.tabla,
      grupoId: lote.grupoId,
      anio: lote.anio,
      mes: lote.mes,
      parte: lote.parte,
      clave: lote.clave,
      filas: lote.filas,
      bytes: lote.bytes,
      sha256: lote.sha256,
      esquemaVersion: lote.esquemaVersion,
      fechaMin: lote.fechaMin.toISOString(),
      fechaMax: lote.fechaMax.toISOString(),
    };
    const claveManifiesto = lote.clave.replace(`${PREFIJO_ARCHIVO}/`, `${PREFIJO_ARCHIVO}/_manifiestos/`).replace(/\.parquet$/, '.json');
    await this.almacen.put(claveManifiesto, Buffer.from(JSON.stringify(manifiesto, null, 2)), 'application/json');
    await this.prisma.archivadoLote.update({ where: { id: lote.id }, data: { estado: 'VERIFICADO' } });
  }

  /**
   * Borra de la base lo que ya está verificado en el bucket. Con hijos, todo en una sola transacción: primero los hijos
   * archivados, luego se comprueba que no haya aparecido ninguno nuevo (borrar el padre lo perdería por la cascada) y por
   * último los padres. Si aparecieron hijos nuevos, se deshace todo y el grupo queda FALLIDO para archivarse de nuevo completo.
   */
  private async borrarFamilia(cfg: TablaArchivable, idsPadre: string[], idsPorHijo: Map<string, string[]>, loteIds: string[]) {
    const marcarBorrados = (cliente: any) => cliente.archivadoLote.updateMany({ where: { id: { in: loteIds } }, data: { estado: 'BORRADO', borradoEn: new Date() } });

    if (!cfg.hijos?.length) {
      for (const lote of trozos(idsPadre)) await this.delegado(cfg.modelo).deleteMany({ where: { id: { in: lote } } });
      await marcarBorrados(this.prisma);
      return;
    }

    try {
      await this.prisma.$transaction(
        async (tx: any) => {
          for (const hijo of cfg.hijos!) {
            for (const lote of trozos(idsPorHijo.get(hijo.modelo) ?? [])) await this.delegado(hijo.modelo, tx).deleteMany({ where: { id: { in: lote } } });
            let quedan = 0;
            for (const lote of trozos(idsPadre)) quedan += await this.delegado(hijo.modelo, tx).count({ where: { [hijo.fk]: { in: lote } } });
            if (quedan) throw new HijasNuevasError(`Aparecieron ${quedan} filas nuevas en ${hijo.tabla} mientras se archivaba: no se borró nada.`);
          }
          for (const lote of trozos(idsPadre)) await this.delegado(cfg.modelo, tx).deleteMany({ where: { id: { in: lote } } });
          await marcarBorrados(tx);
        },
        { timeout: 600_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (e instanceof HijasNuevasError) {
        await this.prisma.archivadoLote.updateMany({ where: { id: { in: loteIds } }, data: { estado: 'FALLIDO' } });
      }
      throw e;
    }
  }

  /** Lo que una corrida anterior dejó a medias: SUBIDO (sin verificar) o VERIFICADO (sin borrar de la base), grupo por grupo. */
  private async retomarPendientes(configuracion: TablaArchivable[], resumenDe: (t: string) => ResumenTabla, antiguedadMs: number, latido: Latido, soloCorridas?: string[]) {
    const nombres = configuracion.flatMap((c) => [c.tabla, ...(c.hijos ?? []).map((h) => h.tabla)]);
    const pendientes = await this.prisma.archivadoLote.findMany({ where: { estado: { in: ['SUBIDO', 'VERIFICADO'] }, tabla: { in: nombres }, createdAt: { lt: new Date(Date.now() - antiguedadMs) }, ...(soloCorridas ? { corridaId: { in: soloCorridas } } : {}) }, orderBy: { createdAt: 'asc' } });
    const grupos = new Map<string, typeof pendientes>();
    for (const l of pendientes) grupos.set(l.grupoId ?? l.id, [...(grupos.get(l.grupoId ?? l.id) ?? []), l]);

    for (const [clave, parcial] of grupos) {
      // El grupo completo (un lote de una familia son varios archivos), no solo la parte pendiente.
      const lotes = parcial[0].grupoId ? await this.prisma.archivadoLote.findMany({ where: { grupoId: clave } }) : parcial;
      const padre = lotes.find((l) => configuracion.some((c) => c.tabla === l.tabla));
      const cfg = configuracion.find((c) => c.tabla === padre?.tabla);
      const resumen = resumenDe(padre?.tabla ?? parcial[0].tabla);
      try {
        if (!padre || !cfg) throw new Error(`El grupo ${clave} no tiene el lote de la tabla principal.`);
        if (lotes.some((l) => l.estado === 'FALLIDO' || l.estado === 'BORRADO')) throw new Error(`El grupo ${clave} está en un estado mixto; revísalo a mano.`);
        for (const l of lotes.filter((x) => x.estado === 'SUBIDO')) await this.verificar(l);

        const idsPorTabla = new Map<string, string[]>();
        for (const l of lotes) {
          const parquet = await this.almacen.get(l.clave);
          if (!parquet) throw new Error(`El archivo ${l.clave} ya no está en el bucket: no se borra nada de la base.`);
          idsPorTabla.set(l.tabla, [...(idsPorTabla.get(l.tabla) ?? []), ...(await leerIds(parquet))]);
        }
        const idsPadre = idsPorTabla.get(cfg.tabla) ?? [];
        const idsPorHijo = new Map((cfg.hijos ?? []).map((h) => [h.modelo, idsPorTabla.get(h.tabla) ?? []]));
        await latido();
        await this.borrarFamilia(cfg, idsPadre, idsPorHijo, lotes.map((l) => l.id));
        resumen.borradas += idsPadre.length;
      } catch (e: any) {
        resumen.errores.push(`lote ${clave}: ${e?.message ?? e}`);
      }
    }
  }
}
