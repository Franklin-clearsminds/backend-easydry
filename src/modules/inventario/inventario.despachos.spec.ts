import { describe, expect, it, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventarioService } from './inventario.service.js';
import { ListDespachosDto } from './dto/movimientos.dto.js';

interface Opciones {
  rol?: string;
  usuario?: Record<string, unknown>;
  filas?: any[];
  total?: number;
  porEstado?: Array<{ estado: string; total: number }>;
  detalles?: any[];
}

/** Servicio con Prisma simulado: el SQL se enruta por su texto y se guardan las llamadas para inspeccionarlas. */
function construir(op: Opciones = {}) {
  const viewer = op.rol
    ? { id: 'u1', role: { namerol: op.rol }, region: null, regionId: null, agenciaId: null, bodegaId: null, ...op.usuario }
    : null;
  const sql: Array<{ texto: string; params: unknown[] }> = [];
  const queryRaw = vi.fn(async (texto: string, ...params: unknown[]) => {
    sql.push({ texto, params });
    if (texto.includes('GROUP BY')) return op.porEstado ?? [];
    if (texto.includes('COUNT(*)')) return [{ total: op.total ?? (op.filas?.length ?? 0) }];
    if (texto.includes('FROM "bodegas"')) return [{ id: 'bod-r', nombre: 'Bodega Norte', codigo: 'BN' }];
    return op.filas ?? [];
  });
  const prisma = {
    $queryRawUnsafe: queryRaw,
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    user: {
      findUnique: vi.fn().mockResolvedValue(viewer),
      findMany: vi.fn().mockResolvedValue([{ id: 'u9', name: 'Ana', lastname: 'Paz' }]),
    },
    agencia: {
      findFirst: vi.fn().mockResolvedValue({ id: 'ag-1', nombre: 'Agencia Centro', codigo: 'AC' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'ag-r', nombre: 'Agencia Regional' }]),
    },
    movimientoDetalle: { findMany: vi.fn().mockResolvedValue(op.detalles ?? []) },
  };
  const service = new InventarioService(prisma as never);
  const pagina = () => sql.find((s) => s.texto.includes('LIMIT'))!;
  const conteo = () => sql.find((s) => s.texto.includes('COUNT(*)') && !s.texto.includes('GROUP BY'))!;
  const resumen = () => sql.find((s) => s.texto.includes('GROUP BY'));
  return { service, prisma, sql, pagina, conteo, resumen };
}

const fila = (extra: Record<string, unknown> = {}) => ({
  id: 'm1',
  numeroGuia: 'G-001',
  tipo: 'DESPACHO_AGENCIA',
  estadoDespacho: 'EN_TRANSITO',
  origenUbicacion: 'Bodega Central',
  destinoUbicacion: 'Agencia Centro [ag-1]',
  fechaDespacho: new Date('2026-09-20T10:00:00Z'),
  fechaRecepcion: null,
  observaciones: null,
  usuarioDespachaId: 'u9',
  usuarioRecibeId: null,
  destinoAgenciaId: null,
  destinoBodegaId: null,
  destinoPulidorId: null,
  ...extra,
});

describe('InventarioService.listDespachos — formato y compatibilidad', () => {
  it('sin página ni tamaño (app móvil) devuelve un ARREGLO con hasta 100 (antes 500)', async () => {
    const { service, pagina } = construir({ filas: [fila()] });
    const r = await service.listDespachos({} as any);
    expect(Array.isArray(r)).toBe(true);
    expect(r).toHaveLength(1);
    const params = pagina().params;
    expect(params.slice(-2)).toEqual([100, 0]);
  });

  it('con página responde el formato estándar y recorta a 100', async () => {
    const { service, pagina } = construir({ filas: [fila()], total: 230 });
    const r: any = await service.listDespachos({ page: 3, pageSize: 25 } as any);
    expect(pagina().params.slice(-2)).toEqual([25, 50]);
    expect(r).toMatchObject({ total: 230, page: 3, pageSize: 25, totalPages: 10, hasNextPage: true, hasPrevPage: true });
    expect(r.items).toHaveLength(1);
    expect(r.data).toBe(r.items);

    const otra = construir({ total: 5 });
    await otra.service.listDespachos({ pageSize: 200 } as any);
    expect(otra.pagina().params.slice(-2)).toEqual([100, 0]);
  });

  it('solo con pageSize también es paginado (objeto, no arreglo)', async () => {
    const { service } = construir({ total: 0 });
    const r: any = await service.listDespachos({ pageSize: 50 } as any);
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
    const { service } = construir({ rol: 'SUPER_ADMIN', filas: [fila()] });
    const r = await service.obtenerDespachosPendientes('u1');
    expect(Array.isArray(r)).toBe(true);
  });
});

