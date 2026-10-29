import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): alcance, filtros y cálculos de los dashboards.
 *
 * La base real tiene datos de otros usuarios, así que TODAS las consultas se acotan a regiones/agencias creadas aquí
 * (y las fechas son de enero de 2026, un periodo fijo). Los totales globales (usuarios, inventario sin filtro)
 * solo se comparan con "al menos".
 *
 * Mundo
 *  R1: A1 (bahías B1, B2, B5 sin actividad), A3 y A4.   R2: A2 (bahía B3) y A5.
 *  Servicios (catálogo G = GENERAL, E = ESPECIAL):
 *    s1 A1/B1 G $30  lun 5-ene 10:00→10:30  Toyota Corolla Rojo  · pulidor fijo de A1
 *    s2 A1/B1 E $50  mar 6-ene 15:00→16:00  Toyota Hilux Rojo    · pulidor fijo de A1
 *    s3 A1/B2 G $20  mar 6-ene 11:00→11:20  Kia Rio Azul         · lavador de A1
 *    s4 A2/B3 G $40  lun 5-ene 09:00                              · lavador de A2
 *    s5 A1/B1 G $10  EN_PROCESO 7-ene                             · lavador de A1
 *    s6 A1/B1 G $80  FINALIZADO 15-dic-2025 (mes anterior)
 *    s7, s8 A1/B1 anulados el 28-ene
 *  Incidentes: i1 M1 ALTA abierto $300 (7-ene) · i2 M1 BAJA resuelto en 10 h $100 (6-ene) · i4 M1 MEDIA resuelto en 20 h
 *  (8-ene) · i3 M3(A3) ALTA resuelto en 48 h $200 (9-ene, lo reporta el lavador de A2) · i5 M1 abierto de dic-2025 $999.
 *  Insumos X1..X4 (mín. 10 / ideal 40) con existencias en R1; Y1 en R2.
 */
const ENE_5_11 = { rango: 'RANGO', fechaDesde: '2026-01-05', fechaHasta: '2026-01-11' } as any;
const ENERO = { rango: 'RANGO', fechaDesde: '2026-01-01', fechaHasta: '2026-01-31' } as any;
const f = (d: number, h = 0, mi = 0, mes = 1, anio = 2026) => new Date(anio, mes - 1, d, h, mi);

