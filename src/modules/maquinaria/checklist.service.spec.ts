import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChecklistService } from './checklist.service.js';
import { abrirEntorno, type Entorno } from '../../../test/integracion/entorno.js';

/**
 * Integración con la base real (sin mocks).
 *
 * Las plantillas de checklist son globales (una activa por tipo), así que esta prueba las toma "prestadas": al empezar
 * guarda cuáles son las plantillas activas REALES y las desactiva; al terminar borra las suyas y reactiva las reales.
 * Ningún otro archivo de prueba lee plantillas de la base. Si el proceso se cortara a la mitad, bastaría reactivar la
 * plantilla de versión 1 de cada tipo (`activa = true`).
 *
 * Mundo: una máquina con dos órdenes de mantenimiento (M1 y M2) a cargo de un técnico, y la plantilla PREVENTIVA de
 * prueba (versión siguiente a la real) con dos pasos: uno obligatorio y uno opcional. CORRECTIVO queda sin plantilla.
 */
describe('ChecklistService (base real)', () => {
  let env: Entorno;
  let service: ChecklistService;
  let plantilla: any;
  let reales: string[];
  let tecnico: any;
  let admin: any;
  let coord: any;
  let m1: string;
  let m2: string;

  beforeAll(async () => {
    env = await abrirEntorno();
    service = new ChecklistService(env.prisma as never);

    const activas = await env.prisma.checklistPlantilla.findMany({ where: { activa: true }, select: { id: true } });
    reales = activas.map((a) => a.id);
    await env.prisma.checklistPlantilla.updateMany({ where: { id: { in: reales } }, data: { activa: false } });

    const ultima = await env.prisma.checklistPlantilla.findFirst({ where: { tipo: 'PREVENTIVO' }, orderBy: { version: 'desc' } });
    plantilla = await env.prisma.checklistPlantilla.create({
      data: {
        tipo: 'PREVENTIVO',
        nombre: `${env.marca} preventivo`,
        version: (ultima?.version ?? 0) + 1,
        pasos: {
          create: [
            { orden: 1, texto: 'Desconectar y bloquear el equipo', obligatorio: true },
            { orden: 2, texto: 'Anotar observaciones', obligatorio: false },
          ],
        },
      },
    });
    env.rastrear('ChecklistPlantilla', plantilla.id);

    const t = await env.usuario('tecnico', 'TECNICO');
    tecnico = await env.actor(t.id);
    admin = await env.actor((await env.usuario('admin', 'ADMIN')).id);
    coord = await env.actor((await env.usuario('coord', 'COORD_MANTENIMIENTO')).id);
    const maquina = await env.maquinaria('M1');
    const orden = async () =>
      (await env.prisma.mantenimientoMaquinaria.create({ data: { maquinariaId: maquina.id, tecnicoId: t.id, estado: 'PENDIENTE', fechaProgramada: new Date() } })).id;
    m1 = await orden();
    m2 = await orden();
  });

  afterAll(async () => {
    try {
      // Las plantillas de prueba se borran con el entorno; aquí se reactivan las reales.
      await env.cerrar();
    } finally {
      const prisma = new (await import('../prisma/prisma.service.js')).PrismaService();
      await prisma.checklistPlantilla.updateMany({ where: { id: { in: reales } }, data: { activa: true } });
      await prisma.$disconnect();
    }
  });

  describe('checklist de una orden', () => {
    it('la primera vez copia los pasos de la plantilla activa, con su versión, y las siguientes no repiten', async () => {
      const c = await service.obtenerDeMantenimiento(m1, 'PREVENTIVO');
      expect(c.pasos).toHaveLength(2);
      expect(c.pasos[0]).toMatchObject({ mantenimientoId: m1, plantillaVersion: plantilla.version, texto: 'Desconectar y bloquear el equipo', obligatorio: true });
      expect(c).toMatchObject({ requerido: true, obligatoriosPendientes: 1, completo: false });
      await service.obtenerDeMantenimiento(m1, 'PREVENTIVO');
      expect(await env.prisma.checklistRespuesta.count({ where: { mantenimientoId: m1 } })).toBe(2);
    });

    it('sin plantilla para el tipo no se exige nada', async () => {
      const c = await service.obtenerDeMantenimiento(m2, 'CORRECTIVO');
      expect(c).toMatchObject({ pasos: [], requerido: false, completo: true });
      await expect(service.exigirCompleto(m2, 'CORRECTIVO')).resolves.toBeUndefined();
    });

    it('marcar guarda quién y cuándo; desmarcar los borra', async () => {
      const [paso] = (await service.obtenerDeMantenimiento(m1, 'PREVENTIVO')).pasos;
      const hecho: any = await service.marcar({ mantenimientoId: m1, pasoId: paso.id, completado: true, observacion: ' ok ' }, tecnico);
      expect(hecho).toMatchObject({ completado: true, observacion: 'ok', marcadoPorId: tecnico.id, marcadoPorNombre: `${tecnico.name} ${tecnico.lastname}` });
      expect(hecho.marcadoEn).toBeInstanceOf(Date);
      const enBase = await env.prisma.checklistRespuesta.findUniqueOrThrow({ where: { id: paso.id } });
      expect(enBase.completado).toBe(true);

      const deshecho: any = await service.marcar({ mantenimientoId: m1, pasoId: paso.id, completado: false }, tecnico);
      expect(deshecho).toMatchObject({ completado: false, marcadoPorId: null, marcadoEn: null });
    });

    it('un paso de otra orden no se puede marcar', async () => {
      const [paso] = (await service.obtenerDeMantenimiento(m1, 'PREVENTIVO')).pasos;
      await expect(service.marcar({ mantenimientoId: m2, pasoId: paso.id, completado: true }, tecnico)).rejects.toThrow(/no encontrado/);
      expect((await env.prisma.checklistRespuesta.findUniqueOrThrow({ where: { id: paso.id } })).completado).toBe(false);
    });

    it('no se cierra la orden con pasos obligatorios sin marcar; con los obligatorios hechos sí (el opcional no bloquea)', async () => {
      await expect(service.exigirCompleto(m1, 'PREVENTIVO')).rejects.toThrow(/faltan pasos obligatorios[\s\S]*1\. Desconectar/);
      const [obligatorio] = (await service.obtenerDeMantenimiento(m1, 'PREVENTIVO')).pasos;
      await service.marcar({ mantenimientoId: m1, pasoId: obligatorio.id, completado: true }, tecnico);
      await expect(service.exigirCompleto(m1, 'PREVENTIVO')).resolves.toBeUndefined(); // el paso 2 es opcional
    });

    it('solo el técnico asignado o un administrador marcan, y no una orden ya ejecutada', () => {
      expect(() => service.asegurarPuedeMarcar({ tecnicoId: tecnico.id, estado: 'PENDIENTE' }, tecnico)).not.toThrow();
      expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'otro', estado: 'PENDIENTE' }, admin)).not.toThrow();
      expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'otro', estado: 'PENDIENTE' }, tecnico)).toThrow(/técnico asignado/);
      expect(() => service.asegurarPuedeMarcar({ tecnicoId: 'otro', estado: 'PENDIENTE' }, coord)).toThrow(/técnico asignado/);
      expect(() => service.asegurarPuedeMarcar({ tecnicoId: tecnico.id, estado: 'FINALIZADO' }, tecnico)).toThrow(/ya fue ejecutado/);
    });
  });

  // Van al final: guardar una plantilla nueva reemplaza a la activa (la de prueba).
  describe('plantillas de checklist', () => {
    it('guardar crea una versión nueva y desactiva la anterior, con los pasos en orden', async () => {
      const r: any = await service.guardarPlantilla(
        { tipo: 'preventivo', pasos: [{ texto: 'Revisar fugas' }, { texto: 'Probar en vacío', obligatorio: false }] },
        coord,
      );
      env.rastrear('ChecklistPlantilla', r.id);
      expect(r.version).toBe(plantilla.version + 1);
      expect(r.creadaPorId).toBe(coord.id);
      expect(r.pasos.map((p: any) => [p.orden, p.texto, p.obligatorio])).toEqual([
        [1, 'Revisar fugas', true],
        [2, 'Probar en vacío', false],
      ]);
      expect((await env.prisma.checklistPlantilla.findUniqueOrThrow({ where: { id: plantilla.id } })).activa).toBe(false); // la anterior quedó inactiva
      expect((await env.prisma.checklistPlantilla.findUniqueOrThrow({ where: { id: r.id } })).activa).toBe(true);
    });

    it('valida el tipo, la cantidad y el texto de los pasos', async () => {
      const antes = await env.prisma.checklistPlantilla.count();
      await expect(service.guardarPlantilla({ tipo: 'OTRO', pasos: [{ texto: 'Algo' }] }, admin)).rejects.toThrow(/PREVENTIVO o CORRECTIVO/);
      await expect(service.guardarPlantilla({ tipo: 'PREVENTIVO', pasos: [] }, admin)).rejects.toThrow(/al menos un paso/);
      await expect(
        service.guardarPlantilla({ tipo: 'PREVENTIVO', pasos: Array.from({ length: 31 }, () => ({ texto: 'Paso válido' })) }, admin),
      ).rejects.toThrow(/hasta 30/);
      await expect(service.guardarPlantilla({ tipo: 'PREVENTIVO', pasos: [{ texto: 'ok' }] }, admin)).rejects.toThrow(/paso 1/);
      await env.reintentar(async () => expect(await env.prisma.checklistPlantilla.count()).toBe(antes)); // nada se guardó
    });
  });
});
