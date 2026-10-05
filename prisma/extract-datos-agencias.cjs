/**
 * Extrae DATOS AGENCIAS.xlsx a JSON normalizado (sin dependencias).
 * Uso: node prisma/extract-datos-agencias.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const XLSX = path.join(ROOT, 'DATOS AGENCIAS.xlsx');
const OUT = path.join(__dirname, 'data', 'datos-agencias.json');

function unzipXlsx(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'easydry-xlsx-'));
  const zip = path.join(dir, 'datos.zip');
  fs.copyFileSync(src, zip);
  const extracted = path.join(dir, 'extracted');
  fs.mkdirSync(extracted);
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${extracted.replace(/'/g, "''")}' -Force"`, { stdio: 'pipe' });
  return path.join(extracted, 'xl');
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseSharedStrings(xml) {
  const strings = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decode(x[1]));
    strings.push(texts.join(''));
  }
  return strings;
}

function colRow(ref) {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  const col = m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return { col, row: Number(m[2]) - 1 };
}

function parseSheet(xml, sst) {
  const rows = [];
  const cellRe = /<c r="([A-Z]+)(\d+)"([^>]*?)(\/>|>)/g;
  let m;
  while ((m = cellRe.exec(xml))) {
    const { col, row } = colRow(m[1] + m[2]);
    const attrs = m[3] || '';
    let inner = '';
    if (m[4] === '>') {
      const close = xml.indexOf('</c>', m.index);
      if (close !== -1) {
        inner = xml.slice(m.index, close);
        cellRe.lastIndex = close + 4;
      }
    }
    const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
    const v = vm ? vm[1] : '';
    let val = '';
    if (vm) {
      if (/t="s"/.test(attrs) || /t="s"/.test(inner)) val = sst[Number(v)] ?? '';
      else if (/t="b"/.test(attrs)) val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v;
    }
    if (!rows[row]) rows[row] = [];
    rows[row][col] = String(val).trim();
  }

  const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)].map((x) => ({
    r1: Number(x[2]) - 1,
    c1: colRow(x[1] + x[2]).col,
    r2: Number(x[4]) - 1,
    c2: colRow(x[3] + x[4]).col,
  }));
  for (const mg of merges) {
    const src = rows[mg.r1]?.[mg.c1] ?? '';
    if (!src) continue;
    for (let r = mg.r1; r <= mg.r2; r++) {
      if (!rows[r]) rows[r] = [];
      for (let c = mg.c1; c <= mg.c2; c++) {
        if (!rows[r][c]) rows[r][c] = src;
      }
    }
  }

  const maxCol = rows.reduce((mx, r) => Math.max(mx, (r || []).length), 0);
  const dense = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || [];
    const out = [];
    for (let c = 0; c < maxCol; c++) out[c] = r[c] != null ? String(r[c]).trim() : '';
    dense[i] = out;
  }
  return dense;
}

function slug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
}

function emailSlug(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '')
    .slice(0, 48);
}

function splitNombre(full) {
  const parts = String(full || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (parts.length === 0) return { name: 'Sin', lastname: 'Nombre' };
  if (parts.length === 1) return { name: parts[0], lastname: parts[0] };
  if (parts.length === 2) return { lastname: parts[0], name: parts[1] };
  return { lastname: parts.slice(0, 2).join(' '), name: parts.slice(2).join(' ') };
}

function normCedula(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length < 10) return d.padStart(10, '0');
  return d;
}

function regionFromText(...parts) {
  const t = parts.join(' ').toUpperCase();
  if (/GUAYAQUIL|MANTA|PORTOVIEJO|SALINAS|DAULE|SAMBOROND|CEIBOS|URDENOR|EL DORADO|JTM|AMERICAS|AMÉRICAS|CARLOS JULIO|ORELLANA|COCA|\bGT\b|5TO\.?\s*GUAYAS/.test(t)) {
    return 'Costa';
  }
  return 'Sierra';
}

function agencyDisplayName(marca, agencia) {
  const a = (agencia || '').trim();
  const m = (marca || '').trim();
  if (!a) return m;
  if (a.toUpperCase().includes(m.toUpperCase()) || m.toUpperCase().includes(a.toUpperCase())) return a;
  return `${m} ${a}`.replace(/\s+/g, ' ').trim();
}

function parseNum(v) {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Hoja por nombre (sin distinguir mayúsculas ni acentos), o null si el libro no la tiene. */
function hojaPorNombre(xlDir, sst, ...nombres) {
  try {
    const libro = fs.readFileSync(path.join(xlDir, 'workbook.xml'), 'utf8');
    const rels = fs.readFileSync(path.join(xlDir, '_rels', 'workbook.xml.rels'), 'utf8');
    const limpio = (s) => decode(String(s)).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const buscados = nombres.map(limpio);
    for (const m of libro.matchAll(/<sheet\b[^>]*>/g)) {
      const nombre = (m[0].match(/name="([^"]*)"/) || [])[1];
      const rid = (m[0].match(/r:id="([^"]*)"/) || [])[1];
      if (!nombre || !rid || !buscados.includes(limpio(nombre))) continue;
      const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((x) => x.includes('Id="' + rid + '"'));
      const destino = rel && (rel.match(/Target="([^"]*)"/) || [])[1];
      if (!destino) continue;
      const archivo = path.join(xlDir, destino.replace(/^\/?(xl\/)?/, ''));
      return parseSheet(fs.readFileSync(archivo, 'utf8'), sst);
    }
  } catch (e) {
    console.warn('No se pudo leer la hoja opcional:', nombres[0], e.message);
  }
  return null;
}