describe('AnalyticsService (base real)', () => {
  let env: Entorno;
  let service: AnalyticsService;
  let r1: any, r2: any;
  let a1: any, a2: any, a3: any, a4: any, a5: any;
  let b1: any, b2: any, b5: any;
  let pulidor: any, lavador: any, lavador2: any;
  let x: any[];
  let y1: any;
  let gen: any, esp: any;
  const act: Record<string, any> = {};
  const nombreCompleto = (u: any) => `${u.name} ${u.lastname}`;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AnalyticsService(env.prisma as never);
    r1 = await env.region('R1');
    r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r1.id });
    a4 = await env.agencia('A4', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r2.id });
    a5 = await env.agencia('A5', { regionId: r2.id });
    b1 = await env.bahia('B1', a1.id);
    b2 = await env.bahia('B2', a1.id);
    b5 = await env.bahia('B5', a1.id);
    const b3 = await env.bahia('B3', a2.id);
    gen = await env.catalogo('G', { categoria: 'GENERAL', precio: 30 });
    esp = await env.catalogo('E', { categoria: 'ESPECIAL', precio: 50 });

    pulidor = await env.usuario('pulidor', 'PULIDOR', { agenciaId: a1.id });
    lavador = await env.usuario('lavador', 'LAVADOR', { agenciaId: a1.id });
    lavador2 = await env.usuario('lavador2', 'LAVADOR', { agenciaId: a2.id });
    const roles: Array<[string, string, Record<string, any>]> = [
      ['superadmin', 'SUPER_ADMIN', {}],
      ['admin', 'ADMIN', {}],
      ['lider', 'LIDER', { agenciaId: a1.id }],
      ['liderSinAgencia', 'LIDER', {}],
      ['supervisor', 'SUPERVISOR', { regionId: r1.id }],
      ['aprobador', 'APROBADOR', { agenciaId: a1.id }],
      ['comercial', 'COORD_COMERCIAL', { regionId: r1.id }],
      ['coordBodega', 'COORD_BODEGA', {}],
      ['asistenteBodega', 'ASISTENTE_BODEGA', { regionId: r1.id }],
      ['coordEspeciales', 'COORD_SERVICIOS_ESPECIALES', { regionId: r1.id }],
    ];
    for (const [sufijo, rol, opts] of roles) act[sufijo] = await env.actor((await env.usuario(sufijo.toLowerCase(), rol, opts)).id);

    // ── Servicios de lavado ───────────────────────────────────────────────────────────────────────────────────
    const s1 = await env.servicioLavado({ bahiaId: b1.id, operadorId: pulidor.id, catalogoId: gen.id, precio: 30, horaIngreso: f(5, 10), horaSalida: f(5, 10, 30), modelo: 'Corolla', datos: { marca: 'Toyota', color: 'Rojo', horaInicio: f(5, 10) } });
    const s2 = await env.servicioLavado({ bahiaId: b1.id, operadorId: pulidor.id, catalogoId: esp.id, precio: 50, horaIngreso: f(6, 15), horaSalida: f(6, 16), modelo: 'Hilux', datos: { marca: 'Toyota', color: 'Rojo', horaInicio: f(6, 15) } });
    const s3 = await env.servicioLavado({ bahiaId: b2.id, operadorId: lavador.id, catalogoId: gen.id, precio: 20, horaIngreso: f(6, 11), horaSalida: f(6, 11, 20), modelo: 'Rio', datos: { marca: 'Kia', color: 'Azul' } });
    const s4 = await env.servicioLavado({ bahiaId: b3.id, operadorId: lavador2.id, catalogoId: gen.id, precio: 40, horaIngreso: f(5, 9), horaSalida: null });
    await env.servicioLavado({ bahiaId: b1.id, operadorId: lavador.id, catalogoId: gen.id, precio: 10, estado: 'EN_PROCESO', horaIngreso: f(7, 9), horaSalida: null });
    await env.servicioLavado({ bahiaId: b1.id, operadorId: pulidor.id, catalogoId: gen.id, precio: 80, horaIngreso: f(15, 10, 0, 12, 2025), horaSalida: f(15, 11, 0, 12, 2025) });
    for (const n of [7, 8]) {
      await env.servicioLavado({ bahiaId: b1.id, operadorId: lavador.id, catalogoId: gen.id, precio: 10, estado: 'CANCELADO', horaIngreso: f(28, 12), horaSalida: null, datos: { anuladoEn: f(28, 12, n) } });
    }

    // ── Insumos, existencias y consumos ────────────────────────────────────────────────────────────────────────
    x = [];
    for (const n of [1, 2, 3, 4]) x.push(await env.insumo(`X${n}`));
    y1 = await env.insumo('Y1');
    await env.prisma.insumo.updateMany({
      where: { id: { in: [...x.map((i) => i.id), y1.id] } },
      data: { stockMinimoAgencia: 10, stockOptimoAgencia: 40 },
    });
    const stock = (insumoId: string, agenciaId: string, cantidad: number) => env.stock({ insumoId, tipoUbicacion: 'AGENCIA', agenciaId, cantidad });
    for (const i of x) await stock(i.id, a4.id, 0); // "Solo Agotada": 4 posiciones agotadas
    await stock(x[0].id, a3.id, 4); // "Con Mezcla": 2 críticas y 1 bajo el ideal
    await stock(x[1].id, a3.id, 4);
    await stock(x[2].id, a3.id, 20);
    await stock(x[0].id, a1.id, 0); // "Otra Agotada"
    await stock(y1.id, a2.id, 4); // R2: 36 + 10 unidades de reposición
    await stock(y1.id, a5.id, 30);
    const consumo = (servicioId: string, insumoId: string, agenciaId: string, cantidadUsada: number) =>
      env.prisma.consumoServicio.create({ data: { servicioId, insumoId, agenciaId, cantidadUsada } });
    await consumo(s1.id, x[0].id, a1.id, 2);
    await consumo(s2.id, x[0].id, a1.id, 1);
    await consumo(s4.id, y1.id, a2.id, 5);
    void s3;

    // ── Maquinaria e incidentes ───────────────────────────────────────────────────────────────────────────────
    const m1 = await env.maquinaria('M1', { agenciaId: a1.id });
    const m3 = await env.maquinaria('M3', { agenciaId: a3.id });
    const incidente = (maquinariaId: string, por: string, titulo: string, gravedad: string, estado: string, reporte: Date, costoTotal: number | null, horasHastaSolucion?: number) =>
      env.prisma.incidenteTecnico.create({
        data: {
          maquinariaId, reportadoPorId: por, titulo, descripcion: titulo, gravedad, estado, costoTotal,
          fechaReporte: reporte, createdAt: reporte,
          fechaSolucion: horasHastaSolucion ? new Date(reporte.getTime() + horasHastaSolucion * 3600000) : null,
        },
      });
    await incidente(m1.id, pulidor.id, 'Fuga de aceite', 'ALTA', 'ABIERTO', f(7, 9), 300);
    await incidente(m1.id, pulidor.id, 'Manguera floja', 'BAJA', 'RESUELTO', f(6, 8), 100, 10);
    await incidente(m1.id, pulidor.id, 'Ruido en motor', 'MEDIA', 'RESUELTO', f(8, 8), null, 20);
    await incidente(m3.id, lavador2.id, 'Cable roto', 'ALTA', 'RESUELTO', f(9, 8), 200, 48);
    await incidente(m1.id, pulidor.id, 'Incidente antiguo', 'BAJA', 'ABIERTO', f(20, 8, 0, 12, 2025), 999);

    // ── Alertas, movimientos y solicitudes ────────────────────────────────────────────────────────────────────
    await env.prisma.alertaStock.create({ data: { insumoId: x[0].id, agenciaId: a1.id, usuarioEmisorId: pulidor.id, nivel: 'CRITICO', mensaje: 'poco' } });
    await env.prisma.alertaStock.create({ data: { insumoId: y1.id, agenciaId: a2.id, usuarioEmisorId: pulidor.id, nivel: 'BAJO', mensaje: 'poco' } });
    await env.movimiento({ usuarioDespachaId: pulidor.id, tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'EN_TRANSITO', destinoAgenciaId: a1.id, destinoUbicacion: a1.nombre, detalle: { insumoId: x[0].id, cantidadEnviada: 5 } });
    await env.movimiento({ usuarioDespachaId: pulidor.id, tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'EN_TRANSITO', destinoAgenciaId: a2.id, destinoUbicacion: a2.nombre, detalle: { insumoId: y1.id, cantidadEnviada: 7 } });
    const solicitud = (estado: string, montoUSD: number, entidadRefId: string | null) =>
      env.prisma.solicitudAprobacion.create({
        data: { tipo: 'DESCUENTO', titulo: 'Descuento', estado, montoUSD, entidadRefId, solicitanteId: pulidor.id, agenciaId: a1.id, createdAt: f(28, 20) },
      });
    await solicitud('APROBADO', 30, s1.id); // 30 de 30 → 100 %: fuera de rango
    await solicitud('PENDIENTE', 1, s3.id); // 1 de 20 → 5 %: dentro
    await solicitud('PENDIENTE', 20, null); // sin servicio enlazado: no cuenta

    // ── Servicios especiales ──────────────────────────────────────────────────────────────────────────────────
    await env.servicioEspecial({ operadorId: pulidor.id, agenciaId: a1.id, regionId: r1.id, estado: 'Completado', precio: 70, tipoServicio: 'Lavado', datos: { createdAt: f(28, 20) } });
    await env.servicioEspecial({ operadorId: lavador.id, agenciaId: a1.id, regionId: r1.id, estado: 'Pendiente', fechaFin: null, precio: 10, tipoServicio: 'Lavado', datos: { createdAt: f(28, 10) } });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('dashboard — alcance', () => {
    it('cada rol ve solo su agencia o su región; el cliente solo acota dentro de su alcance', async () => {
      // Líder de A1 pide A2: sigue viendo A1 (s1, s2, s3 y el EN_PROCESO).
      const lider: any = await service.getDashboardMetrics({ ...ENE_5_11, agenciaId: a2.id }, act.lider);
      expect(lider.kpis.totalLavadosHoy).toBe(4);
      // Supervisor de R1 pide R2: sigue viendo R1.
      const supervisor: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r2.id }, act.supervisor);
      expect(supervisor.kpis.totalLavadosHoy).toBe(4);
      expect(supervisor.isSupervisorView).toBe(true);
    });

