/**
 * Carga a la base LOCAL, en una sola corrida, la información de los 5 Excel que están en la raíz del repositorio:
 *
 *   DATOS AGENCIAS.xlsx                          → clientes (marcas), agencias y bahías. De ahí no se toma nada más.
 *   INFORMACIÓN SISTEMA EASYDRY.xlsx             → insumos con su unidad de medida, servicios, recetas, precios por cliente y el
 *                                                  personal (usuarios).
 *   MAQUINARIAS EASYDRY 2026 ACTUALIZADO.xlsx    → maquinaria de la Costa, con su agencia y bahía.
 *   QUITO LOGISTICA 2026.xlsx                    → maquinaria de la Sierra.
 *   MAQUINARIA SERVICIOS ESPECIALES QUITO 2026.xlsx → pulidoras y rotorbitales de los pulidores, con su fecha de entrega.
 *
 * Reglas (acordadas con el producto):
 *  - Las regiones Sierra y Costa se crean, pero TODAS las agencias quedan en la Sierra por ahora.
 *  - Cada agencia recibe los servicios de su cliente con el precio de ese cliente. Las columnas de precio sin cliente igual en
 *    DATOS AGENCIAS no se cargan (se asignan a mano). Los servicios sin ningún precio quedan Inactivos.
 *  - Todo el personal entra como LAVADOR con su correo y la contraseña de IMPORT_PASSWORD_INICIAL, sin agencia. Las personas de
 *    la hoja «SERVICIOS ESPECIALES» de DATOS AGENCIAS entran como PULIDOR (móvil, en la Sierra).
 *    Correos: el primero de una celda con varios; los de nomina@easydry.com.ec se generan a partir del nombre; un correo repetido
 *    recibe «100» antes del @.
 *  - Maquinaria: se respetan los códigos que traen los Excel; los que no traen reciben «SIN-COD-001…» (el código se corrige
 *    después desde la edición de la máquina). Los lugares que no existen en DATOS AGENCIAS se crean como agencias sin cliente, en la
 *    Sierra. Todas quedan operativas; la fecha de entrega, el año, la factura y las observaciones van en la línea de tiempo.
 *
 * Se puede repetir: lo que ya existe se actualiza o se omite y lo que falta se crea. Termina con un informe de todo lo que revisar.
 *
 * Uso:  IMPORT_PASSWORD_INICIAL='...' npm run prisma:cargar-excels [-- carpeta] [--dry-run]
 *   --dry-run  muestra lo que haría y el informe, sin escribir nada.
 * Solo corre contra una base en localhost (la contraseña inicial se puede poner en el .env).
 */
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { motivoPasswordDebil } from '../src/common/utils/password-politica.js';
import { asegurarServiciosRetoque } from '../src/common/utils/retoque-catalogo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const CARPETA = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(__dirname, '..', '..'));
const ARCHIVOS = {
  agencias: 'DATOS AGENCIAS.xlsx',
  info: 'INFORMACIÓN SISTEMA EASYDRY.xlsx',
  costa: 'MAQUINARIAS EASYDRY 2026 ACTUALIZADO.xlsx',
  quito: 'QUITO LOGISTICA 2026.xlsx',
  especiales: 'MAQUINARIA SERVICIOS ESPECIALES QUITO 2026.xlsx',
} as const;

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost).');
}

const prisma = new PrismaClient();

// ═════════════════════════════════════════════════════════════════ lectura de xlsx (sin dependencias)
function descomprimir(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-xlsx-'));
  const zip = path.join(dir, 'libro.zip');
  fs.copyFileSync(src, zip); // se copia: el original puede estar abierto en Excel
  const salida = path.join(dir, 'x');
  fs.mkdirSync(salida);
  const q = (s: string) => s.replace(/'/g, "''");
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${q(zip)}' -DestinationPath '${q(salida)}' -Force`], { stdio: 'pipe' });
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
    else if (/t="inlineStr"/.test(m[3]) || /t="inlineStr"/.test(inner)) valor = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decode(x[1])).join('');
    (filas[row] ??= [])[col] = String(valor).replace(/\s+/g, ' ').trim();
  }
  const ancho = filas.reduce((mx, r) => Math.max(mx, (r || []).length), 0);
  return Array.from({ length: filas.length }, (_, i) => Array.from({ length: ancho }, (_, c) => filas[i]?.[c] ?? ''));
}

/** Hojas del libro por nombre (sin distinguir mayúsculas ni acentos), en el orden del libro. */
function leerLibro(ruta: string): Map<string, string[][]> {
  if (!fs.existsSync(ruta)) throw new Error(`No encuentro el archivo: ${ruta}`);
  const xl = descomprimir(ruta);
  try {
    const sstPath = path.join(xl, 'sharedStrings.xml');
    const sst = fs.existsSync(sstPath) ? textosCompartidos(fs.readFileSync(sstPath, 'utf8')) : [];
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
  } finally {
    fs.rmSync(path.resolve(xl, '..', '..'), { recursive: true, force: true });
  }
}

function hojaDe(libro: Map<string, string[][]>, nombre: string, archivo: string): string[][] {
  const h = libro.get(clave(nombre));
  if (!h) throw new Error(`Falta la hoja «${nombre}» en ${archivo}.`);
  return h;
}

// ═════════════════════════════════════════════════════════════════ utilidades
const sinAcentos = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Mayúsculas, sin acentos y con espacios simples: sirve para comparar nombres. */
function clave(s: string): string {
  return sinAcentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
}
const codigoClave = (s: string) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const numero = (v: string) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const slug = (s: string, max = 20) => sinAcentos(s).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);
const emailSlug = (s: string, max = 40) => sinAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, max);
const capital = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/** «APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2» → { name, lastname }. */
function separarNombre(full: string): { name: string; lastname: string } {
  const p = full.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (p.length === 0) return { name: 'Sin', lastname: 'Nombre' };
  if (p.length === 1) return { name: p[0], lastname: p[0] };
  if (p.length === 2) return { lastname: p[0], name: p[1] };
  return { lastname: p.slice(0, 2).join(' '), name: p.slice(2).join(' ') };
}

