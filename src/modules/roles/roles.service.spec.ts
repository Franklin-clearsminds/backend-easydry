import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RolesService } from './roles.service.js';
import { ROLES_BASE } from '../../common/permisos/roles-base.js';
import { accionesLegacy } from '../../common/permisos/acciones-legacy.js';
import { modulosDeCapacidades } from '../../common/permisos/modulos-navegacion.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks), con el servicio de notificaciones real.
 *
 * Para no tocar los roles oficiales de la base, los casos de "rol oficial" se prueban sobre roles de prueba creados
 * con la marca `esSistema: true` (el servicio decide "oficial" por esa marca). La única excepción es BACKUP, que el
 * servicio reconoce por nombre: se cambia su ámbito de verdad y se restaura al terminar.
 */
describe('RolesService (base real)', () => {
  let env: Entorno;
  let service: RolesService;
  let inicio: Date;
  let superAdmin: any;
  let admin: any;
  let supervisor: any;

  beforeAll(async () => {
    inicio = new Date();
    env = await abrirEntorno();
    service = new RolesService(env.prisma as never, env.notificaciones());

    const sa = await env.usuario('sa', 'SUPER_ADMIN', { name: 'Super' });
    superAdmin = await env.actor(sa.id);
    const ad = await env.usuario('admin', 'ADMIN', { name: 'Administradora' });
    // Un administrador al que se le dio el permiso de gestionar roles (no lo trae de fábrica).
    admin = await env.actor(ad.id);
    admin.roleDetails = { ...admin.roleDetails, capacidades: [...admin.roleDetails.capacidades, 'roles.gestionar'] };
    const su = await env.usuario('supervisor', 'SUPERVISOR', { name: 'Supervisor' });
    supervisor = await env.actor(su.id);
    supervisor.roleDetails = { ...supervisor.roleDetails, capacidades: [...supervisor.roleDetails.capacidades, 'roles.gestionar'] };
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const nombre = (s: string) => `${env.marca}_${s}`.toUpperCase();
  const enBase = (id: string) => env.prisma.role.findUniqueOrThrow({ where: { id } });
  const rastrearPorNombre = async (namerol: string) => {
    const r = await env.prisma.role.findUniqueOrThrow({ where: { namerol } });
    env.rastrear('Role', r.id);
    return r;
  };
  /** Rol "oficial" de prueba: copia los permisos y el ámbito de un rol de fábrica, con la marca esSistema. */
  const oficial = async (sufijo: string, base: string) => {
    const b = ROLES_BASE.find((x) => x.namerol === base)!;
    const r = await env.prisma.role.create({
      data: {
        namerol: nombre(sufijo),
        esSistema: true,
        capacidades: [...b.capacidades],
        ambito: b.ambito,
        permisos: modulosDeCapacidades(b.capacidades, b.namerol),
        acciones: accionesLegacy(b.capacidades, b.ambito) as never,
      },
    });
    env.rastrear('Role', r.id);
    return r;
  };
  /** Rol propio (no oficial) de prueba. */
  const propio = async (sufijo: string, ambito = 'AGENCIA') => {
    const r = await env.prisma.role.create({ data: { namerol: nombre(sufijo), esSistema: false, capacidades: [], ambito } });
    env.rastrear('Role', r.id);
    return r;
  };
  const avisosDelRol = (roleId: string) =>
    env.prisma.notification.findMany({ where: { entidadTipo: 'ROL', entidadId: roleId } });
  const espera = (ms = 400) => new Promise((ok) => setTimeout(ok, ms));

  describe('crear', () => {
    it('crea un rol nuevo con sus permisos, ámbito y acciones para la web', async () => {
      const r: any = await service.create(
        { namerol: `${env.marca} inspector zona`, capacidades: ['servicios.ver', 'agencias.ver'], ambito: 'REGION', permisos: ['dashboard'] } as any,
        superAdmin,
      );
      const fila = await rastrearPorNombre(nombre('INSPECTOR_ZONA'));
      expect(fila.esSistema).toBe(false);
      expect(fila.ambito).toBe('REGION');
      expect(fila.capacidades).toEqual(expect.arrayContaining(['servicios.ver', 'agencias.ver', 'pagina.servicios', 'pagina.servicios.generales']));
      expect((fila.acciones as any).verTodosServicios).toBe(true);
      expect(r.ambito).toBe('REGION');
    });

    it('las pantallas del rol nuevo salen de sus permisos, no de lo que mande el cliente', async () => {
      await service.create({ namerol: `${env.marca} rol x`, capacidades: ['inventario.ver'], permisos: ['usuarios'] } as any, superAdmin);
      const fila = await rastrearPorNombre(nombre('ROL_X'));
      expect(fila.permisos).toEqual(['notificaciones', 'inventario', 'perfil']);
    });

    it('rechaza permisos que no existen y ámbito inválido', async () => {
      await expect(service.create({ namerol: `${env.marca} malo`, capacidades: ['inventado.todo'] } as any, superAdmin)).rejects.toThrow(/Permisos desconocidos/);
      await expect(service.create({ namerol: `${env.marca} malo`, ambito: 'MUNDIAL' } as any, superAdmin)).rejects.toThrow(/Ámbito inválido/);
      expect(await env.prisma.role.count({ where: { namerol: nombre('MALO') } })).toBe(0);
    });

    it('rechaza nombres reservados, mal formados o repetidos', async () => {
      await expect(service.create({ namerol: 'SUPER_ADMIN' } as any, superAdmin)).rejects.toThrow(/reservado/);
      await expect(service.create({ namerol: 'a' } as any, superAdmin)).rejects.toThrow(/3 a 40/);
      await service.create({ namerol: `${env.marca} repetido` } as any, superAdmin);
      await rastrearPorNombre(nombre('REPETIDO'));
      await expect(service.create({ namerol: `${env.marca} repetido` } as any, superAdmin)).rejects.toThrow(/ya existe/);
    });

    it('quien no es SUPER_ADMIN no puede otorgar permisos ni un ámbito que su propio rol no tiene', async () => {
      await expect(service.create({ namerol: `${env.marca} escala`, capacidades: ['compras.registrar'] } as any, supervisor)).rejects.toThrow(/no tiene/);
      await expect(
        service.create({ namerol: `${env.marca} escala`, capacidades: ['servicios.ver'], ambito: 'GLOBAL' } as any, supervisor),
      ).rejects.toThrow(/ámbito más amplio/);
      expect(await env.prisma.role.count({ where: { namerol: nombre('ESCALA') } })).toBe(0);

      await expect(
        service.create({ namerol: `${env.marca} escala`, capacidades: ['servicios.ver'], ambito: 'REGION' } as any, supervisor),
      ).resolves.toBeDefined();
      await rastrearPorNombre(nombre('ESCALA'));
    });
  });

  describe('editar', () => {
    it('SUPER_ADMIN es inmutable', async () => {
      const real = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'SUPER_ADMIN' } });
      await expect(service.update({ id: real.id, estado: 0 } as any, superAdmin)).rejects.toThrow(/inmutable/);
      expect((await enBase(real.id)).estado).toBe(1);
    });

    it('un rol oficial puede cambiar de permisos pero no de nombre, y avisa a los administradores', async () => {
      const rol = await oficial('LIDER-OF', 'LIDER');
      await expect(service.update({ id: rol.id, namerol: 'OTRO_NOMBRE' } as any, superAdmin)).rejects.toThrow(/rol oficial/);

      await service.update({ id: rol.id, capacidades: ['servicios.ver'] } as any, superAdmin);
      const fila = await enBase(rol.id);
      expect(fila.capacidades).toContain('servicios.ver');
      expect(fila.capacidades).not.toContain('servicios.crear');
      expect((fila.acciones as any).registrarServicio).toBe(false);

      const avisos = await env.esperar(async () => {
        const a = await avisosDelRol(rol.id);
        return a.length ? a : null;
      });
      expect(avisos[0].mensaje).toContain(rol.namerol);
    });

    it('notifica solo cuando cambia la configuración efectiva de permisos', async () => {
      const igual = await oficial('SIN-CAMBIO', 'LIDER');
      await service.update({ id: igual.id, capacidades: [...igual.capacidades] } as any, superAdmin);
      await espera();
      expect(await avisosDelRol(igual.id)).toEqual([]);

      const cambia = await oficial('CON-CAMBIO', 'LIDER');
      await service.update({ id: cambia.id, capacidades: ['servicios.ver'] } as any, superAdmin);
      const avisos = await env.esperar(async () => {
        const a = await avisosDelRol(cambia.id);
        return a.length ? a : null;
      }, 40_000); // el aviso se envía en segundo plano y, con varios archivos en paralelo, puede tardar
      expect(avisos[0].mensaje).toContain(superAdmin.nombre); // quién hizo el cambio
    });

    it('dar una página habilita su pantalla: coordinador de mantenimiento con la página Inventario ve Inventario', async () => {
      const rol = await oficial('MANT', 'COORD_MANTENIMIENTO');
      const capacidades = [...rol.capacidades, 'pagina.inventario'];
      const r: any = await service.update({ id: rol.id, capacidades } as any, superAdmin);
      expect((await enBase(rol.id)).permisos).toContain('inventario');
      expect(r.permisos).toContain('inventario');
    });

    it('ignora la lista de pantallas que mande el cliente', async () => {
      const rol = await oficial('PANTALLAS', 'LIDER');
      const antes = (await enBase(rol.id)).permisos;
      await service.update({ id: rol.id, permisos: ['usuarios', 'reportes'] } as any, superAdmin);
      expect((await enBase(rol.id)).permisos).toEqual(antes);
    });

    it('el ámbito de un rol oficial no se puede cambiar: es una invariante, no una preferencia', async () => {
      // TECNICO llegó a tener ambito=PROPIO por este mismo hueco; ahora está bloqueado.
      const rol = await oficial('TECNICO-OF', 'TECNICO');
      await expect(service.update({ id: rol.id, ambito: 'PROPIO' } as any, superAdmin)).rejects.toThrow(/ámbito de un rol oficial/);
      expect((await enBase(rol.id)).ambito).toBe('REGION');
      // Pedir el mismo ámbito que ya tiene no es "cambiarlo": no debe romper el resto del update.
      await expect(service.update({ id: rol.id, ambito: 'REGION', capacidades: ['maquinaria.ver'] } as any, superAdmin)).resolves.toBeDefined();
      expect((await enBase(rol.id)).capacidades).toContain('maquinaria.ver');
    });

    it('el Super Admin puede cambiar el ámbito de BACKUP entre agencia y región (y se restaura al terminar)', async () => {
      const original = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'BACKUP' } });
      try {
        await service.update({ id: original.id, ambito: 'REGION' } as any, superAdmin);
        expect((await enBase(original.id)).ambito).toBe('REGION');
        await service.update({ id: original.id, ambito: 'AGENCIA' } as any, superAdmin);
        expect((await enBase(original.id)).ambito).toBe('AGENCIA');
      } finally {
        // Deja el rol oficial exactamente como estaba.
        await env.prisma.role.update({
          where: { id: original.id },
          data: { ambito: original.ambito, acciones: original.acciones as never, capacidades: original.capacidades, permisos: original.permisos },
        });
        await env.prisma.notification.deleteMany({ where: { entidadTipo: 'ROL', entidadId: original.id, createdAt: { gte: inicio } } });
      }
    });

    it('solo Super Admin puede cambiar el ámbito de BACKUP y no se permite GLOBAL ni PROPIO', async () => {
      const real = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'BACKUP' } });
      // Un supervisor que SÍ puede gestionar BACKUP (tiene todos sus permisos): aun así no le toca cambiar su ámbito.
      const supervisorConPermisosDeBackup = {
        ...supervisor,
        roleDetails: { ...supervisor.roleDetails, capacidades: [...new Set([...supervisor.roleDetails.capacidades, ...real.capacidades])], ambito: 'GLOBAL' },
      };
      await expect(service.update({ id: real.id, ambito: 'REGION' } as any, supervisorConPermisosDeBackup)).rejects.toThrow(/Solo el Super Administrador/);
      await expect(service.update({ id: real.id, ambito: 'GLOBAL' } as any, superAdmin)).rejects.toThrow(/solo puede ser AGENCIA o REGION/);
      await expect(service.update({ id: real.id, ambito: 'PROPIO' } as any, superAdmin)).rejects.toThrow(/solo puede ser AGENCIA o REGION/);
      expect((await enBase(real.id)).ambito).toBe(real.ambito); // sin cambios
    });

    it('un rol NO oficial sí puede cambiar de ámbito libremente (para SUPER_ADMIN)', async () => {
      const rol = await propio('PERSONAL');
      await service.update({ id: rol.id, ambito: 'REGION' } as any, superAdmin);
      expect((await enBase(rol.id)).ambito).toBe('REGION');
    });

    it('un rol no puede editar el suyo ni uno con permisos que no tiene', async () => {
      const suyo = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'ADMIN' } });
      await expect(service.update({ id: suyo.id, estado: 0 } as any, admin)).rejects.toThrow(/tu propio rol/);
      expect((await enBase(suyo.id)).estado).toBe(1);

      const ajeno = await oficial('BODEGA-OF', 'COORD_BODEGA');
      await expect(service.update({ id: ajeno.id, estado: 0 } as any, supervisor)).rejects.toThrow(/no tiene/);
      expect((await enBase(ajeno.id)).estado).toBe(1);
    });

    it('al editar solo se validan como otorgados los permisos nuevos', async () => {
      const rol = await oficial('SUP-OF', 'SUPERVISOR');
      // quitar permisos siempre está permitido
      await expect(service.update({ id: rol.id, capacidades: ['servicios.ver'] } as any, supervisor)).resolves.toBeDefined();
      expect((await enBase(rol.id)).capacidades).toContain('servicios.ver');
    });
  });

  describe('eliminar', () => {
    it('los roles oficiales y SUPER_ADMIN no se eliminan', async () => {
      const rol = await oficial('LIDER-NOBORRA', 'LIDER');
      await expect(service.delete(rol.id, superAdmin)).rejects.toThrow(/oficiales/);
      expect(await env.prisma.role.count({ where: { id: rol.id } })).toBe(1);

      const sa = await env.prisma.role.findUniqueOrThrow({ where: { namerol: 'SUPER_ADMIN' } });
      await expect(service.delete(sa.id, superAdmin)).rejects.toThrow(/SUPER_ADMIN/);
      expect(await env.prisma.role.count({ where: { id: sa.id } })).toBe(1);
    });

    it('un rol con usuarios asignados no se elimina', async () => {
      const rol = await propio('CON-USUARIOS');
      for (const i of [1, 2, 3]) await env.usuario(`u${i}`, rol.namerol);
      await expect(service.delete(rol.id, superAdmin)).rejects.toThrow(/3 usuario/);
      expect(await env.prisma.role.count({ where: { id: rol.id } })).toBe(1);
    });

    it('un rol propio sin usuarios se elimina de verdad (ya no se desactiva en silencio)', async () => {
      const rol = await propio('SIN-USUARIOS');
      await service.delete(rol.id, superAdmin);
      expect(await env.prisma.role.count({ where: { id: rol.id } })).toBe(0);
    });
  });
});
