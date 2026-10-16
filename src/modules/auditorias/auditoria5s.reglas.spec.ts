import { describe, expect, it } from 'vitest';
import {
  CATEGORIAS_IDS,
  FORMATOS,
  FORMATOS_5S,
  calcularResultado,
  codigoAccion,
  correlativoDeCodigo,
  criteriosSinEvaluar,
  esPuntajeValido,
  estadoAccionEfectivo,
  formatearCodigo,
  prioridadDePuntaje,
  puntajeEfectivo,
  puntajeMaximoTotal,
  semaforoDe,
  variacion,
} from './auditoria5s.reglas.js';

const { LISTA_20, PUNTOS_25, SI_NO_50 } = FORMATOS;

const todas = (f: typeof LISTA_20, puntaje: number | null) => f.criterios.map((c) => ({ criterio: c.numero, puntaje }));

/** Reparte un total de puntos entre los criterios (el máximo de cada uno como tope). */
const conTotal = (f: typeof LISTA_20, total: number) => {
  let resto = total;
  return f.criterios.map((c) => {
    const p = Math.min(f.maxCriterio, resto);
    resto -= p;
    return { criterio: c.numero, puntaje: p };
  });
};

/** Respuestas de un formato SI/NO que cumplen en todo (o fallan en todo). */
const siNo = (f: typeof SI_NO_50, cumple: (n: number) => boolean) => f.criterios.map((c) => ({ criterio: c.numero, puntaje: (cumple(c.numero) ? c.favorable === 'SI' : c.favorable !== 'SI') ? 1 : 0 }));

describe('los tres formatos de la auditoría 5S', () => {
  it('hay tres formatos, cada uno con sus preguntas y un máximo de 100 puntos en los dos de puntaje', () => {
    expect(FORMATOS_5S).toEqual(['LISTA_20', 'PUNTOS_25', 'SI_NO_50']);
    expect(LISTA_20.criterios).toHaveLength(20);
    expect(PUNTOS_25.criterios).toHaveLength(25);
    expect(SI_NO_50.criterios).toHaveLength(50);
    expect(puntajeMaximoTotal(LISTA_20)).toBe(100);
    expect(puntajeMaximoTotal(PUNTOS_25)).toBe(100);
    expect(puntajeMaximoTotal(SI_NO_50)).toBe(50);
  });

  it('numeración corrida y las mismas cinco S en todos', () => {
    for (const f of Object.values(FORMATOS)) {
      expect(f.criterios.map((c) => c.numero)).toEqual(Array.from({ length: f.criterios.length }, (_, i) => i + 1));
      expect(f.categorias.map((c) => c.id)).toEqual([...CATEGORIAS_IDS]);
    }
    for (const cat of CATEGORIAS_IDS) {
      expect(LISTA_20.criterios.filter((c) => c.categoria === cat)).toHaveLength(4);
      expect(PUNTOS_25.criterios.filter((c) => c.categoria === cat)).toHaveLength(5);
      expect(SI_NO_50.criterios.filter((c) => c.categoria === cat)).toHaveLength(10);
    }
  });

  it('el formato de 25 criterios conserva el orden y los nombres de la hoja (Clasificar … Mantener, 0 a 4)', () => {
    expect(PUNTOS_25.categorias.map((c) => c.nombre)).toEqual(['Clasificar', 'Ordenar', 'Limpiar', 'Estandarizar', 'Mantener']);
    expect(PUNTOS_25.maxCriterio).toBe(4);
    expect(PUNTOS_25.escala.map((e) => e.valor)).toEqual([0, 1, 2, 3, 4]);
    expect(PUNTOS_25.criterios[0].descripcion).toMatch(/artículos innecesarios/);
    expect(PUNTOS_25.criterios[4]).toMatchObject({ numero: 5, categoria: 'SEIRI' });
    expect(PUNTOS_25.criterios[5]).toMatchObject({ numero: 6, categoria: 'SEITON' });
    expect(PUNTOS_25.criterios[24]).toMatchObject({ numero: 25, categoria: 'SHITSUKE' });
    expect(PUNTOS_25.nota).toMatch(/criterio 24/);
  });

  it('el formato de 20 criterios conserva su orden', () => {
    expect(LISTA_20.criterios[0]).toMatchObject({ numero: 1, categoria: 'SEIRI' });
    expect(LISTA_20.criterios[4]).toMatchObject({ numero: 5, categoria: 'SEITON' });
    expect(LISTA_20.criterios[19]).toMatchObject({ numero: 20, categoria: 'SHITSUKE' });
  });

  it('en SI/NO cada pregunta dice cuál respuesta cumple; las preguntas «¿Hay…?» cumplen con NO', () => {
    expect(SI_NO_50.criterios.every((c) => c.favorable === 'SI' || c.favorable === 'NO')).toBe(true);
    expect(SI_NO_50.criterios[0]).toMatchObject({ numero: 1, favorable: 'NO' }); // ¿Hay cosas inútiles…?
    expect(SI_NO_50.criterios[3]).toMatchObject({ numero: 4, favorable: 'SI' }); // ¿Están todos los objetos… ordenados?
    expect(SI_NO_50.criterios[10]).toMatchObject({ numero: 11, categoria: 'SEITON', favorable: 'SI' });
  });
});