const cedulaNorm = (c: string) => {
  const d = String(c || '').replace(/\D/g, '');
  return d ? d.padStart(10, '0') : '';
};

/** Fecha del Excel: serial numérico o texto d/m/aaaa. ISO (AAAA-MM-DD) o, si no es una fecha, el texto tal cual. */
function fechaExcel(v: string): string | null {
  if (!v) return null;
  if (/^\d{5}$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86400000).toISOString().slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1) return d.toISOString().slice(0, 10);
  }
  return v;
}

/** Informe final: todo lo que el usuario debe revisar. */
const informe = new Map<string, string[]>();
const anotar = (seccion: string, linea: string) => {
  if (!informe.has(seccion)) informe.set(seccion, []);
  informe.get(seccion)!.push(linea);
};
const titulo = (t: string) => console.log(`\n━━ ${t}`);

// ═════════════════════════════════════════════════════════════════ 1. clientes, agencias y bahías
interface AgenciaExcel {
  marca: string;
  nombre: string;
  bahias: number;
}

const PROSPECTO = /^(ORGU FORD|ASSA|IOKARS|OIKORSA)$/i;

function nombreAgencia(marca: string, agencia: string): string {
  const a = agencia.trim();
  const m = marca.trim();
  if (!a) return m;
  if (a.toUpperCase().includes(m.toUpperCase()) || m.toUpperCase().includes(a.toUpperCase())) return a;
  return `${m} ${a}`.replace(/\s+/g, ' ').trim();
}

function leerAgencias(filas: string[][]): AgenciaExcel[] {
  const mapa = new Map<string, AgenciaExcel>();
  let marca = '';
  let agencia = '';
  let bahias = '';
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r.some(Boolean)) continue;
    if (r[0]) marca = r[0];
    // Al cambiar de agencia el número de bahías se reinicia: una agencia sin dato no hereda el de la anterior.
    if (r[1]) { agencia = r[1]; bahias = r[2] || ''; } else if (r[2]) bahias = r[2];
    if (!marca || !agencia) continue;
    const nombre = nombreAgencia(marca, agencia);
    const k = clave(nombre);
    const n = Math.max(0, parseInt(r[2] || bahias, 10) || 0);
    const prev = mapa.get(k);
    if (prev) prev.bahias = Math.max(prev.bahias, n);
    else mapa.set(k, { marca: marca.trim(), nombre, bahias: n });
  }
  // Marcas en prospecto (sin operación todavía) se crean con 2 bahías.
  for (const a of mapa.values()) if (PROSPECTO.test(a.marca) && a.bahias < 1) a.bahias = 2;
  return [...mapa.values()];
}

// ═════════════════════════════════════════════════════════════════ 2. insumos, servicios y precios
interface LineaReceta { nombre: string; sku: string; cantidad: number; unidad: 'ML' | 'UND'; nota: string }
interface ServicioExcel {
  codigo: string;
  nombre: string;
  categoria: 'GENERAL' | 'ESPECIAL';
  tiempoMin: number;
  receta: LineaReceta[];
  precios: Map<string, number>;
  enRecetas: boolean;
}
interface InsumoExcel { sku: string; nombre: string; unidad: 'ML' | 'UND'; contenido: number }

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
    if (cantidad <= 0) continue; // variantes «SZK» que repiten el producto sin dosis
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

  // Líneas repetidas del mismo insumo dentro de un servicio se suman (la receta admite un insumo por servicio).
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

/** Encabezado de columna de la hoja de precios → clientes de DATOS AGENCIAS. Las columnas que no están aquí no se cargan. */
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
const clientesDeColumna = (col: string): string[] => CLIENTES_POR_COLUMNA[col.trim()] ?? CLIENTES_POR_COLUMNA[col.trim().replace(/\s+-$/, '')] ?? [];

interface FilaPrecio { codigo: string; articulo: string; precios: Map<string, number> }

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

const pareceEspecial = (nombre: string) => /CERAM|PULI|MICRO ?PUL|RECUBR|NASIOL|NL272|ZR53|ALISTAMIENTO|ADHESIVO|KIT RAPID|TAPICER|TECHO|HIGIEN|DESCONTAM|DESMONTAJE/i.test(nombre);

function moda(valores: number[]): number {
  const cuenta = new Map<number, number>();
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  return [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

// ═════════════════════════════════════════════════════════════════ 3. personal
interface Persona { cedula: string; nombre: string; ciudad: string; telefono: string; correos: string[] }

const correoValido = (c: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);

function leerPersonal(filas: string[][]): Persona[] {
  const out: Persona[] = [];
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r[1]) continue;
    // Una celda puede traer varios correos separados por «;», «,» o espacios: se conservan todos, en orden.
    const correos = (r[5] || '').split(/[;,\s]+/).map((c) => c.trim().toLowerCase()).filter(Boolean);
    out.push({ cedula: cedulaNorm(r[0]), nombre: r[1], ciudad: r[3], telefono: (r[4] || '').replace(/\D/g, ''), correos });
  }
  return out;
}

const CORREO_GENERICO = 'nomina@easydry.com.ec';

// ═════════════════════════════════════════════════════════════════ 4. maquinaria
const TIPOS_MAQ = new Set(['HIDROLAVADORA', 'ASPIRADORA', 'COMPRESOR', 'PULIDORA', 'ROTORBITAL', 'TALADRO']);
const norm = (s: string) => clave(s);

