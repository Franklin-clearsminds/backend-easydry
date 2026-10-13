import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListDespachosDto } from './dto/movimientos.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): el listado de despachos (SQL con alcance por rol).
 *
 * Mundo de la prueba, todo creado aquí. Región R1 (agencias A1 y A2, Bodega B-R1) y región R2 (agencia A3).
 * Despachos D1…D7 (D1 el más antiguo), más una compra que NO es un despacho y nunca debe aparecer:
 *   D1 agencia   EN_TRANSITO  a A1        despacha Coord. Bodega · lleva 3 de JABON
 *   D2 agencia   RECIBIDO     a A1        despacha Coord. Bodega · recibe Lía
 *   D3 agencia   RECHAZADO    a A2        (el destino solo viene en el texto "[id]") · motivo "derrame en tránsito"
 *   D4 pulidor   EN_TRANSITO  a Paco      recibe Paco
 *   D5 bodega    EN_TRANSITO  a B-R1
 *   D6 agencia   EN_TRANSITO  de A1 a A3  (traslado entre agencias)
 *   D7 agencia   EN_TRANSITO  a A3
 * Todo se consulta con `numeroGuia: marca`: la base real tiene cientos de despachos.
 */
const DIA = 24 * 60 * 60 * 1000;
const hace = (dias: number) => new Date(Date.now() - dias * DIA);

