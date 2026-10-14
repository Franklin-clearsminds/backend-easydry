/**
 * Catálogo de Reportes Operativos. Cada reporte declara qué permisos exige, si es por periodo o una foto del estado actual, qué
 * filtros propios acepta, sus columnas y sus totales. Agregar un reporte nuevo es agregar una entrada aquí y su consulta en el
 * servicio: la pantalla y los archivos exportados se arman solos a partir de esta definición.
 */

export type TipoColumna = 'texto' | 'numero' | 'dinero' | 'fecha' | 'hora' | 'marca';
export type FiltroExtra = 'estado' | 'lavador' | 'producto' | 'ubicacion' | 'semaforo';
export type PlantillaReporte = 'CONTROL_ESPECIAL' | 'CONTROL_GENERAL' | 'TABLA';
export type ValorCelda = string | number | null;
export type FilaReporte = Record<string, ValorCelda>;

export interface ColumnaDef {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
  /** Peso relativo del ancho en el PDF y el Excel. */
  ancho: number;
  /** Solo la ve quien tiene `precios.ver`. */
  soloPrecios?: boolean;
}

export interface OpcionFiltro {
  valor: string;
  etiqueta: string;
}

export interface TotalReporte {
  clave: string;
  etiqueta: string;
  valor: number;
  tipo: 'numero' | 'dinero';
}

export interface ReporteDef {
  id: string;
  nombre: string;
  modulo: string;
  descripcion: string;
  /** Basta uno de estos permisos del módulo. */
  permisos: string[];
  /** Además de los anteriores, hacen falta todos estos (p. ej. los precios). */
  permisosTodos?: string[];
  /** true = se filtra por fecha; false = foto con los datos de hoy. */
  periodo: boolean;
  /** AGENCIA = una hoja/sección por agencia; UNICO = una sola lista. */
  agrupar: 'AGENCIA' | 'UNICO';
  plantilla: PlantillaReporte;
  extras: FiltroExtra[];
  /** Opciones del filtro «estado» (también las del semáforo en 5S). */
  estados?: OpcionFiltro[];
  columnas: ColumnaDef[];
  totales: (filas: FilaReporte[]) => TotalReporte[];
}

const cuenta = (filas: FilaReporte[]): TotalReporte => ({ clave: 'total', etiqueta: 'Total de registros', valor: filas.length, tipo: 'numero' });
const contar = (filas: FilaReporte[], clave: string, valor: ValorCelda): number => filas.filter((f) => f[clave] === valor).length;
const sumar = (filas: FilaReporte[], clave: string): number => Math.round(filas.reduce((acc, f) => acc + (Number(f[clave]) || 0), 0) * 100) / 100;

const col = (clave: string, titulo: string, tipo: TipoColumna, ancho: number, extra: Partial<ColumnaDef> = {}): ColumnaDef => ({ clave, titulo, tipo, ancho, ...extra });

/** Columna «Ord.» que el servicio numera por bloque. */
const ORD = col('ord', 'Ord.', 'numero', 5.5);

const ESTADOS_SERVICIO: OpcionFiltro[] = [
  { valor: 'EN_ESPERA', etiqueta: 'En espera' },
  { valor: 'EN_PROCESO', etiqueta: 'En proceso' },
  { valor: 'FINALIZADO', etiqueta: 'Finalizado' },
  { valor: 'APROBADO', etiqueta: 'Aprobado' },
  { valor: 'RECHAZADO', etiqueta: 'Rechazado' },
  { valor: 'CANCELADO', etiqueta: 'Cancelado' },
];

const totalesServicios = (filas: FilaReporte[]): TotalReporte[] => [
  cuenta(filas),
  { clave: 'realizados', etiqueta: 'Realizados', valor: contar(filas, 'realizado', 'SI'), tipo: 'numero' },
  { clave: 'noRealizados', etiqueta: 'No realizados', valor: contar(filas, 'realizado', 'NO'), tipo: 'numero' },
  { clave: 'aprobados', etiqueta: 'Aprobados', valor: contar(filas, 'aprobado', 'SI'), tipo: 'numero' },
  { clave: 'rechazados', etiqueta: 'Rechazados', valor: contar(filas, 'aprobado', 'NO'), tipo: 'numero' },
  { clave: 'monto', etiqueta: 'Monto', valor: sumar(filas, 'precio'), tipo: 'dinero' },
];

