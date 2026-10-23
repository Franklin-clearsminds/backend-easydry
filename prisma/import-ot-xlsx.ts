/**
 * Carga a la base LOCAL el reporte de OT de un concesionario (xlsx tipo «Datosxlsx.xlsx»).
 *
 * Formato esperado (Hoja1): B2 «CONCESIONARIO:» con el cliente en F2, y desde la fila de encabezados
 * FECHA | OT | PLACA | MARCA | MODELO | COLOR | SERVICIO | TALLER. La fecha es un serial de Excel.
 *
 * Cada fila crea un ServicioLavado FINALIZADO (por defecto) con:
 *  - agencia: la del cliente cuyo nombre termina como el TALLER (sin el prefijo «TJ »), y su primera bahía.
 *  - operador: los lavadores (o pulidores, si no hay) de esa agencia, repartidos en orden (el reporte no trae operador).
 *  - retoque: es el servicio que se agrega a una OT ya finalizada (hasta 2 días después, misma OT, fila nueva); hereda
 *    operador y bahía de la OT original si está en el reporte, y avisa si cae fuera de la ventana.
 *  - OT: el número si la columna lo trae; si trae una etiqueta (Nuevo, PDI, Teojama...) va a observaciones.
 *  - placa: la de la hoja; sin placa real (vacía, «Entregado», «Llegado», «S/P») queda «S/P».
 *  - horaIngreso a las 08:00 (Ecuador) y horaSalida según el tiempo estimado del servicio.
 *
 * Es idempotente: cada fila tiene un clientUuid derivado de su contenido, y las ya cargadas se omiten.
 * Solo corre contra una base en localhost.
 *
 * Uso: npm run prisma:import-ot -- [ruta.xlsx] [--dry-run] [--estado=FINALIZADO|APROBADO]
 */
import { PrismaClient, ServiceStatus } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ESTADO = (args.find((a) => a.startsWith('--estado='))?.split('=')[1] ?? 'FINALIZADO') as ServiceStatus;
const XLSX_PATH = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', '..', 'Datosxlsx.xlsx'));
/** Misma regla que src/modules/operaciones/retoque.ts: el día de la OT y los 2 siguientes. */
const DIAS_VENTANA_RETOQUE = 2;
const IMPORTADOR = 'Importación Excel';

if (!['FINALIZADO', 'APROBADO'].includes(ESTADO)) throw new Error('--estado solo admite FINALIZADO o APROBADO.');
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost).');
}

const prisma = new PrismaClient();

