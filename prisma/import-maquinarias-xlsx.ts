/**
 * Carga a la base el inventario de maquinaria desde uno o varios xlsx. Reconoce el formato por su encabezado:
 *
 *  1. «MAQUINARIAS EASYDRY 2026 ACTUALIZADO.xlsx» (Costa-Austro): fila 1 título, fila 2
 *     AGENCIAS | EQUIPOS | MARCA | POTENCIA | SERIE | CODIGO ACTUAL | BAHIA.
 *  2. «QUITO LOGISTICA 2026.xlsx» (logística Quito): fila 1
 *     AGENCIA | MAQUINA | SEERIE | CODI EASY | FECHA | FACTURA | TRANFERENCIA, y en H alguna nota.
 *     MAQUINA es texto libre («HIDROLAVORADO PORTEN 2HP», «ASPIRADORA THISON 70L.T»): de ahí salen tipo, marca y potencia.
 *     En las aspiradoras y compresores la columna «SEERIE» trae el código del equipo (A001, T001, PC001, IP001, C004); en las
 *     hidrolavadoras trae la serie real y no hay código.
 *  3. «MAQUINARIA SERVICIOS ESPECIALES QUITO 2026.xlsx» (equipos de los pulidores): fila 1
 *     NOMBRE | MAQUINARIA | NOMBRE(marca) | SERIE | AÑO | FACTURA | AGENCIA | FECHA DE ENTRAGA | OBSERVACIONES, con una fila por
 *     equipo (PULIDORA, ROTORBITAL, TALADRO) y el pulidor en la primera columna. La máquina queda asignada a ese pulidor
 *     (por nombre, entre los usuarios con rol PULIDOR) y en la agencia de la columna AGENCIA si existe. Sin código en el Excel:
 *     se generan «UIO-PUL001», «UIO-ROT001», «UIO-TAL001»… en orden de hoja y se omiten las que ya están por tipo + serie.
 *     «SALIO DE LA EMPRESA» se carga dada de baja. Si el nombre no es una persona o no calza con un solo pulidor, la máquina
 *     se carga sin asignar y se lista.
 *
 * Cada fila crea una Maquinaria OPERATIVA con:
 *  - codigo: Costa-Austro, «CODIGO ACTUAL». Quito, el código del equipo con prefijo «UIO-» (sus A001… chocan con los de Costa);
 *    las hidrolavadoras de Quito reciben «UIO-H001…» en orden de hoja y se omiten si ya hay una hidrolavadora con esa serie.
 *    Los códigos que ya existen se omiten, así que se puede correr varias veces.
 *  - tipo: HIDROLAVADORA | ASPIRADORA | COMPRESOR; nombre: «Hidrolavadora PORTEN 4HP» (tipo + marca + potencia).
 *  - serie: la del Excel (en Costa las aspiradoras traen el color; en Quito se guarda su código original).
 *  - agencia: por nombre (ver ALIAS_AGENCIAS para las abreviaturas de cada Excel) y, en Costa, bahía «BAHIA 1» -> «Bahía 01».
 *    Las filas de oficina o cuya agencia no existe en la base se cargan SIN agencia y se listan al final para ubicarlas luego
 *    con «transferir»; una bahía que la agencia no tiene queda en blanco con aviso.
 *  - evento MAQUINA_CREADA en la línea de tiempo (sin actor: la creó la importación). En Quito lleva además la fecha, la
 *    factura, el número de transferencia (AFxxx) y la nota del Excel, que no tienen columna propia en la máquina.
 * No sube fotos ni fichas técnicas: se agregan después, máquina por máquina, desde Editar.
 *
 * Solo corre contra una base en localhost; para una remota (Supabase) exige MAQUINARIAS_REMOTO=SI. Solo inserta códigos nuevos.
 *
 * Uso: npm run prisma:import-maquinarias -- [ruta.xlsx ...] [--dry-run]
 *      Sin rutas carga los tres Excel de la raíz del repositorio.
 */
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const RAIZ = path.join(__dirname, '..', '..');
const RUTAS = (args.filter((a) => !a.startsWith('--')).length
  ? args.filter((a) => !a.startsWith('--'))
  : [path.join(RAIZ, 'MAQUINARIAS EASYDRY 2026 ACTUALIZADO.xlsx'), path.join(RAIZ, 'QUITO LOGISTICA 2026.xlsx'), path.join(RAIZ, 'MAQUINARIA SERVICIOS ESPECIALES QUITO 2026.xlsx')]
).map((r) => path.resolve(r));
const TIPOS = new Set(['HIDROLAVADORA', 'ASPIRADORA', 'COMPRESOR', 'PULIDORA', 'ROTORBITAL', 'TALADRO']);
const PREFIJO_QUITO = 'UIO-';