describe('InventarioService.listDespachos (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let a1: any;
  let a2: any;
  let a3: any;
  let bodR1: any;
  let jabon: any;
  const ids: Record<string, string> = {};
  const d: Record<string, string> = {}; // despachos por nombre
  const actores: Record<string, any> = {};

  const nombres = (r: any) => (Array.isArray(r) ? r : r.items).map((x: any) => Object.entries(d).find(([, id]) => id === x.id)?.[0]);
  const lista = (dto: Record<string, unknown>, usuarioId?: string) =>
    service.listDespachos({ numeroGuia: env.marca, ...dto } as any, usuarioId);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);

    const r1 = await env.region('R1');
    const r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    bodR1 = await env.bodega('R1', { regionId: r1.id });

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, { name: clave, ...opts });
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('admin', 'ADMIN');
    await crear('superAdmin', 'SUPER_ADMIN');
    await crear('coord', 'COORD_BODEGA');
    await crear('lia', 'LIDER', { agenciaId: a1.id });
    await crear('paco', 'PULIDOR');
    await crear('otroPulidor', 'PULIDOR');
    await crear('asistente', 'ASISTENTE_BODEGA', { bodegaId: bodR1.id, regionId: r1.id });

    jabon = await env.insumo('JABON');
    const mov = async (clave: string, extra: Record<string, unknown>, dias: number) => {
      d[clave] = (
        await env.movimiento({
          numeroGuia: `${env.marca}-${clave}`,
          usuarioDespachaId: ids.coord,
          fechaDespacho: hace(dias),
          ...extra,
        } as never)
      ).id;
    };
    await mov('D1', { tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'EN_TRANSITO', destinoAgenciaId: a1.id, destinoUbicacion: `Agencia Centro [${a1.id}]`, detalle: { insumoId: jabon.id, cantidadEnviada: 3 } }, 7);
    await mov('D2', { tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'RECIBIDO', destinoAgenciaId: a1.id, destinoUbicacion: `Agencia Centro [${a1.id}]`, usuarioRecibeId: ids.lia }, 6);
    await mov('D3', { tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'RECHAZADO', destinoUbicacion: `Agencia Dos [${a2.id}]`, observaciones: 'Envío RECHAZADO. RECHAZO: derrame en tránsito' }, 5);
    await mov('D4', { tipo: 'DESPACHO_PULIDOR', estadoDespacho: 'EN_TRANSITO', destinoPulidorId: ids.paco, usuarioRecibeId: ids.paco, destinoUbicacion: 'Pulidor móvil' }, 4);
    await mov('D5', { tipo: 'DESPACHO_BODEGA', estadoDespacho: 'EN_TRANSITO', destinoBodegaId: bodR1.id, destinoUbicacion: `Bodega Regional [${bodR1.id}]` }, 3);
    await mov('D6', { tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'EN_TRANSITO', origenAgenciaId: a1.id, origenUbicacion: `Agencia Centro [${a1.id}]`, destinoAgenciaId: a3.id, destinoUbicacion: `Agencia Tres [${a3.id}]` }, 2);
    await mov('D7', { tipo: 'DESPACHO_AGENCIA', estadoDespacho: 'EN_TRANSITO', destinoAgenciaId: a3.id, destinoUbicacion: `Agencia Tres [${a3.id}]` }, 1);
    await env.movimiento({ numeroGuia: `${env.marca}-COMPRA`, tipo: 'COMPRA_PROVEEDOR', estadoDespacho: 'RECIBIDO', usuarioDespachaId: ids.coord });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('formato y compatibilidad', () => {
    it('sin página ni tamaño (app móvil) devuelve un ARREGLO con hasta 100 (antes 500), solo despachos', async () => {
      const r: any = await lista({});
      expect(Array.isArray(r)).toBe(true);
      expect(nombres(r)).toHaveLength(7); // la compra no es un despacho
      expect(r.length).toBeLessThanOrEqual(100);
      const sinFiltro: any = await service.listDespachos({} as any);
      expect(sinFiltro.length).toBeLessThanOrEqual(100);
    });

    it('con página responde el formato estándar y recorta a 100', async () => {
      const r: any = await lista({ page: 2, pageSize: 3 });
      expect(r).toMatchObject({ total: 7, page: 2, pageSize: 3, totalPages: 3, hasNextPage: true, hasPrevPage: true });
      expect(r.items).toHaveLength(3);
      expect(r.data).toBe(r.items);
      expect(((await lista({ pageSize: 200 })) as any).pageSize).toBe(100);
    });

    it('solo con pageSize también es paginado (objeto, no arreglo)', async () => {
      const r: any = await lista({ pageSize: 50, estadoDespacho: 'CANCELADO' });
      expect(Array.isArray(r)).toBe(false);
      expect(r).toMatchObject({ total: 0, page: 1, pageSize: 50, items: [] });
    });

    it('el DTO no fija page/pageSize/sortField y conserva agenciaId y agenciaDestinoId (el validador global los descartaba)', async () => {
      const vacio: any = plainToInstance(ListDespachosDto, {});
      expect(vacio.page).toBeUndefined();
      expect(vacio.pageSize).toBeUndefined();
      expect(vacio.sortField).toBeUndefined();
      expect(await validate(vacio)).toHaveLength(0);
      const con: any = plainToInstance(ListDespachosDto, { agenciaId: 'a1', agenciaDestinoId: 'a2', pageSize: 200, page: '2', incluirResumen: true });
      expect(await validate(con)).toHaveLength(0);
      expect(con).toMatchObject({ agenciaId: 'a1', agenciaDestinoId: 'a2', page: 2 });
    });

    it('obtenerDespachosPendientes sigue devolviendo un arreglo', async () => {
      expect(Array.isArray(await service.obtenerDespachosPendientes(ids.superAdmin))).toBe(true);
    });
  });

  describe('orden', () => {
    it('por defecto lo más reciente primero, con desempate por id', async () => {
      expect(nombres(await lista({ page: 1 }))).toEqual(['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1']);
    });

    it('ordena por columnas permitidas', async () => {
      expect(nombres(await lista({ page: 1, sortField: 'guia', sortOrder: 'asc' }))).toEqual(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7']);
      expect(nombres(await lista({ page: 1, sortField: 'guia', sortOrder: 'desc' }))).toEqual(['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1']);
      expect(nombres(await lista({ page: 1, sortField: 'estado', sortOrder: 'desc' }))).toHaveLength(7);
    });

    it('un campo no permitido o malicioso no llega al SQL', async () => {
      const r = await lista({ page: 1, sortField: 'numeroGuia; DROP TABLE "User"--', sortOrder: 'asc' });
      expect(nombres(r)).toEqual(['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1']); // cae al orden por defecto
      expect(await env.prisma.user.count({ where: { id: ids.admin } })).toBe(1); // la tabla sigue ahí
    });
  });

  describe('filtros y búsqueda', () => {
    it('solo lista despachos y aplica el estado, la guía y las fechas', async () => {
      expect(nombres(await lista({ estadoDespacho: 'recibido' }))).toEqual(['D2']); // sin importar mayúsculas
      expect(nombres(await service.listDespachos({ numeroGuia: `${env.marca}-D3` } as any))).toEqual(['D3']);
      // Del día -6 al día -4: D2, D3 y D4. Con un "hasta" de solo día, ese día entra completo.
      const filtradas = await lista({
        fechaDesde: new Date(hace(6).getTime() - 1000).toISOString(),
        fechaHasta: hace(4).toISOString().slice(0, 10),
      });
      expect(nombres(filtradas).sort()).toEqual(['D2', 'D3', 'D4']);
    });

    it('una fecha inválida se ignora en vez de romper la consulta', async () => {
      expect(nombres(await lista({ fechaDesde: 'no-es-fecha' }))).toHaveLength(7);
    });

    it('busca por palabras (cada una en guía, ruta, responsables o insumos)', async () => {
      expect(nombres(await lista({ search: 'jabon' }))).toEqual(['D1']); // por el insumo del detalle
      expect(nombres(await lista({ search: `${env.marca}-D4` }))).toEqual(['D4']); // por la guía
      expect(nombres(await lista({ search: 'pulidor móvil' }))).toEqual(['D4']); // por la ruta: cada palabra en alguna parte
      expect(nombres(await lista({ search: 'lia' }))).toEqual(['D2']); // por el responsable que recibe
      expect(nombres(await lista({ search: 'jabon tres' }))).toEqual([]); // todas las palabras tienen que aparecer
    });

    it('una búsqueda de una sola letra se ignora y los comodines del cliente se escapan', async () => {
      expect(nombres(await lista({ search: 'a' }))).toHaveLength(7);
      expect(nombres(await lista({ search: '50%_x' }))).toEqual([]); // "%" y "_" son texto, no comodines
    });

    it('el total usa los mismos filtros que la página', async () => {
      const r: any = await lista({ page: 1, pageSize: 2, estadoDespacho: 'EN_TRANSITO', search: 'tres' });
      expect(r.total).toBe(2); // D6 y D7 llegan o salen "Agencia Tres"
      const ids2 = nombres(r);
      expect(ids2.sort()).toEqual(['D6', 'D7']);
    });

    it('filtra por agencia con el id, el nombre y el código de la agencia', async () => {
      for (const clave of [a1.id, a1.nombre, a1.codigo]) {
        expect(nombres(await lista({ agenciaId: clave })).sort()).toEqual(['D1', 'D2', 'D6']); // llegan a A1 y sale el traslado D6
      }
    });
  });

  describe('resumen', () => {
    it('sin incluirResumen no devuelve los contadores', async () => {
      expect(((await lista({ page: 1 })) as any).resumen).toBeUndefined();
    });

    it('cuenta por estado con los mismos filtros pero sin el de estado', async () => {
      const r: any = await lista({ page: 1, incluirResumen: true, estadoDespacho: 'RECIBIDO' });
      expect(nombres(r)).toEqual(['D2']); // la página sí respeta el estado…
      expect(r.resumen).toEqual({ enTransito: 5, recibidos: 1, rechazados: 1, total: 7 }); // …el resumen no
    });
  });

  describe('alcance por rol en el servidor', () => {
    it('un rol global (admin) no recibe ningún filtro de alcance', async () => {
      expect(nombres(await lista({ page: 1 }, ids.admin))).toHaveLength(7);
    });

    it('el pulidor solo ve lo suyo aunque pida el pulidorId de otra persona', async () => {
      expect(nombres(await lista({ pulidorId: ids.otroPulidor }, ids.paco))).toEqual(['D4']);
      expect(nombres(await lista({}, ids.otroPulidor))).toEqual([]);
    });

    it('otros roles pueden filtrar por pulidor', async () => {
      expect(nombres(await lista({ pulidorId: ids.paco }, ids.coord))).toEqual(['D4']);
    });

    it('el líder solo ve su agencia aunque pida otra', async () => {
      expect(nombres(await lista({ agenciaId: a3.id }, ids.lia)).sort()).toEqual(['D1', 'D2', 'D6']);
    });

    it('el líder también ve los despachos que SALEN de su agencia, no solo los que llegan', async () => {
      expect(nombres(await lista({}, ids.lia))).toContain('D6'); // sale de A1 hacia A3
    });

    it('el asistente de bodega ve sus envíos, los de su bodega y los de su región (antes lanzaba error)', async () => {
      // Su región R1 incluye A1, A2 y la bodega B-R1: D1, D2, D3, D5 y D6 (sale de A1). D4 (pulidor) y D7 (A3, R2) no.
      expect(nombres(await lista({ page: 1 }, ids.asistente)).sort()).toEqual(['D1', 'D2', 'D3', 'D5', 'D6']);
    });
  });

  describe('datos de cada fila', () => {
    it('agrega detalles y responsables', async () => {
      const r: any[] = (await lista({})) as any[];
      const d1 = r.find((x) => x.id === d.D1);
      expect(d1.detalles).toHaveLength(1);
      expect(d1.detalles[0].insumo.nombre).toBe(jabon.nombre);
      expect(d1.usuarioDespacha).toMatchObject({ id: ids.coord, name: 'coord' });
      expect(d1.usuarioRecibe).toBeNull();
      const d2 = r.find((x) => x.id === d.D2);
      expect(d2.detalles).toEqual([]);
      expect(d2.usuarioRecibe).toMatchObject({ id: ids.lia });
    });

    it('deduce la agencia destino del texto "[id]" y extrae el motivo del rechazo', async () => {
      const [m] = (await service.listDespachos({ numeroGuia: `${env.marca}-D3` } as any)) as any[];
      expect(m.destinoAgenciaId).toBe(a2.id); // en la base es null: sale del texto "[id]"
      expect(m.motivoRechazo).toBe('derrame en tránsito');
    });

    it('puedeConfirmar: quien recibe sí; un envío ya recibido no; el admin no; el super admin sí', async () => {
      const confirmar = async (usuarioId: string, clave: string) =>
        ((await lista({}, usuarioId)) as any[]).find((x) => x.id === d[clave])?.puedeConfirmar;
      expect(await confirmar(ids.lia, 'D1')).toBe(true); // líder de la agencia destino
      expect(await confirmar(ids.lia, 'D2')).toBe(false); // ya recibido
      expect(await confirmar(ids.admin, 'D1')).toBe(false);
      expect(await confirmar(ids.superAdmin, 'D1')).toBe(true);
      expect(await confirmar(ids.asistente, 'D5')).toBe(true); // su bodega es el destino
      expect(await confirmar(ids.paco, 'D4')).toBe(true); // el pulidor al que va dirigido
    });

    it('sin filas devuelve un arreglo vacío', async () => {
      expect(await service.listDespachos({ numeroGuia: `${env.marca}-no-existe` } as any)).toEqual([]);
    });
  });
});
