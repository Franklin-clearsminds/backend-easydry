import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { AgenciasService } from './agencias.service.js';
import { CacheService } from '../../common/cache/cache.service.js';
import { USUARIO_PREFIJO } from '../auth/jwt.strategy.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';
import { CODIGOS_PERMISOS } from '../../common/permisos/catalogo-permisos.js';
import { CATALOGO_PAGINAS_CODIGOS } from './agencias.password-asignar.helpers.js';

const CLAVE = 'Lavado#2026Seco';
const NUEVA = 'Taller*Norte84';
const PERMISO = 'usuarios.usuarios.password';

/**
 * Asignar o restablecer la contraseña de un usuario existente: hace falta el permiso `usuarios.usuarios.password` (Admin y Super Admin lo
 * tienen; se puede dar a otro rol desde Roles y Permisos) y se respetan los límites: nadie cambia la suya, el Super Administrador es
 * intocable, un Administrador solo lo cambia el Super Administrador, y se actúa dentro de la propia zona.
 */
describe('asignar contraseña a un usuario (base real)', () => {
  let env: Entorno;
  let cache: CacheService;
  let service: AgenciasService;
  const ids: Record<string, string> = {};

  /** Actor armado a mano: el rol, su ámbito, su zona y los permisos que se quieran probar. */
  const actor = (namerol: string, ambito: string, extra: Record<string, unknown> = {}, permisos: string[] = [PERMISO]) => ({
    id: `actor-${namerol}-${ambito}`,
    name: 'Quien',
    lastname: 'Asigna',
    email: 'quien@asigna.test',
    role: { namerol, ambito, capacidades: permisos },
    ...extra,
  });
  const claveDe = async (userId: string) => (await env.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true } })).passwordHash;
  const coincide = async (userId: string, clave: string) => bcrypt.compare(clave, await claveDe(userId));

  beforeAll(async () => {
    env = await abrirEntorno();
    cache = new CacheService(new ConfigService({ REDIS_PREFIX: 'pw-test' }));
    service = new AgenciasService(env.prisma as never, undefined, cache);
    const r1 = await env.region('pw1');
    const r2 = await env.region('pw2');
    const a1 = await env.agencia('pw1', { regionId: r1.id });
    const a2 = await env.agencia('pw2', { regionId: r1.id }); // misma región, otra agencia
    const a3 = await env.agencia('pw3', { regionId: r2.id });
    const lav1 = await env.usuario('pw-lav1', 'LAVADOR', { agenciaId: a1.id, regionId: r1.id });
    const lav2 = await env.usuario('pw-lav2', 'LAVADOR', { agenciaId: a2.id, regionId: r1.id });
    const lav3 = await env.usuario('pw-lav3', 'LAVADOR', { agenciaId: a3.id, regionId: r2.id });
    const sup1 = await env.usuario('pw-sup1', 'SUPERVISOR', { regionId: r1.id });
    const sup2 = await env.usuario('pw-sup2', 'SUPERVISOR', { regionId: r2.id });
    const coord = await env.usuario('pw-coord', 'COORD_BODEGA');
    const admin = await env.usuario('pw-admin', 'ADMIN');
    const admin2 = await env.usuario('pw-admin2', 'ADMIN');
    Object.assign(ids, { r1: r1.id, r2: r2.id, a1: a1.id, a2: a2.id, a3: a3.id, lav1: lav1.id, lav2: lav2.id, lav3: lav3.id, sup1: sup1.id, sup2: sup2.id, coord: coord.id, admin: admin.id, admin2: admin2.id });
    const superAdmin = await env.prisma.user.findFirstOrThrow({ where: { email: 'superadmin@easydry.com' }, select: { id: true } });
    ids.superAdmin = superAdmin.id;
  });

  afterAll(async () => {
    await env.prisma.auditoriaDecision.deleteMany({ where: { entidad: 'USUARIO', entidadId: { in: Object.values(ids) } } });
    await cache.onModuleDestroy();
    await env.cerrar();
  });

  it('el permiso aparece en Roles y Permisos y lo tienen por defecto Admin y Super Admin, y ningún otro rol oficial', async () => {
    expect(CATALOGO_PAGINAS_CODIGOS).toContain(PERMISO);
    expect(CODIGOS_PERMISOS).toBeDefined();
    const conPermiso = (await env.prisma.role.findMany({ select: { namerol: true, capacidades: true } })).filter((r) => r.capacidades.includes(PERMISO)).map((r) => r.namerol);
    expect(conPermiso).toEqual(expect.arrayContaining(['ADMIN']));
    for (const otro of ['SUPERVISOR', 'LIDER', 'LAVADOR', 'PULIDOR', 'COORD_BODEGA', 'COORD_COMERCIAL', 'JEFE_COMERCIAL', 'COORD_SERVICIOS_ESPECIALES', 'ASISTENTE_BODEGA']) {
      expect(conPermiso, otro).not.toContain(otro);
    }
  });

  it('un administrador asigna la contraseña: queda guardada con hash, cierra las sesiones, borra la caché y deja constancia sin la clave', async () => {
    await env.prisma.user.update({ where: { id: ids.lav1 }, data: { passwordHash: await bcrypt.hash(CLAVE, 10) } });
    const sesion = await env.prisma.refreshSession.create({ data: { userId: ids.lav1, familyId: `fam-${env.marca}`, expiresAt: new Date(Date.now() + 3_600_000) } });
    await cache.set(`${USUARIO_PREFIJO}${ids.lav1}`, { viejo: true }, 60);

    const r = await service.asignarPassword({ id: ids.lav1, password: NUEVA }, actor('ADMIN', 'GLOBAL'));

    expect(r).toEqual({ ok: true });
    expect(await coincide(ids.lav1, NUEVA)).toBe(true);
    expect(await coincide(ids.lav1, CLAVE)).toBe(false);
    expect((await env.prisma.user.findUniqueOrThrow({ where: { id: ids.lav1 } })).sesionesRevocadasAt).not.toBeNull();
    expect((await env.prisma.refreshSession.findUniqueOrThrow({ where: { id: sesion.id } })).revokedAt).not.toBeNull();
    expect(await cache.get(`${USUARIO_PREFIJO}${ids.lav1}`)).toBeUndefined();
    const constancia = await env.prisma.auditoriaDecision.findMany({ where: { entidad: 'USUARIO', entidadId: ids.lav1, accion: 'ASIGNAR_PASSWORD' } });
    expect(constancia).toHaveLength(1);
    expect(JSON.stringify(constancia[0])).not.toContain(NUEVA);
    expect(constancia[0]).toMatchObject({ rol: 'ADMIN', regla: 'ADMIN' });
  });

  it('rechaza una contraseña débil (sin carácter especial, corta, común…) y no cambia nada', async () => {
    const antes = await claveDe(ids.lav2);
    for (const debil of ['Lavado2026Seco', 'corta#1A', 'Password#9x7Z', 'Taller#1234Zq']) {
      await expect(service.asignarPassword({ id: ids.lav2, password: debil }, actor('ADMIN', 'GLOBAL')), debil).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(service.asignarPassword({ id: ids.lav2, password: '   ' }, actor('ADMIN', 'GLOBAL'))).rejects.toBeInstanceOf(BadRequestException);
    expect(await claveDe(ids.lav2)).toBe(antes);
  });

  it('sin el permiso no se puede, aunque el rol sea administrador o supervisor', async () => {
    const antes = await claveDe(ids.lav1);
    await expect(service.asignarPassword({ id: ids.lav1, password: NUEVA }, actor('ADMIN', 'GLOBAL', {}, ['usuarios.usuarios.editar']))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.asignarPassword({ id: ids.lav1, password: NUEVA }, actor('SUPERVISOR', 'REGION', { regionId: ids.r1 }, []))).rejects.toThrow(/no tiene permiso/);
    expect(await claveDe(ids.lav1)).toBe(antes);
  });

  it('nadie cambia su propia contraseña, ni siquiera un administrador', async () => {
    await expect(service.asignarPassword({ id: ids.admin, password: NUEVA }, actor('ADMIN', 'GLOBAL', { id: ids.admin }))).rejects.toThrow(/tu propia contraseña/);
    await expect(service.asignarPassword({ id: ids.superAdmin, password: NUEVA }, actor('SUPER_ADMIN', 'GLOBAL', { id: ids.superAdmin }))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('el Super Administrador es intocable; un Administrador no cambia la de otro; solo el Super Administrador cambia la de un Administrador', async () => {
    const antesSuper = await claveDe(ids.superAdmin);
    await expect(service.asignarPassword({ id: ids.superAdmin, password: NUEVA }, actor('ADMIN', 'GLOBAL'))).rejects.toThrow(/Super Administrador es de sistema/);
    await expect(service.asignarPassword({ id: ids.superAdmin, password: NUEVA }, actor('SUPER_ADMIN', 'GLOBAL'))).rejects.toThrow(/Super Administrador es de sistema/);
    expect(await claveDe(ids.superAdmin)).toBe(antesSuper);

    const antesAdmin2 = await claveDe(ids.admin2);
    await expect(service.asignarPassword({ id: ids.admin2, password: NUEVA }, actor('ADMIN', 'GLOBAL', { id: ids.admin }))).rejects.toThrow(/Solo el Super Administrador/);
    expect(await claveDe(ids.admin2)).toBe(antesAdmin2);

    await service.asignarPassword({ id: ids.admin2, password: NUEVA }, actor('SUPER_ADMIN', 'GLOBAL', { id: 'otro-super' }));
    expect(await coincide(ids.admin2, NUEVA)).toBe(true);
  });

  it('un rol con el permiso delegado (supervisor regional) actúa solo en su región, y entre los demás roles no hay jerarquía', async () => {
    const supervisor = actor('SUPERVISOR', 'REGION', { id: ids.sup1, regionId: ids.r1 });
    // Lavador de una agencia de su región y de otra agencia de la misma región.
    await service.asignarPassword({ id: ids.lav2, password: NUEVA }, supervisor);
    expect(await coincide(ids.lav2, NUEVA)).toBe(true);
    // Un usuario de región sin agencia pero de su región: el otro supervisor de la misma región (sin jerarquía).
    const otroSupervisorDeSuRegion = await env.usuario('pw-sup1b', 'SUPERVISOR', { regionId: ids.r1 });
    await service.asignarPassword({ id: otroSupervisorDeSuRegion.id, password: NUEVA }, supervisor);
    expect(await coincide(otroSupervisorDeSuRegion.id, NUEVA)).toBe(true);
    // Fuera de su región: ni un lavador de una agencia de otra región ni un supervisor de otra región.
    for (const objetivo of [ids.lav3, ids.sup2]) {
      const antes = await claveDe(objetivo);
      await expect(service.asignarPassword({ id: objetivo, password: NUEVA }, supervisor)).rejects.toThrow(/no pertenece a tu zona/);
      expect(await claveDe(objetivo)).toBe(antes);
    }
    // Un usuario de ámbito país (coordinador) no está en una región concreta: queda fuera de la zona de un regional.
    await expect(service.asignarPassword({ id: ids.coord, password: NUEVA }, supervisor)).rejects.toThrow(/no pertenece a tu zona/);
    // Ni el delegado cambia la de un Administrador ni la del Super Administrador.
    await expect(service.asignarPassword({ id: ids.admin, password: NUEVA }, supervisor)).rejects.toThrow(/Solo el Super Administrador/);
    await expect(service.asignarPassword({ id: ids.superAdmin, password: NUEVA }, supervisor)).rejects.toBeInstanceOf(ForbiddenException);
    // Y la constancia dice que fue una delegación.
    const constancias = await env.prisma.auditoriaDecision.findMany({ where: { entidad: 'USUARIO', entidadId: ids.lav2, accion: 'ASIGNAR_PASSWORD' } });
    expect(constancias.at(-1)).toMatchObject({ rol: 'SUPERVISOR', regla: 'DELEGADO' });
  });

  it('un rol de agencia con el permiso actúa solo en su agencia; uno de país, en todo el país; sin ámbito válido, en nada', async () => {
    const lider = actor('LIDER', 'AGENCIA', { id: 'lider-pw', agenciaId: ids.a1 });
    await service.asignarPassword({ id: ids.lav1, password: CLAVE }, lider);
    expect(await coincide(ids.lav1, CLAVE)).toBe(true);
    await expect(service.asignarPassword({ id: ids.lav2, password: CLAVE }, lider)).rejects.toThrow(/no pertenece a tu zona/); // otra agencia de su misma región
    await expect(service.asignarPassword({ id: ids.lav3, password: CLAVE }, lider)).rejects.toThrow(/no pertenece a tu zona/);

    const pais = actor('COORD_BODEGA', 'GLOBAL', { id: ids.coord });
    await service.asignarPassword({ id: ids.lav3, password: CLAVE }, pais);
    expect(await coincide(ids.lav3, CLAVE)).toBe(true);

    for (const sinZona of [actor('SUPERVISOR', 'REGION', { id: 'sin-region' }), actor('LIDER', 'AGENCIA', { id: 'sin-agencia' }), actor('LAVADOR', 'PROPIO', { id: 'propio' })]) {
      await expect(service.asignarPassword({ id: ids.lav1, password: NUEVA }, sinZona)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('un usuario que no existe da 404', async () => {
    await expect(service.asignarPassword({ id: 'no-existe', password: NUEVA }, actor('ADMIN', 'GLOBAL'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('desde el formulario de edición la contraseña sigue las mismas reglas (política, permiso, zona y propia)', async () => {
    const antes = await claveDe(ids.lav1);
    await expect(service.updateUsuario({ id: ids.lav1, password: 'Lavado2026Seco' } as any, actor('ADMIN', 'GLOBAL'))).rejects.toThrow(/carácter especial/);
    await expect(service.updateUsuario({ id: ids.lav1, password: NUEVA } as any, actor('ADMIN', 'GLOBAL', {}, ['usuarios.usuarios.editar']))).rejects.toThrow(/no tiene permiso/);
    await expect(service.updateUsuario({ id: ids.lav3, password: NUEVA } as any, actor('SUPERVISOR', 'REGION', { id: ids.sup1, regionId: ids.r1 }, [PERMISO, 'usuarios.usuarios.editar']))).rejects.toThrow(/no pertenece a tu zona/);
    expect(await claveDe(ids.lav1)).toBe(antes);
  });
});
