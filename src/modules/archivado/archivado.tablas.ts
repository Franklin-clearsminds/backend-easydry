/**
 * Qué tablas se archivan a Parquet, cuáles solo se purgan y con qué ventana. Es la tabla de retención acordada:
 *  - técnicas sin valor histórico (30 días): solo se borran, no se archivan;
 *  - registros de sync y avisos (90 días): se archivan;
 *  - operación y trazabilidad (12 meses): llegan en la Etapa 4, tabla por tabla.
 * Los maestros (clientes, agencias, insumos, usuarios, catálogos) nunca se archivan.
 *
 * Una tabla con `hijos` se archiva como FAMILIA: padre e hijos viajan en el mismo lote y se borran juntos en una transacción.
 * Es obligatorio porque los hijos se borran en cascada con su padre: borrar el padre sin haber archivado los hijos los perdería.
 */

export type TipoColumna = 'STRING' | 'INT32' | 'DOUBLE' | 'BOOLEAN' | 'TIMESTAMP';

export interface Columna {
  nombre: string;
  tipo: TipoColumna;
  /** El valor es JSON (Prisma `Json`): se guarda como texto, que DuckDB lee con `json_extract`. */
  json?: boolean;
}

/** Una tabla que cuelga de una tabla archivable por una clave foránea (se borra en cascada con su padre). */
export interface TablaHija {
  /** Nombre lógico: su propia carpeta en el bucket, con la misma partición anio/mes que el padre. */
  tabla: string;
  modelo: string;
  /** Columna del hijo que apunta al padre. */
  fk: string;
  columnas: Columna[];
}

export type FilaTabla = Record<string, unknown>;

/** Rango de fechas: `gte` incluido, `lt` excluido. Cualquiera de los dos puede faltar. */
export interface RangoFechas {
  gte?: Date;
  lt?: Date;
}

/**
 * Fecha del evento cuando no es una sola columna (p. ej. la fecha programada y, si no hay, la de creación). Es la que decide el
 * mes del archivo, así que debe ser la MISMA con la que luego filtran los reportes, o la lectura se saltaría filas. Se copia al
 * archivo como la columna `columnaFecha` (que en ese caso no existe en la tabla de Prisma).
 */
export interface FechaCompuesta {
  /** Condición de Prisma para las filas cuya fecha del evento cae en el rango. */
  donde(rango: RangoFechas): Record<string, unknown>;
  /** La fecha del evento de una fila ya leída. */
  de(fila: FilaTabla): Date;
  /** La fecha del evento más antigua entre las filas que cumplen `where`; null si no hay ninguna. */
  minimo(prisma: any, where: Record<string, unknown>): Promise<Date | null>;
}

export interface TablaArchivable {
  /** Nombre lógico: es la carpeta del bucket (`archivo-historico/<tabla>/…`). */
  tabla: string;
  /** Nombre del modelo en el cliente de Prisma (`prisma.<modelo>`). */
  modelo: string;
  /** Fecha del evento: decide el mes en que cae cada fila (no la fecha en que se archiva). */
  columnaFecha: string;
  ventanaDias: number;
  /** Súbela al añadir o quitar columnas: queda en el manifiesto de cada lote. */
  esquemaVersion: number;
  columnas: Columna[];
  /** Condición extra de "fila viva": lo que no la cumple no se archiva aunque sea viejo. */
  filtro?: Record<string, unknown>;
  hijos?: TablaHija[];
  /** Si la fecha del evento no es una columna sola. Con ella, `columnaFecha` es la columna derivada que se guarda en el archivo. */
  fechaCompuesta?: FechaCompuesta;
  /** Añade a las filas del padre columnas derivadas (p. ej. la agencia de una bahía) antes de escribirlas. */
  enriquecer?: (prisma: any, filas: FilaTabla[]) => Promise<void>;
}

export interface TablaPurgable {
  tabla: string;
  modelo: string;
  ventanaDias: number;
  /** Condición de borrado para el corte dado (filas más viejas que la ventana). */
  donde(corte: Date): Record<string, unknown>;
}

