/**
 * Mide cuánto tarda guardar una firma en un informe de inspección y de dónde sale el tiempo (servicio directo contra la base local,
 * sin red): carga del informe, validación del sello, cifrado de la imagen, escritura y detalle devuelto.
 *
 *   npx tsx test/carga/informe-firma.ts
 *   FIRMA_KB=60 NOVEDADES=15 FOTOS=5 REPETICIONES=15 npx tsx test/carga/informe-firma.ts
 */
import { randomBytes } from 'node:crypto';
import { InformesInspeccionService } from '../../src/modules/auditorias/informes.service.js';
import { SellosService } from '../../src/modules/auditorias/sellos.service.js';
import { CryptoService } from '../../src/common/crypto/crypto.service.js';
import { abrirEntorno } from '../integracion/entorno.js';

const FIRMA_KB = Number(process.env.FIRMA_KB || 40);
const NOVEDADES = Number(process.env.NOVEDADES || 12);
const FOTOS = Number(process.env.FOTOS || 5);
const REPETICIONES = Number(process.env.REPETICIONES || 12);
const PASS = 'Taller#Seguro81';

const ms = (n: number) => `${n.toFixed(0)} ms`;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const resumen = (nombre: string, xs: number[]) => console.log(`${nombre.padEnd(46)} p50 ${ms(pct(xs, 50)).padStart(8)} · p95 ${ms(pct(xs, 95)).padStart(8)} · máx ${ms(Math.max(...xs)).padStart(8)}`);

async function main() {
  const env = await abrirEntorno();
  try {
    const crypto = new CryptoService({ get: (k: string) => process.env[k] } as never);
    const sellos = new SellosService(env.prisma as never, crypto);
    const informes = new InformesInspeccionService(env.prisma as never, sellos, crypto);
    const region = await env.region('firma');
    const agencia = await env.agencia('firma', { regionId: region.id });
    const admin = await env.actor((await env.usuario('admin', 'ADMIN')).id);
    const inspector = await env.actor((await env.usuario('inspector', 'APROBADOR', { agenciaId: agencia.id })).id);
    const png = `data:image/png;base64,${randomBytes(Math.round((FIRMA_KB * 1024 * 3) / 4)).toString('base64')}`;
    console.log(`Firma de prueba: ${(png.length / 1024).toFixed(0)} KB de texto · informe con ${NOVEDADES} novedades × ${FOTOS} fotos, 8 actividades y 6 planes.\n`);

    const t0 = performance.now();
    const sello = await sellos.crear({ nombre: 'Carlos', apellido: `Mora ${env.marca}`, password: PASS }, admin);
    env.rastrear('SelloJefeTaller', sello.id);
    console.log(`Crear un sello (hash de contraseña): ${ms(performance.now() - t0)}`);

    const contenido = () => ({
      agenciaId: agencia.id,
      destinatarioNombre: 'Jefe de taller',
      asunto: 'Visita mensual',
      antecedentes: 'Texto de antecedentes '.repeat(20),
      desarrollo: 'Texto de desarrollo '.repeat(40),
      calificacion: 'BUENO',
      novedades: Array.from({ length: NOVEDADES }, (_, i) => ({ titulo: `Novedad ${i}`, categoria: 'MAQUINARIA', descripcion: 'Detalle '.repeat(15), fotos: Array.from({ length: FOTOS }, (_, k) => `agencias/x/auditorias/informes/borrador/foto_${i}_${k}.jpg`) })),
      actividades: Array.from({ length: 8 }, (_, i) => ({ nombre: `Actividad ${i}`, fotos: [`agencias/x/auditorias/informes/borrador/act_${i}.jpg`] })),
      planes: Array.from({ length: 6 }, (_, i) => ({ problema: `Problema ${i}`, accionRequerida: 'Acción '.repeat(8) })),
    });

    const validar: number[] = [];
    const firmarResp: number[] = [];
    const firmarJefe: number[] = [];
    const detalle: number[] = [];
    const cargaFirmas: number[] = [];
    const guardarSinCambios: number[] = [];
    const guardarUnCambio: number[] = [];

    for (let i = 0; i < REPETICIONES; i++) {
      const informe = await informes.create(contenido() as never, inspector);
      env.rastrear('InformeInspeccion', informe.id);

      // Lo que hace la pantalla antes de abrir cada firma: guardar el borrador completo.
      const tal = informe as any;
      const reenviar = () => ({ ...contenido(), id: informe.id, novedades: tal.novedades.map((n: any, k: number) => ({ id: n.id, titulo: n.titulo, categoria: n.categoria, descripcion: n.descripcion, area: n.area, fotos: n.fotos })), actividades: tal.actividades.map((x: any) => ({ id: x.id, nombre: x.nombre, descripcion: x.descripcion, fotos: x.fotos })), planes: tal.planes.map((x: any) => ({ id: x.id, problema: x.problema, accionRequerida: x.accionRequerida, evidenciaCumplimiento: x.evidenciaCumplimiento })) });
      let b = performance.now();
      await informes.update(reenviar() as never, inspector);
      guardarSinCambios.push(performance.now() - b);
      b = performance.now();
      const cambio = reenviar();
      (cambio.novedades[0] as any).titulo = `Novedad editada ${i}`;
      await informes.update(cambio as never, inspector);
      guardarUnCambio.push(performance.now() - b);

      let a = performance.now();
      await informes.validarSello({ informeId: informe.id, selloId: sello.id, password: PASS }, inspector);
      validar.push(performance.now() - a);

      a = performance.now();
      await informes.firmar({ informeId: informe.id, tipo: 'RESPONSABLE', nombre: 'Ana Ruiz', imagen: png }, inspector);
      firmarResp.push(performance.now() - a);

      a = performance.now();
      const conJefe = await informes.firmar({ informeId: informe.id, tipo: 'JEFE_TALLER', imagen: png }, inspector);
      firmarJefe.push(performance.now() - a);

      a = performance.now();
      await informes.detail(informe.id, inspector);
      detalle.push(performance.now() - a);

      a = performance.now();
      await env.prisma.informeInspeccion.findFirst({ where: { id: informe.id }, include: { firmas: true, novedades: true, actividades: true, planes: true, historial: true } });
      cargaFirmas.push(performance.now() - a);

      if (i === 0) console.log(`Tamaño de la respuesta de "firmar": ${(JSON.stringify(conJefe).length / 1024).toFixed(0)} KB`);
    }

    console.log('');
    resumen('Guardar el borrador SIN cambios (antes de firmar)', guardarSinCambios);
    resumen('Guardar el borrador con 1 cambio', guardarUnCambio);
    resumen('Validar contraseña del jefe de taller', validar);
    resumen('Firmar (responsable) — total', firmarResp);
    resumen('Firmar (jefe de taller, con 2 firmas ya) — total', firmarJefe);
    resumen('Solo leer el detalle del informe', detalle);
    resumen('Solo la consulta a la base (informe + relaciones)', cargaFirmas);
  } finally {
    await env.cerrar();
  }
}

main().catch((e) => {
  console.error('Fallo la medición:', e);
  process.exit(1);
});
