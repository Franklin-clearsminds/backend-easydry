/**
 * Datos de DEMOSTRACIÓN de los últimos 90 días para la base LOCAL. No es para producción.
 *
 * Complementa a `seed-demo-dashboards.ts` (maquinaria, incidencias, mantenimientos, limpiezas, traslados y envíos con
 * su confirmación de recepción; correrlo con DEMO_DIAS=90). Este script pone lo que falta:
 *  - Precios en el catálogo de servicios (solo donde están en 0) y algunos precios propios por agencia.
 *  - Costo de los insumos (solo donde está en 0), para que los consumos tengan valor.
 *  - Técnicos y coordinador de mantenimiento (sin contraseña utilizable: el admin les asigna la clave).
 *  - Servicios de lavado de todas las agencias con bahía y lavador: estados, aprobaciones, retoques, evidencias,
 *    consumo de insumos (con su kardex) y precio congelado.
 *  - Servicios especiales de los pulidores: tiempos, pausas, calificación y consumo del kit.
 *
 * Todo lo creado se identifica: clientUuid «c90-…» y códigos de servicio especial «SE-C90-…».
 * Es determinista y no se repite: si ya existe, avisa y no hace nada.
 *
 * Uso: npm run prisma:seed-tres-meses [-- --reset]
 *   --reset        borra los servicios creados por este script (y devuelve el stock) y los vuelve a crear.
 *   --solo-borrar  solo borra.
 */
import { PrismaClient, Prisma, ServiceStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { aUnidadDelInsumo, valorarConsumo } from '../src/common/utils/costo-insumo.js';

const prisma = new PrismaClient();
const RESET = process.argv.includes('--reset');
const SOLO_BORRAR = process.argv.includes('--solo-borrar');
const DIA = 86400000;
const AHORA = Date.now();
const DIAS = 90;
const TAG = 'c90-';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost).');
}

// ---------------------------------------------------------------- utilidades
let semilla = 20270127;
const rnd = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a: number, b: number) => a + rnd() * (b - a);
const entero = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const prob = (p: number) => rnd() < p;
function pesos<T>(xs: readonly (readonly [T, number])[]): T {
  const total = xs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [x, w] of xs) if ((r -= w) < 0) return x;
  return xs[xs.length - 1][0];
}
const D = (n: number) => new Prisma.Decimal(n);
const redondea = (n: number, paso = 0.5) => Math.round(n / paso) * paso;
const lotes = <T>(xs: T[], n = 2000): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
/** Día calendario de Ecuador (UTC-5) a `dias` días de hoy, a la hora local indicada. */
const instante = (dias: number, hora: number, minuto = 0) => {
  const ahoraEc = new Date(AHORA - 5 * 3600000);
  return new Date(Date.UTC(ahoraEc.getUTCFullYear(), ahoraEc.getUTCMonth(), ahoraEc.getUTCDate() - dias, hora + 5, minuto));
};
const diaSemanaEc = (dias: number) => new Date(AHORA - 5 * 3600000 - dias * DIA).getUTCDay();

// ---------------------------------------------------------------- borrado
async function borrar() {
  const lav = await prisma.servicioLavado.findMany({ where: { clientUuid: { startsWith: TAG } }, select: { id: true } });
  const esp = await prisma.servicioEspecial.findMany({ where: { codigoSE: { startsWith: 'SE-C90-' } }, select: { id: true } });
  const ids = [...lav, ...esp].map((s) => s.id);
  if (ids.length) {
    const neto = new Map<string, { insumoId: string; ubicacionId: string; cantidad: number }>();
    for (const parte of lotes(ids, 5000)) {
      for (const k of await prisma.kardexMovimiento.findMany({ where: { referenciaId: { in: parte }, tipoMovimiento: { in: ['CONSUMO_SERVICIO', 'CONSUMO_SERVICIO_ESPECIAL'] } } })) {
        const clave = `${k.insumoId}|${k.ubicacionId}`;
        const e = neto.get(clave) ?? { insumoId: k.insumoId, ubicacionId: k.ubicacionId, cantidad: 0 };
        e.cantidad += Number(k.cantidad);
        neto.set(clave, e);
      }
    }
    const agencias = new Set((await prisma.agencia.findMany({ select: { id: true } })).map((a) => a.id));
    for (const e of neto.values()) {
      if (!e.cantidad) continue;
      const donde: Prisma.StockUbicacionWhereInput = agencias.has(e.ubicacionId) ? { tipoUbicacion: 'AGENCIA', agenciaId: e.ubicacionId } : { pulidorId: e.ubicacionId };
      await prisma.stockUbicacion.updateMany({ where: { insumoId: e.insumoId, ...donde }, data: { cantidadActual: { decrement: e.cantidad } } });
    }
    for (const parte of lotes(ids, 5000)) await prisma.kardexMovimiento.deleteMany({ where: { referenciaId: { in: parte } } });
    for (const parte of lotes(lav.map((s) => s.id), 5000)) await prisma.servicioLavado.deleteMany({ where: { id: { in: parte } } });
    for (const parte of lotes(esp.map((s) => s.id), 5000)) await prisma.servicioEspecial.deleteMany({ where: { id: { in: parte } } });
  }
  await prisma.kardexMovimiento.deleteMany({ where: { tipoMovimiento: 'AJUSTE_INICIAL', referenciaId: 'c90' } });
  console.log(`🧹 Borrado: ${lav.length} servicios de lavado y ${esp.length} especiales.`);
}

