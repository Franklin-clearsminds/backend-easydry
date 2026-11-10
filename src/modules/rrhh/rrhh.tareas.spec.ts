import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { TareasService } from './tareas.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: tareas del personal. El almacenamiento es un doble (la prueba no sube nada al bucket) que aplica la
 * misma regla de carpeta que el real: los adjuntos deben estar en `rrhh/tareas/<usuario>/`.
 */
let archivos = 0;

describe('TareasService (base real)', () => {
  let env: Entorno;
  let service: TareasService;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};
  let agencia: { id: string };
  let otraAgencia: { id: string };
  const storage = {
    inspectEvidence: vi.fn(async (url: string, opts?: { prefix: string }) => {
      if (opts && !url.startsWith(opts.prefix)) throw new BadRequestException('La evidencia no pertenece a la carpeta de esta máquina.');
      if (url.includes('grande')) return { key: url, kind: 'IMAGEN', mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 };
      return { key: url, kind: url.endsWith('.mp4') ? 'VIDEO' : 'IMAGEN', mimeType: 'image/jpeg', sizeBytes: 1000 };
    }),
  };

  const adjunto = (clave: string, ext = 'jpg') => ({ url: `rrhh/tareas/${ids[clave]}/archivo-${++archivos}.${ext}`, nombre: `archivo.${ext}` });
  const crear = (quien: string, para: string, extra: Record<string, unknown> = {}) =>
    service.crear({ titulo: 'Limpiar el área', descripcion: 'Detalle', asignadoAId: ids[para], ...extra } as never, actores[quien]);
  const completar = (id: string, quien = 'lavador', extra: Record<string, unknown> = {}) =>
    service.completar({ id, respuesta: 'Hecho', adjuntos: [adjunto(quien)], ...extra } as never, actores[quien]);
  const avisos = (tipo: string, tareaId: string) => env.prisma.notification.findMany({ where: { tipo: tipo as never, entidadId: tareaId } });

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new TareasService(env.prisma as never, storage as never, env.notificaciones());

    const region = await env.region('TAR');
    const otraRegion = await env.region('TAR2');
    agencia = await env.agencia('tar-a', { regionId: region.id });
    otraAgencia = await env.agencia('tar-b', { regionId: region.id });
    const lejana = await env.agencia('tar-c', { regionId: otraRegion.id });

    const nuevo = async (clave: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[clave] = (await env.usuario(clave, rol, opts)).id;
    };
    await nuevo('lavador', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('lavador2', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('lavadorVecino', 'LAVADOR', { agenciaId: otraAgencia.id, regionId: region.id });
    await nuevo('lavadorLejano', 'LAVADOR', { agenciaId: lejana.id, regionId: otraRegion.id });
    await nuevo('lavadorInactivo', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id, estado: 0 });
    await nuevo('lider', 'LIDER', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('liderVecino', 'LIDER', { agenciaId: otraAgencia.id, regionId: region.id });
    await nuevo('supervisor', 'SUPERVISOR', { regionId: region.id });
    await nuevo('supervisorLejano', 'SUPERVISOR', { regionId: otraRegion.id });
    await nuevo('admin', 'ADMIN');
    await nuevo('superAdmin', 'SUPER_ADMIN');
    for (const clave of Object.keys(ids)) actores[clave] = await env.actor(ids[clave]);
  });

  afterAll(async () => {
    await env.prisma.tareaRrhh.deleteMany({ where: { OR: [{ asignadoAId: { in: Object.values(ids) } }, { asignadoPorId: { in: Object.values(ids) } }] } });
    await env.cerrar();
  });

  describe('asignar', () => {
    it('el líder asigna a alguien de su agencia: queda Pendiente, con historial y aviso al responsable', async () => {
      const t = await crear('lider', 'lavador', { fechaLimite: '2031-06-01T12:00:00Z', adjuntos: [adjunto('lider')] });
      expect(t).toMatchObject({ estado: 'PENDIENTE', titulo: 'Limpiar el área', vencida: false, asignadoA: { id: ids.lavador }, asignadoPor: { id: ids.lider } });
      expect(t.numero).toMatch(/^TAR-\d{4}$/);
      expect(t.adjuntos).toHaveLength(1);
      expect(t.adjuntos[0].etapa).toBe('ASIGNACION');
      expect(t.historial.map((h) => h.accion)).toEqual(['ASIGNADA']);
      const aviso = await env.esperar(async () => (await avisos('TAREA_ASIGNADA', t.id))[0]);
      expect(aviso.userId).toBe(ids.lavador);
    });

    it('toda tarea necesita un responsable existente', async () => {
      await expect(service.crear({ titulo: 'Sin dueño' } as never, actores.lider)).rejects.toThrow();
      await expect(service.crear({ titulo: 'x', asignadoAId: '00000000-0000-4000-8000-000000000000' } as never, actores.lider)).rejects.toThrow(/no existe o está inactiva/);
    });

    it('el título no puede estar vacío', async () => {
      await expect(crear('lider', 'lavador', { titulo: '   ' })).rejects.toThrow('El título es obligatorio.');
    });

    it('la fecha límite debe ser válida', async () => {
      await expect(crear('lider', 'lavador', { fechaLimite: 'mañana' })).rejects.toThrow('La fecha límite no es válida.');
    });

    it('nadie se asigna una tarea a sí mismo', async () => {
      await expect(crear('lider', 'lider')).rejects.toThrow('No puedes asignarte una tarea a ti mismo.');
    });

    it('no se asigna a alguien inactivo ni a un administrador', async () => {
      await expect(crear('supervisor', 'lavadorInactivo')).rejects.toThrow(/inactiva/);
      await expect(crear('superAdmin', 'admin')).rejects.toThrow('Esa persona no recibe tareas de RRHH.');
    });

    it('cada quien asigna solo dentro de su alcance', async () => {
      await expect(crear('lider', 'lavadorVecino')).rejects.toThrow('Esa persona está fuera de tu alcance.'); // otra agencia
      await expect(crear('supervisor', 'lavadorLejano')).rejects.toThrow('Esa persona está fuera de tu alcance.'); // otra región
      expect((await crear('supervisor', 'lavadorVecino')).estado).toBe('PENDIENTE'); // su región
      expect((await crear('admin', 'lavadorLejano')).estado).toBe('PENDIENTE'); // todo el país
    });

    it('los adjuntos: máximo 5, 10 MB cada uno y de la carpeta de quien asigna', async () => {
      await expect(crear('lider', 'lavador', { adjuntos: Array.from({ length: 6 }, () => adjunto('lider')) })).rejects.toThrow(/Máximo 5/);
      await expect(crear('lider', 'lavador', { adjuntos: [{ url: `rrhh/tareas/${ids.lider}/grande.jpg`, nombre: 'grande.jpg' }] })).rejects.toThrow(/pesa más de 10 MB/);
      await expect(crear('lider', 'lavador', { adjuntos: [adjunto('lavador')] })).rejects.toThrow();
    });

    it('asignables: personas activas de mi alcance que reciben tareas, sin mí ni administradores', async () => {
      const delLider = (await service.asignables(actores.lider)).map((p) => p.id);
      expect(delLider).toEqual(expect.arrayContaining([ids.lavador, ids.lavador2]));
      expect(delLider).not.toContain(ids.lider);
      expect(delLider).not.toContain(ids.lavadorInactivo);
      expect(delLider).not.toContain(ids.lavadorVecino);
      const delSupervisor = (await service.asignables(actores.supervisor)).map((p) => p.id);
      expect(delSupervisor).toEqual(expect.arrayContaining([ids.lavador, ids.lavadorVecino, ids.lider]));
      expect(delSupervisor).not.toContain(ids.lavadorLejano);
      const delAdmin = (await service.asignables(actores.admin)).map((p) => p.id);
      expect(delAdmin).toContain(ids.lavadorLejano);
      expect(delAdmin).not.toContain(ids.admin);
      expect(delAdmin).not.toContain(ids.superAdmin);
    });
  });

  describe('completar', () => {
    it('solo el responsable, con respuesta y al menos una evidencia', async () => {
      const t = await crear('lider', 'lavador');
      await expect(completar(t.id, 'lavador2')).rejects.toThrow('Solo el responsable puede completar la tarea.');
      await expect(completar(t.id, 'lavador', { adjuntos: [] })).rejects.toThrow('Adjunta al menos una evidencia.');
      await expect(completar(t.id, 'lavador', { respuesta: '  ' })).rejects.toThrow('Escribe una respuesta.');
      const hecha = await completar(t.id);
      expect(hecha).toMatchObject({ estado: 'COMPLETADA', respuesta: 'Hecho' });
      expect(hecha.completadaEn).toBeTruthy();
      expect(hecha.adjuntos.filter((a) => a.etapa === 'RESPUESTA')).toHaveLength(1);
      const aviso = await env.esperar(async () => (await avisos('TAREA_COMPLETADA', t.id))[0]);
      expect(aviso.userId).toBe(ids.lider); // le llega a quien asignó
    });

    it('no se completa dos veces', async () => {
      const t = await crear('lider', 'lavador');
      await completar(t.id);
      await expect(completar(t.id)).rejects.toThrow('Solo se puede completar una tarea Pendiente.');
    });
  });

  describe('revisar', () => {
    it('quien asignó aprueba: queda Revisada y se avisa al responsable', async () => {
      const t = await crear('lider', 'lavador');
      await completar(t.id);
      const r = await service.revisar({ id: t.id, accion: 'APROBAR' }, actores.lider);
      expect(r.estado).toBe('REVISADA');
      expect(r.revisadaEn).toBeTruthy();
      expect(r.historial.map((h) => h.accion)).toEqual(['ASIGNADA', 'COMPLETADA', 'REVISADA']);
      const aviso = await env.esperar(async () => (await avisos('TAREA_REVISADA', t.id))[0]);
      expect(aviso.userId).toBe(ids.lavador);
    });

    it('un administrador también revisa cualquier tarea', async () => {
      const t = await crear('lider', 'lavador');
      await completar(t.id);
      expect((await service.revisar({ id: t.id, accion: 'APROBAR' }, actores.superAdmin)).estado).toBe('REVISADA');
      const otra = await crear('lider', 'lavador');
      await completar(otra.id);
      expect((await service.revisar({ id: otra.id, accion: 'APROBAR' }, actores.admin)).estado).toBe('REVISADA');
    });

    it('otro con permiso de asignar, que no asignó la tarea, no la revisa', async () => {
      const t = await crear('lider', 'lavador');
      await completar(t.id);
      await expect(service.revisar({ id: t.id, accion: 'APROBAR' }, actores.supervisor)).rejects.toThrow(/Solo quien asignó/);
      await expect(service.revisar({ id: t.id, accion: 'APROBAR' }, actores.liderVecino)).rejects.toThrow(/Solo quien asignó/);
      await expect(service.revisar({ id: t.id, accion: 'APROBAR' }, actores.lavador)).rejects.toThrow(/Solo quien asignó/);
    });

    it('devolver exige el motivo, vuelve a Pendiente y permite completarla otra vez', async () => {
      const t = await crear('lider', 'lavador');
      await completar(t.id);
      await expect(service.revisar({ id: t.id, accion: 'DEVOLVER' }, actores.lider)).rejects.toThrow('Escribe el motivo de la devolución.');
      const d = await service.revisar({ id: t.id, accion: 'DEVOLVER', motivo: 'Falta la foto del fondo' }, actores.lider);
      expect(d.estado).toBe('PENDIENTE');
      expect(d.completadaEn).toBeNull();
      expect(d.historial.map((h) => h.accion)).toEqual(['ASIGNADA', 'COMPLETADA', 'DEVUELTA']);
      expect(d.historial[2].detalle).toBe('Falta la foto del fondo');
      const aviso = await env.esperar(async () => (await avisos('TAREA_DEVUELTA', t.id))[0]);
      expect(aviso.mensaje).toContain('Falta la foto del fondo');
      expect((await completar(t.id)).estado).toBe('COMPLETADA');
    });

    it('solo se revisa una tarea Completada', async () => {
      const t = await crear('lider', 'lavador');
      await expect(service.revisar({ id: t.id, accion: 'APROBAR' }, actores.lider)).rejects.toThrow('Solo se puede revisar una tarea Completada.');
    });
  });

  describe('cancelar y reasignar', () => {
    it('solo una Pendiente se cancela, por quien asignó o un administrador, y se avisa', async () => {
      const t = await crear('lider', 'lavador');
      await expect(service.cancelar({ id: t.id }, actores.supervisor)).rejects.toThrow(/Solo quien asignó/);
      const c = await service.cancelar({ id: t.id, motivo: 'Ya no hace falta' }, actores.lider);
      expect(c).toMatchObject({ estado: 'CANCELADA', motivoCancelacion: 'Ya no hace falta' });
      expect(c.canceladaEn).toBeTruthy();
      const aviso = await env.esperar(async () => (await avisos('TAREA_CANCELADA', t.id))[0]);
      expect(aviso.userId).toBe(ids.lavador);
      await expect(service.cancelar({ id: t.id }, actores.lider)).rejects.toThrow('Solo se puede cancelar una tarea Pendiente.');
      const completada = await crear('lider', 'lavador');
      await completar(completada.id);
      await expect(service.cancelar({ id: completada.id }, actores.lider)).rejects.toThrow('Solo se puede cancelar una tarea Pendiente.');
      const otra = await crear('lider', 'lavador');
      expect((await service.cancelar({ id: otra.id }, actores.admin)).estado).toBe('CANCELADA');
    });

    it('reasignar pasa la tarea a otra persona de mi alcance, deja historial y avisa a ambos', async () => {
      const t = await crear('lider', 'lavador');
      const r = await service.reasignar({ id: t.id, asignadoAId: ids.lavador2 }, actores.lider);
      expect(r.asignadoA.id).toBe(ids.lavador2);
      expect(r.estado).toBe('PENDIENTE');
      expect(r.historial.at(-1)?.accion).toBe('REASIGNADA');
      const avisosR = await env.esperar(async () => {
        const l = await avisos('TAREA_REASIGNADA', t.id);
        return l.length >= 2 ? l : null;
      });
      expect(avisosR.map((a) => a.userId).sort()).toEqual([ids.lavador, ids.lavador2].sort());
    });

    it('reasignar respeta el alcance, la misma persona y el estado', async () => {
      const t = await crear('lider', 'lavador');
      await expect(service.reasignar({ id: t.id, asignadoAId: ids.lavadorVecino }, actores.lider)).rejects.toThrow('fuera de tu alcance');
      await expect(service.reasignar({ id: t.id, asignadoAId: ids.lavador }, actores.lider)).rejects.toThrow('ya está asignada');
      await expect(service.reasignar({ id: t.id, asignadoAId: ids.lavador2 }, actores.supervisor)).rejects.toThrow(/Solo quien asignó/);
      await completar(t.id);
      await expect(service.reasignar({ id: t.id, asignadoAId: ids.lavador2 }, actores.lider)).rejects.toThrow('Solo se puede reasignar una tarea Pendiente.');
    });

    it('si el responsable se desactiva, la tarea aparece en «sin responsable activo» para reasignarla', async () => {
      const temporal = await env.usuario('se-va', 'LAVADOR', { agenciaId: agencia.id });
      const t = await crear('lider', 'lavador');
      await service.reasignar({ id: t.id, asignadoAId: temporal.id }, actores.lider);
      expect((await service.sinResponsableActivo(actores.lider)).map((x) => x.id)).not.toContain(t.id);
      await env.prisma.user.update({ where: { id: temporal.id }, data: { estado: 0 } });
      const lista = await service.sinResponsableActivo(actores.lider);
      expect(lista.map((x) => x.id)).toContain(t.id);
      expect(lista.find((x) => x.id === t.id)?.asignadoA.activo).toBe(false);
      // no se reasignan solas: siguen con el mismo responsable hasta que alguien las mueva
      expect((await service.detalle(t.id, actores.lider)).asignadoA.id).toBe(temporal.id);
      await service.reasignar({ id: t.id, asignadoAId: ids.lavador }, actores.lider);
      expect((await service.sinResponsableActivo(actores.lider)).map((x) => x.id)).not.toContain(t.id);
    });
  });

  describe('quién ve qué', () => {
    it('mis tareas: solo las mías, filtrables por estado', async () => {
      const t = await crear('lider', 'lavador2');
      const mias = await service.mias({}, actores.lavador2);
      expect(mias.map((x) => x.id)).toContain(t.id);
      expect(mias.every((x) => x.asignadoA.id === ids.lavador2)).toBe(true);
      expect((await service.mias({ estado: 'REVISADA' }, actores.lavador2)).every((x) => x.estado === 'REVISADA')).toBe(true);
    });

    it('asignadas: las que asigné y las de mi alcance; el administrador, todas', async () => {
      const t = await crear('lider', 'lavador');
      const delVecino = await crear('liderVecino', 'lavadorVecino');
      const delLider = (await service.asignadas({}, actores.lider)).map((x) => x.id);
      expect(delLider).toContain(t.id);
      expect(delLider).not.toContain(delVecino.id);
      const delSupervisor = (await service.asignadas({}, actores.supervisor)).map((x) => x.id);
      expect(delSupervisor).toEqual(expect.arrayContaining([t.id, delVecino.id]));
      const delAdmin = (await service.asignadas({}, actores.admin)).map((x) => x.id);
      expect(delAdmin).toEqual(expect.arrayContaining([t.id, delVecino.id]));
      const lejano = (await service.asignadas({}, actores.supervisorLejano)).map((x) => x.id);
      expect(lejano).not.toContain(t.id);
    });

    it('detalle: el responsable, quien asignó, el administrador y quien asigna en su alcance; nadie más', async () => {
      const t = await crear('lider', 'lavador');
      for (const quien of ['lavador', 'lider', 'admin', 'superAdmin', 'supervisor']) {
        expect((await service.detalle(t.id, actores[quien])).id, quien).toBe(t.id);
      }
      for (const quien of ['lavador2', 'liderVecino', 'supervisorLejano', 'lavadorLejano']) {
        await expect(service.detalle(t.id, actores[quien]), quien).rejects.toThrow('No tienes acceso a esta tarea.');
      }
      await expect(service.detalle('00000000-0000-4000-8000-000000000000', actores.admin)).rejects.toThrow('La tarea no existe.');
    });
  });

  describe('vencidas', () => {
    it('una Pendiente con la fecha pasada se marca vencida y se avisa una sola vez a ambos', async () => {
      const t = await crear('lider', 'lavador', { fechaLimite: '2020-01-01T00:00:00Z' });
      expect(t.vencida).toBe(true);
      expect((await service.mias({ soloVencidas: true }, actores.lavador)).map((x) => x.id)).toContain(t.id);

      await service.avisarVencidas(new Date(), [t.id]);
      const lista = await env.esperar(async () => {
        const l = await avisos('TAREA_VENCIDA', t.id);
        return l.length >= 2 ? l : null;
      });
      expect(lista.map((a) => a.userId).sort()).toEqual([ids.lavador, ids.lider].sort());

      await service.avisarVencidas(new Date(), [t.id]);
      expect(await avisos('TAREA_VENCIDA', t.id)).toHaveLength(2);
    });

    it('una Completada o Cancelada con fecha pasada no es vencida ni se avisa', async () => {
      const t = await crear('lider', 'lavador', { fechaLimite: '2020-01-01T00:00:00Z' });
      await service.cancelar({ id: t.id }, actores.lider);
      await service.avisarVencidas(new Date(), [t.id]);
      expect(await avisos('TAREA_VENCIDA', t.id)).toHaveLength(0);
      expect((await service.detalle(t.id, actores.lider)).vencida).toBe(false);
    });
  });

  describe('tareas que nacen de un informe', () => {
    it('se crean desde la novedad, una sola vez, con su origen', async () => {
      const novedadId = `00000000-0000-4000-8000-${String(Date.now()).slice(-12).padStart(12, '0')}`;
      const datos = { informeId: '11111111-1111-4111-8111-111111111111', novedadId, titulo: 'Piso mojado', descripcion: 'Cerca de la bahía 2', asignadoAId: ids.lavador };
      const primera = await service.crearDesdeNovedad(datos, actores.lider);
      const repetida = await service.crearDesdeNovedad(datos, actores.lider);
      expect(repetida.id).toBe(primera.id);
      const t = await service.detalle(primera.id, actores.lider);
      expect(t).toMatchObject({ titulo: 'Piso mojado', descripcion: 'Cerca de la bahía 2', estado: 'PENDIENTE', asignadoPor: { id: ids.lider } });
      expect(t.origen?.informeId).toBe(datos.informeId);
      expect(t.historial[0].detalle).toBe('Desde un informe de inspección');
    });

    it('sin descripción se usa el título, y el responsable debe estar en el alcance de quien guarda el informe', async () => {
      const t = await service.crearDesdeNovedad({ informeId: '11111111-1111-4111-8111-111111111111', novedadId: '22222222-2222-4222-8222-222222222222', titulo: 'Solo título', descripcion: '', asignadoAId: ids.lavador }, actores.lider);
      expect((await service.detalle(t.id, actores.lider)).descripcion).toBe('Solo título');
      await expect(
        service.crearDesdeNovedad({ informeId: '11111111-1111-4111-8111-111111111111', novedadId: '33333333-3333-4333-8333-333333333333', titulo: 'x', descripcion: 'y', asignadoAId: ids.lavadorLejano }, actores.lider),
      ).rejects.toThrow('fuera de tu alcance');
    });

    it('avisa al responsable de cada tarea con el número del informe', async () => {
      const t = await service.crearDesdeNovedad({ informeId: '11111111-1111-4111-8111-111111111111', novedadId: '44444444-4444-4444-8444-444444444444', titulo: 'Aviso', descripcion: 'd', asignadoAId: ids.lavador2 }, actores.lider);
      await service.avisarTareasDeInforme([t.id], { id: '11111111-1111-4111-8111-111111111111', numero: 'INF-2031-0001' }, actores.lider);
      const aviso = await env.esperar(async () => (await avisos('TAREA_ASIGNADA', t.id))[0]);
      expect(aviso.mensaje).toContain('INF-2031-0001');
      expect(aviso.userId).toBe(ids.lavador2);
    });
  });
});
