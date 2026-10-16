import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SyncService } from './sync.service.js';
import { OperacionesService } from '../operaciones/operaciones.service.js';
import { ServiciosEspecialesService } from '../operaciones/servicios-especiales.service.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import type { ConsultaArchivo } from '../archivado/archivo-lector.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** Cuenta cuántas veces se consultó el archivo. */
class LectorContador extends LectorSoloLocal {
  llamadas = 0;
  override async consultar(c: ConsultaArchivo) {
    this.llamadas++;
    return super.consultar(c);
  }
}

/**
 * El sync evita duplicados mirando si el `clientUuid` ya existe. Un servicio ARCHIVADO ya no está en la base: si un teléfono
 * reenviara su creación, se crearía de nuevo. Con la capa de archivo se reconoce como ya existente.
 */
describe.skipIf(!(await duckdbDisponible))('sync: idempotencia contra servicios archivados (base real + DuckDB sobre Parquet locales)', () => {
  let env: Entorno;
  let raiz: string;
  let lector: LectorContador;
  let conArchivo: SyncService;
  let sinArchivo: SyncService;
  /** Igual que `conArchivo`, pero cuenta las consultas a la tabla de lotes (lo que el filtro de corte ahorra en cada creación). */
  let conContador: SyncService;
  const consultasDeLotes = { n: 0 };
  let lider: any;
  let bahia: any;
  let catalogo: any;
  let lavadoViejo: { id: string; uuid: string };
  let especialViejo: { id: string; uuid: string; codigoSE: string };
  const corridas: string[] = [];
  const MARCA_VIEJA = Date.parse('2019-03-05T15:00:00Z');

  const nuevoSync = (historico?: HistoricoService) =>
    new SyncService(env.prisma as never, new OperacionesService(env.prisma as never), new ServiciosEspecialesService(env.prisma as never), env.storage(), undefined, historico);

  const crearLavado = (clientUuid: string, timestamp: number) => ({
    mutationId: `${clientUuid}-op`,
    clientUuid,
    entity: 'servicio_lavado',
    action: 'CREATE',
    timestamp,
    data: { placa: `S${env.marca.slice(1, 5).toUpperCase()}-${Math.floor(Math.random() * 900 + 100)}`, bahiaId: bahia.id, servicioCatalogoId: catalogo.id },
  });
  let superAdminId: string;
  const empujar = (servicio: SyncService, mutacion: Record<string, unknown>, userId?: string) => servicio.processPush({ mutations: [mutacion] }, userId ?? lider.id).then((r: any) => r.results[0]);

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'sync-archivo-'));
    const region = await env.region('S1');
    const agencia = await env.agencia('S1', { regionId: region.id });
    bahia = await env.bahia('S1', agencia.id);
    catalogo = await env.catalogo('SYNC');
    await env.prisma.agencia.update({ where: { id: agencia.id }, data: { servicioIds: [catalogo.id] } });
    lider = await env.usuario('lider', 'LIDER', { agenciaId: agencia.id });
    // El rol LIDER no crea servicios especiales: esas mutaciones las empuja el Super Admin sembrado.
    superAdminId = (await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } })).id;

    const uuidLavado = `${env.marca}-uuid-lavado-viejo`;
    const l = await env.servicioLavado({ bahiaId: bahia.id, operadorId: lider.id, catalogoId: catalogo.id, estado: 'APROBADO', horaIngreso: new Date(MARCA_VIEJA), horaSalida: new Date(MARCA_VIEJA + 40 * 60000), placa: 'OLD-111', datos: { clientUuid: uuidLavado } });
    lavadoViejo = { id: l.id, uuid: uuidLavado };
    const uuidEspecial = `${env.marca}-uuid-especial-viejo`;
    const e = await env.servicioEspecial({ operadorId: lider.id, agenciaId: agencia.id, regionId: region.id, catalogoId: catalogo.id, estado: 'Completado', placa: 'OLD-222', datos: { clientUuid: uuidEspecial, createdAt: new Date('2019-04-04T15:00:00Z') } });
    const filaE = await env.prisma.servicioEspecial.findUniqueOrThrow({ where: { id: e.id }, select: { codigoSE: true } });
    especialViejo = { id: e.id, uuid: uuidEspecial, codigoSE: filaE.codigoSE };

    // Antes de archivar, el sync ya los reconoce desde la base.
    const sync = nuevoSync();
    expect((await empujar(sync, crearLavado(uuidLavado, MARCA_VIEJA))).status).toBe('ALREADY_EXISTS');

    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: new Date('2020-10-15T12:00:00Z'),
      simulacro: false,
      candado: `prueba-${env.marca}`,
      configuracion: TABLAS_OPERACION.filter((t) => ['servicio_lavado', 'servicio_especial'].includes(t.tabla)),
      tablas: ['servicio_lavado', 'servicio_especial'],
      filtroExtra: { servicio_lavado: { clientUuid: { startsWith: env.marca } }, servicio_especial: { codigoSE: { contains: env.marca } } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(r.tablas)).toBe('OK');
    expect(await env.prisma.servicioLavado.count({ where: { id: l.id } })).toBe(0); // ya no está en la base
    expect(await env.prisma.servicioEspecial.count({ where: { id: e.id } })).toBe(0);

    volcarAlDisco(almacen, raiz);
    lector = new LectorContador(raiz);
    conArchivo = nuevoSync(new HistoricoService(env.prisma as never, lector));
    sinArchivo = nuevoSync();
    const prismaContador = new Proxy(env.prisma, {
      get(objetivo, propiedad, receptor) {
        if (propiedad === 'archivadoLote') {
          return new Proxy(objetivo.archivadoLote, {
            get(delegado, nombre) {
              if (nombre === 'findMany') return (...args: any[]) => (consultasDeLotes.n++, (delegado as any).findMany(...args));
              const v = (delegado as any)[nombre];
              return typeof v === 'function' ? v.bind(delegado) : v;
            },
          });
        }
        const v = Reflect.get(objetivo, propiedad, receptor);
        return typeof v === 'function' ? v.bind(objetivo) : v;
      },
    });
    conContador = nuevoSync(new HistoricoService(prismaContador as never, lector));
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('reenviar la creación de un servicio de lavado ya archivado devuelve ALREADY_EXISTS con su id y no crea otro', async () => {
    const r = await empujar(conArchivo, crearLavado(lavadoViejo.uuid, MARCA_VIEJA));
    expect(r.status).toBe('ALREADY_EXISTS');
    expect(r.serverAssignedId).toBe(lavadoViejo.id);
    expect(typeof r.syncedAt).toBe('string');
    expect(await env.prisma.servicioLavado.count({ where: { clientUuid: lavadoViejo.uuid } })).toBe(0);
  });

  it('lo mismo con un servicio especial archivado, por clientUuid y por su código de servicio', async () => {
    const porUuid = await empujar(conArchivo, { mutationId: `${env.marca}-esp-1`, clientUuid: especialViejo.uuid, entity: 'servicio_especial', action: 'CREATE', timestamp: Date.parse('2019-04-04T15:00:00Z'), data: { placa: 'OLD-222', tipoServicio: 'Pulido' } }, superAdminId);
    expect(porUuid.status).toBe('ALREADY_EXISTS');
    expect(porUuid.serverAssignedId).toBe(especialViejo.id);

    // Un teléfono distinto que reenvía la misma orden con otro uuid pero el mismo código.
    const porCodigo = await empujar(conArchivo, { mutationId: `${env.marca}-esp-2`, clientUuid: `${env.marca}-otro-uuid`, entity: 'servicio_especial', action: 'CREATE', timestamp: Date.parse('2019-04-04T15:00:00Z'), data: { placa: 'OLD-222', tipoServicio: 'Pulido', codigoSE: especialViejo.codigoSE } }, superAdminId);
    expect(porCodigo.status).toBe('ALREADY_EXISTS');
    expect(porCodigo.serverAssignedId).toBe(especialViejo.id);
    expect(await env.prisma.servicioEspecial.count({ where: { codigoSE: especialViejo.codigoSE } })).toBe(0);
  });

  it('una creación nueva y reciente NO consulta el archivo (casi todas lo son: no puede costar nada)', async () => {
    const antes = lector.llamadas;
    const lotesAntes = consultasDeLotes.n;
    const uuid = `${env.marca}-uuid-nuevo-reciente`;
    const r = await empujar(conContador, crearLavado(uuid, Date.now()));
    expect(r.status).not.toBe('ALREADY_EXISTS');
    expect(lector.llamadas).toBe(antes);
    expect(consultasDeLotes.n).toBe(lotesAntes); // ni siquiera pregunta por los lotes: un servicio reciente no pudo archivarse
    if (r.serverAssignedId) env.rastrear('ServicioLavado', r.serverAssignedId);
  });

  it('una mutación antigua cuyo uuid no está archivado consulta el archivo, no lo encuentra y sigue su curso', async () => {
    const antes = lector.llamadas;
    const lotesAntes = consultasDeLotes.n;
    const r = await empujar(conContador, crearLavado(`${env.marca}-uuid-desconocido`, MARCA_VIEJA));
    expect(consultasDeLotes.n).toBeGreaterThan(lotesAntes);
    expect(lector.llamadas).toBeGreaterThan(antes);
    expect(r.status).not.toBe('ALREADY_EXISTS');
    if (r.serverAssignedId) env.rastrear('ServicioLavado', r.serverAssignedId);
  });

  it('si el archivo no responde, la sincronización sigue (no se tumba por eso)', async () => {
    const roto = new HistoricoService(env.prisma as never, { consultar: async () => Promise.reject(new Error('DuckDB no disponible')), contar: async () => 0, contarPor: async () => ({}) });
    const r = await empujar(nuevoSync(roto), crearLavado(`${env.marca}-uuid-con-archivo-roto`, MARCA_VIEJA));
    expect(r.status).not.toBe('FAILED');
    if (r.serverAssignedId) env.rastrear('ServicioLavado', r.serverAssignedId);
  });

  it('sin la capa de archivo se crearía de nuevo: el problema que esta capa evita', async () => {
    const r = await empujar(sinArchivo, crearLavado(lavadoViejo.uuid, MARCA_VIEJA));
    expect(r.status).not.toBe('ALREADY_EXISTS'); // se vuelve a crear con el mismo clientUuid
    if (r.serverAssignedId) env.rastrear('ServicioLavado', r.serverAssignedId);
    expect(await env.prisma.servicioLavado.count({ where: { clientUuid: lavadoViejo.uuid } })).toBe(1);
  });
});