const TABLAS_SYNC_Y_AVISOS: TablaArchivable[] = [
  {
    tabla: 'sync_outbox_audit',
    modelo: 'syncOutboxAudit',
    columnaFecha: 'syncedAt',
    ventanaDias: 90,
    esquemaVersion: 1,
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'mutationId', tipo: 'STRING' },
      { nombre: 'clientUuid', tipo: 'STRING' },
      { nombre: 'deviceInfo', tipo: 'STRING' },
      { nombre: 'entity', tipo: 'STRING' },
      { nombre: 'action', tipo: 'STRING' },
      { nombre: 'payload', tipo: 'STRING', json: true },
      { nombre: 'syncedAt', tipo: 'TIMESTAMP' },
    ],
  },
  {
    tabla: 'notification',
    modelo: 'notification',
    columnaFecha: 'createdAt',
    ventanaDias: 90,
    esquemaVersion: 1,
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'userId', tipo: 'STRING' },
      { nombre: 'tipo', tipo: 'STRING' },
      { nombre: 'titulo', tipo: 'STRING' },
      { nombre: 'mensaje', tipo: 'STRING' },
      { nombre: 'data', tipo: 'STRING', json: true },
      { nombre: 'entidadTipo', tipo: 'STRING' },
      { nombre: 'entidadId', tipo: 'STRING' },
      { nombre: 'leida', tipo: 'BOOLEAN' },
      { nombre: 'leidaEn', tipo: 'TIMESTAMP' },
      { nombre: 'createdAt', tipo: 'TIMESTAMP' },
    ],
  },
  {
    tabla: 'sync_dead_letter_queue',
    modelo: 'syncDeadLetterQueue',
    columnaFecha: 'createdAt',
    ventanaDias: 90,
    esquemaVersion: 1,
    // Una mutación sin resolver sigue "viva": alguien aún puede aprobarla o reintentarla.
    filtro: { resuelto: true },
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'mutationId', tipo: 'STRING' },
      { nombre: 'clientUuid', tipo: 'STRING' },
      { nombre: 'entityType', tipo: 'STRING' },
      { nombre: 'payload', tipo: 'STRING', json: true },
      { nombre: 'errorMotivo', tipo: 'STRING' },
      { nombre: 'intentos', tipo: 'INT32' },
      { nombre: 'resuelto', tipo: 'BOOLEAN' },
      { nombre: 'usuarioId', tipo: 'STRING' },
      { nombre: 'createdAt', tipo: 'TIMESTAMP' },
      { nombre: 'updatedAt', tipo: 'TIMESTAMP' },
    ],
  },
];

/** 12 meses: la ventana de las tablas de operación y trazabilidad. */
const DOCE_MESES = 365;

