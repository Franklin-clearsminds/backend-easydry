/**
 * Datos de DEMOSTRACIÓN para la pantalla de Aprobaciones, en la base LOCAL. No es para producción.
 *
 * Sobre las OT del cliente TEOJAMA (las del Excel) que están finalizadas y sin decidir:
 *  - Crea un usuario APROBADOR en 4 agencias (las otras 4 quedan sin aprobador, para probar la regla de respaldo del administrador).
 *  - Decide las OT como lo haría el cierre diario: casi todas las de días anteriores quedan aprobadas, unas pocas rechazadas con su
 *    motivo y las más recientes quedan pendientes. Decide el aprobador de la agencia (TITULAR) o, si no tiene, el Super Admin (RESPALDO).
 *  - Registra cada decisión en la bitácora de decisiones.
 *  - Crea solicitudes de aprobación (despachos de químicos, mermas, precios especiales y repuestos) pendientes, aprobadas y rechazadas.
 *
 * Es determinista y no se repite: si ya hay datos de demostración, avisa y no hace nada.
 *
 * Uso: npm run prisma:seed-demo-aprobaciones [-- --reset]
 *   --reset  deshace lo anterior (las OT vuelven a «finalizadas», sin decidir; se borran las solicitudes y las decisiones de la demo)
 *            y lo vuelve a crear. Los usuarios aprobadores se conservan.
 *   --solo-borrar  solo deshace.
 *
 * Los aprobadores creados usan la contraseña inicial «Easy-dry2026»: aprobador.<agencia>@easydry.com
 */
import { PrismaClient, ServiceStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const RESET = process.argv.includes('--reset');
const SOLO_BORRAR = process.argv.includes('--solo-borrar');
const PASSWORD = 'Easy-dry2026';
const DIA = 86400000;
const AHORA = Date.now();
const MARCA = '[DEMO] ';
const CON_APROBADOR = ['LABRADOR', 'CUENCA', 'JTM', 'MANTA'];

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost).');
}

let semilla = 20261023;
const rnd = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entero = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const normKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const nombreDe = (u: { name: string; lastname: string }) => `${u.name} ${u.lastname}`.trim();

const MOTIVOS_RECHAZO = [
  'La placa no coincide con la foto de ingreso',
  'Falta la foto de salida del vehículo',
  'El servicio registrado no corresponde al realizado',
  'Vehículo duplicado en el mismo día',
  'Datos del vehículo incompletos: falta modelo y color',
];

async function deshacer() {
  const cliente = await prisma.cliente.findFirst({ where: { nombre: { equals: 'TEOJAMA', mode: 'insensitive' } } });
  const decisores = await prisma.user.findMany({
    where: { OR: [{ email: { startsWith: 'aprobador.' } }, { role: { namerol: 'SUPER_ADMIN' } }] },
    select: { id: true },
  });
  const ids = decisores.map((d) => d.id);
  const ots = await prisma.servicioLavado.findMany({
    where: { cliente: cliente?.nombre ?? '__ninguno__', decididoPorId: { in: ids }, estado: { in: [ServiceStatus.APROBADO, ServiceStatus.RECHAZADO] } },
    select: { id: true },
  });
  const otIds = ots.map((o) => o.id);
  if (otIds.length) {
    await prisma.servicioLavado.updateMany({
      where: { id: { in: otIds } },
      data: { estado: ServiceStatus.FINALIZADO, aprobadoPor: null, decididoPorId: null, reglaDecision: null, fechaAprobacion: null, motivoRechazo: null, observacionGerente: null },
    });
  }
  const solicitudes = await prisma.solicitudAprobacion.findMany({ where: { descripcion: { startsWith: MARCA } }, select: { id: true } });
  const solIds = solicitudes.map((s) => s.id);
  await prisma.auditoriaDecision.deleteMany({ where: { OR: [{ entidad: 'SERVICIO_LAVADO', entidadId: { in: otIds } }, { entidad: 'SOLICITUD', entidadId: { in: solIds } }] } });
  await prisma.solicitudAprobacion.deleteMany({ where: { id: { in: solIds } } });
  console.log(`🧹 Deshecho: ${otIds.length} OT vuelven a «finalizadas», ${solIds.length} solicitudes y sus decisiones borradas.`);
}

