import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MaquinariaService } from './maquinaria.service.js';
import type { Actor } from './maquinaria.permisos.js';

const DAY = 86_400_000;

const coordCosta: Actor = { id: 'coord-costa', rol: 'COORD_MANTENIMIENTO', regionId: 'costa', agenciaId: null };
const tecnico: Actor = { id: 'tec-1', rol: 'TECNICO', regionId: 'costa', agenciaId: null };
const pulidor: Actor = { id: 'pul-1', rol: 'PULIDOR', regionId: null, agenciaId: 'ag-1' };
const admin: Actor = { id: 'adm-1', rol: 'ADMIN', regionId: null, agenciaId: null };

function maquina(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    codigo: 'MQ-01',
    nombre: 'Hidro',
    activa: true,
    agenciaId: 'ag-1',
    bahiaId: null,
    operadorAsignadoId: 'pul-1',
    ventanaAdelantoDias: 7,
    estadoOperativo: 'OPERATIVA',
    agencia: { id: 'ag-1', nombre: 'Agencia 1', regionId: 'costa' },
    ...over,
  };
}

function build(prismaOver: Record<string, unknown> = {}) {
  const tx = {
    maquinariaEvento: { create: vi.fn().mockResolvedValue({}) },
    mantenimientoMaquinaria: {
      update: vi.fn().mockImplementation(async ({ data }) => ({ id: 'mt1', ...data })),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
    },
    maquinaria: { update: vi.fn().mockResolvedValue({ ...maquina(), activa: false }) },
    incidenteTecnico: { create: vi.fn() },
  };
  const prisma: Record<string, any> = {
    maquinaria: {
      findUnique: vi.fn().mockResolvedValue(maquina()),
      findUniqueOrThrow: vi.fn().mockResolvedValue(maquina()),
    },
    incidenteTecnico: { findMany: vi.fn(), findUnique: vi.fn() },
    mantenimientoMaquinaria: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    ...prismaOver,
  };
  const storage = {
    maquinariaPrefix: (c: string) => `maquinaria/${c.toLowerCase()}/`,
    generarVariantes: vi.fn().mockResolvedValue(undefined),
    inspectEvidence: vi.fn(async (url: string) =>
      url.endsWith('.pdf')
        ? { key: url, kind: 'DOCUMENTO', mimeType: 'application/pdf', sizeBytes: 1000 }
        : { key: url, kind: 'IMAGEN', mimeType: 'image/jpeg', sizeBytes: 1000 },
    ),
  };
  const notifications = {
    notificarCoordinadorRegion: vi.fn().mockResolvedValue(undefined),
    notificarUsuarios: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MaquinariaService(prisma as never, storage as never, notifications as never);
  return { service, prisma, tx, storage, notifications };
}

describe('MaquinariaService — reglas de trazabilidad', () => {
  describe('ejecutar mantenimiento (ventana de adelanto)', () => {
    const mantenimiento = (diasHastaLaFecha: number) => ({
      id: 'mt1',
      maquinariaId: 'm1',
      tecnicoId: 'tec-1',
      estado: 'PENDIENTE',
      tipo: 'PREVENTIVO',
      frecuenciaDias: 30,
      fechaProgramada: new Date(Date.now() + diasHastaLaFecha * DAY),
      fechaMantenimiento: new Date(Date.now() + diasHastaLaFecha * DAY),
      observaciones: null,
      proximoMantenimiento: null,
      creadoPorId: 'coord-costa',
      maquinaria: maquina({ ventanaAdelantoDias: 7 }),
    });
    const evidencias = [{ url: 'maquinaria/mq-01/mantenimientos/mt1/multimedia/a.jpg' }, { url: 'maquinaria/mq-01/mantenimientos/mt1/documento/a.pdf' }];

    it('bloquea el registro cuando falta más que la ventana configurada, sin excepciones', async () => {
      const { service, prisma } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(20));
      await expect(service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias } as never, tecnico))
        .rejects.toThrow(/Aún no se puede registrar/);
      // Ni siquiera el admin puede saltarse la ventana
      await expect(service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias } as never, admin))
        .rejects.toThrow(BadRequestException);
    });

    it('permite adelantarlo dentro de la ventana y conserva el calendario original', async () => {
      const { service, prisma, tx } = build();
      const m = mantenimiento(5);
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(m);

      await service.ejecutarMantenimiento({ mantenimientoId: 'mt1', evidencias } as never, tecnico);

      const update = tx.mantenimientoMaquinaria.update.mock.calls[0][0].data;
      expect(update.estado).toBe('FINALIZADO');
      expect(update.ejecutadoPorId).toBe('tec-1');
      // Fecha y hora reales de ejecución, distintas de la programada
      expect(update.fechaEjecucion).toBeInstanceOf(Date);
      expect(update.fechaProgramada).toEqual(m.fechaProgramada);
      // El siguiente sigue en programada + frecuencia, no en hoy + frecuencia
      const siguiente = tx.mantenimientoMaquinaria.create.mock.calls[0][0].data.fechaProgramada as Date;
      expect(siguiente.getTime()).toBe(new Date(m.fechaProgramada.getTime() + 30 * DAY).getTime());
      expect(tx.maquinariaEvento.create.mock.calls[0][0].data.tipo).toBe('MANTENIMIENTO_EJECUTADO');
    });

    it('exige al menos una foto o video y un documento', async () => {
      const { service, prisma } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(0));
      await expect(service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', evidencias: [{ url: 'maquinaria/mq-01/mantenimientos/mt1/multimedia/a.jpg' }] } as never,
        tecnico,
      )).rejects.toThrow(/documento/);
      await expect(service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', evidencias: [{ url: 'maquinaria/mq-01/mantenimientos/mt1/documento/a.pdf' }] } as never,
        tecnico,
      )).rejects.toThrow(/foto o un video/);
    });

    it('solo el técnico asignado puede ejecutarlo', async () => {
      const { service, prisma } = build();
      prisma.mantenimientoMaquinaria.findUnique.mockResolvedValue(mantenimiento(0));
      await expect(service.ejecutarMantenimiento(
        { mantenimientoId: 'mt1', evidencias } as never,
        { ...tecnico, id: 'otro-tecnico' },
      )).rejects.toThrow(ForbiddenException);
    });
  });

  describe('reportar incidencia', () => {
    it('un pulidor no puede reportar una máquina que no tiene asignada', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ operadorAsignadoId: 'otro-pulidor' }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        pulidor,
      )).rejects.toThrow(/asignadas/);
    });

    it('no acepta máquinas desactivadas', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ activa: false }));
      await expect(service.reportarIncidente(
        { maquinariaId: 'm1', titulo: 't', descripcion: 'd', evidencias: [] } as never,
        pulidor,
      )).rejects.toThrow(/desactivada/);
    });
  });

  describe('lista de incidencias', () => {
    it('muestra primero las no atendidas (críticas antes), luego en proceso y cerradas', async () => {
      const { service, prisma } = build();
      const base = { maquinariaId: 'm1', maquinaria: {}, evidencias: [] };
      const inc = (id: string, estado: string, gravedad: string, tecnicoAsignadoId: string | null, horasAtras: number) => ({
        ...base, id, estado, gravedad, tecnicoAsignadoId, fechaReporte: new Date(Date.now() - horasAtras * 3_600_000),
      });
      prisma.incidenteTecnico.findMany.mockResolvedValue([
        inc('cerrada', 'RESUELTO', 'ALTA', 'tec-1', 1),
        inc('en-proceso', 'EN_PROCESO', 'BAJA', 'tec-1', 2),
        inc('abierta-baja', 'ABIERTO', 'BAJA', null, 30),
        inc('abierta-critica-nueva', 'ABIERTO', 'CRITICA', null, 1),
        inc('abierta-baja-vieja', 'ABIERTO', 'BAJA', null, 90),
      ]);

      const { data } = await service.listIncidentes({} as never, coordCosta);

      expect(data.map((d) => d.id)).toEqual([
        'abierta-critica-nueva',
        'abierta-baja-vieja',
        'abierta-baja',
        'en-proceso',
        'cerrada',
      ]);
      expect(data.filter((d) => d.noAtendida).length).toBe(3);
    });
  });

  describe('activar / desactivar', () => {
    it('exige motivo al desactivar y registra quién lo hizo', async () => {
      const { service, tx } = build();
      await expect(service.setActiva({ maquinariaId: 'm1', activa: false } as never, admin))
        .rejects.toThrow(/motivo/);

      await service.setActiva({ maquinariaId: 'm1', activa: false, motivo: 'Irreparable' } as never, admin);
      const data = tx.maquinaria.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ activa: false, estadoOperativo: 'DE_BAJA', desactivadoPorId: 'adm-1', motivoDesactivacion: 'Irreparable' });
      const evento = tx.maquinariaEvento.create.mock.calls[0][0].data;
      expect(evento).toMatchObject({ tipo: 'MAQUINA_DESACTIVADA', actorId: 'adm-1', maquinariaId: 'm1' });
    });
  });

  describe('ficha técnica y foto (imágenes en S3)', () => {
    it('al editar verifica que la ficha sea una imagen dentro de la carpeta de la máquina', async () => {
      const { service, prisma, storage } = build();
      prisma.maquinaria.findUniqueOrThrow.mockResolvedValue({ ...maquina(), fichaTecnicaUrl: null, fotoUrl: null });
      await service.update({ id: 'm1', fichaTecnicaUrl: 'maquinaria/mq-01/perfil/ficha-tecnica/a.jpg' } as never, admin);
      expect(storage.inspectEvidence).toHaveBeenCalledWith(
        'maquinaria/mq-01/perfil/ficha-tecnica/a.jpg',
        { prefix: 'maquinaria/mq-01/perfil/ficha-tecnica/' },
      );
    });

    it('rechaza una ficha que no es imagen (por ejemplo un PDF)', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUniqueOrThrow.mockResolvedValue({ ...maquina(), fichaTecnicaUrl: null, fotoUrl: null });
      await expect(service.update({ id: 'm1', fichaTecnicaUrl: 'maquinaria/mq-01/perfil/ficha-tecnica/a.pdf' } as never, admin))
        .rejects.toThrow(/imagen/);
    });

    it('no vuelve a verificar una ficha que no cambió', async () => {
      const { service, prisma, storage } = build();
      const ficha = 'maquinaria/mq-01/perfil/ficha-tecnica/a.jpg';
      prisma.maquinaria.findUniqueOrThrow.mockResolvedValue({ ...maquina(), fichaTecnicaUrl: ficha, fotoUrl: null });
      await service.update({ id: 'm1', fichaTecnicaUrl: ficha } as never, admin);
      expect(storage.inspectEvidence).not.toHaveBeenCalled();
    });
  });

  describe('alcance regional', () => {
    it('un coordinador no puede mover una máquina de otra región', async () => {
      const { service, prisma } = build();
      prisma.maquinaria.findUnique.mockResolvedValue(maquina({ agencia: { id: 'ag-9', nombre: 'Quito', regionId: 'sierra' } }));
      await expect(service.transferirMaquinaria(
        { maquinariaId: 'm1', destinoAgenciaId: 'ag-1', motivo: 'x' } as never,
        coordCosta,
      )).rejects.toThrow(/otra región/);
    });

    it('un técnico solo puede asignarse a técnicos de la misma región', async () => {
      const { service, prisma } = build();
      prisma.incidenteTecnico.findUnique.mockResolvedValue({
        id: 'i1', estado: 'ABIERTO', titulo: 't', tecnicoAsignadoId: null, destinoTallerId: null,
        maquinaria: maquina(),
      });
      prisma.user = {
        findUnique: vi.fn().mockResolvedValue({ id: 'tec-x', estado: 1, regionId: 'sierra', role: { namerol: 'TECNICO' } }),
      };
      await expect(service.asignarIncidente({ incidenteId: 'i1', tecnicoId: 'tec-x' } as never, coordCosta))
        .rejects.toThrow(/misma región/);
    });
  });
});