describe('InventarioService.listDespachos — orden', () => {
  it('por defecto lo más reciente primero, con desempate por id', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({ page: 1 } as any);
    expect(pagina().texto).toContain('ORDER BY m."fechaDespacho" DESC NULLS LAST, m."id" DESC');
  });

  it('ordena por columnas permitidas', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({ sortField: 'guia', sortOrder: 'asc' } as any);
    expect(pagina().texto).toContain('ORDER BY m."numeroGuia" ASC NULLS LAST, m."id" ASC');
    await service.listDespachos({ sortField: 'estado', sortOrder: 'desc' } as any);
  });

  it('un campo no permitido o malicioso no llega al SQL', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({ sortField: 'numeroGuia; DROP TABLE "User"--', sortOrder: 'asc' } as any);
    expect(pagina().texto).toContain('ORDER BY m."fechaDespacho" DESC NULLS LAST');
    expect(pagina().texto).not.toContain('DROP');
  });
});

describe('InventarioService.listDespachos — filtros y búsqueda', () => {
  it('solo lista despachos y enlaza el estado, la guía y las fechas como parámetros', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({
      estadoDespacho: 'recibido',
      numeroGuia: 'G-0',
      fechaDesde: '2026-09-01T05:00:00.000Z',
      fechaHasta: '2026-09-30',
      page: 1,
    } as any);
    const { texto, params } = pagina();
    expect(params[0]).toEqual(['DESPACHO_AGENCIA', 'DESPACHO_PULIDOR', 'DESPACHO_BODEGA']);
    expect(params).toContain('RECIBIDO');
    expect(params).toContain('%G-0%');
    expect(params).toContain('2026-09-01T05:00:00.000Z');
    expect(params).toContain('2026-09-30T23:59:59.999Z');
    expect(texto).toContain('::text::timestamp');
    expect(texto).not.toContain('RECIBIDO');
    expect(texto).not.toContain('G-0');
  });

  it('una fecha inválida se ignora en vez de romper la consulta', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({ fechaDesde: 'no-es-fecha' } as any);
    expect(pagina().texto).not.toContain('fechaDespacho" >=');
  });

  it('busca por palabras (cada una en guía, ruta, responsables o insumos)', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({ search: 'jabon centro' } as any);
    const { texto, params } = pagina();
    expect(params).toContain('%jabon%');
    expect(params).toContain('%centro%');
    expect(texto.match(/"numeroGuia" ILIKE/g)).toHaveLength(2);
    expect(texto).toContain('FROM "MovimientoDetalle"');
    expect(texto).toContain('u."lastname" ILIKE');
  });

  it('una búsqueda de una sola letra se ignora y los comodines del cliente se escapan', async () => {
    const corta = construir();
    await corta.service.listDespachos({ search: 'a' } as any);
    expect(corta.pagina().texto).not.toContain('ILIKE');

    const comodin = construir();
    await comodin.service.listDespachos({ search: '50%_x' } as any);
    expect(comodin.pagina().params).toContain('%50\\%\\_x%');
  });

  it('el conteo usa exactamente los mismos filtros que la página', async () => {
    const { service, pagina, conteo } = construir();
    await service.listDespachos({ estadoDespacho: 'RECHAZADO', search: 'ab' } as any);
    const filtroPagina = pagina().texto.split('WHERE')[1].split('ORDER BY')[0].trim();
    const filtroConteo = conteo().texto.split('WHERE')[1].trim();
    expect(filtroConteo).toBe(filtroPagina);
    expect(conteo().params).toEqual(pagina().params.slice(0, -2));
  });

  it('filtra por agencia destino con el id, el nombre y el código de la agencia', async () => {
    const { service, pagina } = construir();
    await service.listDespachos({ agenciaId: 'ag-1' } as any);
    const { texto, params } = pagina();
    expect(texto).toContain('"destinoAgenciaId" = ANY(');
    expect(params).toContainEqual(['ag-1']);
    expect(params).toContainEqual(['%ag-1%', '%Agencia Centro%', '%AC%']);
  });
});

