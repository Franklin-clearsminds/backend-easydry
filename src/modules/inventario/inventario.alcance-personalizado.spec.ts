import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InventarioService } from './inventario.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: qué stock, kardex y despachos ve un rol PERSONALIZADO lo decide su ámbito (país, región, agencia o
 * propio), no su nombre. Antes un rol con un nombre desconocido veía todo el stock o nada según el caso.
 */
describe('Inventario: alcance de un rol personalizado (base real)', () => {
  let env: Entorno;
  let service: InventarioService;
  let region1: any, region2: any, agencia1: any, agencia2: any, insumo: any;
  const usuarios: Record<string, any> = {};
  const rolesCreados: string[] = [];

  /** Rol que no existe entre los oficiales, con su ámbito, y un usuario con él. */
  const personalizado = async (clave: string, ambito: string, opts: Record<string, unknown> = {}) => {
    const rol = await env.prisma.role.create({
      data: { namerol: `${env.marca}-ROL-${clave}`, ambito, capacidades: ['inventario.ver'], permisos: [], esSistema: false },
    });
    rolesCreados.push(rol.id);
    const u = await env.prisma.user.create({
      data: {
        email: `${env.marca}-${clave}@prueba.local`, passwordHash: 'x', name: `${env.marca}${clave}`, lastname: 'Prueba', roleId: rol.id,
        agenciaId: (opts.agenciaId as string) ?? null, regionId: (opts.regionId as string) ?? null, estado: 1,
      },
    });
    env.rastrear('User', u.id);
    usuarios[clave] = u;
    return u;
  };

  const stockVisible = async (clave: string) => {
    const u = usuarios[clave];
    const filas = await service.listStock({ insumoId: insumo.id } as any, u.id, '', u.agenciaId ?? undefined);
    return filas.map((f: any) => f.agenciaId).sort();
  };

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new InventarioService(env.prisma as never);
    region1 = await env.region('R1');
    region2 = await env.region('R2');
    agencia1 = await env.agencia('A1', { regionId: region1.id });
    agencia2 = await env.agencia('A2', { regionId: region2.id });
    insumo = await env.insumo('ALC');
    await env.stock({ insumoId: insumo.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia1.id, cantidad: 5 });
    await env.stock({ insumoId: insumo.id, tipoUbicacion: 'AGENCIA', agenciaId: agencia2.id, cantidad: 7 });
    await personalizado('pais', 'GLOBAL');
    await personalizado('region', 'REGION', { regionId: region1.id });
    await personalizado('agencia', 'AGENCIA', { agenciaId: agencia1.id });
    await personalizado('sin', 'AGENCIA'); // ámbito de agencia pero sin agencia asignada
  });

  afterAll(async () => {
    await env.cerrar();
    await env.prisma.role.deleteMany({ where: { id: { in: rolesCreados } } });
  });

  it('ámbito país: ve el stock de todas las agencias', async () => {
    expect(await stockVisible('pais')).toEqual([agencia1.id, agencia2.id].sort());
  });

  it('ámbito región: solo las agencias de su región', async () => {
    expect(await stockVisible('region')).toEqual([agencia1.id]);
  });

  it('ámbito agencia: solo su agencia', async () => {
    expect(await stockVisible('agencia')).toEqual([agencia1.id]);
  });

  it('un rol sin agencia ni región asignada no ve stock (antes veía todo)', async () => {
    expect(await stockVisible('sin')).toEqual([]);
  });

  it('el pendiente por confirmar de un despacho a su agencia lo ve y puede confirmarlo quien pertenece a ella, sea cual sea su rol', async () => {
    const m = await env.movimiento({ usuarioDespachaId: usuarios.pais.id, destinoAgenciaId: agencia1.id, estadoDespacho: 'EN_TRANSITO' });
    const otro = await env.movimiento({ usuarioDespachaId: usuarios.pais.id, destinoAgenciaId: agencia2.id, estadoDespacho: 'EN_TRANSITO' });

    const delAgencia: any[] = await service.obtenerDespachosPendientes(usuarios.agencia.id);
    const guias = delAgencia.map((d) => d.numeroGuia);

    expect(guias).toContain(m.numeroGuia);
    expect(guias).not.toContain(otro.numeroGuia);
    expect(delAgencia.find((d) => d.numeroGuia === m.numeroGuia).puedeConfirmar).toBe(true);
  });
});
