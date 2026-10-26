/**
 * Simulación de carga: N OT de lavado finalizadas, cada una con evidencia de inicio y de fin (1 video + 5 fotos por lado),
 * siguiendo el mismo camino que la app: /sync/push (crear), /sync/media/ticket + /sync/media/confirm por archivo y /sync/push (finalizar).
 *
 * Mide solo el BACKEND: los binarios no se suben (en producción van directo a S3 con URL prefirmada, sin pasar por el servidor).
 * Arranca su propia instancia (`dist/main.js`) en otro puerto contra la base local y borra todo lo que crea.
 *
 *   npx tsx test/carga/carga-ot.ts            (antes: npx nest build)
 *   CARGA_OTS=50 CARGA_USUARIOS=10 CARGA_CONCURRENCIA=10 CARGA_SOLO_ESCENARIO=A npx tsx test/carga/carga-ot.ts
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import bcrypt from 'bcryptjs';
import { abrirEntorno } from '../integracion/entorno.js';

const OTS = Number(process.env.CARGA_OTS || 50);
const USUARIOS = Number(process.env.CARGA_USUARIOS || 25);
const OTS_B = Number(process.env.CARGA_OTS_B || 10);
const CONCURRENCIA = Number(process.env.CARGA_CONCURRENCIA || 25);
const FOTOS = Number(process.env.CARGA_FOTOS || 5);
const PUERTO = Number(process.env.CARGA_PUERTO || 3100);
const SOLO = process.env.CARGA_SOLO_ESCENARIO || '';
const BASE = `http://127.0.0.1:${PUERTO}/api/v1`;
const CLAVE = 'Carga#Prueba2026';

type Muestra = { ruta: string; ms: number; estado: number };
let muestras: Muestra[] = [];
let throttled = 0;
let avisado = false;

const pausa = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Memoria y CPU acumulada del servidor Node y de todos los procesos de Postgres (Windows, vía PowerShell). */
type Foto = { memNodeMB: number; cpuNodeS: number; memPgMB: number; cpuPgS: number };
function fotoRecursos(pid: number): Promise<Foto | null> {
  const script = `$n = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; $p = Get-Process postgres -ErrorAction SilentlyContinue; ` +
    `@{ memNode = [double]$n.WorkingSet64; cpuNode = [double]$n.TotalProcessorTime.TotalSeconds; memPg = [double]($p | Measure-Object WorkingSet64 -Sum).Sum; cpuPg = [double](($p | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum) } | ConvertTo-Json -Compress`;
  return new Promise((ok) => {
    execFile('powershell', ['-NoProfile', '-Command', script], { timeout: 8000 }, (_e, out) => {
      try {
        const j = JSON.parse(out);
        ok({ memNodeMB: j.memNode / 1048576, cpuNodeS: j.cpuNode, memPgMB: j.memPg / 1048576, cpuPgS: j.cpuPg });
      } catch {
        ok(null);
      }
    });
  });
}

