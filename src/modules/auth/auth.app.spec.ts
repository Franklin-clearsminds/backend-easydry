import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { modulosDeRol } from '../../common/permisos/modulos-navegacion.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): qué pantallas ve cada rol en la app móvil.
 * Las pantallas "marcadas para la app" se leen de la tabla `modulos_sistema` tal como la dejó el seed.
 * `infoApp` no usa el almacenamiento S3, por eso el cuarto argumento del constructor no se instancia.
 */
describe('acceso y pantallas de la app (infoApp, base real)', () => {
  let env: Entorno;
  let service: AuthService;
  let marcadas: string[]; // módulos activos y disponibles en la app
  let noMarcadas: string[]; // módulos de la web que NO están en la app
  const rolDeBase = async (namerol: string) => {
    const r = await env.prisma.role.findUniqueOrThrow({ where: { namerol } });
    return { namerol: r.namerol, capacidades: r.capacidades };
  };
  const infoApp = (rol: any) => (service as any).infoApp(rol);

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new AuthService(env.prisma as never, new JwtService({}), new ConfigService(), undefined as never);
    const modulos = await env.prisma.moduloSistema.findMany({ where: { estado: 1 }, select: { codigo: true, disponibleEnApp: true } });
    marcadas = modulos.filter((m) => m.disponibleEnApp).map((m) => m.codigo);
    noMarcadas = modulos.filter((m) => !m.disponibleEnApp).map((m) => m.codigo);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  it('la base tiene pantallas marcadas y no marcadas para la app (el seed está cargado)', () => {
    expect(marcadas.length).toBeGreaterThan(0);
    expect(noMarcadas.length).toBeGreaterThan(0);
  });

  it('el líder entra a la app y ve solo pantallas de su rol que estén marcadas para la app', async () => {
    const lider = await rolDeBase('LIDER');
    const info = await infoApp(lider);
    expect(info.puedeUsarApp).toBe(true);
    expect(info.pantallasApp.length).toBeGreaterThan(0);
    // Cada pantalla está marcada para la app Y su rol tiene permiso para ella (salvo los retos, que da su propia casilla).
    const conRetos = lider.capacidades.includes('sistema.app.retos');
    for (const p of info.pantallasApp) {
      if (p === 'productividad' && conRetos) continue;
      expect(marcadas).toContain(p);
      expect(modulosDeRol(lider)).toContain(p);
    }
    // Y no falta ninguna que cumpla las dos condiciones.
    const esperadas = modulosDeRol(lider).filter((m) => marcadas.includes(m));
    if (conRetos) esperadas.push('productividad');
    expect([...info.pantallasApp].sort()).toEqual(esperadas.sort());
  });

  it('una pantalla de la web que no está marcada para la app nunca aparece en el celular', async () => {
    const info = await infoApp({ namerol: 'SUPER_ADMIN', capacidades: [] });
    for (const p of noMarcadas) expect(info.pantallasApp).not.toContain(p);
  });

  it('sin el permiso sync.usar no se entra a la app, aunque tenga pantallas', async () => {
    const info = await infoApp({ namerol: 'REPORTEROCUSTOM', capacidades: ['servicios.ver', 'inventario.ver'] });
    expect(info).toEqual({ puedeUsarApp: false, pantallasApp: [] });
  });

  it('el lavador entra a la app solo para ver sus resultados de auditoría (sin sincronizar ni operar)', async () => {
    const lavador = await rolDeBase('LAVADOR');
    expect(lavador.capacidades).not.toContain('sync.usar');
    const info = await infoApp(lavador);
    expect(info.puedeUsarApp).toBe(true);
    expect(info.pantallasApp).toEqual(expect.arrayContaining(['informes-inspeccion', 'auditorias-5s']));
    for (const p of ['servicios', 'inventario', 'taller-tecnico']) expect(info.pantallasApp).not.toContain(p);
  });

  it('«Ver retos en la app móvil» basta para ver los retos en el celular, aunque Productividad sea una pantalla solo de la web', async () => {
    expect(noMarcadas).toContain('productividad');
    const con = await infoApp({ namerol: 'CON_RETOS', capacidades: ['sync.usar', 'retos.ver', 'sistema.app.retos'] });
    expect(con.puedeUsarApp).toBe(true);
    expect(con.pantallasApp).toContain('productividad');
    const sin = await infoApp({ namerol: 'SIN_RETOS', capacidades: ['sync.usar', 'retos.ver', 'pagina.productividad'] });
    expect(sin.pantallasApp).not.toContain('productividad');
  });

  it('el super admin entra y ve todas las pantallas marcadas', async () => {
    const info = await infoApp({ namerol: 'SUPER_ADMIN', capacidades: [] });
    expect(info.puedeUsarApp).toBe(true);
    expect([...info.pantallasApp].sort()).toEqual([...marcadas].filter((m) => modulosDeRol({ namerol: 'SUPER_ADMIN' }).includes(m)).sort());
  });
});
