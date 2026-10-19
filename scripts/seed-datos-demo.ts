/**
 * Datos ficticios de demostración de los últimos 3 meses: servicios de lavado (con consumos y aprobaciones), servicios
 * especiales, maquinaria (con incidentes, mantenimientos, limpiezas y traslados) y envíos de la Bodega Central.
 *
 * Se genera para TODAS las agencias MENOS "ALVAREZ BARBA LABRADOR" (la que se usa para pruebas reales).
 * Todo lo creado lleva un marcador (clientUuid "demo-…", OT/guía/código "DEMO-…") para poder borrarlo sin tocar datos reales.
 * No modifica stock ni kardex.
 *
 * Uso:
 *   pnpm seed:demo               genera los datos (se niega si ya existen)
 *   pnpm seed:demo --reset       borra los datos demo anteriores y los vuelve a generar
 *   pnpm seed:demo --limpiar     solo borra los datos demo
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const DIAS = 90;
const AGENCIA_EXCLUIDA = 'ALVAREZ BARBA';
const AHORA = new Date();
const HACE_DIAS = (d: number) => new Date(AHORA.getTime() - d * 86_400_000);

// Generador pseudoaleatorio con semilla: mismos datos en cada corrida.
let semilla = 20261008;
function rnd(): number {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
function pesos<T>(opciones: [T, number][]): T {
  const total = opciones.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [v, w] of opciones) if ((r -= w) <= 0) return v;
  return opciones[opciones.length - 1][0];
}
const lote = async <T>(items: T[], tam: number, f: (parte: T[]) => Promise<unknown>) => {
  for (let i = 0; i < items.length; i += tam) await f(items.slice(i, i + tam));
};

/** Fecha laborable (lunes a sábado) entre hace `max` y hace `min` días, en horario de trabajo. */
function fechaLaborable(minDias: number, maxDias: number): Date {
  for (;;) {
    const d = new Date(HACE_DIAS(minDias + rnd() * (maxDias - minDias)));
    if (d.getDay() === 0) continue;
    d.setHours(int(7, 17), int(0, 59), int(0, 59), 0);
    if (d <= AHORA) return d;
  }
}
const sumarMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

const MARCAS: Record<string, string[]> = {
  Chevrolet: ['Sail', 'Onix', 'Tracker', 'D-Max', 'Spark'],
  Kia: ['Rio', 'Sportage', 'Picanto', 'Seltos'],
  Hyundai: ['Tucson', 'Accent', 'Creta', 'Santa Fe'],
  Toyota: ['Hilux', 'Yaris', 'Corolla', 'RAV4'],
  Mazda: ['CX-5', 'Mazda 3', 'BT-50'],
  Nissan: ['Kicks', 'Sentra', 'Frontier'],
  Suzuki: ['Vitara', 'Swift', 'Grand Vitara'],
};
const COLORES = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul'];
const NOMBRES = ['Carlos Mena', 'Lucía Paredes', 'Andrés Salazar', 'María Torres', 'Jorge Vera', 'Paola Cedeño', 'Luis Ortiz', 'Ana Villacís'];
const LETRAS = 'ABCDEFGHIJKLMNOPRSTUVXYZ';
const placa = () => `${pick([...LETRAS])}${pick([...LETRAS])}${pick([...LETRAS])}-${int(1000, 9999)}`;
const vehiculo = () => {
  const marca = pick(Object.keys(MARCAS));
  return { marca, modelo: pick(MARCAS[marca]), color: pick(COLORES) };
};

async function limpiar() {
  const maquinas = await prisma.maquinaria.findMany({ where: { codigo: { startsWith: 'DEMO-' } }, select: { id: true } });
  const ids = maquinas.map((m) => m.id);
  await lote(ids, 500, (p) => prisma.maquinariaEvento.deleteMany({ where: { maquinariaId: { in: p } } }));
  const r = {
    servicios: (await prisma.servicioLavado.deleteMany({ where: { clientUuid: { startsWith: 'demo-' } } })).count,
    especiales: (await prisma.servicioEspecial.deleteMany({ where: { codigoSE: { startsWith: 'DEMO-' } } })).count,
    maquinaria: (await prisma.maquinaria.deleteMany({ where: { codigo: { startsWith: 'DEMO-' } } })).count,
    envios: (await prisma.movimientoInventario.deleteMany({ where: { numeroGuia: { startsWith: 'DEMO-' } } })).count,
  };
  console.log('🧹 Datos demo borrados:', r);
}