/** Normaliza el nombre de un rol de la hoja de personal (acentos, espacios y sinónimos comunes). */
function normalizarRolGestion(texto) {
  const r = String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const alias = {
    GERENTE: 'APROBADOR', APROBADOR_DE_AGENCIA: 'APROBADOR', LIDER_OPERADOR: 'LIDER', LIDER_AGENCIA: 'LIDER',
    SUPERVISOR_REGIONAL: 'SUPERVISOR', COORDINADOR_COMERCIAL: 'COORD_COMERCIAL', COORDINADOR_DE_MANTENIMIENTO: 'COORD_MANTENIMIENTO',
    COORDINADOR_MANTENIMIENTO: 'COORD_MANTENIMIENTO', COORDINADOR_DE_BODEGA: 'COORD_BODEGA', COORDINADOR_BODEGA: 'COORD_BODEGA',
    ASISTENTE_DE_BODEGA: 'ASISTENTE_BODEGA', COORDINADOR_DE_SERVICIOS_ESPECIALES: 'COORD_SERVICIOS_ESPECIALES',
    COORDINADOR_SERVICIOS_ESPECIALES: 'COORD_SERVICIOS_ESPECIALES', TECNICO_DE_MAQUINARIA: 'TECNICO',
  };
  return alias[r] || r;
}

const xl = unzipXlsx(XLSX);
const sst = parseSharedStrings(fs.readFileSync(path.join(xl, 'sharedStrings.xml'), 'utf8'));
const se = parseSheet(fs.readFileSync(path.join(xl, 'worksheets', 'sheet1.xml'), 'utf8'), sst);
const lav = parseSheet(fs.readFileSync(path.join(xl, 'worksheets', 'sheet2.xml'), 'utf8'), sst);
const prod = parseSheet(fs.readFileSync(path.join(xl, 'worksheets', 'sheet3.xml'), 'utf8'), sst);

const pulidoresExcel = se.slice(1).filter((r) => r[0] || r[1]).map((r) => ({
  nombre: r[0],
  cedula: normCedula(r[1]),
  ciudad: (r[2] || '').trim(),
  region: regionFromText(r[2]),
}));

const CEDULA_NOMBRE_ESPECIALES = new Map(pulidoresExcel.map((p) => [p.cedula, p]));
const pulidorCedulas = new Set(pulidoresExcel.map((p) => p.cedula));

