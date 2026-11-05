import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReportesService } from './reportes.service.js';

const usuario = (rol: string, ambito: string, capacidades: string[], extra: Record<string, unknown> = {}) => ({
  id: 'u1',
  name: 'Ana',
  lastname: 'Pérez',
  role: { namerol: rol, ambito, capacidades },
  ...extra,
});

const AGENCIA_A = {
  id: 'ag-a', codigo: 'A', nombre: 'Agencia Norte', direccion: null, telefono: null, numeroBahias: 2, estado: 1, tieneServiciosEspeciales: true, servicioIds: null,
  regionId: 'r1', region: null, regionRel: { nombre: 'Sierra' }, cliente: { nombre: 'Toyota' }, usuarios: [{ name: 'Luis', lastname: 'Mora' }],
};
const AGENCIA_B = { ...AGENCIA_A, id: 'ag-b', codigo: 'B', nombre: 'Agencia Sur', usuarios: [] };

function crear(prismaExtra: Record<string, unknown> = {}) {
  const prisma: any = {
    agencia: { findMany: vi.fn().mockResolvedValue([AGENCIA_A, AGENCIA_B]) },
    servicioLavado: { findMany: vi.fn().mockResolvedValue([]) },
    servicioEspecial: { findMany: vi.fn().mockResolvedValue([]) },
    exportacionReporte: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    ...prismaExtra,
  };
  return { servicio: new ReportesService(prisma), prisma };
}

const PERMISOS_REPORTES = ['reportes.ver', 'reportes.excel', 'reportes.pdf'];

describe('catálogo según los módulos activos del rol', () => {
  it('solo ofrece los reportes de los módulos que el rol tiene activos', () => {
    const { servicio } = crear();
    const ids = servicio.catalogo(usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'operadores.ver', 'incidentes.ver'])).map((r) => r.id);
    expect(ids.sort()).toEqual(['incidentes', 'lavadores-listado']);
  });

  it('sin ningún módulo activo no hay reportes', () => {
    const { servicio } = crear();
    expect(servicio.catalogo(usuario('SUPERVISOR', 'REGION', PERMISOS_REPORTES))).toEqual([]);
  });

  it('el catálogo de precios exige también ver precios', () => {
    const { servicio } = crear();
    const sin = servicio.catalogo(usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'catalogo.ver'])).map((r) => r.id);
    const con = servicio.catalogo(usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'catalogo.ver', 'precios.ver'])).map((r) => r.id);
    expect(sin).not.toContain('catalogo-precios');
    expect(con).toContain('catalogo-precios');
  });

  it('SUPER_ADMIN ve todos los reportes', () => {
    const { servicio } = crear();
    expect(servicio.catalogo(usuario('SUPER_ADMIN', 'GLOBAL', []))).toHaveLength(18);
  });
});