/** Abreviaturas y variantes de los Excel de maquinaria → nombre de la agencia en DATOS AGENCIAS (normalizado). */
const ALIAS_AGENCIAS: Record<string, string> = {
  'MARESA CJA': 'MARESA CARLOS JULIO',
  'TOYOCOSTA CJA': 'TOYOCOSTA CARLOS JULIO',
  'SUZUKI CJA': 'SUZUKI CARLOS JULIO',
  'TOYOCOSTA VIA DAULE': 'TOYOCOSTA DAULE',
  'MARESA DORADO': 'MARESA EL DORADO',
  'MARESA ORELLANA': 'MARESA FCO DE ORELLANA',
  'MERCEDES JTM': 'MERCEDES BENZ JTM',
  'PEUGEOT DORADO': 'PEUGEOT EL DORADO',
  'TEOJAMA 5TO GUAYAS': 'TEOJAMA COMERCIAL 5TO. GUAYAS',
  'TEOJAMA CUENCA': 'TEOJAMA COMERCIAL CUENCA',
  'TEOJAMA JTM': 'TEOJAMA COMERCIAL JTM',
  'TEOJAMA MANTA': 'TEOJAMA COMERCIAL MANTA',
  'SUZUKI CUMBAYA': 'SUZUKI SZK CUMBAYA',
  'SUZUKI CHILLOS': 'SUZUKI LOS CHILLOS',
  'MARESA CHILLOS': 'MARESA LOS CHILLOS',
  'MARESA M.D.J': 'MARESA MARIANA DE JESUS',
  'MARESA MDJ': 'MARESA MARIANA DE JESUS',
  'MARESA BUGAMBILLA': 'MARESA BUGAMBILLAS',
  'TEOJAMA CALDERON': 'TEOJAMA COMERCIAL CALDERON',
  'TEOJAMA GUAMANI': 'TEOJAMA COMERCIAL GUAMANI',
  'TEOJAMA LABRADOR': 'TEOJAMA COMERCIAL LABRADOR',
  'TEOJAMA AMBATO': 'TEOJAMA COMERCIAL AMBATO',
  'CASABACA CHILLOS': 'CASABACA LOS CHILLOS',
  'CASABACA PANA NORTE': 'CASABACA PANANORTE',
  'AMBACAR QUICENTRO SUR': 'AMBACAR QUITO SUR',
  'HIDROBO IBARRA': 'COMERCIAL HIDROBO TOYOTA IBARRA',
  'CHERRY IBARRA': 'COMERCIAL HIDROBO CHERY',
  'MAZDA IBARRA': 'COMERCIAL HIDROBO MAZDA',
  'NISSAN IBARRA': 'COMERCIAL HIDROBO NISSAN - RENAULT',
  'ALBARES BARBAS': 'ALVAREZ BARBA LABRADOR',
  // Especiales: «C.B SANTO DG.» es Casabaca Santo Domingo y «MATRIZ» es la oficina matriz de las otras hojas.
  'C.B SANTO DG.': 'CASABACA SANTO DOMINGO',
  MATRIZ: 'OFICINA MATRIZ',
};
/** Valores de la columna de agencia que no son un lugar: la máquina se carga sin agencia. */
const NO_ES_LUGAR = new Set(['VARIAS']);
const ALIAS_PULIDORES: Record<string, string> = { 'CRISTIAN GRANDA': 'CHRISTIAN GRANDA' };

interface FilaMaq {
  origen: 'COSTA' | 'QUITO' | 'ESPECIALES';
  agencia: string;
  tipo: string;
  marca: string;
  potencia: string;
  serie: string;
  /** Código que trae el Excel; vacío = se le pone «SIN-COD-…». */
  codigo: string;
  bahia: number | null;
  pulidor?: string;
  extra: Record<string, unknown>;
}

function describirEquipo(texto: string): { tipo: string; marca: string; potencia: string } {
  const d = norm(texto);
  const tipo = /^HIDRO/.test(d) ? 'HIDROLAVADORA' : /^ASPIR/.test(d) ? 'ASPIRADORA' : /^COMPRES/.test(d) ? 'COMPRESOR' : '';
  const marca = /POWER CLEAN/.test(d) ? 'POWER CLEAN' : /PORT\w*N\b/.test(d) ? 'PORTEN' : /EOLO/.test(d) ? 'EOLO' : /THYSON|THISON/.test(d) ? 'THYSON' : /\bIPC\b/.test(d) ? 'IPC' : '';
  const hp = /(\d+)\s*HP/.exec(d)?.[1];
  const lt = /(\d+)\s*L\.?\s*T/.exec(d)?.[1];
  return { tipo, marca, potencia: hp ? `${hp}HP` : lt ? `${lt} L.T` : '' };
}

function filasCosta(h: string[][]): FilaMaq[] {
  return h
    .slice(2)
    .map((c) => ({
      origen: 'COSTA' as const,
      agencia: norm(c[0] ?? ''),
      tipo: norm(c[1] ?? ''),
      marca: (c[2] ?? '').trim(),
      potencia: (c[3] ?? '').trim(),
      serie: (c[4] ?? '').trim(),
      codigo: (c[5] ?? '').trim().toUpperCase(),
      bahia: /(\d+)/.exec(c[6] ?? '') ? Number(/(\d+)/.exec(c[6])![1]) : null,
      extra: {},
    }))
    .filter((f) => f.agencia && f.tipo);
}

function filasQuito(h: string[][]): FilaMaq[] {
  return h
    .slice(1)
    .filter((c) => c[1])
    .map((c) => {
      const equipo = describirEquipo(c[1]);
      return {
        origen: 'QUITO' as const,
        agencia: norm(c[0] ?? ''),
        ...equipo,
        serie: (c[2] ?? '').trim(),
        // «CODI EASY» es el único código de verdad; la columna de serie solo es serie.
        codigo: norm(c[3] ?? '').replace(/\s/g, ''),
        bahia: null,
        extra: { descripcionExcel: c[1], fechaCompra: fechaExcel(c[4] ?? ''), factura: c[5] || null, transferencia: c[6] || null, nota: c[7] || null },
      };
    });
}