describe('InventarioService.listDespachos — resumen', () => {
  it('sin incluirResumen no consulta los contadores', async () => {
    const { service, resumen } = construir();
    const r: any = await service.listDespachos({ page: 1 } as any);
    expect(resumen()).toBeUndefined();
    expect(r.resumen).toBeUndefined();
  });

  it('cuenta por estado con los mismos filtros pero sin el de estado', async () => {
    const { service, resumen } = construir({
      total: 12,
      porEstado: [
        { estado: 'EN_TRANSITO', total: 3 },
        { estado: 'PENDIENTE', total: 1 },
        { estado: 'RECIBIDO', total: 6 },
        { estado: 'RECHAZADO', total: 2 },
      ],
    });
    const r: any = await service.listDespachos({ page: 1, incluirResumen: true, estadoDespacho: 'RECIBIDO', search: 'ab' } as any);
    expect(r.resumen).toEqual({ enTransito: 4, recibidos: 6, rechazados: 2, total: 12 });
    expect(resumen()!.params).not.toContain('RECIBIDO');
    expect(resumen()!.params).toContain('%ab%');
  });
});

describe('InventarioService.listDespachos — alcance por rol en el servidor', () => {
  it('un rol global (admin) no recibe ningún filtro de alcance', async () => {
    const { service, pagina } = construir({ rol: 'ADMIN' });
    await service.listDespachos({ page: 1 } as any, 'u1');
    expect(pagina().params).toHaveLength(3); // tipos + limit + offset
    const where = pagina().texto.split('WHERE')[1].split('ORDER BY')[0];
    expect(where.trim()).toBe('m."tipo"::text = ANY($1::text[])');
  });

  it('el pulidor solo ve lo suyo aunque pida el pulidorId de otra persona', async () => {
    const { service, pagina } = construir({ rol: 'PULIDOR' });
    await service.listDespachos({ pulidorId: 'otro-pulidor' } as any, 'u1');
    expect(pagina().params).toContain('u1');
    expect(pagina().params).not.toContain('otro-pulidor');
    expect(pagina().texto).toContain('"destinoPulidorId" =');
  });

  it('otros roles pueden filtrar por pulidor', async () => {
    const { service, pagina } = construir({ rol: 'COORD_BODEGA' });
    await service.listDespachos({ pulidorId: 'p7' } as any, 'u1');
    expect(pagina().params).toContain('p7');
  });

  it('el líder solo ve su agencia aunque pida otra', async () => {
    const { service, pagina, prisma } = construir({ rol: 'LIDER_OPERADOR', usuario: { agenciaId: 'ag-1' } });
    await service.listDespachos({ agenciaId: 'agencia-ajena' } as any, 'u1');
    expect(prisma.agencia.findFirst.mock.calls[0][0].where.OR[0]).toEqual({ id: 'ag-1' });
    expect(pagina().params).toContainEqual(['ag-1']);
    expect(JSON.stringify(pagina().params)).not.toContain('agencia-ajena');
  });

  it('el líder también ve los despachos que SALEN de su agencia, no solo los que llegan', async () => {
    const { service, pagina } = construir({ rol: 'LIDER_OPERADOR', usuario: { agenciaId: 'ag-1' } });
    await service.listDespachos({ page: 1 } as any, 'u1');
    const { texto } = pagina();
    expect(texto).toContain('"destinoAgenciaId" = ANY(');
    expect(texto).toContain('"origenAgenciaId" = ANY(');
    expect(texto).toContain('"origenUbicacion" ILIKE ANY(');
  });

  it('el asistente de bodega ve sus envíos, los de su bodega y los de su región (antes lanzaba error)', async () => {
    const { service, pagina } = construir({
      rol: 'ASISTENTE_BODEGA',
      usuario: { bodegaId: 'bod-1', regionId: 'reg-1', region: { nombre: 'Norte' } },
      filas: [fila()],
    });
    const r: any = await service.listDespachos({ page: 1 } as any, 'u1');
    const { texto, params } = pagina();
    expect(texto).toContain('"usuarioDespachaId" =');
    expect(texto).toContain('"destinoBodegaId" =');
    expect(texto).toContain('"origenBodegaId" =');
    expect(texto).toContain('"origenUbicacion" ILIKE ANY(');
    expect(params).toContain('bod-1');
    const patrones = params.find((p) => Array.isArray(p) && (p as string[]).some((x) => x.includes('Bodega Norte'))) as string[];
    expect(patrones).toEqual(expect.arrayContaining(['%Agencia Regional%', '%Bodega Norte%', '%Norte%']));
    expect(r.items).toHaveLength(1);
  });
});

