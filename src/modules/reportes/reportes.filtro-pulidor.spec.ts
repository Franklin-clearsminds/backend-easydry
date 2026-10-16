import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { AlmacenMemoria, LectorSoloLocal, duckdbDisponible, volcarAlDisco } from '../../../test/integracion/archivo-local.js';
import { ArchivadoService } from '../archivado/archivado.service.js';
import { TABLAS_OPERACION } from '../archivado/archivado.tablas.js';
import { HistoricoService } from '../archivado/historico.service.js';
import { ReportesArchivoService } from './reportes.archivo.js';
import { ReportesService } from './reportes.service.js';
import { REPORTES } from './reportes.definiciones.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
const hayDuckdb = await duckdbDisponible;

/** El reporte de servicios especiales se puede acotar a UN pulidor (el responsable o uno de los asignados), con la base y con el archivo. */
describe('reporte de servicios especiales por pulidor (base real)', () => {
  let env: Entorno;
  let raiz: string;
  let actor: any;
  const ids: Record<string, string> = {};
  const corridas: string[] = [];
  const periodo = { modo: 'RANGO' as const, desde: '2019-01-01', hasta: '2019-12-31' };
  const AHORA = new Date('2020-10-15T12:00:00Z');
  const dto = (extra: Record<string, unknown> = {}) => ({ reporteId: 'servicios-especiales', agenciaIds: [ids.ag1, ids.ag2], periodo, ...extra }) as any;
  const placas = (r: any): string[] => r.grupos.flatMap((g: any) => g.bloques.flatMap((b: any) => b.filas.map((f: any) => f.placa))).sort();

  beforeAll(async () => {
    env = await abrirEntorno();
    raiz = mkdtempSync(join(tmpdir(), 'filtro-pulidor-'));
    actor = await env.actor((await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } })).id);
    const region = await env.region('fp');
    const ag1 = await env.agencia('fp1', { regionId: region.id });
    const ag2 = await env.agencia('fp2', { regionId: region.id });
    const cat = await env.catalogo('fp', { categoria: 'ESPECIAL' });
    const ana = await env.usuario('fp-ana', 'PULIDOR', { agenciaId: ag1.id, regionId: region.id, name: `Ana${env.marca}`, lastname: 'Uno' });
    const beto = await env.usuario('fp-beto', 'PULIDOR', { regionId: region.id, name: `Beto${env.marca}`, lastname: 'Movil' });
    const cris = await env.usuario('fp-cris', 'PULIDOR', { agenciaId: ag2.id, regionId: region.id, name: `Cris${env.marca}`, lastname: 'Dos' });
    Object.assign(ids, { region: region.id, ag1: ag1.id, ag2: ag2.id, ana: ana.id, beto: beto.id, cris: cris.id });
    const esp = (placa: string, estado: string, agenciaId: string, operador: { id: string }, asignados: string[], dia: string) =>
      env.servicioEspecial({ operadorId: operador.id, agenciaId, regionId: region.id, catalogoId: cat.id, estado, placa, asignados, datos: { createdAt: new Date(`2019-${dia}T15:00:00Z`) } });
    await esp('FPA-001', 'Completado', ag1.id, ana, [ana.id], '02-10'); // de Ana
    await esp('FPA-002', 'Completado', ag1.id, ana, [ana.id, beto.id], '03-10'); // de Ana con Beto asignado
    await esp('FPB-003', 'Cancelado', ag2.id, cris, [cris.id, ana.id], '04-10'); // de Cris, con Ana asignada
    await esp('FPC-004', 'Completado', ag2.id, cris, [cris.id], '05-10'); // solo de Cris
    await esp('FPA-005', 'Pendiente', ag1.id, ana, [ana.id], '06-10'); // vivo: se queda en la base
  });

  afterAll(async () => {
    const lotes = await env.prisma.archivadoLote.findMany({ where: { corridaId: { in: corridas } }, select: { id: true } });
    await env.prisma.archivadoLote.deleteMany({ where: { id: { in: lotes.map((l) => l.id) } } });
    await env.prisma.archivadoCorrida.deleteMany({ where: { id: { in: corridas } } });
    await env.cerrar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('el reporte declara el filtro de pulidor y el catálogo lo ofrece', () => {
    expect(REPORTES.find((r) => r.id === 'servicios-especiales')!.extras).toContain('pulidor');
    expect(new ReportesService(env.prisma as never).catalogo(actor).find((r: any) => r.id === 'servicios-especiales')!.extras).toContain('pulidor');
  });

  it('sin el filtro salen todos; con él, los del pulidor como responsable o como asignado', async () => {
    const servicio = new ReportesService(env.prisma as never);
    expect(placas(await servicio.generar(dto(), actor))).toEqual(['FPA-001', 'FPA-002', 'FPA-005', 'FPB-003', 'FPC-004']);
    expect(placas(await servicio.generar(dto({ pulidorId: ids.ana }), actor))).toEqual(['FPA-001', 'FPA-002', 'FPA-005', 'FPB-003']);
    expect(placas(await servicio.generar(dto({ pulidorId: ids.beto }), actor))).toEqual(['FPA-002']);
    expect(placas(await servicio.generar(dto({ pulidorId: ids.cris }), actor))).toEqual(['FPB-003', 'FPC-004']);
    // Se combina con los demás filtros.
    expect(placas(await servicio.generar(dto({ pulidorId: ids.ana, estado: 'Completado' }), actor))).toEqual(['FPA-001', 'FPA-002']);
    expect(placas(await servicio.generar(dto({ pulidorId: ids.ana, agenciaIds: [ids.ag2] }), actor))).toEqual(['FPB-003']);
  });

  it('el reporte muestra a quién se filtró y las opciones traen a los pulidores del alcance', async () => {
    const servicio = new ReportesService(env.prisma as never);
    const r = await servicio.generar(dto({ pulidorId: ids.ana }), actor);
    expect(r.filtros.extras).toContainEqual({ etiqueta: 'Pulidor', valor: expect.stringContaining('Ana') });
    const opciones: any = await servicio.opciones(actor);
    const propios = opciones.pulidores.filter((p: any) => [ids.ana, ids.beto, ids.cris].includes(p.id));
    expect(propios).toHaveLength(3);
    expect(propios.find((p: any) => p.id === ids.ana)).toMatchObject({ agenciaId: ids.ag1 });
    expect(propios.find((p: any) => p.id === ids.beto)).toMatchObject({ agenciaId: null, regionId: ids.region }); // móvil
  });

  it.skipIf(!hayDuckdb)('con los servicios ya archivados, el filtro da lo mismo', async () => {
    const base = new ReportesService(env.prisma as never);
    const esperado = new Map<string, string[]>();
    for (const [clave, extra] of [['todos', {}], ['ana', { pulidorId: ids.ana }], ['beto', { pulidorId: ids.beto }], ['cris', { pulidorId: ids.cris }], ['ana completados', { pulidorId: ids.ana, estado: 'Completado' }]] as const) {
      esperado.set(clave, placas(await base.generar(dto(extra), actor)));
    }
    const almacen = new AlmacenMemoria();
    const r = await new ArchivadoService(env.prisma as never, almacen).ejecutar({
      ahora: AHORA,
      candado: `prueba-${env.marca}`,
      simulacro: false,
      configuracion: TABLAS_OPERACION.filter((t) => t.tabla === 'servicio_especial'),
      tablas: ['servicio_especial'],
      filtroExtra: { servicio_especial: { regionId: ids.region } },
    });
    corridas.push(r.corridaId);
    expect(r.estado, JSON.stringify(r.tablas)).toBe('OK');
    expect(r.tablas.servicio_especial.archivadas).toBe(4); // el pendiente se queda

    volcarAlDisco(almacen, raiz);
    const archivo = new ReportesArchivoService(env.prisma as never, new HistoricoService(env.prisma as never, new LectorSoloLocal(raiz)));
    const conArchivo = new ReportesService(env.prisma as never, undefined, archivo);
    for (const [clave, extra] of [['todos', {}], ['ana', { pulidorId: ids.ana }], ['beto', { pulidorId: ids.beto }], ['cris', { pulidorId: ids.cris }], ['ana completados', { pulidorId: ids.ana, estado: 'Completado' }]] as const) {
      expect(placas(await conArchivo.generar(dto(extra), actor)), clave).toEqual(esperado.get(clave));
    }
  });
});