export const REPORTES: readonly ReporteDef[] = [
  {
    id: 'agencias-listado',
    nombre: 'Listado de agencias',
    modulo: 'Mapa de agencias',
    descripcion: 'Agencias con su región, cliente, contacto, bahías y estado.',
    permisos: ['mapa.ver', 'agencias.consultar'],
    periodo: false,
    agrupar: 'UNICO',
    plantilla: 'TABLA',
    extras: [],
    columnas: [
      col('codigo', 'Código', 'texto', 9),
      col('agencia', 'Agencia', 'texto', 18),
      col('region', 'Región', 'texto', 12),
      col('cliente', 'Cliente', 'texto', 14),
      col('direccion', 'Dirección', 'texto', 22),
      col('telefono', 'Teléfono', 'texto', 11),
      col('responsable', 'Responsable', 'texto', 16),
      col('bahias', 'Bahías', 'numero', 6),
      col('especiales', 'Serv. especiales', 'texto', 9),
      col('estado', 'Estado', 'texto', 8),
    ],
    totales: (f) => [cuenta(f), { clave: 'activas', etiqueta: 'Activas', valor: contar(f, 'estado', 'Activa'), tipo: 'numero' }, { clave: 'bahias', etiqueta: 'Bahías', valor: sumar(f, 'bahias'), tipo: 'numero' }],
  },
  {
    id: 'lavadores-listado',
    nombre: 'Listado de lavadores',
    modulo: 'Gestión de lavadores',
    descripcion: 'Lavadores y su agencia, región y estado.',
    permisos: ['operadores.ver'],
    periodo: false,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: [],
    columnas: [
      ORD,
      col('nombre', 'Nombre', 'texto', 22),
      col('rol', 'Rol', 'texto', 12),
      col('bahia', 'Bahía', 'texto', 14),
      col('estado', 'Estado', 'texto', 9),
    ],
    totales: (f) => [cuenta(f), { clave: 'activos', etiqueta: 'Activos', valor: contar(f, 'estado', 'Activo'), tipo: 'numero' }],
  },
  {
    id: 'servicios-generales',
    nombre: 'Servicios generales',
    modulo: 'Servicios de lavado',
    descripcion: 'Control de servicios de lavado realizados en el periodo.',
    permisos: ['servicios.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'CONTROL_GENERAL',
    extras: ['estado', 'lavador'],
    estados: ESTADOS_SERVICIO,
    columnas: [
      col('ot', 'OT', 'texto', 11),
      col('fecha', 'Fecha', 'fecha', 11),
      col('horaIngreso', 'Ingreso', 'hora', 9.5),
      col('horaSalida', 'Salida', 'hora', 9.5),
      col('placa', 'Placa', 'texto', 11.5),
      col('marca', 'Marca', 'texto', 11),
      col('modelo', 'Modelo', 'texto', 10),
      col('color', 'Color', 'texto', 8),
      col('servicio', 'Tipo de servicio', 'texto', 13),
      col('lavador', 'Lavador', 'texto', 13),
      col('observacion', 'Observación', 'texto', 14),
      col('realizado', 'Realizado', 'marca', 11),
      col('aprobado', 'Aprobado', 'marca', 11),
      col('aprobadoPor', 'Aprobado por', 'texto', 15),
      col('precio', 'Precio', 'dinero', 9, { soloPrecios: true }),
      col('firma', 'Firma', 'texto', 9),
    ],
    totales: totalesServicios,
  },
  {
    id: 'servicios-especiales',
    nombre: 'Servicios especiales',
    modulo: 'Servicios de lavado',
    descripcion: 'Control de servicios especiales (pulido, cerámico, motor…) del periodo.',
    permisos: ['especiales.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'CONTROL_ESPECIAL',
    extras: ['estado'],
    estados: [
      { valor: 'Pendiente', etiqueta: 'Pendiente' },
      { valor: 'En Proceso', etiqueta: 'En proceso' },
      { valor: 'Completado', etiqueta: 'Completado' },
      { valor: 'Cancelado', etiqueta: 'Cancelado' },
    ],
    columnas: [
      col('ot', 'OT', 'texto', 11),
      col('fecha', 'Fecha', 'fecha', 11),
      col('horaIngreso', 'Ingreso', 'hora', 9.5),
      col('horaSalida', 'Salida', 'hora', 9.5),
      col('placa', 'Placa', 'texto', 11.5),
      col('marca', 'Marca', 'texto', 11),
      col('modelo', 'Modelo', 'texto', 10),
      col('color', 'Color', 'texto', 8),
      col('servicio', 'Tipo de servicio', 'texto', 13),
      col('asesor', 'Asesor', 'texto', 13),
      col('observacion', 'Observación', 'texto', 14),
      col('realizado', 'Realizado', 'marca', 11),
      col('aprobado', 'Aprobado', 'marca', 11),
      col('aprobadoPor', 'Aprobado por', 'texto', 15),
      col('precio', 'Precio', 'dinero', 9, { soloPrecios: true }),
      col('firma', 'Firma', 'texto', 9),
    ],
    totales: totalesServicios,
  },
  {
    id: 'catalogo-precios',
    nombre: 'Catálogo de servicios y precios',
    modulo: 'Servicios de lavado',
    descripcion: 'Servicios que ofrece cada agencia con su precio vigente.',
    permisos: ['catalogo.ver'],
    permisosTodos: ['precios.ver'],
    periodo: false,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: [],
    columnas: [
      ORD,
      col('codigo', 'Código', 'texto', 9),
      col('servicio', 'Servicio', 'texto', 22),
      col('categoria', 'Categoría', 'texto', 11),
      col('tiempo', 'Tiempo (min)', 'numero', 9),
      col('precioGlobal', 'Precio general', 'dinero', 10),
      col('precioAgencia', 'Precio agencia', 'dinero', 10),
      col('precioVigente', 'Precio vigente', 'dinero', 10),
      col('origen', 'Origen', 'texto', 9),
    ],
    totales: (f) => [cuenta(f), { clave: 'personalizados', etiqueta: 'Con precio propio', valor: contar(f, 'origen', 'Agencia'), tipo: 'numero' }],
  },
  {
    id: 'maquinaria-asignada',
    nombre: 'Maquinaria asignada',
    modulo: 'Gestión de maquinaria',
    descripcion: 'Máquinas de cada agencia con su estado y responsable.',
    permisos: ['maquinaria.ver'],
    periodo: false,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: [],
    columnas: [
      ORD,
      col('codigo', 'Código', 'texto', 9),
      col('nombre', 'Máquina', 'texto', 16),
      col('tipo', 'Tipo', 'texto', 11),
      col('marca', 'Marca', 'texto', 10),
      col('modelo', 'Modelo', 'texto', 10),
      col('serie', 'Serie', 'texto', 10),
      col('bahia', 'Bahía', 'texto', 11),
      col('responsable', 'Responsable', 'texto', 14),
      col('estado', 'Estado', 'texto', 11),
      col('horas', 'Horas de uso', 'numero', 7),
    ],
    totales: (f) => [cuenta(f), { clave: 'operativas', etiqueta: 'Operativas', valor: contar(f, 'estado', 'Operativa'), tipo: 'numero' }],
  },
  {
    id: 'incidentes',
    nombre: 'Incidentes de maquinaria',
    modulo: 'Gestión de maquinaria',
    descripcion: 'Incidentes reportados en el periodo.',
    permisos: ['incidentes.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['estado'],
    estados: [
      { valor: 'ABIERTO', etiqueta: 'Abierto' },
      { valor: 'EN_PROCESO', etiqueta: 'En proceso' },
      { valor: 'RESUELTO', etiqueta: 'Resuelto' },
      { valor: 'CANCELADO', etiqueta: 'Cancelado' },
    ],
    columnas: [
      ORD,
      col('fecha', 'Fecha', 'fecha', 9),
      col('maquina', 'Máquina', 'texto', 15),
      col('titulo', 'Incidente', 'texto', 20),
      col('gravedad', 'Gravedad', 'texto', 8),
      col('estado', 'Estado', 'texto', 9),
      col('reportadoPor', 'Reportado por', 'texto', 14),
      col('tecnico', 'Técnico', 'texto', 14),
      col('fechaSolucion', 'Solución', 'fecha', 9),
      col('costo', 'Costo', 'dinero', 8, { soloPrecios: true }),
    ],
    totales: (f) => [
      cuenta(f),
      { clave: 'abiertos', etiqueta: 'Abiertos', valor: f.filter((x) => x.estado === 'Abierto' || x.estado === 'En proceso').length, tipo: 'numero' },
      { clave: 'resueltos', etiqueta: 'Resueltos', valor: contar(f, 'estado', 'Resuelto'), tipo: 'numero' },
      { clave: 'costo', etiqueta: 'Costo', valor: sumar(f, 'costo'), tipo: 'dinero' },
    ],
  },
  {
    id: 'mantenimientos',
    nombre: 'Mantenimientos',
    modulo: 'Gestión de maquinaria',
    descripcion: 'Mantenimientos programados y ejecutados en el periodo.',
    permisos: ['mantenimientos.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['estado'],
    estados: [
      { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
      { valor: 'EN_PROCESO', etiqueta: 'En proceso' },
      { valor: 'FINALIZADO', etiqueta: 'Finalizado' },
    ],
    columnas: [
      ORD,
      col('fecha', 'Fecha', 'fecha', 9),
      col('maquina', 'Máquina', 'texto', 15),
      col('tipo', 'Tipo', 'texto', 10),
      col('estado', 'Estado', 'texto', 9),
      col('tecnico', 'Técnico', 'texto', 14),
      col('observaciones', 'Observaciones', 'texto', 22),
      col('proximo', 'Próximo', 'fecha', 9),
      col('costo', 'Costo', 'dinero', 8, { soloPrecios: true }),
    ],
    totales: (f) => [
      cuenta(f),
      { clave: 'finalizados', etiqueta: 'Finalizados', valor: contar(f, 'estado', 'Finalizado'), tipo: 'numero' },
      { clave: 'costo', etiqueta: 'Costo', valor: sumar(f, 'costo'), tipo: 'dinero' },
    ],
  },
  {
    id: 'insumos-inventario',
    nombre: 'Inventario completo de insumos',
    modulo: 'Gestión de insumos',
    descripcion: 'Catálogo de insumos con el stock total de las ubicaciones elegidas.',
    permisos: ['inventario.ver'],
    periodo: false,
    agrupar: 'UNICO',
    plantilla: 'TABLA',
    extras: [],
    columnas: [
      ORD,
      col('sku', 'SKU', 'texto', 9),
      col('insumo', 'Insumo', 'texto', 22),
      col('categoria', 'Categoría', 'texto', 14),
      col('unidad', 'Unidad', 'texto', 8),
      col('stock', 'Stock', 'numero', 8),
      col('costo', 'Costo unit.', 'dinero', 8, { soloPrecios: true }),
      col('valor', 'Valor en stock', 'dinero', 9, { soloPrecios: true }),
      col('estado', 'Estado', 'texto', 8),
    ],
    totales: (f) => [cuenta(f), { clave: 'valor', etiqueta: 'Valor en stock', valor: sumar(f, 'valor'), tipo: 'dinero' }],
  },
  {
    id: 'stock-ubicacion',
    nombre: 'Stock por agencia, pulidor o bodega',
    modulo: 'Gestión de insumos',
    descripcion: 'Existencias por ubicación, con las que están bajo el mínimo marcadas.',
    permisos: ['inventario.ver'],
    periodo: false,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['ubicacion'],
    columnas: [
      ORD,
      col('sku', 'SKU', 'texto', 9),
      col('insumo', 'Insumo', 'texto', 22),
      col('ubicacion', 'Ubicación', 'texto', 16),
      col('unidad', 'Unidad', 'texto', 8),
      col('cantidad', 'Cantidad', 'numero', 8),
      col('minimo', 'Mínimo', 'numero', 8),
      col('situacion', 'Situación', 'texto', 10),
    ],
    totales: (f) => [cuenta(f), { clave: 'bajos', etiqueta: 'Bajo el mínimo', valor: contar(f, 'situacion', 'Bajo mínimo'), tipo: 'numero' }],
  },
  {
    id: 'alertas-stock',
    nombre: 'Alertas de stock',
    modulo: 'Gestión de insumos',
    descripcion: 'Alertas de stock abiertas (o del estado que elijas).',
    permisos: ['alertas.ver'],
    periodo: false,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['estado'],
    estados: [
      { valor: 'PENDIENTE', etiqueta: 'Pendiente' },
      { valor: 'EN_PROCESO', etiqueta: 'En proceso' },
      { valor: 'DESPACHADO', etiqueta: 'Despachado' },
      { valor: 'RESUELTO', etiqueta: 'Resuelto' },
    ],
    columnas: [
      ORD,
      col('fecha', 'Fecha', 'fecha', 9),
      col('insumo', 'Insumo', 'texto', 20),
      col('nivel', 'Nivel', 'texto', 9),
      col('estado', 'Estado', 'texto', 10),
      col('stock', 'Stock reportado', 'numero', 9),
      col('emisor', 'Emitida por', 'texto', 14),
      col('mensaje', 'Mensaje', 'texto', 22),
    ],
    totales: (f) => [cuenta(f), { clave: 'agotados', etiqueta: 'Agotados', valor: contar(f, 'nivel', 'Agotado'), tipo: 'numero' }, { clave: 'criticos', etiqueta: 'Críticos', valor: contar(f, 'nivel', 'Crítico'), tipo: 'numero' }],
  },
  {
    id: 'kardex',
    nombre: 'Kardex de un producto',
    modulo: 'Gestión de insumos',
    descripcion: 'Movimientos de un insumo por ubicación en el periodo.',
    permisos: ['inventario.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['producto'],
    columnas: [
      ORD,
      col('fecha', 'Fecha', 'fecha', 9),
      col('hora', 'Hora', 'hora', 7),
      col('movimiento', 'Movimiento', 'texto', 16),
      col('cantidad', 'Cantidad', 'numero', 8),
      col('anterior', 'Stock anterior', 'numero', 9),
      col('posterior', 'Stock posterior', 'numero', 9),
      col('costo', 'Costo total', 'dinero', 9, { soloPrecios: true }),
      col('usuario', 'Usuario', 'texto', 16),
    ],
    totales: (f) => [
      cuenta(f),
      { clave: 'entradas', etiqueta: 'Entradas', valor: Math.round(f.reduce((a, x) => a + Math.max(Number(x.cantidad) || 0, 0), 0) * 1000) / 1000, tipo: 'numero' },
      { clave: 'salidas', etiqueta: 'Salidas', valor: Math.round(f.reduce((a, x) => a + Math.abs(Math.min(Number(x.cantidad) || 0, 0)), 0) * 1000) / 1000, tipo: 'numero' },
    ],
  },
  {
    id: 'informes-inspeccion',
    nombre: 'Informes de inspección',
    modulo: 'Auditorías',
    descripcion: 'Informes de inspección del periodo.',
    permisos: ['informes.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['estado'],
    estados: [
      { valor: 'BORRADOR', etiqueta: 'Borrador' },
      { valor: 'EN_REVISION', etiqueta: 'En revisión' },
      { valor: 'PENDIENTE_FIRMAS', etiqueta: 'Pendiente de firmas' },
      { valor: 'APROBADO', etiqueta: 'Aprobado' },
      { valor: 'RECHAZADO', etiqueta: 'Rechazado' },
      { valor: 'CERRADO', etiqueta: 'Cerrado' },
    ],
    columnas: [
      ORD,
      col('numero', 'N.º', 'texto', 10),
      col('fecha', 'Fecha', 'fecha', 9),
      col('tipo', 'Tipo', 'texto', 12),
      col('estado', 'Estado', 'texto', 11),
      col('inspector', 'Inspector', 'texto', 15),
      col('destinatario', 'Para', 'texto', 15),
      col('asunto', 'Asunto', 'texto', 22),
      col('calificacion', 'Calificación', 'texto', 10),
    ],
    totales: (f) => [cuenta(f), { clave: 'aprobados', etiqueta: 'Aprobados o cerrados', valor: f.filter((x) => x.estado === 'Aprobado' || x.estado === 'Cerrado').length, tipo: 'numero' }],
  },
  {
    id: 'auditorias-5s',
    nombre: 'Auditorías 5S',
    modulo: 'Auditorías',
    descripcion: 'Auditorías 5S del periodo con su puntaje y semáforo.',
    permisos: ['inspecciones.ver'],
    periodo: true,
    agrupar: 'AGENCIA',
    plantilla: 'TABLA',
    extras: ['estado', 'semaforo'],
    estados: [
      { valor: 'BORRADOR', etiqueta: 'Borrador' },
      { valor: 'EN_PROCESO', etiqueta: 'En proceso' },
      { valor: 'FINALIZADA', etiqueta: 'Finalizada' },
      { valor: 'CERRADA', etiqueta: 'Cerrada' },
    ],
    columnas: [
      ORD,
      col('codigo', 'Código', 'texto', 10),
      col('fecha', 'Fecha', 'fecha', 9),
      col('area', 'Área', 'texto', 13),
      col('formato', 'Formato', 'texto', 12),
      col('auditor', 'Auditor', 'texto', 15),
      col('estado', 'Estado', 'texto', 10),
      col('puntaje', 'Puntaje', 'numero', 7),
      col('porcentaje', '% Cumpl.', 'numero', 7),
      col('semaforo', 'Semáforo', 'texto', 9),
    ],
    totales: (f) => [
      cuenta(f),
      { clave: 'verdes', etiqueta: 'Verde', valor: contar(f, 'semaforo', 'Verde'), tipo: 'numero' },
      { clave: 'amarillos', etiqueta: 'Amarillo', valor: contar(f, 'semaforo', 'Amarillo'), tipo: 'numero' },
      { clave: 'rojos', etiqueta: 'Rojo', valor: contar(f, 'semaforo', 'Rojo'), tipo: 'numero' },
    ],
  },
];

export const SEMAFOROS_5S: OpcionFiltro[] = [
  { valor: 'VERDE', etiqueta: 'Verde' },
  { valor: 'AMARILLO', etiqueta: 'Amarillo' },
  { valor: 'ROJO', etiqueta: 'Rojo' },
];

export const UBICACIONES_STOCK: OpcionFiltro[] = [
  { valor: 'AGENCIA', etiqueta: 'Agencia' },
  { valor: 'PULIDOR', etiqueta: 'Pulidor' },
  { valor: 'BODEGA', etiqueta: 'Bodega' },
];

export const reportePorId = (id: string): ReporteDef | undefined => REPORTES.find((r) => r.id === id);

/** Columnas que el usuario puede ver: sin `precios.ver` desaparecen las de dinero marcadas como sensibles. */
export const columnasVisibles = (def: ReporteDef, verPrecios: boolean): ColumnaDef[] => def.columnas.filter((c) => verPrecios || !c.soloPrecios);
