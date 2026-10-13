import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OpcionesDto, listarOpciones } from './opciones.js';
import { AgenciasService } from '../../modules/agencias/agencias.service.js';
import { CatalogosService } from '../../modules/catalogos/catalogos.service.js';
import { InventarioService } from '../../modules/inventario/inventario.service.js';
import { AgenciasOpcionesDto, UsuariosOpcionesDto } from '../../modules/agencias/dto/opciones.dto.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). `listarOpciones` se prueba sobre la tabla real de regiones con 45 filas
 * propias; los endpoints `…/opciones` se prueban con un mundo de agencias, personas, servicios e insumos propios.
 * Todo se acota con la marca de la ejecución porque las tablas reales tienen más filas.
 */
describe('listarOpciones (base real)', () => {
  let env: Entorno;
  let regiones: Array<{ id: string; nombre: string }>;

  const cfg = () => ({
    where: { codigo: { startsWith: env.marca } },
    camposBusqueda: ['nombre'],
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    buscar: ({ where, orderBy, skip, take }: any) => env.prisma.region.findMany({ where, orderBy, skip, take }),
    contar: (where: any) => env.prisma.region.count({ where }),
    mapear: (f: any) => ({ value: f.id, label: f.nombre }),
  });

  beforeAll(async () => {
    env = await abrirEntorno();
    regiones = [];
    // `Región 00` … `Región 44`: el nombre ordena igual que el número.
    for (let i = 0; i < 45; i++) regiones.push(await env.region(String(i).padStart(2, '0')));
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('30 por defecto y formato estándar con { value, label }', async () => {
    const r: any = await listarOpciones({} as OpcionesDto, cfg());
    expect(r).toMatchObject({ total: 45, page: 1, pageSize: 30, totalPages: 2, hasNextPage: true });
    expect(r.items).toHaveLength(30);
    expect(r.items[0]).toEqual({ value: regiones[0].id, label: regiones[0].nombre }); // orden alfabético
    expect(r.items[29].value).toBe(regiones[29].id);
  });

  it('pagina, recorta a 100 y busca por palabras con mínimo de 2 letras', async () => {
    const p3: any = await listarOpciones({ page: 3, pageSize: 20 } as OpcionesDto, cfg());
    expect(p3.items.map((i: any) => i.value)).toEqual(regiones.slice(40).map((r) => r.id)); // salta 40, quedan 5
    expect(p3).toMatchObject({ total: 45, page: 3, pageSize: 20 });

    const buscada: any = await listarOpciones({ search: `${env.marca} 07` } as OpcionesDto, cfg());
    expect(buscada.items.map((i: any) => i.value)).toEqual([regiones[7].id]);
    expect(buscada.total).toBe(1); // el total usa el mismo filtro que la página

    const grande: any = await listarOpciones({ pageSize: 900 } as OpcionesDto, cfg());
    expect(grande.pageSize).toBe(100);
    expect(grande.items).toHaveLength(45);

    const unaLetra: any = await listarOpciones({ search: 'a' } as OpcionesDto, cfg());
    expect(unaLetra.total).toBe(45); // una sola letra no filtra
  });

  it('con ids devuelve solo esas opciones (máx. 50), sin paginar y sin buscar', async () => {
    const reales = regiones.map((r) => r.id);
    const muchos = [...reales, ...Array.from({ length: 35 }, (_, i) => `inexistente-${i}`)]; // 80 ids: se usan los primeros 50
    const r: any = await listarOpciones({ ids: muchos, search: 'zzz', page: 5 } as OpcionesDto, cfg());
    expect(r.items).toHaveLength(45); // las 45 reales caben en los primeros 50; "zzz" y la página 5 se ignoran
    expect(r).toMatchObject({ total: 45, page: 1 });

    const pocos: any = await listarOpciones({ ids: [regiones[3].id, regiones[1].id] } as OpcionesDto, cfg());
    expect(pocos.items.map((i: any) => i.value)).toEqual([regiones[1].id, regiones[3].id]); // en orden alfabético
  });

  it('el DTO valida ids y no fija page/pageSize', async () => {
    const dto: any = plainToInstance(OpcionesDto, { ids: ['a', 'b'], page: '2' });
    expect(await validate(dto)).toHaveLength(0);
    expect(plainToInstance(OpcionesDto, {}).page).toBeUndefined();
    expect((await validate(plainToInstance(OpcionesDto, { ids: [1, 2] as any }))).length).toBeGreaterThan(0);
  });
});

describe('opciones de agencias, regiones, clientes, bahías, operadores y usuarios (base real)', () => {
  let env: Entorno;
  let svc: AgenciasService;
  let norte: any;
  let acme: any;
  let a1: any;
  let a2: any;
  let b1: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    svc = new AgenciasService(env.prisma as never);
    norte = await env.region('NORTE');
    acme = await env.cliente('ACME');
    a1 = await env.agencia('UNO', { regionId: norte.id });
    a2 = await env.agencia('DOS', { regionId: norte.id });
    await env.prisma.agencia.update({ where: { id: a1.id }, data: { region: 'Norte' } });
    b1 = await env.bahia('B1', a1.id);

    const crear = async (clave: string, rol: string, opts: Record<string, unknown>) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('lider', 'LIDER', { agenciaId: a1.id, name: 'Lola', lastname: 'Rey' });
    await crear('pedro', 'LAVADOR', { agenciaId: a1.id, name: 'Pedro', lastname: 'Ruiz (CI: 1723456789)' });
    await crear('otro', 'LAVADOR', { agenciaId: a2.id, name: 'Otro', lastname: 'Lavador' });
    await crear('admin1', 'ADMIN', { agenciaId: a1.id, name: 'Ana', lastname: 'Paz' });
    await crear('superadmin', 'SUPER_ADMIN', { agenciaId: a1.id, name: 'Sara', lastname: 'Super' });
    await crear('adminGlobal', 'ADMIN', { name: 'Adela' });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('agencias: respeta el alcance por rol y arma etiqueta y subetiqueta', async () => {
    const r: any = await svc.listAgenciasOpciones({ regionId: norte.id, estado: 1, search: env.marca } as any, actores.lider);
    expect(r.items).toEqual([{ value: a1.id, label: a1.nombre, sublabel: `${a1.codigo} · Norte` }]); // solo la suya
  });

  it('agencias: un rol global las ve todas', async () => {
    const r: any = await svc.listAgenciasOpciones({ search: env.marca } as any, actores.adminGlobal);
    expect(r.items.map((i: any) => i.value).sort()).toEqual([a1.id, a2.id].sort());
  });

  it('regiones y clientes: filtro de estado y orden alfabético', async () => {
    const reg: any = await svc.listRegionesOpciones({ estado: 1, search: env.marca } as any);
    // Las opciones llevan el estado: los desplegables que piden la lista completa filtran por activas sin pedir la pestaña Regiones.
    expect(reg.items).toEqual([{ value: norte.id, label: norte.nombre, sublabel: norte.codigo, estado: 1 }]);
    const sinResultados: any = await svc.listRegionesOpciones({ estado: 0, search: env.marca } as any);
    expect(sinResultados.items).toEqual([]);
    const cli: any = await svc.listClientesOpciones({ search: env.marca } as any);
    expect(cli.items).toEqual([{ value: acme.id, label: acme.nombre, estado: 1 }]);
  });

  it('bahías: por agencia, con código y agencia en la subetiqueta', async () => {
    const r: any = await svc.listBahiasOpciones({ agenciaId: a1.id, activa: true } as any, actores.adminGlobal);
    expect(r.items).toEqual([{ value: b1.id, label: b1.nombre, sublabel: `${env.marca}-B-B1 · ${a1.nombre}` }]);
    const otraAgencia: any = await svc.listBahiasOpciones({ agenciaId: a2.id, activa: true } as any, actores.adminGlobal);
    expect(otraAgencia.items).toEqual([]);
  });

  it('operadores: quita la cédula "(CI: …)" de la etiqueta y un líder queda en su agencia', async () => {
    const r: any = await svc.listOperadoresOpciones({ agenciaId: a2.id } as any, actores.lider); // pide la agencia DOS…
    // …pero solo ve su propia agencia (UNO): no aparece el lavador de DOS.
    const valores = r.items.map((i: any) => i.value);
    expect(valores).toContain(ids.pedro);
    expect(valores).not.toContain(ids.otro);
    expect(r.items.find((i: any) => i.value === ids.pedro)).toEqual({ value: ids.pedro, label: 'Pedro Ruiz', sublabel: a1.nombre });
  });

  it('usuarios: nunca ofrece SUPER_ADMIN y solo pide los campos necesarios', async () => {
    const r: any = await svc.listUsuariosOpciones({ rolNombre: 'ADMIN, LIDER', agenciaId: a1.id } as any, actores.adminGlobal);
    const valores = r.items.map((i: any) => i.value);
    expect(valores.sort()).toEqual([ids.admin1, ids.lider].sort());
    expect(valores).not.toContain(ids.superadmin);
    expect(r.items.find((i: any) => i.value === ids.admin1)).toEqual({
      value: ids.admin1,
      label: 'Ana Paz',
      sublabel: `ADMIN · ${env.marca}-admin1@prueba.local`,
    });
    // Aun pidiendo SUPER_ADMIN por nombre, no se ofrece.
    const pedidoExplicito: any = await svc.listUsuariosOpciones({ rolNombre: 'SUPER_ADMIN', agenciaId: a1.id } as any, actores.adminGlobal);
    expect(pedidoExplicito.items).toEqual([]);
  });

  it('los DTO no fijan page y validan', async () => {
    expect(plainToInstance(AgenciasOpcionesDto, {}).page).toBeUndefined();
    expect(await validate(plainToInstance(AgenciasOpcionesDto, { estado: '1', regionId: 'r', ids: ['a'] }))).toHaveLength(0);
    expect((await validate(plainToInstance(AgenciasOpcionesDto, { estado: 7 }))).length).toBeGreaterThan(0);
    expect(plainToInstance(UsuariosOpcionesDto, { rolNombre: 'A,B' })).toMatchObject({ rolNombre: 'A,B' });
  });
});

describe('opciones de servicios del catálogo e insumos (base real)', () => {
  let env: Entorno;
  let catalogos: CatalogosService;
  let inventario: InventarioService;
  let sede: any;
  let encerado: any;
  let express: any;
  let pulido: any;
  let liderSede: any;
  let adminGlobal: any;
  let tipoLiquido: any;
  let jabon: any;
  let cera: any;
  let inactivo: any;

  beforeAll(async () => {
    env = await abrirEntorno();
    catalogos = new CatalogosService(env.prisma as never);
    inventario = new InventarioService(env.prisma as never);

    encerado = await env.catalogo('ENCERADO', { precio: 10 });
    express = await env.catalogo('EXPRESS', { precio: 12 });
    pulido = await env.catalogo('PULIDO', { categoria: 'ESPECIAL' });
    sede = await env.agencia('SEDE');
    await env.prisma.agencia.update({ where: { id: sede.id }, data: { servicioIds: [encerado.id, pulido.id], tieneServiciosEspeciales: false } });
    liderSede = await env.actor((await env.usuario('lider', 'LIDER', { agenciaId: sede.id })).id);
    adminGlobal = await env.actor((await env.usuario('admin', 'ADMIN')).id);

    tipoLiquido = await env.tipoProducto('LIQ');
    jabon = await env.insumo('JABON', { tipoProductoId: tipoLiquido.id });
    cera = await env.insumo('CERA', { tipoProductoId: tipoLiquido.id });
    inactivo = await env.insumo('VIEJO', { tipoProductoId: tipoLiquido.id, estado: 0 });
    await env.stock({ insumoId: jabon.id, tipoUbicacion: 'AGENCIA', agenciaId: sede.id, cantidad: 5 }); // la sede solo tiene jabón
    await env.stock({ insumoId: inactivo.id, tipoUbicacion: 'AGENCIA', agenciaId: sede.id, cantidad: 1 });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('servicios: un rol de sede solo ve los de su agencia (id en la lista y categoría GENERAL)', async () => {
    const r: any = await catalogos.listServiciosOpciones({ search: env.marca } as any, { agenciaId: sede.id, namerol: 'LIDER' });
    // La sede tiene ENCERADO (general) y PULIDO (especial), pero no atiende especiales; EXPRESS no es suyo.
    expect(r.items).toEqual([{ value: String(encerado.id), label: encerado.nombre, sublabel: `${encerado.codigo} · GENERAL` }]);
  });

  it('servicios: un administrador ve el catálogo y puede filtrar por categoría', async () => {
    const todos: any = await catalogos.listServiciosOpciones({ search: env.marca } as any, { namerol: 'ADMIN' });
    expect(todos.items.map((i: any) => i.value).sort()).toEqual([encerado.id, express.id, pulido.id].map(String).sort());
    const especiales: any = await catalogos.listServiciosOpciones({ categoria: 'especial', search: env.marca } as any, { namerol: 'ADMIN' });
    expect(especiales.items.map((i: any) => i.value)).toEqual([String(pulido.id)]);
  });

  it('insumos: solo activos por defecto, con el alcance de la sede y etiqueta con SKU y tipo', async () => {
    const r: any = await inventario.listInsumosOpciones({ tipoProductoId: tipoLiquido.id } as any, liderSede);
    // De los tres insumos del tipo, la sede solo tiene stock de jabón (y el viejo está inactivo).
    expect(r.items).toEqual([{ value: jabon.id, label: jabon.nombre, sublabel: `${jabon.codigoSKU} · ${tipoLiquido.nombre}` }]);
  });

  it('insumos: un administrador sin sede ve el catálogo y puede pedir inactivos', async () => {
    const activos: any = await inventario.listInsumosOpciones({ search: env.marca } as any, adminGlobal);
    expect(activos.items.map((i: any) => i.value).sort()).toEqual([jabon.id, cera.id].sort());
    const inactivos: any = await inventario.listInsumosOpciones({ estado: 0, search: env.marca } as any, adminGlobal);
    expect(inactivos.items.map((i: any) => i.value)).toEqual([inactivo.id]);
  });
});