// ---------------------------------------------------------------- precios, costos, técnicos
const PRECIOS: Record<number, number> = {
  11155: 6, 11156: 9, 11157: 12, 11158: 14, 11159: 16, 11160: 22, 11161: 25, 11162: 8, 11163: 8, 11164: 14,
  11165: 70, 11166: 140, 11167: 110, 11168: 60, 11169: 320, 11170: 260, 11171: 450, 11172: 380, 11173: 380, 11174: 300,
  11175: 35, 11176: 25, 11177: 15, 11178: 40, 11179: 30, 11180: 80, 11181: 300, 11182: 240, 11183: 430, 11184: 360,
  11185: 90, 11186: 70, 11187: 20, 11188: 200, 11189: 160, 11190: 18, 11191: 10, 11192: 14, 11193: 20, 11194: 10,
};

async function ponerPrecios() {
  let n = 0;
  for (const [id, precio] of Object.entries(PRECIOS)) {
    const r = await prisma.catalogoServicio.updateMany({ where: { id: Number(id), precio: 0, esRetoque: false }, data: { precio: D(precio) } });
    n += r.count;
  }
  // Precios propios en ~35% de las agencias, para 1 a 3 servicios generales (±5 a 15%).
  const generales = await prisma.catalogoServicio.findMany({ where: { categoria: 'GENERAL', esRetoque: false, estado: 'Activo' }, select: { id: true, precio: true } });
  const agencias = await prisma.agencia.findMany({ where: { estado: 1 }, select: { id: true } });
  const filas: Prisma.PrecioAgenciaServicioCreateManyInput[] = [];
  for (const a of agencias) {
    if (!prob(0.35)) continue;
    const cuantos = entero(1, 3);
    const elegidos = [...generales].sort(() => rnd() - 0.5).slice(0, cuantos);
    for (const s of elegidos) {
      const base = Number(s.precio);
      if (!base) continue;
      filas.push({ agenciaId: a.id, catalogoServicioId: s.id, precio: D(Math.max(1, redondea(base * entre(0.85, 1.15)))) });
    }
  }
  const r = await prisma.precioAgenciaServicio.createMany({ data: filas, skipDuplicates: true });
  console.log(`💲 Catálogo: ${n} servicios con precio · precios por agencia: ${r.count}`);
}

const COSTOS: [RegExp, number][] = [
  [/DESENGRASANTE D\.J/i, 0.004], [/RENOVADOR DE NEUMATICOS/i, 0.006], [/ACONDICIONADOR DJ/i, 0.005],
  [/PULIMENTO/i, 0.03], [/DURA COATING/i, 0.25], [/PLASTIC RENOVATOR/i, 14], [/RAIN REPELLANT/i, 11],
  [/TYRE DRESSING/i, 9], [/HYDROSEAL/i, 18], [/POWER LOCK/i, 16], [/FINAL FINISH/i, 14], [/ZR53/i, 38],
  [/NL272/i, 32], [/GLASS TREATMENT/i, 24], [/LLUVIA ACIDA/i, 7], [/FABRIC NEUTRALIZER/i, 45],
  [/ENGINE DEGREASER/i, 6.5], [/WOOL/i, 12], [/^PAD /i, 7], [/FABRIC INTERIOR CLEANER/i, 6],
];

