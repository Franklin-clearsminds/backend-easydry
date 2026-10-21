/**
 * Reglas puras de la Auditoría 5S (sin base de datos). Hay tres formatos, cada uno con su propio catálogo de preguntas; el catálogo
 * vive aquí (única copia): la web y la app lo leen del servidor (`auditorias-5s/catalogo`).
 *
 *  - LISTA_20  «Check list de auditoría 5S – área de lavado de autos»: 20 criterios, puntaje 0 a 5, máximo 100.
 *  - PUNTOS_25 «Auditoría 5S»: 25 criterios (5 por cada S), puntaje 0 a 4, máximo 100, con subtotales y comparación con la anterior.
 *  - SI_NO_50  Cuestionario SI / NO: 10 preguntas por cada S (50). Cada pregunta tiene una respuesta favorable (SI o NO).
 */

export const AREAS_5S = ['LAVADO', 'ASPIRADO', 'SECADO', 'ALMACENAMIENTO', 'ADMINISTRACION'] as const;
/** «GENERAL» es el área de las auditorías que no indican una (el formulario ya no la pide). */
export const AREA_GENERAL = 'GENERAL';
export const ETIQUETA_AREA: Record<string, string> = {
  GENERAL: 'General',
  LAVADO: 'Lavado',
  ASPIRADO: 'Aspirado',
  SECADO: 'Secado',
  ALMACENAMIENTO: 'Almacenamiento',
  ADMINISTRACION: 'Administración',
};

export const ESTADOS_AUDITORIA_5S = ['BORRADOR', 'EN_PROCESO', 'FINALIZADA', 'CERRADA'] as const;
export type EstadoAuditoria5s = (typeof ESTADOS_AUDITORIA_5S)[number];
/** Quien no puede auditar solo ve el resultado: las auditorías ya finalizadas o cerradas. */
export const ESTADOS_RESULTADO_5S: readonly EstadoAuditoria5s[] = ['FINALIZADA', 'CERRADA'];

/** El responsable de una acción es siempre la agencia auditada y su fecha es la de creación: no hay estado «vencida». */
export const ESTADOS_ACCION = ['PENDIENTE', 'EN_PROCESO', 'EN_VERIFICACION', 'CERRADA'] as const;
export const ESTADOS_ACCION_ABIERTA = ['PENDIENTE', 'EN_PROCESO', 'EN_VERIFICACION'] as const;

export type CategoriaId = 'SEIRI' | 'SEITON' | 'SEISO' | 'SEIKETSU' | 'SHITSUKE';
/** Las cinco S son las mismas en los tres formatos (cambia cómo se llaman): así se pueden comparar. */
export const CATEGORIAS_IDS: readonly CategoriaId[] = ['SEIRI', 'SEITON', 'SEISO', 'SEIKETSU', 'SHITSUKE'];

export interface Categoria5s {
  id: CategoriaId;
  nombre: string;
  traduccion: string;
}

export interface Criterio5s {
  numero: number;
  categoria: CategoriaId;
  descripcion: string;
  /** Solo en el formato SI/NO: la respuesta que cumple (p. ej. «¿Hay cosas inútiles…?» cumple con NO). */
  favorable?: 'SI' | 'NO';
}

export const FORMATOS_5S = ['LISTA_20', 'PUNTOS_25', 'SI_NO_50'] as const;
export type FormatoId = (typeof FORMATOS_5S)[number];

export interface Formato5s {
  id: FormatoId;
  nombre: string;
  descripcion: string;
  /** PUNTAJE: un valor de 0 a `maxCriterio`. SI_NO: se guarda 1 (SI) o 0 (NO). */
  tipo: 'PUNTAJE' | 'SI_NO';
  /** Lo que vale un criterio cumplido por completo. */
  maxCriterio: number;
  escala: { valor: number; descripcion: string }[];
  categorias: Categoria5s[];
  criterios: Criterio5s[];
  /** Nota al pie del formato original (si la tiene). */
  nota?: string;
}

