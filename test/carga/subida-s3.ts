/**
 * Mide la SUBIDA REAL de evidencias al bucket de desarrollo, como lo hace la app: el backend entrega un ticket con URL prefirmada y el
 * archivo viaja directo a S3. Por OT: 1 video de inicio + 5 fotos de ingreso + 1 video de fin + 5 fotos de salida.
 * Los archivos son bytes aleatorios con el tamaño de los reales; al terminar se borran del bucket (incluidas las miniaturas).
 *
 *   npx nest build && npx tsx test/carga/subida-s3.ts
 *   SUBIDA_OTS=4 SUBIDA_VIDEO_MB=28 SUBIDA_FOTO_KB=400 SUBIDA_PARALELO=4
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { abrirEntorno } from '../integracion/entorno.js';

const OTS = Number(process.env.SUBIDA_OTS || 4);
const VIDEO_MB = Number(process.env.SUBIDA_VIDEO_MB || 28);
const FOTO_KB = Number(process.env.SUBIDA_FOTO_KB || 400);
const FOTOS = Number(process.env.SUBIDA_FOTOS || 5);
const PARALELO = Number(process.env.SUBIDA_PARALELO || 4);
const PUERTO = Number(process.env.CARGA_PUERTO || 3100);
const BASE = `http://127.0.0.1:${PUERTO}/api/v1`;
const CLAVE = 'Carga#Prueba2026';
const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Variables del .env del backend (el servidor las lee solo; aquí se necesitan las de AWS para borrar). */
function cargarEnv(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const linea of fs.readFileSync(path.resolve('.env'), 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?/);
    if (m) salida[m[1]] = m[2].trim();
  }
  return salida;
}

async function api(ruta: string, cuerpo: unknown, token?: string): Promise<{ estado: number; json: any }> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(cuerpo ?? {}),
  });
  return { estado: r.status, json: await r.json().catch(() => null) };
}

type Subida = { tipo: string; bytes: number; msTicket: number; msS3: number; msConfirm: number; ok: boolean };

