import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogosService } from './catalogos.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Datos de partida, creados por esta prueba:
 *  - Servicios: EXPRESS (GENERAL), PREMIUM (GENERAL), PULIDO (ESPECIAL), EXTRA1 (EXTRA), FUERA (GENERAL, de ninguna sede).
 *  - Sede NORTE: tiene EXPRESS y PULIDO, con servicios especiales.
 *  - Sede SIN-ESP: tiene EXPRESS y PULIDO, pero no atiende especiales.
 *  - Sede VACIA: sin servicios configurados.
 * Todo se consulta con `search: marca` para que el catálogo real (40 servicios) no se mezcle.
 */
describe('CatalogosService.listServicios — alcance (base real)', () => {
  let env: Entorno;
  let service: CatalogosService;
  let express: any;
  let premium: any;
  let pulido: any;
  let extra1: any;
  let fuera: any;
  let norte: any;
  let sinEsp: any;
  let vacia: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new CatalogosService(env.prisma as never);

    express = await env.catalogo('EXPRESS');
    premium = await env.catalogo('PREMIUM');
    pulido = await env.catalogo('PULIDO', { categoria: 'ESPECIAL' });
    extra1 = await env.catalogo('EXTRA1', { categoria: 'EXTRA' as never });
    fuera = await env.catalogo('FUERA');

    const configurar = (a: { id: string }, ids: number[], nombres: string[], especiales: boolean) =>
      env.prisma.agencia.update({
        where: { id: a.id },
        data: { servicioIds: ids, serviciosNombres: nombres, tieneServiciosEspeciales: especiales },
      });
    norte = await env.agencia('NORTE');
    await configurar(norte, [express.id, pulido.id], [express.nombre], true);
    sinEsp = await env.agencia('SIN-ESP');
    await configurar(sinEsp, [express.id, pulido.id], [], false);
    vacia = await env.agencia('VACIA');
    await configurar(vacia, [], [], true);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const buscar = async (extraDto: Record<string, unknown>, ctx: { namerol?: string; agenciaId?: string }) => {
    const r: any = await service.listServicios({ page: 1, pageSize: 100, search: env.marca, ...extraDto } as any, ctx);
    return { respuesta: r, ids: (r.items ?? r.data ?? []).map((s: any) => s.id).sort((a: number, b: number) => a - b) };
  };
  const ordenados = (...s: Array<{ id: number }>) => s.map((x) => x.id).sort((a, b) => a - b);

  it('Admin y Súper Admin ven todo el catálogo aunque tengan sede', async () => {
    for (const namerol of ['ADMIN', 'SUPER_ADMIN']) {
      const { ids } = await buscar({}, { namerol, agenciaId: norte.id });
      expect(ids).toEqual(ordenados(express, premium, pulido, extra1, fuera));
    }
  });

  it('cualquier otro rol con sede queda limitado a su sede, por id y por nombre', async () => {
    const { ids, respuesta } = await buscar({}, { namerol: 'LAVADOR', agenciaId: norte.id });
    expect(ids).toEqual(ordenados(express, pulido)); // PREMIUM, EXTRA1 y FUERA no son de la sede
    expect(respuesta.agencia).toMatchObject({ nombre: norte.nombre, servicioIds: [express.id, pulido.id], tieneServiciosEspeciales: true });
  });

  it('si la sede no atiende especiales solo se ven los generales', async () => {
    const { ids } = await buscar({}, { namerol: 'LAVADOR', agenciaId: sinEsp.id });
    expect(ids).toEqual(ordenados(express)); // PULIDO es ESPECIAL: se oculta
  });

  it('una sede sin servicios configurados no ve nada (nunca el catálogo global)', async () => {
    const { ids } = await buscar({}, { namerol: 'LAVADOR', agenciaId: vacia.id });
    expect(ids).toEqual([]);
  });

  it('un rol de sede sin agencia no ve nada; otro rol sin sede ve todo', async () => {
    expect((await buscar({}, { namerol: 'APROBADOR' })).ids).toEqual([]);
    expect((await buscar({}, { namerol: 'COORD_BODEGA' })).ids).toEqual(ordenados(express, premium, pulido, extra1, fuera));
  });

  it('la agencia del usuario manda: el cliente no puede pedir los servicios de otra sede', async () => {
    const { ids } = await buscar({ agenciaId: sinEsp.id }, { namerol: 'LAVADOR', agenciaId: norte.id });
    expect(ids).toEqual(ordenados(express, pulido)); // los de NORTE, no los de SIN-ESP
  });

  it('ADMIN ve todo el catálogo y APROBADOR queda acotado a su sede', async () => {
    expect((await buscar({}, { namerol: 'ADMIN', agenciaId: norte.id })).ids).toHaveLength(5);
    expect((await buscar({}, { namerol: 'APROBADOR', agenciaId: norte.id })).ids).toEqual(ordenados(express, pulido));
  });

  it('un administrador sí puede acotar por una agencia que pide', async () => {
    const { ids } = await buscar({ agenciaId: sinEsp.id }, { namerol: 'ADMIN' });
    expect(ids).toEqual(ordenados(express));
  });

  it('categoria admite varias separadas por coma (especiales + extras)', async () => {
    const { ids } = await buscar({ categoria: 'especial, extra' }, { namerol: 'ADMIN' });
    expect(ids).toEqual(ordenados(pulido, extra1));
  });
});

describe('CatalogosService.siguienteCodigo (base real)', () => {
  let env: Entorno;
  let service: CatalogosService;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new CatalogosService(env.prisma as never);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  /** El mayor número que ya existe en el catálogo real para un prefijo. */
  const mayorExistente = async (prefijo: string) => {
    const filas = await env.prisma.catalogoServicio.findMany({ where: { codigo: { startsWith: `${prefijo}-` } }, select: { codigo: true } });
    return filas.reduce((max, s) => {
      const n = Number(/^[A-Z]+-(\d+)$/.exec(s.codigo)?.[1]);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
  };

  it('generales: mayor número existente + 1 con ceros a la izquierda', async () => {
    const esperado = `SER-${String((await mayorExistente('SER')) + 1).padStart(3, '0')}`;
    expect(await service.siguienteCodigo('GENERAL')).toEqual({ codigo: esperado });
  });

  it('especiales y extras usan el prefijo ESP', async () => {
    const esperado = `ESP-${String((await mayorExistente('ESP')) + 1).padStart(3, '0')}`;
    expect(await service.siguienteCodigo('EXTRA')).toEqual({ codigo: esperado });
    expect(await service.siguienteCodigo('ESPECIAL')).toEqual({ codigo: esperado });
  });

  it('el código sugerido nunca está ya en uso', async () => {
    for (const categoria of ['GENERAL', 'EXTRA']) {
      const { codigo } = await service.siguienteCodigo(categoria);
      expect(await env.prisma.catalogoServicio.count({ where: { codigo } })).toBe(0);
    }
  });
});