describe('semáforo', () => {
  it('respeta los rangos del Excel: ≥ 90 verde, 75 a < 90 amarillo, < 75 rojo', () => {
    expect(semaforoDe(100)).toBe('VERDE');
    expect(semaforoDe(90)).toBe('VERDE');
    expect(semaforoDe(89.9)).toBe('AMARILLO');
    expect(semaforoDe(75)).toBe('AMARILLO');
    expect(semaforoDe(74.9)).toBe('ROJO');
    expect(semaforoDe(0)).toBe('ROJO');
  });

  it('los ejemplos del documento en los formatos de 100 puntos: 94 verde, 82 amarillo, 63 rojo', () => {
    for (const f of [LISTA_20, PUNTOS_25]) {
      expect(calcularResultado(f, conTotal(f, 94)).semaforo).toBe('VERDE');
      expect(calcularResultado(f, conTotal(f, 82)).semaforo).toBe('AMARILLO');
      expect(calcularResultado(f, conTotal(f, 63)).semaforo).toBe('ROJO');
    }
  });
});

describe('cálculo del resultado', () => {
  it('formato de 20: suma por categoría (máximo 20) y en total (máximo 100)', () => {
    const r = calcularResultado(LISTA_20, todas(LISTA_20, 5));
    expect(r).toMatchObject({ puntaje: 100, porcentaje: 100, completa: true });
    expect(r.porCategoria.every((c) => c.puntaje === 20 && c.maximo === 20)).toBe(true);
  });

  it('formato de 25: subtotal de hasta 20 por S y 100 en total con 4 puntos por criterio', () => {
    const r = calcularResultado(PUNTOS_25, todas(PUNTOS_25, 4));
    expect(r).toMatchObject({ puntaje: 100, puntajeMaximo: 100, completa: true });
    expect(r.porCategoria.map((c) => c.maximo)).toEqual([20, 20, 20, 20, 20]);
    const mitad = calcularResultado(PUNTOS_25, todas(PUNTOS_25, 2));
    expect(mitad.puntaje).toBe(50);
    expect(mitad.semaforo).toBe('ROJO');
  });

  it('el ejemplo del documento (formato de 20): 18 + 15 + 20 + 12 + 17 = 82, amarillo', () => {
    const por: Record<string, number> = { SEIRI: 18, SEITON: 15, SEISO: 20, SEIKETSU: 12, SHITSUKE: 17 };
    const respuestas = CATEGORIAS_IDS.flatMap((cat) => {
      let resto = por[cat];
      return LISTA_20.criterios.filter((c) => c.categoria === cat).map((c) => {
        const p = Math.min(5, resto);
        resto -= p;
        return { criterio: c.numero, puntaje: p };
      });
    });
    const r = calcularResultado(LISTA_20, respuestas);
    expect(r.porCategoria.map((c) => c.puntaje)).toEqual([18, 15, 20, 12, 17]);
    expect(r.puntaje).toBe(82);
    expect(r.semaforo).toBe('AMARILLO');
  });

  it('SI/NO: cuenta las respuestas que cumplen y la «puntuación» de la hoja son las que no cumplen', () => {
    // Seiri: 5 de 10 no cumplen (como la hoja de ejemplo: Puntuación 5).
    const noCumplen = new Set([1, 2, 4, 5, 8]);
    const r = calcularResultado(SI_NO_50, siNo(SI_NO_50, (n) => !(n <= 10 && noCumplen.has(n))));
    const seiri = r.porCategoria[0];
    expect(seiri).toMatchObject({ puntaje: 5, maximo: 10, noConformes: 5 });
    expect(r.puntaje).toBe(45);
    expect(r.puntajeMaximo).toBe(50);
    expect(r.porcentaje).toBe(90);
    expect(r.semaforo).toBe('VERDE');
  });

  it('SI/NO: la respuesta favorable depende de la pregunta (SI a «¿Hay cosas inútiles?» no cumple)', () => {
    expect(puntajeEfectivo(SI_NO_50, 1, 1)).toBe(0); // SI a una pregunta que cumple con NO
    expect(puntajeEfectivo(SI_NO_50, 1, 0)).toBe(1);
    expect(puntajeEfectivo(SI_NO_50, 4, 1)).toBe(1); // SI a una pregunta que cumple con SI
    expect(puntajeEfectivo(SI_NO_50, 4, 0)).toBe(0);
    expect(puntajeEfectivo(SI_NO_50, 4, null)).toBeNull();
  });

  it('un criterio sin evaluar no cuenta como cero: no suma ni se considera evaluado', () => {
    const r = calcularResultado(LISTA_20, [{ criterio: 1, puntaje: 5 }, { criterio: 2, puntaje: null }, { criterio: 3, puntaje: 0 }]);
    expect(r.evaluados).toBe(2);
    expect(r.puntaje).toBe(5);
    expect(r.completa).toBe(false);
  });

  it('distingue un cero real de una pregunta pendiente al exigir todas antes de finalizar', () => {
    expect(criteriosSinEvaluar(LISTA_20, todas(LISTA_20, 0))).toEqual([]);
    expect(criteriosSinEvaluar(PUNTOS_25, todas(PUNTOS_25, null))).toHaveLength(25);
    expect(criteriosSinEvaluar(SI_NO_50, [{ criterio: 1, puntaje: 0 }, { criterio: 2, puntaje: null }])).toHaveLength(49);
  });

  it('ignora criterios fuera del catálogo del formato y valida los valores guardados', () => {
    expect(calcularResultado(LISTA_20, [{ criterio: 21, puntaje: 5 }, { criterio: 0, puntaje: 5 }]).puntaje).toBe(0);
    expect(calcularResultado(LISTA_20, [{ criterio: 25, puntaje: 5 }]).puntaje).toBe(0); // el 25 solo existe en el de 25
    expect(esPuntajeValido(LISTA_20, 5)).toBe(true);
    expect(esPuntajeValido(PUNTOS_25, 5)).toBe(false);
    expect(esPuntajeValido(SI_NO_50, 1)).toBe(true);
    expect(esPuntajeValido(SI_NO_50, 2)).toBe(false);
  });
});