async function generar() {
  const [agencias, lavadores, pulidores, catalogos, recetas, precios, insumos] = await Promise.all([
    prisma.agencia.findMany({
      where: { estado: 1, NOT: { nombre: { contains: AGENCIA_EXCLUIDA, mode: 'insensitive' } } },
      include: { bahias: { where: { activa: true } } },
      orderBy: { nombre: 'asc' },
    }),
    prisma.user.findMany({ where: { estado: 1, agenciaId: { not: null }, role: { namerol: 'LAVADOR' } }, select: { id: true, agenciaId: true } }),
    prisma.user.findMany({ where: { estado: 1, agenciaId: { not: null }, role: { namerol: 'PULIDOR' } }, select: { id: true, name: true, agenciaId: true } }),
    prisma.catalogoServicio.findMany({ where: { estado: 'Activo' } }),
    prisma.recetaInsumo.findMany({ include: { insumo: true, unidadConsumo: true } }),
    prisma.precioAgenciaServicio.findMany(),
    prisma.insumo.findMany({ where: { estado: 1 } }),
  ]);
  const aprobador = await prisma.user.findFirst({ where: { estado: 1, role: { namerol: 'APROBADOR' } }, select: { id: true, name: true, lastname: true } });
  const tecnico = await prisma.user.findFirst({ where: { estado: 1, role: { namerol: 'TECNICO' } }, select: { id: true } });
  const coordMant = await prisma.user.findFirst({ where: { estado: 1, role: { namerol: 'COORD_MANTENIMIENTO' } }, select: { id: true } });
  const coordBodega = await prisma.user.findFirst({ where: { estado: 1, role: { namerol: 'COORD_BODEGA' } }, select: { id: true } });
  const central = await prisma.bodega.findFirst({ where: { OR: [{ tipo: 'CENTRAL' }, { esCentral: true }] } });
  if (!tecnico || !coordBodega || !central) throw new Error('Faltan el técnico, el coordinador de bodega o la Bodega Central.');
  const nombreAprobador = aprobador ? `${aprobador.name} ${aprobador.lastname ?? ''}`.trim() : 'Aprobador';

  const generales = catalogos.filter((c) => c.categoria === 'GENERAL');
  const especiales = catalogos.filter((c) => c.categoria === 'ESPECIAL');
  const recetaPor = new Map<number, typeof recetas>();
  for (const r of recetas) recetaPor.set(r.catalogoServicioId, [...(recetaPor.get(r.catalogoServicioId) ?? []), r]);
  const precioOverride = new Map(precios.map((p) => [`${p.agenciaId}_${p.catalogoServicioId}`, Number(p.precio)]));
  const lavadoresDe = (id: string) => lavadores.filter((l) => l.agenciaId === id);
  const regionDe = new Map(agencias.map((a) => [a.id, a.regionId]));

  // ───────────────────────── Servicios de lavado ─────────────────────────
  type Fila = Parameters<typeof prisma.servicioLavado.createMany>[0] extends infer A ? (A extends { data: infer D } ? (D extends any[] ? D[number] : D) : never) : never;
  const servicios: Fila[] = [];
  const consumos: any[] = [];
  const asignados: any[] = [];
  let ot = 0;

  for (const ag of agencias) {
    const ops = lavadoresDe(ag.id);
    if (ops.length === 0 || ag.bahias.length === 0) continue;
    const ids = Array.isArray(ag.servicioIds) ? (ag.servicioIds as any[]).map(Number) : [];
    const ofrecidos = generales.filter((g) => ids.includes(g.id));
    const catalogoAg = ofrecidos.length > 0 ? ofrecidos : generales;
    const n = int(25, 55);

    for (let i = 0; i < n; i++) {
      const cat = pick(catalogoAg);
      const bahia = pick(ag.bahias);
      const op = pick(ops);
      const ingreso = fechaLaborable(0.05, DIAS);
      const edadDias = (AHORA.getTime() - ingreso.getTime()) / 86_400_000;
      const inicio = sumarMin(ingreso, int(3, 15));
      const salida = sumarMin(inicio, Math.round(cat.tiempoEstimadoMin * (0.8 + rnd() * 0.7)));

      let estado: 'EN_ESPERA' | 'EN_PROCESO' | 'FINALIZADO' | 'APROBADO' | 'RECHAZADO' | 'CANCELADO';
      if (edadDias < 0.6) estado = pesos([['EN_ESPERA', 1], ['EN_PROCESO', 2], ['FINALIZADO', 3]] as any);
      else if (edadDias < 4) estado = pesos([['FINALIZADO', 4], ['APROBADO', 5], ['RECHAZADO', 1]] as any);
      else estado = pesos([['APROBADO', 88], ['RECHAZADO', 7], ['CANCELADO', 5]] as any);

      const termino = ['FINALIZADO', 'APROBADO', 'RECHAZADO'].includes(estado);
      const decidido = estado === 'APROBADO' || estado === 'RECHAZADO';
      const v = vehiculo();
      const id = randomUUID();
      const precio = precioOverride.get(`${ag.id}_${cat.id}`) ?? Number(cat.precio);
      const fechaDecision = decidido ? sumarMin(salida, int(60, 480)) : null;
      ot++;

      servicios.push({
        id,
        clientUuid: `demo-${id}`,
        ordenTrabajoOT: `DEMO-OT-${String(ot).padStart(5, '0')}`,
        placa: placa(),
        ...v,
        cliente: pick(NOMBRES),
        estado,
        bahiaId: bahia.id,
        servicioCatalogoId: cat.id,
        operadorId: op.id,
        precio,
        horaIngreso: ingreso,
        horaInicio: estado === 'EN_ESPERA' ? null : inicio,
        horaSalida: termino ? salida : null,
        aprobadoPor: decidido ? nombreAprobador : null,
        fechaAprobacion: fechaDecision,
        decididoPorId: decidido ? aprobador?.id ?? null : null,
        reglaDecision: decidido ? 'RESPALDO' : null,
        motivoRechazo: estado === 'RECHAZADO' ? pick(['Evidencia de salida incompleta', 'Falta foto del vehículo terminado', 'Servicio no coincide con la OT']) : null,
        anuladoEn: estado === 'CANCELADO' ? sumarMin(ingreso, int(10, 60)) : null,
        motivoAnulacion: estado === 'CANCELADO' ? pick(['Cliente desistió', 'Vehículo retirado antes de iniciar', 'OT duplicada']) : null,
        anuladoPorId: estado === 'CANCELADO' ? aprobador?.id ?? null : null,
        createdAt: ingreso,
        updatedAt: fechaDecision ?? (termino ? salida : inicio),
      } as Fila);
      asignados.push({ servicioId: id, operadorId: op.id, createdAt: ingreso });

      if (termino) {
        for (const r of (recetaPor.get(cat.id) ?? []).slice(0, 3)) {
          consumos.push({
            id: randomUUID(),
            servicioId: id,
            insumoId: r.insumoId,
            cantidadUsada: r.cantidadUsada,
            agenciaId: ag.id,
            insumoNombre: r.insumo.nombre,
            insumoSKU: r.insumo.codigoSKU,
            unidadSimbolo: r.unidadConsumo?.simbolo ?? '',
            createdAt: salida,
          });
        }
      }
    }
  }
  await lote(servicios, 500, (p) => prisma.servicioLavado.createMany({ data: p as any }));
  await lote(asignados, 1000, (p) => prisma.servicioLavadoOperador.createMany({ data: p, skipDuplicates: true }));
  await lote(consumos, 1000, (p) => prisma.consumoServicio.createMany({ data: p }));
  console.log(`✅ Servicios de lavado: ${servicios.length} (con ${consumos.length} consumos)`);

  // ───────────────────────── Servicios especiales ─────────────────────────
  const especialesFilas: any[] = [];
  const especialesOps: any[] = [];
  let se = 0;
  for (const pul of pulidores) {
    const ag = agencias.find((a) => a.id === pul.agenciaId);
    if (!ag || especiales.length === 0) continue;
    const n = int(6, 16);
    for (let i = 0; i < n; i++) {
      const cat = pick(especiales);
      const programada = fechaLaborable(0, DIAS);
      const edad = (AHORA.getTime() - programada.getTime()) / 86_400_000;
      const estado = edad < 1 ? pick(['Pendiente', 'En Proceso', 'Completado']) : pesos([['Completado', 90], ['Cancelado', 10]] as any);
      const duracionMin = Math.max(cat.tiempoEstimadoMin, 60) * (0.8 + rnd() * 0.6);
      const pausaSeg = chance(0.3) ? int(300, 1800) : 0;
      const inicio = estado === 'Pendiente' || estado === 'Cancelado' ? null : sumarMin(programada, int(5, 30));
      const fin = estado === 'Completado' && inicio ? sumarMin(inicio, Math.round(duracionMin)) : null;
      const v = vehiculo();
      const id = randomUUID();
      se++;
      especialesFilas.push({
        id,
        clientUuid: `demo-${id}`,
        codigoSE: `DEMO-SE-${String(se).padStart(4, '0')}`,
        ordenTrabajoOT: `DEMO-OT-SE-${String(se).padStart(4, '0')}`,
        tipoServicio: cat.nombre,
        servicioCatalogoId: cat.id,
        precio: cat.precio,
        clienteNombre: pick(NOMBRES),
        cliente: pick(NOMBRES),
        placa: placa(),
        ...v,
        prioridad: pick(['Baja', 'Media', 'Media', 'Alta', 'Urgente']),
        estado,
        agenciaId: ag.id,
        operadorId: pul.id,
        creadoPorNombre: 'Coordinación Servicios Especiales',
        regionId: regionDe.get(ag.id) ?? null,
        fechaProgramada: programada,
        fechaInicio: inicio,
        fechaFin: fin,
        tiempoPausaTotalSeg: pausaSeg,
        tiempoEfectivoSeg: fin && inicio ? Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / 1000) - pausaSeg) : null,
        calificacionCalidad: estado === 'Completado' ? int(3, 5) : null,
        createdAt: programada,
        updatedAt: fin ?? inicio ?? programada,
      });
      especialesOps.push({ servicioId: id, operadorId: pul.id, orden: 0, createdAt: programada });
    }
  }
  await lote(especialesFilas, 500, (p) => prisma.servicioEspecial.createMany({ data: p }));
  await lote(especialesOps, 1000, (p) => prisma.servicioEspecialOperador.createMany({ data: p, skipDuplicates: true }));
  console.log(`✅ Servicios especiales: ${especialesFilas.length}`);

  // ───────────────────────── Maquinaria, incidentes, mantenimientos, limpiezas ─────────────────────────
  const TIPOS: [string, string, string, string[]][] = [
    ['HIDRO', 'HIDROLAVADORA', 'Hidrolavadora Industrial', ['Karcher', 'Lavor', 'Bosch']],
    ['ASPIR', 'ASPIRADORA', 'Aspiradora Seco Húmedo', ['Karcher', 'Stanley', 'Wap']],
    ['COMP', 'COMPRESOR', 'Compresor de Aire', ['Schulz', 'Pretul', 'Evans']],
    ['ESPUM', 'ESPUMADORA', 'Espumadora', ['Lavor', 'Mosmatic']],
  ];
  const maquinas: any[] = [];
  const eventos: any[] = [];
  const incidentes: any[] = [];
  const mantenimientos: any[] = [];
  const limpiezas: any[] = [];
  const traslados: any[] = [];
  let mq = 0;

  for (const ag of agencias) {
    const ops = lavadoresDe(ag.id);
    if (ag.bahias.length === 0 || ops.length === 0) continue;
    const cantidad = int(2, 3);
    for (let k = 0; k < cantidad; k++) {
      const [pref, tipo, nombre, marcas] = TIPOS[(mq + k) % TIPOS.length];
      mq++;
      const id = randomUUID();
      const creada = HACE_DIAS(DIAS + int(5, 60));
      maquinas.push({
        id,
        codigo: `DEMO-${pref}-${String(mq).padStart(3, '0')}`,
        nombre: `${nombre} ${k + 1}`,
        tipo,
        marca: pick(marcas),
        modelo: `M-${int(100, 999)}`,
        serie: `SN${int(100000, 999999)}`,
        estadoOperativo: 'OPERATIVA',
        horasUso: int(80, 1800),
        agenciaId: ag.id,
        bahiaId: pick(ag.bahias).id,
        creadoPorId: coordMant?.id ?? null,
        ventanaAdelantoDias: 3,
        createdAt: creada,
        updatedAt: creada,
      });
      eventos.push({ id: randomUUID(), maquinariaId: id, tipo: 'MAQUINA_CREADA', actorId: coordMant?.id ?? null, agenciaId: ag.id, regionId: ag.regionId, entidadId: id, ocurridoEn: creada });

      // Incidentes
      const nInc = pesos<number>([[0, 55], [1, 30], [2, 15]]);
      let enReparacion = false;
      for (let i = 0; i < nInc; i++) {
        const reporte = fechaLaborable(0, DIAS);
        const edad = (AHORA.getTime() - reporte.getTime()) / 86_400_000;
        const estado = edad < 6 ? pick(['ABIERTO', 'EN_PROCESO', 'RESUELTO']) : pesos([['RESUELTO', 85], ['CANCELADO', 15]] as any);
        const gravedad = pesos([['BAJA', 25], ['MEDIA', 45], ['ALTA', 22], ['CRITICA', 8]] as any);
        const resuelto = estado === 'RESUELTO';
        const solucion = resuelto ? sumarMin(reporte, int(120, 60 * 24 * 4)) : null;
        const incId = randomUUID();
        const titulo = pick(['No enciende', 'Pierde presión', 'Fuga de agua', 'Ruido anormal', 'Manguera dañada', 'Sobrecalentamiento']);
        incidentes.push({
          id: incId,
          clientUuid: `demo-${incId}`,
          maquinariaId: id,
          reportadoPorId: pick(ops).id,
          titulo,
          descripcion: `${titulo}. Reportado durante la operación de la agencia ${ag.nombre}.`,
          gravedad,
          estado,
          solucion: resuelto ? pick(['Se reemplazó la pieza dañada', 'Limpieza y ajuste de componentes', 'Cambio de manguera y sellos']) : null,
          costoTotal: resuelto ? int(15, 320) : null,
          resueltoPorId: resuelto ? tecnico.id : null,
          tecnicoAsignadoId: estado === 'ABIERTO' || estado === 'CANCELADO' ? null : tecnico.id,
          fechaAsignacion: estado === 'ABIERTO' || estado === 'CANCELADO' ? null : sumarMin(reporte, int(30, 600)),
          fechaReporte: reporte,
          fechaSolucion: solucion,
          createdAt: reporte,
          updatedAt: solucion ?? reporte,
        });
        eventos.push({ id: randomUUID(), maquinariaId: id, tipo: 'INCIDENTE_REPORTADO', agenciaId: ag.id, regionId: ag.regionId, entidadId: incId, ocurridoEn: reporte });
        if (resuelto && solucion) eventos.push({ id: randomUUID(), maquinariaId: id, tipo: 'INCIDENTE_REPARADO', actorId: tecnico.id, agenciaId: ag.id, regionId: ag.regionId, entidadId: incId, ocurridoEn: solucion });
        if ((estado === 'ABIERTO' || estado === 'EN_PROCESO') && (gravedad === 'ALTA' || gravedad === 'CRITICA')) enReparacion = true;
      }
      if (enReparacion) maquinas[maquinas.length - 1].estadoOperativo = 'EN_MANTENIMIENTO';

      // Mantenimientos preventivos cada 30 días: los pasados finalizados, el siguiente pendiente (a veces vencido)
      for (let d = DIAS - int(0, 25); d > -30; d -= 30) {
        const programada = new Date(HACE_DIAS(d));
        programada.setHours(9, 0, 0, 0);
        const futuro = programada > AHORA;
        const vencido = !futuro && d < 20 && chance(0.2);
        const mId = randomUUID();
        const ejecucion = futuro || vencido ? null : sumarMin(programada, int(30, 60 * 6));
        mantenimientos.push({
          id: mId,
          maquinariaId: id,
          tecnicoId: tecnico.id,
          estado: futuro || vencido ? 'PENDIENTE' : 'FINALIZADO',
          observaciones: ejecucion ? 'Mantenimiento preventivo realizado según checklist.' : null,
          repuestosUsados: ejecucion ? [{ nombre: 'Filtro', cantidad: 1 }, { nombre: 'Aceite', cantidad: 1 }] : undefined,
          costoTotal: ejecucion ? int(10, 90) : null,
          fechaMantenimiento: ejecucion ?? programada,
          fechaProgramada: programada,
          fechaEjecucion: ejecucion,
          proximoMantenimiento: new Date(programada.getTime() + 30 * 86_400_000),
          frecuenciaDias: 30,
          creadoPorId: coordMant?.id ?? null,
          ejecutadoPorId: ejecucion ? tecnico.id : null,
          createdAt: HACE_DIAS(Math.min(DIAS + 30, d + 30)),
          updatedAt: ejecucion ?? programada,
        });
        eventos.push({ id: randomUUID(), maquinariaId: id, tipo: 'MANTENIMIENTO_PROGRAMADO', actorId: coordMant?.id ?? null, agenciaId: ag.id, regionId: ag.regionId, entidadId: mId, ocurridoEn: HACE_DIAS(Math.min(DIAS + 30, d + 30)) });
        if (ejecucion) eventos.push({ id: randomUUID(), maquinariaId: id, tipo: 'MANTENIMIENTO_EJECUTADO', actorId: tecnico.id, agenciaId: ag.id, regionId: ag.regionId, entidadId: mId, ocurridoEn: ejecucion });
      }

      // Limpiezas: miércoles y sábado, con ~88 % de cumplimiento
      for (let d = DIAS; d >= 0; d--) {
        const fecha = new Date(HACE_DIAS(d));
        if (fecha.getDay() !== 3 && fecha.getDay() !== 6) continue;
        if (!chance(0.88)) continue;
        fecha.setHours(0, 0, 0, 0);
        limpiezas.push({
          id: randomUUID(),
          maquinariaId: id,
          fecha,
          tipo: 'AGENCIA',
          fotos: [],
          observaciones: chance(0.2) ? 'Limpieza completa de la máquina y accesorios.' : null,
          registradoPorId: pick(ops).id,
          createdAt: sumarMin(fecha, 60 * int(8, 17)),
          updatedAt: sumarMin(fecha, 60 * int(8, 17)),
        });
      }
    }
  }

  // Traslados entre agencias de la misma región (algunas máquinas cambian de sede)
  for (let i = 0; i < 12 && maquinas.length > 1; i++) {
    const m = pick(maquinas);
    const destino = pick(agencias.filter((a) => a.id !== m.agenciaId && a.regionId === regionDe.get(m.agenciaId) && a.bahias.length > 0));
    if (!destino) continue;
    const fecha = fechaLaborable(0, DIAS - 5);
    traslados.push({ id: randomUUID(), maquinariaId: m.id, origenAgenciaId: m.agenciaId, destinoAgenciaId: destino.id, origenBahiaId: m.bahiaId, destinoBahiaId: destino.bahias[0].id, motivo: pick(['Reasignación por demanda', 'Reemplazo de equipo dañado', 'Balanceo de equipos entre sedes']), usuarioId: coordMant?.id ?? null, fecha });
    eventos.push({ id: randomUUID(), maquinariaId: m.id, tipo: 'MOVIMIENTO', actorId: coordMant?.id ?? null, agenciaId: destino.id, regionId: destino.regionId, ocurridoEn: fecha });
    m.agenciaId = destino.id;
    m.bahiaId = destino.bahias[0].id;
  }

  await lote(maquinas, 300, (p) => prisma.maquinaria.createMany({ data: p }));
  await lote(incidentes, 500, (p) => prisma.incidenteTecnico.createMany({ data: p }));
  await lote(mantenimientos, 500, (p) => prisma.mantenimientoMaquinaria.createMany({ data: p }));
  await lote(limpiezas, 1000, (p) => prisma.limpiezaMaquinaria.createMany({ data: p, skipDuplicates: true }));
  await lote(traslados, 500, (p) => prisma.movimientoMaquinaria.createMany({ data: p }));
  await lote(eventos, 1000, (p) => prisma.maquinariaEvento.createMany({ data: p }));
  console.log(`✅ Maquinaria: ${maquinas.length} (incidentes ${incidentes.length}, mantenimientos ${mantenimientos.length}, limpiezas ${limpiezas.length}, traslados ${traslados.length})`);

  // ───────────────────────── Envíos desde la Bodega Central ─────────────────────────
  const envios: any[] = [];
  const detalles: any[] = [];
  let guia = 0;
  for (const ag of agencias) {
    const ops = lavadoresDe(ag.id);
    const n = int(3, 6);
    for (let i = 0; i < n; i++) {
      const despacho = fechaLaborable(0.05, DIAS);
      const edad = (AHORA.getTime() - despacho.getTime()) / 86_400_000;
      const estado = edad <= 3 ? pesos([['EN_TRANSITO', 70], ['RECIBIDO', 30]] as any) : pesos([['RECIBIDO', 85], ['RECHAZADO', 8], ['CANCELADO', 7]] as any);
      const id = randomUUID();
      guia++;
      const recibido = estado === 'RECIBIDO' || estado === 'RECHAZADO';
      envios.push({
        id,
        numeroGuia: `DEMO-DESP-${String(guia).padStart(4, '0')}`,
        tipo: 'DESPACHO_AGENCIA',
        estadoDespacho: estado,
        origenUbicacion: central.nombre,
        destinoUbicacion: ag.nombre,
        origenBodegaId: central.id,
        destinoAgenciaId: ag.id,
        usuarioDespachaId: coordBodega.id,
        usuarioRecibeId: recibido && ops.length > 0 ? pick(ops).id : null,
        fechaDespacho: despacho,
        fechaRecepcion: recibido ? sumarMin(despacho, int(60 * 20, 60 * 72)) : null,
        observaciones: estado === 'RECHAZADO' ? 'Recepción rechazada por disconformidad en las cantidades.' : null,
        createdAt: despacho,
        updatedAt: despacho,
      });
      const lineas = [...insumos].sort(() => rnd() - 0.5).slice(0, int(2, 5));
      for (const ins of lineas) {
        const cant = int(2, 10);
        detalles.push({ id: randomUUID(), movimientoId: id, insumoId: ins.id, cantidadEnviada: cant, cantidadRecibida: estado === 'RECIBIDO' ? cant : estado === 'RECHAZADO' ? 0 : null });
      }
    }
  }
  await lote(envios, 500, (p) => prisma.movimientoInventario.createMany({ data: p }));
  await lote(detalles, 1000, (p) => prisma.movimientoDetalle.createMany({ data: p }));
  console.log(`✅ Envíos: ${envios.length} (${detalles.length} líneas)`);
  console.log(`\nListo. Agencias con datos: ${agencias.length} (excluida: ${AGENCIA_EXCLUIDA}). Para borrarlos: pnpm seed:demo --limpiar`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--limpiar')) return limpiar();
  const yaHay = await prisma.maquinaria.count({ where: { codigo: { startsWith: 'DEMO-' } } });
  if (yaHay > 0) {
    if (!args.includes('--reset')) throw new Error('Ya hay datos demo. Usa --reset para regenerarlos o --limpiar para borrarlos.');
    await limpiar();
  }
  await generar();
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