async function ponerCostosInsumos() {
  let n = 0;
  for (const i of await prisma.insumo.findMany({ where: { costoUnitarioUSD: 0 }, select: { id: true, nombre: true, contenidoNeto: true } })) {
    const regla = COSTOS.find(([re]) => re.test(i.nombre));
    const costo = regla ? regla[1] : Number(i.contenidoNeto) > 1 ? Number(i.contenidoNeto) * 0.02 : 5;
    // El costo es el del envase; los de 1 ml se guardan con 2 decimales, así que se redondea al centavo mínimo.
    await prisma.insumo.update({ where: { id: i.id }, data: { costoUnitarioUSD: D(Math.max(0.01, Number(costo.toFixed(2)))) } });
    n++;
  }
  console.log(`🧴 Insumos con costo asignado: ${n}`);
}

async function crearTecnicos() {
  const roles = await prisma.role.findMany({ where: { namerol: { in: ['TECNICO', 'COORD_MANTENIMIENTO'] } }, select: { id: true, namerol: true } });
  const rol = (n: string) => roles.find((r) => r.namerol === n)?.id;
  const plan = [
    ['TECNICO', 'Marco', 'Villacís'], ['TECNICO', 'Luis', 'Cedeño'], ['TECNICO', 'Diego', 'Almeida'], ['TECNICO', 'Pablo', 'Reyes'],
    ['COORD_MANTENIMIENTO', 'Andrea', 'Paredes'],
  ] as const;
  let n = 0;
  for (const [namerol, name, lastname] of plan) {
    const roleId = rol(namerol);
    if (!roleId) continue;
    const email = `${name}.${lastname}.${namerol.toLowerCase()}@easydry.com`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (await prisma.user.findUnique({ where: { email } })) continue;
    // Clave aleatoria que nadie conoce: el admin les asigna la suya desde Usuarios (la política no permite claves generadas).
    await prisma.user.create({ data: { email, name, lastname, roleId, passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10), estado: 1 } });
    n++;
  }
  console.log(`🧑‍🔧 Técnicos / coordinador de mantenimiento creados: ${n}`);
}

// ---------------------------------------------------------------- datos de apoyo
const VEHICULOS: Record<string, string[]> = {
  Toyota: ['Hilux', 'Corolla', 'Yaris', 'RAV4', 'Fortuner'], Chevrolet: ['Sail', 'Spark', 'Onix', 'D-Max', 'Tracker'],
  Suzuki: ['Swift', 'Vitara', 'Jimny', 'Ertiga', 'S-Presso'], Kia: ['Rio', 'Sportage', 'Picanto', 'Seltos'],
  Hyundai: ['Tucson', 'Accent', 'Creta', 'Grand i10'], Ford: ['Ranger', 'Explorer', 'Escape', 'Territory'],
  Nissan: ['Kicks', 'Sentra', 'Frontier'], Mazda: ['CX-5', 'Mazda3', 'CX-30'], Peugeot: ['208', '2008', '3008'],
  'Mercedes-Benz': ['C200', 'GLA 200', 'Clase A'], Changan: ['CS35', 'Alsvin', 'CS55'], Isuzu: ['D-Max', 'MU-X'],
};
const MARCA_DE_CLIENTE: Record<string, string> = { SUZUKI: 'Suzuki', TOYOCOSTA: 'Toyota', PEUGEOT: 'Peugeot', CHANGAN: 'Changan', ISUZU: 'Isuzu', 'MERCEDES BENZ': 'Mercedes-Benz', 'ORGU FORD': 'Ford', MARESA: 'Mazda' };
const COLORES = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Beige'];
const NOMBRES = ['Carlos', 'María', 'José', 'Ana', 'Luis', 'Carmen', 'Jorge', 'Patricia', 'Fernando', 'Lucía', 'Andrés', 'Verónica'];
const APELLIDOS = ['Torres', 'Villavicencio', 'Mora', 'Sánchez', 'Cevallos', 'Andrade', 'Pazmiño', 'Salazar', 'Ortiz', 'Guerrero', 'Jácome', 'Naranjo'];
const PROVINCIAS = ['P', 'I', 'G', 'A', 'U', 'T', 'X'];
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const placa = () => `${elige(PROVINCIAS)}${LETRAS[entero(0, LETRAS.length - 1)]}${LETRAS[entero(0, LETRAS.length - 1)]}-${String(entero(100, 9999)).padStart(4, '0')}`;
const persona = () => `${elige(NOMBRES)} ${elige(APELLIDOS)}`;
/** Peso de cada servicio general cuando la agencia no tiene una lista propia. */
const PESO_GENERAL: Record<number, number> = { 11155: 28, 11156: 20, 11157: 14, 11158: 8, 11159: 10, 11160: 6, 11161: 2, 11162: 6 };
const hhmm = (d: Date) => new Date(d.getTime() - 5 * 3600000).toISOString().slice(11, 16);