function filasEspeciales(h: string[][]): FilaMaq[] {
  return h
    .slice(1)
    .filter((c) => c[1])
    .map((c) => ({
      origen: 'ESPECIALES' as const,
      agencia: norm(c[6] ?? ''),
      tipo: norm(c[1]),
      marca: (c[2] ?? '').trim(),
      potencia: '',
      serie: (c[3] ?? '').trim(),
      codigo: '',
      bahia: null,
      pulidor: norm(c[0] ?? ''),
      extra: { pulidorExcel: c[0] || null, anio: c[4] || null, factura: c[5] || null, fechaEntrega: fechaExcel(c[7] ?? ''), observaciones: c[8] || null },
    }));
}

// ═════════════════════════════════════════════════════════════════ main
interface AgenciaCtx {
  id: string | null;
  codigo: string;
  nombre: string;
  /** Número de bahía → id de la bahía (null en simulación). */
  bahias: Map<number, string | null>;
  creada: boolean;
}

async function main() {
  console.log(`📘 Carga de Excel desde ${CARPETA}${DRY ? '  (simulación: no se escribe nada)' : ''}`);
  const password = process.env.IMPORT_PASSWORD_INICIAL?.trim();
  if (!password) throw new Error('Define IMPORT_PASSWORD_INICIAL con la contraseña inicial del personal (puede ir en el .env).');
  const motivoClave = motivoPasswordDebil(password);
  if (motivoClave) throw new Error(`IMPORT_PASSWORD_INICIAL no cumple la política de contraseñas: ${motivoClave}`);

  const ruta = (k: keyof typeof ARCHIVOS) => path.join(CARPETA, ARCHIVOS[k]);
  const libroAgencias = leerLibro(ruta('agencias'));
  const libroInfo = leerLibro(ruta('info'));
  const hLavados = hojaDe(libroAgencias, 'SERVICIO LAVADOS', ARCHIVOS.agencias);
  const hEspeciales = hojaDe(libroAgencias, 'SERVICIOS ESPECIALES', ARCHIVOS.agencias);
  const hRecetas = hojaDe(libroInfo, 'INSUMOS POR SERVICIO', ARCHIVOS.info);
  const hPrecios = hojaDe(libroInfo, 'LISTA DE SERVICIOS Y PRECIOS', ARCHIVOS.info);
  const hPersonal = hojaDe(libroInfo, 'PERSONAL', ARCHIVOS.info);
  const primera = (k: 'costa' | 'quito' | 'especiales') => [...leerLibro(ruta(k)).values()][0];
  const maqCosta = filasCosta(primera('costa'));
  const maqQuito = filasQuito(primera('quito'));
  const maqEspeciales = filasEspeciales(primera('especiales'));

  const agenciasExcel = leerAgencias(hLavados);
  const marcas = [...new Set(agenciasExcel.map((a) => a.marca))];
  const { servicios: deRecetas, insumos } = leerRecetas(hRecetas);
  const { clientes: colClientes, filas: filasPrecio } = leerPrecios(hPrecios);
  const personal = leerPersonal(hPersonal);
  console.log(`   agencias: ${agenciasExcel.length} (${marcas.length} clientes) · servicios con receta: ${deRecetas.length} · insumos: ${insumos.size} · precios: ${filasPrecio.length} servicios, ${colClientes.filter(Boolean).length} columnas · personal: ${personal.length}`);
  console.log(`   maquinaria: ${maqCosta.length} Costa + ${maqQuito.length} Sierra + ${maqEspeciales.length} especiales`);

  // ───────────────────────── base de la BD (la crea el seed)
  const unidades = new Map((await prisma.unidadMedida.findMany()).map((u) => [u.codigo.toUpperCase(), u]));
  const tipos = new Map((await prisma.tipoProducto.findMany()).map((t) => [t.codigo, t]));
  const ML = unidades.get('ML');
  const UND = unidades.get('UND');
  if (!ML || !UND || !tipos.get('LIQUIDO') || !tipos.get('UNIDAD')) throw new Error('Faltan las unidades o los tipos de producto: corre primero el seed.');
  const rolLavador = await prisma.role.findUnique({ where: { namerol: 'LAVADOR' } });
  const rolPulidor = await prisma.role.findUnique({ where: { namerol: 'PULIDOR' } });
  if (!rolLavador || !rolPulidor) throw new Error('No existen los roles LAVADOR y PULIDOR: corre primero el seed.');

  // ============ 1. Regiones, clientes, agencias y bahías
  titulo('1. Regiones, clientes, agencias y bahías');
  const regionIds = new Map<string, string>();
  for (const [nombre, codigo] of [['Sierra', 'REG-SIERRA'], ['Costa', 'REG-COSTA']] as const) {
    if (DRY) {
      const ya = await prisma.region.findUnique({ where: { nombre } });
      regionIds.set(nombre, ya?.id ?? `simulado-${nombre}`);
      continue;
    }
    const r = await prisma.region.upsert({ where: { nombre }, create: { codigo, nombre, descripcion: `Región ${nombre}`, estado: 1 }, update: { codigo, estado: 1 } });
    regionIds.set(nombre, r.id);
  }
  const regionSierra = regionIds.get('Sierra')!;

  const clienteIds = new Map<string, string>();
  for (const nombre of marcas) {
    if (DRY) {
      clienteIds.set(clave(nombre), (await prisma.cliente.findUnique({ where: { nombre } }))?.id ?? `simulado-${nombre}`);
      continue;
    }
    const c = await prisma.cliente.upsert({ where: { nombre }, create: { nombre, estado: 1 }, update: { estado: 1 } });
    clienteIds.set(clave(nombre), c.id);
  }

  const existentes = await prisma.agencia.findMany({ select: { id: true, codigo: true, nombre: true, bahias: { select: { id: true, nombre: true, codigo: true } } } });
  const codigosUsados = new Set(existentes.map((a) => a.codigo));
  const agencias = new Map<string, AgenciaCtx>();
  for (const a of existentes) {
    const bahias = new Map<number, string | null>();
    for (const b of a.bahias) {
      const n = Number(/(\d+)/.exec(b.nombre)?.[1] ?? /-B(\d+)$/.exec(b.codigo)?.[1]);
      if (n) bahias.set(n, b.id);
    }
    agencias.set(clave(a.nombre), { id: a.id, codigo: a.codigo, nombre: a.nombre, bahias, creada: false });
  }
  const codigoAgencia = (nombre: string) => {
    let code = `AGN-${slug(nombre, 20)}`;
    let n = 2;
    while (codigosUsados.has(code)) code = `AGN-${slug(nombre, 16)}-${n++}`;
    codigosUsados.add(code);
    return code;
  };

  /** Garantiza que la agencia tenga las bahías 1..n. */
  const asegurarBahias = async (ag: AgenciaCtx, hasta: number) => {
    for (let n = 1; n <= hasta; n++) {
      if (ag.bahias.has(n)) continue;
      const numStr = String(n).padStart(2, '0');
      if (DRY || !ag.id) { ag.bahias.set(n, null); continue; }
      const b = await prisma.bahia.upsert({
        where: { codigo: `${ag.codigo}-B${numStr}` },
        create: { codigo: `${ag.codigo}-B${numStr}`, nombre: `Bahía ${numStr}`, agenciaId: ag.id, activa: true },
        update: { nombre: `Bahía ${numStr}`, agenciaId: ag.id, activa: true },
      });
      ag.bahias.set(n, b.id);
    }
  };

  let agenciasNuevas = 0;
  for (const a of agenciasExcel) {
    const numeroBahias = Math.max(a.bahias, 1);
    const clienteId = clienteIds.get(clave(a.marca)) ?? null;
    let ag = agencias.get(clave(a.nombre));
    if (!ag) {
      const codigo = codigoAgencia(a.nombre);
      let id: string | null = null;
      if (!DRY) {
        id = (await prisma.agencia.create({
          data: { codigo, nombre: a.nombre, region: 'Sierra', regionId: regionSierra, clienteId, numeroBahias, maxLavadoresPorBahia: 1, estado: 1, tieneServiciosEspeciales: false },
        })).id;
      }
      ag = { id, codigo, nombre: a.nombre, bahias: new Map(), creada: true };
      agencias.set(clave(a.nombre), ag);
      agenciasNuevas++;
    } else if (!DRY && ag.id) {
      await prisma.agencia.update({ where: { id: ag.id }, data: { region: 'Sierra', regionId: regionSierra, clienteId, numeroBahias, estado: 1 } });
    }
    await asegurarBahias(ag, numeroBahias);
  }
  console.log(`   regiones: Sierra y Costa · clientes: ${marcas.length} · agencias: ${agenciasExcel.length} (${agenciasNuevas} nuevas, todas en la Sierra) · bahías: ${agenciasExcel.reduce((s, a) => s + Math.max(a.bahias, 1), 0)}`);
  const sinBahias = agenciasExcel.filter((a) => a.bahias < 1 && !PROSPECTO.test(a.marca)).map((a) => a.nombre);
  if (sinBahias.length) anotar('Agencias sin número de bahías en el Excel (se les creó 1)', sinBahias.join(' · '));

  // ============ 2. Insumos, servicios, recetas y precios
  titulo('2. Insumos, servicios, recetas y precios');
  const existentesIns = await prisma.insumo.findMany({ include: { unidadMedida: true } });
  const insumoPorSku = new Map(existentesIns.map((i) => [clave(i.codigoSKU), i]));
  const idInsumo = new Map<string, string>();
  let insumosNuevos = 0;
  for (const ins of insumos.values()) {
    const ya = insumoPorSku.get(clave(ins.sku));
    if (ya) {
      idInsumo.set(clave(ins.sku), ya.id);
      if (!DRY && ya.unidadMedida.codigo.toUpperCase() === 'ML' && ins.unidad === 'ML' && ins.contenido > 0 && Number(ya.contenidoNeto) !== ins.contenido) {
        await prisma.insumo.update({ where: { id: ya.id }, data: { contenidoNeto: ins.contenido } });
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
  console.log(`   insumos: ${insumos.size} en el libro · ${insumosNuevos} nuevos`);

  // Servicios: unión de recetas y lista de precios (por código; si no coincide, por prefijo de código).
  const todos = new Map<string, ServicioExcel>();
  for (const s of deRecetas) todos.set(codigoClave(s.codigo), s);
  const sinReceta: string[] = [];
  for (const f of filasPrecio) {
    const k = codigoClave(f.codigo);
    const destinos = todos.has(k) ? [todos.get(k)!] : [...todos.entries()].filter(([c]) => c.startsWith(k) && k.length >= 8).map(([, s]) => s);
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
  const veces = new Map<string, number>();
  for (const s of todos.values()) veces.set(clave(s.nombre), (veces.get(clave(s.nombre)) ?? 0) + 1);
  for (const s of todos.values()) if ((veces.get(clave(s.nombre)) ?? 0) > 1) s.nombre = `${s.nombre} (${s.codigo.trim()})`;

  const catalogo = await prisma.catalogoServicio.findMany();
  const porCodigo = new Map(catalogo.map((c) => [clave(c.codigo), c]));
  const porNombre = new Map(catalogo.filter((c) => !c.esRetoque).map((c) => [clave(c.nombre), c]));
  const codigosSvc = new Set(catalogo.map((c) => clave(c.codigo)));
  const clientesBd = new Map((await prisma.cliente.findMany({ include: { agencias: { select: { id: true } } } })).map((c) => [clave(c.nombre), c]));

  const idServicio = new Map<ServicioExcel, number>();
  let creados = 0;
  let actualizados = 0;
  let lineasReceta = 0;
  let preciosAgencia = 0;
  const lineasSinInsumo: string[] = [];
  for (const s of todos.values()) {
    let fila = porCodigo.get(clave(s.codigo)) ?? porNombre.get(clave(s.nombre)) ?? porNombre.get(clave(s.nombre.replace(/\s*\([^)]*\)\s*$/, '')));
    const lista = [...s.precios.values()];
    const base = lista.length ? moda(lista) : null;
    const categoria = s.enRecetas || !fila ? s.categoria : (fila.categoria as 'GENERAL' | 'ESPECIAL');
    if (!fila) {
      creados++;
      let codigo = s.codigo.trim();
      let n = 2;
      while (codigosSvc.has(clave(codigo))) codigo = `${s.codigo.trim()}-${n++}`;
      codigosSvc.add(clave(codigo));
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
        lineasReceta++;
      }
    }
    // Precio de cada cliente que difiere del base: es el precio de sus agencias (solo servicios generales).
    if (categoria === 'GENERAL' && base !== null) {
      await prisma.precioAgenciaServicio.deleteMany({ where: { catalogoServicioId: fila.id } });
      const filasPA: Prisma.PrecioAgenciaServicioCreateManyInput[] = [];
      for (const [col, precio] of s.precios) {
        if (precio === base) continue;
        for (const n of clientesDeColumna(col)) for (const ag of clientesBd.get(clave(n))?.agencias ?? []) filasPA.push({ agenciaId: ag.id, catalogoServicioId: fila.id, precio });
      }
      if (filasPA.length) preciosAgencia += (await prisma.precioAgenciaServicio.createMany({ data: filasPA, skipDuplicates: true })).count;
    }
  }
  console.log(`   servicios: ${todos.size} · ${creados} nuevos · ${actualizados} actualizados · ${lineasReceta} líneas de receta · ${preciosAgencia} precios por agencia`);
  if (sinReceta.length) anotar('Servicios sin receta en el libro (clasificados por su nombre)', sinReceta.join(' · '));
  if (lineasSinInsumo.length) anotar('Líneas de receta sin insumo', lineasSinInsumo.join(' · '));
  const sinPrecio = [...todos.values()].filter((s) => s.precios.size === 0).map((s) => `${s.codigo.trim()} (${s.nombre})`);
  if (sinPrecio.length) anotar('Servicios sin precio en ninguna columna (quedan Inactivos)', sinPrecio.join(' · '));
  const sinCliente = colClientes.filter((c) => c && clientesDeColumna(c).length === 0);
  if (sinCliente.length) anotar('Columnas de precio sin cliente igual en DATOS AGENCIAS (no se cargaron: asígnalas a mano)', sinCliente.join(' · '));
  const sinColumna = marcas.filter((m) => !Object.values(CLIENTES_POR_COLUMNA).some((ns) => ns.some((n) => clave(n) === clave(m))));
  if (sinColumna.length) anotar('Clientes sin columna de precios (sus agencias quedan sin servicios)', sinColumna.join(' · '));

  // Cada agencia de un cliente con precios recibe los servicios que su cliente tiene con precio.
  const serviciosDeCliente = new Map<string, Set<number>>();
  for (const [s, id] of idServicio) {
    for (const col of s.precios.keys()) {
      for (const n of clientesDeColumna(col)) {
        const conjunto = serviciosDeCliente.get(clave(n)) ?? new Set<number>();
        conjunto.add(id);
        serviciosDeCliente.set(clave(n), conjunto);
      }
    }
  }
  const categoriaDe = new Map((await prisma.catalogoServicio.findMany({ select: { id: true, categoria: true, nombre: true } })).map((c) => [c.id, c]));
  let agenciasConServicios = 0;
  for (const [nombreCliente, ids] of serviciosDeCliente) {
    const cliente = clientesBd.get(nombreCliente);
    if (!cliente || !ids.size) continue;
    agenciasConServicios += cliente.agencias.length;
    const lista = [...ids].sort((a, b) => a - b);
    if (!DRY) {
      await prisma.agencia.updateMany({
        where: { clienteId: cliente.id },
        data: {
          servicioIds: lista,
          serviciosNombres: lista.map((i) => categoriaDe.get(i)?.nombre ?? ''),
          tieneServiciosEspeciales: lista.some((i) => categoriaDe.get(i)?.categoria === 'ESPECIAL'),
        },
      });
    }
  }
  console.log(`   agencias con los servicios de su cliente: ${agenciasConServicios}`);
  const idsEspeciales = [...idServicio.entries()].filter(([, id]) => categoriaDe.get(id)?.categoria === 'ESPECIAL').map(([, id]) => id).sort((a, b) => a - b);

  // ============ 3. Personal
  titulo('3. Personal');
  const hash = await bcrypt.hash(password, 10);
  const cedulasPulidor = new Map<string, string>();
  for (let i = 1; i < hEspeciales.length; i++) {
    const c = cedulaNorm(hEspeciales[i][1]);
    if (c) cedulasPulidor.set(c, hEspeciales[i][0]);
  }
  const usuariosBd = await prisma.user.findMany({ select: { email: true } });
  const correosUsados = new Set(usuariosBd.map((u) => u.email.toLowerCase()));
  const pulidoresPlan: { id: string | null; palabras: string[]; nombre: string }[] = [];
  let lavadores = 0;
  let pulidores = 0;
  let yaExistian = 0;
  const pulidoresEncontrados = new Set<string>();
  const correosAjustados: string[] = [];

  /** Correo único para la persona: el primero de la celda; si es el genérico de nómina o ya lo usa otra persona, se ajusta. */
  const correoPara = (p: Persona): string => {
    const { name, lastname } = separarNombre(p.nombre);
    const generado = () => {
      const base = `${emailSlug(name.split(' ')[0])}.${emailSlug(lastname.split(' ')[0])}`;
      let email = `${base}@easydry.com.ec`;
      let n = 2;
      while (correosUsados.has(email)) email = `${base}${n++}@easydry.com.ec`;
      return email;
    };
    const propio = p.correos.find((c) => correoValido(c) && c !== CORREO_GENERICO);
    let email: string;
    if (!propio) {
      email = generado();
      correosAjustados.push(`${p.nombre}: ${p.correos.join(' / ') || '(sin correo)'} → ${email}`);
    } else {
      email = propio;
      if (correosUsados.has(email)) {
        const [local, dominio] = email.split('@');
        let n = 100;
        let nuevo = `${local}${n}@${dominio}`;
        while (correosUsados.has(nuevo)) nuevo = `${local}${++n}@${dominio}`;
        correosAjustados.push(`${p.nombre}: ${email} (repetido) → ${nuevo}`);
        email = nuevo;
      } else if (p.correos.length > 1) {
        correosAjustados.push(`${p.nombre}: la celda traía ${p.correos.join(' ; ')} → se usó ${email}`);
      }
    }
    correosUsados.add(email);
    return email;
  };

  for (const p of personal) {
    const esPulidor = !!p.cedula && cedulasPulidor.has(p.cedula);
    const { name, lastname } = separarNombre(p.nombre);
    if (esPulidor) pulidoresEncontrados.add(p.cedula);
    const yaPorNombre = await prisma.user.findFirst({ where: { name, lastname }, select: { id: true } });
    if (yaPorNombre) {
      yaExistian++;
      if (esPulidor) pulidoresPlan.push({ id: yaPorNombre.id, nombre: p.nombre, palabras: sinAcentos(`${name} ${lastname}`).toUpperCase().split(' ') });
      continue;
    }
    const email = correoPara(p);
    let id: string | null = null;
    if (!DRY) {
      id = (await prisma.user.create({
        data: {
          email, name, lastname,
          roleId: esPulidor ? rolPulidor.id : rolLavador.id,
          passwordHash: hash, estado: 1,
          telefono: /^09\d{8}$/.test(p.telefono) ? p.telefono : null,
          ...(esPulidor ? { regionId: regionSierra, servicioIds: idsEspeciales as unknown as Prisma.InputJsonValue } : {}),
        },
      })).id;
    }
    if (esPulidor) { pulidores++; pulidoresPlan.push({ id, nombre: p.nombre, palabras: sinAcentos(`${name} ${lastname}`).toUpperCase().split(' ') }); }
    else lavadores++;
  }
  console.log(`   ${personal.length} personas · ${lavadores} lavadores nuevos · ${pulidores} pulidores nuevos · ${yaExistian} ya existían`);
  if (correosAjustados.length) anotar('Correos generados o ajustados', correosAjustados.join('\n     '));
  const pulidoresSinPersonal = [...cedulasPulidor].filter(([c]) => !pulidoresEncontrados.has(c)).map(([c, n]) => `${n} (${c})`);
  if (pulidoresSinPersonal.length) anotar('Pulidores de «SERVICIOS ESPECIALES» que no están en PERSONAL (no se crearon: sin correo)', pulidoresSinPersonal.join(' · '));

  // ============ 4. Maquinaria
  titulo('4. Maquinaria');
  const maquinasBd = await prisma.maquinaria.findMany({ select: { codigo: true, tipo: true, serie: true, nombre: true, agenciaId: true } });
  const codigosMaq = new Set(maquinasBd.map((m) => m.codigo));
  let siguienteSinCodigo = Math.max(0, ...maquinasBd.map((m) => Number(/^SIN-COD-(\d+)$/.exec(m.codigo)?.[1] ?? 0))) + 1;
  // Máquinas ya cargadas (para poder repetir el script): se descuenta una por cada una de la misma clase que ya está.
  const yaCargadas = new Map<string, number>();
  const llaveMaq = (tipo: string, serie: string, agenciaId: string | null, nombre: string) => `${tipo}|${serie}|${agenciaId ?? ''}|${nombre}`;
  for (const m of maquinasBd) yaCargadas.set(llaveMaq(m.tipo, m.serie ?? '', m.agenciaId, m.nombre), (yaCargadas.get(llaveMaq(m.tipo, m.serie ?? '', m.agenciaId, m.nombre)) ?? 0) + 1);

  const buscarPulidor = (nombre: string): { id: string | null } | null => {
    const palabras = (ALIAS_PULIDORES[nombre] ?? nombre).split(' ');
    const calzan = pulidoresPlan.filter((p) => palabras.every((w) => p.palabras.some((pw) => pw === w || (w.length >= 4 && pw.startsWith(w)))));
    return calzan.length === 1 ? { id: calzan[0].id } : null;
  };

  const todas = [...maqCosta, ...maqQuito, ...maqEspeciales];
  const raros = todas.filter((f) => !TIPOS_MAQ.has(f.tipo));
  if (raros.length) throw new Error(`Tipo de equipo desconocido: ${raros.map((f) => `${f.codigo || f.serie || f.agencia} (${f.tipo || 'vacío'})`).join(', ')}`);

  const agenciasNuevasPorMaquina = new Set<string>();
  const resolverAgencia = async (nombreExcel: string, bahiaNecesaria: number): Promise<AgenciaCtx | null> => {
    if (!nombreExcel || NO_ES_LUGAR.has(nombreExcel)) return null;
    const nombreFinal = ALIAS_AGENCIAS[nombreExcel] ?? nombreExcel;
    const k = clave(nombreFinal);
    let ag = agencias.get(k);
    if (!ag) {
      // No existe en DATOS AGENCIAS: se crea como agencia nueva, sin cliente y en la Sierra.
      const codigo = codigoAgencia(nombreExcel);
      let id: string | null = null;
      if (!DRY) id = (await prisma.agencia.create({ data: { codigo, nombre: nombreFinal, region: 'Sierra', regionId: regionSierra, clienteId: null, numeroBahias: Math.max(1, bahiaNecesaria), maxLavadoresPorBahia: 1, estado: 1, tieneServiciosEspeciales: false } })).id;
      ag = { id, codigo, nombre: nombreFinal, bahias: new Map(), creada: true };
      agencias.set(k, ag);
      agenciasNuevasPorMaquina.add(nombreFinal);
      await asegurarBahias(ag, Math.max(1, bahiaNecesaria));
    }
    return ag;
  };

  let creadas = 0;
  let yaEstaban = 0;
  let bahiasAgregadas = 0;
  const codigosInventados: string[] = [];
  const codigosChocan: string[] = [];
  const sinPulidor: string[] = [];
  const sinAgencia: string[] = [];
  const nombreMaq = (f: FilaMaq) => [capital(f.tipo), f.marca, f.potencia].filter(Boolean).join(' ');

  for (const f of todas) {
    const ag = await resolverAgencia(f.agencia, f.bahia ?? 1);
    const nombre = nombreMaq(f);
    if (!ag) sinAgencia.push(`${f.codigo || f.serie || nombre}: ${nombre} (agencia en el Excel: ${f.agencia || 'vacía'})`);
    const clavePrevia = llaveMaq(f.tipo, f.serie, ag?.id ?? null, nombre);
    if ((yaCargadas.get(clavePrevia) ?? 0) > 0) {
      yaCargadas.set(clavePrevia, yaCargadas.get(clavePrevia)! - 1);
      yaEstaban++;
      continue;
    }

    // Código: el que trae el Excel; si falta, o ya lo usa otra máquina, «SIN-COD-…» (se corrige después desde la edición).
    let codigo = f.codigo;
    if (codigo && codigosMaq.has(codigo)) {
      codigosChocan.push(`${codigo} (${f.agencia}: ${nombre}) ya lo usa otra máquina`);
      codigo = '';
    }
    if (!codigo) {
      codigo = `SIN-COD-${String(siguienteSinCodigo++).padStart(3, '0')}`;
      codigosInventados.push(`${codigo} — ${f.agencia || '(sin agencia)'}: ${nombre}${f.serie ? ` · serie ${f.serie}` : ''}`);
    }
    codigosMaq.add(codigo);

    let bahiaId: string | null = null;
    if (ag && f.bahia) {
      if (!ag.bahias.has(f.bahia)) { await asegurarBahias(ag, f.bahia); bahiasAgregadas++; if (!DRY && ag.id) await prisma.agencia.update({ where: { id: ag.id }, data: { numeroBahias: Math.max(...ag.bahias.keys()) } }); }
      bahiaId = ag.bahias.get(f.bahia) ?? null;
    }

    let operadorId: string | null = null;
    if (f.pulidor) {
      const p = buscarPulidor(f.pulidor);
      operadorId = p?.id ?? null;
      if (!p) sinPulidor.push(`${codigo} (${f.pulidor} → ${f.agencia})`);
    }

    if (!DRY) {
      const extra = f.origen === 'COSTA' ? {} : { ...f.extra, agenciaExcel: f.agencia };
      await prisma.$transaction(async (tx) => {
        const m = await tx.maquinaria.create({
          data: { codigo, nombre, tipo: f.tipo, marca: f.marca || null, serie: f.serie || null, estadoOperativo: 'OPERATIVA', agenciaId: ag?.id ?? null, bahiaId, operadorAsignadoId: operadorId },
        });
        await tx.maquinariaEvento.create({
          data: {
            maquinariaId: m.id, tipo: 'MAQUINA_CREADA', agenciaId: ag?.id ?? null, regionId: regionSierra, entidadId: m.id,
            datos: { codigo: m.codigo, nombre: m.nombre, tipo: m.tipo, agencia: ag?.nombre ?? null, origen: 'Carga de Excel', archivo: f.origen, ...extra } as Prisma.InputJsonValue,
          },
        });
        if (operadorId) {
          const entrega = typeof f.extra.fechaEntrega === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.extra.fechaEntrega) ? new Date(`${f.extra.fechaEntrega}T12:00:00.000Z`) : undefined;
          await tx.maquinariaEvento.create({
            data: {
              maquinariaId: m.id, tipo: 'OPERADOR_ASIGNADO', agenciaId: ag?.id ?? null, regionId: regionSierra, entidadId: m.id,
              datos: { anterior: null, nuevo: operadorId, origen: 'Carga de Excel', fechaEntrega: f.extra.fechaEntrega ?? null } as Prisma.InputJsonValue,
              ...(entrega ? { ocurridoEn: entrega } : {}),
            },
          });
        }
      });
    }
    creadas++;
  }
  console.log(`   máquinas: ${todas.length} en los Excel · ${DRY ? 'se crearían' : 'creadas'} ${creadas} · ya estaban ${yaEstaban} · ${bahiasAgregadas} bahías agregadas por las máquinas`);
  if (agenciasNuevasPorMaquina.size) anotar('Agencias creadas desde las hojas de maquinaria (sin cliente, en la Sierra): verifica si alguna es una duplicada', [...agenciasNuevasPorMaquina].join(' · '));
  if (codigosInventados.length) anotar('Máquinas sin código en el Excel («SIN-COD»): edítalas desde Maquinaria', codigosInventados.join('\n     '));
  if (codigosChocan.length) anotar('Códigos repetidos entre archivos (la segunda quedó como SIN-COD)', codigosChocan.join('\n     '));
  if (sinAgencia.length) anotar('Máquinas cargadas SIN agencia (el Excel no dice un lugar): ubícalas con «transferir»', sinAgencia.join('\n     '));
  if (sinPulidor.length) anotar('Máquinas especiales sin pulidor asignado (el nombre no es una persona o no calza con un solo pulidor)', sinPulidor.join(' · '));

  // Retoque: se asegura al final para que también lo reciban las agencias creadas desde maquinaria.
  if (!DRY) await asegurarServiciosRetoque(prisma);

  // ============ Informe final
  console.log('\n══════════════ INFORME: lo que debes revisar ══════════════');
  if (!informe.size) console.log('   Nada que revisar.');
  for (const [seccion, lineas] of informe) {
    console.log(`\n▸ ${seccion} (${lineas.length})`);
    for (const l of lineas) console.log(`   ${l}`);
  }
  console.log(DRY ? '\nℹ Simulación terminada: no se escribió nada.' : '\n✅ Carga terminada.');
}

main()
  .catch((e) => {
    console.error('❌', e instanceof Error ? (e.stack ?? e.message) : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
