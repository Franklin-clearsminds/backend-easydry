import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InformesInspeccionService } from './informes.service.js';
import { SellosService } from './sellos.service.js';
import { CryptoService } from '../../common/crypto/crypto.service.js';
import { Auditoria5sService } from './auditoria5s.service.js';
import { FORMATOS } from './auditoria5s.reglas.js';
import { tienePermiso } from '../../common/permisos/capacidades.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): informes de inspección y auditorías 5S.
 *
 * Mundo: región R1 con las agencias A y B, y región R2 con la agencia C. Usuarios con los roles oficiales ya sembrados:
 *  - APROBADOR (agencia A) y TECNICO (región R1): auditan.
 *  - SUPERVISOR (región R1) y ADMIN: auditan y además administran los borradores de otros y verifican acciones.
 *  - LIDER y LAVADOR (agencia A) y PULIDOR (agencia B): no auditan, solo ven resultados.
 */
describe('auditorías (informes de inspección y 5S) — base real', () => {
  let env: Entorno;
  let informes: InformesInspeccionService;
  let sellos: SellosService;
  let crypto: CryptoService;
  let a5s: Auditoria5sService;
  const PASS = 'Taller#Seguro81';
  /** PNG de 1x1: sirve de firma y de logo en las pruebas. */
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  let sello: { id: string };
  const ag: Record<string, { id: string; nombre: string }> = {};
  const u: Record<string, any> = {};

  const hoy = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    env = await abrirEntorno();
    crypto = new CryptoService({ get: (k: string) => process.env[k] } as never);
    sellos = new SellosService(env.prisma as never, crypto);
    informes = new InformesInspeccionService(env.prisma as never, sellos, crypto);
    a5s = new Auditoria5sService(env.prisma as never);
    const r1 = await env.region('r1');
    const r2 = await env.region('r2');
    ag.A = await env.agencia('a', { regionId: r1.id });
    ag.B = await env.agencia('b', { regionId: r1.id });
    ag.C = await env.agencia('c', { regionId: r2.id });
    const crear = async (clave: string, rol: string, opts: { agenciaId?: string; regionId?: string } = {}) => {
      const x = await env.usuario(clave, rol, opts);
      u[clave] = await env.actor(x.id);
    };
    await crear('aprobador', 'APROBADOR', { agenciaId: ag.A.id });
    await crear('tecnico', 'TECNICO', { regionId: r1.id });
    await crear('supervisor', 'SUPERVISOR', { regionId: r1.id });
    await crear('admin', 'ADMIN');
    await crear('lider', 'LIDER', { agenciaId: ag.A.id });
    await crear('lavador', 'LAVADOR', { agenciaId: ag.A.id });
    await crear('pulidor', 'PULIDOR', { agenciaId: ag.B.id });
    sello = await sellos.crear({ nombre: 'Carlos', apellido: `Mora ${env.marca}`, logo: PNG, password: PASS }, u.admin);
    env.rastrear('SelloJefeTaller', sello.id);
  });

  afterAll(async () => {
    await env.cerrar();
  });

  const rastrearInforme = (id: string) => env.rastrear('InformeInspeccion', id);
  const rastrearAuditoria = (id: string) => env.rastrear('Auditoria5s', id);

  describe('quién puede auditar (permisos reales de la base)', () => {
    it('líder, lavador y pulidor no auditan: solo ven resultados', () => {
      for (const clave of ['lider', 'lavador', 'pulidor']) {
        expect(tienePermiso(u[clave], 'informes.ver'), clave).toBe(true);
        expect(tienePermiso(u[clave], 'inspecciones.ver'), clave).toBe(true);
        for (const c of ['informes.crear', 'informes.firmar', 'informes.administrar', 'sellos.gestionar', 'inspecciones.crear', 'inspecciones.acciones', 'inspecciones.verificar']) {
          expect(tienePermiso(u[clave], c), `${clave} ${c}`).toBe(false);
        }
      }
    });

    it('el resto de roles auditan; supervisor y administrador además administran los borradores de otros', () => {
      for (const clave of ['aprobador', 'tecnico', 'supervisor', 'admin']) {
        expect(tienePermiso(u[clave], 'informes.crear'), clave).toBe(true);
        expect(tienePermiso(u[clave], 'inspecciones.crear'), clave).toBe(true);
      }
      expect(tienePermiso(u.aprobador, 'informes.administrar')).toBe(false);
      expect(tienePermiso(u.tecnico, 'inspecciones.verificar')).toBe(false);
      expect(tienePermiso(u.supervisor, 'informes.administrar')).toBe(true);
      expect(tienePermiso(u.supervisor, 'inspecciones.verificar')).toBe(true);
    });

    it('los sellos de jefes de taller solo los configuran Admin y Super Admin', () => {
      expect(tienePermiso(u.admin, 'sellos.gestionar')).toBe(true);
      for (const clave of ['aprobador', 'tecnico', 'supervisor', 'lider', 'lavador', 'pulidor']) expect(tienePermiso(u[clave], 'sellos.gestionar'), clave).toBe(false);
    });
  });

  describe('informes de inspección', () => {
    let id: string;
    const base = () => ({
      agenciaId: ag.A.id,
      destinatarioNombre: 'Jefe de taller de prueba',
      asunto: 'Visita mensual',
      antecedentes: 'Sin antecedentes',
      desarrollo: 'Todo en orden',
      novedades: [{ titulo: 'Manguera rota', categoria: 'MAQUINARIA', fotos: [] }],
      actividades: [{ nombre: 'Revisión de bahías' }],
      planes: [{ problema: 'Cambiar manguera' }],
    });

    it('solo se puede crear en una agencia del alcance', async () => {
      await expect(informes.create({ ...base(), agenciaId: ag.C.id }, u.aprobador)).rejects.toThrow(/fuera de tu alcance/);
      await expect(informes.create({ ...base(), agenciaId: ag.B.id }, u.aprobador)).rejects.toThrow(/fuera de tu alcance/);
      const d = await informes.create(base(), u.aprobador);
      id = d.id;
      rastrearInforme(id);
      expect(d.estado).toBe('BORRADOR');
      expect(d.numero).toMatch(/^INF-\d{4}-\d{4}$/);
      expect(d.numeroMensual).toBe(1);
      expect(d.historial.map((h: any) => h.accion)).toContain('CREADO');
    });

    it('el número mensual sigue por agencia y mes, y el identificador no se repite', async () => {
      const otro = await informes.create(base(), u.aprobador);
      rastrearInforme(otro.id);
      expect(otro.numeroMensual).toBe(2);
      const detalle = await informes.detail(id, u.aprobador);
      expect(otro.numero).not.toBe(detalle.numero);
    });

    it('no se guarda sin calificación; un borrador ajeno no se edita', async () => {
      await expect(informes.guardar(id, u.aprobador)).rejects.toThrow(/calificación/);
      await expect(informes.update({ ...base(), id, calificacion: 'BUENO' }, u.tecnico)).rejects.toThrow(/Solo quien elaboró/);
    });

    it('se guarda con novedades, calificación y observaciones; sin los permisos de calificar no se cambian', async () => {
      const d = await informes.update({ ...base(), id, calificacion: 'BUENO', observacionesJefeTaller: 'Buen trabajo' }, u.aprobador);
      expect(d.calificacion).toBe('BUENO');
      expect(d.calificadoPorNombre).toBeTruthy();
      expect(d.novedades).toHaveLength(1);
      // El responsable del plan es la agencia del informe y su fecha es la del día en que se crea: nunca «vencido».
      expect(d.planes[0].estadoEfectivo).toBe('PENDIENTE');
      expect(d.planes[0].personaResponsable).toBe(d.agencia.nombre);
      expect(d.planes[0].fechaCompromiso).toBe(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10));
    });

    it('antes de guardarse, el líder y el lavador no lo ven; quien audita sí, dentro de su alcance', async () => {
      await expect(informes.detail(id, u.lider)).rejects.toThrow(/fuera de tu alcance|No existe/);
      expect((await informes.list({ pageSize: 50 } as never, u.lider)).items.map((i: any) => i.id)).not.toContain(id);
      expect((await informes.list({ pageSize: 50 } as never, u.tecnico)).items.map((i: any) => i.id)).toContain(id);
      expect((await informes.list({ pageSize: 50 } as never, u.pulidor)).items.map((i: any) => i.id)).not.toContain(id);
    });

    it('el sello: una contraseña incorrecta no habilita; con la correcta queda validado con su nombre y logo', async () => {
      expect((await informes.detail(id, u.aprobador)).sello).toBeNull();
      await expect(informes.validarSello({ informeId: id, selloId: sello.id, password: 'incorrecta' }, u.aprobador)).rejects.toThrow(/incorrecta/);
      // Un borrador ajeno no se valida.
      await expect(informes.validarSello({ informeId: id, selloId: sello.id, password: PASS }, u.tecnico)).rejects.toThrow();
      const d = await informes.validarSello({ informeId: id, selloId: sello.id, password: PASS }, u.aprobador);
      expect(d.sello).toMatchObject({ id: sello.id, logo: PNG });
      expect(d.sello!.nombre).toContain('Carlos Mora');
      expect(d.historial.map((h: any) => h.accion)).toContain('SELLO_VALIDADO');
    });

    it('el logo del sello se guarda cifrado en la base y la API lo devuelve ya descifrado', async () => {
      const crudo = async (sql: string, ...p: unknown[]) => (await env.prisma.$queryRawUnsafe(sql, ...p)) as any[];
      const [s] = await crudo('SELECT "logo" FROM "sellos_jefe_taller" WHERE "id" = $1', sello.id);
      expect(s.logo.startsWith('enc1:')).toBe(true);
      expect(s.logo).not.toContain(PNG.slice(30, 60));
      expect((await sellos.list()).find((x) => x.id === sello.id)?.logo).toBe(PNG);

      const [i] = await crudo('SELECT "selloLogo" FROM "InformeInspeccion" WHERE "id" = $1', id);
      expect(i.selloLogo.startsWith('enc1:')).toBe(true);
      expect((await informes.detail(id, u.aprobador)).sello!.logo).toBe(PNG);

    });

    it('tras varios intentos fallidos el sello se bloquea, aunque después se escriba la contraseña correcta', async () => {
      const otro = await sellos.crear({ nombre: 'Luis', apellido: `Vega ${env.marca}`, password: PASS }, u.admin);
      env.rastrear('SelloJefeTaller', otro.id);
      for (let i = 0; i < 5; i++) await expect(sellos.verificar(otro.id, 'mal')).rejects.toThrow();
      await expect(sellos.verificar(otro.id, PASS)).rejects.toThrow(/Demasiados intentos|bloqueado/);
      expect((await sellos.list()).find((s) => s.id === otro.id)?.bloqueado).toBe(true);
      // Una contraseña nueva, puesta por el administrador, levanta el bloqueo.
      await sellos.editar({ id: otro.id, password: 'Otra#Clave74x' });
      expect(await sellos.verificar(otro.id, 'Otra#Clave74x')).toMatchObject({ id: otro.id });
    });

    it('las firmas: la del jefe de taller exige el sello validado; las demás piden quién firma; solo imágenes válidas', async () => {
      await expect(informes.firmar({ informeId: id, tipo: 'RESPONSABLE', imagen: PNG }, u.aprobador)).rejects.toThrow(/nombre/);
      await expect(informes.firmar({ informeId: id, tipo: 'RESPONSABLE', nombre: 'Ana', imagen: 'http://x/firma.png' }, u.aprobador)).rejects.toThrow(/imagen válida/);
      const d = await informes.firmar({ informeId: id, tipo: 'RESPONSABLE', nombre: 'Ana Ruiz', imagen: PNG }, u.aprobador);
      expect(d.firmas.find((f: any) => f.tipo === 'RESPONSABLE')).toMatchObject({ firmada: true, nombre: 'Ana Ruiz', imagen: PNG });
      // En la base la firma está cifrada; un dato anterior al cifrado (sin la marca) se sigue leyendo bien.
      const filas = () => env.prisma.$queryRawUnsafe('SELECT "imagen" FROM "InformeFirma" WHERE "informeId" = $1 AND "tipo" = $2', id, 'RESPONSABLE') as Promise<any[]>;
      const [cifrada] = await filas();
      expect(cifrada.imagen.startsWith('enc1:')).toBe(true);
      expect(cifrada.imagen).not.toContain(PNG.slice(30, 60));
      await env.prisma.$executeRawUnsafe('UPDATE "InformeFirma" SET "imagen" = $1 WHERE "informeId" = $2 AND "tipo" = $3', PNG, id, 'RESPONSABLE');
      expect((await informes.detail(id, u.aprobador)).firmas.find((x: any) => x.tipo === 'RESPONSABLE')?.imagen).toBe(PNG);
      expect(d.firmas.find((f: any) => f.tipo === 'LIDER_BAHIA')?.firmada).toBe(false);
      const jefe = await informes.firmar({ informeId: id, tipo: 'JEFE_TALLER', imagen: PNG }, u.aprobador);
      expect(jefe.firmas.find((f: any) => f.tipo === 'JEFE_TALLER')?.nombre).toContain('Carlos Mora');
    });

    it('si cambia el contenido las firmas se anulan y las repiten las mismas personas; guardar sin cambios no anula nada', async () => {
      // Guardar el borrador tal cual está no toca las firmas.
      const igual = await informes.update({ ...base(), id, calificacion: 'BUENO', observacionesJefeTaller: 'Buen trabajo' }, u.aprobador);
      expect(igual.firmas.filter((f: any) => f.firmada)).toHaveLength(2);
      expect(igual.sello!.validadoEn).toBeTruthy();

      // Un cambio real anula las firmas hechas sobre el contenido anterior.
      const cambiado = await informes.update({ ...base(), id, asunto: 'Visita mensual corregida', calificacion: 'BUENO', observacionesJefeTaller: 'Buen trabajo' }, u.aprobador);
      expect(cambiado.firmas.find((f: any) => f.tipo === 'RESPONSABLE')).toMatchObject({ firmada: false, desactualizada: true, nombre: 'Ana Ruiz' });
      expect(cambiado.firmas.find((f: any) => f.tipo === 'JEFE_TALLER')).toMatchObject({ firmada: false, desactualizada: true });
      expect(cambiado.sello!.validadoEn).toBeNull();
      expect(cambiado.sello!.nombre).toContain('Carlos Mora');
      expect(cambiado.historial.map((h: any) => h.accion)).toContain('FIRMAS_ANULADAS');
      await expect(informes.guardar(id, u.aprobador)).rejects.toThrow(/firma de responsable/);

      // Debe volver a firmar quien firmó la primera vez.
      await expect(informes.firmar({ informeId: id, tipo: 'RESPONSABLE', nombre: 'Otra Persona', imagen: PNG }, u.aprobador)).rejects.toThrow(/quien firmó la primera vez/);
      const resp = await informes.firmar({ informeId: id, tipo: 'RESPONSABLE', nombre: '  ana   RUIZ ', imagen: PNG }, u.aprobador);
      expect(resp.firmas.find((f: any) => f.tipo === 'RESPONSABLE')).toMatchObject({ firmada: true, desactualizada: false, nombre: 'Ana Ruiz' });

      // El jefe de taller: no se cambia por otro, y vuelve a validar su contraseña antes de firmar.
      const otro = await sellos.crear({ nombre: 'Pedro', apellido: `Lara ${env.marca}`, password: PASS }, u.admin);
      env.rastrear('SelloJefeTaller', otro.id);
      await expect(informes.validarSello({ informeId: id, selloId: otro.id, password: PASS }, u.aprobador)).rejects.toThrow(/mismo jefe de taller/);
      await expect(informes.firmar({ informeId: id, tipo: 'JEFE_TALLER', imagen: PNG }, u.aprobador)).rejects.toThrow(/Primero valida/);
      await informes.validarSello({ informeId: id, selloId: sello.id, password: PASS }, u.aprobador);
      const jefe = await informes.firmar({ informeId: id, tipo: 'JEFE_TALLER', imagen: PNG }, u.aprobador);
      expect(jefe.firmas.filter((f: any) => f.firmada)).toHaveLength(2);
    });

    it('si el jefe de taller no estuvo presente, no se pide su contraseña y el taller firma con el nombre escrito', async () => {
      const x = await informes.create({ ...base(), calificacion: 'BUENO', jefeTallerPresente: false }, u.aprobador);
      rastrearInforme(x.id);
      expect(x.jefeTallerPresente).toBe(false);
      expect(x.firmas.find((f: any) => f.tipo === 'JEFE_TALLER')).toMatchObject({ requerida: true, firmada: false });
      await expect(informes.validarSello({ informeId: x.id, selloId: sello.id, password: PASS }, u.aprobador)).rejects.toThrow(/no estuvo presente/);
      await expect(informes.firmar({ informeId: x.id, tipo: 'JEFE_TALLER', imagen: PNG }, u.aprobador)).rejects.toThrow(/nombre/);
      for (const [tipo, nombre] of [['RESPONSABLE', 'Ana Ruiz'], ['JEFE_TALLER', 'Mario Lopez'], ['LIDER_BAHIA', 'Luis Paz']]) {
        await informes.firmar({ informeId: x.id, tipo, nombre, imagen: PNG }, u.aprobador);
      }
      const guardado = await informes.guardar(x.id, u.aprobador);
      expect(guardado.estado).toBe('GUARDADO');
      expect(guardado.firmas.filter((f: any) => f.requerida && f.tipo !== 'RECEPCION').every((f: any) => f.firmada)).toBe(true);
    });

    it('marcar al jefe como ausente descarta su sello y su firma, y volver a marcarlo presente exige validarlo otra vez', async () => {
      const x = await informes.create({ ...base(), calificacion: 'BUENO' }, u.aprobador);
      rastrearInforme(x.id);
      await informes.validarSello({ informeId: x.id, selloId: sello.id, password: PASS }, u.aprobador);
      await informes.firmar({ informeId: x.id, tipo: 'JEFE_TALLER', imagen: PNG }, u.aprobador);
      await informes.firmar({ informeId: x.id, tipo: 'RESPONSABLE', nombre: 'Ana Ruiz', imagen: PNG }, u.aprobador);

      const ausente = await informes.update({ ...base(), id: x.id, calificacion: 'BUENO', jefeTallerPresente: false }, u.aprobador);
      expect(ausente.sello).toBeNull();
      expect(ausente.firmas.find((f: any) => f.tipo === 'JEFE_TALLER')).toMatchObject({ requerida: true, firmada: false, desactualizada: false });
      // Cambió lo que se firma: la del responsable debe repetirse.
      expect(ausente.firmas.find((f: any) => f.tipo === 'RESPONSABLE')).toMatchObject({ firmada: false, desactualizada: true });
      expect(ausente.historial.map((h: any) => h.accion)).toContain('JEFE_AUSENTE');

      const presente = await informes.update({ ...base(), id: x.id, calificacion: 'BUENO', jefeTallerPresente: true }, u.aprobador);
      expect(presente.jefeTallerPresente).toBe(true);
      expect(presente.sello).toBeNull();
      await expect(informes.guardar(x.id, u.aprobador)).rejects.toThrow(/jefe de taller con su contraseña/);
    });

    it('si el sello con que firmó el jefe ya no existe, lo puede validar otro sello con el mismo nombre, y no uno distinto', async () => {
      const original = await sellos.crear({ nombre: 'Elena', apellido: `Soto ${env.marca}`, password: PASS }, u.admin);
      env.rastrear('SelloJefeTaller', original.id);
      const x = await informes.create({ ...base(), calificacion: 'BUENO' }, u.aprobador);
      rastrearInforme(x.id);
      await informes.validarSello({ informeId: x.id, selloId: original.id, password: PASS }, u.aprobador);
      await informes.firmar({ informeId: x.id, tipo: 'JEFE_TALLER', imagen: PNG }, u.aprobador);
      // El sello desaparece: el informe conserva el nombre pero pierde el enlace.
      await env.prisma.selloJefeTaller.delete({ where: { id: original.id } });
      const huerfano = await informes.detail(x.id, u.aprobador);
      expect(huerfano.sello).toMatchObject({ id: null });
      expect(huerfano.sello!.nombre).toContain('Elena Soto');

      await expect(informes.validarSello({ informeId: x.id, selloId: sello.id, password: PASS }, u.aprobador)).rejects.toThrow(/mismo jefe de taller/);
      const mismo = await sellos.crear({ nombre: 'elena', apellido: `soto ${env.marca}`, password: PASS }, u.admin);
      env.rastrear('SelloJefeTaller', mismo.id);
      const d = await informes.validarSello({ informeId: x.id, selloId: mismo.id, password: PASS }, u.aprobador);
      expect(d.sello).toMatchObject({ id: mismo.id });
      expect(d.sello!.validadoEn).toBeTruthy();
    });

    it('no se guarda sin las firmas de responsable, taller y líder; la recepción no se firma aquí', async () => {
      await expect(informes.guardar(id, u.aprobador)).rejects.toThrow(/firma de líder de bahía/);
      await expect(informes.guardar(id, u.tecnico)).rejects.toThrow(/Solo quien elaboró/);
      await expect(informes.firmar({ informeId: id, tipo: 'RECEPCION', nombre: 'Rosa Gil', imagen: PNG }, u.aprobador)).rejects.toThrow(/Admin o Super Admin/);
      await informes.firmar({ informeId: id, tipo: 'LIDER_BAHIA', nombre: 'Luis Paz', imagen: PNG }, u.aprobador);
      const guardado = await informes.guardar(id, u.aprobador);
      expect(guardado.estado).toBe('GUARDADO');
      expect(guardado.guardadoEn).toBeTruthy();
      expect(guardado.aprobadoEn).toBeNull();
      expect(guardado.firmas.filter((f: any) => f.tipo !== 'RECEPCION').every((f: any) => f.firmada)).toBe(true);
      expect(guardado.firmas.find((f: any) => f.tipo === 'RECEPCION')).toMatchObject({ firmada: false, requerida: true });
      expect(guardado.permisos.puedeAprobar).toBe(false);
      expect((await informes.detail(id, u.admin)).permisos.puedeAprobar).toBe(true);
      expect(guardado.historial.map((h: any) => h.accion)).toEqual(expect.arrayContaining(['SELLO_VALIDADO', 'FIRMADO', 'GUARDADO']));
    });

    it('un informe guardado ya no cambia: ni el contenido, ni las firmas, ni el sello, ni se guarda otra vez', async () => {
      await expect(informes.update({ ...base(), id }, u.aprobador)).rejects.toThrow(/ya está guardado/);
      await expect(informes.update({ ...base(), id }, u.supervisor)).rejects.toThrow(/ya está guardado/);
      await expect(informes.firmar({ informeId: id, tipo: 'RESPONSABLE', nombre: 'Otro', imagen: PNG }, u.aprobador)).rejects.toThrow(/guardado/);
      await expect(informes.validarSello({ informeId: id, selloId: sello.id, password: PASS }, u.aprobador)).rejects.toThrow(/guardado/);
      await expect(informes.guardar(id, u.aprobador)).rejects.toThrow(/ya está guardado/);
      expect((informes as any).enviar).toBeUndefined();
      expect((informes as any).revisar).toBeUndefined();
      expect((informes as any).cerrar).toBeUndefined();
    });

    it('un Admin o Super Admin aprueba el informe guardado firmando la recepción; nadie más', async () => {
      for (const clave of ['aprobador', 'tecnico', 'supervisor']) {
        await expect(informes.aprobar({ informeId: id, imagen: PNG }, u[clave]), clave).rejects.toThrow();
      }
      await expect(informes.aprobar({ informeId: id, imagen: 'http://x/firma.png' }, u.admin)).rejects.toThrow(/imagen válida/);
      const ok = await informes.aprobar({ informeId: id, imagen: PNG }, u.admin);
      expect(ok.estado).toBe('GUARDADO');
      expect(ok.aprobadoEn).toBeTruthy();
      expect(ok.aprobadoPorNombre).toBeTruthy();
      expect(ok.firmas.find((f: any) => f.tipo === 'RECEPCION')).toMatchObject({ firmada: true, imagen: PNG, nombre: ok.aprobadoPorNombre });
      expect(ok.permisos.puedeAprobar).toBe(false);
      expect(ok.historial.map((h: any) => h.accion)).toContain('APROBADO');
      await expect(informes.aprobar({ informeId: id, imagen: PNG }, u.admin)).rejects.toThrow(/ya está aprobado/);
      // El contenido sigue sin poder cambiarse.
      await expect(informes.update({ ...base(), id }, u.admin)).rejects.toThrow(/ya está guardado/);
      // Un borrador no se aprueba.
      const borrador = await informes.create(base(), u.aprobador);
      rastrearInforme(borrador.id);
      await expect(informes.aprobar({ informeId: borrador.id, imagen: PNG }, u.admin)).rejects.toThrow(/ya guardado/);
      expect((await informes.list({ pageSize: 50 } as never, u.admin)).items.find((i: any) => i.id === id)?.aprobado).toBe(true);
    });

    it('el logo guardado en el informe no cambia aunque se cambie el sello después', async () => {
      await sellos.editar({ id: sello.id, logo: '' });
      const d = await informes.detail(id, u.aprobador);
      expect(d.sello!.logo).toBe(PNG);
    });

    it('ya guardado, el líder y el lavador de su agencia lo ven (solo lectura); el pulidor de otra agencia no', async () => {
      for (const clave of ['lider', 'lavador']) {
        const d = await informes.detail(id, u[clave]);
        expect(d.estado).toBe('GUARDADO');
        expect(Object.values(d.permisos).some(Boolean), clave).toBe(false);
      }
      await expect(informes.detail(id, u.pulidor)).rejects.toThrow();
      const ids = (await informes.list({ pageSize: 50 } as never, u.lavador)).items.map((i: any) => i.id);
      expect(ids).toEqual(expect.arrayContaining([id]));
      expect(ids).toHaveLength(2);
    });

    it('el seguimiento de un plan cambia su estado sin tocar el contenido guardado', async () => {
      const antes = await informes.detail(id, u.aprobador);
      const plan = antes.planes[0];
      const d = await informes.seguimientoPlan({ planId: plan.id, estado: 'COMPLETADO', observaciones: 'Se cambió la manguera' }, u.aprobador);
      expect(d.planes[0].estado).toBe('COMPLETADO');
      expect(d.planes[0].estadoEfectivo).toBe('COMPLETADO');
      expect(d.planes[0].completadoEn).toBeTruthy();
      expect(d.asunto).toBe(antes.asunto);
      await expect(informes.seguimientoPlan({ planId: plan.id, estado: 'PENDIENTE' }, u.lider)).rejects.toThrow();
    });

    it('solo un borrador se elimina', async () => {
      await expect(informes.eliminar(id, u.admin)).rejects.toThrow(/borrador/);
      const borrador = await informes.create(base(), u.aprobador);
      rastrearInforme(borrador.id);
      await expect(informes.eliminar(borrador.id, u.aprobador)).rejects.toThrow(); // el inspector no tiene permiso de eliminar
      expect((await informes.eliminar(borrador.id, u.supervisor)).success).toBe(true);
      await expect(informes.detail(borrador.id, u.admin)).rejects.toThrow();
    });

    it('el resumen cuenta solo lo que el usuario ve', async () => {
      const r = await informes.resumen(u.lavador);
      expect(r.total).toBe(2);
      expect(r.guardados).toBe(2);
      const sup = await informes.resumen(u.supervisor);
      expect(sup.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('auditoría 5S (tres formatos)', () => {
    const LISTA = FORMATOS.LISTA_20;
    const PUNTOS = FORMATOS.PUNTOS_25;
    const SINO = FORMATOS.SI_NO_50;
    let id: string;
    const resp20 = (puntaje: (n: number) => number | null) =>
      LISTA.criterios.map((c) => {
        const p = puntaje(c.numero);
        return p !== null && p < 5
          ? { criterio: c.numero, puntaje: p, hallazgo: `Hallazgo ${c.numero}`, accionCorrectiva: 'Corregir', fotos: [] }
          : { criterio: c.numero, puntaje: p };
      });

    it('el catálogo trae los tres formatos con sus preguntas, escala y reglas del semáforo', () => {
      const c = a5s.catalogo();
      expect(c.formatos.map((f) => f.id)).toEqual(['LISTA_20', 'PUNTOS_25', 'SI_NO_50']);
      expect(c.formatos.map((f) => f.categorias.flatMap((k) => k.criterios).length)).toEqual([20, 25, 50]);
      expect(c.formatos.map((f) => f.puntajeMaximo)).toEqual([100, 100, 50]);
      expect(c.areas.map((x) => x.id)).toEqual(['LAVADO', 'ASPIRADO', 'SECADO', 'ALMACENAMIENTO', 'ADMINISTRACION']);
    });

    it('se crea en una agencia del alcance; un borrador sin puntajes no tiene semáforo', async () => {
      await expect(a5s.create({ agenciaId: ag.C.id, area: 'LAVADO' }, u.aprobador)).rejects.toThrow(/fuera de tu alcance/);
      const sinArea = await a5s.create({ agenciaId: ag.A.id }, u.aprobador);
      rastrearAuditoria(sinArea.id);
      expect(sinArea.area).toBe('GENERAL');
      // Guardar de nuevo una auditoría sin área (el formulario devuelve «GENERAL») no debe fallar.
      expect((await a5s.update({ id: sinArea.id, agenciaId: ag.A.id, area: 'GENERAL' }, u.aprobador)).area).toBe('GENERAL');
      const d = await a5s.create({ agenciaId: ag.A.id, area: 'LAVADO', responsableAgencia: 'Responsable de prueba' }, u.aprobador);
      id = d.id;
      rastrearAuditoria(id);
      expect(d.estado).toBe('BORRADOR');
      expect(d.formato).toBe('LISTA_20');
      expect(d.codigo).toMatch(/^A5S-\d{4}-\d{4}$/);
      expect(d.criterios).toHaveLength(20);
      expect(d.resultado.evaluados).toBe(0);
    });

    it('guarda el avance sin contar lo pendiente como cero, y no deja guardar con criterios sin evaluar', async () => {
      const d = await a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: resp20((n) => (n <= 12 ? 5 : null)) }, u.aprobador);
      expect(d.estado).toBe('BORRADOR');
      expect(d.resultado.evaluados).toBe(12);
      expect(d.resultado.puntaje).toBe(60);
      await expect(a5s.guardar(id, u.aprobador)).rejects.toThrow(/faltan por evaluar 8/);
    });

    it('antes de guardarse, el líder y el lavador no la ven', async () => {
      await expect(a5s.detail(id, u.lider)).rejects.toThrow();
      expect((await a5s.list({ pageSize: 50 } as never, u.lavador)).items.map((i: any) => i.id)).not.toContain(id);
    });

    it('rechaza respuestas que no existen en el formato', async () => {
      await expect(a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: [{ criterio: 25, puntaje: 3 }] }, u.aprobador)).rejects.toThrow(/no existe en este formato/);
    });

    it('guarda con todos los criterios: fija el puntaje y el semáforo en el servidor y abre las acciones correctivas', async () => {
      // 16 criterios en 5 y 4 en 3 (Seiketsu): 92 puntos → verde
      await a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: resp20((n) => (n >= 13 && n <= 16 ? 3 : 5)) }, u.aprobador);
      const d = await a5s.guardar(id, u.aprobador);
      expect(d.estado).toBe('GUARDADA');
      expect(d.resultado.puntaje).toBe(92);
      expect(d.resultado.semaforo).toBe('VERDE');
      expect(d.resultado.porCategoria.map((c: any) => c.puntaje)).toEqual([20, 20, 20, 12, 20]);
      expect(d.acciones).toHaveLength(4);
      // El responsable es la agencia auditada y la fecha es la de creación: nunca «vencida».
      expect(d.acciones[0]).toMatchObject({ criterio: 13, prioridad: 'MEDIA', estado: 'PENDIENTE', estadoEfectivo: 'PENDIENTE', responsable: d.agencia.nombre });
      expect(d.acciones[0].fechaCompromiso).toBe(new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10));
      expect(d.acciones[0].codigo).toBe(`${d.codigo}-C13`);
    });

    it('lo guardado no se modifica ni se vuelve a guardar', async () => {
      await expect(a5s.update({ id, agenciaId: ag.A.id, area: 'LAVADO', respuestas: resp20(() => 0) }, u.aprobador)).rejects.toThrow(/ya está guardada/);
      await expect(a5s.guardar(id, u.aprobador)).rejects.toThrow();
      expect((await a5s.detail(id, u.aprobador)).resultado.puntaje).toBe(92);
    });

    it('líder y lavador de la agencia ven el resultado (solo lectura); el pulidor de otra agencia no', async () => {
      for (const clave of ['lider', 'lavador']) {
        const d = await a5s.detail(id, u[clave]);
        expect(d.resultado.semaforo).toBe('VERDE');
        expect(Object.values(d.permisos).some(Boolean), clave).toBe(false);
      }
      await expect(a5s.detail(id, u.pulidor)).rejects.toThrow();
    });

    it('la acción solo se cierra después de verificarla, sin alterar el puntaje histórico', async () => {
      const antes = await a5s.detail(id, u.aprobador);
      const accion = antes.acciones[0];
      await expect(a5s.seguimientoAccion({ id: accion.id, estado: 'EN_VERIFICACION' }, u.aprobador)).rejects.toThrow(/evidencia|describe/);
      const enVerif = await a5s.seguimientoAccion({ id: accion.id, estado: 'EN_VERIFICACION', observaciones: 'Se colocó el instructivo' }, u.aprobador);
      expect(enVerif.acciones[0].estado).toBe('EN_VERIFICACION');
      await expect(a5s.verificarAccion({ id: accion.id, decision: 'CERRAR' }, u.aprobador)).rejects.toThrow(/no puede verificar/);
      await expect(a5s.verificarAccion({ id: accion.id, decision: 'DEVOLVER' }, u.supervisor)).rejects.toThrow(/por qué/);
      const cerrada = await a5s.verificarAccion({ id: accion.id, decision: 'CERRAR' }, u.supervisor);
      expect(cerrada.acciones[0]).toMatchObject({ estado: 'CERRADA', verificadaPorNombre: expect.any(String) });
      expect(cerrada.resultado.puntaje).toBe(92);
      await expect(a5s.seguimientoAccion({ id: accion.id, estado: 'EN_PROCESO' }, u.aprobador)).rejects.toThrow(/ya está cerrada/);
    });

    it('la auditoría solo tiene dos estados: cerrar todas las acciones correctivas la deja guardada, no la cambia de estado', async () => {
      const d = await a5s.detail(id, u.supervisor);
      for (const accion of d.acciones.filter((x: any) => x.estado !== 'CERRADA')) {
        await a5s.seguimientoAccion({ id: accion.id, estado: 'EN_VERIFICACION', observaciones: 'Hecho' }, u.aprobador);
        await a5s.verificarAccion({ id: accion.id, decision: 'CERRAR' }, u.supervisor);
      }
      const final = await a5s.detail(id, u.supervisor);
      expect(final.acciones.every((x: any) => x.estado === 'CERRADA')).toBe(true);
      expect(final.estado).toBe('GUARDADA');
      expect((a5s as any).cerrar).toBeUndefined();
      expect((a5s as any).finalizar).toBeUndefined();
    });

    it('compara las auditorías guardadas de la misma agencia, área y formato, con la variación y la anterior', async () => {
      const segunda = await a5s.create({ agenciaId: ag.A.id, area: 'LAVADO', fecha: hoy, respuestas: resp20((n) => (n % 2 === 0 ? 5 : 4)) }, u.aprobador);
      rastrearAuditoria(segunda.id);
      const fin = await a5s.guardar(segunda.id, u.aprobador);
      expect(fin.anterior).toMatchObject({ codigo: expect.any(String), puntaje: 92 });
      expect(fin.anterior!.diferencia).toBe(fin.resultado.puntaje - 92);
      const historia = await a5s.comparar({ agenciaId: ag.A.id, area: 'LAVADO', formato: 'LISTA_20' }, u.supervisor);
      expect(historia.length).toBeGreaterThanOrEqual(2);
      expect(historia[0].variacion).toBeNull();
      const ultima = historia[historia.length - 1];
      expect(ultima.variacion).toBe(ultima.puntaje - historia[historia.length - 2].puntaje);
      expect(ultima.porCategoria).toHaveLength(5);
      // Otro formato de la misma agencia y área no se mezcla en la comparación.
      expect(await a5s.comparar({ agenciaId: ag.A.id, area: 'LAVADO', formato: 'SI_NO_50' }, u.supervisor)).toEqual([]);
    });

    describe('varios formatos en una misma visita', () => {
      let g: any;
      let idPuntos: string;
      let idSiNo: string;

      it('elegir los tres crea tres auditorías con los mismos datos, cada una con su código y formato', async () => {
        g = await a5s.create({ agenciaId: ag.A.id, area: 'SECADO', fecha: '2026-10-10', responsableAgencia: 'Ana', equipoPersona: 'Secadora 2', formatos: ['LISTA_20', 'PUNTOS_25', 'SI_NO_50'] }, u.aprobador);
        expect(g.hermanas).toHaveLength(3);
        expect(g.hermanas.map((h: any) => h.formato).sort()).toEqual(['LISTA_20', 'PUNTOS_25', 'SI_NO_50']);
        expect(new Set(g.hermanas.map((h: any) => h.codigo)).size).toBe(3);
        for (const h of g.hermanas) rastrearAuditoria(h.id);
        idPuntos = g.hermanas.find((h: any) => h.formato === 'PUNTOS_25').id;
        idSiNo = g.hermanas.find((h: any) => h.formato === 'SI_NO_50').id;
        const p = await a5s.detail(idPuntos, u.aprobador);
        expect(p).toMatchObject({ formato: 'PUNTOS_25', responsableAgencia: 'Ana', equipoPersona: 'Secadora 2', area: 'SECADO', fecha: '2026-10-10' });
        expect(p.criterios).toHaveLength(25);
        const s = await a5s.detail(idSiNo, u.aprobador);
        expect(s.criterios).toHaveLength(50);
        expect(s.criterios[0].favorable).toBe('NO');
      });

      it('se puntúan y guardan por separado; cambiar los datos de la visita los comparte', async () => {
        // 25 criterios: 3 en 2 y 22 en 4 → 94 puntos
        const respP = PUNTOS.criterios.map((c) => ({ criterio: c.numero, puntaje: c.numero <= 3 ? 2 : 4 }));
        const p = await a5s.update({ id: idPuntos, agenciaId: ag.A.id, area: 'SECADO', responsableAgencia: 'Beatriz', comentariosCategoria: { SEIRI: 'Retirar cajas', INVALIDA: 'no' }, respuestas: respP }, u.aprobador);
        expect(p.comentariosCategoria).toEqual({ SEIRI: 'Retirar cajas' });
        expect(p.resultado.puntaje).toBe(94);
        expect(p.resultado.puntajeMaximo).toBe(100);
        expect(p.resultado.semaforo).toBe('VERDE');
        // La otra auditoría de la visita no se tocó, pero sí heredó el dato de la visita.
        const lista = await a5s.detail(g.id, u.aprobador);
        expect(lista.formato).toBe('LISTA_20');
        expect(lista.resultado.evaluados).toBe(0);
        expect(lista.responsableAgencia).toBe('Beatriz');
        // SI/NO: la respuesta favorable depende de la pregunta. Solo la 1 incumple (responde SI a «¿Hay cosas inútiles?»).
        const respS = SINO.criterios.map((c) => ({
          criterio: c.numero,
          puntaje: c.numero === 1 ? (c.favorable === 'NO' ? 1 : 0) : c.favorable === 'SI' ? 1 : 0,
          ...(c.numero === 1 ? { hallazgo: 'Hay cajas viejas', accionCorrectiva: 'Retirarlas' } : {}),
        }));
        const s = await a5s.update({ id: idSiNo, agenciaId: ag.A.id, area: 'SECADO', respuestas: respS }, u.aprobador);
        expect(s.resultado).toMatchObject({ puntaje: 49, puntajeMaximo: 50, porcentaje: 98, semaforo: 'VERDE', total: 50 });
        expect(s.resultado.porCategoria[0]).toMatchObject({ puntaje: 9, noConformes: 1 });
        await expect(a5s.update({ id: idSiNo, agenciaId: ag.A.id, area: 'SECADO', respuestas: [{ criterio: 2, puntaje: 3 }] }, u.aprobador)).rejects.toThrow(/SI o NO/);
        const fin = await a5s.guardar(idSiNo, u.aprobador);
        expect(fin.estado).toBe('GUARDADA');
        expect(fin.acciones).toHaveLength(1);
        expect(fin.acciones[0]).toMatchObject({ criterio: 1, prioridad: 'ALTA' });
        // Guardar una no guarda las demás.
        expect((await a5s.detail(idPuntos, u.aprobador)).estado).toBe('BORRADOR');
        expect((await a5s.detail(g.id, u.aprobador)).estado).toBe('BORRADOR');
      });

      it('la lista y el resumen se pueden filtrar por formato', async () => {
        const solo = await a5s.list({ pageSize: 50, formato: 'SI_NO_50' } as never, u.supervisor);
        expect(solo.items.every((i: any) => i.formato === 'SI_NO_50')).toBe(true);
        expect(solo.items.map((i: any) => i.id)).toContain(idSiNo);
        const r = await a5s.resumen({ formato: 'SI_NO_50' } as never, u.supervisor);
        expect(r.porS).toHaveLength(5);
        expect(r.porS[0].porcentaje).toBeGreaterThan(0);
      });
    });

    it('un borrador se elimina solo con permiso; el resumen cuenta lo que cada usuario ve', async () => {
      const b = await a5s.create({ agenciaId: ag.A.id, area: 'ASPIRADO' }, u.aprobador);
      rastrearAuditoria(b.id);
      await expect(a5s.eliminar(b.id, u.aprobador)).rejects.toThrow();
      expect((await a5s.eliminar(b.id, u.supervisor)).success).toBe(true);
      const r = await a5s.resumen({} as never, u.lavador);
      expect(r.realizadas).toBeGreaterThanOrEqual(3);
      expect(r.agenciasVerde + r.agenciasAmarillo + r.agenciasRojo).toBe(1);
      expect(r.porS).toHaveLength(5);
    });
  });
});