async function main() {
  if (RESET || SOLO_BORRAR) await deshacer();
  if (SOLO_BORRAR) return;

  const yaHay = await prisma.solicitudAprobacion.count({ where: { descripcion: { startsWith: MARCA } } });
  if (yaHay) return console.log('ℹ Los datos de demostración de aprobaciones ya existen. Usa --reset para recrearlos.');

  const superAdmin = await prisma.user.findFirst({ where: { role: { namerol: 'SUPER_ADMIN' } }, select: { id: true, name: true, lastname: true } });
  const rolAprobador = await prisma.role.findUnique({ where: { namerol: 'APROBADOR' }, select: { id: true } });
  const cliente = await prisma.cliente.findFirst({ where: { nombre: { equals: 'TEOJAMA', mode: 'insensitive' } } });
  if (!superAdmin || !rolAprobador || !cliente) throw new Error('Faltan el Super Admin, el rol APROBADOR o el cliente TEOJAMA. Corre antes el seed y la importación de agencias.');

  // ── aprobadores en 4 de las 8 agencias
  const agencias = await prisma.agencia.findMany({ where: { clienteId: cliente.id }, select: { id: true, nombre: true } });
  const hash = await bcrypt.hash(PASSWORD, 10);
  const aprobadorDe = new Map<string, { id: string; name: string; lastname: string }>();
  const creados: string[] = [];
  for (const ag of agencias) {
    const clave = CON_APROBADOR.find((c) => normKey(ag.nombre).endsWith(c));
    if (!clave) continue;
    const corto = ag.nombre.replace(/^TEOJAMA COMERCIAL\s*/i, '').trim();
    const email = `aprobador.${clave.toLowerCase()}@easydry.com`;
    let u = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, lastname: true } });
    if (!u) {
      u = await prisma.user.create({
        data: { email, passwordHash: hash, name: 'Aprobador', lastname: corto, roleId: rolAprobador.id, agenciaId: ag.id, estado: 1 },
        select: { id: true, name: true, lastname: true },
      });
      creados.push(email);
    }
    aprobadorDe.set(ag.id, u);
  }

  // ── decisiones sobre las OT finalizadas
  const ots = await prisma.servicioLavado.findMany({
    where: { cliente: cliente.nombre, estado: ServiceStatus.FINALIZADO, deletedAt: null },
    select: { id: true, horaIngreso: true, bahia: { select: { agenciaId: true } } },
    orderBy: { horaIngreso: 'asc' },
  });
  const cuenta = { APROBADO: 0, RECHAZADO: 0, pendientes: 0, titular: 0, respaldo: 0 };
  const bitacora: any[] = [];
  for (const ot of ots) {
    const edad = (AHORA - ot.horaIngreso.getTime()) / DIA;
    const [pAprueba, pRechaza] = edad >= 9 ? [0.9, 0.06] : edad >= 7 ? [0.7, 0.05] : [0.2, 0.02];
    const r = rnd();
    if (r >= pAprueba + pRechaza) { cuenta.pendientes++; continue; }
    const rechaza = r >= pAprueba;
    const agenciaId = ot.bahia.agenciaId;
    const titular = aprobadorDe.get(agenciaId);
    const decisor = titular ?? superAdmin;
    const regla = titular ? 'TITULAR' : 'RESPALDO';
    // El cierre diario se hace al día siguiente por la mañana; sin aprobador designado tarda un día más.
    const fecha = new Date(ot.horaIngreso.getTime() + (titular ? 1 : 2) * DIA + entero(0, 4) * 3600000 + entero(0, 59) * 60000);
    const motivo = rechaza ? elige(MOTIVOS_RECHAZO) : null;
    await prisma.servicioLavado.update({
      where: { id: ot.id },
      data: {
        estado: rechaza ? ServiceStatus.RECHAZADO : ServiceStatus.APROBADO,
        aprobadoPor: nombreDe(decisor),
        decididoPorId: decisor.id,
        reglaDecision: regla,
        fechaAprobacion: fecha,
        motivoRechazo: motivo,
        observacionGerente: motivo ?? (rnd() < 0.15 ? elige(['Conforme', 'Todo en orden', 'Aprobado sin novedades']) : 'Aprobado'),
        version: { increment: 1 },
      },
    });
    bitacora.push({
      entidad: 'SERVICIO_LAVADO', entidadId: ot.id, accion: rechaza ? 'RECHAZAR' : 'APROBAR', usuarioId: decisor.id, usuarioNombre: nombreDe(decisor),
      rol: titular ? 'APROBADOR' : 'SUPER_ADMIN', regla, motivo, agenciaId, createdAt: fecha,
    });
    cuenta[rechaza ? 'RECHAZADO' : 'APROBADO']++;
    cuenta[titular ? 'titular' : 'respaldo']++;
  }
  await prisma.auditoriaDecision.createMany({ data: bitacora });

  // ── solicitudes de aprobación
  const tipos = [
    { tipo: 'DESPACHO_QUIMICOS', titulos: ['Reposición de desengrasante', 'Despacho urgente de shampoo', 'Envío de ceras y selladores'], monto: [40, 380] },
    { tipo: 'AJUSTE_MERMA', titulos: ['Merma por derrame en bodega', 'Envases dañados en el traslado', 'Producto vencido'], monto: [10, 120] },
    { tipo: 'SERVICIO_ESPECIAL_PRECIO', titulos: ['Descuento por flota corporativa', 'Precio especial cerámico 5 años', 'Tarifa convenio concesionario'], monto: [50, 600] },
    { tipo: 'COMPRA_REPUESTO', titulos: ['Compra de bomba para hidrolavadora', 'Repuesto de manguera de alta presión', 'Kit de sellos para compresor'], monto: [25, 450] },
  ] as const;
  const operadores = await prisma.user.findMany({ where: { estado: 1, agenciaId: { in: agencias.map((a) => a.id) } }, select: { id: true, agenciaId: true } });
  const decisoresSol: any[] = [];
  let sol = 0;
  for (let n = 0; n < 30; n++) {
    const ag = elige(agencias);
    const t = elige(tipos);
    const solicitante = elige(operadores.filter((o) => o.agenciaId === ag.id).concat([{ id: superAdmin.id, agenciaId: ag.id }]));
    const creada = new Date(AHORA - entero(0, 29) * DIA - entero(0, 8) * 3600000);
    const estado = rnd() < 0.4 ? 'PENDIENTE' : rnd() < 0.78 ? 'APROBADO' : 'RECHAZADO';
    const titular = aprobadorDe.get(ag.id);
    const decisor = titular ?? superAdmin;
    const decidida = estado !== 'PENDIENTE';
    const fechaDecision = decidida ? new Date(creada.getTime() + entero(2, 48) * 3600000) : null;
    const motivo = estado === 'RECHAZADO' ? elige(['Monto fuera de presupuesto', 'Falta cotización de respaldo', 'No justifica la urgencia']) : null;
    const s = await prisma.solicitudAprobacion.create({
      data: {
        tipo: t.tipo,
        titulo: elige(t.titulos),
        descripcion: `${MARCA}Solicitud de ${ag.nombre}`,
        montoUSD: entero(t.monto[0], t.monto[1]),
        estado,
        solicitanteId: solicitante.id,
        aprobadorId: decidida ? decisor.id : null,
        agenciaId: ag.id,
        motivoRechazo: motivo,
        fechaDecision,
        createdAt: creada,
      },
    });
    sol++;
    if (decidida) {
      decisoresSol.push({
        entidad: 'SOLICITUD', entidadId: s.id, accion: estado === 'APROBADO' ? 'APROBAR' : 'RECHAZAR', usuarioId: decisor.id, usuarioNombre: nombreDe(decisor),
        rol: titular ? 'APROBADOR' : 'SUPER_ADMIN', regla: titular ? 'TITULAR' : 'RESPALDO', motivo, agenciaId: ag.id, createdAt: fechaDecision,
      });
    }
  }
  await prisma.auditoriaDecision.createMany({ data: decisoresSol });

  console.log(`✅ OT decididas: ${cuenta.APROBADO} aprobadas · ${cuenta.RECHAZADO} rechazadas · ${cuenta.pendientes} pendientes (de ${ots.length}). Por aprobador titular: ${cuenta.titular} · por respaldo (Super Admin): ${cuenta.respaldo}.`);
  console.log(`📝 Solicitudes de aprobación: ${sol} · decisiones en bitácora: ${bitacora.length + decisoresSol.length}.`);
  if (creados.length) console.log(`👤 Aprobadores creados (contraseña ${PASSWORD}): ${creados.join(', ')}`);
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
