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
    expect(servicio.catalogo(usuario('SUPER_ADMIN', 'GLOBAL', []))).toHaveLength(14);
  });
});

describe('generar', () => {
  const periodoAnio = { modo: 'ANIO_DE' as const, anio: 2026 };

  it('rechaza un reporte de un módulo que el rol no tiene activo', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'servicios-generales', periodo: periodoAnio }, usuario('SUPERVISOR', 'REGION', PERMISOS_REPORTES))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un reporte de periodo exige elegir el periodo', async () => {
    const { servicio } = crear();
    await expect(servicio.generar({ reporteId: 'servicios-generales' }, usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' }))).rejects.toBeInstanceOf(BadRequestException);
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
      { reporteId: 'servicios-generales', periodo: periodoAnio, agenciaIds: ['ag-de-otra-region'], regionId: 'r-ajena' },
      usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' }),
    );
    const donde = prisma.agencia.findMany.mock.calls[0][0].where.AND;
    expect(donde).toContainEqual({ regionId: 'r1' });
    expect(donde).toContainEqual({ id: { in: ['ag-de-otra-region'] } });
    expect(donde).toContainEqual({ regionId: 'r-ajena' });
  });

  it('un usuario sin ámbito (le falta su agencia o región) no consulta ningún dato', async () => {
    const { servicio, prisma } = crear();
    await servicio.generar({ reporteId: 'servicios-generales', periodo: periodoAnio }, usuario('LIDER', 'AGENCIA', [...PERMISOS_REPORTES, 'servicios.ver']));
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
    const r = await servicio.generar({ reporteId: 'servicios-generales', periodo: periodoAnio }, usuario('SUPER_ADMIN', 'GLOBAL', []));

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
    const r = await servicio.generar({ reporteId: 'servicios-generales', periodo: periodoAnio }, usuario('SUPERVISOR', 'REGION', [...PERMISOS_REPORTES, 'servicios.ver'], { regionId: 'r1' }));
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
    const r = await servicio.generar({ reporteId: 'servicios-generales', periodo: periodoAnio }, admin);
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
    const r = await servicio.generar({ reporteId: 'servicios-especiales', periodo: periodoAnio }, admin);
    const filas = r.grupos[0].bloques[0].filas;
    expect(filas.map((f) => [f.aprobado, f.aprobadoPor])).toEqual([['SI', 'Luis Mora'], ['NO', 'Ana Ríos'], ['', '']]);
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