describe('generar', () => {
  const periodoAnio = { modo: 'ANIO_DE' as const, anio: 2026 };

  it('rechaza un reporte de un módulo que el rol no tiene activo', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: periodoAnio }, usuario('SUPERVISOR', 'REGION', PERMISOS_REPORTES))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un reporte de periodo exige elegir el periodo', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL' }, usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el kardex exige elegir el producto', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'kardex', periodo: periodoAnio }, usuario('SUPER_ADMIN', 'GLOBAL', []))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un estado que no corresponde al reporte se rechaza', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'incidentes', periodo: periodoAnio, estado: 'APROBADO' }, usuario('SUPER_ADMIN', 'GLOBAL', []))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('las agencias se buscan siempre dentro del alcance del usuario, sin fiarse de los ids enviados', async () => {
    const { servicio, prisma } = crear();
    await servicio.generar(
      { reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: periodoAnio, agenciaIds: ['ag-de-otra-region'], regionId: 'r-ajena' },
      usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' }),
    );
    const donde = prisma.agencia.findMany.mock.calls[0][0].where.AND;
    expect(donde).toContainEqual({ regionId: 'r1' });
    expect(donde).toContainEqual({ id: { in: ['ag-de-otra-region'] } });
    expect(donde).toContainEqual({ regionId: 'r-ajena' });
  });

  it('un usuario sin ámbito (le falta su agencia o región) no consulta ningún dato', async () => {
    const { servicio, prisma } = crear();
    await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: periodoAnio }, usuario('LIDER', 'AGENCIA', [...PERMISOS_REPORTES, 'servicios.ver']));
    expect(prisma.agencia.findMany.mock.calls[0][0].where.AND[0]).toEqual({ id: { in: [] } });
  });

  it('separa por agencia y, dentro de cada una, el año por meses con sus totales', async () => {
    const { servicio, prisma } = crear();
    const servicioDe = (agenciaId: string, fecha: string, estado: string) => ({
      ordenTrabajoOT: 'OT-1', placa: 'ABC-123', marca: 'Kia', modelo: 'Rio', color: 'Rojo', estado, precio: 10, observaciones: null,
      horaIngreso: new Date(`${fecha}T15:00:00Z`), horaSalida: null, bahia: { agenciaId }, catalogo: { nombre: 'Lavado' }, operador: { name: 'Juan', lastname: 'Paz' }, operadoresAsignados: [],
    });
    prisma.servicioLavado.findMany.mockResolvedValue([
      servicioDe('ag-a', '2026-01-10', 'FINALIZADO'),
      servicioDe('ag-a', '2026-01-20', 'CANCELADO'),
      servicioDe('ag-a', '2026-03-05', 'APROBADO'),
      servicioDe('ag-b', '2026-02-02', 'FINALIZADO'),
    ]);
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: periodoAnio }, usuario('SUPER_ADMIN', 'GLOBAL', []));

    expect(r.grupos.map((g) => g.titulo)).toEqual(['Agencia Norte', 'Agencia Sur']);
    const norte = r.grupos[0];
    expect(norte).toMatchObject({ region: 'Sierra', cliente: 'Toyota', responsable: 'Luis Mora' });
    expect(norte.bloques.map((b) => b.etiqueta)).toEqual(['Enero 2026', 'Marzo 2026']);
    expect(r.columnas[0].clave).toBe('ot');
    expect(r.columnas.map((c) => c.clave)).not.toContain('ord');
    expect(norte.bloques[0].filas.map((f) => f.realizado)).toEqual(['SI', 'NO']);
    expect(norte.bloques[0].totales.find((t) => t.clave === 'realizados')?.valor).toBe(1);
    expect(r.totalFilas).toBe(4);
    expect(r.filtros.division).toBe('MES');
  });

  it('sin permiso de precios no salen ni la columna de precio ni los montos', async () => {
    const { servicio, prisma } = crear();
    prisma.servicioLavado.findMany.mockResolvedValue([
      { ordenTrabajoOT: 'OT-1', placa: 'ABC-123', marca: null, modelo: 'Rio', color: null, estado: 'FINALIZADO', precio: 25, observaciones: null, horaIngreso: new Date('2026-01-10T15:00:00Z'), horaSalida: null, bahia: { agenciaId: 'ag-a' }, catalogo: { nombre: 'Lavado' }, operador: null, operadoresAsignados: [] },
    ]);
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: periodoAnio }, usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' }));
    expect(r.columnas.map((c) => c.clave)).not.toContain('precio');
    expect(r.grupos[0].bloques[0].filas[0]).not.toHaveProperty('precio');
    expect(r.totales.map((t) => t.clave)).not.toContain('monto');
  });
});