// Fill-down agencias
const agenciasMap = new Map();
let marca = '', agencia = '', bahias = '';
for (let i = 1; i < lav.length; i++) {
  const r = lav[i];
  if (!r.some(Boolean)) continue;
  if (r[0]) marca = r[0];
  if (r[1]) agencia = r[1];
  if (r[2]) bahias = r[2];
  if (!marca || !agencia) continue;
  const key = `${marca}||${agencia}`;
  if (!agenciasMap.has(key)) {
    agenciasMap.set(key, {
      marca: marca.replace(/\s+$/, ''),
      agenciaRaw: agencia.replace(/\s+$/, ''),
      nombre: agencyDisplayName(marca, agencia),
      bahias: Math.max(0, parseInt(bahias, 10) || 0),
      region: regionFromText(marca, agencia),
      servicios: [],
      operarios: [],
      notas: [],
    });
  }
  const a = agenciasMap.get(key);
  const nBah = parseInt(bahias, 10);
  if (nBah > a.bahias) a.bahias = nBah;
  const svc = (r[5] || '').replace(/\s+/g, ' ').trim();
  if (svc && !a.servicios.includes(svc)) a.servicios.push(svc);
  const nota = (r[6] || '').trim();
  if (nota) a.notas.push(nota);
  const ced = normCedula(r[3]);
  const nom = (r[4] || '').replace(/\s+/g, ' ').trim();
  if (ced || nom) {
    const especial = CEDULA_NOMBRE_ESPECIALES.get(ced);
    a.operarios.push({
      nombre: especial?.nombre || nom,
      cedula: ced,
      nota,
      row: i + 1,
      esPulidor: pulidorCedulas.has(ced),
    });
  }
}

// Prospecto: si bahias=0, usar 2 (pedido: crear con bahías, sin personal)
for (const a of agenciasMap.values()) {
  const prospecto = /^(ORGU FORD|ASSA|IOKARS|OIKORSA)$/i.test(a.marca);
  if (prospecto && a.bahias < 1) a.bahias = 2;
}

const SKIP_CEDULA_SECOND_AGENCY = '0959378001';
const KEEP_AGENCY_FOR_DUP = 'AUTOMEKANO AEROPUERTO';

for (const a of agenciasMap.values()) {
  a.operarios = a.operarios.filter((o) => {
    if (o.cedula === SKIP_CEDULA_SECOND_AGENCY && !a.agenciaRaw.toUpperCase().includes('AEROPUERTO')) return false;
    return true;
  });
}

// Catálogo recetas
const EXTRA_SERVICIOS = [
  { nombre: 'LAVADO MCLAREN', categoria: 'GENERAL', tiempoEstimadoMin: 30 },
  { nombre: 'LAVADO PARA AUTOS CON CERAMICO', categoria: 'GENERAL', tiempoEstimadoMin: 30 },
  { nombre: 'LAVADA SEMIDELUX MAS MOTOR', categoria: 'GENERAL', tiempoEstimadoMin: 30 },
  { nombre: 'LAVADO Y ENCERADO PREPAGADO', categoria: 'GENERAL', tiempoEstimadoMin: 45 },
  { nombre: 'LAVADO DE MOTOR', categoria: 'GENERAL', tiempoEstimadoMin: 20 },
];

const catalogo = [];
let current = null;
let seccion = 'GENERAL';
for (const r of prod) {
  const a0 = (r[0] || '').trim();
  const prodName = (r[1] || '').trim();
  const codigo = (r[2] || '').trim();
  const sierra = r[3];
  const costa = r[4];
  const tiempo = r[5];
  const nota = (r[6] || '').trim();

  if (/^SERVICIOS GENERALES$/i.test(a0)) { seccion = 'GENERAL'; continue; }
  if (/SERIVICIOS ESPECIALES|SERVICIOS ESPECIALES/i.test(a0)) { seccion = 'ESPECIAL'; continue; }
  if (/TIEMPO DE DURACI/i.test(a0)) break;
  if (/^PRODUCTO$|^CODIGO$|^ML$/i.test(a0) || /^ML$/i.test(sierra)) continue;

  if (a0 && !/^PAD /i.test(a0)) {
    current = {
      nombre: a0.replace(/\s+/g, ' ').trim(),
      categoria: seccion,
      tiempoEstimadoMin: parseInt(tiempo, 10) || 30,
      receta: [],
    };
    catalogo.push(current);
  }
  if (current && (prodName || codigo) && !/^# AUTOS$/i.test(codigo)) {
    const qty = parseNum(sierra) || parseNum(costa);
    const isPad = /PAD |WOOL|HIBRIDA/i.test(prodName);
    const isUnidad = /EN UNIDAD/i.test(nota) || /AEROSOL/i.test(prodName);
    current.receta.push({
      insumoNombre: prodName || codigo,
      codigoSKU: codigo || slug(prodName).slice(0, 20),
      cantidad: qty > 0 ? qty : isPad ? 0.05 : 1,
      unidad: isPad || isUnidad ? 'UND' : 'ML',
      nota,
    });
  }
  if (current && tiempo && !a0) {
    const t = parseInt(tiempo, 10);
    if (t > 0) current.tiempoEstimadoMin = t;
  }
}

