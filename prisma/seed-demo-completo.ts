/**
 * Carga COMPLETA de datos de demostración (últimos 90 días) para revisar todos los dashboards en la base LOCAL. No es para producción.
 *
 * Corre, en el orden correcto, lo que ya existía y completa lo que faltaba:
 *   1. seed-demo-tres-meses      precios del catálogo y por agencia, costo de insumos, técnicos, servicios de lavado y especiales
 *                                con consumo de insumos y kardex.
 *   2. seed-demo-dashboards      maquinaria, incidencias, mantenimientos, limpiezas, traslados y envíos con su recepción (DEMO_DIAS=90).
 *   3. seed-demo-aprobaciones    aprobadores, solicitudes de aprobación y su bitácora (DEMO_DIAS=90).
 *   4. Retos                     activos, cerrados (con ganadores calculados por el servicio) y uno futuro.
 *   5. Auditorías 5S             visitas mensuales a ~28 agencias en los 3 formatos, con acciones correctivas en todos los estados.
 *   6. Informes de inspección    informes guardados con novedades, actividades, planes de acción y calificación.
 *   7. Existencias               repone lo que haya quedado en negativo y limpia la caché de los dashboards.
 *
 * Todo lo que crea se puede identificar y quitar: clientUuid «c90-…», máquinas «DEMO-…», guías «DESP-DEMO-…», solicitudes y retos «[DEMO] …»,
 * auditorías e informes con «[DEMO]» en sus comentarios o asunto.
 *
 * Uso: npm run prisma:seed-completo [-- --reset] [-- --solo-borrar]
 *   (sin banderas)  carga lo que falte; cada paso avisa y no repite si ya existe.
 *   --reset         borra todo lo anterior de la demostración y lo vuelve a crear.
 *   --solo-borrar   solo borra.
 * Solo corre contra una base en localhost. Haz un respaldo antes: pg_dump -Fc -f respaldo.dump <DATABASE_URL>.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../src/modules/prisma/prisma.service.js';
import { Auditoria5sService } from '../src/modules/auditorias/auditoria5s.service.js';
import { FORMATOS } from '../src/modules/auditorias/auditoria5s.reglas.js';
import { RetosService } from '../src/modules/retos/retos.service.js';
import { CacheService } from '../src/common/cache/cache.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '..');
const RESET = process.argv.includes('--reset');
const SOLO_BORRAR = process.argv.includes('--solo-borrar');
const DIA = 86400000;
const AHORA = Date.now();
const MARCA = '[DEMO]';
const DIAS = 90;

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost).');
}

const prisma = new PrismaClient();
/** Cliente de los servicios de la aplicación (retos y auditorías 5S): se cierra al terminar. */
const prismaApp = new PrismaService();

// ---------------------------------------------------------------- utilidades
let semilla = 20270301;
const rnd = () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entero = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const prob = (p: number) => rnd() < p;
const mezclar = <T>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
/** Fecha calendario de Ecuador (UTC-5) a `dias` días de hoy, como texto AAAA-MM-DD. */
const diaEc = (dias: number) => new Date(AHORA - 5 * 3600000 - dias * DIA).toISOString().slice(0, 10);
const fechaDia = (texto: string) => new Date(`${texto}T00:00:00.000Z`);
const hoyTexto = diaEc(0);
const paso = (n: number, titulo: string) => console.log(`\n━━ ${n}. ${titulo}`);

