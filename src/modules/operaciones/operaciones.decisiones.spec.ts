import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OperacionesService } from './operaciones.service.js';
import { DecisionesService } from '../../common/permisos/decisiones.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks): aprobar, rechazar, anular y editar servicios de lavado.
 *
 * Mundo de la prueba, todo creado aquí:
 *  Región R1 ── Agencia A1 (CON aprobador: Paula) · Agencia A2 (SIN aprobador)
 *  Región R2 ── Agencia A3
 *  Líder de A1 y de A3 · supervisores de R1 y R2 · Admin · Super Admin · y un usuario de cada rol que no decide.
 * Cada prueba crea sus propios servicios (uno nuevo por caso), para que no dependan entre sí.
 */
describe('OperacionesService: decisiones sobre servicios (base real)', () => {
  let env: Entorno;
  let service: OperacionesService;
  let r1: any;
  let a1: any;
  let a2: any;
  let a3: any;
  let b1: any;
  let b2: any;
  let b3: any;
  let catalogo: any;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  /** Un servicio nuevo de lavado en la agencia indicada ('a1' tiene aprobador, 'a2' no). */
  const nuevo = async (donde: 'a1' | 'a2' | 'a3', estado: any = 'FINALIZADO', extra: Record<string, unknown> = {}) => {
    const bahia = { a1: b1, a2: b2, a3: b3 }[donde];
    const operador = { a1: ids.lav1, a2: ids.lav2, a3: ids.lav3 }[donde];
    return (await env.servicioLavado({ bahiaId: bahia.id, operadorId: operador, catalogoId: catalogo.id, estado, ...extra })).id;
  };
  const enBase = (id: string) => env.prisma.servicioLavado.findUniqueOrThrow({ where: { id } });
  const auditoria = (servicioId: string) =>
    env.prisma.auditoriaDecision.findMany({ where: { entidad: 'SERVICIO_LAVADO', entidadId: servicioId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new OperacionesService(env.prisma as never, undefined, new DecisionesService(env.prisma as never));

    r1 = await env.region('R1');
    const r2 = await env.region('R2');
    a1 = await env.agencia('A1', { regionId: r1.id });
    a2 = await env.agencia('A2', { regionId: r1.id });
    a3 = await env.agencia('A3', { regionId: r2.id });
    b1 = await env.bahia('B1', a1.id);
    b2 = await env.bahia('B2', a2.id);
    b3 = await env.bahia('B3', a3.id);
    catalogo = await env.catalogo('LAVADO');

    const crear = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      const u = await env.usuario(clave, rol, opts);
      ids[clave] = u.id;
      actores[clave] = await env.actor(u.id);
    };
    await crear('aprobador', 'APROBADOR', { agenciaId: a1.id });
    await crear('liderA1', 'LIDER', { agenciaId: a1.id });
    await crear('liderA3', 'LIDER', { agenciaId: a3.id });
    await crear('supervisorR1', 'SUPERVISOR', { regionId: r1.id });
    await crear('supervisorR2', 'SUPERVISOR', { regionId: r2.id });
    await crear('admin', 'ADMIN');
    await crear('superAdmin', 'SUPER_ADMIN');
    await crear('lav1', 'LAVADOR', { agenciaId: a1.id });
    await crear('lav2', 'LAVADOR', { agenciaId: a2.id });
    await crear('lav3', 'LAVADOR', { agenciaId: a3.id });
    for (const rol of ['COORD_SERVICIOS_ESPECIALES', 'COORD_BODEGA', 'JEFE_COMERCIAL', 'PULIDOR']) await crear(rol, rol, { agenciaId: a1.id });
  });

  afterAll(async () => {
    await env.cerrar();
  });

  describe('aprobar y rechazar — quién decide', () => {
    it('el aprobador de la agencia aprueba como TITULAR y queda registrado con su id y la regla', async () => {
      const id = await nuevo('a1');
      await service.aprobarServicio(id, 'ok', actores.aprobador);

      expect(await enBase(id)).toMatchObject({ estado: 'APROBADO', decididoPorId: ids.aprobador, reglaDecision: 'TITULAR', aprobadoPor: `${env.marca}aprobador Prueba` });
      const [registro] = await auditoria(id);
      expect(registro).toMatchObject({ accion: 'APROBAR', usuarioId: ids.aprobador, regla: 'TITULAR', agenciaId: a1.id });
    });

    it('un aprobador no puede decidir sobre otra agencia', async () => {
      const id = await nuevo('a3'); // la agencia A3 tiene su propia gestión; Paula es de A1
      await expect(service.aprobarServicio(id, undefined, actores.aprobador)).rejects.toThrow(/tu agencia/);
      expect((await enBase(id)).estado).toBe('FINALIZADO');
    });

    it('si la agencia tiene aprobador, ni ADMIN, ni SUPER_ADMIN ni SUPERVISOR pueden aprobar', async () => {
      for (const clave of ['admin', 'superAdmin', 'supervisorR1']) {
        const id = await nuevo('a1');
        await expect(service.aprobarServicio(id, undefined, actores[clave])).rejects.toThrow(/aprobador designado/);
        expect((await enBase(id)).estado).toBe('FINALIZADO');
      }
    });

    it('si la agencia NO tiene aprobador, ADMIN, SUPER_ADMIN y el SUPERVISOR de su región aprueban como RESPALDO', async () => {
      for (const clave of ['admin', 'superAdmin', 'supervisorR1']) {
        const id = await nuevo('a2');
        await service.aprobarServicio(id, undefined, actores[clave]);
        expect((await enBase(id)).reglaDecision).toBe('RESPALDO');
        expect((await auditoria(id))[0].regla).toBe('RESPALDO');
      }
    });

    it('un supervisor de otra región no aprueba, aunque la agencia no tenga aprobador', async () => {
      const id = await nuevo('a2');
      await expect(service.aprobarServicio(id, undefined, actores.supervisorR2)).rejects.toThrow(/tu región/);
    });

    it('ningún otro rol aprueba ni rechaza (líder, coordinadores, bodega…)', async () => {
      for (const clave of ['liderA1', 'COORD_SERVICIOS_ESPECIALES', 'COORD_BODEGA', 'JEFE_COMERCIAL', 'lav1', 'PULIDOR']) {
        const id = await nuevo('a2');
        await expect(service.aprobarServicio(id, undefined, actores[clave])).rejects.toThrow(/no puede aprobar/);
        expect((await enBase(id)).estado).toBe('FINALIZADO');
      }
    });

    it('solo se aprueba lo finalizado y no anulado', async () => {
      await expect(service.aprobarServicio(await nuevo('a2', 'EN_PROCESO'), undefined, actores.admin)).rejects.toThrow(/finalizados/);
      await expect(service.aprobarServicio(await nuevo('a2', 'FINALIZADO', { deletedAt: new Date() }), undefined, actores.admin)).rejects.toThrow(/anulado/);
    });

    it('rechazar exige motivo, usa la misma regla y lo deja registrado', async () => {
      const id = await nuevo('a1');
      await expect(service.rechazarServicio(id, ' no ', actores.aprobador)).rejects.toThrow(/motivo es obligatorio/);
      await service.rechazarServicio(id, 'Falta foto de salida', actores.aprobador);
      expect(await enBase(id)).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'Falta foto de salida', decididoPorId: ids.aprobador });
      expect((await auditoria(id))[0]).toMatchObject({ accion: 'RECHAZAR', motivo: 'Falta foto de salida', regla: 'TITULAR' });
    });
  });

  describe('aprobar todos', () => {
    it('exige indicar la agencia: nunca aprueba todo el país', async () => {
      const id = await nuevo('a2');
      await expect(service.aprobarTodosServicios(actores.admin, undefined)).rejects.toThrow(/Indica la agencia/);
      expect((await enBase(id)).estado).toBe('FINALIZADO');
    });

    it('solo toca la agencia indicada, registra a quien decidió, deja un registro por servicio y omite los que no tienen foto de salida', async () => {
      // Una agencia propia (con su aprobador) para que el conteo no dependa de los servicios de otras pruebas.
      const region = await env.region('MASIVA');
      const agencia = await env.agencia('MASIVA', { regionId: region.id });
      const bahia = await env.bahia('MASIVA', agencia.id);
      const aprobador = await env.usuario('aprobador-masiva', 'APROBADOR', { agenciaId: agencia.id });
      const lavador = await env.usuario('lav-masiva', 'LAVADOR', { agenciaId: agencia.id });
      const conFoto = () =>
        env.servicioLavado({ bahiaId: bahia.id, operadorId: lavador.id, catalogoId: catalogo.id, estado: 'FINALIZADO', datos: { fotoSalidaUrl: 'salida.jpg' } });
      const mios = [(await conFoto()).id, (await conFoto()).id];
      const sinFoto = (await env.servicioLavado({ bahiaId: bahia.id, operadorId: lavador.id, catalogoId: catalogo.id, estado: 'FINALIZADO' })).id;
      const deOtraAgencia = await nuevo('a1'); // no debe tocarse

      const r: any = await service.aprobarTodosServicios(await env.actor(aprobador.id), agencia.id);

      expect(r).toMatchObject({ aprobadosCount: 2, omitidosSinFotoCount: 1 });
      expect((await enBase(sinFoto)).estado).toBe('FINALIZADO'); // sin foto de salida no se aprueba en bloque
      for (const id of mios) {
        expect(await enBase(id)).toMatchObject({ estado: 'APROBADO', decididoPorId: aprobador.id, reglaDecision: 'TITULAR' });
        expect(await auditoria(id)).toHaveLength(1); // un registro por servicio
      }
      expect((await enBase(deOtraAgencia)).estado).toBe('FINALIZADO');
    });

    it('un aprobador no cierra otra agencia y un administrador no cierra una que tiene aprobador', async () => {
      await expect(service.aprobarTodosServicios(actores.aprobador, a3.id)).rejects.toThrow(/tu agencia/);
      await expect(service.aprobarTodosServicios(actores.admin, a1.id)).rejects.toThrow(/aprobador designado/);
    });
  });

  describe('anular', () => {
    it('exige motivo y guarda quién, cuándo y por qué', async () => {
      const id = await nuevo('a1', 'EN_PROCESO');
      await expect(service.softDelete(id, '', true, actores.liderA1)).rejects.toThrow(/motivo es obligatorio/);
      await service.softDelete(id, 'Vehículo equivocado', true, actores.liderA1);

      const fila = await enBase(id);
      expect(fila).toMatchObject({ estado: 'CANCELADO', anuladoPorId: ids.liderA1, motivoAnulacion: 'Vehículo equivocado' });
      expect(fila.anuladoEn).toBeInstanceOf(Date);
      expect(fila.deletedAt).not.toBeNull();
      expect((await auditoria(id))[0]).toMatchObject({ accion: 'ANULAR', motivo: 'Vehículo equivocado', agenciaId: a1.id });
    });

    it('antes de aprobar anulan el líder y el aprobador de su agencia; no el de otra agencia ni el supervisor', async () => {
      for (const clave of ['liderA1', 'aprobador']) {
        const id = await nuevo('a1');
        await service.softDelete(id, 'Duplicado', true, actores[clave]);
        expect((await enBase(id)).estado).toBe('CANCELADO');
      }
      const id = await nuevo('a1');
      await expect(service.softDelete(id, 'Duplicado', true, actores.liderA3)).rejects.toThrow(/alcance/);
      await expect(service.softDelete(id, 'Duplicado', true, actores.supervisorR1)).rejects.toThrow(/no puede anular/);
      expect((await enBase(id)).estado).toBe('FINALIZADO');
    });

    it('un servicio aprobado solo lo anula un administrador', async () => {
      const id = await nuevo('a1', 'APROBADO');
      await expect(service.softDelete(id, 'Error', true, actores.liderA1)).rejects.toThrow(/solo lo puede anular un administrador/);
      await expect(service.softDelete(id, 'Error', true, actores.aprobador)).rejects.toThrow(/solo lo puede anular un administrador/);
      await service.softDelete(id, 'Error de digitación', true, actores.admin);
      expect((await auditoria(id))[0]).toMatchObject({ accion: 'ANULAR', regla: 'ADMIN' });
    });

    it('un servicio ya anulado no se vuelve a anular', async () => {
      const id = await nuevo('a1', 'CANCELADO', { deletedAt: new Date() });
      await expect(service.softDelete(id, 'Otra vez', true, actores.admin)).rejects.toThrow(/ya está anulado/);
    });
  });

  describe('editar servicios', () => {
    it('un servicio aprobado solo lo edita un administrador, con motivo, y queda registrado', async () => {
      const id = await nuevo('a1', 'APROBADO');
      await expect(service.update(id, { id, observaciones: 'x' } as any, false, actores.liderA1)).rejects.toThrow(/solo lo puede editar un administrador/);
      await expect(service.update(id, { id, observaciones: 'x' } as any, false, actores.admin)).rejects.toThrow(/motivo es obligatorio/);
      await service.update(id, { id, observaciones: 'Corregido', motivoCorreccion: 'Placa mal digitada' } as any, false, actores.admin);

      expect((await enBase(id)).observaciones).toBe('Corregido');
      expect((await auditoria(id))[0]).toMatchObject({ accion: 'EDITAR_APROBADO', motivo: 'Placa mal digitada' });
    });

    it('por editar no se puede aprobar, rechazar ni anular: tienen sus propias acciones', async () => {
      for (const estado of ['APROBADO', 'RECHAZADO', 'CANCELADO']) {
        const id = await nuevo('a1', 'FINALIZADO');
        await expect(service.update(id, { id, estado } as any, false, actores.admin)).rejects.toThrow(/acción correspondiente/);
        expect((await enBase(id)).estado).toBe('FINALIZADO');
      }
    });

    it('el líder solo edita servicios de su agencia', async () => {
      const id = await nuevo('a1', 'EN_PROCESO');
      await expect(service.update(id, { id, observaciones: 'x' } as any, false, actores.liderA3)).rejects.toThrow(/alcance/);
    });

    it('al finalizar ya no se aprueba solo, aunque la agencia no tenga aprobador', async () => {
      const id = await nuevo('a2', 'EN_PROCESO');
      await service.update(id, { id, estado: 'FINALIZADO', fotoSalidaUrl: 'evidencia.jpg' } as any, false, await env.actor((await env.usuario('lider-a2', 'LIDER', { agenciaId: a2.id })).id));
      const fila = await enBase(id);
      expect(fila.estado).toBe('FINALIZADO');
      expect(fila.aprobadoPor).toBeNull();
    });

    it('no se puede finalizar sin evidencia de salida (foto o vídeo), llamando directo al endpoint', async () => {
      const id = await nuevo('a1', 'EN_PROCESO');
      await expect(service.update(id, { id, estado: 'FINALIZADO' } as any, false, actores.liderA1)).rejects.toThrow(/evidencia de salida/);
      expect((await enBase(id)).estado).toBe('EN_PROCESO');
    });

    it('la evidencia ya guardada en el servicio alcanza (no hace falta reenviarla al finalizar)', async () => {
      const id = await nuevo('a1', 'EN_PROCESO', { datos: { fotoSalidaUrl: 'ya-subida.jpg' } });
      await service.update(id, { id, estado: 'FINALIZADO' } as any, false, actores.liderA1);
      expect((await enBase(id)).estado).toBe('FINALIZADO');
    });

    it('el offline sync puede finalizar sin evidencia en el payload (su propio flujo la maneja aparte)', async () => {
      const id = await nuevo('a1', 'EN_PROCESO');
      await service.update(id, { id, estado: 'FINALIZADO' } as any, true, actores.liderA1);
      expect((await enBase(id)).estado).toBe('FINALIZADO');
    });

    it('un servicio ya FINALIZADO no vuelve a exigir evidencia (no es la primera transición)', async () => {
      const id = await nuevo('a1', 'FINALIZADO', { datos: { fotoSalidaUrl: 'ya-subida.jpg' } });
      await service.update(id, { id, estado: 'FINALIZADO', observaciones: 'retoque' } as any, false, actores.admin);
      expect((await enBase(id)).observaciones).toBe('retoque');
    });
  });

  describe('ver un servicio', () => {
    it('el detalle exige que el servicio esté en el alcance del usuario', async () => {
      const id = await nuevo('a1');
      await expect(service.findOne(id, actores.liderA3)).rejects.toThrow(/alcance/);
      await expect(service.findOne(id, actores.supervisorR2)).rejects.toThrow(/alcance/);
      await expect(service.findOne(id, actores.aprobador)).resolves.toBeDefined();
      await expect(service.findOne(id, actores.supervisorR1)).resolves.toBeDefined();
      await expect(service.findOne(id, actores.admin)).resolves.toBeDefined();
    });
  });

  describe('listado: qué puede decidir cada usuario', () => {
    let conAprobador: string;
    let sinAprobador: string;
    const lista = async (actor: any) => {
      const r: any = await service.findAll({ bahiaId: `${b1.id},${b2.id}`, estado: 'FINALIZADO', incluirResumen: false } as any, actor);
      return Object.fromEntries(r.items.map((i: any) => [i.id, i]));
    };

    beforeAll(async () => {
      // Servicios propios de esta sección (separados de los de las demás pruebas por su placa).
      conAprobador = await nuevo('a1', 'FINALIZADO', { placa: `LISTA-${env.marca}-1` });
      sinAprobador = await nuevo('a2', 'FINALIZADO', { placa: `LISTA-${env.marca}-2` });
    });

    it('con aprobador: solo él puede decidir; el administrador y el supervisor no', async () => {
      expect((await lista(actores.aprobador))[conAprobador]).toMatchObject({ puedeDecidir: true, agenciaSinAprobador: false });
      expect((await lista(actores.admin))[conAprobador]).toMatchObject({ puedeDecidir: false, agenciaSinAprobador: false });
      expect((await lista(actores.supervisorR1))[conAprobador].puedeDecidir).toBe(false);
    });

    it('sin aprobador: puede decidir el administrador y el supervisor de la región (no el de otra)', async () => {
      expect((await lista(actores.admin))[sinAprobador]).toMatchObject({ puedeDecidir: true, agenciaSinAprobador: true });
      expect((await lista(actores.supervisorR1))[sinAprobador].puedeDecidir).toBe(true);
      // El supervisor de otra región ni siquiera recibe el servicio: el filtro por región lo excluye.
      expect((await lista(actores.supervisorR2))[sinAprobador]).toBeUndefined();
    });
  });

  describe('historial de decisiones', () => {
    it('devuelve el registro de un servicio dentro del alcance y lo niega fuera de él', async () => {
      const id = await nuevo('a1');
      await service.aprobarServicio(id, undefined, actores.aprobador);
      const r: any[] = await service.historialDecisiones(id, actores.aprobador);
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ accion: 'APROBAR', regla: 'TITULAR' });
      await expect(service.historialDecisiones(id, actores.liderA3)).rejects.toThrow(/alcance/);
    });
  });
});
