/**
 * Pruebas de la web contra el backend REAL y la base local (sin mocks de la API).
 *
 * Uso (desde `frontend-easy-dry`): `npm run test:integracion` (corre este archivo con `vitest.config.web.ts`).
 *
 * Pasos: 1) crea un mundo propio en la base (marca única, usuarios con contraseña conocida), 2) levanta el backend
 * (o reutiliza el que ya responda en el puerto), 3) corre `ng test` con el mundo en `src/testing/mundo.generated.json`,
 * 4) detiene lo que levantó, restaura el marcador vacío y borra el mundo (solo lo creado aquí).
 */
import { expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { abrirEntorno } from '../entorno.js';

const BACKEND = resolve(import.meta.dirname, '../../..');
const FRONT = resolve(BACKEND, '../frontend-easy-dry');
const MUNDO = resolve(FRONT, 'src/testing/mundo.generated.json');
const PUERTO = Number(process.env.PORT ?? 3000);
const CLAVE = 'Prueba123!';
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function responde(): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${PUERTO}/api/v1/sync/ping`, { signal: AbortSignal.timeout(2000) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const env = await abrirEntorno();
  let servidor: ChildProcess | null = null;
  let codigo = 1;
  const maquinas: string[] = [];
  try {
    // ── Mundo ────────────────────────────────────────────────────────────────────────────────────────────────
    const region = await env.region('R1');
    const agencia = await env.agencia('A1', { regionId: region.id });
    const hash = await bcrypt.hash(CLAVE, 4);
    const usuarios: Record<string, { id: string; email: string }> = {};
    const roles: Array<[string, string, Record<string, string>]> = [
      ['superadmin', 'SUPER_ADMIN', {}],
      ['lider', 'LIDER', { agenciaId: agencia.id }],
      ['pulidor', 'PULIDOR', { agenciaId: agencia.id }],
      ['cambiante', 'LIDER', { agenciaId: agencia.id, regionId: region.id }],
      ['admin', 'ADMIN', {}],
      ['supervisor', 'SUPERVISOR', { regionId: region.id }],
      ['soloVer', 'COORD_COMERCIAL', { regionId: region.id }],
      ['tecnico', 'TECNICO', {}],
      ['degradable', 'SUPER_ADMIN', {}],
      ['notificado', 'LIDER', { agenciaId: agencia.id }],
      ['lectorUno', 'LIDER', { agenciaId: agencia.id }],
      ['lectorTodas', 'LIDER', { agenciaId: agencia.id }],
      ['enVivo', 'LIDER', { agenciaId: agencia.id }],
    ];
    for (const [clave, rol, opts] of roles) {
      const u = await env.usuario(clave.toLowerCase(), rol, opts); // el login pasa el correo a minúsculas
      await env.prisma.user.update({ where: { id: u.id }, data: { passwordHash: hash } });
      usuarios[clave] = { id: u.id, email: u.email };
    }
    const rolesBd = await env.prisma.role.findMany({ select: { id: true, namerol: true } });
    const rolId = Object.fromEntries(rolesBd.map((r) => [r.namerol, r.id]));

    const agenciaAjena = await env.agencia('A2', { regionId: region.id });
    const maquinaAjena = await env.maquinaria('M2', { agenciaId: agenciaAjena.id });
    maquinas.push(maquinaAjena.id);

    // Limpiezas: máquinas de la agencia y registros del líder (editar / eliminar / exportar).
    const m1 = await env.maquinaria('M1', { agenciaId: agencia.id });
    maquinas.push(m1.id);
    const maq = await env.prisma.maquinaria.findUniqueOrThrow({ where: { id: m1.id }, select: { codigo: true, nombre: true } });
    const limpieza = async (dias: number, observaciones: string) => {
      const fecha = new Date();
      fecha.setHours(0, 0, 0, 0);
      fecha.setDate(fecha.getDate() - dias);
      const l = await env.prisma.limpiezaMaquinaria.create({
        data: { maquinariaId: m1.id, fecha, tipo: 'PULIDOR', fotos: [], observaciones, registradoPorId: usuarios['lider'].id },
      });
      return l.id;
    };
    const limpiezas = { paraEditar: await limpieza(1, 'Todo en orden'), paraEliminar: await limpieza(2, 'Registro de prueba'), paraExportar: await limpieza(3, 'Con "comillas"') };

    // Notificaciones guardadas: cada prueba que las modifica usa su propio usuario.
    const n = (clave: string, tipo: any, titulo: string, mensaje: string, entidadTipo: string, leida: boolean, min: number) =>
      env.prisma.notification
        .create({ data: { userId: usuarios[clave].id, tipo, titulo, mensaje, entidadTipo, leida, createdAt: new Date(Date.now() - min * 60000) } })
        .then((x) => x.id);
    const notificaciones: Record<string, string[]> = {
      notificado: [
        await n('notificado', 'STOCK_CRITICO', 'Stock crítico', 'Shampoo bajo', 'INSUMO', false, 1),
        await n('notificado', 'INCIDENCIA_RESUELTA', 'Reparado', 'OK', 'MAQUINARIA', true, 2),
        await n('notificado', 'USUARIO_ACTUALIZADO', 'Permisos de rol actualizados', 'Se actualizaron los permisos', 'ROL', false, 3),
      ],
      lectorUno: [await n('lectorUno', 'STOCK_CRITICO', 'Stock crítico', 'Shampoo bajo', 'INSUMO', false, 1)],
      lectorTodas: [
        await n('lectorTodas', 'STOCK_CRITICO', 'Stock crítico', 'Shampoo bajo', 'INSUMO', false, 1),
        await n('lectorTodas', 'STOCK_CRITICO', 'Stock crítico 2', 'Jabón bajo', 'INSUMO', false, 2),
      ],
    };

    writeFileSync(
      MUNDO,
      JSON.stringify({ disponible: true, clave: CLAVE, usuarios, rolId, agenciaId: agencia.id, regionId: region.id, maquinaria: { id: m1.id, ...maq }, maquinariaAjena: { id: maquinaAjena.id, codigo: maquinaAjena.codigo }, limpiezas, notificaciones, marca: env.marca }, null, 2),
    );

    // ── Backend ──────────────────────────────────────────────────────────────────────────────────────────────
    if (await responde()) {
      console.log(`[web] Reutilizando el backend que ya responde en el puerto ${PUERTO}.`);
      // Karma sirve las pruebas desde otro origen: un backend de desarrollo con su CORS_ORIGIN normal las rechaza (y limita el login a 10/min).
      const preflight = await fetch(`http://localhost:${PUERTO}/api/v1/auth/login`, {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:3001', 'Access-Control-Request-Method': 'POST' },
      }).catch(() => null);
      if (!preflight?.headers.get('access-control-allow-origin')) {
        throw new Error(
          `El backend del puerto ${PUERTO} no acepta peticiones de Karma (http://localhost:3001). Detén ese servidor (por ejemplo, el "pnpm start" de desarrollo) y vuelve a ejecutar: la suite levanta el suyo con la configuración de pruebas.`,
        );
      }
    } else {
      console.log('[web] Compilando y levantando el backend…');
      const build = spawnSync('npx', ['nest', 'build'], { cwd: BACKEND, stdio: 'inherit', shell: true });
      if (build.status !== 0) throw new Error('No compiló el backend');
      servidor = spawn('node', ['dist/main.js'], { cwd: BACKEND, stdio: ['ignore', 'ignore', 'inherit'], env: {
          ...process.env,
          PORT: String(PUERTO),
          // Karma sirve las pruebas desde otro origen, y la suite inicia sesión muchas veces seguidas desde la misma IP.
          CORS_ORIGIN: 'http://localhost:3001,http://127.0.0.1:3001,http://localhost:9876,http://127.0.0.1:9876',
          AUTH_RATE_LIMIT: '1000',
        },
      });
      for (let i = 0; i < 60 && !(await responde()); i++) await dormir(1000);
      if (!(await responde())) throw new Error('El backend no respondió a tiempo');
    }

    // ── ng test ──────────────────────────────────────────────────────────────────────────────────────────────
    const ng = spawnSync('npx', ['ng', 'test', '--watch=false', '--browsers=ChromeHeadless'], { cwd: FRONT, stdio: 'inherit', shell: true });
    codigo = ng.status ?? 1;
  } finally {
    if (servidor) {
      spawnSync('taskkill', ['/pid', String(servidor.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    writeFileSync(MUNDO, JSON.stringify({ disponible: false }, null, 2));
    // La línea de tiempo de la maquinaria es inmutable (un trigger bloquea el DELETE, incluso por SQL). El backend real
    // registra ahí eventos de las máquinas del mundo; sin quitarlos no se podrían borrar la máquina, la agencia ni los
    // usuarios. Solo para ESTAS máquinas, dentro de una transacción: si algo falla, el trigger queda como estaba.
    if (maquinas.length) {
      const lista = maquinas.map((id) => `'${id}'`).join(',');
      await env.prisma.$transaction([
        env.prisma.$executeRawUnsafe('ALTER TABLE "MaquinariaEvento" DISABLE TRIGGER "maquinaria_evento_inmutable_trg"'),
        env.prisma.$executeRawUnsafe(`DELETE FROM "MaquinariaEvento" WHERE "maquinariaId" IN (${lista})`),
        env.prisma.$executeRawUnsafe('ALTER TABLE "MaquinariaEvento" ENABLE TRIGGER "maquinaria_evento_inmutable_trg"'),
      ]);
    }
    await env.cerrar();
  }
  return codigo;
}

// Se ejecuta con vitest (maneja los decoradores de Nest): `vitest run --config vitest.config.web.ts`.
it('ng test contra el backend real', async () => {
  expect(await main()).toBe(0);
});