describe('aprobación de los servicios', () => {
  const periodoAnio = { modo: 'ANIO_DE' as const, anio: 2026 };
  const admin = usuario('SUPER_ADMIN', 'GLOBAL', []);

  it('un servicio general aprobado muestra la marca y quién lo aprobó; uno sin decidir queda en blanco', async () => {
    const { servicio, prisma } = crear();
    const base = { ordenTrabajoOT: 'OT-1', placa: 'ABC-123', marca: null, modelo: 'Rio', color: null, precio: 10, observaciones: null, horaIngreso: new Date('2026-01-10T15:00:00Z'), horaSalida: null, bahia: { agenciaId: 'ag-a' }, catalogo: { nombre: 'Lavado' }, operador: null, operadoresAsignados: [] };
    prisma.servicioLavado.findMany.mockResolvedValue([
      { ...base, estado: 'APROBADO', aprobadoPor: 'Luis Mora' },
      { ...base, estado: 'RECHAZADO', aprobadoPor: 'Ana Ríos' },
      { ...base, estado: 'FINALIZADO', aprobadoPor: null },
    ]);
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: periodoAnio }, admin);
    const filas = r.grupos[0].bloques[0].filas;
    expect(filas.map((f) => f.aprobado)).toEqual(['SI', 'NO', '']);
    expect(filas.map((f) => f.aprobadoPor)).toEqual(['Luis Mora', 'Ana Ríos', '']);
    expect(r.totales.find((t) => t.clave === 'aprobados')?.valor).toBe(1);
    expect(r.totales.find((t) => t.clave === 'rechazados')?.valor).toBe(1);
  });

  it('en servicios especiales vale la última decisión registrada', async () => {
    const { servicio, prisma } = crear({ auditoriaDecision: { findMany: vi.fn() } });
    const base = { codigoSE: 'SE-1', ordenTrabajoOT: null, tipoServicio: 'Pulido', placa: 'ABC-123', marca: null, modelo: null, color: null, estado: 'Completado', precio: null, agenciaId: 'ag-a', observaciones: null, creadoPorNombre: 'Asesor', fechaProgramada: new Date('2026-01-10T15:00:00Z'), createdAt: new Date('2026-01-10T15:00:00Z'), horaIngreso: null, fechaInicio: null, fechaFin: null };
    prisma.servicioEspecial.findMany.mockResolvedValue([{ ...base, id: 's1' }, { ...base, id: 's2' }, { ...base, id: 's3' }]);
    prisma.auditoriaDecision.findMany.mockResolvedValue([
      { entidadId: 's1', accion: 'RECHAZAR', usuarioNombre: 'Pedro' },
      { entidadId: 's1', accion: 'APROBAR', usuarioNombre: 'Luis Mora' },
      { entidadId: 's2', accion: 'RECHAZAR', usuarioNombre: 'Ana Ríos' },
    ]);
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'ESPECIAL', periodo: periodoAnio }, admin);
    const filas = r.grupos[0].bloques[0].filas;
    expect(filas.map((f) => [f.aprobado, f.aprobadoPor])).toEqual([['SI', 'Luis Mora'], ['NO', 'Ana Ríos'], ['', '']]);
  });
});