const SEIS: Record<CategoriaId, string> = { SEIRI: 'Clasificar', SEITON: 'Ordenar', SEISO: 'Limpiar', SEIKETSU: 'Estandarizar', SHITSUKE: 'Disciplinar' };
const nombresJaponeses: Categoria5s[] = [
  { id: 'SEIRI', nombre: 'Seiri', traduccion: SEIS.SEIRI },
  { id: 'SEITON', nombre: 'Seiton', traduccion: SEIS.SEITON },
  { id: 'SEISO', nombre: 'Seiso', traduccion: SEIS.SEISO },
  { id: 'SEIKETSU', nombre: 'Seiketsu', traduccion: SEIS.SEIKETSU },
  { id: 'SHITSUKE', nombre: 'Shitsuke', traduccion: SEIS.SHITSUKE },
];

/** Numera de corrido los criterios de cada categoría, en el orden en que se declaran. */
function numerar(grupos: [CategoriaId, (string | [string, 'SI' | 'NO'])[]][]): Criterio5s[] {
  let n = 0;
  return grupos.flatMap(([categoria, textos]) =>
    textos.map((t) => {
      n += 1;
      return Array.isArray(t) ? { numero: n, categoria, descripcion: t[0], favorable: t[1] } : { numero: n, categoria, descripcion: t };
    }),
  );
}

const ESCALA_0_5 = [
  { valor: 0, descripcion: 'Sin cumplimiento' },
  { valor: 1, descripcion: 'Cumplimiento muy bajo' },
  { valor: 2, descripcion: 'Cumplimiento bajo' },
  { valor: 3, descripcion: 'Cumplimiento parcial' },
  { valor: 4, descripcion: 'Cumplimiento alto' },
  { valor: 5, descripcion: 'Cumplimiento completo' },
];

const LISTA_20: Formato5s = {
  id: 'LISTA_20',
  nombre: 'Check list 5S — área de lavado (20 criterios)',
  descripcion: '20 criterios, 4 por cada S, puntaje de 0 a 5. Máximo 100 puntos.',
  tipo: 'PUNTAJE',
  maxCriterio: 5,
  escala: ESCALA_0_5,
  categorias: nombresJaponeses,
  criterios: numerar([
    ['SEIRI', [
      'No existen herramientas, productos o materiales innecesarios en la zona de trabajo.',
      'Los productos químicos están identificados y separados de materiales no relacionados.',
      'Se retiraron envases vacíos, dañados o sin uso.',
      'Los equipos fuera de servicio están identificados y gestionados.',
    ]],
    ['SEITON', [
      'Cada herramienta tiene un lugar definido y señalizado.',
      'Las mangueras, cables y extensiones se almacenan sin generar riesgo de tropiezo.',
      'Los productos de lavado están ubicados según frecuencia y tipo de uso.',
      'Las áreas de tránsito y circulación están despejadas.',
    ]],
    ['SEISO', [
      'Pisos, canaletas y zonas de lavado permanecen libres de residuos.',
      'Equipos de lavado, aspiradoras y herramientas se limpian después de su uso.',
      'Paños, microfibras y accesorios están limpios y correctamente almacenados.',
      'No existen fugas visibles de agua, químicos o aceites sin gestionar.',
    ]],
    ['SEIKETSU', [
      'Existen procedimientos o instructivos visibles para actividades críticas.',
      'Se utilizan señalizaciones y códigos visuales para ordenar materiales y herramientas.',
      'Existe una rutina definida de limpieza y revisión del área.',
      'Los responsables conocen estándares de calidad y tiempos de servicio.',
    ]],
    ['SHITSUKE', [
      'El personal cumple consistentemente los estándares establecidos.',
      'Se realizan inspecciones o autoinspecciones periódicas.',
      'Las acciones correctivas anteriores se mantienen cerradas y verificadas.',
      'El personal mantiene hábitos de orden, limpieza, seguridad y cuidado del vehículo.',
    ]],
  ]),
};

