/**
 * Carga a la base LOCAL el libro «INFORMACIÓN SISTEMA EASYDRY.xlsx» en este orden:
 *   1. «INSUMOS POR SERVICIO»        insumos (con los ML que trae cada unidad, de su tabla lateral) y la receta de cada servicio.
 *   2. «LISTA DE SERVICIOS Y PRECIOS» servicios del catálogo con su precio base y los precios por cliente (como precio de cada agencia
 *                                     del cliente). Solo quedan ACTIVOS los servicios con precio en el libro: los que no lo tienen y los
 *                                     del catálogo anterior que no están en el libro pasan a Inactivo (conservan su historial). Cada
 *                                     agencia de un cliente con precios recibe los servicios que su cliente tiene con precio. Los
 *                                     servicios de retoque se conservan (y se crean si faltaran).
 *   3. «PERSONAL»                    personas nuevas como LAVADOR, sin agencia y con la contraseña inicial de IMPORT_PASSWORD_INICIAL.
 *
 * Combina, no borra: lo que ya existe se actualiza (por código o por nombre) y lo que falta se crea. A los usuarios que ya existen
 * (mismo nombre) no se les cambia ni la clave ni el rol.
 *
 * Uso: IMPORT_PASSWORD_INICIAL='...' npm run prisma:import-informacion [-- ruta.xlsx] [--dry-run]
 *   --dry-run  muestra lo que haría (conteos, coincidencias y dudas) sin escribir nada.
 * Solo corre contra una base en localhost, salvo que se pase IMPORT_REMOTO=SI (base compartida: revisa antes con --dry-run).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { motivoPasswordDebil } from '../src/common/utils/password-politica.js';
import { asegurarServiciosRetoque } from '../src/common/utils/retoque-catalogo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const XLSX_PATH = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', '..', 'INFORMACIÓN SISTEMA EASYDRY.xlsx'));

if (process.env.IMPORT_REMOTO !== 'SI' && !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost). Para otra base usa IMPORT_REMOTO=SI.');
}

const prisma = new PrismaClient();

// ------------------------------------------------------------------ lectura del xlsx (sin dependencias)
function descomprimir(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-info-'));
  const zip = path.join(dir, 'libro.zip');
  fs.copyFileSync(src, zip);
  const salida = path.join(dir, 'x');
  fs.mkdirSync(salida);
  const q = (s: string) => s.replace(/'/g, "''");
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(salida)}' -Force"`, { stdio: 'pipe' });
  return path.join(salida, 'xl');
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function textosCompartidos(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) out.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decode(x[1])).join(''));
  return out;
}

function colRow(ref: string): { col: number; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/)!;
  return { col: m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1, row: Number(m[2]) - 1 };
}

function leerHoja(xml: string, sst: string[]): string[][] {
  const filas: string[][] = [];
  const re = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const { col, row } = colRow(m[1] + m[2]);
    let inner = '';
    if (m[4] === '>') {
      const cierre = xml.indexOf('</c>', m.index);
      if (cierre !== -1) {
        inner = xml.slice(m.index, cierre);
        re.lastIndex = cierre + 4;
      }
    }
    const v = inner.match(/<v>([\s\S]*?)<\/v>/);
    let valor = '';
    if (v) valor = /t="s"/.test(m[3]) || /t="s"/.test(inner) ? sst[Number(v[1])] ?? '' : v[1];
    // Texto en línea (<is><t>…</t></is>)
    else if (/t="inlineStr"/.test(m[3]) || /t="inlineStr"/.test(inner)) valor = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decode(x[1])).join('');
    (filas[row] ??= [])[col] = String(valor).replace(/\s+/g, ' ').trim();
  }
  const ancho = filas.reduce((mx, r) => Math.max(mx, (r || []).length), 0);
  return Array.from({ length: filas.length }, (_, i) => Array.from({ length: ancho }, (_, c) => filas[i]?.[c] ?? ''));
}

/** Hojas del libro por nombre (sin distinguir mayúsculas ni acentos). */
function hojas(xl: string): Map<string, string[][]> {
  const sst = textosCompartidos(fs.readFileSync(path.join(xl, 'sharedStrings.xml'), 'utf8'));
  const libro = fs.readFileSync(path.join(xl, 'workbook.xml'), 'utf8');
  const rels = fs.readFileSync(path.join(xl, '_rels', 'workbook.xml.rels'), 'utf8');
  const out = new Map<string, string[][]>();
  for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = (m[0].match(/name="([^"]*)"/) || [])[1];
    const rid = (m[0].match(/r:id="([^"]*)"/) || [])[1];
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((x) => x.includes(`Id="${rid}"`));
    const destino = rel && (rel.match(/Target="([^"]*)"/) || [])[1];
    if (!nombre || !destino) continue;
    out.set(clave(decode(nombre)), leerHoja(fs.readFileSync(path.join(xl, destino.replace(/^\/?(xl\/)?/, '')), 'utf8'), sst));
  }
  return out;
}