describe('reporte de retos: una hoja por reto con su avance', () => {
  const reto = (extra: Record<string, unknown>) => ({
    id: 'r1', titulo: 'Reto', premio: 'Bono', fechaInicio: new Date('2026-03-01T00:00:00Z'), fechaFin: new Date('2026-03-31T00:00:00Z'), regiones: [], sucursalesIds: [], pulidoresIds: [], lavadoresIds: [],
    estado: 'ACTIVO', tipoReto: 'AGENCIA', tipoServicios: 'TODOS', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 1, meta: null,
    creadorNombre: 'Luis', creadorRol: 'JEFE_COMERCIAL', createdAt: new Date('2026-03-01T00:00:00Z'), ...extra,
  });
  const fila = (posicion: number, nombre: string, valor: number, gana = false) => ({ posicion, participanteId: nombre, nombre, detalle: 'Sierra', valor, alcanzadoEn: null, gana });
  const armar = (retos: unknown[], ranking: Record<string, unknown>) => {
    const retosService = { ranking: vi.fn(async (id: string) => ranking[id] ?? { participantes: [] }) };
    const { prisma } = crear({ reto: { findMany: vi.fn().mockResolvedValue(retos) } });
    return { servicio: new ReportesService(prisma, retosService as any), prisma, retosService };
  };
  const sup = usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'retos.ver'], { regionId: 'r1', region: { nombre: 'Sierra' } });
  const admin = usuario('SUPER_ADMIN', 'GLOBAL', []);

  it('crea una hoja por reto activo con su tabla de avance', async () => {
    const { servicio, prisma } = armar(
      [reto({ id: 'a', titulo: 'Reto A' }), reto({ id: 'b', titulo: 'Reto B', modoGanador: 'META', meta: 50 })],
      { a: { participantes: [fila(1, 'Agencia Norte', 12, true), fila(2, 'Agencia Sur', 9)] }, b: { participantes: [fila(1, 'Agencia Norte', 60), fila(2, 'Agencia Sur', 25)] } },
    );
    const r = await servicio.generar({ reporteId: 'retos' }, admin);
    expect(prisma.reto.findMany.mock.calls[0][0].where).toEqual({ estado: 'ACTIVO' });
    expect(r.grupos.map((g) => g.titulo)).toEqual(['Reto A', 'Reto B']);
    expect(r.grupos[0].datos?.find((d) => d.etiqueta === 'MODO')?.valor).toBe('Ranking: gana el primero');
    expect(r.grupos[0].bloques[0].filas.map((f) => f.situacion)).toEqual(['Ganando', 'En carrera']);
    // Un reto por meta muestra el porcentaje de avance y si la cumplió.
    expect(r.grupos[1].bloques[0].filas.map((f) => [f.avance, f.situacion])).toEqual([[120, 'Meta cumplida'], [50, 'En progreso']]);
  });

  it('por defecto solo los activos; se puede pedir cerrados o todos', async () => {
    const { servicio, prisma } = armar([], {});
    await servicio.generar({ reporteId: 'retos', estado: 'FINALIZADO' }, admin);
    await servicio.generar({ reporteId: 'retos', estado: 'TODOS' }, admin);
    expect(prisma.reto.findMany.mock.calls.map((c: any) => c[0].where)).toEqual([{ estado: 'FINALIZADO' }, {}]);
  });

  it('un supervisor de región solo recibe los retos de su región o sin destino', async () => {
    const { servicio, retosService } = armar(
      [reto({ id: 'a', titulo: 'De mi región', regiones: ['Sierra'] }), reto({ id: 'b', titulo: 'De otra región', regiones: ['Costa'] }), reto({ id: 'c', titulo: 'Nacional', regiones: ['Todas'] })],
      { a: { participantes: [fila(1, 'X', 1)] }, b: { participantes: [fila(1, 'X', 1)] }, c: { participantes: [fila(1, 'X', 1)] } },
    );
    const r = await servicio.generar({ reporteId: 'retos' }, sup);
    expect(r.grupos.map((g) => g.titulo)).toEqual(['De mi región', 'Nacional']);
    expect(retosService.ranking).not.toHaveBeenCalledWith('b', expect.anything());
  });

  it('un reto cuyo avance no puede ver el usuario se omite en vez de romper el reporte', async () => {
    const retosService = { ranking: vi.fn().mockRejectedValue(new ForbiddenException()) };
    const { prisma } = crear({ reto: { findMany: vi.fn().mockResolvedValue([reto({})]) } });
    const r = await new ReportesService(prisma, retosService as any).generar({ reporteId: 'retos' }, admin);
    expect(r.grupos).toEqual([]);
  });

  it('un reto por monto no muestra cifras sin permiso de precios', async () => {
    const { servicio } = armar([reto({ regiones: ['Sierra'], metrica: 'MONTO', modoGanador: 'META', meta: 5000 })], { r1: { participantes: [fila(1, 'Agencia Norte', 2500)] } });
    const sinPrecios = await servicio.generar({ reporteId: 'retos' }, sup);
    expect(sinPrecios.grupos[0].bloques[0].filas[0]).toMatchObject({ valor: null, meta: null, avance: 50 });
    expect(sinPrecios.grupos[0].datos?.find((d) => d.etiqueta === 'MODO')?.valor).toBe('Meta por monto');
    const conPrecios = await servicio.generar({ reporteId: 'retos' }, admin);
    expect(conPrecios.grupos[0].bloques[0].filas[0]).toMatchObject({ valor: 2500, meta: 5000 });
  });

  it('el reporte exige el permiso de retos', () => {
    const { servicio } = crear();
    expect(servicio.catalogo(usuario('SUPERVISOR', 'REGION', PERMISOS_REPORTES)).map((r) => r.id)).not.toContain('retos');
    expect(servicio.catalogo(usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'retos.ver'])).map((r) => r.id)).toContain('retos');
  });
});