const PUNTOS_25: Formato5s = {
  id: 'PUNTOS_25',
  nombre: 'Auditoría 5S (25 criterios, 0 a 4)',
  descripcion: '25 criterios, 5 por cada S, puntaje de 0 a 4, con subtotal por S y comparación con la auditoría anterior. Máximo 100 puntos.',
  tipo: 'PUNTAJE',
  maxCriterio: 4,
  escala: [
    { valor: 0, descripcion: 'Ningún cumplimiento' },
    { valor: 1, descripcion: 'Cumplimiento muy escaso' },
    { valor: 2, descripcion: 'Cierto grado de cumplimiento' },
    { valor: 3, descripcion: 'Cumplimiento significativo' },
    { valor: 4, descripcion: 'Cumplimiento total' },
  ],
  nota: 'En el criterio 24, si la puntuación sigue siendo la misma que en la auditoría anterior, puntuación 2 (salvo que sea 4).',
  categorias: [
    { id: 'SEIRI', nombre: 'Clasificar', traduccion: 'Determinar el estado necesario y mejorar el resto' },
    { id: 'SEITON', nombre: 'Ordenar', traduccion: 'Un lugar para cada cosa y cada cosa en su sitio' },
    { id: 'SEISO', nombre: 'Limpiar', traduccion: 'Organizar y clasificar, o intentar mantener el orden' },
    { id: 'SEIKETSU', nombre: 'Estandarizar', traduccion: 'Asegurarse de que se mantienen los estándares' },
    { id: 'SHITSUKE', nombre: 'Mantener', traduccion: 'Conservar los estándares y buscar mejoras constantemente' },
  ],
  criterios: numerar([
    ['SEIRI', [
      '¿Se han retirado de la zona todos los artículos innecesarios (herramientas, equipos, cajas, etc.)?',
      '¿Están todos los artículos restantes (herramientas, equipos, carros, etc.) ordenados correctamente?',
      '¿Están las herramientas y los equipos en el lugar más conveniente, con las herramientas a mano y los puestos de trabajo de fácil acceso?',
      '¿Solo contienen artículos esenciales los armarios, los armarios de almacenamiento y otras zonas cerradas?',
      '¿Se gestiona correctamente la zona de cuarentena? (si no hay zona de cuarentena, puntuación cero)',
    ]],
    ['SEITON', [
      '¿Están los estantes y las zonas de almacenamiento claramente definidos y totalmente señalizados con indicadores de ubicación, etc.?',
      '¿Se utilizan, siempre que sea posible, paneles de herramientas, armarios para herramientas y otros sistemas de almacenamiento?',
      '¿Están los pasillos y las zonas de almacenamiento limpios, despejados y claramente señalizados?',
      '¿Se guardan los efectos personales en las taquillas disponibles? (si no hay taquillas, deben guardarse ordenadamente en la zona asignada)',
      'Equipo de seguridad: ¿Están los extintores y demás equipos en su sitio y son los adecuados?',
    ]],
    ['SEISO', [
      '¿Se mantienen los suelos limpios y ordenados, y en buen estado?',
      '¿Están limpios y ordenados todos los equipos de trabajo, sin acumulación de polvo, fugas visibles ni derrames evitables?',
      'Papeleras: ¿se mantienen correctamente y se vacían con regularidad?',
      'Puesto de limpieza: ¿están todos los artículos disponibles? (si no hay puesto, puntuación cero)',
      '¿Está limpio el equipo de limpieza y presenta un buen aspecto?',
    ]],
    ['SEIKETSU', [
      'Iluminación y calefacción: ¿son adecuadas para el trabajo que se realiza? ¿Hay goteras en el tejado?',
      '¿Se han establecido niveles de reposición, se han señalado claramente y se utilizan?',
      '¿Está disponible la información esencial para realizar el trabajo? (procedimientos normalizados de trabajo, programas, hojas de limpieza y comprobación)',
      '¿Están actualizados y son pertinentes todos los tablones de anuncios de la empresa? (sin incluir el tablón de 5S)',
      '¿Existen estándares 5S para el lugar de trabajo y están actualizados y son pertinentes para la zona?',
    ]],
    ['SHITSUKE', [
      '¿Hay listas de comprobación disponibles y se utilizan? ¿Se muestran los resultados de las auditorías? (no limitado a 5S)',
      'Tablón 5S: ¿está actualizado y se revisa con regularidad? (si no existe tablón = 0)',
      '¿Se han llevado a cabo las propuestas de acciones de mejora 5S?',
      '¿Se ha supervisado y mantenido/mejorado adecuadamente el estándar de la zona?*',
      'Formación de los empleados: ¿pueden las personas de la zona explicar las ventajas de 5S?',
    ]],
  ]),
};