if (process.env.MAQUINARIAS_REMOTO !== 'SI' && !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Este script solo corre contra la base local (DATABASE_URL debe apuntar a localhost). Para una base remota usa MAQUINARIAS_REMOTO=SI.');
}

/** Abreviaturas y variantes de los Excel -> nombre exacto de la agencia en la base (ya normalizado: mayúsculas, sin tildes ni dobles espacios). */
const ALIAS_AGENCIAS: Record<string, string> = {
  // Costa-Austro
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
  // Quito logística
  'SUZUKI CUMBAYA': 'SUZUKI SZK CUMBAYA',
  'SUZUKI CHILLOS': 'SUZUKI LOS CHILLOS',
  'MARESA CHILLOS': 'MARESA LOS CHILLOS',
  'MARESA M.D.J': 'MARESA MARIANA DE JESUS',
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
  // Servicios especiales
  'MARESA MDJ': 'MARESA MARIANA DE JESUS',
};

/** Nombre corto del Excel de servicios especiales -> como figura en la base, cuando la ortografía difiere. */
const ALIAS_PULIDORES: Record<string, string> = {
  'CRISTIAN GRANDA': 'CHRISTIAN GRANDA',
};
/** Prefijo del código generado según el tipo de equipo del Excel de servicios especiales. */
const PREFIJO_ESPECIALES: Record<string, string> = { PULIDORA: 'UIO-PUL', ROTORBITAL: 'UIO-ROT', TALADRO: 'UIO-TAL' };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const capital = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

type Fila = {
  origen: 'COSTA' | 'QUITO' | 'ESPECIALES';
  agencia: string;
  tipo: string;
  marca: string;
  potencia: string;
  serie: string;
  /** Vacío cuando el Excel no trae código: se genera al cargar con `prefijoCodigo` + número correlativo. */
  codigo: string;
  prefijoCodigo?: string;
  /** Servicios especiales: nombre del pulidor al que se asigna y si el equipo ya salió de la empresa. */
  pulidor?: string;
  baja?: boolean;
  bahia: string;
  /** Datos del Excel que no tienen columna propia: van al evento de creación. */
  extra: Record<string, unknown>;
};