// ------------------------------------------------------------------ utilidades
const sinAcentos = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Mayúsculas, sin acentos y con espacios simples: sirve para comparar nombres. */
function clave(s: string): string {
  return sinAcentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
}
/** Solo letras y números: compara códigos aunque difieran en espacios o signos. */
const codigoClave = (s: string) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const numero = (v: string) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const slug = (s: string, max = 20) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);
const emailSlug = (s: string, max = 40) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, max);

/** «APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2» → { name, lastname } (misma regla que la importación de agencias). */
function separarNombre(full: string): { name: string; lastname: string } {
  const p = full.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (p.length === 0) return { name: 'Sin', lastname: 'Nombre' };
  if (p.length === 1) return { name: p[0], lastname: p[0] };
  if (p.length === 2) return { lastname: p[0], name: p[1] };
  return { lastname: p.slice(0, 2).join(' '), name: p.slice(2).join(' ') };
}

// ------------------------------------------------------------------ paso 1: insumos y recetas
interface LineaReceta {
  nombre: string;
  sku: string;
  cantidad: number;
  unidad: 'ML' | 'UND';
  nota: string;
}
interface ServicioExcel {
  codigo: string;
  nombre: string;
  categoria: 'GENERAL' | 'ESPECIAL';
  tiempoMin: number;
  receta: LineaReceta[];
  /** Nombre y precios por cliente de la hoja «LISTA DE SERVICIOS Y PRECIOS», si el servicio está en ella. */
  precios: Map<string, number>;
  enRecetas: boolean;
}
interface InsumoExcel {
  sku: string;
  nombre: string;
  unidad: 'ML' | 'UND';
  /** ML que trae cada unidad (envase) del insumo, de la tabla lateral de la hoja. */
  contenido: number;
}