const SI_NO_50: Formato5s = {
  id: 'SI_NO_50',
  nombre: 'Cuestionario 5S SI / NO (50 preguntas)',
  descripcion: '10 preguntas por cada S, respondidas con SI o NO. Cada pregunta indica cuál respuesta cumple. Máximo 50 respuestas favorables.',
  tipo: 'SI_NO',
  maxCriterio: 1,
  escala: [
    { valor: 1, descripcion: 'SI' },
    { valor: 0, descripcion: 'NO' },
  ],
  categorias: nombresJaponeses,
  criterios: numerar([
    ['SEIRI', [
      ['¿Hay cosas inútiles que pueden molestar en el entorno de trabajo?', 'NO'],
      ['¿Hay materias primas, semi elaborados o residuos en el entorno de trabajo?', 'NO'],
      ['¿Hay algún tipo de herramienta, tornillería, pieza de repuesto, útiles o similar en el entorno de trabajo?', 'NO'],
      ['¿Están todos los objetos de uso frecuente ordenados en su ubicación y correctamente identificados en el entorno laboral?', 'SI'],
      ['¿Están todos los objetos de medición en su ubicación y correctamente identificados en el entorno laboral?', 'SI'],
      ['¿Están todos los elementos de limpieza: trapos, escobas, guantes, productos en su ubicación y correctamente identificados?', 'SI'],
      ['¿Esta todo el mobiliario: mesas, sillas, armarios ubicados e identificados correctamente en el entorno de trabajo?', 'SI'],
      ['¿Existe maquinaria inutilizada en el entorno de trabajo?', 'NO'],
      ['¿Existen elementos inutilizados: pautas, herramientas, útiles o similares en el entorno de trabajo?', 'NO'],
      ['¿Están los elementos innecesarios identificados como tal?', 'SI'],
    ]],
    ['SEITON', [
      ['¿Están claramente definidos los pasillos, áreas de almacenamiento, lugares de trabajo?', 'SI'],
      ['¿Son necesarias todas las herramientas disponibles y fácilmente identificables?', 'SI'],
      ['¿Están diferenciados e identificados los materiales o semielaborados del producto final?', 'SI'],
      ['¿Están todos los materiales, palets, contenedores almacenados de forma adecuada?', 'SI'],
      ['¿Hay algún tipo de obstáculo cerca del elemento de extinción de incendios más cercano?', 'NO'],
      ['¿Tiene el suelo algún tipo de desperfecto: grietas, sobresalto…?', 'NO'],
      ['¿Están las estanterías u otras áreas de almacenamiento en el lugar adecuado y debidamente identificadas?', 'SI'],
      ['¿Tienen los estantes letreros identificatorios para conocer que materiales van depositados en ellos?', 'SI'],
      ['¿Están indicadas las cantidades máximas y mínimas admisibles y el formato de almacenamiento?', 'SI'],
      ['¿Hay líneas blancas u otros marcadores para indicar claramente los pasillos y áreas de almacenamiento?', 'SI'],
    ]],
    ['SEISO', [
      ['¡Revise cuidadosamente el suelo, los pasos de acceso y los alrededores de los equipos! ¿Puedes encontrar manchas de aceite, polvo o residuos?', 'NO'],
      ['¿Hay partes de las máquinas o equipos sucios? ¿Puedes encontrar manchas de aceite, polvo o residuos?', 'NO'],
      ['¿Está la tubería tanto de aire como eléctrica sucia, deteriorada; en general en mal estado?', 'NO'],
      ['¿Está el sistema de drenaje de los residuos de tinta o aceite obstruido (total o parcialmente)?', 'NO'],
      ['¿Hay elementos de la luminaria defectuoso (total o parcialmente)?', 'NO'],
      ['¿Se mantienen las paredes, suelo y techo limpios, libres de residuos?', 'SI'],
      ['¿Se limpian las máquinas con frecuencia y se mantienen libres de grasa, virutas…?', 'SI'],
      ['¿Se realizan periódicamente tareas de limpieza conjuntamente con el mantenimiento de la planta?', 'SI'],
      ['¿Existe una persona o equipo de personas responsable de supervisar las operaciones de limpieza?', 'SI'],
      ['¿Se barre y limpia el suelo y los equipos normalmente sin ser dicho?', 'SI'],
    ]],
    ['SEIKETSU', [
      ['¿La ropa que usa el personal es inapropiada o está sucia?', 'NO'],
      ['¿Las diferentes áreas de trabajo tienen la luz suficiente y ventilación para la actividad que se desarrolla?', 'SI'],
      ['¿Hay algún problema con respecto a ruido, vibraciones o de temperatura (calor / frío)?', 'NO'],
      ['¿Hay alguna ventana o puerta rota?', 'NO'],
      ['¿Hay habilitadas zonas de descanso, comida y espacios habilitados para fumar?', 'SI'],
      ['¿Se generan regularmente mejoras en las diferentes áreas de la empresa?', 'SI'],
      ['¿Se actúa generalmente sobre las ideas de mejora?', 'SI'],
      ['¿Existen procedimientos escritos estándar y se utilizan activamente?', 'SI'],
      ['¿Se consideran futuras normas como plan de mejora clara de la zona?', 'SI'],
      ['¿Se mantienen las 3 primeras S (eliminar innecesario, espacios definidos, limitación de pasillos, limpieza)?', 'SI'],
    ]],
    ['SHITSUKE', [
      ['¿Se realiza el control diario de limpieza?', 'SI'],
      ['¿Se realizan los informes diarios correctamente y a su debido tiempo?', 'SI'],
      ['¿Se utiliza el uniforme reglamentario así como el material de protección diario para las actividades que se llevan a cabo?', 'SI'],
      ['¿Se utiliza el material de protección para realizar trabajos específicos (arnés, casco…)?', 'SI'],
      ['¿Cumplen los miembros de la comisión de seguimiento el cumplimiento de los horarios de las reuniones?', 'SI'],
      ['¿Está todo el personal capacitado y motivado para llevar a cabo los procedimientos estándars definidos?', 'SI'],
      ['¿Las herramientas y las piezas se almacenan correctamente?', 'SI'],
      ['¿Se están cumpliento los controles de stocks?', 'SI'],
      ['¿Existen procedimientos de mejora, son revisados con regularidad?', 'SI'],
      ['¿Todas las actividades definidas en las 5S se llevan a cabo y se realizan los seguimientos definidos?', 'SI'],
    ]],
  ]),
};

