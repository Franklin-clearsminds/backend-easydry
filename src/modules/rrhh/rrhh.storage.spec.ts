import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { exigirPermisoSubida } from '../storage/upload-permissions.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real: quién puede subir y quién puede abrir las fotos de timbrada y los adjuntos de las tareas.
 * Solo se consulta la base: no se llama a S3.
 */
describe('archivos de RRHH: subida y acceso (base real)', () => {
  let env: Entorno;
  const ids: Record<string, string> = {};
  const actores: Record<string, any> = {};

  const clave = (tipo: 'timbradas' | 'tareas', dueno: string, nombre = 'a.jpg') => `rrhh/${tipo}/${ids[dueno]}/${tipo === 'timbradas' ? '2031-03/' : ''}${nombre}`;
  const puede = (quien: string, key: string) => env.storage().puedeVerClaveRrhh(actores[quien], key);

  beforeAll(async () => {
    env = await abrirEntorno();
    const region = await env.region('sto');
    const otraRegion = await env.region('sto2');
    const agencia = await env.agencia('sto-a', { regionId: region.id });
    const vecina = await env.agencia('sto-b', { regionId: region.id });
    const lejana = await env.agencia('sto-c', { regionId: otraRegion.id });
    const nuevo = async (c: string, rol: string, opts: Record<string, unknown> = {}) => {
      ids[c] = (await env.usuario(c, rol, opts)).id;
      actores[c] = await env.actor(ids[c]);
    };
    await nuevo('lavador', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('lavador2', 'LAVADOR', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('lavadorVecino', 'LAVADOR', { agenciaId: vecina.id, regionId: region.id });
    await nuevo('lavadorLejano', 'LAVADOR', { agenciaId: lejana.id, regionId: otraRegion.id });
    await nuevo('lider', 'LIDER', { agenciaId: agencia.id, regionId: region.id });
    await nuevo('liderVecino', 'LIDER', { agenciaId: vecina.id, regionId: region.id });
    await nuevo('supervisor', 'SUPERVISOR', { regionId: region.id });
    await nuevo('supervisorLejano', 'SUPERVISOR', { regionId: otraRegion.id });
    await nuevo('admin', 'ADMIN');
  });

  afterAll(async () => {
    await env.prisma.tareaRrhh.deleteMany({ where: { asignadoPorId: { in: Object.values(ids) } } });
    await env.cerrar();
  });

  describe('subir', () => {
    it('la foto de timbrada la sube quien puede timbrar; un administrador no', () => {
      expect(() => exigirPermisoSubida(actores.lavador, { type: 'FOTO_TIMBRADA' })).not.toThrow();
      expect(() => exigirPermisoSubida(actores.supervisor, { type: 'FOTO_TIMBRADA' })).not.toThrow();
      expect(() => exigirPermisoSubida(actores.admin, { type: 'FOTO_TIMBRADA' })).toThrow(ForbiddenException);
    });

    it('los adjuntos de tarea los sube quien recibe o quien asigna tareas', () => {
      for (const tipo of ['FOTO_TAREA', 'VIDEO_TAREA', 'DOCUMENTO_TAREA'] as const) {
        expect(() => exigirPermisoSubida(actores.lavador, { type: tipo }), `lavador ${tipo}`).not.toThrow();
        expect(() => exigirPermisoSubida(actores.lider, { type: tipo }), `lider ${tipo}`).not.toThrow();
        expect(() => exigirPermisoSubida(actores.admin, { type: tipo }), `admin ${tipo}`).not.toThrow(); // asigna
      }
    });
  });

  describe('ver la foto de una timbrada', () => {
    it('su dueño siempre', async () => {
      expect(await puede('lavador', clave('timbradas', 'lavador'))).toBe(true);
    });

    it('otro compañero sin permiso de equipo, no', async () => {
      expect(await puede('lavador2', clave('timbradas', 'lavador'))).toBe(false);
    });

    it('quien ve las timbradas del equipo, solo de su alcance', async () => {
      expect(await puede('lider', clave('timbradas', 'lavador'))).toBe(true);
      expect(await puede('lider', clave('timbradas', 'lavadorVecino'))).toBe(false); // otra agencia
      expect(await puede('liderVecino', clave('timbradas', 'lavador'))).toBe(false);
      expect(await puede('supervisor', clave('timbradas', 'lavadorVecino'))).toBe(true); // su región
      expect(await puede('supervisor', clave('timbradas', 'lavadorLejano'))).toBe(false);
      expect(await puede('supervisorLejano', clave('timbradas', 'lavador'))).toBe(false);
    });

    it('el administrador ve todas', async () => {
      expect(await puede('admin', clave('timbradas', 'lavadorLejano'))).toBe(true);
    });

    it('las miniaturas siguen la misma regla', async () => {
      expect(await puede('lavador2', `thumbs/${clave('timbradas', 'lavador')}.jpg`)).toBe(false);
      expect(await puede('lavador', `thumbs/${clave('timbradas', 'lavador')}.jpg`)).toBe(true);
    });

    it('una clave que no es de RRHH no pasa por aquí', async () => {
      expect(await puede('admin', 'agencias/x/servicios/a.jpg')).toBe(false);
    });
  });

  describe('ver un adjunto de tarea', () => {
    let keyAsignacion: string;
    let keyRespuesta: string;

    beforeAll(async () => {
      keyAsignacion = clave('tareas', 'lider', 'consigna.jpg');
      keyRespuesta = clave('tareas', 'lavador', 'evidencia.jpg');
      await env.prisma.tareaRrhh.create({
        data: {
          titulo: 'Tarea con archivos',
          asignadoAId: ids.lavador,
          asignadoPorId: ids.lider,
          agenciaId: null,
          adjuntos: {
            create: [
              { etapa: 'ASIGNACION', key: keyAsignacion, nombre: 'consigna.jpg', mime: 'image/jpeg', tamanioBytes: 10, tipo: 'IMAGEN', subidoPorId: ids.lider },
              { etapa: 'RESPUESTA', key: keyRespuesta, nombre: 'evidencia.jpg', mime: 'image/jpeg', tamanioBytes: 10, tipo: 'IMAGEN', subidoPorId: ids.lavador },
            ],
          },
        },
      });
    });

    it('el responsable y quien asignó ven los dos archivos', async () => {
      for (const quien of ['lavador', 'lider']) {
        expect(await puede(quien, keyAsignacion), `${quien} consigna`).toBe(true);
        expect(await puede(quien, keyRespuesta), `${quien} evidencia`).toBe(true);
      }
    });

    it('un administrador y quien asigna dentro del alcance también', async () => {
      expect(await puede('admin', keyRespuesta)).toBe(true);
      expect(await puede('supervisor', keyRespuesta)).toBe(true);
    });

    it('un compañero, otro líder o alguien de otra región, no', async () => {
      expect(await puede('lavador2', keyRespuesta)).toBe(false);
      expect(await puede('liderVecino', keyRespuesta)).toBe(false);
      expect(await puede('supervisorLejano', keyRespuesta)).toBe(false);
      expect(await puede('lavadorLejano', keyAsignacion)).toBe(false);
    });

    it('un archivo que aún no está en ninguna tarea solo lo ve quien lo subió', async () => {
      const suelto = clave('tareas', 'lavador', 'sin-tarea.jpg');
      expect(await puede('lavador', suelto)).toBe(true);
      expect(await puede('lider', suelto)).toBe(false);
      expect(await puede('admin', suelto)).toBe(false);
    });
  });
});