function leerRecetas(filas: string[][]): { servicios: ServicioExcel[]; insumos: Map<string, InsumoExcel> } {
  // Tabla lateral (columnas J–M): producto, código, ML por unidad y, a veces, la marca «unidad».
  const lateral = new Map<string, { nombre: string; ml: number; unidad: boolean }>();
  for (let i = 2; i < filas.length; i++) {
    const [nombre, sku, ml, marca] = [filas[i][9], filas[i][10], filas[i][11], filas[i][12]];
    if (!nombre || !sku || /^PRODUCTO$/i.test(nombre)) continue;
    lateral.set(clave(sku), { nombre, ml: numero(ml), unidad: /unidad/i.test(marca || '') });
  }

  // Duración de los pads: «# AUTOS» que rinde cada uno (consumo por servicio = 1 / autos).
  const autosPorPad = new Map<string, number>();
  const inicioPads = filas.findIndex((r) => /TIEMPO DE DURACI/i.test(r[1] || ''));
  if (inicioPads >= 0) {
    for (let i = inicioPads + 1; i < filas.length; i++) {
      const [nombre, sku, autos] = [filas[i][1], filas[i][2], filas[i][3]];
      if (nombre && sku && numero(autos) > 0) autosPorPad.set(clave(sku), numero(autos));
    }
  }

  const servicios: ServicioExcel[] = [];
  const insumos = new Map<string, InsumoExcel>();
  let actual: ServicioExcel | null = null;
  let seccion: 'GENERAL' | 'ESPECIAL' = 'GENERAL';
  const fin = inicioPads >= 0 ? inicioPads : filas.length;

  for (let i = 2; i < fin; i++) {
    const r = filas[i];
    const [cod, nombreSvc, producto, skuProd, envase, sierra, costa, tiempo, obs] = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]];
    if (/SERI?VICIOS ESPECIALES/i.test(nombreSvc) && !producto) { seccion = 'ESPECIAL'; continue; }
    if (/^SERVICIOS GENERALES$/i.test(nombreSvc) && !producto) { seccion = 'GENERAL'; continue; }

    const filaAnteriorVacia = !filas[i - 1]?.slice(0, 8).some(Boolean);
    // Servicio nuevo: trae código, o es un nombre suelto tras una fila vacía en la sección de especiales.
    if (cod) {
      actual = { codigo: cod, nombre: nombreSvc || cod, categoria: seccion, tiempoMin: numero(tiempo) || 30, receta: [], precios: new Map(), enRecetas: true };
      servicios.push(actual);
    } else if (!cod && nombreSvc && producto && filaAnteriorVacia && seccion === 'ESPECIAL' && !/^\(/.test(nombreSvc)) {
      actual = { codigo: `ESP-${slug(nombreSvc, 24)}`, nombre: nombreSvc, categoria: seccion, tiempoMin: numero(tiempo) || 30, receta: [], precios: new Map(), enRecetas: true };
      servicios.push(actual);
    }
    if (!actual) continue;
    if (!cod && numero(tiempo) > 0 && !producto) actual.tiempoMin = numero(tiempo);
    if (cod && numero(tiempo) > 0) actual.tiempoMin = numero(tiempo);
    if (!producto && !skuProd) continue;

    const sku = skuProd || slug(producto);
    const esPad = /\bPAD |WOOL|HIBRIDA/i.test(producto);
    const lat = lateral.get(clave(sku));
    const esUnidad = esPad || /EN UNIDAD/i.test(obs) || /AEROSOL/i.test(producto) || !!lat?.unidad;
    let cantidad = numero(sierra) || numero(costa);
    if (esPad && cantidad <= 0) cantidad = 1 / (autosPorPad.get(clave(sku)) || 20);
    // Sin cantidad (variantes «SZK» que repiten el producto sin dosis) no es una línea de receta.
    if (cantidad <= 0) continue;
    const unidad: 'ML' | 'UND' = esUnidad ? 'UND' : 'ML';
    actual.receta.push({ nombre: producto || sku, sku, cantidad, unidad, nota: obs });

    const previo = insumos.get(clave(sku));
    const mlEnvase = lat?.ml || numero(envase);
    insumos.set(clave(sku), {
      sku,
      nombre: (producto || previo?.nombre || sku).replace(/\s+/g, ' ').trim(),
      unidad: previo?.unidad === 'UND' || unidad === 'UND' ? 'UND' : 'ML',
      contenido: unidad === 'UND' ? 1 : mlEnvase || previo?.contenido || 1,
    });
  }

  // Líneas repetidas del mismo insumo dentro de un servicio se suman (así lo exige la receta: un insumo por servicio).
  for (const s of servicios) {
    const porSku = new Map<string, LineaReceta>();
    for (const l of s.receta) {
      const k = clave(l.sku);
      const prev = porSku.get(k);
      if (prev) prev.cantidad += l.cantidad;
      else porSku.set(k, { ...l });
    }
    s.receta = [...porSku.values()];
  }
  return { servicios, insumos };
}

// ------------------------------------------------------------------ paso 2: servicios y precios
/** Encabezado de columna de la hoja de precios → clientes de la base (puede ser más de uno). Los que no coinciden se avisan. */
const CLIENTES_POR_COLUMNA: Record<string, string[]> = {
  CASABACA: ['CASABACA'],
  TOYOCOSTA: ['TOYOCOSTA'],
  'CHANGAN YANGSE': ['CHANGAN'],
  'SZK DEL ECUADOR': ['SUZUKI'],
  'TEOJAMA COMERCIAL-MERCEDES BENZ': ['TEOJAMA', 'MERCEDES BENZ'],
  AMBACAR: ['AMBACAR'],
  'IOKARS -IOKORSA': ['IOKARS', 'OIKORSA'],
  FORD: ['ORGU FORD'],
  'ALVAREZ BARBA': ['ALVAREZ BARBA'],
  HIDROBO: ['COMERCIAL HIDROBO'],
  PROAUTO: ['PROAUTO GRANADOS'],
  ISUZU: ['ISUZU'],
  AUTOMEKANO: ['AUTOMEKANO'],
  ASSA: ['ASSA'],
  MAVESA: ['MARESA'],
  MARESA: ['MARESA'],
};