describe('reportes de productividad', () => {
  const periodoAnio = { modo: 'ANIO_DE' as const, anio: 2026 };
  const admin = usuario('SUPER_ADMIN', 'GLOBAL', []);
  const general = (agenciaId: string, fecha: string, estado: string, operadorId: string, extra: Record<string, unknown> = {}) => ({
    estado, precio: 10, horaIngreso: new Date(`${fecha}T15:00:00Z`), horaInicio: new Date(`${fecha}T15:00:00Z`), horaSalida: new Date(`${fecha}T15:30:00Z`),
    operadorId, bahia: { agenciaId }, operadoresAsignados: [], ...extra,
  });
  const armar = () =>
    crear({
      servicioLavado: {
        findMany: vi.fn().mockResolvedValue([
          general('ag-a', '2026-01-10', 'FINALIZADO', 'u1'),
          general('ag-a', '2026-01-11', 'APROBADO', 'u1'),
          general('ag-a', '2026-01-12', 'CANCELADO', 'u2'),
          general('ag-b', '2026-02-03', 'FINALIZADO', 'u2'),
          general('ag-a', '2026-02-04', 'FINALIZADO', 'u1', { operadoresAsignados: [{ operadorId: 'u1' }, { operadorId: 'u2' }] }),
        ]),
      },
      servicioEspecial: { findMany: vi.fn().mockResolvedValue([]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'u1', name: 'Ana', lastname: 'Mora' }, { id: 'u2', name: 'Beto', lastname: 'Ríos' }]) },
    });

  it('la comparativa de agencias lista, por cada mes, las agencias con su cumplimiento y las ordena por servicios realizados', async () => {
    const { servicio } = armar();
    const r = await servicio.generar({ reporteId: 'productividad-agencias', periodo: periodoAnio }, admin);
    expect(r.filtros.division).toBe('MES');
    const [enero, febrero] = r.grupos[0].bloques;
    expect(enero.etiqueta).toBe('Enero 2026');
    expect(enero.filas).toHaveLength(1);
    expect(enero.filas[0]).toMatchObject({ posicion: 1, agencia: 'Agencia Norte', servicios: 3, realizados: 2, noRealizados: 1, cumplimiento: 66.7, tiempo: 30 });
    expect(febrero.filas.map((f) => [f.posicion, f.agencia])).toEqual([[1, 'Agencia Norte'], [2, 'Agencia Sur']]);
    expect(r.totales.find((t) => t.clave === 'servicios')?.valor).toBe(5);
    expect(r.totales.find((t) => t.clave === 'realizados')?.valor).toBe(4);
  });

  it('el ranking de operarios separa por agencia y reparte los servicios con varios operarios', async () => {
    const { servicio } = armar();
    const r = await servicio.generar({ reporteId: 'productividad-operarios', periodo: periodoAnio }, admin);
    const norte = r.grupos.find((g) => g.titulo === 'Agencia Norte')!;
    const febrero = norte.bloques.find((b) => b.etiqueta === 'Febrero 2026')!;
    // En febrero el servicio compartido cuenta una vez para cada operario y su monto se divide entre los dos.
    expect(febrero.filas.map((f) => [f.operario, f.realizados, f.monto])).toEqual([['Ana Mora', 1, 5], ['Beto Ríos', 1, 5]]);
    const enero = norte.bloques.find((b) => b.etiqueta === 'Enero 2026')!;
    expect(enero.filas[0]).toMatchObject({ posicion: 1, operario: 'Ana Mora', rol: 'Lavador', realizados: 2 });
  });

  it('sin permiso de precios no salen los montos', async () => {
    const { servicio } = armar();
    const sup = usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'productividad.ver'], { regionId: 'r1' });
    const r = await servicio.generar({ reporteId: 'productividad-agencias', periodo: periodoAnio }, sup);
    expect(r.columnas.map((c) => c.clave)).not.toContain('monto');
    expect(r.grupos[0].bloques[0].filas[0]).not.toHaveProperty('monto');
    expect(r.totales.map((t) => t.clave)).not.toContain('monto');
  });

  it('los dos reportes exigen el permiso de productividad', () => {
    const { servicio } = crear();
    expect(servicio.catalogo(usuario('SUPERVISOR', 'REGION', PERMISOS_REPORTES)).map((r) => r.id)).not.toContain('productividad-agencias');
    const ids = servicio.catalogo(usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'productividad.ver'])).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['productividad-agencias', 'productividad-operarios']));
  });
});