type Consumo = { ubicacionId: string; insumoId: string; fecha: Date; referenciaId: string; operadorId: string; cantidad: number; costoUnit: number; costoTotal: number; pulidorId?: string };

// ---------------------------------------------------------------- servicios de lavado
async function crearLavados(admin: { id: string; name: string; lastname: string }, consumos: Consumo[]) {
  const catalogo = await prisma.catalogoServicio.findMany({ include: { recetas: { include: { insumo: { include: { unidadMedida: true } }, unidadConsumo: true } } } });
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const retoque = catalogo.find((c) => c.codigo === 'RETOQUE-GEN');
  const agencias = await prisma.agencia.findMany({
    where: { estado: 1, bahias: { some: { activa: true } }, usuarios: { some: { estado: 1, role: { namerol: 'LAVADOR' } } } },
    include: { bahias: { where: { activa: true } }, cliente: { select: { nombre: true } }, preciosServicio: true, usuarios: { where: { estado: 1, role: { namerol: { in: ['LAVADOR', 'LIDER'] } } }, select: { id: true, name: true, lastname: true, role: { select: { namerol: true } } } } },
  });
  const generales = catalogo.filter((c) => c.categoria === 'GENERAL' && !c.esRetoque && c.estado === 'Activo');

  const filas: Prisma.ServicioLavadoCreateManyInput[] = [];
  const ops: Prisma.ServicioLavadoOperadorCreateManyInput[] = [];
  const evid: Prisma.EvidenciaServicioCreateManyInput[] = [];
  let n = 0;
  let ot = 40000;
  const horaActual = new Date(AHORA - 5 * 3600000).getUTCHours();

  for (const ag of agencias) {
    const lavadores = ag.usuarios.filter((u) => u.role.namerol === 'LAVADOR');
    const lider = ag.usuarios.find((u) => u.role.namerol === 'LIDER');
    const aprobador = lider ?? admin;
    const oferta = (() => {
      const ids = (Array.isArray(ag.servicioIds) ? ag.servicioIds : []).map(Number);
      const propios = generales.filter((g) => ids.includes(g.id));
      return propios.length ? propios : generales;
    })();
    const marcaPref = MARCA_DE_CLIENTE[ag.cliente?.nombre ?? ''];
    const peso = entre(0.5, 2); // agencias grandes y chicas
    const precioDe = (id: number) => {
      const o = ag.preciosServicio.find((p) => p.catalogoServicioId === id);
      return o ? Number(o.precio) : Number(porId.get(id)?.precio ?? 0);
    };

    for (let dias = DIAS; dias >= 0; dias--) {
      const dow = diaSemanaEc(dias);
      const factor = dow === 0 ? 0.35 : dow === 6 ? 1.4 : 1;
      const cantidad = Math.round(peso * 2.6 * factor * entre(0.7, 1.3));
      for (let k = 0; k < cantidad; k++) {
        const hora = entero(8, 17);
        if (dias === 0 && hora >= horaActual - 1) continue;
        const cat = pesos(oferta.map((s) => [s, PESO_GENERAL[s.id] ?? 3] as const));
        const lav = elige(lavadores);
        const bahia = elige(ag.bahias);
        const marca = marcaPref && prob(0.7) ? marcaPref : elige(Object.keys(VEHICULOS));
        const ingreso = instante(dias, hora, entero(0, 50));
        const espera = entero(2, 20);
        const inicio = new Date(ingreso.getTime() + espera * 60000);
        const duracion = Math.round(cat.tiempoEstimadoMin * entre(0.85, 1.35));
        const salida = new Date(inicio.getTime() + duracion * 60000);

        let estado: ServiceStatus;
        if (dias > 7) estado = pesos([[ServiceStatus.APROBADO, 92], [ServiceStatus.RECHAZADO, 4], [ServiceStatus.CANCELADO, 4]] as const);
        else if (dias > 1) estado = pesos([[ServiceStatus.APROBADO, 60], [ServiceStatus.FINALIZADO, 32], [ServiceStatus.RECHAZADO, 4], [ServiceStatus.CANCELADO, 4]] as const);
        else estado = pesos([[ServiceStatus.FINALIZADO, 70], [ServiceStatus.APROBADO, 15], [ServiceStatus.EN_PROCESO, dias === 0 ? 10 : 0], [ServiceStatus.CANCELADO, 5]] as const);
        if (dias === 0 && salida.getTime() > AHORA && estado !== ServiceStatus.CANCELADO) estado = ServiceStatus.EN_PROCESO;

        const id = randomUUID();
        const terminado = estado === 'FINALIZADO' || estado === 'APROBADO' || estado === 'RECHAZADO';
        const decidido = estado === 'APROBADO' || estado === 'RECHAZADO';
        const fDecision = decidido ? new Date(Math.min(AHORA, salida.getTime() + entero(3, 22) * 3600000)) : null;
        const modelo = elige(VEHICULOS[marca]);
        const numOt = `OT-${++ot}`;
        const plc = placa();
        const cliente = prob(0.7) ? persona() : null;
        const precio = precioDe(cat.id);
        filas.push({
          id, clientUuid: `${TAG}L-${++n}`, ordenTrabajoOT: numOt, placa: plc, marca, modelo, color: elige(COLORES), cliente, estado,
          bahiaId: bahia.id, servicioCatalogoId: cat.id, operadorId: lav.id, precio: D(precio),
          fotoIngresoUrl: `https://demo.easydry.local/ot/${id}/ingreso.jpg`,
          fotoSalidaUrl: terminado ? `https://demo.easydry.local/ot/${id}/salida.jpg` : null,
          observaciones: prob(0.08) ? elige(['Cliente pide especial cuidado en tapicería', 'Rayón previo en puerta izquierda', 'Vehículo muy sucio, tomó más tiempo']) : null,
          horaIngreso: ingreso, horaInicio: inicio, horaSalida: terminado ? salida : null,
          ...(decidido && fDecision
            ? {
                aprobadoPor: `${aprobador.name} ${aprobador.lastname}`.trim(), fechaAprobacion: fDecision, decididoPorId: aprobador.id, reglaDecision: lider ? 'TITULAR' : 'RESPALDO',
                ...(estado === 'RECHAZADO' ? { motivoRechazo: elige(['Falta evidencia de salida', 'Servicio mal registrado', 'Precio no corresponde al servicio']) } : {}),
                observacionGerente: prob(0.1) ? 'Revisado en el cierre diario' : null,
              }
            : {}),
          ...(estado === 'CANCELADO' ? { anuladoPorId: lav.id, anuladoEn: new Date(ingreso.getTime() + 15 * 60000), motivoAnulacion: elige(['El cliente se retiró', 'Duplicado', 'Error de registro']) } : {}),
          createdAt: ingreso, updatedAt: fDecision ?? (terminado ? salida : ingreso), syncedAt: fDecision ?? (terminado ? salida : ingreso),
        });
        ops.push({ servicioId: id, operadorId: lav.id });
        evid.push({ servicioId: id, tipo: 'INGRESO', url: `https://demo.easydry.local/ot/${id}/ingreso.jpg`, tomadaEn: ingreso, createdAt: ingreso });
        if (terminado) evid.push({ servicioId: id, tipo: 'SALIDA', url: `https://demo.easydry.local/ot/${id}/salida.jpg`, tomadaEn: salida, createdAt: salida });

        if (terminado) registrarConsumo(cat, id, lav.id, ag.id, salida, consumos);

        // Retoque: se agrega a la misma OT hasta 2 días después (solo en servicios ya terminados y no rechazados).
        if (retoque && estado !== 'RECHAZADO' && terminado && prob(0.07)) {
          const rIng = new Date(salida.getTime() + entero(1, 40) * 3600000);
          if (rIng.getTime() < AHORA - 3600000) {
            const rDur = retoque.tiempoEstimadoMin;
            const rSal = new Date(rIng.getTime() + rDur * 60000);
            const rid = randomUUID();
            filas.push({
              id: rid, clientUuid: `${TAG}L-${++n}`, ordenTrabajoOT: numOt, placa: plc, marca, modelo, color: filas[filas.length - 1].color, cliente, estado: ServiceStatus.FINALIZADO,
              bahiaId: bahia.id, servicioCatalogoId: retoque.id, operadorId: lav.id, precio: D(0),
              fotoIngresoUrl: `https://demo.easydry.local/ot/${rid}/ingreso.jpg`, fotoSalidaUrl: `https://demo.easydry.local/ot/${rid}/salida.jpg`,
              horaIngreso: rIng, horaInicio: rIng, horaSalida: rSal, createdAt: rIng, updatedAt: rSal, syncedAt: rSal,
            });
            ops.push({ servicioId: rid, operadorId: lav.id });
            registrarConsumo(retoque, rid, lav.id, ag.id, rSal, consumos);
          }
        }
      }
    }
  }
  for (const p of lotes(filas)) await prisma.servicioLavado.createMany({ data: p });
  for (const p of lotes(ops)) await prisma.servicioLavadoOperador.createMany({ data: p, skipDuplicates: true });
  for (const p of lotes(evid)) await prisma.evidenciaServicio.createMany({ data: p });
  const por: Record<string, number> = {};
  for (const f of filas) por[f.estado as string] = (por[f.estado as string] ?? 0) + 1;
  console.log(`🚿 Servicios de lavado: ${filas.length} en ${agencias.length} agencias · ${Object.entries(por).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}

function registrarConsumo(cat: { recetas: any[] }, servicioId: string, operadorId: string, ubicacionId: string, fecha: Date, consumos: Consumo[], pulidorId?: string) {
  for (const r of cat.recetas) {
    if (r.esOpcional && prob(0.3)) continue;
    const cantidad = aUnidadDelInsumo(Number(r.cantidadUsada), r.unidadConsumo?.factorBase, r.insumo?.unidadMedida?.factorBase);
    if (cantidad <= 0) continue;
    const v = valorarConsumo(r.insumo, cantidad);
    consumos.push({ ubicacionId, insumoId: r.insumoId, fecha, referenciaId: servicioId, operadorId, cantidad, costoUnit: v.costoUnitarioUSD, costoTotal: v.costoTotalUSD, pulidorId });
  }
}

// ---------------------------------------------------------------- servicios especiales
async function crearEspeciales(admin: { id: string; name: string; lastname: string }, consumos: Consumo[]) {
  const catalogo = await prisma.catalogoServicio.findMany({ where: { categoria: 'ESPECIAL', esRetoque: false, estado: 'Activo' }, include: { recetas: { include: { insumo: { include: { unidadMedida: true } }, unidadConsumo: true } } } });
  const porId = new Map(catalogo.map((c) => [c.id, c]));
  const pulidores = await prisma.user.findMany({ where: { estado: 1, role: { namerol: 'PULIDOR' } }, select: { id: true, name: true, lastname: true, agenciaId: true, regionId: true, servicioIds: true } });
  const agencias = await prisma.agencia.findMany({ where: { estado: 1 }, select: { id: true, regionId: true, cliente: { select: { nombre: true } } } });
  const regiones = new Map((await prisma.region.findMany()).map((r) => [r.id, r.nombre]));
  const tipoDe = (n: string) => (/MICROPULIDO/i.test(n) ? 'Micro Pulido' : /PULIDO/i.test(n) && !/LAVADO/i.test(n) ? 'Pulido' : /CER[ÁA]MICO|CERAMICO/i.test(n) ? 'Recubrimiento Cerámico' : /MOTOR/i.test(n) ? 'Lavado de motor' : 'Tratamientos especiales');

  const filas: Prisma.ServicioEspecialCreateManyInput[] = [];
  const asign: Prisma.ServicioEspecialOperadorCreateManyInput[] = [];
  let n = 0;
  let ot = 70000;
  const horaActual = new Date(AHORA - 5 * 3600000).getUTCHours();

  for (const pul of pulidores) {
    const ids = (Array.isArray(pul.servicioIds) ? pul.servicioIds : []).map(Number).filter((i) => porId.has(i));
    const oferta = (ids.length ? ids : [...porId.keys()]).map((i) => porId.get(i)!);
    const propias = agencias.filter((a) => a.id === pul.agenciaId);
    const zona = propias.length ? propias : agencias.filter((a) => a.regionId === pul.regionId);
    if (!zona.length) continue;
    for (let dias = DIAS; dias >= 0; dias--) {
      if (diaSemanaEc(dias) === 0 || !prob(0.4)) continue;
      const hora = entero(8, 14);
      if (dias === 0 && hora >= horaActual - 3) continue;
      const cat = pesos(oferta.map((s) => [s, Number(s.precio) > 0 ? 1 / Math.pow(Number(s.precio), 0.6) : 1] as const));
      const ag = elige(zona);
      const marca = elige(Object.keys(VEHICULOS));
      const fecha = instante(dias, hora, entero(0, 50));
      const efectivoMin = Math.round(cat.tiempoEstimadoMin * entre(0.9, 1.3));
      const conPausa = efectivoMin >= 90 && prob(0.3);
      const pausaMin = conPausa ? entero(10, 40) : 0;
      const fin = new Date(fecha.getTime() + (efectivoMin + pausaMin) * 60000);
      let estado = dias > 1 ? pesos([['Completado', 94], ['Cancelado', 6]] as const) : pesos([['Completado', 45], ['En Proceso', 25], ['Pendiente', 22], ['Cancelado', 8]] as const);
      if (estado === 'Completado' && fin.getTime() > AHORA) estado = 'En Proceso';
      const id = randomUUID();
      const completo = estado === 'Completado';
      const pIni = new Date(fecha.getTime() + Math.round(efectivoMin / 2) * 60000);
      filas.push({
        id, clientUuid: `${TAG}E-${++n}`, codigoSE: `SE-C90-${String(n).padStart(5, '0')}`, ordenTrabajoOT: `OT-${++ot}`, tipoServicio: tipoDe(cat.nombre), servicioCatalogoId: cat.id,
        precio: D(Number(cat.precio)), clienteNombre: persona(), placa: placa(), marca, modelo: elige(VEHICULOS[marca]), color: elige(COLORES),
        prioridad: pesos([['Media', 60], ['Alta', 20], ['Baja', 15], ['Urgente', 5]] as const), estado, agenciaId: ag.id, operadorId: pul.id,
        creadoPorId: admin.id, creadoPorNombre: `${admin.name} ${admin.lastname}`.trim(), regionId: ag.regionId ?? pul.regionId, regionNombre: regiones.get(ag.regionId ?? pul.regionId ?? '') ?? null,
        fechaProgramada: fecha, horaIngreso: hhmm(fecha), horaEstimada: hhmm(new Date(fecha.getTime() + cat.tiempoEstimadoMin * 60000)),
        fechaInicio: estado === 'Pendiente' || estado === 'Cancelado' ? null : fecha, fechaFin: completo ? fin : null,
        tiempoPausaTotalSeg: completo ? pausaMin * 60 : 0, tiempoEfectivoSeg: completo ? efectivoMin * 60 : null,
        historialPausas: completo && conPausa ? [{ inicio: pIni.toISOString(), fin: new Date(pIni.getTime() + pausaMin * 60000).toISOString(), motivo: elige(['Almuerzo', 'Curado del producto', 'Espera de cliente', 'Cambio de pad']) }] : undefined,
        notasOperador: prob(0.15) ? 'Se aplicó el producto en dos capas' : null,
        calificacionCalidad: completo ? pesos([[5, 55], [4, 30], [3, 12], [2, 3]] as const) : null,
        videoInicialUrl: estado === 'Pendiente' ? null : `https://demo.easydry.local/se/${id}/inicio.mp4`, videoFinalUrl: completo ? `https://demo.easydry.local/se/${id}/final.mp4` : null,
        syncedAt: completo ? fin : fecha, createdAt: fecha, updatedAt: completo ? fin : fecha,
      });
      asign.push({ servicioId: id, operadorId: pul.id, orden: 0 });
      if (completo) registrarConsumo(cat, id, pul.id, pul.id, fin, consumos, pul.id);
    }
  }
  for (const p of lotes(filas)) await prisma.servicioEspecial.createMany({ data: p });
  for (const p of lotes(asign)) await prisma.servicioEspecialOperador.createMany({ data: p, skipDuplicates: true });
  const por: Record<string, number> = {};
  for (const f of filas) por[f.estado as string] = (por[f.estado as string] ?? 0) + 1;
  console.log(`✨ Servicios especiales: ${filas.length} de ${pulidores.length} pulidores · ${Object.entries(por).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
}

// ---------------------------------------------------------------- consumos, stock y kardex
async function aplicarConsumos(consumos: Consumo[]) {
  // Se agrupa por (ubicación, insumo): el stock de partida es el actual, o más si la ubicación se reabastecía durante los 90 días.
  const grupos = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const clave = `${c.ubicacionId}|${c.insumoId}`;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)!).push(c);
  }
  const insumos = new Map((await prisma.insumo.findMany({ select: { id: true, nombre: true, codigoSKU: true, unidadMedida: { select: { simbolo: true } } } })).map((i) => [i.id, i]));
  const consumoRows: Prisma.ConsumoServicioCreateManyInput[] = [];
  const consumoEspRows: Prisma.ConsumoServicioEspecialCreateManyInput[] = [];
  const kardex: Prisma.KardexMovimientoCreateManyInput[] = [];
  const inicioVentana = instante(DIAS + 1, 7);

  for (const [clave, lista] of grupos) {
    const [ubicacionId, insumoId] = clave.split('|');
    lista.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    const total = lista.reduce((s, c) => s + c.cantidad, 0);
    const esPulidor = !!lista[0].pulidorId;
    const fila = await prisma.stockUbicacion.findFirst({ where: { insumoId, ...(esPulidor ? { pulidorId: ubicacionId } : { tipoUbicacion: 'AGENCIA', agenciaId: ubicacionId }) } });
    const existente = Number(fila?.cantidadActual ?? 0);
    const inicial = Math.max(existente, total * entre(1.15, 1.7));
    let saldo = inicial;
    if (inicial > existente) {
      kardex.push({ insumoId, ubicacionId, tipoMovimiento: 'AJUSTE_INICIAL', cantidad: D(inicial - existente), stockAnterior: D(existente), stockPosterior: D(inicial), referenciaId: 'c90', fecha: inicioVentana });
    }
    const ins = insumos.get(insumoId)!;
    for (const c of lista) {
      const nuevo = saldo - c.cantidad;
      kardex.push({
        insumoId, ubicacionId, tipoMovimiento: esPulidor ? 'CONSUMO_SERVICIO_ESPECIAL' : 'CONSUMO_SERVICIO', cantidad: D(-c.cantidad), stockAnterior: D(saldo), stockPosterior: D(nuevo),
        costoUnitario: D(Number(c.costoUnit.toFixed(2))), costoTotal: D(Number(c.costoTotal.toFixed(2))), referenciaId: c.referenciaId, usuarioId: c.operadorId, fecha: c.fecha,
      });
      saldo = nuevo;
      const base = { insumoId, cantidadUsada: D(c.cantidad), insumoNombre: ins.nombre, insumoSKU: ins.codigoSKU, unidadSimbolo: ins.unidadMedida.simbolo, costoUnitarioUSD: D(c.costoUnit), costoTotalUSD: D(c.costoTotal), createdAt: c.fecha };
      if (esPulidor) consumoEspRows.push({ ...base, servicioEspecialId: c.referenciaId, pulidorId: c.pulidorId! });
      else consumoRows.push({ ...base, servicioId: c.referenciaId, agenciaId: ubicacionId, stockUbicacionId: fila?.id ?? null });
    }
    if (fila) await prisma.stockUbicacion.update({ where: { id: fila.id }, data: { cantidadActual: D(saldo) } });
    else await prisma.stockUbicacion.create({ data: { insumoId, tipoUbicacion: esPulidor ? 'PULIDOR_MOVIL' : 'AGENCIA', ...(esPulidor ? { pulidorId: ubicacionId } : { agenciaId: ubicacionId }), cantidadActual: D(saldo), cantidadMinima: 2 } });
  }
  for (const p of lotes(consumoRows)) await prisma.consumoServicio.createMany({ data: p });
  for (const p of lotes(consumoEspRows)) await prisma.consumoServicioEspecial.createMany({ data: p });
  for (const p of lotes(kardex)) await prisma.kardexMovimiento.createMany({ data: p });
  console.log(`📦 Consumos: ${consumoRows.length} de lavado + ${consumoEspRows.length} de especiales · movimientos de kardex: ${kardex.length}`);
}

// ---------------------------------------------------------------- main
async function main() {
  if (RESET || SOLO_BORRAR) await borrar();
  if (SOLO_BORRAR) return;
  if ((await prisma.servicioLavado.count({ where: { clientUuid: { startsWith: TAG } } })) > 0) {
    return console.log('ℹ Los servicios de tres meses ya existen. Usa --reset para recrearlos.');
  }
  const admin = await prisma.user.findFirst({ where: { role: { namerol: 'SUPER_ADMIN' } }, select: { id: true, name: true, lastname: true } });
  if (!admin) throw new Error('No hay usuario SUPER_ADMIN. Corre primero el seed.');

  await ponerPrecios();
  await ponerCostosInsumos();
  await crearTecnicos();
  const consumos: Consumo[] = [];
  await crearLavados(admin, consumos);
  await crearEspeciales(admin, consumos);
  await aplicarConsumos(consumos);
  console.log('✅ Listo. Para quitar los servicios: npm run prisma:seed-tres-meses -- --solo-borrar');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.stack ?? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