interface FilaPrecio {
  codigo: string;
  articulo: string;
  precios: Map<string, number>;
}

function leerPrecios(filas: string[][]): { clientes: string[]; filas: FilaPrecio[] } {
  const enc = filas[1] ?? [];
  const clientes = enc.slice(3).map((c) => c.replace(/\s+/g, ' ').trim());
  const out: FilaPrecio[] = [];
  for (let i = 2; i < filas.length; i++) {
    const r = filas[i];
    if (!r[0] && !r[2]) continue;
    const precios = new Map<string, number>();
    clientes.forEach((c, k) => {
      const p = numero(r[3 + k]);
      if (c && p > 0) precios.set(c, p);
    });
    out.push({ codigo: r[0], articulo: r[2] || r[0], precios });
  }
  return { clientes, filas: out };
}

/** ¿Es un servicio especial? Los de la hoja de recetas ya traen su sección; los demás se infieren por el nombre. */
const pareceEspecial = (nombre: string) => /CERAM|PULI|MICRO ?PUL|RECUBR|NASIOL|NL272|ZR53|ALISTAMIENTO|ADHESIVO|KIT RAPID|TAPICER|TECHO|HIGIEN|DESCONTAM|DESMONTAJE/i.test(nombre);

const porNombreExcel = (todos: Map<string, ServicioExcel>, nombre: string) => [...todos.values()].some((s) => clave(s.nombre) === clave(nombre));

function moda(valores: number[]): number {
  const cuenta = new Map<number, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

// ------------------------------------------------------------------ paso 3: personal
interface Persona {
  cedula: string;
  nombre: string;
  ciudad: string;
  telefono: string;
  correo: string;
}

function leerPersonal(filas: string[][]): Persona[] {
  const out: Persona[] = [];
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r[1]) continue;
    const digitos = (r[0] || '').replace(/\D/g, '');
    out.push({ cedula: digitos ? digitos.padStart(10, '0') : '', nombre: r[1], ciudad: r[3], telefono: (r[4] || '').replace(/\D/g, ''), correo: (r[5] || '').trim().toLowerCase() });
  }
  return out;
}

const correoValido = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);