export const FORMATOS: Record<FormatoId, Formato5s> = { LISTA_20, PUNTOS_25, SI_NO_50 };
export const FORMATO_POR_DEFECTO: FormatoId = 'LISTA_20';

export const esFormatoValido = (id: unknown): id is FormatoId => typeof id === 'string' && (FORMATOS_5S as readonly string[]).includes(id);
export const formatoDe = (id: string | null | undefined): Formato5s => FORMATOS[esFormatoValido(id) ? id : FORMATO_POR_DEFECTO];

export type Semaforo = 'VERDE' | 'AMARILLO' | 'ROJO';

/** Rangos del Excel original: ≥ 90 % verde, de 75 % a menos de 90 % amarillo, menos de 75 % rojo (los tres formatos usan los mismos). */
export function semaforoDe(porcentaje: number): Semaforo {
  if (porcentaje >= 90) return 'VERDE';
  if (porcentaje >= 75) return 'AMARILLO';
  return 'ROJO';
}

export const esCriterioValido = (f: Formato5s, n: number): boolean => Number.isInteger(n) && n >= 1 && n <= f.criterios.length;
export const puntajeMaximoCategoria = (f: Formato5s, cat: CategoriaId): number => f.criterios.filter((c) => c.categoria === cat).length * f.maxCriterio;
export const puntajeMaximoTotal = (f: Formato5s): number => f.criterios.length * f.maxCriterio;

/** ¿Es un valor guardado válido para el formato? (0 a maxCriterio; en SI/NO, 0 o 1). */
export const esPuntajeValido = (f: Formato5s, p: number): boolean => Number.isInteger(p) && p >= 0 && p <= f.maxCriterio;

export interface PuntajeRespuesta {
  criterio: number;
  puntaje: number | null;
}

/**
 * Cuánto vale la respuesta para el cálculo: en los formatos de puntaje, el puntaje mismo; en SI/NO, 1 si la respuesta coincide con
 * la favorable de la pregunta y 0 si no. Sin responder: null (no cuenta como cero).
 */
export function puntajeEfectivo(f: Formato5s, criterio: number, puntaje: number | null): number | null {
  if (typeof puntaje !== 'number') return null;
  if (f.tipo === 'PUNTAJE') return puntaje;
  const favorable = f.criterios.find((c) => c.numero === criterio)?.favorable;
  if (!favorable) return null;
  return (puntaje === 1) === (favorable === 'SI') ? 1 : 0;
}

export interface ResultadoAuditoria5s {
  evaluados: number;
  total: number;
  puntaje: number;
  puntajeMaximo: number;
  porcentaje: number;
  semaforo: Semaforo;
  completa: boolean;
  porCategoria: {
    categoria: CategoriaId;
    nombre: string;
    traduccion: string;
    puntaje: number;
    maximo: number;
    evaluados: number;
    /** Criterios evaluados que no cumplen (en SI/NO es la «puntuación» de la hoja original). */
    noConformes: number;
  }[];
}