describe('documento de cada auditoría', () => {
  it('las filas de informes y de auditorías 5S llevan su id oculto para exportar el documento completo', async () => {
    const { servicio, prisma } = crear({ informeInspeccion: { findMany: vi.fn() }, auditoria5s: { findMany: vi.fn() } });
    prisma.informeInspeccion.findMany.mockResolvedValue([{ id: 'inf-1', agenciaId: 'ag-a', numero: 'INF-2026-0001', fecha: new Date('2026-03-01T00:00:00Z'), tipoInspeccion: 'RUTINA', estado: 'APROBADO', inspector: { name: 'Ana', lastname: 'Mora' }, destinatarioNombre: 'Luis', asunto: 'Visita', calificacion: 'BUENO' }]);
    prisma.auditoria5s.findMany.mockResolvedValue([{ id: 'a5-1', agenciaId: 'ag-a', codigo: 'A5S-2026-0001', fecha: new Date('2026-03-01T00:00:00Z'), area: 'LAVADO', formato: 'LISTA_20', auditor: { name: 'Ana', lastname: 'Mora' }, estado: 'FINALIZADA', puntaje: 90, porcentaje: 90, semaforo: 'VERDE' }]);
    const admin = usuario('SUPER_ADMIN', 'GLOBAL', []);
    const periodo = { modo: 'ANIO_DE' as const, anio: 2026 };
    const informes = await servicio.generar({ reporteId: 'informes-inspeccion', periodo }, admin);
    const cincoS = await servicio.generar({ reporteId: 'auditorias-5s', periodo }, admin);
    expect(informes.grupos[0].bloques[0].filas[0]).toHaveProperty('_id', 'inf-1');
    expect(cincoS.grupos[0].bloques[0].filas[0]).toHaveProperty('_id', 'a5-1');
    // El id no es una columna: no sale en el listado exportado.
    expect(informes.columnas.map((c) => c.clave)).not.toContain('_id');
  });

  it('al exportar el documento de una auditoría la bitácora anota cuál fue', async () => {
    const { servicio, prisma } = crear();
    await servicio.registrarExportacion({ reporteId: 'informes-inspeccion', formato: 'PDF', totalFilas: 1, documentoId: 'inf-1', periodo: { modo: 'HOY' } }, usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'informes.ver']));
    expect(prisma.exportacionReporte.create.mock.calls[0][0].data.filtros).toMatchObject({ documentoId: 'inf-1' });
  });
});