// ------------------------------------------------------------------ main
async function main() {
  console.log(`📘 ${path.basename(XLSX_PATH)}${DRY ? '  (simulación: no se escribe nada)' : ''}`);
  const libro = hojas(descomprimir(XLSX_PATH));
  const hRecetas = libro.get('INSUMOS POR SERVICIO');
  const hPrecios = libro.get('LISTA DE SERVICIOS Y PRECIOS');
  const hPersonal = libro.get('PERSONAL');
  if (!hRecetas || !hPrecios || !hPersonal) throw new Error('Faltan hojas: se esperan «INSUMOS POR SERVICIO», «LISTA DE SERVICIOS Y PRECIOS» y «PERSONAL».');

  const { servicios: deRecetas, insumos } = leerRecetas(hRecetas);
  const { clientes: colClientes, filas: filasPrecio } = leerPrecios(hPrecios);
  const personal = leerPersonal(hPersonal);
  console.log(`   recetas: ${deRecetas.length} servicios, ${insumos.size} insumos · precios: ${filasPrecio.length} servicios, ${colClientes.length} clientes · personal: ${personal.length}`);

  // --- unidades y tipos de producto
  const unidades = new Map((await prisma.unidadMedida.findMany()).map((u) => [u.codigo.toUpperCase(), u]));
  const tipos = new Map((await prisma.tipoProducto.findMany()).map((t) => [t.codigo, t]));
  const ML = unidades.get('ML');
  const UND = unidades.get('UND');
  if (!ML || !UND || !tipos.get('LIQUIDO') || !tipos.get('UNIDAD')) throw new Error('Faltan unidades o tipos de producto del seed.');

  // ============ 1. Insumos y recetas
  console.log('\n━━ 1. Insumos y recetas');
  const existentes = await prisma.insumo.findMany({ include: { unidadMedida: true } });
  const insumoPorSku = new Map(existentes.map((i) => [clave(i.codigoSKU), i]));
  const idInsumo = new Map<string, string>();
  let insumosNuevos = 0;
  let insumosConContenido = 0;
  const contenidoCambiado: string[] = [];
  for (const ins of insumos.values()) {
    const ya = insumoPorSku.get(clave(ins.sku));
    if (ya) {
      idInsumo.set(clave(ins.sku), ya.id);
      // Solo se corrige el contenido de los que se miden en ML; la unidad y el resto del insumo no se tocan.
      if (ya.unidadMedida.codigo.toUpperCase() === 'ML' && ins.unidad === 'ML' && ins.contenido > 0 && Number(ya.contenidoNeto) !== ins.contenido) {
        contenidoCambiado.push(`${ya.codigoSKU}: ${Number(ya.contenidoNeto)} → ${ins.contenido} ml`);
        insumosConContenido++;
        if (!DRY) await prisma.insumo.update({ where: { id: ya.id }, data: { contenidoNeto: ins.contenido } });
      }
      continue;
    }
    insumosNuevos++;
    if (DRY) continue;
    const creado = await prisma.insumo.create({
      data: {
        codigoSKU: ins.sku, nombre: ins.nombre, categoria: ins.unidad === 'UND' ? 'CONSUMIBLE' : 'QUIMICOS_LAVADO',
        tipoProductoId: tipos.get(ins.unidad === 'UND' ? 'UNIDAD' : 'LIQUIDO')!.id, unidadMedidaId: (ins.unidad === 'UND' ? UND : ML).id,
        contenidoNeto: ins.contenido, stockActual: 0, stockMinimoBodega: 10, stockMinimoAgencia: ins.unidad === 'UND' ? 1 : 2, estado: 1,
      },
    });
    idInsumo.set(clave(ins.sku), creado.id);
  }
  console.log(`   insumos: ${insumos.size} en el libro · ${insumosNuevos} nuevos · ${insumosConContenido} con ML por unidad corregidos`);
  for (const c of contenidoCambiado) console.log(`     · ${c}`);

  // --- servicios del libro: unión de recetas y lista de precios (por código; si no coincide, por prefijo de código)
  const todos = new Map<string, ServicioExcel>();
  for (const s of deRecetas) todos.set(codigoClave(s.codigo), s);
  const sinReceta: string[] = [];
  for (const f of filasPrecio) {
    const k = codigoClave(f.codigo);
    const destinos = todos.has(k)
      ? [todos.get(k)!]
      : [...todos.entries()].filter(([c]) => c.startsWith(k) && k.length >= 8).map(([, s]) => s);
    if (destinos.length) {
      for (const d of destinos) {
        d.nombre = destinos.length === 1 ? f.articulo || d.nombre : d.nombre;
        for (const [c, p] of f.precios) d.precios.set(c, p);
      }
      continue;
    }
    todos.set(k, { codigo: f.codigo, nombre: f.articulo, categoria: pareceEspecial(f.articulo) ? 'ESPECIAL' : 'GENERAL', tiempoMin: 30, receta: [], precios: f.precios, enRecetas: false });
    sinReceta.push(`${f.codigo} → ${pareceEspecial(f.articulo) ? 'ESPECIAL' : 'GENERAL'}`);
  }
  // Nombres repetidos (variantes por marca o por tamaño): se distinguen con el código para que no se confundan al elegirlos.
  const veces = new Map<string, number>();
  for (const s of todos.values()) veces.set(clave(s.nombre), (veces.get(clave(s.nombre)) ?? 0) + 1);
  for (const s of todos.values()) if ((veces.get(clave(s.nombre)) ?? 0) > 1) s.nombre = `${s.nombre} (${s.codigo.trim()})`;

  // ============ 2. Servicios, recetas y precios
  console.log('\n━━ 2. Servicios, recetas y precios');
  const catalogo = await prisma.catalogoServicio.findMany();
  const porCodigo = new Map(catalogo.map((c) => [clave(c.codigo), c]));
  const porNombre = new Map(catalogo.filter((c) => !c.esRetoque).map((c) => [clave(c.nombre), c]));
  const codigosUsados = new Set(catalogo.map((c) => clave(c.codigo)));

  const clientes = new Map((await prisma.cliente.findMany({ include: { agencias: { select: { id: true } } } })).map((c) => [clave(c.nombre), c]));
  const sinCliente = colClientes.filter((c) => c && !CLIENTES_POR_COLUMNA[c.trim()] && !CLIENTES_POR_COLUMNA[c.trim().replace(/\s+-$/, '')]);

  const idServicio = new Map<ServicioExcel, number>();
  let creados = 0;
  let actualizados = 0;
  let recetasEscritas = 0;
  let preciosAgencia = 0;
  let especialesConPreciosDistintos = 0;
  const lineasSinInsumo: string[] = [];
  for (const s of todos.values()) {
    let fila = porCodigo.get(clave(s.codigo)) ?? porNombre.get(clave(s.nombre)) ?? porNombre.get(clave(s.nombre.replace(/\s*\([^)]*\)\s*$/, '')));
    // Precio base: el más repetido entre clientes; el de cada cliente que difiere se guarda como precio de sus agencias (solo servicios generales).
    const lista = [...s.precios.values()];
    const base = lista.length ? moda(lista) : null;
    const categoria = s.enRecetas || !fila ? s.categoria : (fila.categoria as 'GENERAL' | 'ESPECIAL');
    if (categoria === 'ESPECIAL' && lista.some((p) => p !== base)) especialesConPreciosDistintos++;

    if (!fila) {
      creados++;
      let codigo = s.codigo.trim();
      let n = 2;
      while (codigosUsados.has(clave(codigo))) codigo = `${s.codigo.trim()}-${n++}`;
      codigosUsados.add(clave(codigo));
      if (DRY) continue;
      fila = await prisma.catalogoServicio.create({ data: { codigo, nombre: s.nombre, categoria, tiempoEstimadoMin: s.tiempoMin, precio: base ?? 0, estado: base !== null ? 'Activo' : 'Inactivo' } });
    } else {
      actualizados++;
      if (!DRY) {
        fila = await prisma.catalogoServicio.update({
          where: { id: fila.id },
          data: { nombre: s.nombre, categoria, estado: base !== null ? 'Activo' : 'Inactivo', ...(s.enRecetas ? { tiempoEstimadoMin: s.tiempoMin } : {}), ...(base !== null ? { precio: base } : {}) },
        });
      }
    }
    if (fila) idServicio.set(s, fila.id);
    if (DRY || !fila) continue;

    if (s.enRecetas) {
      await prisma.recetaInsumo.deleteMany({ where: { catalogoServicioId: fila.id } });
      for (const l of s.receta) {
        const insumoId = idInsumo.get(clave(l.sku));
        if (!insumoId) { lineasSinInsumo.push(`${s.codigo}: ${l.nombre}`); continue; }
        await prisma.recetaInsumo.create({
          data: { catalogoServicioId: fila.id, insumoId, cantidadUsada: l.cantidad, unidadConsumoId: (l.unidad === 'UND' ? UND : ML).id, esOpcional: false, observacion: l.nota || null },
        });
        recetasEscritas++;
      }
    }

    if (categoria === 'GENERAL' && base !== null) {
      await prisma.precioAgenciaServicio.deleteMany({ where: { catalogoServicioId: fila.id } });
      const filasPA: Prisma.PrecioAgenciaServicioCreateManyInput[] = [];
      for (const [col, precio] of s.precios) {
        if (precio === base) continue;
        const nombres = CLIENTES_POR_COLUMNA[col.trim()] ?? CLIENTES_POR_COLUMNA[col.trim().replace(/\s+-$/, '')] ?? [];
        for (const n of nombres) for (const ag of clientes.get(clave(n))?.agencias ?? []) filasPA.push({ agenciaId: ag.id, catalogoServicioId: fila.id, precio });
      }
      if (filasPA.length) preciosAgencia += (await prisma.precioAgenciaServicio.createMany({ data: filasPA, skipDuplicates: true })).count;
    }
  }
  console.log(`   servicios: ${todos.size} en el libro · ${creados} nuevos · ${actualizados} actualizados · ${recetasEscritas} líneas de receta · ${preciosAgencia} precios por agencia`);
  if (sinReceta.length) console.log(`   sin receta en el libro (clasificados por su nombre, revísalos): ${sinReceta.join(' · ')}`);
  if (especialesConPreciosDistintos) console.log(`   ${especialesConPreciosDistintos} servicios especiales tienen precios distintos por cliente: el catálogo solo guarda uno (el más repetido).`);
  if (sinCliente.length) console.log(`   columnas de precio sin cliente en la base (no se cargan como precio de agencia): ${sinCliente.join(' · ')}`);
  if (lineasSinInsumo.length) console.log(`   ⚠ líneas de receta sin insumo: ${lineasSinInsumo.join(' · ')}`);

  // Solo están activos los servicios con precio: los del catálogo anterior que no están en el libro (y no son retoque) pasan a Inactivo.
  const idsDelLibro = new Set(idServicio.values());
  const antiguos = catalogo.filter((c) => !c.esRetoque && !idsDelLibro.has(c.id) && !porNombreExcel(todos, c.nombre) && c.estado === 'Activo');
  if (!DRY && antiguos.length) await prisma.catalogoServicio.updateMany({ where: { id: { in: antiguos.map((c) => c.id) } }, data: { estado: 'Inactivo' } });
  console.log(`   catálogo anterior que no está en el libro: ${antiguos.length} servicios pasan a Inactivo (siguen en el historial de sus OT)`);
  const sinPrecio = [...todos.values()].filter((s) => s.precios.size === 0).map((s) => s.codigo.trim());
  console.log(`   sin precio en el libro (quedan Inactivos): ${sinPrecio.join(' · ') || 'ninguno'}`);

  // Cada agencia de un cliente con precios recibe los servicios que ese cliente tiene con precio (los clientes sin columna no se tocan).
  const porColumna = new Map<string, number[]>();
  for (const [s, id] of idServicio) {
    if (s.precios.size === 0) continue;
    for (const col of s.precios.keys()) (porColumna.get(col.trim()) ?? porColumna.set(col.trim(), []).get(col.trim())!).push(id);
  }
  const serviciosDeCliente = new Map<string, Set<number>>();
  for (const [col, ids] of porColumna) {
    const nombres = CLIENTES_POR_COLUMNA[col] ?? CLIENTES_POR_COLUMNA[col.replace(/\s+-$/, '')] ?? [];
    for (const n of nombres) {
      const conjunto = serviciosDeCliente.get(clave(n)) ?? new Set<number>();
      ids.forEach((i) => conjunto.add(i));
      serviciosDeCliente.set(clave(n), conjunto);
    }
  }
  let agenciasAsignadas = 0;
  const categoriaDe = new Map((await prisma.catalogoServicio.findMany({ select: { id: true, categoria: true } })).map((c) => [c.id, c.categoria]));
  for (const [nombreCliente, ids] of serviciosDeCliente) {
    const cliente = clientes.get(nombreCliente);
    if (!cliente || !ids.size) continue;
    agenciasAsignadas += cliente.agencias.length;
    // «Cuenta con servicios especiales» es verdadero solo si el cliente tiene alguno con precio.
    const conEspeciales = [...ids].some((i) => categoriaDe.get(i) === 'ESPECIAL');
    if (!DRY) await prisma.agencia.updateMany({ where: { clienteId: cliente.id }, data: { servicioIds: [...ids].sort((a, b) => a - b), tieneServiciosEspeciales: conEspeciales } });
  }
  console.log(`   agencias con sus servicios asignados según su cliente: ${agenciasAsignadas}`);

  // Retoque: se conserva el que existe y se crea si faltara (y se suma a las agencias).
  if (!DRY) await asegurarServiciosRetoque(prisma);

  // Verificación: cada agencia de un cliente con columna de precios debe tener exactamente esos servicios (más el retoque) y, donde el
  // precio del cliente difiere del base, su precio propio.
  if (!DRY) {
    const idsRetoque = new Set((await prisma.catalogoServicio.findMany({ where: { esRetoque: true }, select: { id: true } })).map((r) => r.id));
    let fallas = 0;
    let revisadas = 0;
    for (const [nombreCliente, esperados] of serviciosDeCliente) {
      const cliente = clientes.get(nombreCliente);
      if (!cliente) continue;
      for (const ag of await prisma.agencia.findMany({ where: { clienteId: cliente.id }, select: { nombre: true, servicioIds: true, preciosServicio: { select: { catalogoServicioId: true, precio: true } } } })) {
        revisadas++;
        const tiene = new Set(((ag.servicioIds as number[] | null) ?? []).map(Number));
        const faltan = [...esperados].filter((i) => !tiene.has(i));
        const sobran = [...tiene].filter((i) => !esperados.has(i) && !idsRetoque.has(i));
        const colsDelCliente = Object.entries(CLIENTES_POR_COLUMNA).filter(([, ns]) => ns.some((n) => clave(n) === nombreCliente)).map(([c]) => c);
        const mal = [...idServicio].filter(([sv, id]) => {
          const col = colsDelCliente.find((c) => [...sv.precios.keys()].some((k) => k.trim() === c || k.trim().replace(/\s+-$/, '') === c));
          if (!col || sv.categoria !== 'GENERAL') return false;
          const precio = [...sv.precios].find(([k]) => k.trim() === col || k.trim().replace(/\s+-$/, '') === col)?.[1];
          const base = moda([...sv.precios.values()]);
          const propio = ag.preciosServicio.find((p) => p.catalogoServicioId === id);
          return precio !== undefined && (precio === base ? !!propio : Number(propio?.precio) !== precio);
        });
        if (faltan.length || sobran.length || mal.length) {
          fallas++;
          console.log(`   ⚠ ${ag.nombre}: faltan ${faltan.length} · sobran ${sobran.length} · precios distintos ${mal.length}`);
        }
      }
    }
    console.log(`   verificación: ${revisadas} agencias revisadas · ${fallas} con diferencias`);
  }
  const retoques = await prisma.catalogoServicio.findMany({ where: { esRetoque: true }, select: { codigo: true, nombre: true, categoria: true } });
  console.log(`   retoque: ${retoques.map((r) => `${r.codigo} (${r.categoria})`).join(', ') || 'no hay'}`);

  // ============ 3. Personal
  console.log('\n━━ 3. Personal (lavadores)');
  const password = process.env.IMPORT_PASSWORD_INICIAL?.trim();
  if (!password) throw new Error('Define IMPORT_PASSWORD_INICIAL con la contraseña inicial del personal.');
  const motivo = motivoPasswordDebil(password);
  if (motivo) throw new Error(`IMPORT_PASSWORD_INICIAL no cumple la política de contraseñas: ${motivo}`);
  const rolLavador = await prisma.role.findUnique({ where: { namerol: 'LAVADOR' } });
  if (!rolLavador) throw new Error('No existe el rol LAVADOR. Corre primero el seed.');
  const hash = await bcrypt.hash(password, 10);

  const usuarios = await prisma.user.findMany({ select: { email: true, name: true, lastname: true } });
  const correos = new Set(usuarios.map((u) => u.email.toLowerCase()));
  const nombresExistentes = new Set(usuarios.map((u) => clave(`${u.lastname} ${u.name}`)));
  let nuevos = 0;
  let yaExistian = 0;
  let conCorreoPropio = 0;
  const repetidosEnLibro = new Set<string>();
  for (const p of personal) {
    const { name, lastname } = separarNombre(p.nombre);
    const llave = clave(`${lastname} ${name}`);
    if (nombresExistentes.has(llave) || repetidosEnLibro.has(llave)) { yaExistian++; continue; }
    repetidosEnLibro.add(llave);
    let email = correoValido(p.correo) && !correos.has(p.correo) ? p.correo : '';
    if (email) conCorreoPropio++;
    if (!email) {
      const base = `${emailSlug(`${name} ${lastname}`) || 'usuario'}.lavador`;
      email = `${base}@easydry.com`;
      let n = 2;
      while (correos.has(email)) email = `${base}.${p.cedula.slice(-4) || n++}@easydry.com`;
    }
    correos.add(email);
    nuevos++;
    if (DRY) continue;
    await prisma.user.create({
      data: { email, name, lastname, roleId: rolLavador.id, passwordHash: hash, estado: 1, telefono: /^09\d{8}$/.test(p.telefono) ? p.telefono : null },
    });
  }
  console.log(`   ${personal.length} personas en el libro · ${nuevos} lavadores nuevos (${conCorreoPropio} con su correo) · ${yaExistian} ya existían y no se tocaron`);
  console.log(DRY ? '\nℹ Simulación terminada: no se escribió nada.' : '\n✅ Carga terminada.');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