/** Corre otro script de prisma/ con el mismo cargador que usan los comandos npm. */
function correr(script: string, args: string[] = [], env: Record<string, string> = {}) {
  execFileSync(process.execPath, ['--require', './scripts/tsx-windows-userinfo.cjs', '--import', 'tsx', `prisma/${script}`, ...args], {
    cwd: BACKEND,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

// ---------------------------------------------------------------- borrado de lo propio
async function borrarPropio() {
  const retos = await prisma.reto.deleteMany({ where: { titulo: { startsWith: `${MARCA} ` } } });
  const auds = await prisma.auditoria5s.findMany({ where: { comentarios: { startsWith: MARCA } }, select: { id: true } });
  const ids = auds.map((a) => a.id);
  await prisma.auditoria5sAccion.deleteMany({ where: { auditoriaId: { in: ids } } });
  await prisma.auditoria5sHistorial.deleteMany({ where: { auditoriaId: { in: ids } } });
  await prisma.auditoria5sRespuesta.deleteMany({ where: { auditoriaId: { in: ids } } });
  await prisma.auditoria5s.deleteMany({ where: { id: { in: ids } } });
  const informes = await prisma.informeInspeccion.deleteMany({ where: { asunto: { startsWith: MARCA } } });
  console.log(`🧹 Retos ${retos.count} · auditorías 5S ${ids.length} · informes ${informes.count} borrados.`);
}

// ---------------------------------------------------------------- 4. retos
async function crearRetos(admin: { id: string; name: string; lastname: string }) {
  if ((await prisma.reto.count({ where: { titulo: { startsWith: `${MARCA} ` } } })) > 0) return console.log('ℹ Los retos de demostración ya existen.');
  const ceramicos = (await prisma.catalogoServicio.findMany({ where: { nombre: { contains: 'CER', mode: 'insensitive' }, categoria: 'ESPECIAL' }, select: { id: true } })).map((c) => c.id);
  const premium = (await prisma.catalogoServicio.findMany({ where: { codigo: { in: ['SER-LAVADO-PREMIUM', 'SER-LAVADO-COMPLETO'] } }, select: { id: true } })).map((c) => c.id);
  const base = { creadoPorId: admin.id, creadorNombre: `${admin.name} ${admin.lastname}`.trim(), creadorRol: 'SUPER_ADMIN' };
  const r = (titulo: string, descripcion: string, premio: string, desde: number, hasta: number, extra: Record<string, unknown>) => ({
    ...base, titulo: `${MARCA} ${titulo}`, descripcion, premio, fechaInicio: fechaDia(diaEc(desde)), fechaFin: fechaDia(diaEc(hasta)), estado: 'ACTIVO', ...extra,
  });
  const retos = [
    r('Rey del lavado — agosto', 'La agencia con más servicios aprobados del mes.', 'Trofeo y almuerzo del equipo', 80, 52, { tipoReto: 'AGENCIA', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 3 }),
    r('Más autos distintos — agosto', 'Placas distintas atendidas por agencia.', 'Bono de $100', 80, 52, { tipoReto: 'AGENCIA', metrica: 'AUTOS', modoGanador: 'RANKING', cantidadGanadores: 1 }),
    r('Bahía veloz — septiembre', 'La bahía con más servicios del mes.', 'Día libre para el equipo de la bahía', 50, 21, { tipoReto: 'BAHIA', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 3 }),
    r('Lavador estrella — septiembre', 'Los lavadores con más servicios del mes.', 'Bono de $50 por ganador', 50, 21, { tipoReto: 'LAVADOR', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 5 }),
    r('Pulidor del mes — septiembre', 'El pulidor con más ventas en servicios especiales.', 'Kit de pulido premium', 50, 21, { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIALES', metrica: 'MONTO', modoGanador: 'RANKING', cantidadGanadores: 3 }),
    r('Meta de ventas — primera quincena de octubre', 'Todas las agencias que lleguen a la meta ganan.', 'Cena para el equipo', 26, 12, { tipoReto: 'AGENCIA', metrica: 'MONTO', modoGanador: 'META', meta: 700, cantidadGanadores: 10 }),
    r('Lavados premium — octubre', 'Servicios Premium y Completo del mes.', 'Placa de reconocimiento', 26, -4, { tipoReto: 'AGENCIA', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: premium, metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 3 }),
    r('Meta de autos por lavador', 'Cada lavador que atienda 60 autos distintos gana.', 'Bono de $30', 12, -18, { tipoReto: 'LAVADOR', metrica: 'AUTOS', modoGanador: 'META', meta: 60, cantidadGanadores: 20 }),
    r('Cerámicos de octubre', 'Servicios cerámicos de los pulidores.', 'Bono de $150', 17, -14, { tipoReto: 'PULIDOR', tipoServicios: 'ESPECIFICOS', catalogoServicioIds: ceramicos, metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 3 }),
    r('Reto de noviembre', 'Las agencias con más servicios del mes.', 'Por definir', -5, -34, { tipoReto: 'AGENCIA', metrica: 'SERVICIOS', modoGanador: 'RANKING', cantidadGanadores: 3 }),
  ];
  for (const data of retos) await prisma.reto.create({ data: data as Prisma.RetoUncheckedCreateInput });
  // Los retos cuya fecha de fin ya pasó se cierran con el mismo servicio de la aplicación: calcula los ganadores con los servicios reales.
  const service = new RetosService(prismaApp as never);
  const cerrados = await service.cerrarVencidos();
  const activos = await prisma.reto.count({ where: { titulo: { startsWith: `${MARCA} ` }, estado: 'ACTIVO' } });
  console.log(`🏆 Retos: ${retos.length} creados · ${cerrados} cerrados con ganadores · ${activos} activos o por empezar.`);
}

// ---------------------------------------------------------------- 5. auditorías 5S
async function crearAuditorias5s(admin: any) {
  if ((await prisma.auditoria5s.count({ where: { comentarios: { startsWith: MARCA } } })) > 0) return console.log('ℹ Las auditorías 5S de demostración ya existen.');
  const a5s = new Auditoria5sService(prismaApp as never);
  const agencias = mezclar(await prisma.agencia.findMany({ where: { estado: 1, bahias: { some: {} } }, select: { id: true, nombre: true } })).slice(0, 28);
  const hallazgos = ['Piso con restos de espuma', 'Herramientas sin devolver a su lugar', 'Falta señalización en el área de secado', 'Insumos sin rotular', 'Desagüe con residuos', 'Paños sucios mezclados con limpios', 'Productos sin tapa'];
  const combos: (keyof typeof FORMATOS)[][] = [['LISTA_20'], ['PUNTOS_25'], ['SI_NO_50'], ['LISTA_20', 'PUNTOS_25', 'SI_NO_50']];
  let creadas = 0;
  let acciones = 0;

  for (const ag of agencias) {
    const nivel = 0.72 + rnd() * 0.27; // calidad base de la agencia (unas buenas, otras flojas: el semáforo sale con los tres colores)
    const visitas = [entero(70, 82), entero(40, 52), entero(8, 20)]; // días atrás de cada visita mensual
    for (let v = 0; v < visitas.length; v++) {
      const fecha = diaEc(visitas[v]);
      const mejora = v * 0.04; // tendencia a mejorar con el tiempo
      const formatos = elige(combos) as string[];
      const primera: any = await a5s.create({ agenciaId: ag.id, formatos, fecha, responsableAgencia: 'Líder de agencia', comentarios: `${MARCA} Visita mensual ${v + 1}`, } as never, admin);
      const grupo = await prisma.auditoria5s.findUniqueOrThrow({ where: { id: primera.id }, select: { grupoId: true } });
      const todas = await prisma.auditoria5s.findMany({ where: { grupoId: grupo.grupoId }, select: { id: true, formato: true, area: true, agenciaId: true } });
      for (const a of todas) {
        const f = (FORMATOS as any)[a.formato];
        const respuestas = f.criterios.map((c: any, i: number) => {
          const cumple = rnd() < Math.min(0.97, nivel + mejora);
          const puntaje = f.tipo === 'SI_NO' ? (cumple ? 1 : 0) : cumple ? f.maxCriterio - (prob(0.25) ? 1 : 0) : entero(Math.max(0, f.maxCriterio - 3), Math.max(0, f.maxCriterio - 2));
          const falla = f.tipo === 'SI_NO' ? puntaje === 0 : puntaje < f.maxCriterio - 1;
          return { criterio: c.numero, puntaje, ...(falla ? { hallazgo: hallazgos[(i + v) % hallazgos.length], accionCorrectiva: 'Corregir y verificar en la próxima visita' } : {}) };
        });
        await a5s.update({ id: a.id, agenciaId: a.agenciaId, area: a.area, responsableAgencia: 'Líder de agencia', comentarios: `${MARCA} Visita mensual ${v + 1}`, respuestas } as never, admin);
        await a5s.guardar(a.id, admin);
        creadas++;
        // La auditoría y sus acciones llevan la fecha de la visita, no la de hoy; las acciones viejas ya están cerradas o en curso.
        const inicio = new Date(fechaDia(fecha).getTime() + 15 * 3600000);
        await prisma.auditoria5s.update({ where: { id: a.id }, data: { createdAt: inicio, finalizadaEn: new Date(inicio.getTime() + entero(1, 3) * 3600000) } });
        const acc = await prisma.auditoria5sAccion.findMany({ where: { auditoriaId: a.id }, select: { id: true } });
        for (const x of acc) {
          const edad = visitas[v];
          const estado = edad > 40 ? (prob(0.85) ? 'CERRADA' : 'EN_PROCESO') : edad > 20 ? elige(['CERRADA', 'EN_VERIFICACION', 'EN_PROCESO', 'PENDIENTE']) : elige(['PENDIENTE', 'PENDIENTE', 'EN_PROCESO']);
          const compromiso = fechaDia(diaEc(edad - entero(7, 15)));
          await prisma.auditoria5sAccion.update({
            where: { id: x.id },
            data: {
              createdAt: inicio, fechaCompromiso: compromiso, estado,
              ...(estado === 'CERRADA' ? { cerradaEn: new Date(compromiso.getTime() + entero(-3, 4) * DIA), verificadaPorId: admin.id, verificadaPorNombre: `${admin.name} ${admin.lastname}`.trim() } : {}),
            },
          });
          acciones++;
        }
      }
    }
  }
  console.log(`🧽 Auditorías 5S: ${creadas} en ${agencias.length} agencias (3 visitas mensuales) · ${acciones} acciones correctivas.`);
}

// ---------------------------------------------------------------- 6. informes de inspección
async function crearInformes(admin: { id: string; name: string; lastname: string }) {
  if ((await prisma.informeInspeccion.count({ where: { asunto: { startsWith: MARCA } } })) > 0) return console.log('ℹ Los informes de demostración ya existen.');
  const agencias = mezclar(await prisma.agencia.findMany({ where: { estado: 1 }, select: { id: true } })).slice(0, 30);
  const anio = Number(hoyTexto.slice(0, 4));
  const previos = await prisma.informeInspeccion.findMany({ where: { numero: { startsWith: `INF-${anio}-` } }, select: { numero: true } });
  let correlativo = previos.reduce((m, p) => Math.max(m, Number(p.numero.split('-')[2]) || 0), 0);
  const nombreAdmin = `${admin.name} ${admin.lastname}`.trim();
  const titulosNovedad: [string, string][] = [
    ['Manguera con fuga en bahía 2', 'MAQUINARIA'], ['Falta señalización de piso húmedo', 'SEGURIDAD'], ['Desagüe parcialmente tapado', 'INFRAESTRUCTURA'],
    ['Stock bajo de desengrasante', 'INSUMOS'], ['Uniformes incompletos en el turno de la tarde', 'PERSONAL'], ['Área de secado con acumulación de residuos', 'LIMPIEZA'],
  ];
  let total = 0;
  for (const ag of agencias) {
    for (const dias of [entero(75, 85), entero(42, 52), entero(7, 20)]) {
      const fecha = diaEc(dias);
      const periodo = fecha.slice(0, 7);
      const existentes = await prisma.informeInspeccion.count({ where: { agenciaId: ag.id, periodo } });
      const visita = new Date(fechaDia(fecha).getTime() + entero(14, 20) * 3600000);
      const calificacion = elige(['EXCELENTE', 'BUENO', 'BUENO', 'REGULAR', 'MALO'] as const);
      correlativo++;
      const informe = await prisma.informeInspeccion.create({
        data: {
          numero: `INF-${anio}-${String(correlativo).padStart(4, '0')}`, numeroMensual: existentes + 1, periodo, agenciaId: ag.id, inspectorId: admin.id,
          destinatarioNombre: 'Jefe de taller', fecha: fechaDia(fecha), fechaVisita: visita, tipoInspeccion: elige(['RUTINA', 'RUTINA', 'SEGUIMIENTO', 'CIERRE_MENSUAL'] as const),
          estado: 'GUARDADO', asunto: `${MARCA} Visita de inspección ${periodo}`, antecedentes: 'La visita anterior no dejó novedades críticas.',
          desarrollo: 'Se recorrieron las bahías, el área de insumos y la zona de secado.', actividadesGeneral: 'Revisión de bahías y conteo de insumos.',
          calificacion, calificadoPorId: admin.id, calificadoPorNombre: nombreAdmin, calificadoEn: visita, guardadoEn: visita, enviadoEn: visita, createdAt: visita, updatedAt: visita,
        },
      });
      const novedades = mezclar(titulosNovedad).slice(0, entero(0, 3));
      if (novedades.length) {
        await prisma.informeNovedad.createMany({
          data: novedades.map(([titulo, categoria], i) => ({
            informeId: informe.id, titulo, categoria, descripcion: `${titulo}. Se registró durante el recorrido.`, prioridad: elige(['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const),
            estadoSeguimiento: dias > 40 ? 'RESUELTA' : elige(['ABIERTA', 'EN_SEGUIMIENTO', 'RESUELTA'] as const), registradaEn: visita, orden: i,
          })),
        });
        await prisma.informePlanAccion.createMany({
          data: novedades.slice(0, entero(0, novedades.length)).map(([titulo], i) => ({
            informeId: informe.id, agenciaId: ag.id, problema: titulo, accionRequerida: 'Corregir y verificar en la próxima visita', areaResponsable: 'Operación', personaResponsable: 'Líder de agencia',
            fechaCompromiso: fechaDia(diaEc(dias - entero(5, 15))), prioridad: elige(['MEDIA', 'ALTA'] as const),
            estado: dias > 40 ? 'COMPLETADO' : elige(['PENDIENTE', 'EN_PROCESO', 'COMPLETADO'] as const), orden: i,
          })),
        });
      }
      await prisma.informeActividad.createMany({
        data: ['Revisión de bahías', 'Conteo de insumos', 'Inspección de maquinaria'].slice(0, entero(1, 3)).map((nombre, i) => ({
          informeId: informe.id, nombre, responsable: nombreAdmin, fecha: fechaDia(fecha), resultado: 'Sin observaciones relevantes', orden: i,
        })),
      });
      total++;
    }
  }
  console.log(`📋 Informes de inspección: ${total} en ${agencias.length} agencias (3 visitas) con novedades, actividades y planes.`);
}

// ---------------------------------------------------------------- 7. existencias y caché
async function repararExistencias() {
  const negativos = await prisma.stockUbicacion.findMany({
    where: { cantidadActual: { lt: 0 } },
    include: { insumo: { select: { contenidoNeto: true, unidadMedida: { select: { simbolo: true } } } } },
  });
  for (const x of negativos) {
    const neg = Number(x.cantidadActual);
    const c = Number(x.insumo.contenidoNeto);
    const repuesto = Math.abs(neg) + (x.insumo.unidadMedida.simbolo === 'und' ? 10 : c > 1 ? c * 4 : 2000);
    const ubicacionId = x.agenciaId ?? x.pulidorId ?? x.bodegaId;
    if (!ubicacionId) continue;
    await prisma.kardexMovimiento.create({
      data: { insumoId: x.insumoId, ubicacionId, tipoMovimiento: 'AJUSTE_INICIAL', cantidad: repuesto, stockAnterior: neg, stockPosterior: neg + repuesto, referenciaId: 'c90', fecha: new Date() },
    });
    await prisma.stockUbicacion.update({ where: { id: x.id }, data: { cantidadActual: neg + repuesto } });
  }
  console.log(`📦 Existencias negativas repuestas: ${negativos.length}.`);
}

async function limpiarCache() {
  const cache = new CacheService({ get: (k: string) => process.env[k] } as never);
  try {
    if (!cache.usaRedis) {
      await cache.delPrefijo('analytics:');
      return console.log('🧠 Caché en memoria de este proceso limpiada (el backend en marcha tiene la suya).');
    }
    // Redis conecta en segundo plano y sin cola de espera: hay que esperar a que esté listo o el borrado se pierde.
    const limite = Date.now() + 4000;
    while (cache.cliente?.status !== 'ready' && Date.now() < limite) await new Promise((r) => setTimeout(r, 100));
    if (cache.cliente?.status !== 'ready') {
      return console.log('⚠ Redis no responde: los dashboards pueden mostrar datos viejos hasta que venza su caché (reinicia Redis o espera unos minutos).');
    }
    await cache.delPrefijo('analytics:');
    console.log('🧠 Caché de dashboards (Redis) limpiada.');
  } finally {
    await cache.onModuleDestroy();
  }
}

// ---------------------------------------------------------------- main
async function main() {
  if (RESET || SOLO_BORRAR) {
    paso(0, 'Borrado de la demostración anterior');
    await borrarPropio();
    correr('seed-demo-aprobaciones.ts', ['--solo-borrar']);
    correr('seed-demo-dashboards.ts', ['--solo-borrar']);
    correr('seed-demo-tres-meses.ts', ['--solo-borrar']);
    if (SOLO_BORRAR) {
      await repararExistencias();
      await limpiarCache();
      return console.log('\n✅ Demostración borrada.');
    }
  }

  const admin = await prisma.user.findFirst({ where: { role: { namerol: 'SUPER_ADMIN' } }, select: { id: true, name: true, lastname: true } });
  if (!admin) throw new Error('No hay usuario SUPER_ADMIN. Corre primero el seed.');
  const auditor = await prisma.user.findFirst({ where: { role: { namerol: 'ADMIN' } }, include: { role: true, agencia: true, region: true, bodega: true } });
  if (!auditor) throw new Error('No hay usuario ADMIN para firmar las auditorías.');
  const actorAuditor = { ...auditor, nombre: `${auditor.name} ${auditor.lastname}`.trim(), roleDetails: auditor.role };

  paso(1, 'Servicios, precios, costos y consumo de insumos');
  correr('seed-demo-tres-meses.ts');
  paso(2, 'Maquinaria, incidencias, mantenimientos, limpiezas y envíos');
  correr('seed-demo-dashboards.ts', [], { DEMO_DIAS: String(DIAS) });
  paso(3, 'Aprobaciones');
  correr('seed-demo-aprobaciones.ts', [], { DEMO_DIAS: String(DIAS) });
  paso(4, 'Retos');
  await crearRetos(admin);
  paso(5, 'Auditorías 5S');
  await crearAuditorias5s(actorAuditor);
  paso(6, 'Informes de inspección');
  await crearInformes(auditor);
  paso(7, 'Existencias y caché');
  await repararExistencias();
  await limpiarCache();

  console.log('\n✅ Listo: ya puedes revisar todos los dashboards. Para quitar todo: npm run prisma:seed-completo -- --solo-borrar');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.stack ?? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaApp.$disconnect();
    await prisma.$disconnect();
  });