describe('bitácora de exportaciones', () => {
  it('registra la exportación con el usuario, el reporte y el formato', async () => {
    const { servicio, prisma } = crear();
    await servicio.registrarExportacion({ reporteId: 'incidentes', formato: 'PDF', totalFilas: 12, periodo: { modo: 'HOY' } }, usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'incidentes.ver']));
    expect(prisma.exportacionReporte.create.mock.calls[0][0].data).toMatchObject({ usuarioId: 'u1', reporte: 'incidentes', formato: 'PDF', totalFilas: 12 });
  });

  it('no registra (ni permite) exportar en un formato que el rol no tiene', async () => {
    const { servicio, prisma } = crear();
    const soloPdf = usuario('SUPERVISOR', 'REGION', ['reportes.ver', 'reportes.pdf', 'incidentes.ver']);
    await expect(servicio.registrarExportacion({ reporteId: 'incidentes', formato: 'EXCEL' }, soloPdf)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.exportacionReporte.create).not.toHaveBeenCalled();
  });

  it('no registra una exportación de un reporte de un módulo no activo', async () => {
    const { servicio } = crear();
    await expect(servicio.registrarExportacion({ reporteId: 'kardex', formato: 'EXCEL' }, usuario('SUPERVISOR', 'REGION', PERMISOS_REPORTES))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('solo ADMIN y SUPER_ADMIN consultan la bitácora', async () => {
    const { servicio } = crear();
    await expect(servicio.bitacora(usuario('SUPERVISOR', 'REGION', ['roles.ver']))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.bitacora(usuario('ADMIN', 'GLOBAL', ['roles.ver']))).resolves.toEqual([]);
    await expect(servicio.bitacora(usuario('SUPER_ADMIN', 'GLOBAL', []))).resolves.toEqual([]);
  });
});

describe('reportes del aprobador: solo sus servicios y solo 30 días atrás', () => {
  const aprobador = usuario('APROBADOR', 'AGENCIA', [...PERMISOS_REPORTES, 'servicios.ver', 'especiales.ver', 'catalogo.ver', 'precios.ver', 'agencias.ver'], { agenciaId: 'ag-a' });
  const hoy = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const haceDias = (n: number) => new Date(Date.now() - 5 * 3_600_000 - n * 86_400_000).toISOString().slice(0, 10);

  it('el catálogo solo trae los reportes de servicios generales y especiales', () => {
    const { servicio } = crear();
    expect(servicio.catalogo(aprobador).map((r) => r.id).sort()).toEqual(['servicios-lavado']);
  });

  it('no puede sacar otro reporte aunque su permiso lo permitiría (precios del catálogo)', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'catalogo-precios' }, aprobador)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un periodo que empieza hace más de 30 días se recorta a esos 30 días', async () => {
    const { servicio } = crear();
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: { modo: 'RANGO', desde: haceDias(90), hasta: hoy() } }, aprobador);
    expect(r.filtros.periodo).toContain('máximo 30 días');
  });

  it('un periodo que termina hace más de 30 días se rechaza', async () => {
    const { servicio } = crear();
    await expect(
      servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: { modo: 'RANGO', desde: haceDias(90), hasta: haceDias(40) } }, aprobador),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un periodo dentro de los últimos 30 días no se toca', async () => {
    const { servicio } = crear();
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo: { modo: 'RANGO', desde: haceDias(10), hasta: hoy() } }, aprobador);
    expect(r.filtros.periodo).not.toContain('máximo 30 días');
  });
});