/**
 * Resultado de una auditoría a partir de sus respuestas. Un criterio sin evaluar no suma (no cuenta como cero) y por eso el
 * semáforo de un borrador es solo orientativo: el definitivo se fija al finalizar, con todos los criterios evaluados.
 */
export function calcularResultado(formato: Formato5s, respuestas: readonly PuntajeRespuesta[]): ResultadoAuditoria5s {
  const efectivo = new Map<number, number>();
  for (const r of respuestas) {
    if (!esCriterioValido(formato, r.criterio)) continue;
    const v = puntajeEfectivo(formato, r.criterio, r.puntaje);
    if (v !== null) efectivo.set(r.criterio, v);
  }
  const porCategoria = formato.categorias.map((cat) => {
    const criterios = formato.criterios.filter((c) => c.categoria === cat.id);
    const valores = criterios.map((c) => efectivo.get(c.numero)).filter((v): v is number => typeof v === 'number');
    return {
      categoria: cat.id,
      nombre: cat.nombre,
      traduccion: cat.traduccion,
      puntaje: valores.reduce((a, b) => a + b, 0),
      maximo: puntajeMaximoCategoria(formato, cat.id),
      evaluados: valores.length,
      noConformes: valores.filter((v) => v < formato.maxCriterio).length,
    };
  });
  const puntaje = porCategoria.reduce((a, c) => a + c.puntaje, 0);
  const evaluados = porCategoria.reduce((a, c) => a + c.evaluados, 0);
  const maximo = puntajeMaximoTotal(formato);
  const porcentaje = Math.round((puntaje / maximo) * 1000) / 10;
  return {
    evaluados,
    total: formato.criterios.length,
    puntaje,
    puntajeMaximo: maximo,
    porcentaje,
    semaforo: semaforoDe(porcentaje),
    completa: evaluados === formato.criterios.length,
    porCategoria,
  };
}

/** Criterios que faltan por evaluar (para no finalizar con preguntas sin responder). */
export function criteriosSinEvaluar(formato: Formato5s, respuestas: readonly PuntajeRespuesta[]): number[] {
  const hechos = new Set(respuestas.filter((r) => typeof r.puntaje === 'number').map((r) => r.criterio));
  return formato.criterios.map((c) => c.numero).filter((n) => !hechos.has(n));
}

/** Urgencia de una acción según qué tan bajo quedó el criterio (en SI/NO, un incumplimiento es de prioridad alta). */
export function prioridadDePuntaje(formato: Formato5s, efectivo: number): 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA' {
  if (formato.tipo === 'SI_NO') return 'ALTA';
  const ratio = efectivo / formato.maxCriterio;
  if (ratio <= 0.2) return 'CRITICA';
  if (ratio <= 0.4) return 'ALTA';
  if (ratio <= 0.6) return 'MEDIA';
  return 'BAJA';
}

/** Estado de una acción tal como se muestra: el que tiene (ya no se calcula «vencida»). */
export function estadoAccionEfectivo(a: { estado: string }, _hoy?: Date): string {
  return a.estado;
}

export const TRANSICIONES_ACCION: Record<string, readonly string[]> = {
  PENDIENTE: ['EN_PROCESO', 'EN_VERIFICACION'],
  EN_PROCESO: ['PENDIENTE', 'EN_VERIFICACION'],
  EN_VERIFICACION: ['EN_PROCESO'],
  CERRADA: [],
};

export function formatearCodigo(anio: number, correlativo: number): string {
  return `A5S-${anio}-${String(correlativo).padStart(4, '0')}`;
}
export function correlativoDeCodigo(codigo: string | null | undefined): number {
  const m = /^A5S-\d{4}-(\d+)$/.exec(String(codigo ?? ''));
  return m ? Number(m[1]) : 0;
}
export const codigoAccion = (codigoAuditoria: string, criterio: number): string => `${codigoAuditoria}-C${String(criterio).padStart(2, '0')}`;

/** Variación del puntaje respecto a la auditoría anterior (null si no hay anterior). */
export function variacion(actual: number, anterior: number | null | undefined): number | null {
  return typeof anterior === 'number' ? actual - anterior : null;
}