describe('InventarioService.listDespachos — datos de cada fila', () => {
  it('agrega detalles y responsables sin una consulta por fila', async () => {
    const { service, prisma } = construir({
      filas: [fila({ id: 'm1', usuarioRecibeId: 'u9' }), fila({ id: 'm2', numeroGuia: 'G-002' })],
      detalles: [{ id: 'd1', movimientoId: 'm1', insumoId: 'i1', cantidadEnviada: 3, insumo: { nombre: 'Jabón' } }],
    });
    const r: any[] = (await service.listDespachos({} as any)) as any[];
    expect(prisma.movimientoDetalle.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(r[0].detalles).toHaveLength(1);
    expect(r[1].detalles).toEqual([]);
    expect(r[0].usuarioDespacha).toMatchObject({ name: 'Ana' });
    expect(r[0].usuarioRecibe).toMatchObject({ name: 'Ana' });
    expect(r[1].usuarioRecibe).toBeNull();
  });

  it('deduce la agencia destino del texto "[id]" y extrae el motivo del rechazo', async () => {
    const { service } = construir({
      filas: [fila({ estadoDespacho: 'RECHAZADO', observaciones: 'Envío RECHAZADO. RECHAZO: derrame en tránsito' })],
    });
    const [m] = (await service.listDespachos({} as any)) as any[];
    expect(m.destinoAgenciaId).toBe('ag-1');
    expect(m.motivoRechazo).toBe('derrame en tránsito');
  });

  it('puedeConfirmar: el líder de la agencia destino sí; un envío ya recibido no; el admin no', async () => {
    const enTransito = fila({ destinoAgenciaId: 'ag-1' });
    const lider = construir({ rol: 'LIDER_OPERADOR', usuario: { agenciaId: 'ag-1' }, filas: [enTransito] });
    expect(((await lider.service.listDespachos({} as any, 'u1')) as any[])[0].puedeConfirmar).toBe(true);

    const recibido = construir({ rol: 'LIDER_OPERADOR', usuario: { agenciaId: 'ag-1' }, filas: [fila({ estadoDespacho: 'RECIBIDO', destinoAgenciaId: 'ag-1' })] });
    expect(((await recibido.service.listDespachos({} as any, 'u1')) as any[])[0].puedeConfirmar).toBe(false);

    const admin = construir({ rol: 'ADMIN', filas: [enTransito] });
    expect(((await admin.service.listDespachos({} as any, 'u1')) as any[])[0].puedeConfirmar).toBe(false);

    const sa = construir({ rol: 'SUPER_ADMIN', filas: [enTransito] });
    expect(((await sa.service.listDespachos({} as any, 'u1')) as any[])[0].puedeConfirmar).toBe(true);
  });

  it('sin filas no consulta detalles ni usuarios', async () => {
    const { service, prisma } = construir({ filas: [] });
    expect(await service.listDespachos({} as any)).toEqual([]);
    expect(prisma.movimientoDetalle.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