export const TABLAS_OPERACION: TablaArchivable[] = [
  {
    tabla: 'kardex_movimiento',
    modelo: 'kardexMovimiento',
    columnaFecha: 'fecha',
    ventanaDias: DOCE_MESES,
    esquemaVersion: 1,
    // Sin condición de "vivo": el stock actual vive en StockUbicacion, no en el kardex.
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'insumoId', tipo: 'STRING' },
      { nombre: 'ubicacionId', tipo: 'STRING' },
      { nombre: 'tipoMovimiento', tipo: 'STRING' },
      { nombre: 'cantidad', tipo: 'DOUBLE' },
      { nombre: 'stockAnterior', tipo: 'DOUBLE' },
      { nombre: 'stockPosterior', tipo: 'DOUBLE' },
      { nombre: 'costoUnitario', tipo: 'DOUBLE' },
      { nombre: 'costoTotal', tipo: 'DOUBLE' },
      { nombre: 'referenciaId', tipo: 'STRING' },
      { nombre: 'usuarioId', tipo: 'STRING' },
      { nombre: 'fecha', tipo: 'TIMESTAMP' },
    ],
  },
  {
    // El libro de movimientos de inventario (`movimientos/globales`), paralelo al kardex: crece con cada movimiento de stock y nadie
    // lo referencia por clave foránea. Sin condición de "vivo": el stock actual vive en Insumo y StockUbicacion.
    tabla: 'movimiento_inventario_global',
    modelo: 'movimientoInventarioGlobal',
    columnaFecha: 'fechaMovimiento',
    ventanaDias: DOCE_MESES,
    esquemaVersion: 1,
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'numeroComprobante', tipo: 'STRING' },
      { nombre: 'tipoMovimientoId', tipo: 'STRING' },
      { nombre: 'insumoId', tipo: 'STRING' },
      { nombre: 'cantidad', tipo: 'DOUBLE' },
      { nombre: 'unidadId', tipo: 'STRING' },
      { nombre: 'cantidadBase', tipo: 'DOUBLE' },
      { nombre: 'stockAnterior', tipo: 'DOUBLE' },
      { nombre: 'stockNuevo', tipo: 'DOUBLE' },
      { nombre: 'presentacionId', tipo: 'STRING' },
      { nombre: 'ubicacionId', tipo: 'STRING' },
      { nombre: 'origenUbicacion', tipo: 'STRING' },
      { nombre: 'destinoUbicacion', tipo: 'STRING' },
      { nombre: 'responsableId', tipo: 'STRING' },
      { nombre: 'motivoId', tipo: 'STRING' },
      { nombre: 'referencia', tipo: 'STRING' },
      { nombre: 'observaciones', tipo: 'STRING' },
      { nombre: 'evidenciasUrls', tipo: 'STRING', json: true },
      { nombre: 'stockUbicacionId', tipo: 'STRING' },
      { nombre: 'cantidadContada', tipo: 'DOUBLE' },
      { nombre: 'fechaMovimiento', tipo: 'TIMESTAMP' },
      { nombre: 'createdAt', tipo: 'TIMESTAMP' },
    ],
  },
  {
    tabla: 'movimiento_inventario',
    modelo: 'movimientoInventario',
    columnaFecha: 'fechaDespacho',
    ventanaDias: DOCE_MESES,
    esquemaVersion: 1,
    // Vivo: un despacho sin cerrar, o con un faltante que la bodega de origen aún no devuelve ni da de baja.
    filtro: { estadoDespacho: { in: ['RECIBIDO', 'RECHAZADO', 'CANCELADO'] }, faltantes: { none: { estado: 'PENDIENTE' } } },
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'numeroGuia', tipo: 'STRING' },
      { nombre: 'tipo', tipo: 'STRING' },
      { nombre: 'estadoDespacho', tipo: 'STRING' },
      { nombre: 'origenUbicacion', tipo: 'STRING' },
      { nombre: 'destinoUbicacion', tipo: 'STRING' },
      { nombre: 'origenBodegaId', tipo: 'STRING' },
      { nombre: 'origenAgenciaId', tipo: 'STRING' },
      { nombre: 'destinoBodegaId', tipo: 'STRING' },
      { nombre: 'destinoAgenciaId', tipo: 'STRING' },
      { nombre: 'destinoPulidorId', tipo: 'STRING' },
      { nombre: 'usuarioDespachaId', tipo: 'STRING' },
      { nombre: 'usuarioRecibeId', tipo: 'STRING' },
      { nombre: 'fechaDespacho', tipo: 'TIMESTAMP' },
      { nombre: 'fechaRecepcion', tipo: 'TIMESTAMP' },
      { nombre: 'observaciones', tipo: 'STRING' },
      { nombre: 'createdAt', tipo: 'TIMESTAMP' },
      { nombre: 'updatedAt', tipo: 'TIMESTAMP' },
    ],
    hijos: [
      {
        tabla: 'movimiento_detalle',
        modelo: 'movimientoDetalle',
        fk: 'movimientoId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'movimientoId', tipo: 'STRING' },
          { nombre: 'insumoId', tipo: 'STRING' },
          { nombre: 'cantidadEnviada', tipo: 'DOUBLE' },
          { nombre: 'cantidadRecibida', tipo: 'DOUBLE' },
          { nombre: 'costoUnitarioUSD', tipo: 'DOUBLE' },
          { nombre: 'subtotalUSD', tipo: 'DOUBLE' },
        ],
      },
      {
        tabla: 'faltante_despacho',
        modelo: 'faltanteDespacho',
        fk: 'movimientoId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'movimientoId', tipo: 'STRING' },
          { nombre: 'numeroGuia', tipo: 'STRING' },
          { nombre: 'insumoId', tipo: 'STRING' },
          { nombre: 'cantidadUnd', tipo: 'DOUBLE' },
          { nombre: 'cantidadBase', tipo: 'DOUBLE' },
          { nombre: 'origenBodegaId', tipo: 'STRING' },
          { nombre: 'origenAgenciaId', tipo: 'STRING' },
          { nombre: 'motivoRecepcion', tipo: 'STRING' },
          { nombre: 'estado', tipo: 'STRING' },
          { nombre: 'resolucion', tipo: 'STRING' },
          { nombre: 'observacionResolucion', tipo: 'STRING' },
          { nombre: 'resueltoPorId', tipo: 'STRING' },
          { nombre: 'resueltoEn', tipo: 'TIMESTAMP' },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
      {
        // Solo la referencia (`url`): las fotos siguen en el bucket, que ya las pasa a clases baratas con su regla de ciclo de vida.
        tabla: 'envio_evidencia',
        modelo: 'envioEvidencia',
        fk: 'movimientoId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'movimientoId', tipo: 'STRING' },
          { nombre: 'faltanteId', tipo: 'STRING' },
          { nombre: 'etapa', tipo: 'STRING' },
          { nombre: 'url', tipo: 'STRING' },
          { nombre: 'usuarioId', tipo: 'STRING' },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
    ],
  },
  {
    tabla: 'servicio_lavado',
    modelo: 'servicioLavado',
    // Los reportes filtran por la hora de ingreso: es la fecha por la que se va a buscar, así que es la de la partición.
    columnaFecha: 'horaIngreso',
    ventanaDias: DOCE_MESES,
    esquemaVersion: 1,
    // Vivo: un servicio sin decidir. FINALIZADO espera la decisión del aprobador (cierre diario), así que se queda aunque sea
    // viejo. Los anulados (deletedAt) sí se archivan, con su `deletedAt`, para que los reportes puedan seguir excluyéndolos.
    filtro: { estado: { in: ['APROBADO', 'RECHAZADO', 'CANCELADO'] } },
    // El servicio solo guarda la bahía; los reportes agrupan por agencia y filtran por región, que se copian al archivar.
    enriquecer: async (prisma, filas) => {
      const bahias = new Map<string, { agenciaId: string; regionId: string | null }>();
      const ids = [...new Set(filas.map((f) => String(f.bahiaId)))];
      for (let i = 0; i < ids.length; i += 1000) {
        const lote = await prisma.bahia.findMany({ where: { id: { in: ids.slice(i, i + 1000) } }, select: { id: true, agenciaId: true, agencia: { select: { regionId: true } } } });
        for (const b of lote) bahias.set(b.id, { agenciaId: b.agenciaId, regionId: b.agencia.regionId });
      }
      for (const f of filas) {
        const b = bahias.get(String(f.bahiaId));
        f.agenciaId = b?.agenciaId ?? null;
        f.regionId = b?.regionId ?? null;
      }
    },
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'clientUuid', tipo: 'STRING' },
      { nombre: 'ordenTrabajoOT', tipo: 'STRING' },
      { nombre: 'placa', tipo: 'STRING' },
      { nombre: 'marca', tipo: 'STRING' },
      { nombre: 'modelo', tipo: 'STRING' },
      { nombre: 'color', tipo: 'STRING' },
      { nombre: 'cliente', tipo: 'STRING' },
      { nombre: 'estado', tipo: 'STRING' },
      { nombre: 'bahiaId', tipo: 'STRING' },
      { nombre: 'agenciaId', tipo: 'STRING' },
      { nombre: 'regionId', tipo: 'STRING' },
      { nombre: 'servicioCatalogoId', tipo: 'INT32' },
      { nombre: 'operadorId', tipo: 'STRING' },
      { nombre: 'precio', tipo: 'DOUBLE' },
      { nombre: 'fotoIngresoUrl', tipo: 'STRING' },
      { nombre: 'fotoSalidaUrl', tipo: 'STRING' },
      { nombre: 'videoInicialUrl', tipo: 'STRING' },
      { nombre: 'videoFinalUrl', tipo: 'STRING' },
      { nombre: 'observaciones', tipo: 'STRING' },
      { nombre: 'horaIngreso', tipo: 'TIMESTAMP' },
      { nombre: 'horaInicio', tipo: 'TIMESTAMP' },
      { nombre: 'horaSalida', tipo: 'TIMESTAMP' },
      { nombre: 'observacionGerente', tipo: 'STRING' },
      { nombre: 'aprobadoPor', tipo: 'STRING' },
      { nombre: 'fechaAprobacion', tipo: 'TIMESTAMP' },
      { nombre: 'motivoRechazo', tipo: 'STRING' },
      { nombre: 'decididoPorId', tipo: 'STRING' },
      { nombre: 'reglaDecision', tipo: 'STRING' },
      { nombre: 'anuladoPorId', tipo: 'STRING' },
      { nombre: 'anuladoEn', tipo: 'TIMESTAMP' },
      { nombre: 'motivoAnulacion', tipo: 'STRING' },
      { nombre: 'version', tipo: 'INT32' },
      { nombre: 'syncedAt', tipo: 'TIMESTAMP' },
      { nombre: 'deletedAt', tipo: 'TIMESTAMP' },
      { nombre: 'createdAt', tipo: 'TIMESTAMP' },
      { nombre: 'updatedAt', tipo: 'TIMESTAMP' },
    ],
    hijos: [
      {
        tabla: 'consumo_servicio',
        modelo: 'consumoServicio',
        fk: 'servicioId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'servicioId', tipo: 'STRING' },
          { nombre: 'insumoId', tipo: 'STRING' },
          { nombre: 'cantidadUsada', tipo: 'DOUBLE' },
          { nombre: 'stockUbicacionId', tipo: 'STRING' },
          { nombre: 'agenciaId', tipo: 'STRING' },
          { nombre: 'insumoNombre', tipo: 'STRING' },
          { nombre: 'insumoSKU', tipo: 'STRING' },
          { nombre: 'unidadSimbolo', tipo: 'STRING' },
          { nombre: 'costoUnitarioUSD', tipo: 'DOUBLE' },
          { nombre: 'costoTotalUSD', tipo: 'DOUBLE' },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
      {
        // Solo la referencia (`url`): las fotos y videos siguen en el bucket con su regla de ciclo de vida.
        tabla: 'evidencia_servicio',
        modelo: 'evidenciaServicio',
        fk: 'servicioId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'servicioId', tipo: 'STRING' },
          { nombre: 'tipo', tipo: 'STRING' },
          { nombre: 'url', tipo: 'STRING' },
          { nombre: 'descripcion', tipo: 'STRING' },
          { nombre: 'tomadaEn', tipo: 'TIMESTAMP' },
          { nombre: 'metadata', tipo: 'STRING', json: true },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
      {
        tabla: 'servicio_lavado_operador',
        modelo: 'servicioLavadoOperador',
        fk: 'servicioId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'servicioId', tipo: 'STRING' },
          { nombre: 'operadorId', tipo: 'STRING' },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
    ],
  },
  {
    tabla: 'servicio_especial',
    modelo: 'servicioEspecial',
    // Columna derivada (no existe en Prisma): la fecha programada o, si no hay, la de creación. Es la fecha con la que
    // filtran los reportes de servicios especiales.
    columnaFecha: 'fechaEvento',
    ventanaDias: DOCE_MESES,
    esquemaVersion: 1,
    // Vivo: todo lo que no esté Completado o Cancelado (Pendiente, En Proceso, …).
    filtro: { estado: { in: ['Completado', 'Cancelado'] } },
    fechaCompuesta: {
      donde: ({ gte, lt }) => {
        const rango = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };
        return { OR: [{ fechaProgramada: rango }, { fechaProgramada: null, createdAt: rango }] };
      },
      de: (fila) => (fila.fechaProgramada as Date | null) ?? (fila.createdAt as Date),
      minimo: async (prisma, where) => {
        const [programada, creada] = await Promise.all([
          prisma.servicioEspecial.findFirst({ where: { AND: [where, { fechaProgramada: { not: null } }] }, orderBy: { fechaProgramada: 'asc' }, select: { fechaProgramada: true } }),
          prisma.servicioEspecial.findFirst({ where: { AND: [where, { fechaProgramada: null }] }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        ]);
        const fechas = [programada?.fechaProgramada, creada?.createdAt].filter((f): f is Date => !!f);
        return fechas.length ? new Date(Math.min(...fechas.map((f) => f.getTime()))) : null;
      },
    },
    columnas: [
      { nombre: 'id', tipo: 'STRING' },
      { nombre: 'clientUuid', tipo: 'STRING' },
      { nombre: 'codigoSE', tipo: 'STRING' },
      { nombre: 'ordenTrabajoOT', tipo: 'STRING' },
      { nombre: 'tipoServicio', tipo: 'STRING' },
      { nombre: 'servicioCatalogoId', tipo: 'INT32' },
      { nombre: 'precio', tipo: 'DOUBLE' },
      { nombre: 'clienteNombre', tipo: 'STRING' },
      { nombre: 'cliente', tipo: 'STRING' },
      { nombre: 'placa', tipo: 'STRING' },
      { nombre: 'marca', tipo: 'STRING' },
      { nombre: 'modelo', tipo: 'STRING' },
      { nombre: 'color', tipo: 'STRING' },
      { nombre: 'prioridad', tipo: 'STRING' },
      { nombre: 'estado', tipo: 'STRING' },
      { nombre: 'agenciaId', tipo: 'STRING' },
      { nombre: 'operadorId', tipo: 'STRING' },
      { nombre: 'creadoPorId', tipo: 'STRING' },
      { nombre: 'creadoPorNombre', tipo: 'STRING' },
      { nombre: 'bahiaId', tipo: 'STRING' },
      { nombre: 'regionId', tipo: 'STRING' },
      { nombre: 'regionNombre', tipo: 'STRING' },
      { nombre: 'fechaProgramada', tipo: 'TIMESTAMP' },
      { nombre: 'horaIngreso', tipo: 'STRING' },
      { nombre: 'horaEstimada', tipo: 'STRING' },
      { nombre: 'fechaInicio', tipo: 'TIMESTAMP' },
      { nombre: 'fechaFin', tipo: 'TIMESTAMP' },
      { nombre: 'videoInicialUrl', tipo: 'STRING' },
      { nombre: 'videoFinalUrl', tipo: 'STRING' },
      { nombre: 'tiempoPausaTotalSeg', tipo: 'INT32' },
      { nombre: 'tiempoEfectivoSeg', tipo: 'INT32' },
      { nombre: 'fechaUltimaPausa', tipo: 'TIMESTAMP' },
      { nombre: 'motivoUltimaPausa', tipo: 'STRING' },
      { nombre: 'videoUltimaPausaUrl', tipo: 'STRING' },
      { nombre: 'videoPausaUrl', tipo: 'STRING' },
      { nombre: 'videoUltimaReanudacionUrl', tipo: 'STRING' },
      { nombre: 'videoReanudacionUrl', tipo: 'STRING' },
      { nombre: 'historialPausas', tipo: 'STRING', json: true },
      { nombre: 'recetaInsumos', tipo: 'STRING', json: true },
      { nombre: 'evidencias', tipo: 'STRING', json: true },
      { nombre: 'notasOperador', tipo: 'STRING' },
      { nombre: 'observaciones', tipo: 'STRING' },
      { nombre: 'calificacionCalidad', tipo: 'INT32' },
      { nombre: 'syncedAt', tipo: 'TIMESTAMP' },
      { nombre: 'version', tipo: 'INT32' },
      { nombre: 'deletedAt', tipo: 'TIMESTAMP' },
      { nombre: 'createdAt', tipo: 'TIMESTAMP' },
      { nombre: 'updatedAt', tipo: 'TIMESTAMP' },
      { nombre: 'fechaEvento', tipo: 'TIMESTAMP' },
    ],
    hijos: [
      {
        tabla: 'consumo_servicio_especial',
        modelo: 'consumoServicioEspecial',
        fk: 'servicioEspecialId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'servicioEspecialId', tipo: 'STRING' },
          { nombre: 'insumoId', tipo: 'STRING' },
          { nombre: 'cantidadUsada', tipo: 'DOUBLE' },
          { nombre: 'pulidorId', tipo: 'STRING' },
          { nombre: 'insumoNombre', tipo: 'STRING' },
          { nombre: 'insumoSKU', tipo: 'STRING' },
          { nombre: 'unidadSimbolo', tipo: 'STRING' },
          { nombre: 'costoUnitarioUSD', tipo: 'DOUBLE' },
          { nombre: 'costoTotalUSD', tipo: 'DOUBLE' },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
      {
        tabla: 'servicio_especial_operador',
        modelo: 'servicioEspecialOperador',
        fk: 'servicioId',
        columnas: [
          { nombre: 'id', tipo: 'STRING' },
          { nombre: 'servicioId', tipo: 'STRING' },
          { nombre: 'operadorId', tipo: 'STRING' },
          { nombre: 'orden', tipo: 'INT32' },
          { nombre: 'createdAt', tipo: 'TIMESTAMP' },
        ],
      },
    ],
  },
];

export const TABLAS_ARCHIVABLES: TablaArchivable[] = [...TABLAS_SYNC_Y_AVISOS, ...TABLAS_OPERACION];

export const TABLAS_PURGABLES: TablaPurgable[] = [
  { tabla: 'login_intento', modelo: 'loginIntento', ventanaDias: 30, donde: (corte) => ({ desde: { lt: corte } }) },
  { tabla: 'limite_solicitud', modelo: 'limiteSolicitud', ventanaDias: 30, donde: (corte) => ({ expiraEn: { lt: corte } }) },
  {
    tabla: 'refresh_session',
    modelo: 'refreshSession',
    ventanaDias: 30,
    // Vencida o revocada hace más de 30 días: ya no sirve para renovar nada.
    donde: (corte) => ({ OR: [{ expiresAt: { lt: corte } }, { revokedAt: { lt: corte } }] }),
  },
];