// ---------------------------------------------------------------- lectura del xlsx (sin dependencias)
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function leerHoja(file: string): string[][] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-ot-'));
  try {
    const zip = path.join(dir, 'datos.zip');
    fs.copyFileSync(file, zip);
    const out = path.join(dir, 'x');
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`], { stdio: 'pipe' });
    const sstXml = fs.existsSync(path.join(out, 'xl', 'sharedStrings.xml')) ? fs.readFileSync(path.join(out, 'xl', 'sharedStrings.xml'), 'utf8') : '';
    const sst = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
    const xml = fs.readFileSync(path.join(out, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
    const filas: string[][] = [];
    const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>)/g;
    let m: RegExpExecArray | null;
    while ((m = cellRe.exec(xml))) {
      const col = m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
      const row = Number(m[2]) - 1;
      let inner = '';
      if (m[4] === '>') {
        const close = xml.indexOf('</c>', m.index);
        if (close !== -1) {
          inner = xml.slice(m.index, close);
          cellRe.lastIndex = close + 4;
        }
      }
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (v !== undefined) val = /t="s"/.test(m[3]) ? (sst[Number(v)] ?? '') : decode(v);
      (filas[row] ??= [])[col] = val.trim();
    }
    return Array.from(filas, (f) => f ?? []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- normalización
const normKey = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const celda = (f: string[], i: number) => (f[i] ?? '').trim();
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Serial de Excel -> 08:00 hora de Ecuador (UTC-5, sin horario de verano) = 13:00 UTC. */
const aFechaIngreso = (serial: number) => new Date(EXCEL_EPOCH + serial * 86400000 + 13 * 3600000);
const PLACA_SIN_DATO = new Set(['', 'ENTREGADO', 'LLEGADO', 'S/P', 'SP']);
const uuidDe = (clave: string) => {
  const h = createHash('sha1').update(`import-ot-xlsx:${clave}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

type Fila = { n: number; fecha: number; ot: string; placa: string; marca: string; modelo: string; color: string; servicio: string; taller: string };

async function main() {
  const hoja = leerHoja(XLSX_PATH);
  const concesionario = hoja.find((f) => /^CONCESIONARIO/i.test(celda(f, 1)));
  const clienteNombre = concesionario ? celda(concesionario, 5) : '';
  const iEnc = hoja.findIndex((f) => normKey(celda(f, 1)) === 'FECHA' && normKey(celda(f, 2)) === 'OT');
  if (!clienteNombre || iEnc < 0) throw new Error('No encuentro «CONCESIONARIO:» ni el encabezado FECHA | OT | PLACA... en la hoja.');

  const filas: Fila[] = [];
  const omitidas: string[] = [];
  hoja.slice(iEnc + 1).forEach((f, i) => {
    const n = iEnc + 2 + i;
    if (!f.some((c) => c)) return;
    const fecha = Number(celda(f, 1));
    if (!Number.isFinite(fecha) || fecha < 40000) return omitidas.push(`fila ${n}: «${celda(f, 1)}» no es una fecha`);
    filas.push({ n, fecha, ot: celda(f, 2), placa: celda(f, 3), marca: celda(f, 4), modelo: celda(f, 5), color: celda(f, 6), servicio: celda(f, 7), taller: celda(f, 8) });
  });

  const cliente = await prisma.cliente.findFirst({ where: { nombre: { equals: clienteNombre, mode: 'insensitive' } } });
  if (!cliente) throw new Error(`El cliente «${clienteNombre}» no existe en la base. Carga primero las agencias (npm run prisma:import-agencias).`);

  const agencias = await prisma.agencia.findMany({ where: { clienteId: cliente.id }, include: { bahias: { orderBy: { codigo: 'asc' } } } });
  const lavadores = await prisma.user.findMany({
    where: { estado: 1, role: { namerol: { in: ['LAVADOR', 'PULIDOR'] } }, agenciaId: { in: agencias.map((a) => a.id) } },
    orderBy: { email: 'asc' },
    select: { id: true, agenciaId: true },
  });
  const catalogo = await prisma.catalogoServicio.findMany();
  const precios = await prisma.precioAgenciaServicio.findMany({ where: { agenciaId: { in: agencias.map((a) => a.id) } } });

  // RETOQUE es un servicio del catálogo con esRetoque; si no existe se crea (precio 0, sin tocar nada más).
  const nombresServicio = [...new Set(filas.map((f) => normKey(f.servicio)).filter(Boolean))];
  const faltan = nombresServicio.filter((k) => !catalogo.some((c) => normKey(c.nombre) === k));
  const problemas: string[] = [];
  for (const k of faltan) {
    if (k !== 'RETOQUE') problemas.push(`servicio «${k}» no está en el catálogo`);
    else if (!DRY) {
      const nuevo = await prisma.catalogoServicio.create({
        data: { codigo: 'SER-RETOQUE', nombre: 'RETOQUE', categoria: 'GENERAL', esRetoque: true, precio: 0, tiempoEstimadoMin: 15 },
      });
      catalogo.push(nuevo);
      console.log('➕ Creado el servicio RETOQUE en el catálogo (esRetoque, precio 0).');
    }
  }

  const tallerAgencia = new Map<string, (typeof agencias)[number]>();
  for (const t of new Set(filas.map((f) => f.taller))) {
    const sufijo = normKey(t.replace(/^TJ\s+/i, ''));
    const a = sufijo ? agencias.filter((x) => normKey(x.nombre).endsWith(sufijo)) : [];
    if (a.length === 1) tallerAgencia.set(t, a[0]);
    else problemas.push(`taller «${t}»: ${a.length} agencias coinciden (se esperaba 1)`);
  }
  for (const a of tallerAgencia.values()) {
    if (!a.bahias.length) problemas.push(`la agencia ${a.nombre} no tiene bahías`);
    if (!lavadores.some((l) => l.agenciaId === a.id)) problemas.push(`la agencia ${a.nombre} no tiene lavadores ni pulidores activos`);
  }
  if (problemas.length) throw new Error('No se puede cargar:\n - ' + [...new Set(problemas)].join('\n - '));

  // clientUuid = contenido de la fila + n.º de repetición, para que filas idénticas no choquen y volver a correr no duplique.
  const cargadas = new Map(
    (await prisma.servicioLavado.findMany({ where: { cliente: cliente.nombre }, select: { clientUuid: true, operadorId: true, bahiaId: true } })).map((s) => [s.clientUuid, s]),
  );
  const vistos = new Map<string, number>();
  const turno = new Map<string, number>();
  const registros = [];
  let sinServicio = 0;
  // Los retoques van después: heredan operador y bahía de la OT original (si está en el reporte).
  const esRetoque = (f: Fila) => normKey(f.servicio) === 'RETOQUE';
  type Original = { ot: string; operadorId: string; bahiaId: string; fecha: number };
  const originales = new Map<string, Original>();
  const otsDeAgencia = new Map<string, Original[]>();
  const sinOriginal: string[] = [];
  const fueraDeVentana: string[] = [];
  for (const f of [...filas.filter((x) => !esRetoque(x)), ...filas.filter(esRetoque)]) {
    const agencia = tallerAgencia.get(f.taller);
    const cat = catalogo.find((c) => normKey(c.nombre) === normKey(f.servicio));
    if (!agencia || !cat) {
      sinServicio++;
      omitidas.push(`fila ${f.n}: sin ${agencia ? 'servicio' : 'taller'} (${f.servicio || f.taller || 'vacío'})`);
      continue;
    }
    const base = [f.fecha, f.ot, f.placa, f.marca, f.modelo, f.color, f.servicio, f.taller].join('|');
    const rep = vistos.get(base) ?? 0;
    vistos.set(base, rep + 1);

    const claveOT = /^\d+$/.test(f.ot) ? `${agencia.id}|${f.ot}` : '';
    let original = esRetoque(f) && claveOT ? originales.get(claveOT) : undefined;
    let otAsignada = '';
    if (esRetoque(f) && !original) {
      // Sin su OT original en el reporte: se ata a una OT real de la misma agencia (la más cercana anterior, mejor si cae en la ventana).
      const previas = (otsDeAgencia.get(agencia.id) ?? []).filter((o) => o.fecha <= f.fecha).sort((a, b) => b.fecha - a.fecha);
      original = previas.find((o) => f.fecha - o.fecha <= DIAS_VENTANA_RETOQUE) ?? previas[0];
      if (original) otAsignada = original.ot;
      sinOriginal.push(`fila ${f.n} (OT ${f.ot || 'sin número'}) -> OT ${original?.ot ?? 'ninguna'}`);
    }
    if (original && f.fecha - original.fecha > DIAS_VENTANA_RETOQUE) fueraDeVentana.push(`fila ${f.n} (OT ${original.ot}): ${f.fecha - original.fecha} días después`);
    const delAgencia = lavadores.filter((l) => l.agenciaId === agencia.id);
    const k = turno.get(agencia.id) ?? 0;
    if (!original) turno.set(agencia.id, k + 1);
    // Si la fila ya estaba cargada se respeta su operador y bahía, para que los retoques sigan a su OT aunque la rotación haya cambiado.
    const yaCargada = cargadas.get(uuidDe(`${base}#${rep}`));
    const operadorId = yaCargada?.operadorId ?? original?.operadorId ?? delAgencia[k % delAgencia.length].id;
    const bahiaId = yaCargada?.bahiaId ?? original?.bahiaId ?? agencia.bahias[0].id;
    if (claveOT && !esRetoque(f)) {
      const o = { ot: f.ot, operadorId, bahiaId, fecha: f.fecha };
      if (!originales.has(claveOT)) originales.set(claveOT, o);
      otsDeAgencia.set(agencia.id, [...(otsDeAgencia.get(agencia.id) ?? []), o]);
    }

    const placaUp = f.placa.toUpperCase().replace(/[\s-]+/g, '');
    const sinPlaca = PLACA_SIN_DATO.has(placaUp);
    const esNumeroOT = /^\d+$/.test(f.ot);
    const notas = [
      otAsignada ? `OT ${otAsignada} asignada en la carga (el retoque no traía su OT original${f.ot ? `; hoja: ${f.ot}` : ''})` : '',
      !esNumeroOT && f.ot && !otAsignada ? `Referencia en la hoja: ${f.ot}` : '',
      sinPlaca && f.placa ? `Placa en la hoja: ${f.placa}` : '',
    ].filter(Boolean);
    const ingreso = aFechaIngreso(f.fecha);
    const precio = precios.find((p) => p.agenciaId === agencia.id && p.catalogoServicioId === cat.id)?.precio ?? cat.precio;
    const salida = new Date(ingreso.getTime() + cat.tiempoEstimadoMin * 60000);
    registros.push({
      clientUuid: uuidDe(`${base}#${rep}`),
      ordenTrabajoOT: otAsignada || (esNumeroOT ? f.ot : null),
      placa: sinPlaca ? 'S/P' : placaUp,
      marca: f.marca || null,
      modelo: f.modelo || 'N/D',
      color: f.color || null,
      cliente: cliente.nombre,
      estado: ESTADO,
      bahiaId,
      servicioCatalogoId: cat.id,
      operadorId,
      precio,
      observaciones: notas.join(' · ') || null,
      horaIngreso: ingreso,
      horaInicio: ingreso,
      horaSalida: salida,
      createdAt: ingreso,
      ...(ESTADO === 'APROBADO' ? { aprobadoPor: IMPORTADOR, fechaAprobacion: salida } : {}),
    });
  }

  const existentes = new Set(
    (await prisma.servicioLavado.findMany({ where: { clientUuid: { in: registros.map((r) => r.clientUuid) } }, select: { clientUuid: true } })).map((s) => s.clientUuid),
  );
  const nuevos = registros.filter((r) => !existentes.has(r.clientUuid));

  console.log(`📄 ${path.basename(XLSX_PATH)} · cliente ${cliente.nombre} · ${filas.length} filas con fecha`);
  console.log(`   a cargar: ${nuevos.length} · ya cargadas: ${existentes.size} · omitidas: ${omitidas.length}`);
  if (sinOriginal.length) console.log(`   ℹ ${sinOriginal.length} retoques sin su OT original en el reporte, atados a otra OT de la agencia: ${sinOriginal.join(', ')}`);
  fueraDeVentana.forEach((v) => console.log('   ⚠ retoque fuera de la ventana de 2 días: ' + v));
  omitidas.forEach((o) => console.log('   ⏭ ' + o));
  if (DRY) return console.log('🔎 --dry-run: no se escribió nada.');

  let creadas = 0;
  for (let i = 0; i < nuevos.length; i += 200) {
    const lote = nuevos.slice(i, i + 200);
    creadas += (await prisma.servicioLavado.createMany({ data: lote, skipDuplicates: true })).count;
  }
  // La tabla puente de operadores asignados la usa la app para atribuir el servicio.
  const ids = await prisma.servicioLavado.findMany({ where: { clientUuid: { in: nuevos.map((r) => r.clientUuid) } }, select: { id: true, operadorId: true } });
  await prisma.servicioLavadoOperador.createMany({ data: ids.map((s) => ({ servicioId: s.id, operadorId: s.operadorId })), skipDuplicates: true });
  console.log(`✅ OT creadas: ${creadas} (estado ${ESTADO})`);
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
