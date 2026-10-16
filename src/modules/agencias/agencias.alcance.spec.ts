import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgenciasService } from './agencias.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks). Datos de partida, todos creados por esta prueba:
 *
 *  Región R1 ── Agencia A1: bahía B1 (Luis, LAVADOR, asignado) · Ana (LIDER)
 *            └─ Agencia A2: bahía B2 · Lara (LIDER)
 *  Región R2 ── Agencia A3: bahía B3
 *  Supervisor R1 · Supervisor R2 · Admin · Líder sin agencia
 */
describe('Agencias: alcance por rol (base real)', () => {
  let env: Entorno;
  let service: AgenciasService;
  let regionR1: any;
  let regionR2: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let b1: any;
  let b2: any;
  let b3: any;
  let ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AgenciasService(env.prisma as never);

    regionR1 = await env.region('R1');
    regionR2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: regionR1.id });
    a2 = await env.agencia('A2', { regionId: regionR1.id });
    a3 = await env.agencia('A3', { regionId: regionR2.id });
    b1 = await env.bahia('B1', a1.id);
    b2 = await env.bahia('B2', a2.id);
    b3 = await env.bahia('B3', a3.id);

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('ana', 'LIDER', { agenciaId: a1.id, name: 'Ana' });
    await crear('lara', 'LIDER', { agenciaId: a2.id, name: 'Lara' });
    await crear('luis', 'LAVADOR', { agenciaId: a1.id, name: 'Luis' });
    await crear('supR1', 'SUPERVISOR', { regionId: regionR1.id });
    await crear('supR2', 'SUPERVISOR', { regionId: regionR2.id });
    await crear('admin', 'ADMIN');
    await crear('sinSede', 'LIDER');

    // Luis trabaja en la bahía B1; B1 y B3 tienen historial de asignaciones.
    await env.prisma.bahiaOperador.create({ data: { bahiaId: b1.id, operadorId: ids.luis } });
    await env.prisma.historialAsignacionBahia.create({ data: { bahiaId: b1.id, operadorId: ids.luis, asignadoPorId: ids.admin } });
    await env.prisma.historialAsignacionBahia.create({ data: { bahiaId: b3.id, operadorId: ids.luis, asignadoPorId: ids.admin } });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('detalle de agencia', () => {
    it('cada rol solo ve el detalle de agencias de su alcance', async () => {
      await expect(service.detailAgencia(a1.id, actores.lara)).rejects.toThrow(/alcance/); // líder de otra agencia
      await expect(service.detailAgencia(a1.id, actores.supR2)).rejects.toThrow(/alcance/); // supervisor de otra región
      await expect(service.detailAgencia(a1.id, actores.sinSede)).rejects.toThrow(/alcance/); // líder sin agencia
      await expect(service.detailAgencia(a1.id, actores.ana)).resolves.toBeDefined();
      await expect(service.detailAgencia(a1.id, actores.supR1)).resolves.toBeDefined();
      await expect(service.detailAgencia(a1.id, actores.admin)).resolves.toBeDefined();
    });

    it('solo el administrador recibe los correos del personal', async () => {
      const comoLider: any = await service.detailAgencia(a1.id, actores.ana);
      const luisParaLider = comoLider.usuarios.find((u: any) => u.id === ids.luis);
      expect(luisParaLider.name).toBe('Luis');
      expect(luisParaLider).not.toHaveProperty('email');

      const comoAdmin: any = await service.detailAgencia(a1.id, actores.admin);
      const luisParaAdmin = comoAdmin.usuarios.find((u: any) => u.id === ids.luis);
      expect(luisParaAdmin.email).toBe(`${env.marca}-luis@prueba.local`);
    });

    it('el correo y el teléfono los ve quien tenga la casilla, aunque no sea administrador', async () => {
      const base = actores.ana;
      const sin: any = await service.detailAgencia(a1.id, base);
      expect(sin.usuarios.find((u: any) => u.id === ids.luis)).not.toHaveProperty('email');

      const con = { ...base, roleDetails: { ...base.roleDetails, capacidades: [...base.roleDetails.capacidades, 'datos.contacto.ver'] } };
      const visto: any = await service.detailAgencia(a1.id, con);
      expect(visto.usuarios.find((u: any) => u.id === ids.luis).email).toBe(`${env.marca}-luis@prueba.local`);
    });
  });

  describe('bahías: lectura y edición dentro del alcance', () => {
    const mias = (lista: any[]) => lista.filter((b) => String(b.nombre).includes(env.marca)).map((b) => b.id).sort();

    it('la lista de bahías se acota a la agencia o región del usuario', async () => {
      expect(mias((await service.listBahias({} as any, actores.ana)) as any[])).toEqual([b1.id]);
      expect(mias((await service.listBahias({} as any, actores.supR1)) as any[])).toEqual([b1.id, b2.id].sort());
      // El administrador ve toda la red (cientos de bahías reales): se acota con el marcador para que la página las incluya.
      expect(mias((await service.listBahias({ search: env.marca } as any, actores.admin)) as any[])).toEqual([b1.id, b2.id, b3.id].sort());
      // Un líder sin agencia no ve ninguna bahía, ni siquiera las de otros.
      expect((await service.listBahias({} as any, actores.sinSede)) as any[]).toEqual([]);
    });

    it('el líder edita, activa y asigna solo en bahías de su agencia', async () => {
      const ajeno = actores.lara;
      await expect(service.updateBahia({ id: b1.id, nombre: 'X' } as any, ajeno)).rejects.toThrow(/alcance/);
      await expect(service.toggleActivaBahia({ id: b1.id } as any, ajeno)).rejects.toThrow(/alcance/);
      await expect(service.asignarOperadorABahia({ bahiaId: b1.id, operadorId: ids.luis } as any, ids.admin, ajeno)).rejects.toThrow(/alcance/);
      await expect(service.desasignarOperadorDeBahia({ bahiaId: b1.id, operadorId: ids.luis } as any, ids.admin, ajeno)).rejects.toThrow(/alcance/);

      // Nada cambió en la base.
      const intacta = await env.prisma.bahia.findUniqueOrThrow({ where: { id: b1.id } });
      expect(intacta.nombre).toBe(b1.nombre);
      expect(intacta.activa).toBe(true);
      expect(await env.prisma.bahiaOperador.count({ where: { bahiaId: b1.id, operadorId: ids.luis, activo: true } })).toBe(1);

      // El líder de la agencia sí puede.
      // Renombrar no tiene casilla: el líder solo activa o desactiva.
      await expect(service.updateBahia({ id: b1.id, nombre: `${env.marca} Nueva` } as any, actores.ana)).rejects.toThrow(/cambiar el nombre/);
      await service.toggleActivaBahia({ id: b1.id } as any, actores.ana);
      expect((await env.prisma.bahia.findUniqueOrThrow({ where: { id: b1.id } })).activa).toBe(false);
      await service.toggleActivaBahia({ id: b1.id } as any, actores.ana); // la deja como estaba
    });

    it('el supervisor edita bahías solo de su región', async () => {
      await expect(service.updateBahia({ id: b2.id, nombre: 'X' } as any, actores.supR2)).rejects.toThrow(/alcance/);
      await expect(service.updateBahia({ id: b2.id, nombre: `${env.marca} Editada` } as any, actores.supR1)).rejects.toThrow(/cambiar el nombre/);
      await expect(service.updateBahia({ id: b2.id } as any, actores.supR1)).resolves.toBeDefined();
    });

    it('los operadores de una bahía se leen solo dentro del alcance y sin correo para quien no es administrador', async () => {
      await expect(service.listarOperadoresDeBahia(b1.id, actores.lara)).rejects.toThrow(/alcance/);
      const comoLider: any = await service.listarOperadoresDeBahia(b1.id, actores.ana);
      expect(comoLider).toHaveLength(1);
      expect(comoLider[0].operador.id).toBe(ids.luis);
      expect(comoLider[0].operador).not.toHaveProperty('email');
      const comoAdmin: any = await service.listarOperadoresDeBahia(b1.id, actores.admin);
      expect(comoAdmin[0].operador.email).toBe(`${env.marca}-luis@prueba.local`);
    });

    it('el historial de asignaciones solo incluye bahías de su alcance', async () => {
      const comoLider: any = await service.obtenerHistorialAsignaciones({ search: env.marca } as any, actores.ana);
      expect(comoLider.items.map((h: any) => h.bahia.id)).toEqual([b1.id]);
      const comoAdmin: any = await service.obtenerHistorialAsignaciones({ search: env.marca } as any, actores.admin);
      expect(comoAdmin.items.map((h: any) => h.bahia.id).sort()).toEqual([b1.id, b3.id].sort());
    });
  });

  describe('editar una agencia', () => {
    it('el supervisor solo edita agencias de su región y no puede moverlas de región ni cambiar cliente o estado', async () => {
      await expect(service.updateAgencia({ id: a1.id, nombre: 'X' } as any, actores.supR2)).rejects.toThrow(/alcance/);
      await expect(service.updateAgencia({ id: a1.id, regionId: regionR2.id } as any, actores.supR1)).rejects.toThrow(/solo para administradores/);
      await expect(service.updateAgencia({ id: a1.id, clienteId: 'c2' } as any, actores.supR1)).rejects.toThrow(/solo para administradores/);
      await expect(service.updateAgencia({ id: a1.id, estado: 0 } as any, actores.supR1)).rejects.toThrow(/solo para administradores/);

      const intacta = await env.prisma.agencia.findUniqueOrThrow({ where: { id: a1.id } });
      expect(intacta.regionId).toBe(regionR1.id);
      expect(intacta.estado).toBe(1);
    });
  });

  describe('asignar usuarios', () => {
    it('un usuario pertenece a una sola agencia: agenciasIds se rechaza', async () => {
      await expect(service.asignarUsuario({ usuarioId: ids.luis, agenciasIds: [a1.id, a2.id] } as any)).rejects.toThrow(/una sola agencia/);
    });
  });
});