async function main() {
  const cfg = cargarEnv();
  const env = await abrirEntorno();
  let servidor: ChildProcess | null = null;
  const claves = new Set<string>();
  const directorios = new Set<string>();
  try {
    const region = await env.region('SUBIDA');
    const agencia = await env.agencia('SUBIDA', { regionId: region.id });
    const catalogo = await env.catalogo('SUBIDA', { precio: 12 });
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { servicioIds: [catalogo.id] } });
    const bahia = await env.bahia('SUBIDA', agencia.id);
    const hash = await bcrypt.hash(CLAVE, 10);
    const usuario = await env.usuario('subida', 'LIDER', { agenciaId: agencia.id });
    await env.prisma.user.update({ where: { id: usuario.id }, data: { passwordHash: hash } });

    servidor = spawn(process.execPath, ['dist/main.js'], {
      env: { ...process.env, PORT: String(PUERTO), AUTH_RATE_LIMIT: '100000', NODE_ENV: 'development' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 120; i++) {
      await pausa(500);
      if (await fetch(`${BASE}/sync/ping`, { method: 'POST' }).then((r) => r.status < 500, () => false)) break;
      if (i === 119) throw new Error('El servidor no arrancó');
    }
    const login = await api('/auth/login', { email: usuario.email, password: CLAVE });
    const token = login.json?.accessToken ?? login.json?.data?.accessToken;
    if (!token) throw new Error(`Login falló: ${login.estado}`);

    const video = randomBytes(VIDEO_MB * 1024 * 1024);
    const foto = randomBytes(FOTO_KB * 1024);
    let n = 0;

    const unaOT = async (): Promise<Subida[]> => {
      const id = ++n;
      const clientUuid = `${env.marca}-s3-${id}`;
      const ot = `${env.marca}-S3-${id}`.toUpperCase();
      const datos = { placa: `S${env.marca.slice(1, 4).toUpperCase()}-${String(id).padStart(4, '0')}`, modelo: 'Carga', servicioCatalogoId: catalogo.id, bahiaId: bahia.id, ordenTrabajoOT: ot };
      const push = (accion: string, extra: Record<string, unknown>) =>
        api('/sync/push', { deviceId: `s3-${id}`, mutations: [{ mutationId: `${clientUuid}-${accion}`, clientUuid, entity: 'servicio_lavado', action: accion, timestamp: Date.now(), data: { ...datos, ...extra } }] }, token);
      const resultados: Subida[] = [];

      const subir = async (tipo: string, archivo: string, contentType: string, bytes: Buffer) => {
        const a = performance.now();
        const t = await api('/sync/media/ticket', { clientUuid, type: tipo, fileName: archivo, category: 'SERVICIOS_GENERALES', servicioId: ot, contentType }, token);
        const msTicket = performance.now() - a;
        const url = t.json?.publicUrl;
        if (t.estado !== 200 || !t.json?.uploadUrl) return resultados.push({ tipo, bytes: bytes.length, msTicket, msS3: 0, msConfirm: 0, ok: false });
        if (t.json.key) {
          claves.add(t.json.key);
          directorios.add(String(t.json.key).slice(0, String(t.json.key).lastIndexOf('/') + 1));
        }
        const b = performance.now();
        const put = await fetch(t.json.uploadUrl, { method: 'PUT', headers: { ...(t.json.headers ?? {}), 'Content-Type': t.json.headers?.['Content-Type'] ?? contentType }, body: bytes, signal: AbortSignal.timeout(Number(process.env.SUBIDA_TIMEOUT_S || 120) * 1000) })
          .catch((e) => { console.log(`  ✗ ${tipo} (${(bytes.length / 1048576).toFixed(1)} MB): ${e?.cause?.code ?? e?.name ?? e}`); return { ok: false, status: 0 } as Response; });
        if (!put.ok && put.status) console.log(`  ✗ ${tipo}: S3 respondió ${put.status}`);
        const msS3 = performance.now() - b;
        const c0 = performance.now();
        const c = put.ok ? await api('/sync/media/confirm', { clientUuid, type: tipo, fileUrl: url, category: 'SERVICIOS_GENERALES', servicioId: ot }, token) : { estado: 0 };
        resultados.push({ tipo, bytes: bytes.length, msTicket, msS3, msConfirm: performance.now() - c0, ok: put.ok && c.estado === 200 });
      };

      await push('CREATE', { estado: 'EN_PROCESO', horaIngreso: new Date().toISOString() });
      await subir('VIDEO_INICIAL', `${clientUuid}_inicio.mp4`, 'video/mp4', video);
      for (let i = 0; i < FOTOS; i++) await subir('FOTO_INGRESO', `${clientUuid}_in${i}.jpg`, 'image/jpeg', foto);
      await push('COMPLETE', { estado: 'FINALIZADO' });
      await subir('VIDEO_FINAL', `${clientUuid}_fin.mp4`, 'video/mp4', video);
      for (let i = 0; i < FOTOS; i++) await subir('FOTO_SALIDA', `${clientUuid}_out${i}.jpg`, 'image/jpeg', foto);
      return resultados;
    };

    const informe = (titulo: string, todos: Subida[], segundos: number, ots: number) => {
      const bytes = todos.reduce((s, x) => s + x.bytes, 0);
      const videos = todos.filter((x) => x.tipo.startsWith('VIDEO'));
      const fotos = todos.filter((x) => x.tipo.startsWith('FOTO'));
      const media = (xs: Subida[], f: (x: Subida) => number) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0);
      console.log(`\n=== ${titulo} ===`);
      console.log(`${ots} OT · ${todos.length} archivos (${todos.filter((x) => !x.ok).length} con error) · ${(bytes / 1048576).toFixed(0)} MB en ${segundos.toFixed(1)} s → ${((bytes * 8) / segundos / 1e6).toFixed(1)} Mbps de subida efectiva`);
      console.log(`Video (${VIDEO_MB} MB): subida a S3 ${(media(videos, (x) => x.msS3) / 1000).toFixed(1)} s en promedio · ticket ${media(videos, (x) => x.msTicket).toFixed(0)} ms · confirmar ${media(videos, (x) => x.msConfirm).toFixed(0)} ms`);
      console.log(`Foto (${FOTO_KB} KB): subida a S3 ${media(fotos, (x) => x.msS3).toFixed(0)} ms en promedio · ticket ${media(fotos, (x) => x.msTicket).toFixed(0)} ms · confirmar ${media(fotos, (x) => x.msConfirm).toFixed(0)} ms`);
      console.log(`Por OT: ${((segundos * 1) / ots).toFixed(1)} s de promedio. Extrapolado a 50 OT en este mismo flujo: ${(((segundos * 1) / ots) * 50 / 60).toFixed(1)} min.`);
    };

    const t1 = performance.now();
    const serie: Subida[] = [];
    const unSoloOT = Math.max(1, Math.floor(OTS / 2));
    for (let i = 0; i < unSoloOT; i++) serie.push(...(await unaOT()));
    informe(`A) ${unSoloOT} OT una tras otra (un dispositivo)`, serie, (performance.now() - t1) / 1000, unSoloOT);

    const t2 = performance.now();
    const paralelas = await Promise.all(Array.from({ length: Math.min(PARALELO, OTS - unSoloOT || PARALELO) }, () => unaOT()));
    informe(`B) ${paralelas.length} OT al mismo tiempo (${paralelas.length} dispositivos comparten esta conexión)`, paralelas.flat(), (performance.now() - t2) / 1000, paralelas.length);
  } finally {
    servidor?.kill();
    // Limpieza del bucket: los archivos, y las miniaturas/vistas que el backend crea en segundo plano para las fotos.
    try {
      await pausa(4000);
      const s3 = new S3Client({ region: cfg.AWS_REGION, credentials: { accessKeyId: cfg.AWS_ACCESS_KEY_ID, secretAccessKey: cfg.AWS_SECRET_ACCESS_KEY } });
      let borrados = 0;
      for (let pasada = 0; pasada < 2; pasada++) {
        for (const dir of directorios) {
          for (const prefijo of [dir, `thumbs/${dir}`, `view/${dir}`]) {
            const lista = await s3.send(new ListObjectsV2Command({ Bucket: cfg.AWS_S3_BUCKET_NAME, Prefix: prefijo }));
            const objetos = (lista.Contents ?? []).map((o) => ({ Key: o.Key! }));
            if (objetos.length) {
              await s3.send(new DeleteObjectsCommand({ Bucket: cfg.AWS_S3_BUCKET_NAME, Delete: { Objects: objetos } }));
              borrados += objetos.length;
            }
          }
        }
        await pausa(2500);
      }
      console.log(`\nBucket limpio: ${borrados} objetos de prueba borrados (${directorios.size} carpetas).`);
    } catch (e) {
      console.error('No se pudo limpiar el bucket, revisa a mano estas carpetas:', [...directorios], e);
    }
    await env.cerrar();
  }
}

main().catch((e) => {
  console.error('Fallo la prueba:', e);
  process.exit(1);
});
