import { describe, expect, it } from 'vitest';
import {
  cargoDeRol,
  correlativoDe,
  esEditable,
  estadoPlanEfectivo,
  esImagenDataUrl,
  faltantesParaGuardar,
  formatearNumero,
  huellaContenido,
  nombreNormalizado,
  periodoDe,
  puedePasarA,
} from './informes.reglas.js';

describe('estados del informe de inspección', () => {
  it('tiene solo dos estados: de borrador a guardado, y de ahí no se vuelve', () => {
    expect(puedePasarA('BORRADOR', 'GUARDADO')).toBe(true);
    expect(puedePasarA('GUARDADO', 'BORRADOR')).toBe(false);
    expect(puedePasarA('GUARDADO', 'GUARDADO')).toBe(false);
  });

  it('solo un borrador se edita: un informe guardado ya no se modifica', () => {
    expect(esEditable('BORRADOR')).toBe(true);
    expect(esEditable('GUARDADO')).toBe(false);
  });
});

describe('huella del contenido firmado', () => {
  const informe = () => ({
    agenciaId: 'a1', destinatarioNombre: 'Jefe', fecha: new Date('2026-10-14'), tipoInspeccion: 'RUTINA', asunto: 'Visita', antecedentes: '', desarrollo: 'Todo bien',
    actividadesGeneral: '', planesGeneral: '', observacionesJefeTaller: 'Bien', calificacion: 'BUENO',
    novedades: [{ id: 'n1', titulo: 'Manguera', descripcion: '', categoria: 'MAQUINARIA', area: '', fotos: ['f1'] }],
    actividades: [{ id: 'x1', nombre: 'Revisión', descripcion: '', fotos: [] }],
    planes: [{ id: 'p1', problema: 'Cambiar', accionRequerida: 'Hoy', evidenciaCumplimiento: [] }],
  });

  it('es la misma para el mismo contenido, aunque cambien los ids o la hora de la visita', () => {
    const a = informe();
    const b = { ...informe(), novedades: [{ ...informe().novedades[0], id: 'otro' }], fechaVisita: new Date() };
    expect(huellaContenido(a)).toBe(huellaContenido(b));
    expect(huellaContenido(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cambia cuando cambia cualquier cosa que sale en el documento', () => {
    const base = huellaContenido(informe());
    expect(huellaContenido({ ...informe(), asunto: 'Otra visita' })).not.toBe(base);
    expect(huellaContenido({ ...informe(), calificacion: 'MALO' })).not.toBe(base);
    expect(huellaContenido({ ...informe(), jefeTallerPresente: false })).not.toBe(base);
    expect(huellaContenido({ ...informe(), observacionesJefeTaller: 'Mal' })).not.toBe(base);
    expect(huellaContenido({ ...informe(), novedades: [] })).not.toBe(base);
    expect(huellaContenido({ ...informe(), novedades: [{ ...informe().novedades[0], fotos: ['f1', 'f2'] }] })).not.toBe(base);
    expect(huellaContenido({ ...informe(), planes: [{ ...informe().planes[0], accionRequerida: 'Mañana' }] })).not.toBe(base);
  });

  it('compara nombres sin mayúsculas, acentos ni espacios de más', () => {
    expect(nombreNormalizado('  José   PÉREZ ')).toBe('jose perez');
    expect(nombreNormalizado('Ana Ruiz')).toBe(nombreNormalizado('ana  ruiz'));
    expect(nombreNormalizado('Ana Ruiz')).not.toBe(nombreNormalizado('Ana Ruiz Gil'));
  });
});

describe('planes de acción', () => {
  const hoy = new Date('2026-10-14T00:00:00Z');
  it('un plan nunca se muestra vencido: se ve con el estado que tiene', () => {
    const pasado = new Date('2026-09-01');
    expect(estadoPlanEfectivo({ estado: 'PENDIENTE' }, new Date('2026-10-01'))).toBe('PENDIENTE');
    expect(estadoPlanEfectivo({ estado: 'EN_PROCESO' }, new Date('2026-10-01'))).toBe('EN_PROCESO');
    expect(pasado).toBeInstanceOf(Date);
  });
});

describe('numeración y guardado', () => {
  it('formato INF-AAAA-NNNN y correlativo', () => {
    expect(formatearNumero(2026, 3)).toBe('INF-2026-0003');
    expect(correlativoDe('INF-2026-0125')).toBe(125);
    expect(correlativoDe('xx')).toBe(0);
    expect(periodoDe('2026-10-14')).toBe('2026-10');
  });

  const TODAS = ['RESPONSABLE', 'JEFE_TALLER', 'LIDER_BAHIA', 'RECEPCION'];
  const completo = { asunto: 'Visita mensual', destinatarioNombre: 'Jefe', desarrollo: 'Todo en orden', novedades: 0, calificacion: 'BUENO', selloValidado: true, firmadas: TODAS };

  it('para guardar exige destinatario, asunto, contenido, calificación, sello validado y las 4 firmas', () => {
    expect(faltantesParaGuardar(completo)).toEqual([]);
    expect(faltantesParaGuardar({ ...completo, desarrollo: '', novedades: 2 })).toEqual([]);
    expect(faltantesParaGuardar({ ...completo, desarrollo: '', novedades: 0 })).toHaveLength(1);
    expect(faltantesParaGuardar({ ...completo, calificacion: null })).toHaveLength(1);
    expect(faltantesParaGuardar({ ...completo, selloValidado: false })).toEqual(['el jefe de taller con su contraseña']);
    expect(faltantesParaGuardar({ ...completo, firmadas: ['RESPONSABLE', 'JEFE_TALLER'] })).toEqual(['la firma de líder de bahía']);
    expect(faltantesParaGuardar({ asunto: ' ', destinatarioNombre: '', desarrollo: '', novedades: 0, calificacion: null, selloValidado: false, firmadas: [] })).toHaveLength(8);
    // La recepción no se firma al guardar: la firma un Admin o Super Admin al aprobar.
    expect(faltantesParaGuardar({ ...completo, firmadas: ['RESPONSABLE', 'JEFE_TALLER', 'LIDER_BAHIA'] })).toEqual([]);
  });

  it('si el jefe de taller no estuvo, no se exige su contraseña, pero el taller sí firma con nombre escrito', () => {
    const sinJefe = { ...completo, jefePresente: false, selloValidado: false, firmadas: ['RESPONSABLE', 'JEFE_TALLER', 'LIDER_BAHIA'] };
    expect(faltantesParaGuardar(sinJefe)).toEqual([]);
    expect(faltantesParaGuardar({ ...sinJefe, firmadas: ['RESPONSABLE'] })).toEqual(['la firma de taller', 'la firma de líder de bahía']);
    // Si estuvo, sigue pidiéndose todo.
    expect(faltantesParaGuardar({ ...sinJefe, jefePresente: true })).toEqual(['el jefe de taller con su contraseña']);
  });

  it('solo acepta imágenes en data URL de tamaño razonable', () => {
    expect(esImagenDataUrl('data:image/png;base64,iVBORw0KGgo=', 1000)).toBe(true);
    expect(esImagenDataUrl('data:image/svg+xml;base64,AAAA', 1000)).toBe(false);
    expect(esImagenDataUrl('http://x/y.png', 1000)).toBe(false);
    expect(esImagenDataUrl('data:image/png;base64,' + 'A'.repeat(2000), 1000)).toBe(false);
    expect(esImagenDataUrl(null, 1000)).toBe(false);
  });

  it('cargo legible de un rol', () => {
    expect(cargoDeRol('COORD_MANTENIMIENTO')).toBe('Coord Mantenimiento');
    expect(cargoDeRol('SUPERVISOR')).toBe('Supervisor');
  });
});