describe('acciones correctivas y códigos', () => {
  it('la prioridad sale del puntaje: cuanto más bajo, más urgente; un incumplimiento SI/NO es de prioridad alta', () => {
    expect([0, 1, 2, 3, 4].map((p) => prioridadDePuntaje(LISTA_20, p))).toEqual(['CRITICA', 'CRITICA', 'ALTA', 'MEDIA', 'BAJA']);
    expect([0, 1, 2, 3].map((p) => prioridadDePuntaje(PUNTOS_25, p))).toEqual(['CRITICA', 'ALTA', 'MEDIA', 'BAJA']);
    expect(prioridadDePuntaje(SI_NO_50, 0)).toBe('ALTA');
  });

  it('una acción abierta con compromiso pasado se muestra vencida; una cerrada nunca', () => {
    const hoy = new Date('2026-10-14T00:00:00Z');
    const ayer = new Date('2026-10-13T00:00:00Z');
    expect(estadoAccionEfectivo({ estado: 'PENDIENTE', fechaCompromiso: ayer }, hoy)).toBe('VENCIDA');
    expect(estadoAccionEfectivo({ estado: 'EN_VERIFICACION', fechaCompromiso: ayer }, hoy)).toBe('VENCIDA');
    expect(estadoAccionEfectivo({ estado: 'CERRADA', fechaCompromiso: ayer }, hoy)).toBe('CERRADA');
    expect(estadoAccionEfectivo({ estado: 'PENDIENTE', fechaCompromiso: hoy }, hoy)).toBe('PENDIENTE');
    expect(estadoAccionEfectivo({ estado: 'PENDIENTE', fechaCompromiso: null }, hoy)).toBe('PENDIENTE');
  });

  it('códigos legibles y correlativo', () => {
    expect(formatearCodigo(2026, 7)).toBe('A5S-2026-0007');
    expect(correlativoDeCodigo('A5S-2026-0042')).toBe(42);
    expect(correlativoDeCodigo(null)).toBe(0);
    expect(codigoAccion('A5S-2026-0007', 3)).toBe('A5S-2026-0007-C03');
  });

  it('variación respecto a la anterior', () => {
    expect(variacion(82, 70)).toBe(12);
    expect(variacion(60, 70)).toBe(-10);
    expect(variacion(60, null)).toBeNull();
  });
});