async function llamar(ruta: string, cuerpo: unknown, token?: string): Promise<any> {
  for (let intento = 0; intento < 8; intento++) {
    const t0 = performance.now();
    let estado = 0;
    let json: any = null;
    try {
      const r = await fetch(`${BASE}${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(cuerpo ?? {}),
      });
      estado = r.status;
      json = await r.json().catch(() => null);
    } catch {
      estado = -1;
    }
    muestras.push({ ruta, ms: performance.now() - t0, estado });
    if (estado === 429) {
      // Como la app: espera y reintenta. Se cuenta aparte para ver cuánto frena el límite de peticiones.
      throttled++;
      await pausa(1500);
      continue;
    }
    return { estado, json };
  }
  return { estado: 429, json: null };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};

function resumen(titulo: string, muestrasEscenario: Muestra[], segundos: number, otsOk: number, otsTotal: number) {
  console.log(`\n=== ${titulo} ===`);
  console.log(`OT completadas: ${otsOk}/${otsTotal} · tiempo total: ${segundos.toFixed(1)} s · peticiones: ${muestrasEscenario.length} (${(muestrasEscenario.length / segundos).toFixed(1)} /s) · reintentos por límite (429): ${throttled}`);
  const porRuta = new Map<string, Muestra[]>();
  for (const m of muestrasEscenario) porRuta.set(m.ruta, [...(porRuta.get(m.ruta) ?? []), m]);
  console.log('ruta'.padEnd(26), 'n'.padStart(5), 'p50'.padStart(8), 'p95'.padStart(8), 'máx'.padStart(8), 'errores'.padStart(8));
  for (const [ruta, ms] of porRuta) {
    const t = ms.map((m) => m.ms);
    const errores = ms.filter((m) => m.estado >= 400 && m.estado !== 429).length;
    console.log(ruta.padEnd(26), String(ms.length).padStart(5), `${pct(t, 50).toFixed(0)}ms`.padStart(8), `${pct(t, 95).toFixed(0)}ms`.padStart(8), `${Math.max(...t).toFixed(0)}ms`.padStart(8), String(errores).padStart(8));
  }
  const todos = muestrasEscenario.map((m) => m.ms);
  console.log(`todas: p50 ${pct(todos, 50).toFixed(0)}ms · p95 ${pct(todos, 95).toFixed(0)}ms · p99 ${pct(todos, 99).toFixed(0)}ms`);
}

async function main() {
  const env = await abrirEntorno();
  let servidor: ChildProcess | null = null;
  try {
    // ── Mundo de prueba ──
    const region = await env.region('CARGA');
    const agencia = await env.agencia('CARGA', { regionId: region.id });
    const catalogo = await env.catalogo('CARGA', { precio: 12 });
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { servicioIds: [catalogo.id] } });
    await env.prisma.precioAgenciaServicio.create({ data: { agenciaId: agencia.id, catalogoServicioId: catalogo.id, precio: 12 } });
    const bahias = [] as any[];
    for (let i = 0; i < Math.max(5, USUARIOS); i++) bahias.push(await env.bahia(`CARGA${i}`, agencia.id));
    const hash = await bcrypt.hash(CLAVE, 10);
    const usuarios = [] as Array<{ id: string; email: string }>;
    for (let i = 0; i < USUARIOS; i++) {
      const u = await env.usuario(`carga${i}`, 'LIDER', { agenciaId: agencia.id });
      await env.prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
      usuarios.push(u);
    }

    // ── Servidor propio ──
    servidor = spawn(process.execPath, ['dist/main.js'], {
      env: { ...process.env, PORT: String(PUERTO), AUTH_RATE_LIMIT: '100000', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let salida = '';
    servidor.stdout?.on('data', (d) => (salida += d));
    servidor.stderr?.on('data', (d) => (salida += d));
    const arranque = performance.now();
    for (let i = 0; i < 120; i++) {
      await pausa(500);
      const ok = await fetch(`${BASE}/sync/ping`, { method: 'POST' }).then((r) => r.status < 500, () => false);
      if (ok) break;
      if (i === 119) throw new Error(`El servidor no arrancó:\n${salida.slice(-800)}`);
    }
    console.log(`Servidor listo en ${((performance.now() - arranque) / 1000).toFixed(1)} s (puerto ${PUERTO}).`);

    // ── Sesiones ──
    const tokens: string[] = [];
    const t0 = performance.now();
    for (const u of usuarios) {
      const r = await llamar('/auth/login', { email: u.email, password: CLAVE });
      const token = r.json?.accessToken ?? r.json?.data?.accessToken;
      if (!token) throw new Error(`Login falló (${r.estado}): ${JSON.stringify(r.json)?.slice(0, 200)}`);
      tokens.push(token);
    }
    console.log(`${usuarios.length} inicios de sesión en ${(performance.now() - t0).toFixed(0)} ms.`);
    muestras = [];
    throttled = 0;

    // ── Una OT completa, como la app ──
    let secuencia = 0;
    const unaOT = async (token: string, bahiaId: string): Promise<boolean> => {
      const n = ++secuencia;
      const placa = `C${env.marca.slice(1, 4).toUpperCase()}-${String(n).padStart(4, '0')}`;
      const clientUuid = `${env.marca}-ot-${n}`;
      const ot = `${env.marca}-${n}`.toUpperCase();
      const datos = { placa, modelo: 'Carga', servicioCatalogoId: catalogo.id, bahiaId, ordenTrabajoOT: ot };
      const mutacion = (accion: string, extra: Record<string, unknown>) => ({
        deviceId: `carga-${clientUuid.slice(-6)}`,
        mutations: [{ mutationId: `${clientUuid}-${accion}`, clientUuid, entity: 'servicio_lavado', action: accion, timestamp: Date.now(), data: { ...datos, ...extra } }],
      });
      const evidencia = async (tipo: string, archivo: string, tipoContenido: string) => {
        const t = await llamar('/sync/media/ticket', { clientUuid, type: tipo, fileName: archivo, category: 'SERVICIOS_GENERALES', servicioId: ot, contentType: tipoContenido }, token);
        const url = t.json?.publicUrl;
        if (t.estado !== 200 || !url) return false;
        const c = await llamar('/sync/media/confirm', { clientUuid, type: tipo, fileUrl: url, category: 'SERVICIOS_GENERALES', servicioId: ot }, token);
        return c.estado === 200;
      };

      const crear = await llamar('/sync/push', mutacion('CREATE', { estado: 'EN_PROCESO', horaIngreso: new Date().toISOString() }), token);
      if (crear.json?.results?.[0]?.status !== 'APPLIED') {
        if (!avisado) { avisado = true; console.log('Primera OT rechazada:', crear.estado, JSON.stringify(crear.json)?.slice(0, 400)); }
        return false;
      }
      let ok = await evidencia('VIDEO_INICIAL', `${clientUuid}_inicio.mp4`, 'video/mp4');
      for (let i = 0; i < FOTOS; i++) ok = (await evidencia('FOTO_INGRESO', `${clientUuid}_in${i}.jpg`, 'image/jpeg')) && ok;
      const fin = await llamar('/sync/push', mutacion('COMPLETE', { estado: 'FINALIZADO' }), token);
      ok = fin.json?.results?.[0]?.status === 'APPLIED' && ok;
      ok = (await evidencia('VIDEO_FINAL', `${clientUuid}_fin.mp4`, 'video/mp4')) && ok;
      for (let i = 0; i < FOTOS; i++) ok = (await evidencia('FOTO_SALIDA', `${clientUuid}_out${i}.jpg`, 'image/jpeg')) && ok;
      return ok;
    };

    const escenario = async (titulo: string, usuariosActivos: number, concurrencia: number, total: number) => {
      muestras = [];
      throttled = 0;
      let siguiente = 0;
      let completas = 0;
      const inicio = await fotoRecursos(servidor!.pid!);
      const fotos: Foto[] = [];
      let midiendo = true;
      const muestreo = (async () => {
        while (midiendo) {
          const f = await fotoRecursos(servidor!.pid!);
          if (f) fotos.push(f);
          await pausa(700);
        }
      })();
      const t = performance.now();
      const trabajador = async (w: number) => {
        while (siguiente < total) {
          const i = siguiente++;
          const u = i % usuariosActivos;
          if (await unaOT(tokens[u], bahias[u % bahias.length].id)) completas++;
        }
      };
      await Promise.all(Array.from({ length: concurrencia }, (_, w) => trabajador(w)));
      const segundos = (performance.now() - t) / 1000;
      midiendo = false;
      await muestreo;
      const fin = fotos[fotos.length - 1];
      resumen(titulo, muestras, segundos, completas, total);
      if (inicio && fotos.length) {
        const picoNode = Math.max(...fotos.map((f) => f.memNodeMB));
        const picoPg = Math.max(...fotos.map((f) => f.memPgMB));
        const nucleos = Number(process.env.NUMBER_OF_PROCESSORS || 1);
        const cpuNode = ((fin.cpuNodeS - inicio.cpuNodeS) / segundos) * 100;
        const cpuPg = ((fin.cpuPgS - inicio.cpuPgS) / segundos) * 100;
        console.log(`Recursos: servidor Node → RAM antes ${inicio.memNodeMB.toFixed(0)} MB, pico ${picoNode.toFixed(0)} MB · CPU ${(fin.cpuNodeS - inicio.cpuNodeS).toFixed(1)} s en ${segundos.toFixed(1)} s (${cpuNode.toFixed(0)} % de un núcleo, ${(cpuNode / nucleos).toFixed(0)} % del equipo de ${nucleos} núcleos)`);
        console.log(`          Postgres (todos sus procesos) → RAM pico ${picoPg.toFixed(0)} MB · CPU ${(fin.cpuPgS - inicio.cpuPgS).toFixed(1)} s (${cpuPg.toFixed(0)} % de un núcleo, ${(cpuPg / nucleos).toFixed(0)} % del equipo)`);
      }
    };

    if (SOLO !== 'B') await escenario(`A) ${OTS} OT repartidas entre ${USUARIOS} dispositivos (${CONCURRENCIA} OT en paralelo)`, USUARIOS, CONCURRENCIA, OTS);
    if (SOLO !== 'A') await escenario(`B) ${OTS_B} OT desde UN solo dispositivo (cola acumulada sin conexión, 3 OT en paralelo)`, 1, 3, OTS_B);

    // ── Lecturas con todo ese volumen ──
    console.log('\n=== Lecturas con las OT ya cargadas ===');
    const leer = async (titulo: string, ruta: string, cuerpo: unknown) => {
      muestras = [];
      for (let i = 0; i < 10; i++) await llamar(ruta, cuerpo, tokens[0]);
      const t = muestras.map((m) => m.ms);
      console.log(`${titulo.padEnd(34)} p50 ${pct(t, 50).toFixed(0)}ms · p95 ${pct(t, 95).toFixed(0)}ms`);
    };
    await leer('listar servicios (página de 50)', '/operaciones/servicios/list', { page: 1, pageSize: 50 });
    const ejemplo = await env.prisma.servicioLavado.findFirst({ where: { clientUuid: { startsWith: env.marca } }, select: { id: true } });
    if (ejemplo) await leer('detalle de una OT (con evidencias)', '/operaciones/servicios/detail', { id: ejemplo.id });
    await leer('sync pull (cambios)', '/sync/pull', {});

    // ── Verificación en base ──
    const [ots, evid, conPrecio] = await Promise.all([
      env.prisma.servicioLavado.count({ where: { clientUuid: { startsWith: env.marca } } }),
      env.prisma.evidenciaServicio.count({ where: { servicio: { clientUuid: { startsWith: env.marca } } } }),
      env.prisma.servicioLavado.count({ where: { clientUuid: { startsWith: env.marca }, precio: { not: null } } }),
    ]);
    console.log(`\nEn la base quedaron: ${ots} OT, ${evid} evidencias vinculadas, ${conPrecio} con precio congelado.`);
  } finally {
    servidor?.kill();
    await pausa(1500);
    await env.prisma.$executeRawUnsafe(`DELETE FROM "LimiteSolicitud"`).catch(() => undefined);
    await env.cerrar();
  }
}

main().catch((e) => {
  console.error('Fallo la simulación:', e);
  process.exit(1);
});