it('un usuario global puede acotar a la agencia o región que pida', async () => {
      const agencia: any = await service.getDashboardMetrics({ ...ENE_5_11, agenciaId: a2.id }, act.coordBodega);
      expect(agencia.kpis.totalLavadosHoy).toBe(1);
      const region: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r2.id }, act.coordBodega);
      expect(region.kpis.totalLavadosHoy).toBe(1);
      const r1res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.coordBodega);
      expect(r1res.kpis.totalLavadosHoy).toBe(4);
    });

    it('un rol de agencia sin agencia no ve nada, en ninguna de las consultas', async () => {
      const sin = act.liderSinAgencia;
      const dash: any = await service.getDashboardMetrics({ ...ENE_5_11, agenciaId: a1.id }, sin);
      expect(dash.kpis).toMatchObject({ totalLavadosHoy: 0, incidentesAbiertos: 0, alertasStockPendientes: 0 });
      expect(dash.alertasOperativas).toEqual([]);
      expect((await service.getDashboardTaller({ ...ENERO, agenciaId: a1.id }, sin) as any).kpis.totalMaquinaria).toBe(0);
      expect((await service.getDashboardBodega({ agenciaId: a1.id }, sin) as any).kpis).toMatchObject({ totalAlertasActivas: 0, unidadesStock: 0, despachos30d: 0 });
      expect((await service.getRankingLavadores({ ...ENE_5_11, agenciaId: a1.id }, sin)).ranking).toEqual([]);
      expect((await service.getConsumoQuimicos({ agenciaId: a1.id }, sin) as any).insumos).toEqual([]);
    });
  });

  describe('dashboard admin — KPIs estratégicos', () => {
    it('calcula ingresos, ticket, crecimiento y costo de reparaciones del alcance pedido', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.admin);

      expect(res.isSuperAdminView).toBe(true);
      expect(res.kpis.ingresoHoy).toBe(100); // 30 + 50 + 20
      expect(res.kpis.serviciosCompletadosHoy).toBe(3);
      expect(res.kpis.ticketPromedioHoy).toBe(33.33);
      expect(res.kpis.ingresoMes).toBe(100);
      expect(res.kpis.ingresoMesAnterior).toBe(80);
      expect(res.kpis.variacionMesPct).toBe(25); // (100 - 80) / 80
      // Solo los incidentes dentro del periodo (el de diciembre y los de fuera de R1 no suman): 300 + 100 + 200.
      expect(res.kpis.costoReparaciones30d).toBe(600);
      // Inventario y tránsito son globales: al menos lo creado aquí (28 en R1 + 34 en R2; 5 + 7 en tránsito).
      expect(res.kpis.unidadesInventario).toBeGreaterThanOrEqual(62);
      expect(res.kpis.unidadesEnTransito).toBeGreaterThanOrEqual(12);
      // El ADMIN recibe la misma vista que el SUPER_ADMIN (ya no la de administración con conteo de usuarios).
      expect(res.kpis.totalUsuarios).toBeUndefined();
      // A3 aparece sin servicios porque tuvo incidentes en el periodo.
      expect(res.topAgenciasProductivas).toEqual([{ nombre: a1.nombre, cantidad: 3 }, { nombre: a3.nombre, cantidad: 0 }]);
      expect(res.topColores).toEqual([{ nombre: 'Rojo', cantidad: 2 }, { nombre: 'Azul', cantidad: 1 }]);
      expect(res.mixGenerales).toMatchObject([{ nombre: gen.nombre, cantidad: 2 }]);
      expect(typeof res.mixGenerales[0].monto).toBe('number');
      expect(res.mixEspeciales).toMatchObject([{ nombre: esp.nombre, cantidad: 1 }]);
    });

    it('la rentabilidad por agencia suma los gastos en insumos, mantenimientos e incidencias, sin ganancia neta', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.superadmin);
      const [primera, segunda] = res.topAgenciasRentabilidad;
      expect(primera).toMatchObject({ nombre: a1.nombre, ingresos: 100, costoIncidentes: 400 });
      expect(primera.unidadesInsumos).toBe(3); // 2 + 1 consumidas
      expect(typeof primera.costoInsumos).toBe('number');
      expect(primera.gastosOperativos).toBeCloseTo(primera.costoInsumos + primera.costoIncidentes + primera.costoMantenimientos, 2);
      expect(primera.gananciaNeta).toBeUndefined();
      expect(segunda).toMatchObject({ nombre: a3.nombre, ingresos: 0, costoIncidentes: 200 });
      expect(res.kpis.gananciaNetaGlobal).toBeUndefined();
      expect(res.kpis.gastoIncidentesGlobal).toBe(600);
      expect(res.kpis.gastosOperativosGlobal).toBeCloseTo(res.kpis.gastoInsumosGlobal + res.kpis.gastoMantenimientosGlobal + 600, 2);
      expect(res.rankingsAgencias.gastoInsumos).toBeDefined();
      expect(res.rankingsAgencias.gastoMantenimientos).toBeDefined();
    });

    it('el panel comercial reporta el consumo de insumos en unidades, nunca en USD', async () => {
      const res: any = await service.getDashboardMetrics(ENE_5_11, act.comercial);
      expect(res.isComercialView).toBe(true);
      expect(res.kpis).toMatchObject({ serviciosHoy: 4, servicios30Dias: 4, unidadesQuimicos: 3, premiumPct: 25 });
      expect(res.kpis.costoQuimicos30d).toBeUndefined();
    });
  });

  describe('dashboard admin — drill-down jerárquico', () => {
    it('con región filtrada agrupa por agencia, calcula el heatmap y lista las agencias con menos actividad', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.superadmin);
      const j = res.jerarquia;

      expect(j.dimension).toBe('REGION');
      expect(j.entidad).toBe('Agencia');
      expect(j.desglose).toEqual([{ nombre: a1.nombre, cantidad: 3, tiempoPromedioMin: 37, ingresos: 100 }]); // (30 + 60 + 20) / 3
      expect(j.kpis).toMatchObject({ registros: 3, ingresos: 100 });
      // Lunes 10:00 → índice de hora 3; martes 15:00 → 8; martes 11:00 → 4.
      expect(j.heatmap.matriz[0][3]).toBe(1);
      expect(j.heatmap.matriz[1][8]).toBe(1);
      expect(j.heatmap.matriz[1][4]).toBe(1);
      // Incluye las agencias activas que no registraron servicios, las de menos actividad primero.
      expect(j.bajaActividad.entidad).toBe('Agencia');
      expect(j.bajaActividad.items.map((i: any) => i.cantidad)).toEqual([0, 0, 3]);
      expect(j.bajaActividad.items[2].nombre).toBe(a1.nombre);
      expect(j.bajaActividad.items.slice(0, 2).map((i: any) => i.nombre).sort()).toEqual([a3.nombre, a4.nombre].sort());
    });

    it('con agencia filtrada agrupa por bahía y la menor actividad incluye las bahías sin servicios', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, agenciaId: a1.id }, act.superadmin);
      const j = res.jerarquia;
      expect(j.dimension).toBe('AGENCY');
      expect(j.entidad).toBe('Bahía');
      expect(j.desglose.map((d: any) => [d.nombre, d.cantidad])).toEqual([[b1.nombre, 2], [b2.nombre, 1]]);
      expect(j.ranking.entidad).toBe('Bahía');
      expect(j.bajaActividad.entidad).toBe('Bahía');
      expect(j.bajaActividad.items.map((i: any) => [i.nombre, i.cantidad])).toEqual([[b5.nombre, 0], [b2.nombre, 1], [b1.nombre, 2]]);
    });

    it('con un pulidor filtra por operador y agrupa por día (evolución)', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id, pulidorId: pulidor.id }, act.superadmin);
      const j = res.jerarquia;
      expect(j.dimension).toBe('POLISHER');
      expect(j.entidad).toBe('Día');
      expect(j.desglose.map((d: any) => d.nombre).sort()).toEqual(['2026-01-05', '2026-01-06']);
      expect(j.kpis.registros).toBe(2);
    });

    it('el desglose explícito decide la agrupación del gráfico de rendimiento', async () => {
      const base = { ...ENE_5_11, regionId: r1.id };
      const porAgencia: any = await service.getDashboardMetrics({ ...base, desglose: 'AGENCY' }, act.superadmin);
      expect(porAgencia.jerarquia).toMatchObject({ agrupacion: 'AGENCY', entidad: 'Agencia', titulo: 'Rendimiento Operativo Nacional por Agencia' });
      expect(porAgencia.jerarquia.desglose.map((d: any) => d.nombre)).toEqual([a1.nombre]);

      const porPulidor: any = await service.getDashboardMetrics({ ...base, desglose: 'POLISHER' }, act.superadmin);
      expect(porPulidor.jerarquia).toMatchObject({ entidad: 'Pulidor', titulo: 'Rendimiento Operativo por Pulidor' });
      expect(porPulidor.jerarquia.desglose.map((d: any) => [d.nombre, d.cantidad])).toEqual([
        [nombreCompleto(pulidor), 2],
        [nombreCompleto(lavador), 1],
      ]);
      expect(porPulidor.jerarquia.bajaActividad.entidad).toBe('Pulidor');

      const porRegion: any = await service.getDashboardMetrics({ ...base, desglose: 'REGION' }, act.superadmin);
      expect(porRegion.jerarquia.agrupacion).toBe('REGION');
      expect(porRegion.jerarquia.desglose.map((d: any) => d.nombre)).toEqual([r1.nombre]);
      // Sin desglose y filtrando por región, el gráfico agrupa por agencia (comportamiento previo intacto).
      const sin: any = await service.getDashboardMetrics(base, act.superadmin);
      expect(sin.jerarquia.agrupacion).toBe('AGENCY');
    });
  });

  describe('filtros globales — tipo de servicio, pulidor e incidentes', () => {
    it('el tipo de servicio acota KPI, mezcla y desglose', async () => {
      const base = { ...ENE_5_11, regionId: r1.id };
      const especiales: any = await service.getDashboardMetrics({ ...base, categoriaServicio: 'ESPECIAL' }, act.superadmin);
      expect(especiales.kpis).toMatchObject({ serviciosCompletadosHoy: 1, ingresoHoy: 50, totalLavadosHoy: 1 });
      expect(especiales.mixEspeciales).toMatchObject([{ nombre: esp.nombre, cantidad: 1 }]);
      expect(especiales.mixGenerales).toEqual([]);
      expect(especiales.jerarquia.kpis.registros).toBe(1);

      const generales: any = await service.getDashboardMetrics({ ...base, categoriaServicio: 'GENERAL' }, act.superadmin);
      expect(generales.kpis).toMatchObject({ serviciosCompletadosHoy: 2, ingresoHoy: 50 });

      const todos: any = await service.getDashboardMetrics(base, act.superadmin);
      expect(todos.kpis.serviciosCompletadosHoy).toBe(3);
    });

    it('elegir servicios concretos acota los gráficos que dependen del servicio', async () => {
      const base = { ...ENE_5_11, regionId: r1.id };
      const soloEspecial: any = await service.getDashboardMetrics({ ...base, servicioIds: [esp.id] }, act.superadmin);
      expect(soloEspecial.kpis).toMatchObject({ serviciosCompletadosHoy: 1, ingresoHoy: 50 });
      expect(soloEspecial.mixGenerales).toEqual([]);
      expect(soloEspecial.mixEspeciales).toMatchObject([{ nombre: esp.nombre, cantidad: 1 }]);
      const ambos: any = await service.getDashboardMetrics({ ...base, servicioIds: [esp.id, gen.id] }, act.superadmin);
      expect(ambos.kpis.serviciosCompletadosHoy).toBe(3);
      // Combinado con la categoría: un servicio general dentro de "especiales" no deja nada.
      const cruzado: any = await service.getDashboardMetrics({ ...base, categoriaServicio: 'ESPECIAL', servicioIds: [gen.id] }, act.superadmin);
      expect(cruzado.kpis.serviciosCompletadosHoy).toBe(0);
    });

    it('el filtro por pulidor acota los servicios al operador elegido', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id, pulidorId: lavador.id }, act.superadmin);
      expect(res.kpis).toMatchObject({ serviciosCompletadosHoy: 1, ingresoHoy: 20 });
    });

    it('los incidentes se acotan por agencia y por el pulidor seleccionado (vía reportante)', async () => {
      const todos: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.superadmin);
      expect(todos.kpis.incidentesAbiertos).toBe(2); // i1 y el de diciembre (los abiertos no dependen del periodo)
      const delLavador: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id, pulidorId: lavador2.id }, act.superadmin);
      // El lavador de A2 reportó el incidente de la máquina de A3; sigue dentro de R1 porque el alcance manda.
      expect(delLavador.incidentesPorGravedad).toEqual([{ nombre: 'ALTA', cantidad: 1 }]);
    });

    it('las fallas se ordenan de la más grave a la más leve y omiten las severidades sin fallas', async () => {
      const res: any = await service.getDashboardMetrics(ENE_5_11, act.supervisor);
      expect(res.incidentesPorGravedad).toEqual([
        { nombre: 'ALTA', cantidad: 2 },
        { nombre: 'MEDIA', cantidad: 1 },
        { nombre: 'BAJA', cantidad: 1 },
      ]);
    });

    it('publica los rankings completos de agencias (sin recortar) para el control Top N', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.admin);
      // El top clásico y el ranking del control coinciden aquí porque R1 tiene pocas agencias; el ranking nunca se recorta.
      expect(res.rankingsAgencias.servicios).toEqual([{ nombre: a1.nombre, valor: 3 }, { nombre: a3.nombre, valor: 0 }]);
      for (const ranking of Object.values(res.rankingsAgencias) as { valor: number }[][]) {
        const valores = ranking.map((r) => r.valor);
        expect(valores).toEqual([...valores].sort((x, y) => y - x));
      }
    });

    it('las alertas operativas exponen la agencia y el pulidor del incidente, y la agencia de la alerta de stock', async () => {
      const res: any = await service.getDashboardMetrics({ ...ENE_5_11, regionId: r1.id }, act.superadmin);
      const mant = res.alertasOperativas.find((a: any) => a.grupo === 'mantenimiento' && a.detalle === 'Fuga de aceite');
      expect(mant).toMatchObject({ agencia: a1.nombre, pulidor: nombreCompleto(pulidor), severidad: 'critica' });
      const stock = res.alertasOperativas.find((a: any) => a.grupo === 'stock');
      expect(stock).toMatchObject({ agencia: a1.nombre, pulidor: null, nivel: 'CRITICO' });
      expect(res.alertasOperativas.filter((a: any) => a.grupo === 'stock')).toHaveLength(1); // la de A2 queda fuera
      expect(res.kpis).toMatchObject({ alertasStockPendientes: 1, alertasCriticas: 1 });
    });

    it('los pendientes de la bandeja salen del mismo cálculo, acotados a la región del usuario y ordenados por severidad', async () => {
      const res: any = await service.getPendientes(act.supervisor);
      expect(res.total).toBe(res.pendientes.length);
      expect(res.pendientes.every((p: any) => !!p.id)).toBe(true);
      // Solo la alerta de stock de A1 (R1): la de A2 es de otra región.
      expect(res.pendientes.filter((p: any) => p.grupo === 'stock')).toHaveLength(1);
      expect(res.pendientes.find((p: any) => p.detalle === 'Fuga de aceite')).toMatchObject({ agencia: a1.nombre, severidad: 'critica' });
      // Las críticas van antes que las advertencias.
      const orden = res.pendientes.map((p: any) => p.severidad);
      expect(orden).toEqual([...orden].sort((x: string, y: string) => ['critica', 'advertencia', 'info'].indexOf(x) - ['critica', 'advertencia', 'info'].indexOf(y)));
    });

    it('quien no tiene permiso para ver stock ni mantenimiento no recibe pendientes', async () => {
      const res: any = await service.getPendientes(act.aprobador);
      expect(res).toMatchObject({ total: 0, pendientes: [] });
    });
  });

  describe('dashboard aprobador — control', () => {
    it('cuenta anuladas del periodo y descuentos fuera de rango (>15 % del precio enlazado)', async () => {
      const res: any = await service.getDashboardMetrics(ENERO, act.aprobador);
      expect(res.isAprobadorView).toBe(true);
      expect(res.kpis.descuentosFueraDeRango).toBe(1);
      expect(res.kpis.anuladasHoy).toBe(2);
      expect(res.kpis.totalHoy).toBe(3);
    });

    it('la serie de 7 días se ancla al fin del periodo y agrupa por día local', async () => {
      const res: any = await service.getDashboardMetrics(ENERO, act.aprobador);
      // Solicitudes creadas a las 20:00 locales: con claves de día UTC caerían en el 29.
      expect(Object.keys(res.flujoEstadosPorDia).sort()).toEqual([
        '2026-01-25', '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31',
      ]);
      expect(res.flujoEstadosPorDia['2026-01-28']).toEqual({ PENDIENTE: 2, APROBADO: 1, RECHAZADO: 0 });
      expect(res.flujoEstadosPorDia['2026-01-29']).toEqual({ PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 });
    });
  });

  describe('consumo de químicos — alcance', () => {
    it('se limita a las agencias de su alcance', async () => {
      const res: any = await service.getConsumoQuimicos({ agenciaId: a2.id }, act.lider);
      // Quien actúa en una sola agencia no ve el comparativo por agencia (con una sola, no hay con qué comparar).
      expect(res.consumoPorAgencia).toEqual([]);
      expect(res.insumos).toHaveLength(1);
      expect(res.insumos[0]).toMatchObject({ insumoId: x[0].id, cantidadTotal: 3, vecesConsumido: 2, nombre: `${x[0].nombre} (${a1.nombre})` });
    });

    it('respeta el filtro por agencia y por región de un usuario global', async () => {
      const agencia: any = await service.getConsumoQuimicos({ agenciaId: a2.id }, act.coordBodega);
      expect(agencia.insumos.map((i: any) => i.insumoId)).toEqual([y1.id]);
      const region: any = await service.getConsumoQuimicos({ regionId: r2.id }, act.coordBodega);
      expect(region.consumoPorAgencia.map((c: any) => c.nombre)).toEqual([a2.nombre]);
      // Por agencia se compara el costo en USD y el número de consumos, no cantidades de insumos distintos sumadas.
      expect(region.consumoPorAgencia[0]).toEqual({ nombre: a2.nombre, costoInsumos: expect.any(Number), usos: expect.any(Number) });
      expect(region.insumos.map((i: any) => i.cantidadTotal)).toEqual([5]);
    });

    it('también respeta el preset del periodo', async () => {
      const enero: any = await service.getConsumoQuimicos({ ...ENERO, agenciaId: a1.id }, act.coordBodega);
      expect(enero.insumos).toEqual([]); // los consumos se registraron hoy, no en enero
      expect(enero.rango).toEqual({ desde: '2026-01-01', hasta: '2026-01-31' });
    });
  });

  describe('rankings', () => {
    it('lavadores: agrupa por operador y promedia el tiempo solo sobre los que tienen hora de salida', async () => {
      const res = await service.getRankingLavadores({ ...ENE_5_11, regionId: r1.id }, act.admin);
      expect(res.ranking).toHaveLength(2);
      expect(res.ranking[0]).toMatchObject({ operadorId: pulidor.id, nombre: nombreCompleto(pulidor), agencia: a1.nombre, cantidadServicios: 2, tiempoPromedioMin: 45 }); // (30 + 60) / 2
      expect(res.ranking[1]).toMatchObject({ operadorId: lavador.id, cantidadServicios: 1, tiempoPromedioMin: 20 });
    });

    it('lavadores: publica también los de menor actividad, para el orden ascendente del control Top N', async () => {
      const res: any = await service.getRankingLavadores({ ...ENE_5_11, regionId: r1.id }, act.admin);
      // Mismos operadores que el ranking, de menos a más servicios: el lavador (1) antes que el pulidor (2).
      expect(res.rankingBottom.map((r: any) => r.operadorId)).toEqual([lavador.id, pulidor.id]);
    });

    it('lavadores: se limita a las agencias de su alcance', async () => {
      const res = await service.getRankingLavadores({ ...ENE_5_11, agenciaId: a2.id }, act.lider);
      expect(res.ranking.map((r: any) => r.operadorId).sort()).toEqual([pulidor.id, lavador.id].sort());
    });

    it('los rankings respetan el tipo de servicio y el periodo pedido (antes ignoraban los presets)', async () => {
      const base = { ...ENE_5_11, regionId: r1.id };
      const lav = await service.getRankingLavadores({ ...base, categoriaServicio: 'ESPECIAL' }, act.admin);
      expect(lav.ranking.map((r: any) => [r.operadorId, r.cantidadServicios])).toEqual([[pulidor.id, 1]]);

      const pul: any = await service.getRankingPulidores(base, act.admin);
      expect(pul.rankingFijos).toEqual([
        { operadorId: pulidor.id, nombre: nombreCompleto(pulidor), ubicacion: a1.nombre, esFijo: true, cantidadServicios: 2, dineroTotal: 80 },
      ]);
      expect(pul.rankingMoviles).toEqual([]);
      const esp1: any = await service.getRankingPulidores({ ...base, categoriaServicio: 'ESPECIAL' }, act.admin);
      expect(esp1.rankingFijos[0]).toMatchObject({ cantidadServicios: 1, dineroTotal: 50 });

      const febrero: any = await service.getRankingPulidores({ rango: 'RANGO', fechaDesde: '2026-02-10', fechaHasta: '2026-02-11', regionId: r1.id } as any, act.admin);
      expect(febrero.rankingFijos).toEqual([]);
      const fechas = await service.getRankingLavadores({ rango: 'RANGO', fechaDesde: '2026-01-06', fechaHasta: '2026-01-06', regionId: r1.id } as any, act.admin);
      expect(fechas.rango).toEqual({ desde: '2026-01-06', hasta: '2026-01-06' });
      expect(fechas.ranking.map((r: any) => r.cantidadServicios).sort()).toEqual([1, 1]);
    });

    it('sin `rango` se conserva el mes en curso como respaldo', async () => {
      const res = await service.getRankingLavadores({ regionId: r1.id }, act.admin);
      const hoy = new Date();
      expect(res.rango.desde.slice(0, 7)).toBe(`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`);
      expect(res.rango.desde.endsWith('-01')).toBe(true);
    });
  });

  describe('dashboard taller — alcance, MTTR y periodo', () => {
    it('acota la maquinaria al alcance y al filtro pedido', async () => {
      expect(((await service.getDashboardTaller({ ...ENERO, regionId: r1.id }, act.coordBodega)) as any).kpis.totalMaquinaria).toBe(2);
      expect(((await service.getDashboardTaller({ ...ENERO, agenciaId: a1.id }, act.coordBodega)) as any).kpis.totalMaquinaria).toBe(1);
      expect(((await service.getDashboardTaller({ ...ENERO, agenciaId: a2.id }, act.coordBodega)) as any).kpis.totalMaquinaria).toBe(0);
    });

    it('publica los rankings completos de máquinas y de agencias para el control Top N, de mayor a menor', async () => {
      const res: any = await service.getDashboardTaller({ ...ENERO, regionId: r1.id }, act.superadmin);

      // Los rankings del control traen el universo completo (los campos recortados del panel no cambian).
      expect(res.maquinasProblematicasRank.length).toBeGreaterThanOrEqual(res.topMaquinasProblematicas.length);
      const totales = res.maquinasProblematicasRank.map((m: any) => m.total);
      expect(totales).toEqual([...totales].sort((x: number, y: number) => y - x));
      const costos = res.maquinasCostosasRank.map((m: any) => m.costoTotal);
      expect(costos).toEqual([...costos].sort((x: number, y: number) => y - x));
      expect(res.mttrAgenciaRank).toBeDefined();
      expect(res.costoAgenciaRank).toBeDefined();
    });

    it('calcula el MTTR por agencia y por gravedad con su cantidad de incidentes', async () => {
      const res: any = await service.getDashboardTaller({ ...ENERO, regionId: r1.id }, act.superadmin);
      // Ordenado de más lento a más rápido, con el respaldo de cuántos incidentes promedian.
      expect(res.mttrPorAgencia).toEqual([
        { nombre: a3.nombre, horas: 48, incidentes: 1 },
        { nombre: a1.nombre, horas: 15, incidentes: 2 },
      ]);
      expect(res.mttrPorGravedad).toEqual([
        { nombre: 'BAJA', horas: 10, incidentes: 1 },
        { nombre: 'MEDIA', horas: 20, incidentes: 1 },
        { nombre: 'ALTA', horas: 48, incidentes: 1 },
      ]);
      expect(res.kpis).toMatchObject({ incidentesActivos: 2, costoTotalReparaciones: 600 });
    });

    it('la ventana de incidentes sigue exactamente el periodo pedido', async () => {
      const res: any = await service.getDashboardTaller({ rango: 'RANGO', fechaDesde: '2026-01-07', fechaHasta: '2026-01-07', regionId: r1.id } as any, act.superadmin);
      expect(res.gravedadIncidentes).toEqual([{ nombre: 'ALTA', cantidad: 1 }]);
      expect(res.kpis.costoTotalReparaciones).toBe(300);
    });

    it('el taller también acota los incidentes por pulidor', async () => {
      const res: any = await service.getDashboardTaller({ ...ENERO, regionId: r1.id, pulidorId: lavador2.id }, act.superadmin);
      expect(res.gravedadIncidentes).toEqual([{ nombre: 'ALTA', cantidad: 1 }]);
      expect(res.kpis.costoTotalReparaciones).toBe(200);
    });
  });

  describe('dashboard bodega — alcance y salud de inventario', () => {
    it('aplica el alcance a alertas, movimientos y existencias (no ve datos ajenos)', async () => {
      const res: any = await service.getDashboardBodega({}, act.asistenteBodega);
      expect(res.kpis).toMatchObject({ totalAlertasActivas: 1, despachosEnTransito: 1, unidadesEnTransito: 5, unidadesStock: 28 });
      expect(res.kpis.costoReposicionUSD).toBeUndefined();
      expect(res.kpis.valorStockUSD).toBeUndefined();
      // Cobertura: 3 unidades consumidas en 30 días → 0,1 al día; 4 unidades en R1 duran 40 días.
      expect(res.coberturaDias).toEqual([{ nombre: x[0].nombre, stock: 4, consumoDiario: 0.1, dias: 40 }]);
    });

    it('prioriza las ubicaciones con mezcla de severidades y completa con las más agotadas', async () => {
      const res: any = await service.getDashboardBodega({}, act.asistenteBodega);
      // "Solo Agotada" (A4) tiene MÁS problemas (4) pero la mezcla (A3) es la accionable y va primero.
      expect(res.saludPorUbicacion.map((u: any) => u.nombre)).toEqual([a3.nombre, a4.nombre, a1.nombre]);
      expect(res.saludPorUbicacion[0]).toMatchObject({
        nombre: a3.nombre,
        AGOTADO: 0, 'CRÍTICO': 2, 'BAJO MÍNIMO': 0, 'BAJO IDEAL': 1, 'ÓPTIMO': 0,
        criticos: 3, problemas: 3,
      });
      // Lo que falta para llegar al óptimo, valorado en USD, viene por ubicación.
      expect(typeof res.saludPorUbicacion[0].faltanteUSD).toBe('number');
      expect(res.saludPorUbicacion[0].posicionesBajoOptimo).toBeGreaterThan(0);
      expect(res.kpis.posicionesEvaluadas).toBe(8);
    });

    it('la reposición y las existencias se reportan en UNIDADES y el faltante además en USD', async () => {
      const res: any = await service.getDashboardBodega({ regionId: r2.id }, act.coordBodega);
      expect(res.kpis).toMatchObject({ unidadesReponer: 46, insumosConDeficit: 1, ubicacionesConDeficit: 2, unidadesStock: 34, unidadesEnTransito: 7 }); // (40-4) + (40-30)
      expect(res.topDeficit).toMatchObject([{ nombre: y1.nombre, unidades: 46, unidad: 'L', ubicaciones: 2 }]);
      expect(typeof res.topDeficit[0].costoUSD).toBe('number');
    });

    it('un rol de agencia sin agencia no ve movimientos ni existencias', async () => {
      const res: any = await service.getDashboardBodega({}, act.liderSinAgencia);
      expect(res.kpis).toMatchObject({ despachos30d: 0, unidadesStock: 0 });
    });

    it('con un pulidor filtrado se acota a su kit', async () => {
      const res: any = await service.getDashboardBodega({ pulidorId: pulidor.id }, act.coordBodega);
      expect(res.kpis).toMatchObject({ totalAlertasActivas: 0, despachos30d: 0, unidadesStock: 0 });
    });
  });

  describe('dashboard de servicios especiales', () => {
    it('la serie de 7 días se ancla al fin del periodo y agrupa por día local', async () => {
      const res: any = await service.getDashboardEspeciales({ ...ENERO, agenciaId: a1.id }, act.coordEspeciales);
      // OT creadas a las 20:00 y 10:00 locales: con claves de día UTC la de la tarde caería en el 29.
      expect(res.flujoSemanal.map((d: any) => d.hora)).toEqual([
        '2026-01-25', '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31',
      ]);
      expect(res.flujoSemanal[3].cantidad).toBe(2);
      expect(res.flujoSemanal[4].cantidad).toBe(0);
      expect(res.kpis).toMatchObject({ serviciosHoy: 2, completadosHoy: 1, pendientesHoy: 1, ingresoHoy: 70 });
    });

    it('filtro por pulidor: acota las OT al operador elegido', async () => {
      const res: any = await service.getDashboardEspeciales({ ...ENERO, agenciaId: a1.id, pulidorId: pulidor.id }, act.coordEspeciales);
      expect(res.flujoSemanal[3].cantidad).toBe(1);
      expect(res.kpis.serviciosHoy).toBe(1);
      expect(res.pulidores.fijos).toEqual([{ nombre: nombreCompleto(pulidor), servicios: 1, ingresos: 70 }]);
      expect(res.pulidores.moviles).toEqual([]);
    });
  });
});
