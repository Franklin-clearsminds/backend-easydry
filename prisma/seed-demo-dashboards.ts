/**
 * Datos de DEMOSTRACIÓN para probar los dashboards en la base LOCAL. No es para producción.
 *
 * Crea, con fechas de los últimos ~60 días:
 *  - Maquinaria (todas las clases, algunas en mantenimiento o dadas de baja), con su trazabilidad.
 *  - Incidencias en todos los estados y gravedades (abiertas, en proceso, resueltas, canceladas).
 *  - Mantenimientos finalizados, en proceso, pendientes y vencidos.
 *  - Registros de limpieza (miércoles y sábado en agencias, diaria en máquinas de pulidor), con huecos.
 *  - Traslados de máquinas entre agencias.
 *  - Envíos desde la Bodega Central a agencias y pulidores: recibidos completos, parciales (con faltantes
 *    pendientes y resueltos), rechazados, en tránsito (algunos atrasados), pendientes y cancelados. Mueven stock y kardex.
 *
 * Todo lo que crea se puede identificar: máquinas con serie «DEMO-…» y guías «DESP-DEMO-…».
 * Es determinista (misma semilla = mismos datos) y no se repite: si ya existe, avisa y no hace nada.
 *
 * Uso: npm run prisma:seed-demo [-- --reset]
 *   --reset  borra lo creado por este script (y devuelve el stock de los envíos) y vuelve a crearlo.
 *   --solo-borrar  solo borra.
 * Requisitos: seed + agencias + bodega central con stock (los insumos deben existir).
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const RESET = process.argv.includes('--reset');
const SOLO_BORRAR = process.argv.includes('--solo-borrar');
const DIA = 86400000;
const AHORA = Date.now();

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost).');
}

// ---------------------------------------------------------------- utilidades
let semilla = 20261022;
const rnd = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entero = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const prob = (p: number) => rnd() < p;
function pesos<T>(xs: readonly (readonly [T, number])[]): T {
  const total = xs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [x, w] of xs) if ((r -= w) < 0) return x;
  return xs[xs.length - 1][0];
}
const hace = (dias: number, hora = 9) => {
  const d = new Date(AHORA - dias * DIA);
  d.setUTCHours(hora + 5, entero(0, 59), 0, 0); // hora de Ecuador (UTC-5)
  return d;
};
const mezclar = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const D = (n: number) => new Prisma.Decimal(n);

// ---------------------------------------------------------------- borrado
async function borrarDemo() {
  const movs = await prisma.movimientoInventario.findMany({ where: { numeroGuia: { startsWith: 'DESP-DEMO-' } }, select: { id: true } });
  const ids = movs.map((m) => m.id);
  if (ids.length) {
    // Devuelve el stock: suma del kardex por (insumo, ubicación) con signo contrario.
    const kardex = await prisma.kardexMovimiento.findMany({ where: { referenciaId: { in: ids } } });
    const neto = new Map<string, { insumoId: string; ubicacionId: string; cantidad: number }>();
    for (const k of kardex) {
      const clave = `${k.insumoId}|${k.ubicacionId}`;
      const e = neto.get(clave) ?? { insumoId: k.insumoId, ubicacionId: k.ubicacionId, cantidad: 0 };
      e.cantidad += Number(k.cantidad);
      neto.set(clave, e);
    }
    const bodegas = new Set((await prisma.bodega.findMany({ select: { id: true } })).map((b) => b.id));
    const agencias = new Set((await prisma.agencia.findMany({ select: { id: true } })).map((a) => a.id));
    for (const e of neto.values()) {
      if (!e.cantidad) continue;
      // Las filas de un pulidor fijo también llevan agenciaId: hay que filtrar por tipo para no tocarlas al revertir una agencia.
      const donde: Prisma.StockUbicacionWhereInput = bodegas.has(e.ubicacionId)
        ? { tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: e.ubicacionId }
        : agencias.has(e.ubicacionId)
          ? { tipoUbicacion: 'AGENCIA', agenciaId: e.ubicacionId }
          : { pulidorId: e.ubicacionId };
      await prisma.stockUbicacion.updateMany({ where: { insumoId: e.insumoId, ...donde }, data: { cantidadActual: { decrement: e.cantidad } } });
      if (bodegas.has(e.ubicacionId)) await prisma.insumo.update({ where: { id: e.insumoId }, data: { stockActual: { decrement: e.cantidad } } });
    }
    await prisma.kardexMovimiento.deleteMany({ where: { referenciaId: { in: ids } } });
    await prisma.movimientoInventario.deleteMany({ where: { id: { in: ids } } });
  }
  const maqs = await prisma.maquinaria.findMany({ where: { serie: { startsWith: 'DEMO-' } }, select: { id: true } });
  const mids = maqs.map((m) => m.id);
  if (mids.length) {
    // MaquinariaEvento es de solo anexar (trigger que bloquea el DELETE): solo para esta limpieza de datos de demo se
    // desactiva el trigger dentro de una transacción, que lo deja activo otra vez pase lo que pase.
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "MaquinariaEvento" DISABLE TRIGGER maquinaria_evento_inmutable_trg'),
      prisma.maquinariaEvento.deleteMany({ where: { maquinariaId: { in: mids } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "MaquinariaEvento" ENABLE TRIGGER maquinaria_evento_inmutable_trg'),
      prisma.maquinaria.deleteMany({ where: { id: { in: mids } } }),
    ]);
  }
  console.log(`🧹 Borrado: ${maqs.length} máquinas (con sus incidencias, mantenimientos y limpiezas) y ${ids.length} envíos.`);
}

// ---------------------------------------------------------------- maquinaria
const TIPOS_MAQ = [
  { tipo: 'HIDROLAVADORA', pref: 'HIDRO', nombre: 'Hidrolavadora', marcas: ['Karcher', 'Lavor', 'Bosch'], mod: ['HD 6/15', 'Pro 150', 'GHP 5-65'] },
  { tipo: 'ASPIRADORA', pref: 'ASPIR', nombre: 'Aspiradora industrial', marcas: ['Karcher', 'Nilfisk', 'Wap'], mod: ['NT 70/2', 'Attix 30', 'Ultra 50'] },
  { tipo: 'COMPRESOR', pref: 'COMP', nombre: 'Compresor de aire', marcas: ['Schulz', 'Ingersoll Rand', 'Pretul'], mod: ['MSV 20', 'SS3', 'COMP-50L'] },
  { tipo: 'ESPUMADORA', pref: 'ESPUM', nombre: 'Espumadora', marcas: ['Matador', 'Lavor', 'MTM'], mod: ['Foam 2.0', 'Snow 5', 'Cannon X'] },
  { tipo: 'PULIDORA', pref: 'PULID', nombre: 'Pulidora orbital', marcas: ['Rupes', 'Makita', 'Flex'], mod: ['LHR 15', 'PV7000', 'XFE 7-15'] },
] as const;
const FALLAS: Record<string, string[]> = {
  HIDROLAVADORA: ['No genera presión', 'Fuga de agua en la manguera', 'Bomba con ruido anormal', 'No enciende'],
  ASPIRADORA: ['Pérdida de succión', 'Motor se sobrecalienta', 'Filtro HEPA roto', 'Cable pelado'],
  COMPRESOR: ['No alcanza la presión de trabajo', 'Fuga en el tanque', 'Vibración excesiva', 'Se apaga solo'],
  ESPUMADORA: ['No genera espuma', 'Boquilla obstruida', 'Fuga en el depósito', 'Válvula atascada'],
  PULIDORA: ['Plato desbalanceado', 'Carbones gastados', 'Velocidad irregular', 'Sobrecalentamiento'],
};
const SOLUCIONES = ['Cambio de repuesto y prueba de funcionamiento', 'Limpieza interna y ajuste', 'Reemplazo de sello y mangueras', 'Reparación del motor', 'Calibración y lubricación'];
const REPUESTOS = [
  { nombre: 'Kit de sellos', costo: 18 },
  { nombre: 'Manguera de alta presión', costo: 35 },
  { nombre: 'Filtro', costo: 12 },
  { nombre: 'Carbones de motor', costo: 9 },
  { nombre: 'Boquilla', costo: 7 },
  { nombre: 'Aceite y lubricante', costo: 14 },
];

async function crearMaquinaria(admin: { id: string }, tecnicos: { id: string }[]) {
  const agencias = await prisma.agencia.findMany({ include: { bahias: { take: 1, orderBy: { codigo: 'asc' } }, cliente: { select: { nombre: true } } } });
  const conBahia = agencias.filter((a) => a.bahias.length);
  const teojama = conBahia.filter((a) => a.cliente?.nombre === 'TEOJAMA');
  const resto = mezclar(conBahia.filter((a) => a.cliente?.nombre !== 'TEOJAMA')).slice(0, 18);
  const destinos = [...teojama, ...resto];
  const operadores = await prisma.user.findMany({ where: { estado: 1, role: { namerol: { in: ['LAVADOR', 'PULIDOR', 'LIDER'] } } }, select: { id: true, agenciaId: true, role: { select: { namerol: true } } } });
  const operadoresDe = (agId: string) => operadores.filter((o) => o.agenciaId === agId);
  const pulidores = operadores.filter((o) => o.role.namerol === 'PULIDOR');

  const secuencia = new Map<string, number>();
  const codigo = (pref: string) => {
    const n = (secuencia.get(pref) ?? 0) + 1;
    secuencia.set(pref, n);
    return `${pref}-${String(n).padStart(3, '0')}`;
  };

  type Plan = { agenciaId: string | null; bahiaId: string | null; operadorId: string | null; tipo: (typeof TIPOS_MAQ)[number] };
  const plan: Plan[] = [];
  for (const a of destinos) {
    const n = entero(1, 3);
    const tipos = mezclar([...TIPOS_MAQ]).slice(0, n);
    for (const t of tipos) plan.push({ agenciaId: a.id, bahiaId: a.bahias[0].id, operadorId: null, tipo: t });
  }
  for (const p of mezclar(pulidores).slice(0, 10)) {
    plan.push({ agenciaId: p.agenciaId, bahiaId: null, operadorId: p.id, tipo: TIPOS_MAQ[4] });
    if (prob(0.5)) plan.push({ agenciaId: p.agenciaId, bahiaId: null, operadorId: p.id, tipo: TIPOS_MAQ[1] });
  }

  const maquinas: { id: string; tipo: string; agenciaId: string | null; operadorId: string | null; bahiaId: string | null; creada: Date; activa: boolean; estado: string }[] = [];
  let seq = 0;
  for (const p of plan) {
    const creada = hace(entero(70, 200));
    const estado = pesos([['OPERATIVA', 80], ['EN_MANTENIMIENTO', 12], ['DE_BAJA', 8]] as const);
    const baja = estado === 'DE_BAJA';
    const t = p.tipo;
    const m = await prisma.maquinaria.create({
      data: {
        codigo: codigo(t.pref),
        nombre: t.nombre,
        tipo: t.tipo,
        marca: elige(t.marcas),
        modelo: elige(t.mod),
        serie: `DEMO-${String(++seq).padStart(5, '0')}`,
        estadoOperativo: estado,
        horasUso: entero(40, 2600),
        agenciaId: p.agenciaId,
        bahiaId: p.bahiaId,
        operadorAsignadoId: p.operadorId,
        creadoPorId: admin.id,
        activa: !baja,
        ...(baja ? { desactivadoPorId: admin.id, fechaDesactivacion: hace(entero(5, 40)), motivoDesactivacion: elige(['Daño irreparable', 'Obsoleta, reemplazada por equipo nuevo', 'Costo de reparación mayor al valor']) } : {}),
        createdAt: creada,
      },
    });
    await prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo: 'MAQUINA_CREADA', actorId: admin.id, agenciaId: p.agenciaId, entidadId: m.id, ocurridoEn: creada, datos: { codigo: m.codigo } } });
    if (baja) await prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo: 'MAQUINA_DESACTIVADA', actorId: admin.id, agenciaId: p.agenciaId, entidadId: m.id, ocurridoEn: m.fechaDesactivacion!, datos: { motivo: m.motivoDesactivacion } } });
    maquinas.push({ id: m.id, tipo: t.tipo, agenciaId: p.agenciaId, operadorId: p.operadorId, bahiaId: p.bahiaId, creada, activa: !baja, estado });
  }

  const quien = (m: (typeof maquinas)[number]) => {
    const ops = m.agenciaId ? operadoresDe(m.agenciaId) : [];
    return m.operadorId ?? (ops.length ? elige(ops).id : admin.id);
  };
  const tecnico = () => (tecnicos.length ? elige(tecnicos).id : admin.id);

  // ---- incidencias
  let nInc = 0;
  for (const m of maquinas) {
    const n = m.estado === 'EN_MANTENIMIENTO' ? entero(1, 2) : pesos([[0, 45], [1, 35], [2, 20]] as const);
    for (let i = 0; i < n; i++) {
      const reporte = hace(entero(1, 55), entero(7, 17));
      let estado = pesos([['RESUELTO', 55], ['EN_PROCESO', 15], ['ABIERTO', 20], ['CANCELADO', 10]] as const);
      let gravedad = pesos([['BAJA', 30], ['MEDIA', 40], ['ALTA', 22], ['CRITICA', 8]] as const);
      if (m.estado === 'EN_MANTENIMIENTO' && i === 0) {
        estado = elige(['ABIERTO', 'EN_PROCESO'] as const);
        gravedad = elige(['ALTA', 'CRITICA'] as const);
      }
      const asignada = estado !== 'ABIERTO' && estado !== 'CANCELADO' || (estado === 'CANCELADO' && prob(0.4));
      const tec = asignada ? tecnico() : null;
      const fAsig = tec ? new Date(reporte.getTime() + entero(1, 20) * 3600000) : null;
      const fSol = estado === 'RESUELTO' ? new Date(reporte.getTime() + entero(1, 6) * DIA + entero(0, 8) * 3600000) : null;
      const titulo = elige(FALLAS[m.tipo]);
      const inc = await prisma.incidenteTecnico.create({
        data: {
          clientUuid: `demo-inc-${++nInc}`,
          maquinariaId: m.id,
          reportadoPorId: quien(m),
          titulo,
          descripcion: `${titulo}. Reportado durante la operación diaria; requiere revisión del técnico.`,
          gravedad,
          estado,
          tecnicoAsignadoId: tec,
          fechaAsignacion: fAsig,
          fechaReporte: reporte,
          ...(estado === 'RESUELTO'
            ? { solucion: elige(SOLUCIONES), costoTotal: D(entero(8, 220)), resueltoPorId: tec ?? admin.id, fechaSolucion: fSol }
            : {}),
          ...(estado === 'CANCELADO'
            ? { canceladoPorId: admin.id, fechaCancelacion: new Date(reporte.getTime() + DIA), motivoCancelacion: elige(['Reporte duplicado', 'Falsa alarma, la máquina funciona bien']) }
            : {}),
          createdAt: reporte,
        },
      });
      const ev = (tipo: string, fecha: Date, actor: string, datos?: Prisma.InputJsonValue) =>
        prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo, actorId: actor, agenciaId: m.agenciaId, entidadId: inc.id, ocurridoEn: fecha, datos } });
      await ev('INCIDENTE_REPORTADO', reporte, inc.reportadoPorId, { gravedad, titulo });
      if (fAsig && tec) await ev('INCIDENTE_ASIGNADO', fAsig, admin.id, { tecnicoId: tec });
      if (fSol) await ev('INCIDENTE_REPARADO', fSol, tec ?? admin.id, { costoTotal: Number(inc.costoTotal) });
      if (estado === 'CANCELADO') await ev('INCIDENTE_CANCELADO', inc.fechaCancelacion!, admin.id, { motivo: inc.motivoCancelacion });
    }
  }

  // ---- mantenimientos
  let nMan = 0;
  for (const m of maquinas) {
    const frecuencia = elige([30, 45, 60, 90]);
    const pasados = entero(1, 3);
    let ultimo: Date | null = null;
    for (let i = 0; i < pasados; i++) {
      const ejec = hace(entero(8, 150) , entero(8, 16));
      const rep = mezclar(REPUESTOS).slice(0, entero(0, 3));
      const costo = rep.reduce((s, r) => s + r.costo, 0) + entero(10, 60);
      const programada = new Date(ejec.getTime() - entero(0, 3) * DIA);
      const tec = tecnico();
      const mant = await prisma.mantenimientoMaquinaria.create({
        data: {
          maquinariaId: m.id,
          tecnicoId: tec,
          estado: 'FINALIZADO',
          observaciones: elige(['Mantenimiento preventivo completo', 'Se revisaron sellos, filtros y conexiones', 'Sin novedades; se lubricó y calibró']),
          repuestosUsados: rep.map((r) => ({ nombre: r.nombre, cantidad: 1, costo: r.costo })),
          costoTotal: D(costo),
          fechaMantenimiento: ejec,
          fechaProgramada: programada,
          fechaEjecucion: ejec,
          frecuenciaDias: frecuencia,
          proximoMantenimiento: new Date(ejec.getTime() + frecuencia * DIA),
          creadoPorId: admin.id,
          ejecutadoPorId: tec,
          createdAt: programada,
        },
      });
      if (!ultimo || ejec > ultimo) ultimo = ejec;
      await prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo: 'MANTENIMIENTO_EJECUTADO', actorId: tec, agenciaId: m.agenciaId, entidadId: mant.id, ocurridoEn: ejec, datos: { costoTotal: costo } } });
      nMan++;
    }
    if (m.activa) {
      // El siguiente: a veces vencido, a veces próximo, a veces ya en proceso (si la máquina está en mantenimiento).
      const estado = m.estado === 'EN_MANTENIMIENTO' ? 'EN_PROCESO' : 'PENDIENTE';
      const base = ultimo ? ultimo.getTime() : AHORA - 20 * DIA;
      let programada = new Date(base + frecuencia * DIA);
      if (estado === 'PENDIENTE' && prob(0.3)) programada = new Date(AHORA - entero(2, 20) * DIA); // vencido
      const tec = estado === 'EN_PROCESO' ? tecnico() : prob(0.5) ? tecnico() : null;
      const mant = await prisma.mantenimientoMaquinaria.create({
        data: {
          maquinariaId: m.id,
          tecnicoId: tec,
          estado,
          observaciones: estado === 'EN_PROCESO' ? 'En el taller, esperando repuestos' : 'Mantenimiento preventivo programado',
          fechaMantenimiento: programada,
          fechaProgramada: programada,
          frecuenciaDias: frecuencia,
          creadoPorId: admin.id,
        },
      });
      await prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo: tec ? 'MANTENIMIENTO_ASIGNADO' : 'MANTENIMIENTO_PROGRAMADO', actorId: admin.id, agenciaId: m.agenciaId, entidadId: mant.id, ocurridoEn: hace(entero(1, 10)), datos: { fechaProgramada: programada.toISOString() } } });
      nMan++;
    }
  }

  // ---- limpiezas: últimos 30 días
  let nLimp = 0;
  for (const m of maquinas) {
    if (!m.activa) continue;
    const regla = m.operadorId ? 'PULIDOR' : m.agenciaId ? 'AGENCIA' : null;
    if (!regla) continue;
    const cumplimiento = prob(0.25) ? 0.45 : 0.9; // algunas máquinas quedan atrasadas
    for (let d = 30; d >= 0; d--) {
      const fecha = new Date(AHORA - d * DIA);
      const dia = new Date(fecha.getTime() - 5 * 3600000).getUTCDay(); // día en Ecuador
      const toca = regla === 'PULIDOR' ? true : dia === 3 || dia === 6;
      if (!toca || fecha.getTime() < m.creada.getTime() || !prob(cumplimiento)) continue;
      const fechaDia = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
      const por = quien(m);
      await prisma.limpiezaMaquinaria.create({
        data: {
          maquinariaId: m.id,
          fecha: fechaDia,
          tipo: regla,
          fotos: [`https://demo.easydry.local/limpieza/${m.id}/${fechaDia.toISOString().slice(0, 10)}.jpg`],
          observaciones: prob(0.2) ? 'Limpieza completa de filtros y mangueras' : null,
          registradoPorId: por,
          createdAt: new Date(fechaDia.getTime() + 15 * 3600000),
        },
      });
      await prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo: 'LIMPIEZA_REGISTRADA', actorId: por, agenciaId: m.agenciaId, entidadId: m.id, ocurridoEn: new Date(fechaDia.getTime() + 15 * 3600000), datos: { tipo: regla } } });
      nLimp++;
    }
  }

  // ---- traslados entre agencias
  let nMov = 0;
  const trasladables = mezclar(maquinas.filter((m) => m.activa && m.agenciaId && !m.operadorId && m.bahiaId)).slice(0, 8);
  for (const m of trasladables) {
    const dest = elige(destinos.filter((a) => a.id !== m.agenciaId));
    const fecha = hace(entero(3, 45));
    await prisma.movimientoMaquinaria.create({
      data: { maquinariaId: m.id, origenAgenciaId: m.agenciaId, destinoAgenciaId: dest.id, origenBahiaId: m.bahiaId, destinoBahiaId: dest.bahias[0].id, motivo: elige(['Refuerzo por alta demanda', 'Reubicación por mantenimiento', 'Balance de equipos entre agencias']), usuarioId: admin.id, fecha },
    });
    await prisma.maquinaria.update({ where: { id: m.id }, data: { agenciaId: dest.id, bahiaId: dest.bahias[0].id } });
    await prisma.maquinariaEvento.create({ data: { maquinariaId: m.id, tipo: 'MOVIMIENTO', actorId: admin.id, agenciaId: dest.id, entidadId: m.id, ocurridoEn: fecha, datos: { origen: m.agenciaId, destino: dest.id } } });
    nMov++;
  }
  console.log(`🛠  Maquinaria: ${maquinas.length} · incidencias: ${nInc} · mantenimientos: ${nMan} · limpiezas: ${nLimp} · traslados: ${nMov}`);
}

// ---------------------------------------------------------------- envíos
async function crearEnvios(admin: { id: string }) {
  const central = await prisma.bodega.findFirst({ where: { tipo: 'CENTRAL' } });
  if (!central) throw new Error('No hay Bodega Central. Créala y cárgale stock antes de generar los envíos.');
  const insumos = await prisma.insumo.findMany({ where: { estado: 1 } });
  if (!insumos.length) throw new Error('No hay insumos.');
  const agencias = await prisma.agencia.findMany({ select: { id: true, nombre: true } });
  const pulidores = await prisma.user.findMany({ where: { estado: 1, role: { namerol: 'PULIDOR' } }, select: { id: true, name: true, lastname: true, agenciaId: true } });
  const recibidoresDe = async (agId: string) => (await prisma.user.findFirst({ where: { estado: 1, agenciaId: agId }, select: { id: true } }))?.id ?? admin.id;

  const stockCentral = async (insumoId: string) => prisma.stockUbicacion.findFirst({ where: { insumoId, tipoUbicacion: 'BODEGA_CENTRAL', bodegaId: central.id } });
  const mover = async (
    ubic: { insumoId: string; tipo: 'BODEGA_CENTRAL' | 'AGENCIA' | 'PULIDOR_MOVIL'; id: string },
    delta: number,
    tipoMov: string,
    movId: string,
    fecha: Date,
    usuarioId: string,
    costo: Prisma.Decimal,
  ) => {
    const where = ubic.tipo === 'BODEGA_CENTRAL' ? { bodegaId: ubic.id } : ubic.tipo === 'AGENCIA' ? { agenciaId: ubic.id } : { pulidorId: ubic.id };
    // Un pulidor puede ser fijo o móvil: se usa la fila que ya tenga, sin crear otra de distinto tipo.
    let fila = await prisma.stockUbicacion.findFirst({ where: { insumoId: ubic.insumoId, ...(ubic.tipo === 'PULIDOR_MOVIL' ? {} : { tipoUbicacion: ubic.tipo }), ...where } });
    const antes = Number(fila?.cantidadActual ?? 0);
    if (fila) await prisma.stockUbicacion.update({ where: { id: fila.id }, data: { cantidadActual: { increment: delta } } });
    else fila = await prisma.stockUbicacion.create({ data: { insumoId: ubic.insumoId, tipoUbicacion: ubic.tipo, ...where, cantidadActual: delta, cantidadMinima: 2 } });
    if (ubic.tipo === 'BODEGA_CENTRAL') await prisma.insumo.update({ where: { id: ubic.insumoId }, data: { stockActual: { increment: delta } } });
    await prisma.kardexMovimiento.create({
      data: { insumoId: ubic.insumoId, ubicacionId: ubic.id, tipoMovimiento: tipoMov, cantidad: D(delta), stockAnterior: D(antes), stockPosterior: D(antes + delta), costoUnitario: costo, costoTotal: costo.mul(Math.abs(delta)), referenciaId: movId, usuarioId, fecha },
    });
  };

  const resumen: Record<string, number> = {};
  const total = 80;
  for (let n = 1; n <= total; n++) {
    const aPulidor = pulidores.length > 0 && prob(0.13);
    const pul = aPulidor ? elige(pulidores) : null;
    const ag = pul ? null : elige(agencias);
    const destinoUbicacion = pul ? `Pulidor ${pul.name} ${pul.lastname}`.trim() : ag!.nombre;
    const destinoUbicId = pul ? pul.id : ag!.id;
    const tipoUbic = pul ? 'PULIDOR_MOVIL' : 'AGENCIA';
    const estado = pesos([['RECIBIDO', 62], ['RECHAZADO', 9], ['EN_TRANSITO', 17], ['PENDIENTE', 6], ['CANCELADO', 6]] as const);
    // Los en tránsito: la mayoría recientes y algunos atrasados (más de 4 días sin confirmar).
    const antiguedad = estado === 'EN_TRANSITO' ? (prob(0.35) ? entero(5, 12) : entero(0, 3)) : estado === 'PENDIENTE' ? entero(0, 2) : entero(3, 55);
    const fechaDespacho = hace(antiguedad, entero(7, 16));
    const fechaRecepcion = new Date(fechaDespacho.getTime() + entero(5, 70) * 3600000);

    // Líneas: solo con insumos que la bodega pueda cubrir.
    const lineas: { ins: (typeof insumos)[number]; unidades: number; base: number }[] = [];
    for (const ins of mezclar(insumos).slice(0, entero(2, 5))) {
      const unidades = entero(1, 15);
      const base = unidades * (Number(ins.contenidoNeto) || 1);
      const st = await stockCentral(ins.id);
      if (st && Number(st.cantidadActual) >= base) lineas.push({ ins, unidades, base });
    }
    if (!lineas.length) continue;

    const recibe = pul ? pul.id : await recibidoresDe(ag!.id);
    const parcial = estado === 'RECIBIDO' && prob(0.24);
    const mov = await prisma.movimientoInventario.create({
      data: {
        numeroGuia: `DESP-DEMO-${String(n).padStart(4, '0')}`,
        tipo: pul ? 'DESPACHO_PULIDOR' : 'DESPACHO_AGENCIA',
        estadoDespacho: estado,
        origenUbicacion: central.nombre,
        destinoUbicacion,
        origenBodegaId: central.id,
        destinoAgenciaId: ag?.id ?? null,
        destinoPulidorId: pul?.id ?? null,
        usuarioDespachaId: admin.id,
        usuarioRecibeId: estado === 'RECIBIDO' || estado === 'RECHAZADO' ? recibe : pul?.id ?? null,
        fechaDespacho,
        fechaRecepcion: estado === 'RECIBIDO' || estado === 'RECHAZADO' ? fechaRecepcion : null,
        observaciones:
          estado === 'RECHAZADO' ? `RECHAZO: ${elige(['Llegó averiado', 'No corresponde al pedido', 'Envases abiertos o derramados'])}`
          : estado === 'CANCELADO' ? 'Cancelado antes de salir de bodega'
          : null,
        createdAt: fechaDespacho,
        detalles: { create: lineas.map((l) => ({ insumoId: l.ins.id, cantidadEnviada: D(l.unidades), costoUnitarioUSD: l.ins.costoUnitarioUSD, subtotalUSD: l.ins.costoUnitarioUSD.mul(l.unidades) })) },
      },
      include: { detalles: true },
    });

    const sale = estado !== 'PENDIENTE' && estado !== 'CANCELADO';
    for (const l of lineas) {
      const costo = l.ins.costoUnitarioUSD;
      if (sale) await mover({ insumoId: l.ins.id, tipo: 'BODEGA_CENTRAL', id: central.id }, -l.base, 'DESPACHO_SALIDA', mov.id, fechaDespacho, admin.id, costo);
      if (estado !== 'RECIBIDO' && estado !== 'RECHAZADO') continue;
      const det = mov.detalles.find((d) => d.insumoId === l.ins.id)!;
      if (estado === 'RECHAZADO') {
        await prisma.movimientoDetalle.update({ where: { id: det.id }, data: { cantidadRecibida: D(0) } });
        await mover({ insumoId: l.ins.id, tipo: 'BODEGA_CENTRAL', id: central.id }, l.base, 'DESPACHO_ENTRADA', mov.id, fechaRecepcion, admin.id, costo);
        continue;
      }
      // RECIBIDO: completo, o parcial (en alguna línea llegan menos unidades).
      const faltan = parcial && prob(0.6) && l.unidades > 1 ? entero(1, Math.max(1, Math.ceil(l.unidades / 2))) : 0;
      const recibidas = l.unidades - faltan;
      await prisma.movimientoDetalle.update({ where: { id: det.id }, data: { cantidadRecibida: D(recibidas) } });
      const baseRec = recibidas * (Number(l.ins.contenidoNeto) || 1);
      await mover({ insumoId: l.ins.id, tipo: tipoUbic, id: destinoUbicId }, baseRec, 'DESPACHO_ENTRADA', mov.id, fechaRecepcion, recibe, costo);
      if (faltan > 0) {
        const baseFalta = faltan * (Number(l.ins.contenidoNeto) || 1);
        const resuelto = prob(0.5);
        const resolucion = resuelto ? pesos([['ENTREGADO', 45], ['DEVOLVER', 35], ['BAJA', 20]] as const) : null;
        const fRes = new Date(fechaRecepcion.getTime() + entero(1, 5) * DIA);
        await prisma.faltanteDespacho.create({
          data: {
            movimientoId: mov.id,
            numeroGuia: mov.numeroGuia,
            insumoId: l.ins.id,
            cantidadUnd: D(faltan),
            cantidadBase: D(baseFalta),
            origenBodegaId: central.id,
            motivoRecepcion: elige(['Faltaron unidades en la caja', 'Envases dañados en el trayecto', 'Conteo no coincide con la guía']),
            estado: resuelto ? 'RESUELTO' : 'PENDIENTE',
            resolucion,
            observacionResolucion: resuelto ? 'Resuelto en la revisión semanal' : null,
            resueltoPorId: resuelto ? admin.id : null,
            resueltoEn: resuelto ? fRes : null,
            createdAt: fechaRecepcion,
          },
        });
        if (resolucion === 'ENTREGADO') await mover({ insumoId: l.ins.id, tipo: tipoUbic, id: destinoUbicId }, baseFalta, 'DESPACHO_ENTRADA', mov.id, fRes, admin.id, costo);
        if (resolucion === 'DEVOLVER') await mover({ insumoId: l.ins.id, tipo: 'BODEGA_CENTRAL', id: central.id }, baseFalta, 'DESPACHO_ENTRADA', mov.id, fRes, admin.id, costo);
      }
    }
    const clave = estado === 'RECIBIDO' ? (parcial ? 'RECIBIDO parcial' : 'RECIBIDO completo') : estado;
    resumen[clave] = (resumen[clave] ?? 0) + 1;
  }
  const faltantes = await prisma.faltanteDespacho.count({ where: { numeroGuia: { startsWith: 'DESP-DEMO-' } } });
  console.log(`📦 Envíos: ${Object.entries(resumen).map(([k, v]) => `${k} ${v}`).join(' · ')} · faltantes ${faltantes}`);
}

// ---------------------------------------------------------------- main
async function main() {
  if (RESET || SOLO_BORRAR) await borrarDemo();
  if (SOLO_BORRAR) return;
  const yaHay = (await prisma.maquinaria.count({ where: { serie: { startsWith: 'DEMO-' } } })) + (await prisma.movimientoInventario.count({ where: { numeroGuia: { startsWith: 'DESP-DEMO-' } } }));
  if (yaHay) return console.log('ℹ Los datos de demostración ya existen. Usa --reset para recrearlos.');

  const admin = await prisma.user.findFirst({ where: { role: { namerol: 'SUPER_ADMIN' } }, select: { id: true } });
  if (!admin) throw new Error('No hay usuario SUPER_ADMIN. Corre primero el seed.');
  const tecnicos = await prisma.user.findMany({ where: { estado: 1, role: { namerol: { in: ['TECNICO', 'COORD_MANTENIMIENTO'] } } }, select: { id: true } });
  if (!tecnicos.length) console.log('ℹ No hay usuarios técnicos: los técnicos de incidencias y mantenimientos serán el Super Admin.');

  await crearMaquinaria(admin, tecnicos);
  await crearEnvios(admin);
  console.log('✅ Datos de demostración listos. Para quitarlos: npm run prisma:seed-demo -- --solo-borrar');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