describe('servicios de lavado: generales, especiales o ambos', () => {
  const periodo = { modo: 'ANIO_DE' as const, anio: 2026 };
  const general = (fecha: string) => ({
    ordenTrabajoOT: 'OT-G', placa: 'ABC-123', marca: 'Kia', modelo: 'H300', color: 'Rojo', estado: 'FINALIZADO', precio: 10, observaciones: null,
    horaIngreso: new Date(`${fecha}T15:00:00Z`), horaSalida: null, bahia: { agenciaId: 'ag-a' }, catalogo: { nombre: 'Lavado' }, operador: { name: 'Juan', lastname: 'Paz' }, operadoresAsignados: [],
  });
  const especial = (fecha: string) => ({
    id: 'se1', codigoSE: 'SE-1', ordenTrabajoOT: null, tipoServicio: 'Pulido', operadorId: 'pul1', placa: 'XYZ-987', marca: null, modelo: 'BUS', color: null, estado: 'Completado', precio: 30, agenciaId: 'ag-a',
    observaciones: null, creadoPorNombre: 'Asesor Uno', fechaProgramada: new Date(`${fecha}T15:00:00Z`), createdAt: new Date(`${fecha}T15:00:00Z`), horaIngreso: null, fechaInicio: null, fechaFin: null,
  });
  const montar = () => {
    const c = crear({ auditoriaDecision: { findMany: vi.fn().mockResolvedValue([]) }, user: { findMany: vi.fn().mockResolvedValue([{ id: 'pul1', name: 'Pedro', lastname: 'Ruiz' }]), findUnique: vi.fn().mockResolvedValue({ name: 'X', lastname: 'Y' }) } });
    c.prisma.servicioLavado.findMany.mockResolvedValue([general('2026-03-05')]);
    c.prisma.servicioEspecial.findMany.mockResolvedValue([especial('2026-03-02')]);
    return c;
  };
  const ambos = usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver', 'especiales.ver', 'precios.ver'], { regionId: 'r1' });

  it('«Ambos» junta los dos tipos en una sola lista por fecha, con el tipo y quien hizo cada servicio', async () => {
    const { servicio } = montar();
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'AMBOS', periodo }, ambos);
    expect(r.columnas.map((c) => c.clave)).toEqual(expect.arrayContaining(['tipo', 'lavador', 'asesor', 'precio']));
    const filas = r.grupos[0].bloques.flatMap((b) => b.filas);
    expect(filas.map((f) => [f.tipo, f.lavador, f.asesor])).toEqual([['Especial', 'Pedro Ruiz', 'Asesor Uno'], ['General', 'Juan Paz', '']]);
    expect(r.totalFilas).toBe(2);
    expect(r.filtros.extras).toContainEqual({ etiqueta: 'Servicios', valor: 'Generales y especiales' });
  });

  it('«Generales» y «Especiales» conservan sus columnas de siempre, sin las del otro tipo', async () => {
    const { servicio } = montar();
    const g = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo }, ambos);
    expect(g.columnas.map((c) => c.clave)).toContain('lavador');
    expect(g.columnas.map((c) => c.clave)).not.toContain('asesor');
    expect(g.columnas.map((c) => c.clave)).not.toContain('tipo');
    expect(g.totalFilas).toBe(1);
    const e = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'ESPECIAL', periodo }, ambos);
    expect(e.columnas.map((c) => c.clave)).toContain('asesor');
    expect(e.columnas.map((c) => c.clave)).not.toContain('lavador');
    expect(e.totalFilas).toBe(1);
  });

  it('sin elegir categoría usa la más amplia que el rol permite', async () => {
    const { servicio } = montar();
    expect((await servicio.generar({ reporteId: 'servicios-lavado', periodo }, ambos)).totalFilas).toBe(2);
    const soloGenerales = usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' });
    expect((await servicio.generar({ reporteId: 'servicios-lavado', periodo }, soloGenerales)).totalFilas).toBe(1);
  });

  it('con un solo permiso no puede sacar la otra categoría ni «Ambos», y el catálogo solo ofrece la suya', async () => {
    const { servicio } = montar();
    const soloEspeciales = usuario('COORD_SERVICIOS_ESPECIALES', 'REGION', [...PERMISOS_REPORTES, 'especiales.ver'], { regionId: 'r1' });
    await expect(servicio.generar({ reporteId: 'servicios-lavado', categoria: 'GENERAL', periodo }, soloEspeciales)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.generar({ reporteId: 'servicios-lavado', categoria: 'AMBOS', periodo }, soloEspeciales)).rejects.toBeInstanceOf(ForbiddenException);
    const catalogo = servicio.catalogo(soloEspeciales).find((r) => r.id === 'servicios-lavado')!;
    expect(catalogo.categorias.map((c) => c.valor)).toEqual(['ESPECIAL']);
    expect(servicio.catalogo(ambos).find((r) => r.id === 'servicios-lavado')!.categorias.map((c) => c.valor)).toEqual(['GENERAL', 'ESPECIAL', 'AMBOS']);
  });

  it('sin permiso de precios no salen la columna Precio ni el monto', async () => {
    const { servicio } = montar();
    const sinPrecios = usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver', 'especiales.ver'], { regionId: 'r1' });
    const r = await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'AMBOS', periodo }, sinPrecios);
    expect(r.columnas.map((c) => c.clave)).not.toContain('precio');
    expect(r.totales.map((t) => t.clave)).not.toContain('monto');
  });

  it('con «Ambos», elegir un lavador deja solo los generales y elegir un pulidor solo los especiales', async () => {
    const { servicio } = montar();
    expect((await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'AMBOS', lavadorId: 'l1', periodo }, ambos)).grupos[0].bloques.flatMap((b) => b.filas).map((f) => f.tipo)).toEqual(['General']);
    expect((await servicio.generar({ reporteId: 'servicios-lavado', categoria: 'AMBOS', pulidorId: 'p1', periodo }, ambos)).grupos[0].bloques.flatMap((b) => b.filas).map((f) => f.tipo)).toEqual(['Especial']);
  });
});