const existingNames = new Set(catalogo.map((c) => c.nombre.toUpperCase()));
for (const extra of EXTRA_SERVICIOS) {
  if (!existingNames.has(extra.nombre.toUpperCase())) {
    catalogo.push({ ...extra, receta: [] });
  }
}

const insumosMap = new Map();
for (const svc of catalogo) {
  for (const line of svc.receta) {
    const key = (line.codigoSKU || line.insumoNombre).toUpperCase();
    if (!insumosMap.has(key)) {
      insumosMap.set(key, {
        codigoSKU: line.codigoSKU,
        nombre: line.insumoNombre,
        unidad: line.unidad,
        categoria: line.unidad === 'UND' ? 'CONSUMIBLE' : 'QUIMICOS_LAVADO',
      });
    }
  }
}

const clientes = [...new Set([...agenciasMap.values()].map((a) => a.marca))];

// Hoja opcional «PERSONAL GESTION»: líderes, aprobadores, supervisores y coordinadores (una fila por persona).
// Encabezados reconocidos: NOMBRE, CEDULA, ROL (o CARGO), AGENCIA (o SEDE), REGION, BODEGA, CORREO (o EMAIL).
const personalGestion = [];
const hojaGestion = hojaPorNombre(xl, sst, 'PERSONAL GESTION', 'PERSONAL DE GESTION', 'GESTION');
if (hojaGestion && hojaGestion.length > 1) {
  const limpio = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  const encabezado = (hojaGestion[0] || []).map(limpio);
  const col = (...nombres) => encabezado.findIndex((h) => nombres.includes(h));
  const cNombre = col('NOMBRE', 'NOMBRES', 'NOMBRE COMPLETO');
  const cCedula = col('CEDULA', 'CI', 'IDENTIFICACION');
  const cRol = col('ROL', 'CARGO', 'PERFIL');
  const cAgencia = col('AGENCIA', 'SEDE', 'SUCURSAL');
  const cRegion = col('REGION');
  const cBodega = col('BODEGA');
  const cCorreo = col('CORREO', 'EMAIL', 'CORREO ELECTRONICO');
  if (cNombre < 0 || cRol < 0) {
    console.warn('La hoja de personal de gestión necesita al menos las columnas NOMBRE y ROL: se omite.');
  } else {
    for (const fila of hojaGestion.slice(1)) {
      if (!fila || !fila[cNombre]) continue;
      personalGestion.push({
        nombre: fila[cNombre],
        cedula: cCedula >= 0 ? normCedula(fila[cCedula]) : '',
        rol: normalizarRolGestion(fila[cRol]),
        agencia: cAgencia >= 0 ? (fila[cAgencia] || '').trim() : '',
        region: cRegion >= 0 ? (fila[cRegion] || '').trim() : '',
        bodega: cBodega >= 0 ? (fila[cBodega] || '').trim() : '',
        correo: cCorreo >= 0 ? (fila[cCorreo] || '').trim().toLowerCase() : '',
      });
    }
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  reglas: {
    marcasComoClientes: true,
    pulidorEnLavados: 'solo_pulidor_fijo',
    cedulaConflicto: 'usar_nombre_servicios_especiales',
    duplicado0959378001: KEEP_AGENCY_FOR_DUP,
    prospectoConBahiasSinPersonal: true,
    email: '{nombre}.{rol}@easydry.com',
    regiones: 'Sierra|Costa',
    serviciosHuerfanos: 'crear_en_catalogo',
    personalSucio: 'cargar_todos',
  },
  clientes,
  pulidoresExcel,
  pulidorCedulas: [...pulidorCedulas],
  personalGestion,
  agencias: [...agenciasMap.values()],
  catalogo,
  insumos: [...insumosMap.values()],
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2), 'utf8');
console.log('Wrote', OUT);
console.log('personal de gestión', personalGestion.length);
console.log('clientes', clientes.length, 'agencias', payload.agencias.length, 'catalogo', catalogo.length, 'insumos', insumosMap.size, 'pulidores', pulidoresExcel.length);