/** Lee la hoja 1 como filas de texto por letra de columna (sin dependencias: un xlsx es un zip de XML). */
function leerHoja(file: string): Record<string, string>[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maq-xlsx-'));
  try {
    const zip = path.join(dir, 'datos.zip');
    fs.copyFileSync(file, zip);
    const out = path.join(dir, 'x');
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${out}' -Force`], { stdio: 'pipe' });
    const sstXml = fs.existsSync(path.join(out, 'xl', 'sharedStrings.xml')) ? fs.readFileSync(path.join(out, 'xl', 'sharedStrings.xml'), 'utf8') : '';
    const sst = [...sstXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join(''));
    const xml = fs.readFileSync(path.join(out, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
    const filas: Record<string, string>[] = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const celdas: Record<string, string> = {};
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '');
        const col = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        if (v && col) celdas[col] = (/t="s"/.test(c[1]) ? sst[Number(v[1])] : decode(v[1])).trim();
      }
      filas.push(celdas);
    }
    return filas;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function parsearCosta(hoja: Record<string, string>[]): Fila[] {
  return hoja
    .slice(2) // título + encabezados
    .map((c) => ({
      origen: 'COSTA' as const,
      agencia: norm(c.A ?? ''),
      tipo: norm(c.B ?? ''),
      marca: (c.C ?? '').replace(/\s+/g, ' ').trim(),
      potencia: (c.D ?? '').replace(/\s+/g, ' ').trim(),
      serie: (c.E ?? '').trim(),
      codigo: (c.F ?? '').trim().toUpperCase(),
      bahia: norm(c.G ?? ''),
      extra: {},
    }))
    .filter((f) => f.codigo); // las filas vacías del final no traen código
}

/** Fecha del Excel: serial numérico o texto d/m/aaaa. Devuelve ISO (AAAA-MM-DD) o, si no es una fecha válida, el texto tal cual. */
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

/** «HIDROLAVORADO PORTEN 2HP» -> HIDROLAVADORA / PORTEN / 2HP, tolerando las erratas del Excel (PORTN, THISON, HIDROLADORA...). */
function describirEquipo(texto: string): { tipo: string; marca: string; potencia: string } {
  const d = norm(texto);
  const tipo = /^HIDRO/.test(d) ? 'HIDROLAVADORA' : /^ASPIR/.test(d) ? 'ASPIRADORA' : /^COMPRES/.test(d) ? 'COMPRESOR' : '';
  const marca = /POWER CLEAN/.test(d) ? 'POWER CLEAN' : /PORT\w*N\b/.test(d) ? 'PORTEN' : /EOLO/.test(d) ? 'EOLO' : /THYSON|THISON/.test(d) ? 'THYSON' : /\bIPC\b/.test(d) ? 'IPC' : '';
  const hp = /(\d+)\s*HP/.exec(d)?.[1];
  const lt = /(\d+)\s*L\.?\s*T/.exec(d)?.[1];
  return { tipo, marca, potencia: hp ? `${hp}HP` : lt ? `${lt} L.T` : '' };
}

function parsearQuito(hoja: Record<string, string>[]): Fila[] {
  return hoja
    .slice(1) // encabezados
    .filter((c) => c.B)
    .map((c) => {
      const equipo = describirEquipo(c.B);
      const hidro = equipo.tipo === 'HIDROLAVADORA';
      const codigoEquipo = norm(c.D ?? c.C ?? '').replace(/\s/g, '');
      return {
        origen: 'QUITO' as const,
        agencia: norm(c.A ?? ''),
        ...equipo,
        // Hidrolavadora: «SEERIE» es la serie real. Resto: es el código del equipo, que se conserva como serie.
        serie: (c.C ?? '').trim(),
        codigo: hidro || !codigoEquipo ? '' : PREFIJO_QUITO + codigoEquipo,
        prefijoCodigo: hidro ? `${PREFIJO_QUITO}H` : undefined,
        bahia: '',
        extra: {
          descripcionExcel: c.B,
          fechaCompra: fechaExcel(c.E ?? ''),
          factura: c.F || null,
          transferencia: c.G || null,
          nota: c.H || null,
        },
      };
    });
}

function parsearEspeciales(hoja: Record<string, string>[]): Fila[] {
  return hoja
    .slice(1) // encabezados
    .filter((c) => c.B)
    .map((c) => {
      const tipo = norm(c.B);
      const observaciones = c.I || null;
      return {
        origen: 'ESPECIALES' as const,
        agencia: norm(c.G ?? ''),
        tipo,
        marca: (c.C ?? '').trim(),
        potencia: '',
        serie: (c.D ?? '').trim(),
        codigo: '',
        prefijoCodigo: PREFIJO_ESPECIALES[tipo],
        pulidor: norm(c.A ?? ''),
        baja: /SALIO DE LA EMPRESA/.test(norm(observaciones ?? '')),
        bahia: '',
        extra: {
          pulidorExcel: c.A || null,
          anio: c.E || null,
          factura: c.F || null,
          fechaEntrega: fechaExcel(c.H ?? ''),
          observaciones,
        },
      };
    });
}

function parsear(file: string): Fila[] {
  const hoja = leerHoja(file);
  if (norm(hoja[0]?.A ?? '') === 'NOMBRE' && norm(hoja[0]?.B ?? '') === 'MAQUINARIA') return parsearEspeciales(hoja);
  if (/^AGENCIAS$/.test(norm(hoja[1]?.A ?? ''))) return parsearCosta(hoja);
  if (/^AGENCIA$/.test(norm(hoja[0]?.A ?? '')) && /CODI EASY/.test(norm(hoja[0]?.D ?? ''))) return parsearQuito(hoja);
  throw new Error(`Formato no reconocido en ${path.basename(file)}: se esperaba el Excel de Costa-Austro, el de logística Quito o el de servicios especiales.`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const filas: Fila[] = [];
    for (const ruta of RUTAS) {
      const leidas = parsear(ruta);
      console.log(`Leídas ${leidas.length} máquinas de ${path.basename(ruta)}`);
      filas.push(...leidas);
    }
    if (DRY) console.log('(--dry-run: no se escribe nada)');

    const raros = filas.filter((f) => !TIPOS.has(f.tipo));
    if (raros.length) throw new Error(`Tipo de equipo desconocido en: ${raros.map((f) => `${f.codigo || f.serie} (${f.tipo || 'vacío'})`).join(', ')}`);
    const conCodigo = filas.map((f) => f.codigo).filter(Boolean);
    // Un código repetido no dice a cuál máquina pertenece: no se carga ninguna de las dos hasta que se corrija el Excel.
    const repetidos = new Set(conCodigo.filter((c, i, a) => a.indexOf(c) !== i));
    const codigoRepetido: string[] = [];

    const agencias = await prisma.agencia.findMany({
      select: { id: true, nombre: true, regionId: true, bahias: { select: { id: true, nombre: true } } },
    });
    const porNombre = new Map(agencias.map((a) => [norm(a.nombre), a]));
    const maquinas = await prisma.maquinaria.findMany({ select: { codigo: true, tipo: true, serie: true } });
    const existentes = new Set(maquinas.map((m) => m.codigo));
    const tipoSerie = new Set(maquinas.filter((m) => m.serie).map((m) => `${m.tipo}|${m.serie}`));
    /** Próximo número correlativo por prefijo de código generado (UIO-H, UIO-PUL…), a partir del mayor que ya existe. */
    const siguiente = new Map<string, number>();
    const proximoCodigo = (prefijo: string) => {
      if (!siguiente.has(prefijo)) {
        const re = new RegExp(`^${prefijo}(\\d+)$`);
        siguiente.set(prefijo, Math.max(0, ...maquinas.map((m) => Number(re.exec(m.codigo)?.[1] ?? 0))) + 1);
      }
      const n = siguiente.get(prefijo)!;
      siguiente.set(prefijo, n + 1);
      return `${prefijo}${String(n).padStart(3, '0')}`;
    };

    // Pulidores activos, para asignarles sus equipos por nombre. Cada palabra del Excel debe estar en el nombre completo
    // (completa, o como inicio si tiene 4+ letras: «RONAL» -> «RONALD») y debe calzar exactamente uno.
    const pulidores = (await prisma.user.findMany({ where: { estado: 1, role: { namerol: 'PULIDOR' } }, select: { id: true, name: true, lastname: true } })).map((u) => ({
      id: u.id,
      palabras: norm(`${u.name} ${u.lastname ?? ''}`).split(' '),
    }));
    const buscarPulidor = (nombre: string): string | null => {
      const palabras = (ALIAS_PULIDORES[nombre] ?? nombre).split(' ');
      const calzan = pulidores.filter((p) => palabras.every((w) => p.palabras.some((pw) => pw === w || (w.length >= 4 && pw.startsWith(w)))));
      return calzan.length === 1 ? calzan[0].id : null;
    };

    let creadas = 0;
    const yaExistian: string[] = [];
    const sinAgencia = new Map<string, string[]>();
    const sinBahia: string[] = [];
    const sinCodigo: string[] = [];
    const sinPulidor: string[] = [];
    const dadasDeBaja: string[] = [];

    for (const f of filas) {
      if (!f.codigo) {
        if (!f.prefijoCodigo) {
          sinCodigo.push(`${f.agencia}: ${f.extra.descripcionExcel}`);
          continue;
        }
        // Sin código en el Excel, la identidad es tipo + serie: si ya está cargada no se vuelve a crear.
        if (f.serie && tipoSerie.has(`${f.tipo}|${f.serie}`)) {
          yaExistian.push(`${f.tipo} serie ${f.serie}`);
          continue;
        }
        f.codigo = proximoCodigo(f.prefijoCodigo);
        if (f.serie) tipoSerie.add(`${f.tipo}|${f.serie}`);
      }
      if (repetidos.has(f.codigo)) {
        codigoRepetido.push(`${f.codigo} — ${f.agencia}: ${f.extra.descripcionExcel ?? `${f.tipo} ${f.marca} ${f.potencia}`}`);
        continue;
      }
      if (existentes.has(f.codigo)) {
        yaExistian.push(f.codigo);
        continue;
      }
      const agencia = porNombre.get(ALIAS_AGENCIAS[f.agencia] ?? f.agencia) ?? null;
      if (!agencia) sinAgencia.set(f.agencia, [...(sinAgencia.get(f.agencia) ?? []), f.codigo]);

      // Servicios especiales: el equipo lo tiene un pulidor (salvo los que ya salieron de la empresa).
      const operadorId = f.pulidor && !f.baja ? buscarPulidor(f.pulidor) : null;
      if (f.pulidor && !f.baja && !operadorId) sinPulidor.push(`${f.codigo} (${f.pulidor})`);
      if (f.baja) dadasDeBaja.push(f.codigo);

      // «BAHIA 1» -> «Bahía 01»
      const num = /(\d+)/.exec(f.bahia)?.[1];
      const bahia = agencia && num ? agencia.bahias.find((b) => Number(/(\d+)/.exec(b.nombre)?.[1]) === Number(num)) ?? null : null;
      if (agencia && num && !bahia) sinBahia.push(`${f.codigo} (${agencia.nombre}: ${f.bahia})`);

      const nombre = [capital(f.tipo), f.marca, f.potencia].filter(Boolean).join(' ');
      if (!DRY) {
        await prisma.$transaction(async (tx) => {
          const m = await tx.maquinaria.create({
            data: {
              codigo: f.codigo,
              nombre,
              tipo: f.tipo,
              marca: f.marca || null,
              serie: f.serie || null,
              estadoOperativo: f.baja ? 'DE_BAJA' : 'OPERATIVA',
              agenciaId: agencia?.id ?? null,
              bahiaId: bahia?.id ?? null,
              operadorAsignadoId: operadorId,
              ...(f.baja ? { activa: false, fechaDesactivacion: new Date(), motivoDesactivacion: 'Salió de la empresa (según el Excel de servicios especiales)' } : {}),
            },
          });
          await tx.maquinariaEvento.create({
            data: {
              maquinariaId: m.id,
              tipo: 'MAQUINA_CREADA',
              agenciaId: agencia?.id ?? null,
              regionId: agencia?.regionId ?? null,
              entidadId: m.id,
              datos: {
                codigo: m.codigo,
                nombre: m.nombre,
                tipo: m.tipo,
                agencia: agencia?.nombre ?? null,
                bahia: bahia?.nombre ?? null,
                origen: 'Importación Excel',
                ...(f.origen !== 'COSTA' ? { ...f.extra, agenciaExcel: f.agencia } : {}),
              },
            },
          });
          if (operadorId) {
            await tx.maquinariaEvento.create({
              data: {
                maquinariaId: m.id,
                tipo: 'OPERADOR_ASIGNADO',
                agenciaId: agencia?.id ?? null,
                regionId: agencia?.regionId ?? null,
                entidadId: m.id,
                datos: { anterior: null, nuevo: operadorId, origen: 'Importación Excel' },
              },
            });
          }
        });
      }
      existentes.add(f.codigo);
      creadas++;
    }

    console.log(`\n${DRY ? 'Se crearían' : 'Creadas'}: ${creadas}   Omitidas por código o serie existente: ${yaExistian.length}`);
    if (yaExistian.length) console.log(`  ${yaExistian.join(', ')}`);
    if (codigoRepetido.length) console.log(`\nOmitidas por código repetido en el Excel — corrígelo y vuelve a correr:\n  ${codigoRepetido.join('\n  ')}`);
    if (sinCodigo.length) console.log(`\nOmitidas por no traer código:\n  ${sinCodigo.join('\n  ')}`);
    if (sinAgencia.size) {
      console.log(`\nCargadas SIN agencia (${[...sinAgencia.values()].flat().length}) — ubícalas con «transferir»:`);
      for (const [nombre, codigos] of sinAgencia) console.log(`  ${nombre || '(vacía)'}: ${codigos.join(', ')}`);
    }
    if (dadasDeBaja.length) console.log(`\nCargadas dadas de baja (salieron de la empresa): ${dadasDeBaja.join(', ')}`);
    if (sinPulidor.length) console.log(`\nCargadas SIN pulidor asignado (nombre que no es una persona o que no calza con un solo pulidor) — asígnalas desde la máquina:\n  ${sinPulidor.join('\n  ')}`);
    if (sinBahia.length) console.log(`\nBahía inexistente en su agencia (quedó sin bahía):\n  ${sinBahia.join('\n  ')}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
